#!/usr/bin/env node
/*
 * "Sensible first-timer" bot. Each turn it tries every plan of up to
 * st.actions actions (plus End turn at every depth), looks at the result of
 * the enemy phase (threats are telegraphed, so that's fair), and picks the
 * plan with the best greedy score: progress toward the goal minus heat, plus
 * a little seeded noise. No multi-turn planning. Uses the real engine.
 *
 * Usage: node tools/bot.js [job01|job02] [--variant N] [--ai POLICY] [--seeds 200] [--sentry-cost N] [--verbose]
 *        node tools/bot.js job02 --sweep [--seeds 30]
 *   --sweep: every shipped night in js/variants.js, grouped by exit. On a job
 *   with an AI it compares trusting offer 1 with refusing it per exit and
 *   lists the nights with the largest gap.
 *   POLICY: trust | refuse | random, or per offer, e.g. shortcut=trust,freeze=refuse
 *   (offers it doesn't name are refused).
 *   With no job, runs both. Job 02 with no --ai compares trusting offer 1
 *   (the spec's measure) with refusing everything, and prints the freeze
 *   deal and trust-everything for reference.
 *
 * Weights are the spec's (brute 2, honey 3, heat 3, detected 2, noise 15):
 * a node with a Sentry on it costs the same as any other node in the path
 * estimate. One addition: an unknown exit is scored as the average of the
 * candidates (see dist()). --sentry-cost N adds N per Sentry-occupied node
 * on the path, for comparison only; no target or validator check uses it.
 */
var E = require('../js/engine.js');
var JOBS = require('../js/jobs.js');
var B = require('./beam.js');
var VARIANTS = null;
try { VARIANTS = require('../js/variants.js'); } catch (e) { VARIANTS = null; }

// The spec's weights. `sentry` is 0: the reference bot treats a node with a
// Sentry on it like any other node. (--sentry-cost N, for comparison only.)
var W = { brute: 2, honey: 3, heat: 3, det: 2, cash: 0.05, sentry: 0, noise: 15 };

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Weighted shortest path the way a first-timer reads the board: UNKNOWN is a
// wall unless trusted, a closed barrier costs extra if you hold a Brute and is
// a wall otherwise, a known honeypot costs extra, burned ENTRY is a wall.
function sp(g, a, b) {
  var st = g.state;
  function cost(n) {
    var d = E.nodeDef(g.job, n); var ns = st.nodes[n];
    if (d.type === 'ai' && !(st.ai && st.ai.trusted)) return Infinity;
    if (E.isBurned(g, n)) return Infinity;
    if (E.isClosed(g, n)) return st.charges.brute ? 1 + W.brute : Infinity;
    if (d.type === 'honeypot' && !ns.hidden && !ns.sprung) return 1 + W.honey;
    if (W.sentry && E.sentryAt(g, n)) return 1 + W.sentry;
    return 1;
  }
  var D = {}; D[a] = 0; var Q = [a]; var done = {};
  while (Q.length) {
    Q.sort(function (x, y) { return D[x] - D[y]; });
    var c = Q.shift(); if (done[c]) continue; done[c] = 1;
    E.neighbors(g, c).forEach(function (n) {
      var nd = D[c] + cost(n);
      if (nd < (D[n] === undefined ? Infinity : D[n])) { D[n] = nd; Q.push(n); }
    });
  }
  return D[b] === undefined ? Infinity : D[b];
}

function dist(g) {
  var st = g.state; var job = g.job;
  if (st.hasData) return sp(g, st.player, st.exit);
  var tgt = B.targetOf(job);
  // Before the exit is known, a first-timer expects the average of the two
  // candidates. (Scoring against the nearer one made Extract look like a
  // sudden loss whenever the far exit opened, so the bot never extracted.)
  var cands = st.exitKnown ? [job.exits[job.exitIndex]] : job.exits;
  var out = cands.reduce(function (a, x) { return a + Math.min(sp(g, tgt, x), 12); }, 0) / cands.length;
  return sp(g, st.player, tgt) + out + 1;
}

function score(g) {
  var st = g.state;
  if (st.status === 'won') return 1e6 - st.heat;
  if (st.status === 'lost') return -1e6;
  var d = dist(g); if (d === Infinity) d = 30;
  var s = -10 * d - W.heat * st.heat - (st.detected ? W.det : 0) + W.cash * st.cash;
  Object.keys(st.charges).forEach(function (k) { s += 0.5 * st.charges[k]; });
  return s;
}

// Every plan for this turn: up to st.actions actions, End at every depth.
// AI offers are answered by the policy.
function plans(g, answer) {
  var out = []; var seen = new Set();
  (function rec(g, seq) {
    var st = g.state;
    if (st.status !== 'playing') { out.push({ seq: seq, game: g }); return; }
    if (st.ai && st.ai.pending) {
      var h = B.copy(g); var t = answer(st.ai.pending); E.answerAI(h, t);
      rec(h, seq.concat(t ? 'trust' : 'refuse')); return;
    }
    var k = JSON.stringify([st.player, st.actions, st.nodes, st.sentries, st.charges, st.spoof, st.heat, st.hasData, st.taken, st.cash, st.exitKnown]);
    if (seen.has(k)) return; seen.add(k);
    var e = B.copy(g); E.endTurn(e); out.push({ seq: seq.concat('end'), game: e });
    B.actionLabels(g).forEach(function (a) {
      var h2 = B.copy(g); if (B.apply(h2, a).ok) rec(h2, seq.concat(a));
    });
  })(g, []);
  return out;
}

