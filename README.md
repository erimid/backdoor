# Backdoor: hacking minigame prototype (v3 + hex jobs)

A throwaway prototype of the hacking minigame from the Backdoor game app. It
answers one question: **is hacking fun enough that you want another round?**

v2's shape is **get in, get greedy, get out**: sneak to the target, Extract,
then run for a different exit while the Sentries hunt you and the trace clock
ticks. Fifteen handmade jobs (the last five on hex boards) that get harder as you go, each with solver-checked
seeded variants:

| Job | Name | What's new | Bonus ★ |
| --- | --- | --- | --- |
| 01 | Corner Store POS | The tutorial: moving, scans, Brute, a honeypot, the BREACH run | Ghost |
| 02 | City Bank, Branch 7 | Every program, a lock with a password clue, UNKNOWN's deals | Worm stun |
| 03 | Suds & Spin Laundromat | **Cameras**: fixed, watch every linked node | Greedy (every $ cache) |
| 04 | Level 3 Parking Garage | A **ring** patrolled both ways; cut through the middle | Ghost |
| 05 | Channel 9 Newsroom | A lock whose code is across the map, **two** honeypots in three ? nodes | Fast (out by turn 9) |
| 06 | Greenleaf Pharmacy | Two patrols, a firewall, Decoy instead of Brute | Quiet (no Brute) |
| 07 | Golden Ace Casino | UNKNOWN returns, plus a camera and two patrols | Cool (heat ≤ 5) |
| 08 | Port of Harlow | Three patrols, two firewalls, two Decoys, the biggest board | Worm stun |
| 09 | Federal Reserve, Vault 4 | You **start at 2 heat**, a locked vault door, a camera, two patrols, three exits | Fast (out by turn 11) |
| 10 | Nimbus Data Center | Three cameras and a guard, **three** possible exits | Cool (heat ≤ 4) |
| 11 | Halcyon Hotel | **Hex board**: six-way links, a hole in the middle, a camera on the target | Ghost |
| 12 | Metro Transit Control | A guard circling six platforms round a gap, a lock with a password clue | Greedy |
| 13 | Orbis Genomics | UNKNOWN in the middle; the lock's code is in the far corner | Quiet (no Brute) |
| 14 | Aurora Exchange | Three cameras watch every way into the target; start at 1 heat; three exits | Fast (out by turn 10) |
| 15 | Helix Biobank | The finale: three guards, two cameras, two firewalls, a lock, three exits | Worm stun |

## Play it

Open `index.html` in a browser. There is no server and no build step. On a
phone, use the single-file build: `npm run build` writes `dist/backdoor.html`,
which you can open from anywhere.

Progress, best payouts and stars, and the playtest log are kept in the
browser's local storage.

## Commands

