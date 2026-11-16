# Backdoor: hacking minigame prototype (v2)

A throwaway prototype of the hacking minigame from the Backdoor game app. It
answers one question: **is hacking fun enough that you want another round?**

v2's shape is **get in, get greedy, get out**: sneak to the target, Extract,
then run for a different exit while the Sentries hunt you and the trace clock
ticks. Two handmade jobs, each with many solver-checked seeded variants:

- **Job 01 · Corner Store POS**: the tutorial. Moving, scans, Brute, a honeypot, the BREACH run.
- **Job 02 · City Bank, Branch 7**: every program, a lock with a password clue, and the AI's deals.

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
| `npm run bot [-- job01]` | The "sensible first-timer" bot: 200 noisy seeds, win %, 3★ %, payout, and PASS/WARN against the targets. Options: `--variant N`, `--ai trust\|refuse\|random`, `--seeds N`, `--naive`, `--verbose`. `--sweep` plays every shipped night (30 seeds each by default) and reports win rates per exit; for Job 02 it compares trusting offer 1 with refusing it on each night |
| `npm run solve [-- job01]` | Exhaustive BFS solver (Job 01 takes about 3 min; Job 02 needs a node list, e.g. `npm run solve -- job02 ERWUSVPM`) |
| `npm run smoke` | Plays witness lines through the real UI in a 390 px wide browser (needs Playwright) |
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
- (e) the first-timer bot (`tools/bot.js`, refusing every AI offer) wins at
  least 25% of 50 seeded runs, so "Tonight" never deals a night that is close
  to unwinnable for a new player. On Job 02 the bot also plays trusting offer
  1 (refusing offer 2); that must also win at least 25%, and be within 25
  points of refusing. Without this, trusting was a trap on every MAIL-02 night:
  the trust route never passes MAIL-02, so the AUTH-01 password is never found
  and the only way back to MAIL-02 after Extract runs through Sentry A's hub
  (trust 33% vs refuse 64% on those nights; 31 of 84 nights over the gap).

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
   Trusting costs a cut of the payout: 15% for offer 1 (the shortcut), 25% for
   offer 2 (the freeze). The spec had 25% for both; at 25% almost no trusted
   win reached par, so trusting offer 1 meant giving up ★2 rather than paying
   a price. The terms only say "another" once a deal has been taken. Offer 1 (next to UNKNOWN) names
   this variant's real honeypot and opens UNKNOWN–SWITCH; offer 2 (on
   Extract) freezes every Sentry for one enemy phase. The cut is only taken
   from a positive subtotal, so it never adds money.
8. **Final reveals.** Undo is cleared by entering a hidden node, by Sniff, by
   answering the AI, by Extract (it reveals the exit) and by the end of the
   turn. Sniff also reveals which exit BREACH will open, and can run while the
   exit is unknown even if nothing is hidden nearby.
9. **Job 01 patrol and link.** The Sentry patrols G→D→G→H→V→H (it sweeps both
   the left corridor and the target), there is a new SALES DB–SWITCH link (V–G)
   so the target isn't a dead end under hunt, and the CAM-01–SWITCH link from
   v1 stays. 10 turns, Sniff 1, Spoof 1, Brute 1. Exits WIFI or TILL-2.
10. **A Sentry never scans you two enemy phases in a row.** During BREACH a
    Sentry next to you that is resting doesn't stand still (the spec's rule 6
    said `wait`): it takes one step of its patrol, as the design-phase engine
    did, which can mean walking into you (a telegraphed bump you can dodge).
    If its patrol step is blocked while the Sentries have cut off every route
    from you to the exit, it steps aside to reopen one, and only rests if it
    can't. With `wait`, a Sentry on the exit or on a chokepoint (Job 01's
    SWITCH) next to you alternated scan and rest forever, and the only way out
    was a costly walk away.
11. **Sentries can't enter the AI node, but they scan it.** A Sentry next to a
    player on UNKNOWN scans them like anywhere else (spec rule 4). During
    BREACH there is no Sentry path into UNKNOWN, so Sentries patrol (rule 5,
    "if there is no path, patrol"). Earlier builds sent them to its doorways
    to rest there for good: with two Sentries that sealed the room and the
    player could only wait to be traced.
12. **"Open node" for Decoy and Worm** means a linked node you could stand on
    with no Sentry on it. Decoy and Worm can share a node.
13. **Self programs (Sniff, Spoof) run as soon as you tap them.** Targeted
    programs (Decoy, Worm, Brute) highlight their targets first.
14. **Player-planted badges (DECOY, WORM) are cyan**, not violet, because
    violet means the rogue AI.

