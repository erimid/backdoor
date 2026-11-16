# Playtest log: Backdoor hacking prototype

The question: **is hacking fun enough that you want another round?**

## How to run it

1. Play each job about 10 times. Start with Job 01; its briefing teaches the basics.
2. Try different routes on purpose. Each job has at least three ways to the target.
3. After every run, answer **"Do you want another round?"** on the results screen,
   and add a note if anything felt like a chore, confusing or great.
4. When you're done, open **Playtest log** on the job board, tap **Copy**, and
   paste it into the project thread (or below).

The game records route, stars, heat, turns, programs used and the AI choice for
you, so you only need to write what it can't see.

## Routes to try

**Job 01 · Corner Store POS**

- Brute the firewall (TILL-2 > FIREWALL > POS-SRV): fast but noisy.
- Slip past the Sentry on the left (CAM-01 > SWITCH > POS-SRV): timing and Spoof.
- The tempting side path through BACKUP: Sniff first and see what it really is.

**Job 02 · City Bank, Branch 7**

- Trust the AI and go through UNKNOWN: fastest, but it gets a copy.
- Middle: Brute the firewall from WIFI.
- Left: MAIL-02 has the password for AUTH-01. Decoy and Worm help with Sentry B.
- Right: past PRINT-04 and BACKUP. Sniff before you commit.

## After 10 runs of each job

| Question | Job 01 | Job 02 |
| --- | --- | --- |
| How many runs made you want another round? | /10 | /10 |
| Which route did you settle on, and why? | | |
| Did you ever feel a loss was unfair or a surprise? | | |
| Was there a turn where you had nothing interesting to do? | | |
| Which program felt best? Which did you never use? | | |
| Was the board readable at a glance (intents, heat, valid moves)? | | |
| Did the AI offer feel like a real choice? | n/a | |

## Things to watch for

- **Waiting turns.** Ending turns with actions left just to let a Sentry pass. A few is
  tension; a lot is a chore.
- **Cornered.** A Sentry next to a dead end. Sentries now skip a scan after scanning
  you, so you should never be pinned for good. Note it if it still feels bad.
- **The AI shortcut.** In Job 02 it's both the fastest and the safest route; the only
  cost is the story. Does that still feel like a dilemma without the story around it?
- **Heat pacing.** Admin tracing adds +1 heat on each of the last 3 turns.

## Raw log

Paste the copied log here.

```
```
