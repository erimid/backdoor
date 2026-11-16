// Rules tests for the hacking engine. Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../js/engine.js');
const JOBS = require('../js/jobs.js');

const job01 = JOBS.find(j => j.id === 'job01');
const job02 = JOBS.find(j => j.id === 'job02');

function ok(r) { assert.ok(r.ok, r.reason); return r; }
function sentry(g, id) { return g.state.sentries.find(s => s.id === id); }
// Put the game into a hand-made position and re-plan Sentry intents.
function setup(job, fn) {
  const g = E.newGame(job);
  fn(g.state, g);
  E.replan(g);
  return g;
}

test('a new job starts on ENTRY with intents planned', () => {
  const g = E.newGame(job01);
  assert.equal(g.state.player, 'E');
  assert.equal(g.state.actions, 2);
  assert.deepEqual(sentry(g, 'A').intent, { type: 'move', target: 'H', why: 'patrol' });
});

test('movement follows links and respects blockers', () => {
  const g = E.newGame(job01);
  assert.deepEqual(E.legalMoves(g).sort(), ['A', 'C']);
  assert.equal(E.move(g, 'B').ok, false, 'not linked');
  ok(E.move(g, 'A')); ok(E.move(g, 'B'));
  assert.equal(E.legalMoves(g).length, 0, 'no actions left');
  E.endTurn(g);
  assert.ok(!E.legalMoves(g).includes('F'), 'closed firewall blocks');
});

test('a Sentry next to you scans your node; stepping away dodges it', () => {
  const g = setup(job01, st => { st.player = 'D'; st.sentries[0].pos = 'G'; st.sentries[0].loopIndex = 1; });
  assert.deepEqual(sentry(g, 'A').intent, { type: 'scan', target: 'D', why: 'player' });
  assert.equal(E.threats(g).length, 1);
  ok(E.move(g, 'C'));
  assert.equal(E.threats(g).length, 0, 'intent targets the node, not you');
  ok(E.endTurn(g));
  assert.equal(g.state.heat, 0);
  assert.equal(g.state.detected, false);
});

test('scan costs +3 and Spoof makes it miss', () => {
  const g = setup(job01, st => { st.player = 'D'; st.sentries[0].pos = 'G'; });
  ok(E.endTurn(g));
  assert.equal(g.state.heat, 3);
  assert.equal(g.state.detected, true);

  const s = setup(job01, st => { st.player = 'D'; st.sentries[0].pos = 'G'; });
  ok(E.runProgram(s, 'spoof'));
  ok(E.endTurn(s));
  assert.equal(s.state.heat, 0);
  assert.equal(s.state.detected, false);
  assert.equal(s.state.spoof, false, 'Spoof wears off in upkeep');
});

test('a bump costs +2 and the Sentry stays put', () => {
  const g = E.newGame(job01); // Sentry A on G intends to move to H
  g.state.player = 'H';
  ok(E.endTurn(g));
  assert.equal(g.state.heat, 2);
  assert.equal(sentry(g, 'A').pos, 'G');
});

test('honeypot costs +4 once and Sniff reveals it within 2 hops', () => {
  const g = setup(job01, st => { st.player = 'B'; });
  ok(E.runProgram(g, 'sniff'));
  assert.equal(g.state.nodes.Y.hidden, false);
  assert.equal(g.state.nodes.X.hidden, false, 'X is 2 hops away');
  const h = setup(job01, st => { st.player = 'Y'; st.nodes.Y.hidden = false; });
  ok(E.move(h, 'X'));
  assert.equal(h.state.heat, 4);
  ok(E.move(h, 'Y')); E.endTurn(h); ok(E.move(h, 'X'));
  assert.equal(h.state.heat, 4, 'only the first entry costs heat');
});

test('Brute opens a firewall after 2 enemy phases for +1 heat', () => {
  const g = setup(job01, st => { st.player = 'B'; });
  ok(E.runProgram(g, 'brute', 'F'));
  assert.equal(g.state.heat, 1);
  ok(E.endTurn(g));
  assert.equal(g.state.nodes.F.open, false);
  ok(E.endTurn(g));
  assert.equal(g.state.nodes.F.open, true);
  assert.ok(E.legalMoves(g).includes('F'));
});

test('Extract then returning to ENTRY wins with stars', () => {
  const g = setup(job01, st => { st.player = 'V'; st.sentries[0].pos = 'D'; });
  ok(E.extract(g));
  assert.equal(g.state.hasData, true);
  g.state.player = 'A';
  ok(E.move(g, 'E'));
  assert.equal(g.state.status, 'won');
  assert.deepEqual(E.stars(g), { finished: true, lowHeat: true, unseen: true, count: 3 });
});

