// Rules tests for the v2 hacking engine. Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../js/engine.js');
const JOBS = require('../js/jobs.js');

const job01 = JOBS.find(j => j.id === 'job01');
const job02 = JOBS.find(j => j.id === 'job02');

function ok(r) { assert.ok(r.ok, r.reason); return r; }
function sentry(g, id) { return g.state.sentries.find(s => s.id === id); }
function kinds(r) { return r.events.map(e => e.kind); }
function find(r, kind) { return r.events.find(e => e.kind === kind); }
// Put the game into a hand-made position and re-plan Sentry intents.
function setup(job, fn, opts) {
  const g = E.newGame(job, opts);
  fn(g.state, g);
  E.replan(g);
  return g;
}
// Play a line in the smoke/witness label format ('>X', 'prog', 'prog@X',
// 'extract', 'end', 'trust', 'refuse'). Every step must succeed.
function play(g, line) {
  const out = [];
  for (const lab of line.split(' ')) {
    let r;
    if (lab[0] === '>') r = E.move(g, lab.slice(1));
    else if (lab === 'end') r = E.endTurn(g);
    else if (lab === 'extract') r = E.extract(g);
    else if (lab === 'trust' || lab === 'refuse') r = E.answerAI(g, lab === 'trust');
    else { const [p, t] = lab.split('@'); r = E.runProgram(g, p, t); }
    assert.ok(r.ok, `step "${lab}" failed: ${r.reason}`);
    out.push(...r.events);
  }
  return out;
}

// ---------- canonical winning lines (the recorded proof each job is winnable) ----------

const CANON = {
  // Left route: slip to CAM-01 and bank, dodge the scan on CAM-01 while grabbing
  // the SWITCH cache, Extract with 3 actions, run back to WIFI under the hunt.
  job01: '>C end >G >V end extract >G >C end >D',
  // Second route on Job 01: Brute the firewall from TILL-2, out through WIFI.
  job01brute: '>A end >B brute@F end >Y >B end end end >F end end end >H >V end extract >G >D',
  // Left route on Job 02: Worm on WIFI catches Sentry B, mailbox password,
  // Decoy pulls Sentry A, vault via ADMIN-PC, refuse the freeze, run for PRINT-04.
  job02: '>R worm@W end end >E >C end >M >A decoy@M end >K >O end >V end extract refuse >S >H end >T >Q end >P'
};

test('canonical Job 01 line wins with 3 stars', () => {
  const g = E.newGame(job01);
  const evs = play(g, CANON.job01);
  assert.equal(g.state.status, 'won');
  assert.equal(g.state.player, 'D');
  assert.ok(evs.some(e => e.kind === 'dodge'), 'the line dodges a telegraphed scan');
  assert.ok(evs.some(e => e.kind === 'breach'));
  const p = E.payout(g);
  assert.equal(p.total, 640); // 400 + 100 cache + 6 spare turns * 30 - 1 heat * 40
  assert.deepEqual(
    (({ escaped, par, bonus, count }) => ({ escaped, par, bonus, count }))(E.stars(g)),
    { escaped: true, par: true, bonus: true, count: 3 });
});

test('Job 01 has a second route (Brute) that wins', () => {
  const g = E.newGame(job01);
  play(g, CANON.job01brute);
  assert.equal(g.state.status, 'won');
  assert.ok(g.state.path.includes('F'));
  assert.equal(E.stars(g).count, 3);
});

test('canonical Job 02 line wins with 3 stars (Worm bonus)', () => {
  const g = E.newGame(job02);
  play(g, CANON.job02);
  assert.equal(g.state.status, 'won');
  assert.equal(g.state.player, 'P');
  assert.equal(g.state.wormStuns, 1);
  assert.equal(E.payout(g).total, 950);
  assert.equal(E.stars(g).count, 3);
});

// ---------- setup, movement, intents ----------

test('a new job starts on ENTRY with intents planned', () => {
  const g = E.newGame(job01);
  assert.equal(g.state.player, 'E');
  assert.equal(g.state.actions, 2);
  assert.equal(g.state.banked, false);
  assert.equal(g.state.breach, false);
  assert.equal(g.job.variantId, 'v00');
  assert.deepEqual(sentry(g, 'A').intent, { type: 'move', target: 'D', why: 'patrol', atPlayer: false });
  assert.deepEqual(E.exitInfo(g), { candidates: ['D', 'B'], exit: null, known: false });
});

test('Job 01 v2 data: patrol, V–G link, limits, programs', () => {
  assert.deepEqual(job01.sentries[0].patrol, ['G', 'D', 'G', 'H', 'V', 'H']);
  assert.ok(job01.links.some(l => l.join() === 'V,G'));
  assert.ok(job01.links.some(l => l.join() === 'C,G'));
  assert.equal(job01.turnLimit, 10);
  assert.deepEqual(job01.programs, { sniff: 1, spoof: 1, brute: 1 });
  assert.deepEqual(job02.programs, { sniff: 2, spoof: 1, decoy: 1, worm: 1, brute: 1 });
  for (const j of JOBS) {
    j.tips.forEach(t => { assert.equal(typeof t.when, 'string'); assert.equal(typeof t.html, 'string'); });
    assert.ok(Array.isArray(j.rules) && j.rules.length > 0);
  }
  assert.deepEqual(job01.tips.map(t => t.when), ['start', 'threatNear', 'adjBarrier', 'hiddenNear', 'banked', 'onTarget', 'breach']);
  assert.deepEqual(job02.tips.map(t => t.when), ['start', 'breach']);
});

test('movement follows links and respects blockers', () => {
  const g = E.newGame(job01);
  assert.deepEqual(E.legalMoves(g).sort(), ['A', 'C']);
  assert.equal(E.move(g, 'B').ok, false, 'not linked');
  const r = ok(E.move(g, 'A'));
  assert.deepEqual(find(r, 'move'), { kind: 'move', text: find(r, 'move').text, from: 'E', to: 'A' });
  ok(E.move(g, 'B'));
  assert.equal(E.legalMoves(g).length, 0, 'no actions left');
  E.endTurn(g);
  assert.ok(!E.legalMoves(g).includes('F'), 'closed firewall blocks');
});

test('every intent records atPlayer at plan time', () => {
  const g = setup(job01, st => { st.player = 'D'; st.sentries[0].pos = 'G'; });
  assert.deepEqual(sentry(g, 'A').intent, { type: 'scan', target: 'D', why: 'player', atPlayer: true });
  ok(E.move(g, 'C'));
  assert.equal(sentry(g, 'A').intent.atPlayer, true, 'not recomputed when you move');
  assert.equal(E.threats(g).length, 0, 'intent targets the node, not you');
});

// ---------- 1. overclock ----------

test('overclock: unused actions bank exactly one extra action, never more', () => {
  const g = E.newGame(job01);
  ok(E.endTurn(g));
  assert.equal(g.state.actions, 3);
  assert.equal(g.state.banked, true);
  ok(E.endTurn(g));
  assert.equal(g.state.actions, 3, 'never 4');
  assert.equal(E.ACTIONS_MAX, 3);
  ok(E.move(g, 'A'));
  ok(E.endTurn(g));
  assert.equal(g.state.actions, 3, '2 left over still banks only 1');
  ok(E.move(g, 'E')); ok(E.move(g, 'A')); ok(E.move(g, 'E'));
  ok(E.endTurn(g));
  assert.equal(g.state.actions, 2);
  assert.equal(g.state.banked, false);
  ok(E.move(g, 'A')); ok(E.move(g, 'E'));
  ok(E.endTurn(g));
  assert.equal(g.state.actions, 2, 'using everything banks nothing');
});

// ---------- scans, bumps, dodges ----------