| Command | What it does |
| --- | --- |
| `npm test` | Every `tests/*.test.js`: engine rules, a replay of every variant's witness line, and the meta screens |
| `npm run validate` | Beam-searches every raw variant of every job, keeps the fair ones, sets par and rewrites `js/variants.js`. Prints a report. About 6 min on 4 cores (`--jobs job01` takes about 15 s; `--dry` doesn't write) |
| `npm run bot [-- job01]` | The "sensible first-timer" bot: 200 noisy seeds, win %, 3★ %, payout, and PASS/WARN against the targets. Options: `--variant N`, `--ai trust\|refuse\|random`, `--seeds N`, `--sentry-cost N` (comparison only; the reference bot uses the spec's weights), `--verbose`. `--sweep` plays every shipped night (30 seeds each by default) and reports win rates per exit; for Job 02 it compares trusting offer 1 with refusing it on each night |
| `npm run solve [-- job01]` | Exhaustive BFS solver (Job 01 takes about 3 min; Job 02 needs a node list, e.g. `npm run solve -- job02 ERWUSVPM`) |
| `npm run smoke` | Plays witness lines through the real UI in a 390 px wide browser (needs Playwright). `node tools/smoke.js --juice` runs the staged-feel checks at real timings instead (hit and dodge fx, skip, BREACH, reduced motion, coaching tips, the Extract-to-offer hands-off time) |
| `npm run sfx-check` | Checks the synth sounds, haptics and mute in a headless browser |
| `npm run build` | Inlines everything into `dist/backdoor.html` |

`node tools/beam.js [jobId] [K]` runs the beam search on a job's canonical variant.

## Code layout

| Path | What it is |
| --- | --- |
| `js/jobs.js` | Job definitions as plain data (nodes, links, Sentries, programs, clues, AI offers, exits, caches, the hidden-node bag, payout, bonus, tips, rules) |
| `js/variants.js` | **Generated** by `npm run validate`: the seeded variants that passed, with par and a witness line each |
| `js/engine.js` | The rules. No DOM, so it can be tested and reused in the full app |
| `js/ui.js` | Screens: job board, briefing, hacking board, AI offer, results, playtest log |
| `js/sfx.js` | WebAudio synth sounds and haptics, no asset files |
| `js/icons.js` | Inline SVG icons from the mockups |
| `css/style.css` | Colors, type and layout from the mockups |
| `tests/engine.test.js` | Rules tests |
| `tests/variants.test.js` | Replays every witness in `js/variants.js` and checks the win and stars |
| `tools/beam.js` | Turn-level beam search (dev tool only, never loaded in the browser) |
| `tools/validate.js` | Variant validator (uses the beam, runs on worker threads) |
| `tools/bot.js` | Greedy one-turn-lookahead bot |
| `tools/solver.js` | Exhaustive solver |
| `tools/smoke.js` | Browser smoke test |
| `tools/build.js` | Single-file build |

## Seeded variants

A variant is the bag assignment (what each hidden node holds), each Sentry's
starting offset on its patrol loop, and which exit BREACH opens: 24 raw
variants for Job 01 (2 × 6 × 2) and 192 for Job 02 (6 × 4 × 4 × 2).
`tools/validate.js` keeps a variant only if:

- (c) no Sentry starts on or next to ENTRY,
- (d) no turn-1 intent targets ENTRY,
- (a) a 3★ line exists at the job's par (that line is the variant's **witness**),
- (b) a win still exists with the witness's key node forbidden before Extract
  (the key node is the first firewall, lock, AI or honeypot node on the way in,
  else the first node after ENTRY), so every variant has a second route,
- (e) the first-timer bot (`tools/bot.js`, the spec's weights, refusing every
  AI offer) wins at least 25% of 100 seeded runs (200 on the canonical night),
  so "Tonight" never deals a night that is close to unwinnable for a new
  player. On Job 02 the bot also plays trusting offer 1 (refusing offer 2);
  that must also win at least 25%, and be within 25 points of refusing. (At
  50 seeds the trust/refuse gap is noisy, about ±10 points, so it now uses 100.)

**Par** is the 25th percentile of the variants' best payouts with the bonus
met, rounded down to $50, then lowered if needed so the canonical variant beats
it by at least $50. Variant `v00` is always the canonical layout (the
design-doc layout, used for the first run of a job). Its Sentry loop phase is
offset 0 unless the job sets `canonicalOffsets`: Job 02 sets Sentry A to 2
(it still starts on SWITCH but heads for FIREWALL first; see the bot section).

Each entry is `{ id, bag, offsets, exit, witness, best: { payout, stars, turn,
heat, routeKey }, alt: { forbid, routeKey, stars, payout } }`. The beam search
ranks states by `3 × distance + heat + 4 × detected − cash / 50` (+5 per AI
deal), keeps 60 (150 if that fails), and reserves a third of the beam for
states that already meet the bonus objective.

## Hex jobs (11 to 15)

Jobs 11 to 15 are drawn on a hexagonal board; Jobs 01 to 10 keep the square
grid. The engine is unchanged (it only ever saw nodes and links); the hex
parts are data and drawing.

- **Map.** A hex job in `js/jobs.js` gives `map` (one string per row, one
  token per cell, `.` for empty), `defs` (type, label, icon per id) and
  `cuts` (walls). `hexJob()` turns that into nodes and links: rows are
  pointy-top, odd rows shift half a cell right, and every pair of touching
  cells is linked unless cut. So a node has up to six links.
- **Size.** 24 to 32 nodes on 5 columns by 7 or 8 rows (the square boards had
  about 20). The board is still the phone's width and grows taller to fit;
  at 390 × 844 the tallest board and the dock fit without scrolling.
- **Checks.** Same validator, bot and smoke tests. `tests/hex.test.js` checks
  that every link joins touching cells, patrols step along links, and cuts
  work.

### Hex results

`npm run validate -- --jobs job11,...` and the spec bot (100 seeds, canonical
night, refusing every offer):

| Job | Nights shipped | PAR | Canonical best line | Sighted bot (median) | Spec bot win | ★2 | Turns on start node |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 11 | 32 / 32 | $1050 | 3★ $1130, turn 7 | 99% | 100% | 29% | 7% |
| 12 | 24 / 24 | $1350 | 3★ $1660, turn 6 | 100% | 95% | 35% | 12% |
| 13 | 16 / 16 | $1000 | 3★ $1300, turn 7 | 93% (trust 1: 95%) | 85% (trust 1: 89%) | 85% | 22% |
| 14 | 22 / 24 | $1500 | 3★ $1550, turn 10 | 71% | 57% | 1% | 18% |
| 15 | 24 / 24 | $1650 | 3★ $1930, turn 10 | 85% | 7% | 6% | 17% |

## v4 changes: more challenge

Six additions, all opt-in per job (data in `js/jobs.js`, rules in
`js/engine.js`), used on the hex jobs. Jobs 01 to 10 are unchanged.

1. **Alert levels** (`alerts`). When heat reaches an alert's level, the admin
   acts at the end of that turn: `spawn` adds a Sentry at the start of its
   patrol (never on or next to you), `lockdown` closes barriers again. The
   levels are marked **!** on the heat bar from turn 1, listed in the
   briefing, and the next one sits in the chip row, so nothing is a surprise.
   Early mistakes now make the rest of the job harder, not just cost $40.
2. **The Tracer** (`tracer: true`, `arrives: N` on a Sentry; Job 13). It logs
   in at ENTRY on turn N and walks your exact trail, one node a phase (loops
   you closed are skipped). You move two nodes a turn, so it only catches you
   if you stall or double back. It scans like any Sentry when next to you,
   can be lured and stunned, and hunts like the rest during BREACH. Its
   token has a dotted ring and the label TRAIL.
3. **Switches** (`switches`; Job 12's SWITCH). A switch node has two link
   sets, A and B; only the live set exists, for you and for Sentries.
   Stepping onto it flips it. Dead links are drawn as dark bridges. A Sentry
   whose shown step crosses a link that just went dark re-plans at once;
   every other intent stays as shown.
4. **Side files** (`file: true` on a node; Jobs 11 and 14). Extract on one
   (free, like the main Extract) for +$250. Every file you hold adds +1 to
   each BREACH trace tick, so two files mean +3 heat a turn on the way out.
5. **Loadout** (`loadout`; Jobs 14 and 15). Tap programs in the briefing to
   take `pick` of them from a pool. Two new programs: **Tunnel** (1 action:
   a permanent link from your node to one 2 hops away; Sentries can use it
   too) and **Freeze** (1 action: every Sentry and camera within 2 hops skips
   its next phase). The validator, bot and witnesses use the job's default
   pick, which is the old fixed set.
6. **Tighter Jobs 11 to 13.** Job 11: 10 turns (was 12), no Decoy, a third
   porter (D) patrols the middle. Job 12: 12 turns (was 14), no Worm. Job 13:
   12 turns (was 13), no Worm, plus the Tracer.

Tests: `tests/v4.test.js`. The bot and beam count a side file as about 4
heat (the trace it adds on a typical getaway), and de-duplicate on the new
state (`E.searchKey`).

### v4 results

V4_RESULTS

## v3 changes

Fixes for the five issues v2 left open, then eight new jobs.

1. **Refusing UNKNOWN pays again (Job 02).** PAR now drops by *half* of
   UNKNOWN's cut (trust offer 1 on a $800 PAR night: PAR $700, not $600), and
   the shortcut only lasts until you Extract (`untilExtract` on the offer:
   UNKNOWN pulls the link once you hold the data). Two new links, CAM-03–WIFI
   and ADMIN-PC–SWITCH, give the refused routes a second way round each
   Sentry. On the canonical night the spec bot now wins 54% refusing both
   deals (★2 28%) and 53% trusting offer 1 (★2 21%); trusting both wins
   most (84%) but never reaches ★2, so it is the safe way out, not the way
   to the stars.
2. **No more trust-only nights.** The validator's check (e) now also runs the
   spec bot (60 seeds, no Sentry cost) trusting and refusing offer 1, and
   rejects a night if the two are more than 25 points apart.
3. **Two hunters can't hold a dead-end doorway.** When the resting Sentry on
   a pocket's only doorway can't back off because the other hunter is behind
   it, the one behind yields to a free node and the resting one backs into
   its place (`untangle`, run in that order). And a node a Sentry just backed
   off from is not refilled by another Sentry in the same phase
   (`holdWindow`), so every scan really buys you a phase. The fuzz that found
   the v2 spells (0.8 to 1.2% of BREACH turn starts) now finds none
   (`tests/v3.test.js`).
4. **Less waiting in Job 02.** The same two links: turns ending on the start
   node drop from about 29% to about 20% on the canonical night (20.2%
   refusing, 20.4% trusting offer 1; the target is 20%, so this is right at
   the line).
5. **Fewer idle slots in Job 01.** TILL-1 now holds a $100 cache (a use for
   the action you would have banked), and when two witness lines tie on
   payout, stars and turn, the beam keeps the one that idles less. Unused
   slots: 28.8% to 14.7%.

New rules for the new jobs (all in `js/engine.js`, data in `js/jobs.js`):

- **Cameras** (`camera: true` on a Sentry, square token, label CAM). A camera
  never moves and can't be lured, heard or Worm-stunned. It watches every node
  linked to it (dotted rings): end a turn on one and it scans you (+3, Spoof
  holds), then rests a phase. Passing through is fine.
- **Bonus objectives**: Greedy (every $ cache, hidden ones included), Quiet
  (never Brute), Fast (out by turn N), Cool (heat ≤ N at the end), plus v2's
  Ghost and Worm stun. The chip for one you can lose (Ghost, Quiet, Fast,
  Cool) starts lit and goes out when you lose it.
- **Start heat** (`startHeat`, Job 09).
- **Dealt offsets** (`offsets` on a Sentry): only those loop points are dealt
  as variants, so long ring patrols don't multiply the variant count.

### v3 results

`npm run validate` (all ten jobs, about 45 min on 4 cores) and the spec bot
(`npm run bot`, 100 seeds, canonical night, refusing every offer; "trust 1"
trusts offer 1 only):

| Job | Nights shipped | PAR | Canonical best line | Spec bot win | ★2 | Turns on start node |
| --- | --- | --- | --- | --- | --- | --- |
| 01 | 24 / 24 | $550 | 3★ $640, turn 4 | 100% | 33% | 17% |
| 02 | 94 / 192 | $850 | 3★ $970, turn 7 | 54% (trust 1: 53%, trust both: 84%) | 28% (trust 1: 21%, both: 0%) | 20% |
| 03 | 23 / 24 | $750 | 3★ $840, turn 6 | 87% | 0% | 19% |
| 04 | 49 / 64 | $650 | 3★ $730, turn 9 | 78% | 76% | 25% |
| 05 | 92 / 96 | $1200 | 3★ $1330, turn 7 | 77% | 18% | 26% |
| 06 | 64 / 64 | $800 | 3★ $870, turn 6 | 56% | 1% | 22% |
| 07 | 42 / 64 | $1050 | 3★ $1100, turn 6 | 48% (trust 1: 49%) | 44% (trust 1: 14%) | 12% |
| 08 | 58 / 64 | $1400 | 3★ $1530, turn 8 | 30% | 5% | 31% |
| 09 | 43 / 48 | $1600 | 3★ $1650, turn 8 | 22% | 2% | 33% |
| 10 | 16 / 24 | $800 | 3★ $870, turn 8 | 8% | 0% | 48% |

Every shipped night has a 3★ witness line at PAR, a second route, and a
sighted-bot win rate of at least 25% (check e). The spec bot's ★2 is low on
some jobs because its greedy play rarely beats PAR; the stars are for
players who plan. The sections "What the validator found" and "What the bot
found" further down are the v2 write-up, kept for history.

## Rules: where v2 differs from the design doc

These are the places where the build differs from, or adds to, the game
design document. Each one is easy to undo in `js/jobs.js` or `js/engine.js`.

1. **BREACH.** Extract is the climax, not the halfway point: ENTRY burns, one
   of two dashed gold exit candidates opens as the EXIT, every Sentry replans
   at once and **hunts** you (one telegraphed step along the shortest path),
   and you win by standing on the exit with the data. Which exit opens is part
   of the variant; Sniff or Extract reveals it.
2. **The trace clock** replaces the doc's "admin traces you on the last 3
   turns": from the upkeep after the Extract turn, +1 heat every turn.
3. **Overclock.** End a turn with actions left and the next turn has 3 actions
   (bank at most 1). Waiting is a sprint, not a lost turn.
4. **Loud Brute.** Brute costs 2 actions and opens the barrier instantly
   (+1 heat), instead of a 2-phase timer. It sends a noise pulse: Sentries
   within 3 hops come to look for one enemy phase.
5. **Single-target Decoy.** It lures only the nearest Sentry within 3 hops
   (ties go to Sentry order); an unclaimed decoy is picked up at the next
   replan. A lure beats noise and hunt.
6. **Caches, payout and stars.** Caches are picked up by entering: $100, or $200
   during BREACH ("hot data"), or a spare program charge. Every hidden node is
   now either loot or a trap. Payout = contract + caches − $40 × heat + $30 ×
   spare turns, minus UNKNOWN's cut. Stars are decoupled: ★ escaped, ★ payout
   ≥ par, ★ the job's bonus (Job 01 Ghost: never scanned or bumped; Job 02: stun
   a Sentry with a Worm). Heat no longer costs stars directly.
7. **AI deals.** Refusing UNKNOWN is free (the v1 tip-off heat is gone).
   Trusting costs a 25% cut of the payout per deal, as specced, **and PAR
   drops by half that share** (v3; rounded down to $10): trust offer 1 on a
   $800 PAR night and your PAR is $700. (v2 dropped it by the whole share.) The cut costs you dollars (best payout,
   NEW BEST), not the stars. Without the PAR change almost no trusted run
   could reach ★2, even played perfectly (the canonical night's best trusted
   line paid $730 against PAR $800), so trusting was a trap, not a price. An
   earlier build cut offer 1 to 15% instead; that still left ★2 out of reach
   for most trusted runs. The terms only say "another" once a deal has been
   taken. Offer 1 (next to UNKNOWN) names this variant's real honeypot and
   opens UNKNOWN–SWITCH; offer 2 (on Extract) freezes every Sentry for one
   enemy phase. The cut is only taken from a positive subtotal, so it never
   adds money.
8. **Final reveals.** Undo is cleared by entering a hidden node, by Sniff, by
   answering the AI, by Extract (it reveals the exit) and by the end of the
   turn. Sniff also reveals which exit BREACH will open, and can run while the
   exit is unknown even if nothing is hidden nearby.
9. **Job 01 patrol and link.** The Sentry patrols G→D→G→H→V→H (it sweeps both
   the left corridor and the target), there is a new SALES DB–SWITCH link (V–G)
   so the target isn't a dead end under hunt, and the CAM-01–SWITCH link from
   v1 stays. 10 turns, Sniff 1, Spoof 1, Brute 1. Exits WIFI or TILL-2.
10. **A Sentry never scans you two enemy phases in a row, and during BREACH
    a resting Sentry backs off.** A Sentry next to you that is resting (it
    scanned you last phase) doesn't stand still (the spec's rule 6 said
    `wait`): it steps back to a free node that is not next to you and is not
    the exit, the farthest from you first (`why: 'retreat'`, drawn as a plain
    move arrow, token label "rest"). Every scan therefore buys you one phase
    to slip past it, and it hunts you again the phase after. With nowhere to
    back off to, it takes its patrol step (which can mean walking into you, a
    telegraphed bump you can dodge); if that is blocked too while the
    Sentries cut off every route to the exit, it steps aside to reopen one.
    With `wait`, a Sentry on the exit or on a chokepoint (Job 01's SWITCH, the
    only way from SALES DB to WIFI) alternated scan and rest forever. The
    previous build sent it back to its patrol instead, which on Job 01's
    canonical night still left it on SWITCH or WIFI most of the time.
