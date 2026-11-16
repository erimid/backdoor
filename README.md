# Backdoor: hacking minigame prototype

A throwaway prototype of the hacking minigame from the Backdoor game app. It
answers one question: **is hacking fun enough that you want another round?**

Two handmade jobs, built from the game design document:

- **Job 01 · Corner Store POS**: the tutorial. Moving, scans, Brute, a honeypot.
- **Job 02 · City Bank, Branch 7**: every program, a lock with a password clue, and the AI.

## Play it

Open `index.html` in a browser. There is no server and no build step. On a
phone, use the single-file build: `npm run build` writes `dist/backdoor.html`,
which you can open from anywhere.

Progress, best stars and the playtest log are kept in the browser's local
storage. The job board has a **Playtest log** button that copies every run as
text or downloads it as a CSV.

## Code layout

| Path | What it is |
| --- | --- |
| `js/jobs.js` | Job definitions as plain data (nodes, links, Sentries, programs, clues, AI offer, tips) |
| `js/engine.js` | The rules. No DOM, so it can be tested and reused in the full app |
| `js/ui.js` | Screens: job board, briefing, hacking board, AI offer, results, playtest log |
| `js/icons.js` | Inline SVG icons from the mockups |
| `css/style.css` | Colors, type and layout from the mockups |
| `tests/engine.test.js` | Rules tests (`npm test`) |
| `tools/solver.js` | Exhaustive solver that proves each job (and each route) can be won (`npm run solve`) |
| `tools/smoke.js` | Plays solver lines through the real UI in a 390 px wide browser (`npm run smoke`, needs Playwright) |
| `tools/build.js` | Inlines everything into `dist/backdoor.html` |

## Choices where the design doc was silent or didn't work

These are the places where the build differs from, or adds to, the game
design document. Each one is easy to undo in `js/jobs.js` or `js/engine.js`.

1. **Job 01 has an extra link, CAM-01 to SWITCH, and 12 turns instead of 10.**
   With the doc's layout the "slip past the Sentry" route can't be won: the
   Sentry's patrol covers the whole left corridor. The solver confirmed this.
   With the extra diagonal link the route works, but the best pure left run
   takes 11 turns, so the limit went up to 12.
2. **A Sentry never scans you two enemy phases in a row.** Without this, a
   Sentry next to a dead end (like SALES DB) scans forever and you are stuck
   until you run out of turns. After a scan it goes back to its patrol.
3. **Sentries can't scan into the AI node.** They can't enter it, so standing
   on a trusted UNKNOWN node hides you.
4. **Answering the AI commits your turn.** Undo history clears when you answer,
   so you can't undo the step that triggered the offer and answer again.
5. **"Open node" for Decoy and Worm** means a linked node you could stand on
   with no Sentry on it. Decoy and Worm can share a node (that's the combo).
6. **Self programs (Sniff, Spoof) run as soon as you tap them.** Targeted
   programs (Decoy, Worm, Brute) highlight their targets first. Undo is free.
7. **Sniff can't be run when nothing hidden is within 2 hops**, so a charge is
   never wasted.
8. **Player-planted badges (DECOY, WORM) are cyan**, not violet as in the
   mockup, because violet means the rogue AI.
9. **The board is 412 px tall at 390 px wide** instead of the mockup's 446, and
   the feedback line, program tray and buttons stay docked at the bottom of the
   screen, so the controls are always in reach on a short phone screen.
10. **A fourth star chip, "Unseen"**, shows the "never scanned or bumped" star
    live, next to "Heat ≤ 4".

## What the solver found

Every route in the design doc can be won. The best result for each:

| Job | Route | Best |
| --- | --- | --- |
| 01 | Brute the firewall | 3★, heat 2, turn 8 |
| 01 | Slip past the patrol (left) | 3★, heat 2, turn 11 |
| 01 | Through BACKUP (honeypot) | 2★, heat 5, turn 7 |
| 02 | AI shortcut (trust) | 3★, heat 1, turn 8 |
| 02 | Middle (Brute the firewall) | 3★, heat 2 to 4, turn 10 |
| 02 | Left (password, Decoy) | 3★, heat 1, turn 8 |
| 02 | Right (through the LEDGER honeypot) | 2★, heat 5, turn 9 |

Worth watching in playtests: in Job 02 the AI shortcut is both the fastest and
the safest route, so its only cost is the story consequence.
