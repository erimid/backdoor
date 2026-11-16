#!/usr/bin/env node
/*
 * Exhaustive solver for prototype jobs (v2 rules). Breadth-first search over
 * every sequence of player actions (moves, programs, Extract, End turn, AI
 * answers) with state de-duplication. Reports whether each job can be won and
 * the best payout and stars for each route through the board.
 *
 * The state key covers everything that matters to the future of the game
 * (turn, actions and overclock bank, position, data, cash and taken caches,
 * BREACH and the exit, nodes, Sentries with their lure/noise, charges, AI
 * answers and deals). States that differ only in heat/detected are merged:
 * the one with lower heat (then not detected) wins, as in v1.
 *
 * Usage: node tools/solver.js [jobId] [allowedNodeIds|-] [program,program] [--variant N] [--limit N]
 *   e.g. node tools/solver.js job02 ERWUSVPM spoof,sniff
 * Job 02 is too big to search unrestricted; give it a node list.
 */
var crypto = require('crypto');
var E = require('../js/engine.js');
var JOBS = require('../js/jobs.js');
var B = require('./beam.js');

function key(st) {
  var s = Object.assign({}, st);
  delete s.log; delete s.path; delete s.programsUsed; delete s.heat; delete s.detected;
  delete s.par; delete s.variantId;
  return crypto.createHash('sha1').update(JSON.stringify(s)).digest('base64');
}
function rank(st) { return st.heat * 2 + (st.detected ? 1 : 0); }

// Labels of every successor, filtered by the route restriction.
function labels(game, opts) {
  var st = game.state;
  if (st.ai && st.ai.pending) return ['trust', 'refuse'];
  return B.actionLabels(game).filter(function (l) {
    if (l[0] === '>') return !opts.nodes || opts.nodes.indexOf(l.slice(1)) !== -1;
    if (l === 'extract') return true;
    var p = l.split('@')[0];
    return !opts.programs || opts.programs.indexOf(p) !== -1;
  }).concat('end');
}

function solve(job, opts) {
  opts = opts || {};
  var start = E.newGame(job, { variant: opts.variant, par: opts.par });
  start.state.log = [];
  var resolved = start.job;
  // Search nodes are stored as JSON strings plus parent pointers, to keep memory flat.
  var states = [JSON.stringify(start.state)], parent = [-1], label = [null];
  var seen = new Map();
  seen.set(key(start.state), rank(start.state));
  var wins = [];
  var head = 0;
  var limit = opts.limit || 2e6;
  while (head < states.length && head < limit) {
    var idx = head++;
    var st0 = JSON.parse(states[idx]);
    states[idx] = null; // free it; only parent pointers are needed from here on
    var game = { job: resolved, state: st0, undoStack: [], par: opts.par };
    labels(game, opts).forEach(function (l) {
      var g = { job: resolved, state: E.clone(st0), undoStack: [], par: opts.par };
      if (!B.apply(g, l).ok) return;
      var st = g.state;
      st.log = [];
      if (st.status === 'won') { wins.push({ parent: idx, label: l, game: g }); return; }
      if (st.status !== 'playing') return;
      var k = key(st); var r = rank(st);
      if (seen.has(k) && seen.get(k) <= r) return;
      seen.set(k, r);
      states.push(JSON.stringify(st)); parent.push(idx); label.push(l);
    });
  }
  function movesOf(w) {
    var out = [w.label]; var i = w.parent;
    while (i > 0) { out.push(label[i]); i = parent[i]; }
    return out.reverse();
  }
  wins.forEach(function (w) { w.moves = movesOf(w); w.state = w.game.state; });
  return { explored: head, complete: head >= states.length, wins: wins, job: resolved };
}

function summarize(job, opts) {
  opts = opts || {};
  var t0 = Date.now();
  var r = solve(job, opts);
  var best = 0;
  var byRoute = {};
  r.wins.forEach(function (w) {
    var s = E.stars(w.game).count;
    var pay = E.payout(w.game).total;
    if (s > best) best = s;
    var k = B.routeKey(r.job, w.moves, w.state);
    var score = s * 10000 + pay;
    if (!byRoute[k] || score > byRoute[k].score) {
      byRoute[k] = { score: score, stars: s, payout: pay, heat: w.state.heat, turn: w.state.turn, moves: w.moves.join(' '), path: w.state.path.join('') };
    }
  });
  var par = opts.par || r.job.payout.par;
  console.log('== ' + job.id + ' ' + job.name + ': explored ' + r.explored + ' states' + (r.complete ? '' : ' (hit the limit)') +
    ', ' + r.wins.length + ' winning lines, best ' + best + '★ at par $' + par + ' (' + (Date.now() - t0) + ' ms)');
  Object.keys(byRoute).sort().forEach(function (k) {
    var b = byRoute[k];
    console.log('  [' + k + '] best ' + b.stars + '★ $' + b.payout + ' heat ' + b.heat + ' turn ' + b.turn + '/' + r.job.turnLimit);
    console.log('     path ' + b.path);
    console.log('     ' + b.moves);
  });
  return { best: best, routes: byRoute, wins: r.wins.length, complete: r.complete };
}

if (require.main === module) {
  var args = process.argv.slice(2);
  function arg(name) { var i = args.indexOf(name); if (i === -1) return null; var v = args[i + 1]; args.splice(i, 2); return v; }
  var vIndex = arg('--variant');
  var limit = arg('--limit');
  var want = args[0];
  var nodes = args[1] && args[1] !== '-' ? args[1].split('') : null;
  var programs = args[2] ? args[2].split(',') : null;
  var VARIANTS = null;
  try { VARIANTS = require('../js/variants.js'); } catch (e) { VARIANTS = null; }
  JOBS.filter(function (j) { return !want || j.id === want; }).forEach(function (j) {
    var t = VARIANTS && VARIANTS[j.id];
    var opts = { nodes: nodes, programs: programs, limit: limit ? +limit : undefined, par: t ? t.par : undefined };
    if (t && vIndex !== null) opts.variant = t.variants[+vIndex];
    if (!nodes && j.id === 'job02' && !want) {
      // Unrestricted Job 02 is too big; show the main routes instead.
      [['ERWUSVPM', null], ['ECMAKOVPRW', null], ['ERWFSVPM', null], ['ERPQTHSVM', null]].forEach(function (r) {
        console.log('restricted to nodes ' + r[0]);
        summarize(j, Object.assign({}, opts, { nodes: r[0].split('') }));
      });
      return;
    }
    if (nodes) console.log('restricted to nodes ' + nodes.join('') + (programs ? ' programs ' + programs : ''));
    summarize(j, opts);
  });
}

module.exports = { solve: solve, summarize: summarize, key: key };
