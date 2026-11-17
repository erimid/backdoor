#!/usr/bin/env node
/*
 * Turn-level beam search over the real engine (js/engine.js).
 *
 * Dev tool only: never loaded in the browser. tools/validate.js uses it to
 * prove every seeded variant is winnable and to record a witness line.
 *
 * Each beam step is one whole turn. For every state in the beam we expand
 * every plan of up to st.actions actions (2, or 3 when overclocked), with an
 * "end turn early" option at every depth, then run the enemy phase. An AI
 * offer branches on trust and refuse. Turn results are de-duplicated, ranked
 * by a distance-to-goal heuristic and the best K survive to the next turn.
 *
 * API:
 *   solve(job, { variant, par, K, forbid: [nodeIds], want: 'stars'|'payout' })
 *     -> null or { won, stars, bonus, payout, turn, heat, moves, path, routeKey }
 *   moves is a space-separated list of labels:
 *     '>X' 'sniff' 'spoof' 'decoy@X' 'worm@X' 'brute@X' 'extract' 'end' 'trust' 'refuse'
 *   (the same format tools/smoke.js plays through the UI).
 *
 * CLI: node tools/beam.js [jobId] [K]   (canonical variant of each job)
 */
var E = require('../js/engine.js');

// ---------- small helpers shared by the other tools ----------

// A cheap copy of a game for search: drops the event log (it only grows) and
// the undo history.
function copy(game) {
  var log = game.state.log;
  game.state.log = [];
  var st = E.clone(game.state);
  game.state.log = log;
  return { job: game.job, state: st, undoStack: [], par: game.par };
}

function entryOf(job) { return job.nodes.filter(function (n) { return n.type === 'entry'; })[0].id; }
function targetOf(job) { return job.nodes.filter(function (n) { return n.type === 'target'; })[0].id; }

// Applies one label to a game in place. Returns the engine result.
function apply(game, label) {
  if (label === 'end') return E.endTurn(game);
  if (label === 'extract') return E.extract(game);
  if (label === 'trust') return E.answerAI(game, true);
  if (label === 'refuse') return E.answerAI(game, false);
  if (label[0] === '>') return E.move(game, label.slice(1));
  var parts = label.split('@');
  return E.runProgram(game, parts[0], parts[1]);
}

// Every legal single action from this state (not 'end'), as labels.
// opts.forbid: node ids the player may not enter before Extract.
function actionLabels(game, opts) {
  var st = game.state; var out = [];
  if (st.status !== 'playing') return out;
  if (st.ai && st.ai.pending) return ['trust', 'refuse'];
  var forbid = (opts && opts.forbid) || null;
  E.legalMoves(game).forEach(function (n) {
    if (forbid && !st.hasData && forbid.indexOf(n) !== -1) return;
    out.push('>' + n);
  });
  Object.keys(st.charges).forEach(function (p) {
    if (!st.charges[p]) return;
    if (E.PROGRAMS[p].target === 'self') { if (E.canRun(game, p)) out.push(p); }
    else E.programTargets(game, p).forEach(function (t) { out.push(p + '@' + t); });
  });
  if (E.canExtract(game)) out.push('extract');
  return out;
}

// Inbound nodes (entered before Extract), from a label list.
function inbound(labels) {
  var out = [];
  for (var i = 0; i < labels.length; i++) {
    if (labels[i] === 'extract') break;
    if (labels[i][0] === '>') out.push(labels[i].slice(1));
  }
  return out;
}

var KEY_TYPES = ['firewall', 'lock', 'ai', 'honeypot'];

// Route class of a line: sorted labels of firewall/lock/AI/honeypot nodes
// visited before Extract (plus 'trusted' if the AI shortcut was taken), or 'slip'.
function routeKey(job, labels, st) {
  var seen = {};
  inbound(labels).forEach(function (id) {
    var d = E.nodeDef(job, id);
    if (d && KEY_TYPES.indexOf(d.type) !== -1) seen[d.label] = true;
  });
  var keys = Object.keys(seen).sort();
  if (st && st.ai && st.ai.trusted) keys.push('trusted');
  return keys.length ? keys.join('+') : 'slip';
}

