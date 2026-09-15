# Milestone 8 log (append-only)

## 2026-09-14 — Kickoff

- Product owner answered the draft's questions (document 23): streak on
  the device clock, missions rotating from a pool, tints-only cosmetics,
  Endless as a separate mode whose coins must not disturb level progress,
  the six evolution tiers as sketched; level 7 elaborated and the tech lead
  dropped its milestone flag (D55). Instruction: finish the plan, start and
  complete the implementation; feedback from play comes later.
- Contracts pinned (meta state shapes, save v3, endless, missions,
  cosmetics). Wave one launched in parallel: A (meta core) and B (sim:
  endless and evolutions). C (render and UI) and D (balance and economy)
  follow; E integrates and reviews.

## 2026-09-14 — Container restart mid wave one

- The container restarted while A and B were mid-flight; both agents were
  lost with their partial work left in the tree (data files, types, the
  clock and streak modules, player state fields, the endless config; 13
  typecheck errors). Both relaunched with the instruction to read the
  partial work, keep what is sound and finish; nothing was reset.

## 2026-09-14 — Wave one: meta core, sim endless and evolutions (verified and committed)

- Phase A: save v3 (`arcane-rush.save.v3`) migrating v2 and the v1 chain
  with every new field defaulted and a repair that tolerates a partial
  save; the streak on an injectable clock (advances on a finished run on a
  new local day, resets on a skipped day, 50 coins a day to a 350 cap,
  provisional); sixteen missions in a pool, two per kind, three active
  drawn seeded without repeats, progress from the events the session
  already drains plus the run result, paid once, replaced at the next
  session; kill counters per kind and bestiary tiers that pay coins and
  hand over a cosmetic once (grunt 250/1500/6000 up to rime 3/12/40);
  eighteen cosmetic tints across the four slots pinned to rungs, with a
  Wardrobe room card and a selection that rejects unowned ids; level bests
  on a won run; the run's seed and `startLevel(index, seed)` for "same
  road again"; `payRun` returns a full payout (coins, streak, missions,
  tiers, unlocks, best, seed); `__arcane.meta()`. 123 core tests.