test('scan costs +3 and Spoof makes it miss', () => {
  const g = setup(job01, st => { st.player = 'D'; st.sentries[0].pos = 'G'; });
  const r = ok(E.endTurn(g));
  assert.equal(g.state.heat, 3);
  assert.equal(g.state.detected, true);
  const scan = find(r, 'scan');
  assert.equal(scan.sentry, 'A'); assert.equal(scan.node, 'D');
  assert.equal(scan.hit, true); assert.equal(scan.spoofed, false); assert.equal(scan.phase, 'enemy');
  const heat = find(r, 'heat');
  assert.equal(heat.cause, 'scan'); assert.equal(heat.amount, 3); assert.equal(heat.sentry, 'A');

  const s = setup(job01, st => { st.player = 'D'; st.sentries[0].pos = 'G'; });
  ok(E.runProgram(s, 'spoof'));
  const r2 = ok(E.endTurn(s));
  assert.equal(s.state.heat, 0);
  assert.equal(s.state.detected, false);
  assert.equal(s.state.spoof, false, 'Spoof wears off in upkeep');
  assert.equal(find(r2, 'scan').spoofed, true);
  assert.equal(find(r2, 'scan').hit, false);
  assert.ok(find(r2, 'miss'), 'miss kept for Spoof saves');
});

test('a bump costs +2 and the Sentry stays put', () => {
  const g = E.newGame(job01); // Sentry A on G intends to move to D
  g.state.player = 'D';
  const r = ok(E.endTurn(g));
  assert.equal(g.state.heat, 2);
  assert.equal(sentry(g, 'A').pos, 'G');
  assert.equal(find(r, 'bump').node, 'D');
  assert.equal(find(r, 'bump').spoofed, false);
  assert.equal(find(r, 'heat').cause, 'bump');
  assert.equal(find(r, 'dodge'), undefined, 'not aimed at you when planned, so no dodge');
});

test('dodge: a scan aimed at you fires on the node you left', () => {
  const g = setup(job01, st => { st.player = 'D'; st.sentries[0].pos = 'G'; });
  ok(E.move(g, 'C'));
  const r = ok(E.endTurn(g));
  const d = find(r, 'dodge');
  assert.deepEqual({ sentry: d.sentry, node: d.node, phase: d.phase }, { sentry: 'A', node: 'D', phase: 'enemy' });
  assert.ok(kinds(r).indexOf('scan') < kinds(r).indexOf('dodge'), 'dodge follows the scan');
  assert.equal(g.state.heat, 0);
  assert.equal(g.state.detected, false);
});

test('dodge: a move aimed at you lands on the node you left', () => {
  // Resting Sentry (cooldown) next to you patrols onto your node: a bump intent.
  const g = setup(job01, st => { st.player = 'H'; st.sentries[0].pos = 'G'; st.sentries[0].loopIndex = 3; st.sentries[0].cooldown = true; });
  assert.deepEqual(sentry(g, 'A').intent, { type: 'move', target: 'H', why: 'patrol', atPlayer: true });
  assert.equal(E.threats(g)[0].type, 'bump');
  ok(E.move(g, 'V'));
  const r = ok(E.endTurn(g));
  assert.equal(sentry(g, 'A').pos, 'H');
  assert.equal(find(r, 'dodge').node, 'H');
  assert.ok(kinds(r).indexOf('sentryMove') < kinds(r).indexOf('dodge'));
  assert.equal(g.state.heat, 0);
});

test('heat 10 means traced', () => {
  const g = setup(job01, st => { st.player = 'D'; st.sentries[0].pos = 'G'; st.heat = 8; });
  const r = ok(E.endTurn(g));
  assert.equal(g.state.status, 'lost');
  assert.equal(g.state.reason, 'traced');
  assert.equal(g.state.heat, 10);
  assert.equal(find(r, 'lose').reason, 'traced');
  assert.equal(E.payout(g).total, 0, 'a lost run pays nothing');
});

// ---------- 2 & 3. reveals, Sniff and Undo ----------

test('Sniff reveals within 2 hops, learns the exit, and clears Undo', () => {
  const h = setup(job01, st => { st.player = 'A'; });
  ok(E.move(h, 'B'));
  assert.equal(h.undoStack.length, 1);
  const r = ok(E.runProgram(h, 'sniff'));
  assert.equal(h.state.nodes.Y.hidden, false);
  assert.equal(h.state.nodes.X.hidden, false, 'X is 2 hops away');
  const rev = find(r, 'reveal');
  assert.deepEqual(rev.nodes.sort(), ['X', 'Y']);
  assert.equal(rev.trap, true);
  assert.deepEqual(rev.traps, ['X']);
  assert.match(rev.text, /BACKUP is a honeypot/);
  assert.match(rev.text, /PRINTER is a cache/);
  assert.deepEqual(find(r, 'exitKnown').exit, 'D');
  assert.equal(h.state.exitKnown, true);
  assert.deepEqual(E.exitInfo(h), { candidates: ['D', 'B'], exit: 'D', known: true });
  assert.equal(h.undoStack.length, 0);
  assert.equal(E.undo(h).ok, false, 'you cannot un-learn information');
});

test('Sniff runs to learn the exit even with nothing hidden nearby', () => {
  const g = E.newGame(job01);
  assert.equal(E.canRun(g, 'sniff'), true);
  const r = ok(E.runProgram(g, 'sniff'));
  assert.equal(find(r, 'reveal'), undefined);
  assert.equal(find(r, 'exitKnown').exit, 'D');
  const h = setup(job02, st => { st.exitKnown = true; });
  assert.equal(E.canRun(h, 'sniff'), false, 'nothing hidden and exit known');
  assert.equal(E.runProgram(h, 'sniff').ok, false);
});

test('entering a hidden cache reveals it and clears Undo', () => {
  const g = setup(job01, st => { st.player = 'B'; });
  const r = ok(E.move(g, 'Y'));
  assert.equal(find(r, 'reveal').text, 'PRINTER revealed: a cache.');
  assert.equal(find(r, 'reveal').trap, false);
  assert.equal(find(r, 'cache').value, 100);
  assert.equal(E.undo(g).ok, false);
  assert.equal(g.state.player, 'Y');
});