test('admin traces on the last 3 turns and the job drops after the limit', () => {
  const g = setup(job01, st => { st.player = 'E'; st.turn = 9; });
  ok(E.endTurn(g)); assert.equal(g.state.heat, 0, 'turn 9 is not traced');
  ok(E.endTurn(g)); assert.equal(g.state.heat, 1);
  ok(E.endTurn(g)); assert.equal(g.state.heat, 2);
  ok(E.endTurn(g)); assert.equal(g.state.heat, 3);
  assert.equal(g.state.status, 'lost');
  assert.equal(g.state.reason, 'dropped');
});

test('heat 10 means traced', () => {
  const g = setup(job01, st => { st.player = 'D'; st.sentries[0].pos = 'G'; st.heat = 8; });
  ok(E.endTurn(g));
  assert.equal(g.state.status, 'lost');
  assert.equal(g.state.reason, 'traced');
  assert.equal(g.state.heat, 10);
});

test('Undo restores the turn and clears at the next turn', () => {
  const g = E.newGame(job01);
  ok(E.move(g, 'A'));
  ok(E.undo(g));
  assert.equal(g.state.player, 'E');
  assert.equal(g.state.actions, 2);
  ok(E.move(g, 'A'));
  ok(E.endTurn(g));
  assert.equal(E.undo(g).ok, false);
});

test('Decoy lures Sentries within 3 hops and is wiped when reached', () => {
  const g = setup(job02, st => { st.player = 'C'; st.sentries[1].pos = 'W'; st.sentries[1].loopIndex = 0; });
  // Sentry B on W would patrol to M. Plant a decoy on E (linked to C).
  ok(E.runProgram(g, 'decoy', 'E'));
  const b = sentry(g, 'B');
  assert.equal(b.intent.why, 'decoy');
  assert.equal(b.intent.type, 'move');
  ok(E.move(g, 'M'));
  ok(E.endTurn(g));
  ok(E.endTurn(g));
  assert.equal(g.state.nodes.E.decoy, false, 'reached and wiped');
});

test('Worm stuns a Sentry for 2 turns, and Decoy on a Worm lures it in', () => {
  const g = setup(job02, st => { st.player = 'E'; st.sentries[1].pos = 'M'; st.sentries[1].loopIndex = 1; });
  ok(E.runProgram(g, 'worm', 'C'));
  ok(E.runProgram(g, 'decoy', 'C'));
  assert.deepEqual(sentry(g, 'B').intent, { type: 'move', target: 'C', why: 'decoy' });
  ok(E.endTurn(g));
  const b = sentry(g, 'B');
  assert.equal(b.pos, 'C');
  assert.equal(b.stun, 2);
  assert.equal(g.state.nodes.C.infected, false, 'worm used up');
  assert.equal(b.intent.type, 'stunned');
  ok(E.endTurn(g)); assert.equal(sentry(g, 'B').intent.type, 'stunned');
  ok(E.endTurn(g)); assert.notEqual(sentry(g, 'B').intent.type, 'stunned');
});

test('the mailbox clue opens the lock', () => {
  const g = setup(job02, st => { st.player = 'C'; st.sentries[1].pos = 'W'; st.sentries[1].loopIndex = 0; });
  assert.ok(E.isClosed(g, 'A'));
  ok(E.move(g, 'M'));
  assert.equal(g.state.nodes.A.open, true);
});

test('the AI offers once; trusting opens a shortcut', () => {
  const g = setup(job02, st => { st.player = 'R'; st.sentries[1].pos = 'C'; st.sentries[1].loopIndex = 2; });
  ok(E.move(g, 'W'));
  assert.equal(g.state.ai.pending, true);
  assert.equal(E.move(g, 'R').ok, false, 'must answer first');
  ok(E.answerAI(g, true));
  assert.ok(E.legalMoves(g).includes('U'));
  ok(E.move(g, 'U'));
  assert.ok(E.legalMoves(g).includes('S') || E.sentryAt(g, 'S'));
  assert.equal(E.undo(g).ok, true);
  assert.equal(g.state.ai.trusted, true, 'undo cannot take back the answer');
});

test('refusing the AI tips off the admin once', () => {
  const g = setup(job02, st => { st.player = 'R'; st.sentries[1].pos = 'C'; st.sentries[1].loopIndex = 2; });
  ok(E.move(g, 'W'));
  ok(E.answerAI(g, false));
  assert.equal(E.legalMoves(g).includes('U'), false);
  ok(E.move(g, 'R'));
  ok(E.endTurn(g));
  const after = g.state.heat;
  assert.ok(after >= 2);
  ok(E.endTurn(g));
  assert.equal(g.state.heat, after, 'tip happens once');
});

test('Sentries never enter or scan through the AI node', () => {
  const g = setup(job02, st => { st.player = 'U'; st.ai.trusted = true; st.ai.offered = true; st.extraLinks.push(['U', 'S']); });
  g.state.sentries.forEach(s => assert.notEqual(s.intent.target, 'U'));
});
