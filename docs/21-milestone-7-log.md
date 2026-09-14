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
