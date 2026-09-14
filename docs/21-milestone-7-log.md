# Milestone 7 log (append-only)

## 2026-09-14 — Kickoff

- Product owner's read of the Milestone 6 build: "Looks and plays very
  good. Let's move on with the next milestone." The milestone-level
  question was not answered directly; the tech lead took the recommended
  option (D50, a cheap first gate-bonus rung) and recorded it as reversible.
- Plan written as document 20 with the contracts pinned (biome id on a
  level, the new enemy kinds and boss variant, events, asset ids, palette
  biome overrides). Wave one launched in parallel: A (assets and the
  Frostfell biome), B (sim content: kinds, boss 2, levels 21 to 40).

## 2026-09-14 — Wave one: assets and Frostfell, sim content (verified and committed)

- Phase A, assets: the charger is the Quaternius Dino (327 KB, VAT 138 KB,
  four clips); the shielded brute is the Skeleton Warrior with the pack's
  own large shield grafted under the left hand slot at the Knight's grip
  offset (no second model, material, draw call or bake: the warrior's VAT
  drives it as the mage's drives the staffs, D23); boss 2 is the Yeti
  (390 KB, six clips, its Run is the charge); ambientCG Ice004 (1024 px,
  graded toward the meadow road's brightness; it ships no ambient
  occlusion map) and Snow006 (512 px); two Dungeon rubble pieces as snow
  mounds; five props nothing had placed since Milestone 3 removed (128 KB)
  because every manifest entry is inlined and the hosted build had reached
  12.02 MB. `assets/` 4.9 MB; hosted 11.85 MB.
- Phase A, biome: `palette.json` carries the frost overrides under a
  `$biomes` key (a plain key would have pushed the biome colours into the
  UI stylesheet by the palette test's own rule); `setBiome` rewrites the
  cached colours in place so every material handed one follows; the road,
  sky dome and clouds, props and fog rebuild from roles on switch with
  nothing allocated (30 switches: 85 meshes, 60 textures, 56 → 57
  materials, the one being Babylon's default-material singleton). Frost
  props: pines under a frost multiplier plus an additive dust emissive (a
  multiplier can only remove light), procedural ice crystals (the plan's
  "Dungeon crystals" do not exist in the pack), snow mounds, fence, torch.
  Warm-up covers both biomes at boot: +5 materials, +2 programs, +9
  meshes, +4 textures; 38 programs throughout a frost level and after ten
  switches, 0 compiles during play; draw peak 43 on Frostfell.
- Phase B, sim: charger (kind `charger`, a runner with a small number,
  triggers at 22 m inside projectile range, three times a grunt's speed,
  shoves hard, kills six or five percent on contact and dies; one lane
  over comes at you, two lanes over is a dodge), shielded brute (shield at
  0.6 of body hp taking damage at half rate, breaks once with an event,
  the breaking hit's overflow absorbed), the Rime Fiend (charges the
  column's lane every 8 s at 9 m/s to 4 m past the front, kills 6 percent
  of what it passes, walks back; stomp clock and contact grind pause while
  it charges). Levels 21 to 40 as a pure insertion with levels 1 to 20
  byte-identical (hashed in a test): peak at the 500 cap, hpScale 0.95 →
  1.10, chargers from 21, shields from 23, milestones 25/30/35/40, bosses
  19000 → 22900. A real bug fixed: the target list dropped anything that
  fell behind the squad for good, so a boss that charged through the
  column could never be shot again. A stacked-fence rule (10 m gap) from
  level 21; levels 11, 12 and 14 still deal a stacked pair on one seed
  (finding for the next retune). Greedy 5 of 5 on every ordinary Frostfell
  level; human bot 0.36 bare and 0.74 with the kit the campaign holds by
  21, so the Frostfell bands are set on the armed human. D50's rung is 250
  coins and in the level-7 set, but at 5 percent per rung it moves no
  clear rate; 0.09 opens level 10, not 7, and costs 25 half its
  separation, so it is a finding, not a change. New goldens for 21 to 23.
- Combined tree: typecheck 0 errors, lint clean, 410 tests, build OK.
- Carried: `gateArch.ts` keeps a warm literal tint so arches stay warm on
  Frostfell; `Renderer.ts` 557 and `road.ts` 409 lines; `types.ts` 603;
  the human-bot bands for 21 to 40 are scoped behind `BANDED = 20` for
  Phase D; the ice road's fracture contrast is worth a look in the hero
  set.

## 2026-09-14 — Wave two: monster views and UI, balance 21 to 40 (verified and committed)

- Phase C, render: a thin-instanced VAT crowd for chargers (pooled to the
  level's charger rows, clips resolved once at load, idle then run with a
  lean toward the lane, attack and death at contact, death alone when shot
  down); the block crowds load the warrior's default and shield variants
  from one parse and one VAT texture; the shield reads as a painted shield
  glyph and count in the frost ink above the body number (one label, one
  atlas), turning to the alarm ink on the break with seven frost chips
  always and real ice shards at physics quality 1 and 2; both boss models
  load at boot with one enabled, the Rime Fiend playing its charge clip in
  and walking home with a turn, a lighter shake than the stomp; a pooled
  spray emitter for the charger's dust and the boss's wake at zero draw
  calls; audio cues picked by measuring the existing clips; bestiary cards
  Rimehound, Bulwark, Rime Fiend recorded as seen like the others; the boss
  bar titled from the bestiary; picker chips carry a frost wash from the
  spell-frost roles. Warm-up 67 materials and 41 programs at boot, 41
  after a whole Frostfell level; draw peak 47 to 48. `effects.ts` and
  `enemies.ts` split (`effectsGeometry.ts`, `enemySlots.ts`); dead
  chargers no longer throw skeleton ragdolls.
- Phase D, balance, armed human on ten seeds: ordinary Frostfell levels
  clear 0.72, survivors 0.39 of peak, bosses 20 to 30 s on every level;
  boss charges cost 18 to 27 units a run (11 to 16 percent of the stomps),
  chargers 1 to 10, shields break in half to nine tenths of the runs that
  meet one; the new kinds' tuning needed no change. Levers were the level
  recipes only: boss hp 19000 to 22900 → 28000 to 33700 (an armed squad
  does 1.8× a bare one's boss damage), bite 0.57 to 0.81, mixed rows 8 to
  10 → 3 to 9 (the crowd had been arriving at 280 to 440), four hpScale
  and six density corrections, two curse ranges. Gate bonus 0.05 → 0.09
  separates six of eight milestones by 0.15 (level 7 separates at no
  value and stays an ordinary-hard level); the Yard's `baseCost` 900 →
  1150 pays for it so levels 6 to 10 stay at 3.9 runs per purchase.
  Stacked-fence rule applied from level 1 after measuring the Milestone 6
  bands unchanged (levels 11, 12 and 14 deal differently; level 12 loses
  one clear in ten). Greedy armed 100 of 100 on 21 to 40; greedy bare 37
  of 100 there. Frost goldens re-captured once.
- Combined tree: typecheck 0 errors, lint clean, 414 tests, build OK,
  hosted 11.86 MB.
- For the owner: from level 21 the game is balanced for a player who has
  shopped (the Academy is not optional there), Frostfell's milestones are
  absolute gates without upgrades, Yard prices are 28 percent dearer, and
  level 7 is not an upgrade gate.
- Carried to Phase E: the frost wake and the charger's dust do not read
  on a white road (a ground ring in the frost role is the next try); the
  ice road's fracture contrast; `gateArch.ts` warm literal tint; a
  Frostfell smoke run (level 23, greedy, shots armed off `charge`,
  `shield` and the boss's `charge`, at scale 1 if the volley's fill makes
  2x too slow); the bestiary's sixth card below the fold on an 844 px
  screen; `Renderer.ts` 566 lines.

## 2026-09-14 — Phase E: integration (verified and committed)

- Smoke: a fifth run on level 23 with greedy armed with the kit the
  campaign holds there, at scale 1, with frames keyed to moments (a
  shielded brute before and after the break, a charger running, the Rime
  Fiend mid-charge) through a pace table that slows the sim clock as each
  subject comes into reach and hands it back after; a chargers-drawn peak
  in the debug stats asserted non-zero. Hero set gains a Frostfell page
  at 2x (run, gate close-up, boss, charger, broken shield) driven beside
  the meadow pages; the Frostfell 3x set is off by default because the
  smoke now runs 18 min on this container (`SMOKE_HERO_FROST_SCALES`).
  Two driver bugs cost a third smoke run: a paced step that never handed
  the clock back, and a blank check that threw on a frame never taken.
- Looks: the wake and dust were additive near-white on a white road, so
  they were arithmetically invisible; a new blended ground-decal batch
  (one draw call, disc in the fragment shader, per-instance tint) carries
  the charger's dust in the shadow role and the Fiend's wake in the frost
  edge role; the ice albedo re-graded to half its contrast (deviation 49 →
  30 against the cobble's 29, clipped white 21 → 6 percent, 118 → 85 KB)
  with the meadow textures byte-identical; the arch's warm literal tint is
  now a `stone.arch` role with a cold frost override, re-applied on the
  biome switch; the bestiary's six cards fit at 844 px with a visible
  scrollbar for a seventh. `Renderer.ts` 566 → 436 with boot, level-load,
  frame and stats modules.
- Verified: typecheck 0 errors, lint clean, 414 tests, build OK, hosted
  11.82 MB, artifact 15.17 MB; smoke PASS in 18 min 6 s (runs 532 s,
  stress 39 s, hero 512 s), draw peaks 40 / 42 / 41 / 43 / 43, 0 shader
  compiles during play in all five runs, ragdolls on, stress 35 draws
  with medians 7.2 / 9.9 / 7.3 ms. Frames judged: frozen flagstones with
  soft joints, cool arches in the snow, plaques the brightest thing;
  Rimehound mid-lane in the alarm ink; Bulwark broken at 26 m; the Fiend
  over the column with two mages thrown clear; the meadow set unchanged.
- Carried to review: the charger's dust is emitted on frame time so a
  turbo capture shows fewer marks than play; the Fiend's wake does not
  read under the volley; `smoke-hero.mjs` 901 and `smoke-run.mjs` 599
  lines; grazing-angle banding at the far end of the ice road; the smoke's
  wall clock.