11. **Sentries can't enter the AI node, but they scan it, and they can never
    box you in.** A Sentry next to a player on UNKNOWN scans them like
    anywhere else (spec rule 4). During BREACH there is no Sentry path into
    UNKNOWN, so Sentries patrol (rule 5, "if there is no path, patrol"). On
    top of that, a general no-softlock rule (`unbox` in the engine): if
    Sentries are why you can't move at all and none of them is about to
    leave, the first resting one steps off to a free node. A Sentry that
    isn't resting scans first and rests the phase after, so you are never
    boxed in for more than two enemy phases (three behind a stunned one).
    Two Sentries on UNKNOWN's two doorways used to be able to seal you in.
    `tests/engine.test.js` fuzzes this (seeded random play on every shipped
    night, biased toward hiding on UNKNOWN): from every reachable turn start,
    waiting frees a move within 3 enemy phases. On the previous rules the
    same test finds a Job 02 position boxed in for 5+ phases.
    v2's known limit, two hunters holding a one-door pocket during BREACH,
    is fixed in v3 (see "v3 changes", item 3).
12. **Extract is a free action.** It uses no action (you still need one left,
    like everything else in a turn), so the turn you download the data you
    can start running. With Extract costing an action, the greedy bot spent
    the BREACH's first turn standing on the target while the hunter took the
    chokepoint between it and the exit; on Job 01's canonical night that was
    the largest share of its "waiting" turns.