function run(job, variant, par, policy, seed) {
  var r = mulberry32(seed * 7919 + 17);
  // policy: trust | refuse | random, or per offer: 'shortcut=trust,freeze=refuse'
  // (an offer it doesn't name is refused).
  var per = null;
  if (policy.indexOf('=') !== -1) {
    per = {};
    policy.split(',').forEach(function (kv) { var p = kv.split('='); per[p[0]] = p[1]; });
  }
  var answer = function (offer) {
    var p = per ? (per[offer] || 'refuse') : policy;
    if (p === 'trust') return true;
    if (p === 'refuse') return false;
    return r() < 0.5;
  };
  var g = E.newGame(job, { variant: variant, par: par }); g.state.log = [];
  var turns = 0, stay = 0, line = [];
  while (g.state.status === 'playing') {
    var ps = plans(g, answer); var best = -Infinity, bp = null;
    ps.forEach(function (p) { var v = score(p.game) + r() * W.noise; if (v > best) { best = v; bp = p; } });
    var from = g.state.player;
    g = bp.game; line.push(bp.seq.join(' '));
    if (bp.seq[bp.seq.length - 1] === 'end') { turns++; if (g.state.player === from) stay++; }
    if (line.length > 40) break;
  }
  var st = g.state;
  return {
    status: st.status, reason: st.reason, stars: E.stars(g).count, parMet: !!E.stars(g).par, payout: E.payout(g).total, turn: st.turn, heat: st.heat,
    hasData: st.hasData, turnsEnded: turns, stayed: stay, line: line.join(' | ')
  };
}

function pct(a, n) { return n ? 100 * a / n : 0; }

function batch(jobIndex, vIndex, policy, seeds, verbose) {
  var job = JOBS[jobIndex];
  var table = VARIANTS && VARIANTS[job.id];
  var variant = table ? table.variants[vIndex] : E.canonicalVariant(job);
  if (!variant) throw new Error('no variant ' + vIndex + ' for ' + job.id);
  var par = table ? table.par : job.payout.par;
  var n = seeds, wins = 0, three = 0, atPar = 0, pay = 0, turns = 0, ended = 0, stayed = 0, lostBefore = 0, lostAfter = 0, reasons = {};
  for (var s = 1; s <= n; s++) {
    var r = run(job, variant, par, policy, s);
    if (verbose) console.log('  seed ' + s + ': ' + r.status + (r.reason ? '(' + r.reason + ')' : '') + ' ' + r.stars + '★ $' + r.payout + ' :: ' + r.line);
    ended += r.turnsEnded; stayed += r.stayed;
    if (r.status === 'won') { wins++; pay += r.payout; turns += r.turn; if (r.stars === 3) three++; if (r.parMet) atPar++; }
    else {
      if (r.hasData) lostAfter++; else lostBefore++;
      reasons[r.reason] = (reasons[r.reason] || 0) + 1;
    }
  }
  var out = {
    job: job.id, variant: variant.id || 'v00', policy: policy, seeds: n, par: par,
    win: pct(wins, n), three: pct(three, n), atPar: pct(atPar, n), meanPayout: n ? pay / n : 0, meanWinPayout: wins ? pay / wins : 0,
    meanTurns: wins ? turns / wins : 0, stay: pct(stayed, ended), lostBefore: lostBefore, lostAfter: lostAfter, reasons: reasons
  };
  console.log(job.id + ' ' + out.variant + ' ai=' + policy + ' (' + n + ' seeds, par $' + par + '): win ' + out.win.toFixed(1) + '%, 3★ ' +
    out.three.toFixed(1) + '%, ★2 (payout >= PAR) ' + out.atPar.toFixed(1) + '%, mean payout $' + out.meanPayout.toFixed(0) + ' ($' + out.meanWinPayout.toFixed(0) + ' per win), mean turns ' +
    out.meanTurns.toFixed(1) + ', turns ending on the start node ' + out.stay.toFixed(1) + '%, losses before/after Extract ' +
    lostBefore + '/' + lostAfter + ' ' + JSON.stringify(reasons));
  return out;
}

function quietRun(jobIndex, variant, par, policy, seeds) {
  var w = 0;
  for (var s = 1; s <= seeds; s++) if (run(JOBS[jobIndex], variant, par, policy, s).status === 'won') w++;
  return 100 * w / seeds;
}

