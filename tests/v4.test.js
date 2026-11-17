// v4 mechanics: alert levels, the Tracer, switches, side files, loadout,
// Tunnel and Freeze.
var test = require('node:test');
var assert = require('node:assert');
var E = require('../js/engine.js');
var JOBS = require('../js/jobs.js');

function job(id) { return JOBS.filter(function (j) { return j.id === id; })[0]; }
function kinds(r) { return r.events.map(function (e) { return e.kind; }); }

test('alert: reaching the heat level spawns a Sentry at the end of the turn', function () {
  var g = E.newGame(job('job11'));
  var n = g.state.sentries.length;
  g.state.heat = 2;
  var r = E.endTurn(g);
  assert.ok(kinds(r).indexOf('alert') !== -1);
  assert.ok(kinds(r).indexOf('arrive') !== -1);
  assert.strictEqual(g.state.sentries.length, n + 1);
  var c = g.state.sentries.filter(function (s) { return s.id === 'C'; })[0];
  assert.ok(c && c.intent, 'the new Sentry has an intent right away');
  // Fires once.
  var r2 = E.endTurn(g);
  assert.strictEqual(kinds(r2).indexOf('alert'), -1);
});

test('alert: lockdown closes an opened barrier again', function () {
  var g = E.newGame(job('job11'));
  g.state.nodes.F.open = true;
  g.state.heat = 5;
  E.endTurn(g);
  assert.strictEqual(g.state.nodes.F.open, false);
});

test('Tracer arrives on its turn at ENTRY-side and walks the trail', function () {
  var g = E.newGame(job('job13'));
  assert.ok(!g.state.sentries.some(function (s) { return s.tracer; }), 'not on the board at the start');
  // Walk away from ENTRY for two turns.
  assert.ok(E.move(g, 'C').ok); assert.ok(E.move(g, 'B').ok); E.endTurn(g);
  assert.ok(E.move(g, 'I').ok); assert.ok(E.move(g, 'P').ok); E.endTurn(g);
  var t = g.state.sentries.filter(function (s) { return s.tracer; })[0];
  assert.ok(t, 'arrived by turn 3');
  assert.strictEqual(t.pos, 'E');
  assert.strictEqual(t.intent.type, 'move');
  assert.strictEqual(t.intent.target, 'C', 'next node on your trail');
  assert.strictEqual(t.intent.why, 'trail');
});

test('switch: stepping on it flips which links exist', function () {
  var g = E.newGame(job('job12'));
  assert.ok(E.neighbors(g, 'R2').indexOf('R3') !== -1);
  assert.ok(E.neighbors(g, 'R1').indexOf('R2') === -1);
  g.state.sentries.forEach(function (s) { if (s.pos === 'S') s.pos = 'K'; });
  g.state.player = 'I';
  var r = E.move(g, 'S');
  assert.ok(r.ok, r.reason);
  assert.ok(kinds(r).indexOf('flip') !== -1);
  assert.strictEqual(g.state.switches.S, 'b');
  assert.ok(E.neighbors(g, 'R2').indexOf('R3') === -1);
  assert.ok(E.neighbors(g, 'R1').indexOf('R2') !== -1);
  assert.ok(E.neighbors(g, 'R3').indexOf('O') !== -1);
  // Undo flips it back.
  E.undo(g);
  assert.strictEqual(g.state.switches.S, 'a');
});

test('side file: Extract pays and speeds the trace up', function () {
  var g = E.newGame(job('job11'));
  g.state.player = 'O';
  assert.ok(E.canExtract(g));
  var r = E.extract(g);
  assert.ok(r.ok);
  assert.ok(kinds(r).indexOf('file') !== -1);
  assert.strictEqual(g.state.breach, false, 'a side file does not start BREACH');
  assert.strictEqual(E.traceRate(g), 2);
  assert.ok(!E.canExtract(g), 'once per file');
  var p = E.payout(g);
  assert.ok(p.lines.some(function (l) { return l.id === 'files' && l.amount === E.FILE_VALUE; }));
});

test('loadout: the pick sets the programs; a bad pick falls back to the default', function () {
  var j = job('job14');
  var g = E.newGame(j, { loadout: ['sniff', 'spoof', 'tunnel', 'freeze', 'brute'] });
  assert.deepStrictEqual(Object.keys(g.state.charges).sort(), ['brute', 'freeze', 'sniff', 'spoof', 'tunnel']);
  var d = E.newGame(j, { loadout: ['sniff'] });
  assert.deepStrictEqual(Object.keys(d.state.charges).sort(), j.loadout.default.slice().sort());
});

test('Tunnel links you to a node 2 hops away; Freeze stalls nearby Sentries', function () {
  var j = job('job14');
  var g = E.newGame(j, { loadout: ['sniff', 'spoof', 'tunnel', 'freeze', 'brute'] });
  var t = E.programTargets(g, 'tunnel');
  assert.ok(t.length > 0);
  assert.ok(t.every(function (n) { return E.neighbors(g, g.state.player).indexOf(n) === -1; }));
  var r = E.runProgram(g, 'tunnel', t[0]);
  assert.ok(r.ok, r.reason);
  assert.ok(E.neighbors(g, g.state.player).indexOf(t[0]) !== -1);
  // Freeze: put a Sentry next to the player.
  var s = g.state.sentries.filter(function (x) { return !x.camera; })[0];
  s.pos = E.neighbors(g, g.state.player).filter(function (n) { return !E.sentryAt(g, n); })[0];
  assert.ok(E.canRun(g, 'freeze'));
  var f = E.runProgram(g, 'freeze');
  assert.ok(f.ok, f.reason);
  assert.strictEqual(s.intent.type, 'stunned');
});