13. **"Open node" for Decoy and Worm** means a linked node you could stand on
    with no Sentry on it. Decoy and Worm can share a node.
14. **Self programs (Sniff, Spoof) run as soon as you tap them.** Targeted
    programs (Decoy, Worm, Brute) highlight their targets first.
15. **Player-planted badges (DECOY, WORM) are cyan**, not violet, because
    violet means the rogue AI.

One `js/jobs.js` tuning change: Job 02's canonical Sentry A phase
(`canonicalOffsets: { A: 2 }`, the spec's tuning lever 4) to bring the
trust/refuse gap for offer 1 inside 25 points. The variant pool is the same.

## What the validator found

From `npm run validate` (deterministic):

| Job | Variants accepted | Par | Canonical (v00) | Median witness turn | Rejected |
| --- | --- | --- | --- | --- | --- |
| 01 | 22 / 24 | $550 | 3★ $640, turn 4, heat 1 (slip) | 5 | 2 no 3★ line at par |
| 02 | 97 / 192 | $800 | 3★ $860, turn 8, heat 4 (AUTH-01) | 7 | 48 Sentry next to ENTRY, 6 no 3★ line at par, 41 bot check (e) |

Best result per route class on the canonical variant (each probe forbids the
key nodes of the lines above it):

| Job | Route | Best |
| --- | --- | --- |
| 01 | Slip past the patrol (CAM-01, SWITCH) | 3★ $640, heat 1, turn 4 |
| 01 | Through BACKUP (honeypot) | 3★ $680, heat 5, turn 4 |
| 01 | Brute the firewall | 3★ $640, heat 2, turn 6 |
| 02 | Left (password at MAIL-02, AUTH-01) | 3★ $860, heat 4, turn 8 |
| 02 | AI shortcut (trust, then UNKNOWN–SWITCH) | 3★ $680 (PAR after the cut $600), heat 8, turn 8 |
| 02 | Right (through the LEDGER honeypot) | 3★ $840, heat 7, turn 8 |
| 02 | Middle (Brute the firewall) | 2★ $520, heat 6, turn 11 |

Job 02 ships 46 PRINT-04 nights and 51 MAIL-02 nights; 16 of the 97 witness
lines trust offer 1 (none could before PAR dropped with the cut).

**Unused action slots** (spec target ≤ 15%), read plainly (every slot of a
completed turn the line didn't spend, including the one overclock banks):
Job 01 **28.8% (WARN)**, canonical line 14.3%; Job 02 6.1% (PASS). The
validator passes or fails on this plain figure and prints the forfeited
figure (slots beyond the 1 that overclock carries over: Job 01 6.8%, Job 02
0.0%) for reference only. An earlier build passed/failed on the forfeited
figure instead; that redefined the measure. Why Job 01 misses it: its best
lines slip past the patrol and time it with 1-action turns (bank one, then
sprint 3), which is exactly what overclock is for, and the free Extract adds
a slot it doesn't spend on the BREACH turn. Making Job 01's best lines stop
banking would mean making the patrol timing stop rewarding half-turns; none
of the job-data tunings tried (patrol phase, exits, an extra link) does that,
because every patrol phase is already a variant. Left as a WARN for the spec
owner.

## What the bot found

`npm run bot` is the spec's greedy one-turn-lookahead bot with the spec's
weights: a node with a Sentry on it is just a node (an earlier build added a
Sentry cost of 3 and reported its numbers; that is now `--sentry-cost 3`, for
comparison only). One deviation remains: an unknown exit is scored as the
average of the two candidates (scoring against the nearer one made Extract
look like a sudden loss when the far exit opened, so the bot never
extracted). 200 noisy seeds per row, canonical variant:

| Job | AI policy | Win | ★2 (payout ≥ PAR) | 3★ | Mean payout per win | Turns ending on the start node |
| --- | --- | --- | --- | --- | --- | --- |
| 01 | (none) | 97.5% | 41.5% | 41.5% | $537 | 14.7% |
| 02 | trust offer 1, refuse offer 2 | 52.5% | 16.5% | 5.0% | $564 | 31.0% |
| 02 | refuse both offers | 30.5% | 1.5% | 0.5% | $629 | 28.7% |
| 02 | refuse offer 1, trust offer 2 | 21.5% | 1.0% | 0.5% | $490 | 34.2% |
| 02 | trust both offers | 90.5% | 46.0% | 9.0% | $378 | 27.3% |

(The ★2 column is the share of all seeds that escaped at or above their PAR,
after any cut. Trusting both deals halves PAR as well as the money, so it is
the easy road to ★2 for a sloppy player and the worst road to a high payout;
worth watching in playtests.)

Against the v2 targets: Job 01 win ≥ 45%, 3★ ≥ 5% and start-node turns ≤ 20%
all PASS; Job 02 trusting vs refusing offer 1 within 25 points PASS (gap 22.0)
on seeds 1-200, **but with no margin**: on fresh seeds the gap is 25.3 (seeds
201-600) and 26.7 (601-1000), about 25.2 over 1000 seeds (54.4% vs 29.2%),
which is over the limit. The previous rules gave 20.9 over the same 1000
seeds; this pass's free Extract, back-off and larger cut widened it. Treat the
PASS as seed luck and this target as at risk.
Job 02's start-node turns (31.0% / 28.7%) **miss** the ≤ 20% target with the
spec's bot: it dithers before Extract (walks into telegraphed bumps, then
steps back) and often idles boxed in between the two hunters. Not tuned in
this pass.

Before this pass, the same spec-weight bot on the previous rules scored Job 01
win 100%, 3★ 1.5%, start-node turns 23.8% (two targets missed), and Job 02
trust 43.5% vs refuse 25.0%. What fixed Job 01 is the free Extract (rule 12):
on its own it gave 3★ 41.5% and start-node turns 15.8% on the canonical night.
The back-off rule (rule 10) on its own left 2.0% and 24.0%; it is there for
the exit and chokepoint camping, not for the numbers. Tried and dropped: the
canonical patrol phase (offset 4, Sentry starting on SALES DB, also passes,
3★ 80%, start-node turns 8.1%, but the spec fixes the first run at offset
0 with the Sentry on SWITCH), an extra link (with Extract still costing an
action, each of the 6 unlinked neighbouring pairs on the grid, A–C, A–F,
B–X, Y–F, F–X, F–G, left 3★ at 2.5% or less and start-node turns at 22.8%
or more), and Sentries never entering the open exit (no change at all on
Job 01's canonical night).

Trusting offer 1 vs refusing it, Job 02 canonical, spec bot: before, trusted
runs beat PAR 4.5% of the time (3★ 1.0%) against 5.5% for refusing; now
16.5% beat their lowered PAR (3★ 5.0%) against 1.5% for refusing, while
refusing pays more per win ($629 vs $564) and its best line pays $860 against
the trusted route's $680. Trusting is the safer way to the stars, refusing is
the way to the money.

**The validator's check (e)** uses a "sighted" first-timer (`--sentry-cost 3`):
the spec bot wins under 25% of Job 02's nights (on average 21% of PRINT-04
nights and 8% of MAIL-02 nights refusing, 30 seeds each; 26 of 144 nights
would pass, none with MAIL-02), so filtering on it would ship too few nights to pick from. With
the Sentry cost the canonical night is Job 01 100% (3★ 50.0%), Job 02 trust
96.0% vs refuse 72.0%. That bot is used for the filter only; every target
above is checked with the spec's bot.

`npm run bot -- job02 --sweep` (spec bot, 30 seeds per shipped night) is the
open problem: PRINT-04 nights refuse 26.5% / trust 36.4%, but MAIL-02 nights
refuse **7.9%** / trust 49.9%, and 35 of the 97 shipped nights have a
trust/refuse gap over 25 points (largest 93% vs 7%). The spec's measure is
the canonical night only (PASS, gap 22.0), and the sighted filter keeps every
shipped night within 25 points, but for a first-timer who walks into Sentries
the MAIL-02 exit is close to unwinnable without UNKNOWN's shortcut. The
refused route back to MAIL-02 runs past both hunters (Sentry B's patrol
covers MAIL-02 itself). Not tuned in this pass; candidates are Job 02's exit
pair or Sentry B's loop.

Worth watching in playtests:

- **The back-off after a scan.** During BREACH a Sentry that scanned you steps
  back a node, then hunts again. It is meant to give you a window past a
  chokepoint without making the hunt toothless: does it read as "it lost me
  for a second", or as a free pass?
- **The honeypot is cheap in Job 01.** Ghost only counts scans and bumps, so a
  3★ line runs straight through the BACKUP honeypot.
- **Job 02's freeze deal hurts the bot on its own** (21.5% vs 30.5% refusing)
  and is decisive with the shortcut (90.5% trusting both). Part of this is
  the bot idling while the Sentries are frozen; watch what players do.
- **Balance risk: refusing has become the trap for a typical player.**
  Because PAR drops by the cut, trusting both deals halves PAR to $400. On
  Job 02's canonical night (spec bot, 200 seeds) trusting both wins 90.5%,
  ★2 46%, 3★ 9%, $342 mean payout per run; refusing both wins 30.5%, ★2
  1.5%, 3★ 0.5%, $192 per run. Trusting offer 1 alone also beats refusing on
  every one of those ($296 per run). Refusing only leads on payout per win
  ($629 vs $564) and on the best line ($860 vs $680). For optimal play the
  tradeoff is real, but the old trap has flipped, which cuts against
  "refusing is free".
- **Extract to offer 2 (Job 02).** About 2.4 s hands-off from tapping
  EXTRACT to the freeze offer's buttons (download, DATA ACQUIRED, BREACH,
  a clipped glitch and fast typing; the previous build took about 3.9 s), and
  any tap skips straight to the buttons (about 0.2 s; a tap at the start
  still left about 2 s before). `node tools/smoke.js --juice` checks both.
- **Half-turns in Job 01.** Its best lines bank an action to time the patrol
  (see the unused-slots note above).
