// Hex boards (Jobs 11 to 15): the map helper, six-way links, and the same
// fairness rules as the square jobs.
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../js/engine.js');
const JOBS = require('../js/jobs.js');

const HEX = JOBS.filter(j => j.layout === 'hex');
const key = (c, r) => c + ',' + r;

test('jobs 11 to 15 are hex boards and jobs 01 to 10 are not', () => {
  assert.deepEqual(HEX.map(j => j.id), ['job11', 'job12', 'job13', 'job14', 'job15']);
});

test('hex neighbours: six per cell, and touching is symmetric', () => {
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    const nb = JOBS.hexNeighbors(c, r);
    assert.equal(new Set(nb.map(q => key(q[0], q[1]))).size, 6);
    nb.forEach(q => assert.ok(JOBS.hexNeighbors(q[0], q[1]).some(p => p[0] === c && p[1] === r), key(c, r) + ' -> ' + key(q[0], q[1])));
  }
});

test('every hex job is well formed: links only between touching cells, bigger than the square boards', () => {
  HEX.forEach(j => {
    const by = Object.fromEntries(j.nodes.map(n => [n.id, n]));
    assert.equal(new Set(j.nodes.map(n => key(n.col, n.row))).size, j.nodes.length, j.id + ': two nodes share a cell');
    assert.ok(j.nodes.length > 20, j.id + ' should be bigger than a 4x5 board');
    assert.equal(j.nodes.filter(n => n.type === 'entry').length, 1, j.id);
    assert.equal(j.nodes.filter(n => n.type === 'target').length, 1, j.id);
    j.nodes.forEach(n => assert.ok(n.col >= 0 && n.col <= 4 && n.row >= 0 && n.row <= 7, j.id + ' ' + n.id + ' off the 5x8 board'));
    const seen = new Set();
    j.links.forEach(([a, b]) => {
      assert.ok(by[a] && by[b], j.id + ': link ' + a + '-' + b);
      const touch = JOBS.hexNeighbors(by[a].col, by[a].row).some(q => q[0] === by[b].col && q[1] === by[b].row);
      assert.ok(touch, j.id + ': ' + a + '-' + b + ' are not neighbours');
      const k = [a, b].sort().join('-');
      assert.ok(!seen.has(k), j.id + ': duplicate link ' + k); seen.add(k);
    });
    // Some node really uses the extra directions.
    const deg = {}; j.links.forEach(([a, b]) => { deg[a] = (deg[a] || 0) + 1; deg[b] = (deg[b] || 0) + 1; });
    assert.ok(Math.max.apply(null, Object.values(deg)) >= 5, j.id + ': no node has 5+ links');
    j.exits.forEach(x => assert.ok(by[x], j.id + ': exit ' + x));
    (j.clues || []).forEach(c => assert.ok(by[c.at] && by[c.opens], j.id + ': clue'));
  });
});

test('hex patrols step along links, and cameras sit still', () => {
  HEX.forEach(j => {
    const g = E.newGame(j);
    // Every link the map has (a switch may have some of them dark).
    const linked = (a, b) => j.links.some(l => (l[0] === a && l[1] === b) || (l[0] === b && l[1] === a));
    const extra = (j.alerts || []).filter(a => a.kind === 'spawn').map(a => a.sentry);
    j.sentries.concat(extra).forEach(s => {
      if (s.camera) { assert.deepEqual(s.patrol, [s.start]); return; }
      if (s.tracer) return; // a Tracer walks your trail, not a loop
      s.patrol.forEach((p, i) => {
        const q = s.patrol[(i + 1) % s.patrol.length];
        assert.ok(linked(p, q) || E.neighbors(g, p).indexOf(q) !== -1, j.id + ' Sentry ' + s.id + ': ' + p + ' -> ' + q);
      });
    });
  });
});

test('cuts remove a link that the map would otherwise draw', () => {
  const j = JOBS.find(x => x.id === 'job13');
  const g = E.newGame(j);
  assert.equal(E.neighbors(g, 'V').indexOf('S'), -1); // SWITCH touches GENOME but is walled off
  assert.ok(E.neighbors(g, 'V').indexOf('L') !== -1);
});
