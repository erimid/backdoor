#!/usr/bin/env node
/*
 * Exhaustive solver for prototype jobs. Explores every sequence of player
 * actions (moves, programs, Extract, End turn, AI answers) with state
 * de-duplication, and reports whether each job can be won, the best star
 * count, and the cheapest win for each route through the board.
 *
 * Usage: node tools/solver.js [jobId] [allowedNodeIds|-] [program,program]
 *   e.g. node tools/solver.js job02 ERWUSV spoof,sniff
 */
var Engine = require('../js/engine.js');
var JOBS = require('../js/jobs.js');

// States that differ only in heat/detected are merged: keep the one that
// dominates (lower heat, and not detected if heat ties).
function key(st) {
  var s = Engine.clone(st);
  delete s.log; delete s.path; delete s.programsUsed; delete s.heat; delete s.detected;
  return JSON.stringify(s);
}
function rank(st) { return st.heat * 2 + (st.detected ? 1 : 0); }

function successors(game, opts) {
  opts = opts || {};
  var out = [];
  var st = game.state;
  function tryIt(label, fn) {
    var g = { job: game.job, state: Engine.clone(st), undoStack: [] };
    var r = fn(g);
    if (r.ok) out.push({ label: label, game: g });
  }
  if (st.ai && st.ai.pending) {
    tryIt('trust', function (g) { return Engine.answerAI(g, true); });
    tryIt('refuse', function (g) { return Engine.answerAI(g, false); });
    return out;
  }
  Engine.legalMoves(game).filter(function (n) { return !opts.nodes || opts.nodes.indexOf(n) !== -1; }).forEach(function (n) { tryIt('>' + n, function (g) { return Engine.move(g, n); }); });
  Object.keys(st.charges).forEach(function (p) {
    if (!st.charges[p]) return;
    if (opts.programs && opts.programs.indexOf(p) === -1) return;
    if (Engine.PROGRAMS[p].target === 'self') tryIt(p, function (g) { return Engine.runProgram(g, p); });
    else Engine.programTargets(game, p).forEach(function (t) {
      tryIt(p + '@' + t, function (g) { return Engine.runProgram(g, p, t); });
    });
  });
  if (Engine.canExtract(game)) tryIt('extract', function (g) { return Engine.extract(g); });
  tryIt('end', function (g) { return Engine.endTurn(g); });
  return out;
}

function solve(job, opts) {
  opts = opts || {};
  var start = Engine.newGame(job);
  var seen = new Map();
  var queue = [{ game: start, moves: [] }];
  seen.set(key(start.state), rank(start.state));
  var wins = [];
  var explored = 0;
  while (queue.length) {
    var cur = queue.shift();
    explored++;
    if (explored > (opts.limit || 3e6)) break;
    successors(cur.game, opts).forEach(function (s) {
      var st = s.game.state;
      var moves = cur.moves.concat([s.label]);
      if (st.status === 'won') { wins.push({ moves: moves, state: st, game: s.game }); return; }
      if (st.status !== 'playing') return;
      var k = key(st);
      var r = rank(st);
      if (seen.has(k) && seen.get(k) <= r) return;
      seen.set(k, r);
      queue.push({ game: s.game, moves: moves });
    });
  }
  return { explored: explored, wins: wins };
}

function routeOf(path) {
  // Compress the visited path to the set of distinctive nodes.
  var out = [];
  path.forEach(function (n) { if (out[out.length - 1] !== n) out.push(n); });
  return out.join('');
}

function summarize(job, opts) {
  var t0 = Date.now();
  var r = solve(job, opts);
  var best = 0;
  var byFeature = {};
  r.wins.forEach(function (w) {
    var stars = Engine.stars(w.game).count;
    if (stars > best) best = stars;
    var st = w.state;
    var tags = [];
    var p = st.path.join('');
    // Route heuristic: which key nodes were visited before reaching the target.
    var tgt = job.nodes.filter(function (n) { return n.type === 'target'; })[0].id;
    var toTarget = st.path.slice(0, st.path.indexOf(tgt) + 1);
    var via = job.nodes.filter(function (n) {
      return ['firewall', 'lock', 'honeypot', 'ai'].indexOf(n.type) !== -1 && toTarget.indexOf(n.id) !== -1;
    }).map(function (n) { return n.label; });
    if (st.ai && st.ai.trusted) via.push('trusted');
    if (st.ai && st.ai.refused) via.push('refused');
    var k = via.length ? via.join('+') : 'patrol-slip';
    var score = stars * 100 - st.heat;
    if (!byFeature[k] || score > byFeature[k].score) {
      byFeature[k] = { score: score, stars: stars, heat: st.heat, turns: st.turn, moves: w.moves.join(' '), path: routeOf(st.path) };
    }
  });
  console.log('== ' + job.id + ' ' + job.name + ': explored ' + r.explored + ' states, ' + r.wins.length + ' winning lines, best ' + best + ' stars (' + (Date.now() - t0) + ' ms)');
  Object.keys(byFeature).forEach(function (k) {
    var b = byFeature[k];
    console.log('  [' + k + '] best ' + b.stars + '★ heat ' + b.heat + ' turn ' + b.turns + '/' + job.turnLimit);
    console.log('     path ' + b.path);
    console.log('     ' + b.moves);
  });
  return { best: best, routes: byFeature, wins: r.wins.length };
}

if (require.main === module) {
  var want = process.argv[2];
  var nodes = process.argv[3] && process.argv[3] !== '-' ? process.argv[3].split('') : null;
  var programs = process.argv[4] ? process.argv[4].split(',') : null;
  JOBS.filter(function (j) { return !want || j.id === want; }).forEach(function (j) {
    if (nodes) console.log('restricted to nodes ' + nodes.join('') + (programs ? ' programs ' + programs : ''));
    summarize(j, { nodes: nodes, programs: programs });
  });
}

module.exports = { solve: solve, summarize: summarize };