One `js/jobs.js` tuning change: Job 02's canonical Sentry A phase
(`canonicalOffsets: { A: 2 }`, the spec's tuning lever 4) to bring the
trust/refuse gap for offer 1 inside 25 points. The variant pool is the same.

## What the validator found

From `npm run validate` (deterministic):

| Job | Variants accepted | Par | Canonical (v00) | Median witness turn | Rejected |
| --- | --- | --- | --- | --- | --- |
| 01 | 22 / 24 | $550 | 3★ $640, turn 4, heat 1 (slip) | 5 | 2 bot wins < 25% |
| 02 | 57 / 192 | $650 | 3★ $720, turn 10, heat 6 (AUTH-01) | 7 | 48 Sentry next to ENTRY, 2 no 3★ line at par, 85 bot check (e) |

Best result per route class on the canonical variant (each probe forbids the
key nodes of the lines above it):

| Job | Route | Best |
| --- | --- | --- |
| 01 | Slip past the patrol (CAM-01, SWITCH) | 3★ $640, heat 1, turn 4 |
| 01 | Through BACKUP (honeypot) | 3★ $650, heat 5, turn 5 |
| 01 | Brute the firewall | 3★ $610, heat 2, turn 7 |
| 02 | Left (password at MAIL-02, AUTH-01) | 3★ $720, heat 6, turn 10 |
| 02 | AI shortcut (trust, then UNKNOWN–SWITCH) | 2★ $580, heat 7, turn 7 |
| 02 | Right (through the LEDGER honeypot) | 3★ $770, heat 8, turn 9 |
| 02 | Middle (Brute the firewall) | 3★ $840, heat 8, turn 10 |

Job 02 ships 41 PRINT-04 nights and 16 MAIL-02 nights. `npm run bot -- job02
--sweep --seeds 50` on the shipped table: PRINT-04 nights refuse 66.7% /
trust 68.3%, MAIL-02 nights refuse 44.8% / trust 37.8%, largest gap on any
night 24 points.

**Unused action slots** (spec target ≤ 15%) are measured as *forfeited*
slots: Job 01 6.6%, Job 02 0.0%, both PASS. Ending a turn with 1 action left
banks it (overclock), and that slot shows up again in the next turn's 3, so
counting it as unused as well counts it twice: a 1-action turn then a 3-action
turn is the same 4 actions as two 2-action turns, and the spec wants exactly
that ("waiting banks a 3-action sprint"). Only actions beyond the 1 banked are
lost. Counted the literal way, Job 01 is 32.0% (canonical 25.0%) and Job 02
11.7%; the validator prints both. Job 01's best lines all slip past the patrol
and time it with 1-action turns. If the spec owner wants the literal measure,
the patrol timing has to stop rewarding half-turns, which none of the allowed
job-data tunings (turn limit, exits, cache, patrol start, base pay) changes:
every patrol start is already a variant.

## What the bot found

`npm run bot`, 200 noisy seeds per row, canonical variant:

| Job | AI policy | Win | 3★ | Mean payout | Turns ending on the start node |
| --- | --- | --- | --- | --- | --- |
| 01 | (none) | 77.5% | 12.5% | $337 | 18.3% |
| 02 | trust offer 1, refuse offer 2 | 88.5% | 0.0% | $470 | 15.2% |
| 02 | refuse both offers | 74.0% | 13.0% | $520 | 11.3% |
| 02 | refuse offer 1, trust offer 2 | 73.5% | 0.0% | $386 | 13.2% |
| 02 | trust both offers | 99.5% | 0.0% | $379 | 1.0% |

Against the v2 targets all pass: Job 01 win ≥ 45%, 3★ ≥ 5%, start-node turns
≤ 20%; Job 02 trusting vs refusing offer 1 within 25 points (gap 14.5),
start-node turns ≤ 20%. The spec's measure is about offer 1, so the bot
compares trusting it with refusing it and refuses offer 2 in both runs.
Trusting both offers is 25.5 points above refusing both.

**The bot is not a literal port of the design-phase bot**, so these numbers are
not directly comparable with the design doc's "6.5% today". It adds two
things: a node with a Sentry on it costs 3 extra in its path estimate, and an
unknown exit is scored as the average of the two candidates (scoring against
the nearer one made Extract look like a sudden loss when the far exit
opened, so the bot never extracted). With `--naive` (no Sentry cost) Job 01
wins 19.5% (3★ 0%, start-node turns 26.2%) and Job 02 21.0% vs 25.5%: the bot
stands next to an exit a Sentry is camping and is scanned until traced. The
spec owner should sign off on the modified bot as the reference. **Every
number in this README, and the validator's check (e), uses the modified bot
(Sentry cost 3).** Job 01 meets the 45% target only with it; with the
spec'd weights it doesn't. A rules tuning that would make a camping Sentry
less deadly (for example a 1-phase rest after any BREACH move that ends next
to you) has not been tried.

Worth watching in playtests:

- **Exit camping.** During BREACH a Sentry on the exit next to you scans, rests,
  scans, and never steps off. Players have to walk away to pull it off.
- **The honeypot is cheap in Job 01.** Ghost only counts scans and bumps, so a
  3★ line runs straight through the BACKUP honeypot.
- **Job 02's freeze deal is neutral for the bot on the canonical night** (73.5%
  vs 74.0%) but varies with the Sentry phase: with Sentry A at offset 0 it
  costs the bot 21 points (43.5% vs 64.5%); at offset 1 it is about even.
  Making it last 2 phases was tried and did not help consistently (offset 1
  dropped to 39.5%), so the rule stays as specced. Part of
  this is the bot idling while the Sentries are frozen; watch what players do.
- **Half-turns in Job 01.** Its best lines bank an action to time the patrol
  (see the unused-slots note above).
