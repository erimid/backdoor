// Rules added in v3: cameras, the new bonus objectives, start heat, the
// shortcut that closes at Extract, and the two-hunter pocket untangle.
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../js/engine.js');
const JOBS = require('../js/jobs.js');
const B = require('../tools/beam.js');

const job = id => JOBS.find(j => j.id === id);
const sentry = (g, id) => g.state.sentries.find(s => s.id === id);
function setup(j, fn, opts) { const g = E.newGame(j, opts); fn(g.state, g); E.replan(g); return g; }
function ok(r) { assert.ok(r.ok, r.reason); return r; }

test('there are ten jobs, numbered in order', () => {
  assert.equal(JOBS.length, 10);
  JOBS.forEach((j, i) => {
    assert.equal(j.id, 'job' + String(i + 1).padStart(2, '0'));
    assert.equal(j.number, String(i + 1).padStart(2, '0'));
  });
});

test('every job is well formed: links between real, neighbouring cells, one entry and one target', () => {
  JOBS.forEach(j => {
    const by = Object.fromEntries(j.nodes.map(n => [n.id, n]));
    const cells = new Set(j.nodes.map(n => n.col + ',' + n.row));
    assert.equal(cells.size, j.nodes.length, j.id + ': two nodes share a cell');
    assert.equal(j.nodes.filter(n => n.type === 'entry').length, 1, j.id);
    assert.equal(j.nodes.filter(n => n.type === 'target').length, 1, j.id);
    j.nodes.forEach(n => assert.ok(n.col >= 0 && n.col <= 3 && n.row >= 0 && n.row <= 4, j.id + ' ' + n.id + ' off the 4x5 board'));
    j.links.forEach(([a, b]) => {
      assert.ok(by[a] && by[b], j.id + ': link ' + a + '-' + b);
      assert.ok(Math.abs(by[a].row - by[b].row) <= 1, j.id + ': link ' + a + '-' + b + ' skips a row');
    });
    j.exits.forEach(x => assert.ok(by[x], j.id + ': exit ' + x));
    j.sentries.forEach(s => s.patrol.forEach(p => assert.ok(by[p], j.id + ': patrol ' + p)));
  });
});

test('a camera never moves and scans you only if you end a turn on a node linked to it', () => {
  const j = job('job03'); // camera X on CAM-02 (linked to WASHER-1, ROUTER, SWITCH, WIFI)
  const g = setup(j, st => { st.player = 'A'; });
  const x = sentry(g, 'X');
  assert.equal(x.intent.type, 'watch');
  assert.deepEqual(x.intent.nodes.slice().sort(), ['A', 'C', 'S', 'W']);
  assert.deepEqual(E.threats(g).map(t => t.sentry), ['X']);
  // Stay put: scanned, +3 heat, and the camera rests next phase.
  let r = ok(E.endTurn(g));
  assert.ok(r.events.some(e => e.kind === 'scan' && e.sentry === 'X' && e.hit));
  assert.equal(g.state.heat, 3);
  assert.equal(x.pos, 'K');
  assert.deepEqual(sentry(g, 'X').intent, { type: 'wait', why: 'rest', atPlayer: false });
  // Step off its zone: no scan.
  const h = setup(j, st => { st.player = 'A'; });
  ok(E.move(h, 'B'));
  r = ok(E.endTurn(h));
  assert.ok(!r.events.some(e => e.kind === 'scan' && e.sentry === 'X'));
  assert.equal(h.state.heat, 0);
  // Spoof holds against a camera too.
  const s = setup(j, st => { st.player = 'A'; });
  ok(E.runProgram(s, 'spoof'));
  ok(E.endTurn(s));
  assert.equal(s.state.heat, 0);
});

test('cameras ignore decoys and noise, and BREACH does not move them', () => {
  const j = job('job10'); // three cameras, one guard
  const g = setup(j, st => { st.player = 'W'; });
  ok(E.runProgram(g, 'decoy', 'B'));
  ['X', 'Y', 'Z'].forEach(id => assert.equal(sentry(g, id).lure, null));
  const h = setup(j, st => { st.player = 'O'; st.hasData = true; st.breach = true; st.exit = 'C'; st.sentries.forEach(s => { if (!s.camera) s.pos = 'K'; }); });
  ['X', 'Y', 'Z'].forEach(id => assert.notEqual(sentry(h, id).intent.type, 'move'));
});

