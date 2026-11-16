// Pure parts of js/meta.js (WP4): seeded night picks, the store, so-close text, CSV.
const test = require('node:test');
const assert = require('node:assert');

const E = require('../js/engine.js');
const JOBS = require('../js/jobs.js');
const Meta = require('../js/meta.js');

function fresh(variants) {
  globalThis.BACKDOOR_VARIANTS = variants;
  delete globalThis.localStorage;
  const mem = {};
  globalThis.localStorage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
  Meta.init({ E, JOBS });
  return mem;
}
function fakeTable(n) {
  const mk = (job, k) => Object.assign(E.canonicalVariant(job), { id: 'v' + String(k).padStart(2, '0') });
  return {
    job01: { par: 470, variants: Array.from({ length: n }, (_, k) => mk(JOBS[0], k)) },
    job02: { par: 820, variants: Array.from({ length: n }, (_, k) => mk(JOBS[1], k)) }
  };
}
function play(game, line) {
  for (const m of line.split(' ')) {
    let r;
    if (m === 'end') r = E.endTurn(game);
    else if (m === 'extract') r = E.extract(game);
    else if (m === 'trust' || m === 'refuse') r = E.answerAI(game, m === 'trust');
    else if (m[0] === '>') r = E.move(game, m.slice(1));
    else { const [p, t] = m.split('@'); r = E.runProgram(game, p, t); }
    assert.ok(r.ok, m + ': ' + r.reason);
  }
  return game;
}
const WIN01 = '>C end >G >V end extract >G >C end >D';

test('first-ever start is canonical, labelled Tutorial night', () => {
  fresh(fakeTable(12));
  for (const mode of ['tonight', 'new', 'same']) {
    const p = Meta.pick('job01', mode);
    assert.strictEqual(p.index, 0);
    assert.strictEqual(p.label, 'Tutorial night');
    assert.strictEqual(p.par, 470);
    assert.strictEqual(p.variant.id, 'v00');
  }
});

test('tonight is deterministic per date and job; new differs from last', () => {
  fresh(fakeTable(12));
  Meta.store().wins.job01 = 1;
  const d = new Date(2026, 10, 16, 21, 0);
  const a = Meta.pick('job01', 'tonight', d);
  const b = Meta.pick('job01', 'tonight', new Date(2026, 10, 16, 3, 0));
  assert.strictEqual(a.index, b.index);
  assert.match(a.label, /^Night 11\/16 · #\d\d$/);
  const spread = new Set();
  for (let day = 1; day <= 28; day++) spread.add(Meta.pick('job01', 'tonight', new Date(2026, 1, day)).index);
  assert.ok(spread.size >= 5, 'tonight varies across dates: ' + spread.size);
  const last = Meta.pick('job01', 'tonight', d).index;
  Meta.store().lastPick.job01 = last;
  for (let i = 0; i < 40; i++) {
    Meta.store().lastPick.job01 = last;
    assert.notStrictEqual(Meta.pick('job01', 'new', d).index, last);
  }
  Meta.store().lastPick.job01 = 5;
  assert.strictEqual(Meta.pick('job01', 'same', d).index, 5);
  assert.strictEqual(Meta.pick('job01', 'canonical', d).index, 0);
});

test('missing BACKDOOR_VARIANTS falls back to canonical-only with job par', () => {
  fresh(undefined);
  Meta.store().wins.job02 = 3;
  const p = Meta.pick('job02', 'new');
  assert.strictEqual(p.index, 0);
  assert.strictEqual(p.par, JOBS[1].payout.par);
  assert.deepStrictEqual(p.variant, E.canonicalVariant(JOBS[1]));
});

test('finish: win stores best/wins, NEW BEST, CSV has payout and variant', () => {
  const mem = fresh(fakeTable(4));
  const p = Meta.pick('job01', 'tonight');
  const g = play(E.newGame(JOBS[0], { variant: p.variant, par: p.par }), WIN01);
  const run = Meta.finish(g, p, { deals: 0 });
  assert.strictEqual(run.won, true);
  assert.strictEqual(run.payout, E.payout(g).total);
  assert.strictEqual(run.variant, 'v00');
  assert.strictEqual(run.newBest, true);
  assert.strictEqual(run.stars, 3);
  assert.strictEqual(Meta.store().wins.job01, 1);
  assert.strictEqual(Meta.store().best.job01.payout, run.payout);
  assert.ok(JSON.parse(mem['backdoor.proto.v2']).runs.length === 1);
  const csv = Meta.logCsv().split('\n');
  const cols = csv[0].split(',');
  assert.ok(cols.includes('payout') && cols.includes('variant') && cols.includes('deals'));
  const row = csv[1].split(',');
  assert.strictEqual(row[cols.indexOf('payout')], String(run.payout));
  assert.strictEqual(row[cols.indexOf('variant')], 'v00');
  // same payout again is not a new best
  const g2 = play(E.newGame(JOBS[0], { variant: p.variant, par: p.par }), WIN01);
  assert.strictEqual(Meta.finish(g2, p, {}).newBest, false);
  // board shows New night after a win
  assert.match(Meta.renderSelect(), /data-act="new-night" data-job="job01"/);
  assert.doesNotMatch(Meta.renderSelect(), /data-act="new-night" data-job="job02"/);
});

test('so-close text: traced with data, hops to exit', () => {
  fresh(fakeTable(1));
  const g = play(E.newGame(JOBS[0]), '>C end >G >V end extract');
  g.state.heat = 9; // force a trace on the next hit
  // walk into the Sentry's scan ring until traced
  let guard = 0;
  while (g.state.status === 'playing' && guard++ < 10) E.endTurn(g);
  assert.strictEqual(g.state.status, 'lost');
  const c = Meta.closeInfo(g, {});
  assert.ok(c.hasData);
  assert.match(c.text, /hops? from the exit with the data\./);
  if (g.state.reason === 'traced') assert.match(c.text, /and you walk\.|One turn faster/);
});

test('so-close text: dropped without data names the target', () => {
  fresh(fakeTable(1));
  const g = E.newGame(JOBS[0]);
  let guard = 0;
  while (g.state.status === 'playing' && guard++ < 20) E.endTurn(g);
  assert.strictEqual(g.state.reason, 'dropped');
  const c = Meta.closeInfo(g, {});
  assert.strictEqual(c.text, 'Out of time 3 hops from SALES DB.');
});

test('v1 runs migrate once', () => {
  globalThis.BACKDOOR_VARIANTS = undefined;
  const mem = { 'backdoor.proto.v1': JSON.stringify({ best: { job01: 2 }, runs: [{ when: 'x', job: 'job01', won: true, reason: 'escaped', stars: 2, heat: 3, turns: 9, route: 'ENTRY', programs: [], ai: '', again: true, note: 'hi' }] }) };
  globalThis.localStorage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
  Meta.init({ E, JOBS });
  assert.strictEqual(Meta.store().runs.length, 1);
  assert.strictEqual(Meta.store().runs[0].variant, 'v1');
  assert.ok(!Meta.store().wins.job01, 'v1 wins do not unlock New night');
  Meta.init({ E, JOBS });
  assert.strictEqual(Meta.store().runs.length, 1);
});