// The node to forbid for the "second route" check: the first barrier/AI/
// honeypot node on the inbound path, else the first inbound node after ENTRY.
function keyNode(job, labels) {
  var path = inbound(labels);
  var entry = entryOf(job);
  for (var i = 0; i < path.length; i++) {
    var d = E.nodeDef(job, path[i]);
    if (d && KEY_TYPES.indexOf(d.type) !== -1) return path[i];
  }
  for (var j = 0; j < path.length; j++) if (path[j] !== entry) return path[j];
  return null;
}

// ---------- heuristic ----------

// Weighted BFS distance from the player to the goal: the target before
// Extract (+6 for the trip out), the real exit after it. Closed barriers cost
// +2. Before Extract the trip out goes to the nearer exit candidate (or the
// known one once Sniff revealed it).
function distances(game, from) {
  var d = {}; d[from] = 0;
  var q = [from];
  while (q.length) {
    var x = q.shift();
    E.neighbors(game, x).forEach(function (y) {
      var c = d[x] + 1 + (E.isClosed(game, y) ? 2 : 0);
      if (d[y] === undefined || c < d[y]) { d[y] = c; q.push(y); }
    });
  }
  return d;
}

function dist(game) {
  var st = game.state; var job = game.job;
  var d = distances(game, st.player);
  if (st.hasData) { var de = d[st.exit]; return de === undefined ? 20 : de; }
  var tgt = targetOf(job);
  var dt = d[tgt] === undefined ? 20 : d[tgt];
  var fromT = distances(game, tgt);
  var cands = st.exitKnown ? [job.exits[job.exitIndex]] : job.exits;
  var out = Math.min.apply(null, cands.map(function (x) { return fromT[x] === undefined ? 20 : fromT[x]; }));
  return dt + 6 + out;
}

// Lower is better. The spec's 3*dist + heat + 4*detected - cash/50, plus 5
// per AI deal taken (a 25% cut is worth about 5 heat in dollars), so trusting
// UNKNOWN is never free in the ranking.
function rank(game) {
  var st = game.state;
  return 3 * dist(game) + st.heat + (st.detected ? 4 : 0) - st.cash / 50 + (st.ai ? 5 * st.ai.deals : 0);
}

// De-duplication key for end-of-turn states (the turn is the same for all).
function stateKey(st) {
  return JSON.stringify([st.player, st.hasData, st.breach, st.exitKnown, st.sentries, st.nodes, st.charges,
    st.taken, st.cash, st.heat, st.detected, st.ai, st.actions, st.wormStuns, st.extraLinks.length]);
}

// ---------- search ----------

// All results of one turn from `game`: won games, and games after End turn.
// Each result carries its labels for the turn.
function turnPlans(game, opts) {
  var out = [];
  var seenMid = new Set();
  function rec(g, labels) {
    var st = g.state;
    if (st.status === 'won') { out.push({ game: g, labels: labels }); return; }
    if (st.status !== 'playing') return;
    var mk = JSON.stringify([st.player, st.actions, st.nodes, st.sentries, st.charges, st.ai, st.spoof, st.heat,
      st.hasData, st.exitKnown, st.taken, st.cash, st.extraLinks.length, st.detected, st.wormStuns]);
    if (seenMid.has(mk)) return;
    seenMid.add(mk);
    if (!(st.ai && st.ai.pending)) {
      var h = copy(g);
      if (E.endTurn(h).ok && h.state.status === 'playing') out.push({ game: h, labels: labels.concat('end') });
    }
    actionLabels(g, opts).forEach(function (a) {
      var h2 = copy(g);
      if (apply(h2, a).ok) rec(h2, labels.concat(a));
    });
  }
  rec(game, []);
  return out;
}

function better(a, b, want) {
  if (!b) return true;
  if (want === 'payout') {
    if (a.bonus !== b.bonus) return a.bonus;
    if (a.payout !== b.payout) return a.payout > b.payout;
    if (a.stars !== b.stars) return a.stars > b.stars;
    if (a.turn !== b.turn) return a.turn < b.turn;
    return a.unused < b.unused;
  }
  if (a.stars !== b.stars) return a.stars > b.stars;
  if (a.payout !== b.payout) return a.payout > b.payout;
  if (a.turn !== b.turn) return a.turn < b.turn;
  return a.unused < b.unused;
}

