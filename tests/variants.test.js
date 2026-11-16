// Replays every witness line in js/variants.js through the engine API.
// Run with: node --test (npm test). Regenerate the table with npm run validate.
const test = require('node:test');
const assert = require('node:assert');
const E = require('../js/engine.js');
const JOBS = require('../js/jobs.js');
const VARIANTS = require('../js/variants.js');

function play(game, label) {
  if (label === 'end') return E.endTurn(game);
  if (label === 'extract') return E.extract(game);
  if (label === 'trust') return E.answerAI(game, true);
  if (label === 'refuse') return E.answerAI(game, false);
  if (label[0] === '>') return E.move(game, label.slice(1));
  const [prog, target] = label.split('@');
  return E.runProgram(game, prog, target);
}

test('variants table covers every job, canonical first', () => {
  JOBS.forEach(job => {
    const t = VARIANTS[job.id];
    assert.ok(t, 'no variants for ' + job.id);
    assert.ok(t.par > 0, job.id + ' par');
    assert.ok(t.variants.length > 0);
    const c = E.canonicalVariant(job);
    const v0 = t.variants[0];
    assert.strictEqual(v0.id, 'v00');
    assert.deepStrictEqual([v0.bag, v0.offsets, v0.exit], [c.bag, c.offsets, c.exit], job.id + ' v00 is canonical');
    const ids = new Set(t.variants.map(v => v.id));
    assert.strictEqual(ids.size, t.variants.length, 'variant ids are unique');
  });
});

JOBS.forEach(job => {
  const t = VARIANTS[job.id];
  if (!t) return;
  test(job.id + ': every witness replays to a win (' + t.variants.length + ' variants)', () => {
    t.variants.forEach(v => {
      const game = E.newGame(job, { variant: v, par: t.par });
      v.witness.split(' ').forEach((m, i) => {
        assert.strictEqual(game.state.status, 'playing', job.id + ' ' + v.id + ': game ended before step ' + i + ' (' + m + ')');
        const r = play(game, m);
        assert.ok(r.ok, job.id + ' ' + v.id + ': step ' + i + ' ' + m + ' failed: ' + r.reason);
      });
      assert.strictEqual(game.state.status, 'won', job.id + ' ' + v.id + ' witness does not win');
      const s = E.stars(game);
      assert.ok(s.count >= v.best.stars, job.id + ' ' + v.id + ': ' + s.count + ' stars < recorded ' + v.best.stars);
      assert.strictEqual(E.payout(game).total, v.best.payout, job.id + ' ' + v.id + ' payout');
    });
  });
});
