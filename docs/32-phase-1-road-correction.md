# Phase 1 correction: a road that decides the run

Status: a tech-lead ruling on 2026-09-17 during Phase 1 wave two of document
31, inside the owner's approved answers (document 31, section 8). It changes
how the plan is implemented, not what it is for. Log: document 26.

## What the Meadow tuner found

On the priced bots, no boss numbers hold section 5's clear, survivor and
road-share bands together:

- The squad reaches the boss at 92 to 100 percent of its peak, with a spread
  of 5 to 15 percent between roads. The boss is a damage race against that
  count, so a boss that beats a quarter of the roads takes 85 to 95 percent of
  a typical arrival: survivors fall to about 0.1 and the road's share of the
  losses to about 0.2.
- The road takes 0.16 of the peak in units. The scripts put the multipliers
  and big pluses in the last two beats, so earlier threats bite a small squad
  (E is 20 to 40 percent of the peak before them), and on levels 8 to 19 the
  500 cap squashes arrivals into 430 to 500, erasing mistakes.
- The prep beat does not deliver section 3.7's arrival at 80 to 90 percent of
  the peak.
- A flipped curse is worth at most about 4 percent of the squad (its shoot-up
  cap is 0.6 of a 6 to 8 percent curse), so greedy never takes a red lane and
  the red-lane band cannot be reached with numbers.
- Tuning bosses alone gives either clears at 1.00 (road first) or knife-edge
  bosses (a 10 percent change in hit points swings a level from 1.0 to 0.2),
  which real players, who spread wider than the bot, would feel as luck.

## Ruling

The bands stand: they are the owner's answers. The road changes so that it
decides the run and spreads the arrivals.

1. **Growth earlier.** Replaces section 3.4's "scripts keep E under about 350
   until the last two beats" with: E reaches about half the level's peak by
   the middle beat, and the peak target sits under the cap (about 420 at most
   on ordinary levels, the milestones' own figure on milestones), so the cap
   never squashes arrivals and a late multiplier is still a decision. The
   static rule in `levelDesign*.test.ts` changes with it.
2. **The prep beat is a gauntlet.** Section 3.7 as written: after the last
   plus, a row that takes 10 to 15 percent of the arriving squad from a
   reference player and more from a careless one, so arrivals land at 80 to 90
   percent of the peak with a real spread.
3. **Threats after the multiplier.** A level's last multiplier is followed by
   at least one rated threat beat before the prep, so a mistake after the big
   gain costs units that the boss then misses.
4. **A flipped curse pays.** On scripted roads a curse that is shot through to
   green grows as a plus up to a set multiple of its printed size (data), and
   the bots price it, so a red lane is sometimes the right one.
5. **Then the bosses.** Bite at about three quarters of today's, hit points
   re-derived from the new arrival counts for 20 to 30 s fights, the ladder
   monotone, levels 1 to 3 generous (a random thumb clears level 1 at least
   eight times in ten).

## Who

- ROAD-MEADOW (the Meadow tuner, continuing): items 1 to 4 as shared pieces
  (the flip rule in `src/sim` with the bots and tests, the prep gauntlet in
  `beats.json` and the composer, the curve and the static rule), then
  levels 1 to 20 and the economy.
- TUNE-FROST (continuing): the curve's campaign-kit gate bonus, levels 21 to
  40 on the same rules once the shared pieces land, peak targets off the cap.

## Done when

Section 5's bands pass on both biomes with the rulings of 2026-09-17 (the
tests as TESTS-BANDS left them), the beat lab stays in band, and the smoke,
the simulator and the owner's device say the road now decides the run.