// Action slots a line leaves unspent at its turn ends (the validator's
// "unused slots" measure). Ties between equally good lines go to the one
// that idles less, so the witness shows a line that doesn't have to wait
// when one exists.
function unusedSlots(job, opts, labels) {
  var g = E.newGame(job, { variant: opts.variant, par: opts.par }); g.state.log = [];
  var n = 0;
  for (var i = 0; i < labels.length && g.state.status === 'playing'; i++) {
    if (labels[i] === 'end') n += g.state.actions;
    apply(g, labels[i]);
  }
  return n;
}

// Keeps the best K by rank. The bonus objective isn't in the rank, so when
// the caller wants stars or payout, a third of the slots are reserved for
// states that already meet the bonus (e.g. a Worm stun that cost a detour),
// so cheap-but-bonusless states can't crowd them out.
function prune(next, K, want) {
  next.sort(function (a, b) { return a.score - b.score; });
  if (!want || next.length <= K) return next.slice(0, K);
  var keep = []; var used = new Set();
  var share = Math.ceil(K / 3);
  for (var i = 0; i < next.length && keep.length < share; i++) {
    if (E.bonusMet(next[i].game)) { keep.push(next[i]); used.add(i); }
  }
  for (var j = 0; j < next.length && keep.length < K; j++) if (!used.has(j)) keep.push(next[j]);
  return keep.sort(function (a, b) { return a.score - b.score; });
}

function search(job, opts) {
  var K = opts.K || 60;
  var want = opts.want || 'stars';
  var start = E.newGame(job, { variant: opts.variant, par: opts.par });
  start.state.log = [];
  var beam = [{ game: start, labels: [] }];
  var best = null;
  for (var t = 0; t < start.job.turnLimit && beam.length; t++) {
    var next = []; var seen = new Set();
    beam.forEach(function (b) {
      turnPlans(b.game, opts).forEach(function (p) {
        var g = p.game; var st = g.state;
        var labels = b.labels.concat(p.labels);
        if (st.status === 'won') {
          var s = E.stars(g);
          var r = {
            won: true, stars: s.count, bonus: !!s.bonus, payout: E.payout(g).total, turn: st.turn, heat: st.heat,
            moves: labels.join(' '), path: st.path.join(''), routeKey: routeKey(g.job, labels, st)
          };
          if (best && r.bonus === best.bonus && r.payout === best.payout && r.stars === best.stars && r.turn === best.turn) {
            r.unused = unusedSlots(job, opts, labels);
            if (best.unused === undefined) best.unused = unusedSlots(job, opts, best.moves.split(' '));
          }
          if (better(r, best, want)) best = r;
          return;
        }
        var k = stateKey(st);
        if (seen.has(k)) return;
        seen.add(k);
        next.push({ game: g, labels: labels, score: rank(g) });
      });
    });
    beam = prune(next, K, want);
  }
  return best;
}

// Good enough = a win that meets what was asked for.
function satisfied(r, opts) {
  if (!r) return false;
  if (opts.want === 'payout') return r.bonus;
  if (opts.want === 'stars') return r.stars === 3;
  return true;
}

// Tries K=60 (or opts.K), then K=150 if that doesn't satisfy the request.
function solve(job, opts) {
  opts = Object.assign({ want: 'stars' }, opts || {});
  var Ks = opts.K ? [opts.K] : [60, 150];
  var best = null;
  for (var i = 0; i < Ks.length; i++) {
    var r = search(job, Object.assign({}, opts, { K: Ks[i] }));
    if (r && better(r, best, opts.want)) best = r;
    if (satisfied(best, opts)) break;
  }
  if (best) best.K = Ks[Math.min(i, Ks.length - 1)];
  return best;
}

module.exports = {
  solve: solve, search: search, turnPlans: turnPlans, apply: apply, actionLabels: actionLabels, copy: copy,
  routeKey: routeKey, keyNode: keyNode, inbound: inbound, dist: dist, rank: rank, entryOf: entryOf, targetOf: targetOf
};

if (require.main === module) {
  var JOBS = require('../js/jobs.js');
  var want = process.argv[2];
  var K = +process.argv[3] || 0;
  JOBS.filter(function (j) { return !want || j.id === want; }).forEach(function (j) {
    var t0 = Date.now();
    var r = solve(j, { K: K || undefined, want: 'stars' });
    console.log(j.id + ' (' + (Date.now() - t0) + ' ms): ' + JSON.stringify(r));
  });
}