test('new bonus objectives', () => {
  // greedy: every $ cache taken (bag cash included)
  const j3 = job('job03');
  const g = E.newGame(j3);
  assert.equal(E.bonusMet(g), false);
  g.job.nodes.filter(n => n.cache && n.cache.kind === 'cash').forEach(n => { g.state.taken[n.id] = true; });
  assert.equal(E.bonusMet(g), true);
  // quiet: no Brute
  const g6 = E.newGame(job('job06'));
  assert.equal(E.bonusMet(g6), true);
  g6.state.programsUsed.push('brute');
  assert.equal(E.bonusMet(g6), false);
  // speed: out by the bonus turn
  const gA = E.newGame(job('job09'));
  gA.state.turn = job('job09').bonus.turn;
  assert.equal(E.bonusMet(gA), true);
  gA.state.turn += 1;
  assert.equal(E.bonusMet(gA), false);
  // cool: heat at or under the bonus heat
  const g9 = E.newGame(job('job10'));
  g9.state.heat = job('job10').bonus.heat;
  assert.equal(E.bonusMet(g9), true);
  g9.state.heat += 1;
  assert.equal(E.bonusMet(g9), false);
});

test('Job 09 starts hot', () => {
  assert.equal(E.newGame(job('job09')).state.heat, 2);
  assert.equal(E.newGame(job('job01')).state.heat, 0);
});

test('a shortcut marked untilExtract closes when you Extract', () => {
  const j = job('job02');
  const g = setup(j, st => { st.player = 'V'; st.ai.trusted = true; st.ai.deals = 1; st.ai.answers.shortcut = 'trusted'; st.extraLinks.push(['U', 'S']); });
  assert.ok(E.neighbors(g, 'S').includes('U'));
  const r = ok(E.extract(g));
  assert.ok(r.events.some(e => e.kind === 'ai' && e.closed));
  assert.ok(!E.neighbors(g, 'S').includes('U'));
});

test('two hunters in a one-door pocket untangle: the doorway opens within 3 enemy phases (fuzz)', () => {
  // v2 limit (README rule 11): with ENTRY burned, two hunters could hold
  // CAM-03 or KIOSK shut indefinitely. Seeded random play into BREACH on
  // every shipped night, heat and turn held down so only Sentries matter.
  const V = require('../js/variants.js');
  let seed = 7;
  const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return Math.floor(seed / 0x80000000 * n); };
  let checked = 0;
  for (const j of JOBS) {
    const t = V[j.id] || { par: j.payout.par, variants: [E.canonicalVariant(j)] };
    for (let i = 0; i < 150; i++) {
      const g = E.newGame(j, { variant: t.variants[rnd(t.variants.length)], par: t.par }); g.state.log = [];
      const trust = rnd(2) === 0;
      for (let k = 0; k < 60 && g.state.status === 'playing'; k++) {
        const st = g.state; st.heat = Math.min(st.heat, 5); st.turn = Math.min(st.turn, 3);
        if (st.ai && st.ai.pending) { E.answerAI(g, trust); continue; }
        const acts = B.actionLabels(g);
        if (acts.includes('extract')) { B.apply(g, 'extract'); continue; }
        if (!acts.length || rnd(3) === 0) {
          E.endTurn(g);
          if (g.state.status !== 'playing' || !g.state.breach) continue;
          const h = B.copy(g); let phases = 0;
          while (!E.legalMoves(h).length && phases <= 4) {
            h.state.heat = 0; h.state.turn = 1;
            if (h.state.ai && h.state.ai.pending) E.answerAI(h, false);
            E.endTurn(h); phases++;
          }
          checked++;
          assert.ok(phases <= 3, `${j.id} ${g.job.variantId}: boxed in for ${phases}+ phases at ${g.state.player}`);
          continue;
        }
        B.apply(g, acts[rnd(acts.length)]);
      }
    }
  }
  assert.ok(checked > 1000, 'enough positions checked (' + checked + ')');
});