test('honeypot costs +4 once and can not be undone', () => {
  const h = setup(job01, st => { st.player = 'Y'; st.nodes.Y.hidden = false; });
  const r = ok(E.move(h, 'X'));
  assert.equal(h.state.heat, 4);
  assert.equal(find(r, 'reveal').text, 'BACKUP was a honeypot.');
  assert.equal(find(r, 'reveal').trap, true);
  assert.equal(find(r, 'heat').cause, 'honeypot');
  assert.equal(E.undo(h).ok, false, 'no take-backs');
  assert.equal(h.state.heat, 4);
  assert.equal(h.state.detected, false, 'a honeypot is not a scan or bump');
  ok(E.move(h, 'Y')); E.endTurn(h); ok(E.move(h, 'X'));
  assert.equal(h.state.heat, 4, 'only the first entry costs heat');
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

// ---------- 5. Brute ----------

test('Brute costs 2 actions and opens the barrier immediately for +1 heat', () => {
  assert.equal(E.programCost('brute'), 2);
  ['sniff', 'spoof', 'decoy', 'worm'].forEach(p => assert.equal(E.programCost(p), 1));
  const g = setup(job01, st => { st.player = 'B'; });
  assert.deepEqual(E.programTargets(g, 'brute'), ['F']);
  const r = ok(E.runProgram(g, 'brute', 'F'));
  assert.equal(g.state.nodes.F.open, true);
  assert.equal(g.state.nodes.F.bruteTimer, 0);
  assert.equal(g.state.heat, 1);
  assert.equal(g.state.actions, 0);
  assert.equal(g.state.charges.brute, 0);
  assert.deepEqual((({ node, by }) => ({ node, by }))(find(r, 'open')), { node: 'F', by: 'brute' });
  assert.equal(find(r, 'heat').cause, 'brute');
  ok(E.endTurn(g));
  assert.ok(E.legalMoves(g).includes('F'));
});

test('Brute needs 2 actions', () => {
  const g = setup(job01, st => { st.player = 'B'; });
  ok(E.runProgram(g, 'spoof'));
  assert.deepEqual(E.programTargets(g, 'brute'), []);
  assert.equal(E.canRun(g, 'brute'), false);
  const r = E.runProgram(g, 'brute', 'F');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'Brute needs 2 actions.');
  // With a banked turn you can Brute and still move.
  const h = setup(job01, st => { st.player = 'B'; st.actions = 3; });
  ok(E.runProgram(h, 'brute', 'F'));
  ok(E.move(h, 'F'));
});

test('Brute noise replans Sentries in range for one enemy phase only', () => {
  const g = setup(job01, st => { st.player = 'B'; });
  assert.equal(sentry(g, 'A').intent.target, 'D');
  const r = ok(E.runProgram(g, 'brute', 'F'));
  const noise = find(r, 'noise');
  assert.equal(noise.node, 'F');
  assert.deepEqual(noise.sentries, ['A']);
  assert.equal(g.state.noise, 'F');
  assert.equal(sentry(g, 'A').noisy, true);
  assert.deepEqual(sentry(g, 'A').intent, { type: 'move', target: 'H', why: 'noise', atPlayer: false });
  const r2 = ok(E.endTurn(g));
  assert.equal(find(r2, 'sentryMove').why, 'noise');
  assert.equal(sentry(g, 'A').pos, 'H');
  assert.equal(g.state.noise, null, 'noise clears after the enemy phase');
  assert.equal(sentry(g, 'A').noisy, false);
  assert.notEqual(sentry(g, 'A').intent.why, 'noise');
});

test('Brute noise: a Sentry on the barrier scans it; out-of-range Sentries ignore it', () => {
  const g = setup(job01, st => { st.player = 'B'; st.sentries[0].pos = 'F'; });
  assert.equal(sentry(g, 'A').intent.target, 'B', 'would scan you');
  ok(E.runProgram(g, 'brute', 'F'));
  assert.deepEqual(sentry(g, 'A').intent, { type: 'scan', target: 'F', why: 'noise', atPlayer: false });

  // Job 02: A on SWITCH is 1 hop from the firewall, B on KIOSK is 4 hops away.
  const h = setup(job02, st => { st.player = 'W'; st.sentries[1].pos = 'K'; st.sentries[1].loopIndex = 0; });
  const before = JSON.stringify(sentry(h, 'B').intent);
  const r = ok(E.runProgram(h, 'brute', 'F'));
  assert.deepEqual(find(r, 'noise').sentries, ['A']);
  assert.equal(JSON.stringify(sentry(h, 'B').intent), before);
  assert.equal(sentry(h, 'B').noisy, false);
});

test('Brute noise skips stunned and lured Sentries', () => {
  const g = setup(job02, st => {
    st.player = 'W'; st.sentries[0].stun = 1; st.sentries[1].pos = 'C'; st.sentries[1].loopIndex = 2;
    st.nodes.E.decoy = true;
  });
  assert.equal(sentry(g, 'B').lure, 'E');
  const r = ok(E.runProgram(g, 'brute', 'F'));
  assert.deepEqual(find(r, 'noise').sentries, []);
  assert.equal(sentry(g, 'B').intent.why, 'decoy', 'a lure beats noise');
  assert.equal(sentry(g, 'A').intent.type, 'stunned');
});

// ---------- 4. single-target Decoy ----------

test('Decoy lures only the single nearest Sentry', () => {
  // A on FIREWALL is 3 hops from ENTRY, B on CAM-03 is 1 hop.
  const g = setup(job02, st => { st.player = 'R'; st.sentries[0].pos = 'F'; st.sentries[1].pos = 'C'; st.sentries[1].loopIndex = 2; });
  const r = ok(E.runProgram(g, 'decoy', 'E'));
  assert.equal(find(r, 'program').lured, 'B');
  assert.equal(sentry(g, 'B').lure, 'E');
  assert.equal(sentry(g, 'A').lure, null);
  assert.equal(sentry(g, 'B').intent.why, 'decoy');
  assert.notEqual(sentry(g, 'A').intent.why, 'decoy');
  assert.equal(E.DECOY_RANGE, 3);
});

test('Decoy ties go to Sentry order', () => {
  // A on WIFI (W-R-E) and B on MAIL-02 (M-C-E) are both 2 hops from ENTRY.
  const g = setup(job02, st => { st.player = 'R'; st.sentries[0].pos = 'W'; st.sentries[1].pos = 'M'; });
  const r = ok(E.runProgram(g, 'decoy', 'E'));
  assert.equal(find(r, 'program').lured, 'A');
  assert.equal(sentry(g, 'B').lure, null);
});

test('an unclaimed Decoy is claimed at the next planAll', () => {
  const g = setup(job02, st => { st.player = 'R'; st.sentries[0].pos = 'O'; st.sentries[1].pos = 'K'; });
  const r = ok(E.runProgram(g, 'decoy', 'E'));
  assert.equal(find(r, 'program').lured, null);
  g.state.sentries[1].pos = 'M';
  E.replan(g);
  assert.equal(sentry(g, 'B').lure, 'E');
  assert.equal(sentry(g, 'B').intent.why, 'decoy');
});

test('Decoy is wiped when reached and the lure clears', () => {
  const g = setup(job02, st => { st.player = 'C'; st.sentries[1].pos = 'W'; st.sentries[1].loopIndex = 0; });
  ok(E.runProgram(g, 'decoy', 'E'));
  const b = sentry(g, 'B');
  assert.equal(b.intent.why, 'decoy');
  assert.equal(b.intent.type, 'move');
  ok(E.move(g, 'M'));
  ok(E.endTurn(g));
  const r = ok(E.endTurn(g));
  assert.equal(g.state.nodes.E.decoy, false, 'reached and wiped');
  assert.equal(find(r, 'sentry').wiped, 'E');
  assert.equal(sentry(g, 'B').lure, null);
});

test('Worm stuns a Sentry for 2 turns, and Decoy on a Worm lures it in', () => {
  const g = setup(job02, st => { st.player = 'E'; st.sentries[1].pos = 'M'; st.sentries[1].loopIndex = 1; });
  ok(E.runProgram(g, 'worm', 'C'));
  ok(E.runProgram(g, 'decoy', 'C'));
  assert.deepEqual(sentry(g, 'B').intent, { type: 'move', target: 'C', why: 'decoy', atPlayer: false });
  assert.equal(E.bonusMet(g), false);
  const r = ok(E.endTurn(g));
  const b = sentry(g, 'B');
  assert.equal(b.pos, 'C');
  assert.equal(b.stun, 2);
  const stun = find(r, 'stun');
  assert.deepEqual({ s: stun.sentry, t: stun.turns, by: stun.by }, { s: 'B', t: 2, by: 'worm' });
  assert.equal(g.state.wormStuns, 1);
  assert.equal(E.bonusMet(g), true);
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

// ---------- 9. caches ----------

test('a cash cache pays $100 once, just for entering', () => {
  const g = setup(job01, st => { st.player = 'D'; st.sentries[0].pos = 'V'; });
  const r = ok(E.move(g, 'G'));
  const c = find(r, 'cache');
  assert.deepEqual({ node: c.node, value: c.value, hot: c.hot }, { node: 'G', value: 100, hot: false });
  assert.equal(g.state.cash, 100);
  assert.equal(g.state.taken.G, true);
  ok(E.move(g, 'D'));
  ok(E.endTurn(g));
  g.state.sentries[0].pos = 'V'; E.replan(g);
  ok(E.move(g, 'G'));
  assert.equal(g.state.cash, 100, 'taken caches stay taken');
  // A visible cache can be undone (no information was gained).
  const h = setup(job01, st => { st.player = 'D'; st.sentries[0].pos = 'V'; });
  ok(E.move(h, 'G')); ok(E.undo(h));
  assert.equal(h.state.cash, 0);
  assert.equal(E.CACHE_VALUE, 100);
});

test('a cash cache taken during BREACH pays double (hot data)', () => {
  const g = setup(job01, st => { st.player = 'V'; st.sentries[0].pos = 'D'; });
  ok(E.extract(g));
  const r = ok(E.move(g, 'G'));
  const c = find(r, 'cache');
  assert.equal(c.value, 200);
  assert.equal(c.hot, true);
  assert.equal(g.state.cash, 200);
});

test('a charge cache gives +1 program charge', () => {
  const g = setup(job02, st => { st.player = 'S'; st.sentries[0].pos = 'F'; });
  assert.equal(g.state.charges.brute, 1);
  const r = ok(E.move(g, 'H'));
  assert.equal(find(r, 'reveal').text, 'HR-DB revealed: a cache.');
  assert.equal(find(r, 'cache').charge, 'brute');
  assert.equal(g.state.charges.brute, 2);
  assert.equal(g.state.cash, 0);
});

// ---------- 10. BREACH ----------

test('Extract starts the BREACH: entry burns, exit opens, Sentries hunt', () => {
  const g = setup(job01, st => { st.player = 'V'; st.sentries[0].pos = 'D'; st.sentries[0].loopIndex = 2; });
  ok(E.move(g, 'H')); ok(E.move(g, 'V')); // undo history to be cleared
  ok(E.endTurn(g));
  g.state.sentries[0].pos = 'D'; E.replan(g);
  const r = ok(E.extract(g));
  const st = g.state;
  assert.equal(st.hasData, true);
  assert.equal(st.breach, true);
  assert.equal(st.breachTurn, 2);
  assert.equal(st.exit, 'D');
  assert.equal(st.exitKnown, true);
  assert.equal(st.heat, 1);
  assert.deepEqual(kinds(r), ['extract', 'heat', 'breach']);
  assert.equal(find(r, 'heat').cause, 'extract');
  assert.deepEqual((({ exit, burned }) => ({ exit, burned }))(find(r, 'breach')), { exit: 'D', burned: 'E' });
  assert.deepEqual(E.exitInfo(g), { candidates: ['D', 'B'], exit: 'D', known: true });
  // Hunt: one step along the shortest sentry path to you (D-G-V).
  assert.deepEqual(sentry(g, 'A').intent, { type: 'move', target: 'G', why: 'hunt', atPlayer: false });
  assert.equal(g.undoStack.length, 0, 'Extract is final');
});

test('BREACH: ENTRY is burned and the exit wins with the data', () => {
  const g = setup(job01, st => { st.player = 'V'; st.sentries[0].pos = 'D'; }, { variant: { id: 't', bag: { Y: 'cash', X: 'honeypot' }, offsets: { A: 0 }, exit: 1 } });
  ok(E.extract(g));
  assert.equal(g.state.exit, 'B');
  g.state.player = 'A'; g.state.sentries[0].pos = 'V'; E.replan(g);
  assert.ok(!E.legalMoves(g).includes('E'));
  const r = E.move(g, 'E');
  assert.equal(r.ok, false);
  assert.match(r.reason, /burned/);
  assert.equal(E.isBurned(g, 'E'), true);
  const w = ok(E.move(g, 'B'));
  assert.equal(g.state.status, 'won');
  assert.equal(find(w, 'win').exit, 'B');
});

test('stepping on an exit without the data does not win; ENTRY no longer wins', () => {
  const g = setup(job01, st => { st.player = 'A'; st.sentries[0].pos = 'V'; });
  ok(E.move(g, 'B'));
  assert.equal(g.state.status, 'playing');
  const h = setup(job01, st => { st.player = 'A'; st.hasData = true; st.sentries[0].pos = 'V'; });
  ok(E.move(h, 'E'));
  assert.equal(h.state.status, 'playing', 'only the BREACH exit wins');
});

test('BREACH: an adjacent resting Sentry backs off a step (never onto the exit), then hunts again', () => {
  const g = setup(job01, st => { st.player = 'V'; st.sentries[0].pos = 'D'; });
  ok(E.extract(g));
  // A on SWITCH sits on the only way from SALES DB to WIFI. Resting, it
  // doesn't camp there: it backs off to a node not next to you that isn't
  // the exit (CAM-01; WIFI is the exit, POS-SRV is next to you).
  g.state.sentries[0].pos = 'G'; g.state.sentries[0].cooldown = true; E.replan(g);
  assert.deepEqual(sentry(g, 'A').intent, { type: 'move', target: 'C', why: 'retreat', atPlayer: false });
  ok(E.endTurn(g));
  assert.equal(sentry(g, 'A').pos, 'C');
  assert.deepEqual(sentry(g, 'A').intent, { type: 'move', target: 'G', why: 'hunt', atPlayer: false });
  // SWITCH is open for this turn: out through it to WIFI.
  ok(E.move(g, 'G')); ok(E.move(g, 'D'));
  assert.equal(g.state.status, 'won');
});

test('BREACH: a resting Sentry backs off to the farthest free node not next to you', () => {
  // A on POS-SRV next to you on SWITCH. SALES DB is next to SWITCH (V–G);
  // FIREWALL and BACKUP are not, and are equally far: link order picks FIREWALL.
  const g = setup(job01, st => { st.player = 'V'; st.sentries[0].pos = 'D'; });
  ok(E.extract(g));
  g.state.player = 'G'; g.state.sentries[0].pos = 'H'; g.state.sentries[0].cooldown = true; E.replan(g);
  assert.deepEqual(sentry(g, 'A').intent, { type: 'move', target: 'F', why: 'retreat', atPlayer: false });
});

test('no softlock: Sentries on both doorways of a trusted UNKNOWN never seal you in', () => {
  const g = setup(job02, st => {
    st.breach = true; st.breachTurn = 1; st.hasData = true; st.exit = 'M';
    st.ai.trusted = true; st.extraLinks.push(['U', 'S']);
    st.player = 'U';
    // Both camp a doorway: loops that never leave, both resting.
    st.sentries[0].pos = 'S'; st.sentries[0].loop = ['S']; st.sentries[0].loopIndex = 0; st.sentries[0].cooldown = true;
    st.sentries[1].pos = 'W'; st.sentries[1].loop = ['W']; st.sentries[1].loopIndex = 0; st.sentries[1].cooldown = true;
  });
  assert.equal(E.legalMoves(g).length, 0, 'boxed in right now');
  const a = sentry(g, 'A').intent;
  assert.equal(a.type, 'move', 'the first resting doorway Sentry steps off');
  assert.notEqual(a.target, 'U');
  ok(E.endTurn(g));
  assert.ok(E.legalMoves(g).includes('S'), 'SWITCH is open again');
  // And from any boxed-in start, waiting frees a doorway within 3 enemy phases.
  const h = setup(job02, st => {
    st.breach = true; st.breachTurn = 1; st.hasData = true; st.exit = 'M';
    st.ai.trusted = true; st.extraLinks.push(['U', 'S']);
    st.player = 'U';
    st.sentries[0].pos = 'S'; st.sentries[0].loop = ['S'];
    st.sentries[1].pos = 'W'; st.sentries[1].loop = ['W'];
  });
  let freed = false;
  for (let i = 0; i < 3 && h.state.status === 'playing'; i++) {
    h.state.heat = 0; ok(E.endTurn(h));
    if (E.legalMoves(h).length) { freed = true; break; }
  }
  assert.ok(freed, 'a doorway opens within 3 phases');
});

test('Extract is a free action: it uses no action, but needs one left', () => {
  const g = setup(job01, st => { st.player = 'V'; st.sentries[0].pos = 'D'; });
  assert.equal(g.state.actions, 2);
  ok(E.extract(g));
  assert.equal(g.state.actions, 2, 'Extract is free');
  const h = setup(job01, st => { st.player = 'V'; st.sentries[0].pos = 'D'; st.actions = 0; });
  assert.equal(E.canExtract(h), false, 'out of actions: end the turn first');
  assert.equal(E.extract(h).ok, false);
});

test('BREACH: a resting Sentry whose patrol is blocked steps aside rather than seal you in', () => {
  // Job 02: player on WIFI (exit MAIL-02 next door). A camps MAIL-02 and its
  // patrol step (to CAM-03) is blocked by B, so it steps aside instead.
  const g = setup(job02, st => {
    st.breach = true; st.breachTurn = 1; st.hasData = true; st.exit = 'M';
    st.player = 'W'; st.sentries[0].pos = 'M'; st.sentries[0].cooldown = true;
    st.sentries[0].loop = ['C', 'M']; st.sentries[0].loopIndex = 0;
    st.sentries[1].pos = 'C'; st.sentries[1].stun = 2;
  });
  const it = sentry(g, 'A').intent;
  assert.equal(it.type, 'move');
  assert.notEqual(it.target, 'W');
  assert.notEqual(it.target, 'C');
  ok(E.endTurn(g));
  assert.notEqual(sentry(g, 'A').pos, 'M');
  ok(E.move(g, 'M'));
  assert.equal(g.state.status, 'won');
});

test('BREACH: a player on UNKNOWN has no Sentry path, so Sentries patrol (rule 5)', () => {
  const g = setup(job02, st => {
    st.breach = true; st.breachTurn = 1; st.hasData = true; st.exit = 'P';
    st.player = 'U'; st.ai.trusted = true; st.extraLinks.push(['U', 'S']);
    st.sentries[0].pos = 'H'; st.sentries[1].pos = 'C';
  });
  g.state.sentries.forEach(s => {
    assert.equal(s.intent.why, 'patrol');
    assert.notEqual(s.intent.target, 'U');
  });
});

test('BREACH: two Sentries on UNKNOWN\'s doorways scan, then move on, so the room is never sealed', () => {
  const g = setup(job02, st => {
    st.breach = true; st.breachTurn = 1; st.hasData = true; st.exit = 'P';
    st.player = 'U'; st.ai.trusted = true; st.extraLinks.push(['U', 'S']);
    st.sentries[0].pos = 'S'; st.sentries[1].pos = 'W';
  });
  assert.deepEqual(E.legalMoves(g), []);
  // Rule 4 reaches into UNKNOWN: both doorway Sentries scan you.
  g.state.sentries.forEach(s => assert.deepEqual(s.intent, { type: 'scan', target: 'U', why: 'player', atPlayer: true }));
  const r = ok(E.endTurn(g));
  assert.equal(r.events.filter(e => e.kind === 'scan' && e.hit).length, 2);
  // Resting next to a node they can't path to, they patrol instead of camping.
  g.state.sentries.forEach(s => {
    assert.equal(s.intent.type, 'move');
    assert.equal(s.intent.why, 'patrol');
  });
  ok(E.endTurn(g));
  assert.equal(g.state.status, 'playing');
  assert.ok(E.legalMoves(g).length > 0, 'a doorway is open again');
});

test('BREACH: a resting Sentry never camps the active exit', () => {
  // Job 01: exit WIFI (D). Player on CAM (C), next to D. Sentry on D, resting.
  const g = setup(job01, st => {
    st.breach = true; st.breachTurn = 1; st.hasData = true; st.exit = 'D';
    st.player = 'C'; st.sentries[0].pos = 'D'; st.sentries[0].cooldown = true;
  });
  const it = sentry(g, 'A').intent;
  assert.equal(it.type, 'move');
  assert.notEqual(it.target, 'C');
  ok(E.endTurn(g));
  assert.notEqual(sentry(g, 'A').pos, 'D');
  ok(E.move(g, 'D'));
  assert.equal(g.state.status, 'won');
});

test('undo cannot bring back a lost or won run', () => {
  const g = setup(job01, st => { st.player = 'V'; st.heat = 9; st.sentries[0].pos = 'D'; st.sentries[0].stun = 9; });
  ok(E.extract(g));
  assert.equal(g.state.status, 'lost');
  assert.equal(E.undo(g).ok, false);
  assert.equal(g.state.status, 'lost');
  const w = setup(job01, st => {
    st.player = 'G'; st.hasData = true; st.breach = true; st.breachTurn = 1; st.exit = 'D';
    st.sentries[0].pos = 'V'; st.sentries[0].stun = 9;
  });
  ok(E.move(w, 'D'));
  assert.equal(w.state.status, 'won');
  assert.equal(E.undo(w).ok, false);
  assert.equal(w.state.status, 'won');
});

// ---------- 8. heat: trace clock ----------

test('trace clock: no heat on the Extract turn, +1 every upkeep after', () => {
  const g = setup(job01, st => { st.player = 'V'; st.sentries[0].pos = 'D'; st.sentries[0].stun = 9; });
  ok(E.extract(g));
  assert.equal(E.tracing(g), false);
  let r = ok(E.endTurn(g));
  assert.equal(g.state.heat, 1, 'only Extract heat');
  assert.equal(find(r, 'traceStart'), undefined);
  assert.equal(E.tracing(g), true);
  r = ok(E.endTurn(g));
  assert.equal(g.state.heat, 2);
  assert.ok(find(r, 'traceStart'));
  assert.equal(find(r, 'traceStart').phase, 'upkeep');
  assert.deepEqual((({ cause, amount, phase }) => ({ cause, amount, phase }))(find(r, 'heat')), { cause: 'trace', amount: 1, phase: 'upkeep' });
  r = ok(E.endTurn(g));
  assert.equal(g.state.heat, 3);
  assert.equal(find(r, 'traceStart'), undefined, 'announced once');
});

test('no admin trace before BREACH, and the job drops after the limit', () => {
  const g = setup(job01, st => { st.player = 'E'; st.turn = 8; st.sentries[0].stun = 9; });
  ok(E.endTurn(g)); ok(E.endTurn(g));
  assert.equal(g.state.heat, 0, 'v1 last-3-turns trace is gone');
  assert.equal(E.tracing(g), false);
  const r = ok(E.endTurn(g));
  assert.equal(g.state.status, 'lost');
  assert.equal(g.state.reason, 'dropped');
  assert.equal(find(r, 'lose').reason, 'dropped');
});

test('enemy and upkeep events are tagged with their phase', () => {
  const g = setup(job01, st => { st.player = 'V'; st.sentries[0].pos = 'D'; });
  ok(E.extract(g));
  ok(E.endTurn(g));
  const r = ok(E.endTurn(g));
  r.events.forEach(e => assert.ok(e.phase === 'enemy' || e.phase === 'upkeep', e.kind));
  r.events.filter(e => e.phase === 'enemy' && e.kind !== 'lose').forEach(e => assert.ok(e.sentry, e.kind));
  r.events.forEach(e => assert.equal(typeof e.text, 'string'));
});

// ---------- 11. payout and stars ----------

test('payout arithmetic', () => {
  const g = setup(job01, st => { st.heat = 3; st.cash = 200; st.turn = 5; });
  const p = E.payout(g);
  assert.deepEqual(p.lines.map(l => [l.id, l.amount]), [['base', 400], ['caches', 200], ['speed', 150], ['heat', -120]]);
  assert.equal(p.total, 630);
  assert.equal(p.cut, 0);
  assert.equal(p.par, 450);
  assert.deepEqual(p.lines.map(l => l.label), ['Contract', 'Caches', 'Turns to spare', 'Heat']);

  // One deal: 950 * 0.75 = 712.5 -> rounds to 710, so the cut line is -240
  // and the lines add up to the total exactly.
  const h = setup(job02, st => { st.cash = 100; st.turn = 7; st.ai.deals = 1; });
  const q = E.payout(h);
  assert.equal(q.lines[4].id, 'cut');
  assert.equal(q.lines[4].amount, -240);
  assert.equal(q.cut, -240);
  assert.equal(q.total, 710);
  assert.equal(q.lines.reduce((a, l) => a + l.amount, 0), q.total, 'line items add up to the payout');
  h.state.ai.deals = 2;
  assert.equal(E.payout(h).total, 480); // 950 - 475 = 475 -> 480

  // Floored at 0.
  const z = setup(job01, st => { st.heat = 9; st.turn = 10; });
  z.job.payout.base = 0;
  assert.equal(E.payout(z).total, 0);
});

test('par comes from newGame opts, then the job', () => {
  const g = E.newGame(job01, { par: 500 });
  assert.equal(E.payout(g).par, 500);
  const copy = { job: g.job, state: E.clone(g.state), undoStack: [] }; // tools copy games like this
  assert.equal(E.payout(copy).par, 500);
  assert.equal(E.payout(E.newGame(job02)).par, 800);
});

test('stars are decoupled: out, PAR, bonus', () => {
  // High par: escaped and ghost, but under par.
  const g = E.newGame(job01, { par: 5000 });
  play(g, CANON.job01);
  const s = E.stars(g);
  assert.deepEqual([s.escaped, s.par, s.bonus, s.count], [true, false, true, 2]);

  // Scanned once: ghost lost, but still over par.
  const h = setup(job01, st => { st.player = 'V'; st.sentries[0].pos = 'D'; st.detected = true; });
  ok(E.extract(h));
  h.state.player = 'C'; h.state.sentries[0].pos = 'V'; E.replan(h);
  ok(E.move(h, 'D'));
  const t = E.stars(h);
  assert.deepEqual([t.escaped, t.par, t.bonus, t.count], [true, true, false, 2]);
  assert.equal(E.bonusMet(h), false);

  // Not escaped: no stars at all.
  const n = E.newGame(job01);
  assert.equal(E.stars(n).count, 0);
  assert.equal(E.bonusMet(n), true, 'live chip: ghost still possible');
});

// ---------- 12. variants ----------

test('canonicalVariant and newGame default to the canonical layout', () => {
  assert.deepEqual(E.canonicalVariant(job01), { id: 'v00', bag: { Y: 'cash', X: 'honeypot' }, offsets: { A: 0 }, exit: 0 });
  assert.deepEqual(E.canonicalVariant(job02), { id: 'v00', bag: { Q: 'cash', T: 'honeypot', H: 'charge' }, offsets: { A: 2, B: 0 }, exit: 0 });
  // Job 02's first-run phase (canonicalOffsets): A starts on SWITCH, heading for FIREWALL.
  const a = E.newGame(job02);
  assert.equal(a.state.sentries[0].pos, 'S');
  assert.equal(a.state.sentries[0].intent.target, 'F');
  assert.equal(a.state.sentries[1].pos, 'M');
  const b = E.newGame(job02, { variant: E.canonicalVariant(job02) });
  assert.deepEqual(a.state, b.state);
  assert.deepEqual(a.job, b.job);
  // A resolved job passed back in is used as-is.
  const c = E.newGame(a.job);
  assert.deepEqual(c.state, a.state);
});

test('resolveJob applies a non-canonical variant without touching jobs.js', () => {
  const before = JSON.stringify(job01);
  const v = { id: 'v07', bag: { Y: 'honeypot', X: 'cash' }, offsets: { A: 3 }, exit: 1 };
  const j = E.resolveJob(job01, v);
  assert.equal(JSON.stringify(job01), before, 'deep clone');
  const Y = E.nodeDef(j, 'Y'); const X = E.nodeDef(j, 'X');
  assert.equal(Y.type, 'honeypot'); assert.equal(Y.hidden, true); assert.equal(Y.cache, undefined);
  assert.equal(X.type, 'node'); assert.equal(X.hidden, true); assert.deepEqual(X.cache, { kind: 'cash' });
  assert.deepEqual(E.nodeDef(j, 'G').cache, { kind: 'cash' }, 'visible cache');
  assert.equal(j.sentries[0].start, 'H');
  assert.equal(j.sentries[0].loopIndex, 3);
  assert.equal(j.exitIndex, 1);
  assert.equal(j.variantId, 'v07');

  const g = E.newGame(job01, { variant: v });
  assert.equal(sentry(g, 'A').pos, 'H');
  assert.deepEqual(sentry(g, 'A').intent, { type: 'move', target: 'V', why: 'patrol', atPlayer: false });
  assert.equal(g.state.variantId, 'v07');
  g.state.player = 'B'; E.replan(g);
  const r = ok(E.move(g, 'Y'));
  assert.equal(find(r, 'reveal').trap, true);
  assert.equal(g.state.heat, 4);
});

test('resolveJob: Job 02 bag swap moves the charge and rewrites the AI {trap} text', () => {
  const v = { id: 'v12', bag: { Q: 'honeypot', T: 'charge', H: 'cash' }, offsets: { A: 2, B: 3 }, exit: 1 };
  const j = E.resolveJob(job02, v);
  assert.equal(E.nodeDef(j, 'Q').type, 'honeypot');
  assert.deepEqual(E.nodeDef(j, 'T').cache, { kind: 'charge', prog: 'brute' });
  assert.equal(E.nodeDef(j, 'T').type, 'node');
  assert.deepEqual(E.nodeDef(j, 'H').cache, { kind: 'cash' });
  assert.deepEqual(j.sentries.map(s => s.start), ['S', 'W']);
  assert.equal(j.exits[j.exitIndex], 'M');
  const sc = j.ai.offers.find(o => o.id === 'shortcut');
  assert.equal(sc.voice, 'the backup is bait. come through me and i’ll open the switch.');
  assert.equal(j.ai.offer, sc.voice);
  const canon = E.resolveJob(job02, E.canonicalVariant(job02));
  assert.match(canon.ai.offers[0].voice, /^the ledger is bait/);
  assert.ok(!JSON.stringify(canon.ai).includes('{trap}'));
});

test('re-resolving an already-resolved job with another variant names the new trap', () => {
  const g1 = E.newGame(job02);
  assert.match(g1.job.ai.offers[0].voice, /^the ledger is bait/);
  const v = { id: 'vq', bag: { Q: 'honeypot', T: 'charge', H: 'cash' }, offsets: {}, exit: 0 };
  const g2 = E.newGame(g1.job, { variant: v });
  assert.equal(E.nodeDef(g2.job, 'Q').type, 'honeypot');
  assert.match(g2.job.ai.offers[0].voice, /^the backup is bait/);
  assert.equal(g2.job.ai.offer, g2.job.ai.offers[0].voice);
});

// ---------- 13. AI deals ----------

test('the AI offers the shortcut once; trusting opens it for a 25% cut', () => {
  const g = setup(job02, st => { st.player = 'R'; st.sentries[1].pos = 'C'; st.sentries[1].loopIndex = 2; });
  const r = ok(E.move(g, 'W'));
  assert.equal(g.state.ai.pending, 'shortcut');
  const offer = find(r, 'aiOffer');
  assert.equal(offer.offer, 'shortcut');
  assert.match(offer.voice, /ledger is bait/);
  assert.match(offer.terms, /takes 25% of the payout, and PAR drops by the same share\./);
  assert.doesNotMatch(offer.terms, /another|\{/);
  assert.equal(E.move(g, 'R').ok, false, 'must answer first');
  assert.equal(E.endTurn(g).ok, false, 'must answer first');
  assert.equal(E.undo(g).ok, false, 'an offer you have read cannot be undone away');
  assert.equal(g.state.ai.pending, 'shortcut');
  const a = ok(E.answerAI(g, true));
  assert.deepEqual((({ offer, trust }) => ({ offer, trust }))(find(a, 'ai')), { offer: 'shortcut', trust: true });
  assert.equal(g.state.ai.pending, null);
  assert.equal(g.state.ai.deals, 1);
  assert.equal(g.state.ai.answers.shortcut, 'trusted');
  assert.match(find(a, 'ai').text, /It takes 25%\./);
  assert.equal(E.undo(g).ok, false, 'answering clears Undo');
  assert.ok(E.legalMoves(g).includes('U'));
  ok(E.move(g, 'U'));
  assert.ok(E.legalMoves(g).includes('S') || E.sentryAt(g, 'S'));
  assert.equal(E.undo(g).ok, true);
  assert.equal(g.state.ai.trusted, true, 'undo cannot take back the answer');
  const p = E.payout(g);
  assert.equal(p.lines.find(l => l.id === 'cut').amount, Math.round((700 + 330) * 0.75 / 10) * 10 - (700 + 330));
  assert.equal(p.lines.reduce((a, l) => a + l.amount, 0), p.total, 'line items add up to the payout');
  // No second shortcut offer.
  g.state.actions = 2;
  ok(E.move(g, 'R')); ok(E.move(g, 'W'));
  assert.equal(g.state.ai.pending, null);
});

test('refusing the AI costs nothing', () => {
  const g = setup(job02, st => { st.player = 'R'; st.sentries[1].pos = 'C'; st.sentries[1].loopIndex = 2; st.sentries[0].stun = 9; st.sentries[1].stun = 9; });
  ok(E.move(g, 'W'));
  const a = ok(E.answerAI(g, false));
  assert.equal(find(a, 'ai').trust, false);
  assert.equal(g.state.ai.answers.shortcut, 'refused');
  assert.equal(g.state.ai.refused, true);
  assert.equal(E.legalMoves(g).includes('U'), false);
  ok(E.move(g, 'R'));
  ok(E.endTurn(g)); ok(E.endTurn(g)); ok(E.endTurn(g));
  assert.equal(g.state.heat, 0, 'no tip-off');
  assert.equal(g.state.ai.deals, 0);
  assert.equal(E.payout(g).cut, 0);
  assert.equal(E.HEAT.tip, 0);
});

test('the freeze offer comes on Extract; trusting stuns every Sentry for 1 phase', () => {
  const g = setup(job02, st => { st.player = 'V'; st.sentries[1].pos = 'K'; st.ai.deals = 1; st.ai.trusted = true; });
  const r = ok(E.extract(g));
  assert.deepEqual(kinds(r), ['extract', 'heat', 'breach', 'aiOffer']);
  assert.equal(find(r, 'aiOffer').offer, 'freeze');
  assert.equal(g.state.ai.pending, 'freeze');
  assert.equal(E.endTurn(g).ok, false);
  assert.ok(g.state.sentries.some(s => s.intent.why === 'hunt' || s.intent.why === 'player'));
  const a = ok(E.answerAI(g, true));
  assert.equal(a.events.filter(e => e.kind === 'stun' && e.by === 'ai').length, 2);
  assert.equal(g.state.ai.deals, 2);
  g.state.sentries.forEach(s => { assert.equal(s.stun, 1); assert.equal(s.intent.type, 'stunned'); });
  const posBefore = g.state.sentries.map(s => s.pos);
  const e = ok(E.endTurn(g));
  assert.deepEqual(g.state.sentries.map(s => s.pos), posBefore, 'frozen for the phase');
  assert.ok(e.events.every(x => x.kind !== 'sentryMove'));
  assert.ok(g.state.sentries.every(s => s.intent.type !== 'stunned'), 'back to hunting');
  assert.equal(E.payout(g).lines.find(l => l.id === 'cut').amount < 0, true);
});

test('offer terms say "another" only after a deal was taken', () => {
  const g = setup(job02, st => { st.player = 'V'; st.sentries[1].pos = 'K'; });
  const r = ok(E.extract(g));
  const offer = find(r, 'aiOffer');
  assert.equal(offer.offer, 'freeze');
  assert.match(offer.terms, /UNKNOWN takes 25%, and PAR drops by the same share\./);
  assert.doesNotMatch(offer.terms, /another/);
  const a = ok(E.answerAI(g, true));
  assert.match(find(a, 'ai').text, /It takes 25%\./);
  assert.equal(E.payout(g).lines.find(l => l.id === 'cut').amount < 0, true);

  const h = setup(job02, st => { st.player = 'V'; st.sentries[1].pos = 'K'; st.ai.deals = 1; st.ai.answers.shortcut = 'trusted'; st.ai.trusted = true; });
  const r2 = ok(E.extract(h));
  assert.match(find(r2, 'aiOffer').terms, /takes another 25%, and PAR drops/);
  assert.equal(E.offerTerms(h, 'freeze'), find(r2, 'aiOffer').terms);
  const a2 = ok(E.answerAI(h, true));
  assert.match(find(a2, 'ai').text, /It takes another 25%\./);
});

test('the cut is per offer (25% each, as specced), and PAR drops by the same share', () => {
  const g = setup(job02, st => { st.cash = 100; st.turn = 7; st.ai.deals = 1; st.ai.answers.shortcut = 'trusted'; }, { par: 800 });
  // 950 * 0.75 = 712.5 -> 710, so the cut line is -240. PAR 800 * 0.75 = 600.
  assert.equal(E.payout(g).cut, -240);
  assert.equal(E.payout(g).total, 710);
  assert.equal(E.payout(g).par, 600);
  assert.equal(E.payout(g).basePar, 800);
  g.state.ai.deals = 2; g.state.ai.answers.freeze = 'trusted';
  // 950 * 0.50 = 475 -> 480; PAR 400.
  assert.equal(E.payout(g).total, 480);
  assert.equal(E.payout(g).par, 400);
  // Refusing keeps the full PAR.
  const h = setup(job02, st => { st.cash = 100; st.turn = 7; }, { par: 800 });
  assert.equal(E.payout(h).par, 800);
});

test('a trusted run that clears its lowered PAR earns ★2', () => {
  // A won run worth 950 before the cut: 710 after a 25% cut, under the full
  // PAR of 800 but over the lowered 600.
  const g = setup(job02, st => { st.cash = 100; st.turn = 7; st.ai.deals = 1; st.ai.answers.shortcut = 'trusted'; st.status = 'won'; st.hasData = true; }, { par: 800 });
  const s = E.stars(g);
  assert.equal(s.par, true);
  g.state.turn = 12; g.state.heat = 8; // 700 + 100 - 320 = 480 -> 360 after the cut
  assert.equal(E.stars(g).par, false);
});

test('refusing the freeze leaves the hunt running', () => {
  const g = setup(job02, st => { st.player = 'V'; st.sentries[1].pos = 'K'; });
  ok(E.extract(g));
  ok(E.answerAI(g, false));
  assert.equal(g.state.ai.answers.freeze, 'refused');
  assert.equal(g.state.ai.deals, 0);
  assert.ok(g.state.sentries.every(s => s.stun === 0));
});

test('Sentries never enter the AI node, but scan a player on it from next door', () => {
  const g = setup(job02, st => {
    st.player = 'U'; st.ai.trusted = true; st.ai.offered = true; st.extraLinks.push(['U', 'S']);
    st.sentries[0].pos = 'S'; st.sentries[1].pos = 'C';
  });
  // A on SWITCH is next to UNKNOWN (through the trusted link): rule 4 applies.
  assert.deepEqual(sentry(g, 'A').intent, { type: 'scan', target: 'U', why: 'player', atPlayer: true });
  const r = ok(E.endTurn(g));
  assert.ok(r.events.some(e => e.kind === 'heat' && e.cause === 'scan'));
  for (let t = 0; t < 8 && g.state.status === 'playing'; t++) {
    g.state.sentries.forEach(s => assert.ok(!(s.intent.type === 'move' && s.intent.target === 'U')));
    ok(E.endTurn(g));
    g.state.sentries.forEach(s => assert.notEqual(s.pos, 'U'));
  }
});

// ---------- API surface ----------

test('every v1 export still exists and the v2 exports are added', () => {
  const v1 = ['HEAT_MAX', 'ACTIONS_PER_TURN', 'HEAT', 'PROGRAMS', 'PROGRAM_ORDER', 'STAR_HEAT', 'TRACE_TURNS',
    'newGame', 'nodeDef', 'neighbors', 'allLinks', 'sentryAt', 'isClosed', 'isBarrier', 'legalMoves', 'programTargets',
    'canRun', 'canExtract', 'threats', 'tracing', 'stars', 'move', 'runProgram', 'extract', 'undo', 'answerAI',
    'abort', 'endTurn', 'replan', 'blockedReason', 'canAct', 'clone'];
  const v2 = ['ACTIONS_MAX', 'CACHE_VALUE', 'DECOY_RANGE', 'NOISE_RANGE', 'payout', 'bonusMet', 'exitInfo',
    'resolveJob', 'canonicalVariant', 'programCost'];
  [...v1, ...v2].forEach(k => assert.ok(k in E, k));
  assert.equal(E.NOISE_RANGE, 3);
});

test('the engine has no DOM references', () => {
  const src = fs.readFileSync(path.join(__dirname, '../js/engine.js'), 'utf8');
  assert.ok(!/\bdocument\b/.test(src), 'document');
  const win = src.split('\n').filter(l => /\bwindow\b/.test(l));
  assert.deepEqual(win.map(l => l.trim()), ['})(typeof window !== \'undefined\' ? window : globalThis);']);
});

// ---------- fuzz ----------

function randomVariant(job, rnd) {
  const contents = job.bag.contents.slice();
  for (let i = contents.length - 1; i > 0; i--) { const k = rnd(i + 1); [contents[i], contents[k]] = [contents[k], contents[i]]; }
  const bag = {}; job.bag.nodes.forEach((n, i) => { bag[n] = contents[i]; });
  const offsets = {}; job.sentries.forEach(s => { offsets[s.id] = rnd(s.patrol.length); });
  return { id: 'fz', bag, offsets, exit: rnd(2) };
}

test('random play on random variants never breaks the rules (fuzz)', () => {
  let seed = 12345;
  const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (const job of JOBS) {
    for (let run = 0; run < 400; run++) {
      const g = E.newGame(job, { variant: run === 0 ? undefined : randomVariant(job, rnd) });
      const entry = g.job.nodes.find(n => n.type === 'entry').id;
      for (let step = 0; step < 200 && g.state.status === 'playing'; step++) {
        const st = g.state;
        if (st.ai && st.ai.pending) { ok(E.answerAI(g, rnd(2) === 0)); continue; }
        const opts = [];
        E.legalMoves(g).forEach(n => opts.push(() => E.move(g, n)));
        Object.keys(st.charges).forEach(p => {
          if (!E.canRun(g, p)) return;
          if (E.PROGRAMS[p].target === 'self') opts.push(() => E.runProgram(g, p));
          else E.programTargets(g, p).forEach(t => opts.push(() => E.runProgram(g, p, t)));
        });
        if (E.canExtract(g)) opts.push(() => E.extract(g));
        if (g.undoStack.length) opts.push(() => E.undo(g));
        opts.push(() => E.endTurn(g));
        const r = ok(opts[rnd(opts.length)]());
        r.events.forEach(e => { assert.equal(typeof e.kind, 'string'); assert.equal(typeof e.text, 'string'); });
        const s = g.state;
        assert.ok(s.heat >= 0 && s.heat <= E.HEAT_MAX);
        assert.ok(s.actions >= 0 && s.actions <= E.ACTIONS_MAX);
        assert.ok(s.turn >= 1 && s.turn <= job.turnLimit);
        const spots = s.sentries.map(x => x.pos);
        assert.equal(new Set(spots).size, spots.length, 'two Sentries on one node');
        assert.ok(!spots.includes(s.player) || s.status !== 'playing', 'Sentry on the player');
        if (job.ai) assert.ok(!spots.includes(job.ai.node), 'Sentry on the AI node');
        Object.values(s.charges).forEach(c => assert.ok(c >= 0));
        if (s.breach) assert.ok(s.player !== entry || s.exit === entry, 'standing on burned ENTRY');
        if (s.status === 'won') { assert.ok(s.hasData); assert.equal(s.player, s.exit); }
        s.sentries.forEach(x => { if (x.intent && x.intent.target !== undefined) assert.equal(typeof x.intent.atPlayer, 'boolean'); });
        const p = E.payout(g);
        assert.ok(p.total >= 0 && p.total % 10 === 0);
      }
    }
  }
});

test('no softlock (fuzz): under this play policy, waiting frees a move within 3 enemy phases', () => {
  // Seeded random play on every shipped night, biased toward Extract and
  // toward hiding on UNKNOWN (the spot two Sentries could seal). At each turn
  // start, end turns in place (heat and turn reset so only Sentries matter)
  // until a legal move appears.
  // Scope: this is a regression guard for the trusted-UNKNOWN seal, not an
  // engine-wide guarantee. `unbox` does not stop two hunting Sentries from
  // trading places in a one-door pocket (e.g. CAM-03 with ENTRY burned, or
  // KIOSK with AUTH-01 locked): with heat and turn held down that can hold
  // the doorway shut indefinitely. In real play the trace clock and scans
  // end the run first (it's a death trap, not a softlock); see README rule 11.
  const V = require('../js/variants.js');
  let seed = 4242;
  const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return Math.floor(seed / 0x80000000 * n); };
  const B = require('../tools/beam.js');
  let checked = 0, worst = 0;
  for (const job of JOBS) {
    const t = V[job.id];
    for (let i = 0; i < 300; i++) {
      const g = E.newGame(job, { variant: t.variants[rnd(t.variants.length)], par: t.par }); g.state.log = [];
      const trust = rnd(2) === 0;
      for (let k = 0; k < 50 && g.state.status === 'playing'; k++) {
        const st = g.state;
        if (st.ai && st.ai.pending) { E.answerAI(g, trust); continue; }
        const acts = B.actionLabels(g);
        if (acts.includes('extract') && rnd(5)) { B.apply(g, 'extract'); continue; }
        if (acts.includes('>U') && rnd(3)) { B.apply(g, '>U'); continue; }
        if (!acts.length || rnd(4) === 0) {
          st.heat = Math.min(st.heat, 6);
          E.endTurn(g);
          if (g.state.status !== 'playing') break;
          const h = B.copy(g); let phases = 0;
          while (!E.legalMoves(h).length && phases <= 4) {
            h.state.heat = 0; h.state.turn = 1;
            if (h.state.ai && h.state.ai.pending) E.answerAI(h, false);
            E.endTurn(h); phases++;
          }
          checked++; worst = Math.max(worst, phases);
          assert.ok(phases <= 3, `${job.id}: boxed in for ${phases}+ phases at ${g.state.player}`);
          continue;
        }
        B.apply(g, acts[rnd(acts.length)]);
      }
    }
  }
  assert.ok(checked > 1000, 'enough positions checked (' + checked + ')');
});
