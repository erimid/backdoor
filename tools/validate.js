#!/usr/bin/env node
/*
 * Seeded-variant validator. Enumerates every raw variant of every job,
 * beam-searches each one (tools/beam.js) and keeps those that pass the
 * fairness checks:
 *   (c) no Sentry starts on or next to ENTRY,
 *   (d) no turn-1 intent targets ENTRY,
 *   (a) a 3-star line exists at the job's par,
 *   (b) a win still exists with that line's key node forbidden (a second route),
 *   (e) the "sighted" first-timer bot (tools/bot.js with a Sentry cost of 3,
 *       see FAIR_SENTRY_COST; refusing every AI offer) wins at
 *       least BOT_MIN of BOT_SEEDS seeded runs, so "Tonight" never deals a
 *       night that is close to unwinnable for a new player. On a job with an
 *       AI the bot also plays trusting offer 1 (policy 'shortcut=trust'); that
 *       must also win at least BOT_MIN, and within BOT_GAP of refusing, so the
 *       offer is a real choice on every night, not a trap on some exits.
 * Par per job = 25th percentile of the variants' best bonus-meeting payouts,
 * rounded down to $50, then lowered if needed so the canonical variant's best
 * payout is at least par + $50.
 *
 * Writes js/variants.js (variant 0 is always canonical) and prints a report.
 * Usage: node tools/validate.js [--jobs job01,job02] [--workers N] [--dry]
 *   --dry: don't write js/variants.js
 */
var path = require('path');
var fs = require('fs');
var os = require('os');
var wt = require('worker_threads');
var E = require('../js/engine.js');
var JOBS = require('../js/jobs.js');
var B = require('./beam.js');
var BOT = require('./bot.js');

// 100 seeds per night (the trust/refuse gap is too noisy at 50: about ±10
// points), and the spec's 200 on the canonical night, where the gap check is
// the spec's own success measure.
var BOT_SEEDS = 100;
// The filter's first-timer is "sighted": it sees that a node with a Sentry on
// it is blocked (tools/bot.js --sentry-cost 3). The spec's reference bot
// (tools/bot.js with its default weights, which all the success measures
// use) treats that node as open, walks into telegraphed bumps and gets boxed
// in, and wins under 25% of Job 02 nights; filtering on it would leave 14
// nights, none with the MAIL-02 exit. See the README ("What the bot found").
var FAIR_SENTRY_COST = 3;
var BOT_SEEDS_CANON = 200;
var BOT_MIN = 0.25;
var BOT_GAP = 0.25;
// Seeds per night for the spec bot's trust/refuse gap (check e, AI jobs).
var SPEC_SEEDS = 60;

// ---------- worker side ----------

function runTask(t) {
  var job = JOBS[t.job];
  var t0 = Date.now();
  var r;
  if (t.kind === 'best') r = B.solve(job, { variant: t.variant, want: 'payout' });
  else if (t.kind === 'stars') r = B.solve(job, { variant: t.variant, par: t.par, want: 'stars' });
  else if (t.kind === 'alt') r = B.solve(job, { variant: t.variant, par: t.par, forbid: t.forbid, want: 'win' });
  else if (t.kind === 'bot') {
    var w = 0; var n = t.seeds || BOT_SEEDS;
    for (var s = 1; s <= n; s++) if (BOT.run(job, t.variant, t.par, 'refuse', s).status === 'won') w++;
    r = { win: w / n, trust: null };
    if (job.ai) {
      var wt2 = 0;
      for (var s2 = 1; s2 <= n; s2++) if (BOT.run(job, t.variant, t.par, 'shortcut=trust', s2).status === 'won') wt2++;
      r.trust = wt2 / n;
      // The spec's own bot (no Sentry cost) must also find trusting and
      // refusing offer 1 within BOT_GAP of each other on this night, so a
      // typical player never has to trust UNKNOWN to stand a chance.
      BOT.setSentryCost(0);
      var sr = 0, stt = 0;
      for (var s3 = 1; s3 <= SPEC_SEEDS; s3++) {
        if (BOT.run(job, t.variant, t.par, 'refuse', s3).status === 'won') sr++;
        if (BOT.run(job, t.variant, t.par, 'shortcut=trust', s3).status === 'won') stt++;
      }
      BOT.setSentryCost(FAIR_SENTRY_COST);
      r.specRefuse = sr / SPEC_SEEDS; r.specTrust = stt / SPEC_SEEDS;
    }
  }
  return { id: t.id, result: r, ms: Date.now() - t0 };
}

