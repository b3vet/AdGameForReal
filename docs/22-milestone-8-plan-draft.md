# Milestone 8 plan, draft v1: meta and hooks — missions, streaks, bestiary rewards, endless, deeper evolutions, wisp cosmetics

Status: draft, awaiting the product owner's play of Version 16 and the
answers at the end. The approved plan will be document 23. Scoped from the
roadmap in document 18 (D47): still no ads, no IAP, no analytics (D6).

## Why this milestone

Milestones 1 to 7 built the run, the look, the crowd, the challenge and the
content. What the game lacks is a reason to come back tomorrow and a reason
to play one more run tonight. Everything here is retention and delight
through the game's own systems: coins stay the only currency (D33), and
every hook pays in coins, in cosmetics made from what already ships, or in
a number the player wants to beat.

## Goals

1. Come back tomorrow: a daily streak and three rotating missions.
2. One more run tonight: an endless road after level 40, a retry-the-same-
   road button, mission ticks and "next unlock" teasers on the result sheet.
3. Something to spend on that is not power: bestiary tiers that pay and
   unlock cosmetics (hat and cape tints, wisp colours and trails, staff
   glow), chosen in the Academy.
4. A deeper build: three evolution tiers per staff with distinct mechanics.
5. Carry-overs from Milestone 7 as small items, and the owner's play
   feedback folded in once it arrives.

## Scope

### A. Missions and streaks (core, ui, data)

- Three active missions drawn from a pool (data-driven, `missions.json`):
  clear level N, finish a run with at least K units, break S shields, kill
  C chargers, cut off no stragglers on a walled level, beat a boss under
  T seconds, pass R multiplier gates in one run. Each pays coins on
  completion; a completed mission is replaced from the pool at the next
  session. Progress is counted from sim events in `src/core` (the sim
  stays pure).
- Daily streak: consecutive calendar days with at least one run finished;
  a coin bonus that grows to a cap, shown on the title. Uses the device
  clock in `src/core` (never in `src/sim`); a missed day resets; there is
  no server, and with no monetization there is nothing to abuse.
- Save v3: streak, missions, bestiary counters, cosmetics; migration from
  v2 with tests, as v1 → v2 was done.

### B. Endless (sim, data, ui)

- After level 40 the picker offers Endless: a road with no boss that
  alternates biome every N rows, `hpScale` and pressure rising on a curve,
  milestone-style dials every tenth row, the run ending on the wipe. The
  score is metres reached; the title shows the best. Coins by distance,
  below a level clear per minute so the campaign stays the earner.
- Deterministic like every level: a seed per attempt, so a run can be
  replayed with the retry button.

### C. Bestiary rewards and cosmetics (data, ui, render)

- Each monster kind carries a kill counter with three tiers; a tier pays
  coins and unlocks a cosmetic. Cosmetics are palette-driven variants of
  what ships: hat and cape tint sets for the squad (through the manifest
  tint patches), wisp colour and trail shape, a staff glow colour; chosen
  in a Wardrobe room. No new meshes.
- The bestiary card shows the counter, the next tier and what it unlocks.

### D. Evolution tree (sim, render, data)

- Two more tiers per staff on top of Milestone 4's one, each a mechanic:
  Ember: burn → wildfire (burn spreads to a touching body) → meteor (a
  charged shot every N seconds that lands where the crowd aims and shoves);
  Storm: extra chain → chains keep full damage → overcharge (every fifth
  volley arcs to every body in range); Frost: shatter → freeze pulse (a
  slowed body that dies chills its neighbours) → glacier (a wall of ice
  that holds a lane's river for T seconds). Priced as multi-run goals on
  the economy curve, measured by the campaign simulation; bands re-checked
  on the armed human with and without the tiers so no tier is mandatory
  below level 40.

### E. Session hooks (ui, core)

- Result sheet: mission ticks as they complete, the next unlock and its
  price with the purse against it, a "same road again" button (same seed)
  beside Ascend, the best count for that level.
- Picker: milestone badge on 7, 10, 15, 20, 25, 30, 35, 40; a star for a
  clear with 60 percent of peak.

### F. Carry-overs

- Level 7 is not an upgrade gate at any gate-bonus size: either relabel it
  ordinary-hard (drop the flag) or give it a milestone-shaped answer (a
  staff gate the player must have unlocked). Owner's call below.
- The Fiend's wake as a gouge: draw ground decals above the volley if the
  volley still reads.
- The smoke: two-run concurrency measured and switched on if it holds.

## Definition of done

1. Missions rotate and pay; a streak survives a reload and resets on a
   missed day; save v3 migrates every v2 fixture.
2. Endless runs to a wipe, scores metres, replays by seed, pays under the
   campaign rate; bands on the human bot for the first ten minutes.
3. Every monster kind has three tiers; every cosmetic renders on the squad,
   the wisp or the staff and persists.
4. Six evolution tiers in the sim with tests; the campaign buys them on
   the curve; bands hold with and without them.
5. Result sheet and picker hooks; all checks, smoke, hero set (Wardrobe,
   missions board, endless mid-run), hosted build, log, ledger.

## Team plan

| Phase | Agent | Scope | Depends on |
|---|---|---|---|
| A | meta core | Save v3, missions, streak, bestiary counters, event counting in core | none |
| B | sim | Endless generator, evolution tiers, tests, goldens | none |
| C | render and ui | Wardrobe, missions board, result and picker hooks, cosmetic tints, evolution effects, endless HUD | A, B |
| D | balance and economy | Tier prices and bands, endless curve and pay, missions and streak pay on the campaign curve | B |
| E | integration and review | Wire, smoke, hero set, review, builds | C, D |

## Questions for the product owner

1. Daily streak on the device clock with no server: fine as designed, or
   would you rather a "sessions played" streak with no calendar?
2. Missions: three rotating from a pool, replaced as completed; or a fixed
   ladder every player walks in the same order?
3. Cosmetics from tints only (hats, capes, wisp, staff glow), or is a new
   mesh or two (a second hat shape) worth its bytes?
4. Endless after level 40 only, or available from the start as a second
   mode?
5. Evolution tiers as sketched (six mechanics), or fewer and bigger?
6. Level 7: drop the milestone flag, or make it a staff gate?
7. Anything from your play of Version 16 to fold in.