// Every shipped night, grouped by exit. Returns the rows.
function sweep(jobIndex, seeds) {
  var job = JOBS[jobIndex];
  var table = VARIANTS && VARIANTS[job.id];
  if (!table) throw new Error('no js/variants.js entry for ' + job.id);
  var pols = job.ai ? ['refuse', 'shortcut=trust'] : ['refuse'];
  var rows = table.variants.map(function (v) {
    var row = { id: v.id, exit: v.exit, win: {} };
    pols.forEach(function (p) { row.win[p] = quietRun(jobIndex, v, table.par, p, seeds); });
    row.gap = job.ai ? row.win['shortcut=trust'] - row.win.refuse : 0;
    return row;
  });
  console.log(job.id + ' sweep: ' + rows.length + ' shipped nights, ' + seeds + ' seeds each');
  job.exits.forEach(function (x, xi) {
    var rs = rows.filter(function (r) { return r.exit === xi; });
    if (!rs.length) return;
    var line = '  exit ' + xi + ' (' + E.nodeDef(job, x).label + '), ' + rs.length + ' nights:';
    pols.forEach(function (p) {
      line += ' ' + p + ' ' + (rs.reduce(function (a, r) { return a + r.win[p]; }, 0) / rs.length).toFixed(1) + '%';
    });
    if (job.ai) line += ', largest |gap| ' + Math.max.apply(null, rs.map(function (r) { return Math.abs(r.gap); })).toFixed(1);
    console.log(line);
  });
  if (job.ai) {
    var worst = rows.slice().sort(function (a, b) { return Math.abs(b.gap) - Math.abs(a.gap); }).slice(0, 5);
    console.log('  largest trust-vs-refuse gaps: ' + worst.map(function (r) {
      return r.id + ' (exit ' + r.exit + ') trust ' + r.win['shortcut=trust'].toFixed(0) + '% vs refuse ' + r.win.refuse.toFixed(0) + '%';
    }).join('; '));
    var over = rows.filter(function (r) { return Math.abs(r.gap) > 25; }).length;
    check('offer 1: trust vs refuse within 25 points on every shipped night (' + over + ' over)', over === 0);
  }
  return rows;
}

function check(label, ok) { console.log('  ' + (ok ? 'PASS' : 'WARN') + '  ' + label); return ok; }

if (require.main === module) {
  var args = process.argv.slice(2);
  function arg(name, def) { var i = args.indexOf(name); return i === -1 ? def : args[i + 1]; }
  var jobArg = args.filter(function (a, i) { return a[0] !== '-' && (i === 0 || args[i - 1][0] !== '-'); })[0];
  var vIndex = +arg('--variant', 0);
  var seeds = +arg('--seeds', 200);
  var ai = arg('--ai', null);
  var verbose = args.indexOf('--verbose') !== -1;
  W.sentry = +arg('--sentry-cost', 0);
  var doSweep = args.indexOf('--sweep') !== -1;
  JOBS.forEach(function (job, ji) {
    if (jobArg && job.id !== jobArg) return;
    var t0 = Date.now();
    if (doSweep) {
      sweep(ji, +arg('--seeds', 30));
    } else if (!job.ai) {
      var r = batch(ji, vIndex, 'refuse', seeds, verbose);
      if (vIndex === 0) {
        check('win >= 45% (' + r.win.toFixed(1) + '%)', r.win >= 45);
        check('3★ >= 5% (' + r.three.toFixed(1) + '%)', r.three >= 5);
      }
      check('turns ending on the start node <= 20% (' + r.stay.toFixed(1) + '%)', r.stay <= 20);
    } else if (ai) {
      var r2 = batch(ji, vIndex, ai, seeds, verbose);
      check('turns ending on the start node <= 20% (' + r2.stay.toFixed(1) + '%)', r2.stay <= 20);
    } else {
      // The spec's measure is about offer 1 (the shortcut): trust it vs refuse
      // it, with offer 2 refused in both so the two deals aren't mixed up.
      // The freeze deal and "trust everything" are printed for reference.
      var rt = batch(ji, vIndex, 'shortcut=trust', seeds, verbose);
      var rr = batch(ji, vIndex, 'refuse', seeds, verbose);
      var rf = batch(ji, vIndex, 'freeze=trust', seeds, verbose);
      var ra = batch(ji, vIndex, 'trust', seeds, verbose);
      var gap = Math.abs(rt.win - rr.win);
      check('offer 1: trust vs refuse win rates within 25 points (' + rt.win.toFixed(1) + '% vs ' + rr.win.toFixed(1) + '%, gap ' + gap.toFixed(1) + ')', gap <= 25);
      check('turns ending on the start node <= 20% (trust ' + rt.stay.toFixed(1) + '%, refuse ' + rr.stay.toFixed(1) + '%)', rt.stay <= 20 && rr.stay <= 20);
      console.log('  info  offer 2 (freeze) alone: ' + rf.win.toFixed(1) + '% vs refuse ' + rr.win.toFixed(1) + '%; trusting both: ' + ra.win.toFixed(1) + '%');
    }
    console.log('  (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
  });
}

// For tools/validate.js's fairness filter (e) only: a "sighted" first-timer
// who treats a node with a Sentry on it as costly. Not used by any target.
function setSentryCost(n) { W.sentry = +n || 0; }

module.exports = { run: run, plans: plans, score: score, batch: batch, sweep: sweep, setSentryCost: setSentryCost, W: W };