if (!wt.isMainThread) {
  BOT.setSentryCost(FAIR_SENTRY_COST);
  wt.parentPort.on('message', function (t) { wt.parentPort.postMessage(runTask(t)); });
  return;
}

// ---------- enumeration ----------

function permutations(a) {
  if (a.length <= 1) return [a.slice()];
  var out = [];
  a.forEach(function (x, i) {
    permutations(a.slice(0, i).concat(a.slice(i + 1))).forEach(function (p) { out.push([x].concat(p)); });
  });
  return out;
}

function sameVariant(a, b) {
  return JSON.stringify([a.bag, a.offsets, a.exit]) === JSON.stringify([b.bag, b.offsets, b.exit]);
}

// Every raw variant, canonical first: bag permutations x Sentry offsets x exit.
function rawVariants(job) {
  var bags = [{}];
  if (job.bag && job.bag.nodes) {
    bags = permutations(job.bag.contents).map(function (perm) {
      var b = {}; job.bag.nodes.forEach(function (id, i) { b[id] = perm[i]; }); return b;
    });
  }
  var offs = [{}];
  job.sentries.forEach(function (s) {
    var n = [];
    offs.forEach(function (o) {
      // A Sentry may list the loop offsets it can be dealt (`offsets`);
      // otherwise every point on its loop is a variant.
      var ks = s.offsets || s.patrol.map(function (_, k) { return k; });
      ks.forEach(function (k) { var c = Object.assign({}, o); c[s.id] = k; n.push(c); });
    });
    offs = n;
  });
  var exits = (job.exits || [null]).map(function (_, i) { return i; });
  // Repeated bag contents (two honeypots) give the same bag twice.
  var seenBag = {};
  bags = bags.filter(function (b) { var k = JSON.stringify(b); if (seenBag[k]) return false; seenBag[k] = 1; return true; });
  var out = [];
  bags.forEach(function (bag) {
    offs.forEach(function (o) {
      exits.forEach(function (x) { out.push({ bag: bag, offsets: o, exit: x }); });
    });
  });
  var canon = E.canonicalVariant(job);
  var ci = out.findIndex(function (v) { return sameVariant(v, canon); });
  if (ci > 0) out.unshift(out.splice(ci, 1)[0]);
  out.forEach(function (v, i) { v.raw = i; });
  return out;
}

// Static fairness checks (c) and (d). Returns null or a reason.
function staticReject(job, variant) {
  var g = E.newGame(job, { variant: variant });
  var entry = B.entryOf(g.job);
  var near = E.neighbors(g, entry);
  var spots = g.state.sentries.map(function (s) { return s.pos; });
  if (spots.some(function (p, i) { return spots.indexOf(p) !== i; })) return 'c:two Sentries start on one node';
  for (var i = 0; i < g.state.sentries.length; i++) {
    var s = g.state.sentries[i];
    if (s.pos === entry || near.indexOf(s.pos) !== -1) return 'c:sentry ' + s.id + ' starts next to ENTRY';
    if (s.intent && s.intent.target === entry) return 'd:sentry ' + s.id + ' turn-1 intent targets ENTRY';
  }
  return null;
}

// Replays a label line. Returns the final game plus the unused action slots
// over completed turns (for the "unused slots" success measure).
function replay(job, variant, par, moves) {
  var g = E.newGame(job, { variant: variant, par: par });
  var slots = 0, unused = 0, lost = 0;
  var start = g.state.actions;
  moves.split(' ').forEach(function (m) {
    if (g.state.status !== 'playing') return;
    if (m === 'end') { slots += start; unused += g.state.actions; lost += Math.max(0, g.state.actions - 1); }
    var r = B.apply(g, m);
    if (!r.ok) throw new Error('replay failed at ' + m + ': ' + r.reason);
    if (m === 'end') start = g.state.actions;
  });
  return { game: g, slots: slots, unused: unused, forfeited: lost };
}