- Phase B: staff tiers 0 to 4 with three-price evolve arrays (tier 2 keeps
  its meaning; 3 and 4 provisionally at 1.6× and 2.2×); the six mechanics
  as named fields carrying the tier that switches them on (an array of
  tier definitions had broken the render's dev fixture); two priced in
  seconds of the squad's own fire because output spans two orders of
  magnitude across the campaign (meteor 1.8 s every 9 s in a 3.2 m radius
  with a shove; overcharge 0.3 s split across up to 24 bodies every fifth
  volley); wildfire one hop per source at 0.55 of the source's tick; a
  freeze pulse of the staff's own slow; a glacier holding one lane 3 s
  every 14 when a real river is there. Endless: 160 rows (2.9 km, about
  ten minutes), biome every 12 rows, dials read off the campaign at level
  1 and past 40 and growing per row, chargers and shields in both biomes,
  paid 0.12 coins a metre capped at 0.7 of a repeat clear of the player's
  best level; `runRewards` moved to `rewards.ts` with a `bestLevel`
  context; `biomeAt(level, z)`; events for meteor, overcharge, freeze
  pulse and glacier. Level 7's flag dropped (D55). Goldens for 1 to 3 and
  21 to 23 untouched; a player with nothing bought is the identity on
  every level. 517 tests.
- Finding for Phase D: the campaign shopper never buys an evolution at any
  tier because the Yard's fifty rungs are always cheaper and total about a
  million coins against a campaign's thirty thousand; the ladder itself is
  correct and tested with the Yard bought out. D must cut rung prices,
  raise pay, or make the shopper save.
- Carried to C: the Wardrobe card exists in data but the room list in
  `src/ui/academy.ts` does not include it; `replayRun` is on the commands
  but not wired to an overlay callback; the result sheet counts up `coins`
  while the payout's `totalCoins` includes the bonuses; an endless run must
  pass `bestLevel` into the rewards; `App.ts` 533 lines. `Run.ts` 443 and
  `firing.ts` 422.
- Combined tree: typecheck 0 errors, lint clean, 517 tests, build OK.

## 2026-09-15 — Container restart mid wave two

- The container restarted while C (render and UI) and the balance
  follow-up were mid-flight; partial work across 68 files was left in the
  tree and typechecks. Both relaunched on top of it. The balance
  follow-up itself came from Phase D's finding that five of the nine
  evolution tiers measured at nothing (the burn priced per step, chains
  barely converting, the freeze pulse negative), so buying the ladder made
  a player weaker: the follow-up makes every rung measurably worth buying,
  re-prices the ladders as multi-run goals, gives boss damage a
  middle-of-the-shelf value, and replaces the mission pick with a seeded
  shuffle deck (seven of sixteen missions were ever drawn).

## 2026-09-15 — Wave two: render and UI hooks, balance and economy (verified and committed)

- Phase C: the Wardrobe (slot rows with swatches from the cosmetics'
  roles, owned and locked with unlock hints, selection ringed), a missions
  board of three cards with progress bars on the Academy home, the streak
  plaque on the title, Workbench cards showing tiers 1 to 4 with the next
  price and the mechanic's name, bestiary cards with the kill ladders,
  picker milestone rivets and stars, an Endless card with the best metres
  that starts a seeded endless run with the best level passed into the
  rewards, a metres HUD chip, result sheets for both modes with bonus
  lines (streak, missions, tiers), the next unlock against the purse,
  "Same road again" and a mode-aware "Again"; cosmetic tints on the
  squad's hats and capes through an updatable colour buffer, the wisp and
  the staff glow (measured on the crowd's pixels); the four evolution
  views (meteor with a crater ring and a shake, overcharge arcs, a freeze
  ring, a glacier slab one lane wide risen and melted by its clock).
  Biome by span on the endless road: a far half of the three ground meshes
  laid from the boundary ahead and painted in the next span's biome, the
  palette switching as the camera crosses, the sky crossfading over 12 m,
  props laid once per span; three extra meshes and materials drawn only on
  a spanned road, draw peak 48 with physics, 0 compiles across two
  crossings. A kerb painted one biome out and a second unused texture set
  were found and fixed; `App.ts` 481 → 399 with `appRun.ts` and
  `appPrefs.ts`.
- Phase D and its follow-up: a value-model shopper (`campaignShop.ts`)
  that ranks every purchase by measured output per coin and saves for a
  goal, with the worths measured per rung on 24 seeds at levels 12 and 28
  and stored in the data; the burn re-based from a per-step tick to a pool
  of damage owed and drained in 0.6 s (a body under fire died with four
  fifths of its fire still owed); wildfire spreading from fires the squad
  feeds, half as an instant flare; the storm arc with per-hop falloff and
  a carry (the old arc paid every hop a block's hit points and spent them
  on a body worth one soldier); the freeze pulse biting; the glacier
  rising in the fullest lane, biting what it holds, and shielding the
  column from it (a pure hold cannot pay when the column outruns a walk);
  ladders re-priced as multi-run goals (ember 2600/3000/3800, storm
  1500/2200/3400, frost 1200/1500/2000) so tier 2 lands about level 16,
  tier 3 about 23, tier 4 about 37 on the human campaign; runs per
  purchase 1.67 early and 3.3 to 5.0 by level 10, in band with the meta
  layer on. Missions draw from a seeded shuffle deck (16 of 16 drawn over
  forty sessions, worst repeat 2). Bands: every Milestone 6 and 7 band
  passes without tiers; with tiers no ordinary level over 0.85 and no
  milestone over 0.75 from 21; boss-damage measured at 6 to 10 percent a
  rung and left at 0.1 because the values that fix its shelf position
  bust the ceilings. Endless on the level-20 kit: median 1951 of 2898 m,
  every run wiped by attrition, a walk paying 234 against a repeat clear
  of 344. Meta income 18 percent of road income. Level 7 ordinary and in
  band. Frost goldens 22 re-captured (Frostfell roads hand out staff
  gates, so a bare run can pick up Storm, whose arc changed); 1 to 3, 21
  and 23 byte-identical.
- Findings: four rungs still measure under 4 percent on their own
  (wildfire, storm's fork, full chains on Frostfell, the glacier) because
  damage is not scarce in this game and a hold buys little against a
  column that outruns a walk; what converts is damage across lanes near
  the column. Changing what those tiers are is a D54-level call for the
  owner. The Frostfell boss band widened to 33 s for level 31 with the
  shopper's hand.
- Verified: typecheck 0 errors, lint clean, 529 tests, build OK, hosted
  11.89 MB (0.11 MB of headroom).
- Carried to Phase E: `?endless=1` boots straight into a run before Havok
  lands, so three physics programs compile mid-run at the start (not
  reachable in normal play); the glacier's bestiary copy lacks its bite
  and shield clause; smoke additions listed by C (an endless run across
  two boundaries, the Wardrobe, the title with a streak, the board, a
  Workbench card above tier 1, the ladders, both result sheets with the
  coin identity, meteor and glacier frames by polling, "Again" staying
  endless); files over 400 that grew (`GameAudio.ts` 537, `Renderer.ts`
  497, `road.ts` 470, `effects.ts` 434, `asset.ts` 421, `squad.ts` 408);
  the Endless card walks a fixed seed.