// ---------- worker pool ----------

function pool(n) {
  var file = __filename;
  var workers = []; var idle = []; var queue = []; var waiting = {};
  for (var i = 0; i < n; i++) {
    var w = new wt.Worker(file);
    w.on('message', function (msg) {
      var cb = waiting[msg.id]; delete waiting[msg.id];
      idle.push(this); pump(); cb(msg);
    });
    w.on('error', function (e) { console.error('worker error', e); process.exit(1); });
    workers.push(w); idle.push(w);
  }
  var seq = 0;
  function pump() {
    while (idle.length && queue.length) { var it = queue.shift(); var w = idle.pop(); waiting[it.task.id] = it.cb; w.postMessage(it.task); }
  }
  return {
    run: function (task) {
      return new Promise(function (res) { task.id = ++seq; queue.push({ task: task, cb: res }); pump(); });
    },
    close: function () { workers.forEach(function (w) { w.terminate(); }); }
  };
}

function progress(label, done, total, t0) {
  if (done === total || done % Math.max(1, Math.round(total / 10)) === 0) {
    console.log('  ' + label + ' ' + done + '/' + total + ' (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
  }
}

async function runAll(P, label, tasks) {
  var t0 = Date.now(); var done = 0;
  return Promise.all(tasks.map(function (t) {
    return P.run(t).then(function (m) { done++; progress(label, done, tasks.length, t0); return m.result; });
  }));
}

function median(a) {
  if (!a.length) return null;
  var s = a.slice().sort(function (x, y) { return x - y; });
  return s[Math.floor((s.length - 1) / 2)];
}

// ---------- per job ----------

async function validateJob(P, jobIndex) {
  var job = JOBS[jobIndex];
  var t0 = Date.now();
  var raw = rawVariants(job);
  console.log('== ' + job.id + ' ' + job.name + ': ' + raw.length + ' raw variants');
  var rejects = {};
  function reject(v, why) { v.reject = why; var k = why.split(':')[0]; rejects[k] = (rejects[k] || 0) + 1; }
  raw.forEach(function (v) { var why = staticReject(job, v); if (why) reject(v, why); });
  var live = raw.filter(function (v) { return !v.reject; });
  console.log('  ' + live.length + ' pass the start checks (c, d)');

  // Pass 1: best payout with the bonus met.
  var best = await runAll(P, 'best payout', live.map(function (v) { return { kind: 'best', job: jobIndex, variant: v }; }));
  live.forEach(function (v, i) { v.best = best[i]; });
  var pays = live.filter(function (v) { return v.best && v.best.bonus; }).map(function (v) { return v.best.payout; })
    .sort(function (a, b) { return a - b; });
  if (!pays.length) throw new Error(job.id + ': no variant has a bonus-meeting win');
  var p25 = pays[Math.floor(0.25 * (pays.length - 1))];
  var par = Math.floor(p25 / 50) * 50;
  var canon = raw[0];
  if (canon.reject) throw new Error(job.id + ': canonical variant fails start check ' + canon.reject);
  if (!canon.best || !canon.best.bonus) throw new Error(job.id + ': canonical variant has no bonus-meeting win');
  var parNote = '25th percentile $' + p25 + ' -> par $' + par;
  if (canon.best.payout < par + 50) {
    par = Math.floor((canon.best.payout - 50) / 50) * 50;
    parNote += ', lowered to $' + par + ' so canonical ($' + canon.best.payout + ') clears it by $50';
  }
  console.log('  ' + parNote);

  // (a) 3-star line at par. The best-payout line already is one if it meets
  // par; otherwise search for stars directly.
  var needStars = live.filter(function (v) { return !(v.best && v.best.bonus && v.best.payout >= par); });
  var starRes = await runAll(P, '3-star retry', needStars.map(function (v) { return { kind: 'stars', job: jobIndex, variant: v, par: par }; }));
  needStars.forEach(function (v, i) { if (starRes[i] && starRes[i].stars === 3) v.best = starRes[i]; });
  live.forEach(function (v) {
    if (!v.best) return reject(v, 'a:no win');
    var rr = replay(job, v, par, v.best.moves);
    var s = E.stars(rr.game);
    if (rr.game.state.status !== 'won' || s.count < 3) return reject(v, 'a:best line is ' + s.count + ' stars at par');
    v.witness = v.best.moves;
    v.slots = rr.slots; v.unused = rr.unused; v.forfeited = rr.forfeited;
    v.bestOut = { payout: E.payout(rr.game).total, stars: s.count, turn: rr.game.state.turn, heat: rr.game.state.heat, routeKey: v.best.routeKey };
    v.forbid = B.keyNode(job, v.witness.split(' '));
  });

  // (b) second route: forbid the witness's key node.
  var withW = live.filter(function (v) { return !v.reject; });
  var alts = await runAll(P, 'second route', withW.map(function (v) {
    return { kind: 'alt', job: jobIndex, variant: v, par: par, forbid: [v.forbid] };
  }));
  withW.forEach(function (v, i) {
    if (!alts[i] || !alts[i].won) return reject(v, 'b:no win without ' + v.forbid);
    v.alt = alts[i];
  });

  // (e) fairness for a first-timer: the bot must win often enough.
  var withAlt = live.filter(function (v) { return !v.reject; });
  var bots = await runAll(P, 'bot fairness', withAlt.map(function (v) { return { kind: 'bot', job: jobIndex, variant: v, par: par, seeds: v === canon ? BOT_SEEDS_CANON : BOT_SEEDS }; }));
  withAlt.forEach(function (v, i) {
    v.botWin = bots[i].win; v.botTrust = bots[i].trust;
    if (bots[i].win < BOT_MIN) return reject(v, 'e:bot wins ' + Math.round(100 * bots[i].win) + '%');
    if (bots[i].trust === null) return;
    if (bots[i].trust < BOT_MIN) return reject(v, 'e:bot trusting offer 1 wins ' + Math.round(100 * bots[i].trust) + '%');
    if (Math.abs(bots[i].trust - bots[i].win) > BOT_GAP + 1e-9) {
      return reject(v, 'e:offer 1 trust ' + Math.round(100 * bots[i].trust) + '% vs refuse ' + Math.round(100 * bots[i].win) + '%');
    }
    v.specGap = bots[i].specTrust - bots[i].specRefuse;
    if (Math.abs(v.specGap) > BOT_GAP + 1e-9) {
      reject(v, 'e:spec bot trusting offer 1 ' + Math.round(100 * bots[i].specTrust) + '% vs refusing ' + Math.round(100 * bots[i].specRefuse) + '%');
    }
  });

  var pass = live.filter(function (v) { return !v.reject; });
  if (canon.reject) throw new Error(job.id + ': canonical variant rejected: ' + canon.reject);

  var variants = pass.map(function (v, i) {
    return {
      id: 'v' + (i < 10 ? '0' : '') + i, bag: v.bag, offsets: v.offsets, exit: v.exit, witness: v.witness, best: v.bestOut,
      alt: { forbid: v.forbid, routeKey: v.alt.routeKey, stars: v.alt.stars, payout: v.alt.payout }
    };
  });

  // Route probes on the canonical variant, for the README's per-route table.
  var probes = []; var forbid = [];
  for (var pi = 0; pi < 4; pi++) {
    var pr = (await P.run({ kind: 'alt', job: jobIndex, variant: raw[0], par: par, forbid: forbid.slice() })).result;
    probes.push({ forbid: forbid.slice(), result: pr });
    if (!pr) break;
    var kn = B.keyNode(job, pr.moves.split(' '));
    if (!kn || forbid.indexOf(kn) !== -1) break;
    forbid.push(kn);
  }

  // Report.
  var routes = {};
  function addRoute(k, r, kind) {
    var e = routes[k] || (routes[k] = { witness: 0, alt: 0, best: null });
    e[kind]++;
    if (!e.best || r.stars > e.best.stars || (r.stars === e.best.stars && r.payout > e.best.payout)) {
      e.best = { stars: r.stars, payout: r.payout, turn: r.turn, heat: r.heat };
    }
  }
  pass.forEach(function (v) { addRoute(v.bestOut.routeKey, v.bestOut, 'witness'); addRoute(v.alt.routeKey, v.alt, 'alt'); });
  var slots = pass.reduce(function (a, v) { return a + v.slots; }, 0);
  var unused = pass.reduce(function (a, v) { return a + v.unused; }, 0);
  var forfeited = pass.reduce(function (a, v) { return a + v.forfeited; }, 0);
  var report = {
    job: job.id, raw: raw.length, accepted: pass.length, par: par, parNote: parNote, rejects: rejects,
    canonical: variants[0].best, medianTurn: median(pass.map(function (v) { return v.bestOut.turn; })),
    medianPayout: median(pass.map(function (v) { return v.bestOut.payout; })),
    canonUnused: pass[0].slots ? pass[0].unused / pass[0].slots : 0,
    botWinMedian: median(pass.map(function (v) { return v.botWin; })),
    botTrustMedian: job.ai ? median(pass.map(function (v) { return v.botTrust; })) : null,
    botGapMax: job.ai ? Math.max.apply(null, pass.map(function (v) { return Math.abs(v.botTrust - v.botWin); })) : null,
    unusedSlots: slots ? unused / slots : 0, forfeitedSlots: slots ? forfeited / slots : 0, routes: routes, probes: probes, seconds: (Date.now() - t0) / 1000
  };
  printReport(report);
  return { par: par, variants: variants, report: report };
}

function printReport(r) {
  console.log('-- ' + r.job + ': accepted ' + r.accepted + '/' + r.raw + ', par $' + r.par + ' (' + r.parNote + ')');
  console.log('   rejected: ' + (Object.keys(r.rejects).map(function (k) { return k + '=' + r.rejects[k]; }).join(' ') || 'none') +
    '   (c: Sentry next to ENTRY, d: turn-1 intent on ENTRY, a: no 3-star line, b: no second route, e: bot wins < ' + Math.round(100 * BOT_MIN) +
    '%, or trusting offer 1 wins < ' + Math.round(100 * BOT_MIN) + '% or > ' + Math.round(100 * BOT_GAP) + ' points from refusing)');
  console.log('   canonical v00: ' + r.canonical.stars + '★ $' + r.canonical.payout + ' turn ' + r.canonical.turn + ' heat ' + r.canonical.heat + ' via ' + r.canonical.routeKey);
  console.log('   median witness turn ' + r.medianTurn + ', median payout $' + r.medianPayout +
    ', median sighted-bot win (Sentry cost ' + FAIR_SENTRY_COST + ', not the spec bot; refusing offers) ' + Math.round(100 * r.botWinMedian) + '%' +
    (r.botTrustMedian === null ? '' : ', trusting offer 1 ' + Math.round(100 * r.botTrustMedian) + '% (largest gap on a shipped night ' +
      Math.round(100 * r.botGapMax) + ' points)'));
  // The spec's "unused action slots <= 15%", read plainly: every action slot
  // of a completed turn that the line didn't spend counts as unused, including
  // the one banked by overclock. (Forfeited slots, the ones beyond the 1 that
  // overclock carries over, are printed as well for reference; they are not
  // the measure.)
  console.log('   ' + (r.unusedSlots <= 0.15 ? 'PASS' : 'WARN') + '  unused action slots in the best lines ' + (100 * r.unusedSlots).toFixed(1) +
    '% (spec target <= 15%; canonical line ' + (100 * r.canonUnused).toFixed(1) + '%). For reference, forfeited (not carried over by overclock): ' +
    (100 * r.forfeitedSlots).toFixed(1) + '%.');
  console.log('   route classes (witness lines / second-route lines, best result):');
  Object.keys(r.routes).sort().forEach(function (k) {
    var e = r.routes[k];
    console.log('     ' + (k + '                         ').slice(0, 26) + e.witness + ' / ' + e.alt + '   best ' + e.best.stars + '★ $' + e.best.payout + ' turn ' + e.best.turn + ' heat ' + e.best.heat);
  });
  console.log('   canonical route probes (each forbids the key nodes of the lines before it):');
  r.probes.forEach(function (p) {
    console.log('     forbid [' + p.forbid.join(',') + ']: ' + (p.result ? p.result.stars + '★ $' + p.result.payout + ' turn ' + p.result.turn + ' heat ' + p.result.heat + ' via ' + p.result.routeKey + '  ' + p.result.moves : 'no win'));
  });
  console.log('   (' + r.seconds.toFixed(1) + ' s)');
}

function writeVariants(out) {
  var body = '/*\n * GENERATED by tools/validate.js (npm run validate). Do not edit by hand.\n' +
    ' * Seeded variants that passed the fairness checks, per job. Index 0 is the\n' +
    ' * canonical variant. Each has a witness line (replayed by tests/variants.test.js).\n */\n' +
    '(function (root) {\n  var VARIANTS = {\n' + Object.keys(out).map(function (k) {
      return '    ' + k + ': {\n      par: ' + out[k].par + ',\n      variants: [\n' +
        out[k].variants.map(function (v) { return '        ' + JSON.stringify(v); }).join(',\n') + '\n      ]\n    }';
    }).join(',\n') + '\n  };\n' +
    '  root.BACKDOOR_VARIANTS = VARIANTS;\n' +
    '  if (typeof module !== \'undefined\' && module.exports) module.exports = VARIANTS;\n' +
    '})(typeof window !== \'undefined\' ? window : globalThis);\n';
  fs.writeFileSync(path.join(__dirname, '../js/variants.js'), body);
}

async function main() {
  var args = process.argv.slice(2);
  function arg(name) { var i = args.indexOf(name); return i === -1 ? null : args[i + 1]; }
  var only = arg('--jobs') ? arg('--jobs').split(',') : null;
  var n = +arg('--workers') || Math.max(1, (os.cpus() || []).length);
  var P = pool(n);
  var t0 = Date.now();
  console.log('validate: ' + n + ' worker(s)');
  var out = {}; var reports = []; var failed = [];
  try {
    for (var i = 0; i < JOBS.length; i++) {
      if (only && only.indexOf(JOBS[i].id) === -1) continue;
      var r = await validateJob(P, i);
      out[JOBS[i].id] = { par: r.par, variants: r.variants };
      reports.push(r.report);
    }
  } catch (e) {
    P.close();
    console.error('FAIL: ' + e.message);
    process.exit(1);
  }
  P.close();
  var MIN = { job01: 8, job02: 40 };
  reports.forEach(function (r) {
    if (r.accepted < (MIN[r.job] || 4)) failed.push(r.job + ' has ' + r.accepted + ' variants (need ' + (MIN[r.job] || 4) + ')');
  });
  console.log('\n== summary (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
  reports.forEach(function (r) {
    console.log('  ' + r.job + ': ' + r.accepted + '/' + r.raw + ' variants, par $' + r.par + ', canonical ' + r.canonical.stars + '★ $' + r.canonical.payout + ', median turn ' + r.medianTurn);
  });
  if (failed.length) { console.error('FAIL: ' + failed.join('; ')); process.exit(1); }
  if (args.indexOf('--dry') === -1) {
    if (only) {
      // Keep the other jobs' entries when validating a subset.
      try { var old = require('../js/variants.js'); Object.keys(old).forEach(function (k) { if (!out[k]) out[k] = old[k]; }); } catch (e) { /* none yet */ }
    }
    writeVariants(out);
    console.log('wrote js/variants.js');
  }
}

main();
