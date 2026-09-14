# Milestone 7 plan, approved: content — Frostfell, new monsters, a second boss, levels 21 to 40

Status: approved by the product owner on 2026-09-14 ("Looks and plays very
good. Let's move on with the next milestone"), scoped from the roadmap in
document 18 (D47). Tech lead calls are listed under "Assumptions"; each is
reversible if the owner wants a different one. Log is document 21.

## Goals

1. A second biome, **Frostfell**: snow verge, an ice-and-slab road, frost
   sky and fog, dusted trees and ice crystals, all through palette roles so
   the UI stays the same and the look is one family.
2. Two new enemy kinds that ask something new of the thumb: a **charger**
   that runs the lane and shoves through the column, and a **shielded
   brute** whose shield must be broken before its number falls.
3. A second boss with a second attack: the **Rime Fiend** charges the lane
   it faces and retreats, on top of the stomp.
4. Levels 21 to 40 on the new biome, with milestone levels 25, 30, 35, 40
   that an upgrade can gate (D49), bands on the human bot, the economy's
   curve carried through.

## Assumptions (tech lead calls)

- **Biome theme** Frostfell rather than a volcanic waste: the frost staff
  already reads on this palette, the existing pines dust well with a tint,
  and snow and ice textures exist on ambientCG (CC0). No Blender (D5).
- **Assets**: Quaternius Ultimate Monsters (CC0, already licensed here)
  for the charger and the boss; the KayKit Skeleton Warrior's own shield
  accessory for the shielded brute; ambientCG snow and ice albedos; the
  biome's props are the existing meshes under frost tints plus a few
  crystal pieces. If a monster the plan names is not in the pack, the
  nearest rigged runner or brute is taken and the name changes, not the
  behaviour.
- **First compounding rung** (the Milestone 6 finding, D50): the Yard's
  first `gateBonus` rung is cheap, so a milestone level from 7 on can be
  gated by an upgrade the economy actually affords.
- **Milestones 25, 30, 35, 40** carry the milestone dials from D48.
- **No device work** (D47).

## Contracts (pinned so the tracks build in parallel)

```ts
// src/data/types.ts
export type BiomeId = 'meadow' | 'frost';
// LevelConfig gains: biome?: BiomeId (absent means 'meadow');
//   chargerRows: number; shieldRows: number  (rows that stand a charger or a
//   shielded brute short of the gate, like bruteRows).

// src/sim/types.ts
export type EnemyKind = 'grunt' | 'brute' | 'charger' | 'shieldBrute' | 'boss';
export type BossKind = 'demon' | 'rime';
// EnemyState gains: shield?: number (shield hp left; 0 or absent = none);
//   variant?: BossKind (bosses only); charge?: { until: number; lane: Lane }
//   while a boss or a charger is charging.
// SimEvent gains: { type: 'shieldBreak', enemyId, x, z },
//   { type: 'charge', enemyId, kind: EnemyKind, lane }, and enemyDeath carries
//   the kind already.

// src/data/assets.json entry ids: 'charger' (rig + VAT), 'shieldBrute'
//   (skeleton_warrior + shield accessory, VAT), 'boss_rime' (rig, clips).
// src/data/palette.json gains biomes: { frost: { sky, grass, stone, shadow,
//   ... } } as partial overrides of the base roles; src/render/palette.ts
//   gains setBiome(id) and every role read resolves the override first.
```

- **Charger** (sim): a fast single body that appears at its row, runs its
  lane at `charger.speed`, has a small hp number so it can be shot down,
  shoves the column hard (its own shove reach and strength), kills
  `charger.kills` units on contact and dies. Streams and blocks unchanged.
- **Shielded brute** (sim): a brute with `shield` hp; while the shield is
  up, damage is multiplied by `shield.damageMul` and taken from the shield;
  at zero a `shieldBreak` event fires and the block takes full damage.
  The label shows the shield count in the frost frame and switches to the
  danger frame when broken.
- **Rime Fiend** (sim): boss 2; every `charge.interval` seconds it charges
  the lane the column stands in at `charge.speed` to `charge.depth` past
  the column's front, shoving and killing `charge.share` of the units it
  passes through, then walks back to its stand; the stomp stays. Enrage as
  boss 1.
- **Biome switch** (render): a level's `biome` selects the palette
  overrides, the road and verge textures, the sky gradient and fog colour,
  the prop set and tints, the wall and arena tints. The switch happens at
  level load; the first entry into a biome warms its materials during the
  level's loading screen, and the smoke asserts 0 compiles during play on
  a Frostfell level.

## Definition of done

1. Frostfell reads as one family with the UI and the crowd (tech lead
   frame review on a hero set: title on biome 1, run and gate close-up and
   boss on Frostfell, a charger mid-lane, a broken shield).
2. Charger, shielded brute and the Rime Fiend are in the sim with tests
   (a charger shoves and kills its share; a shield halves damage and
   breaks once; the boss charges the column's lane and returns); the
   crowd bows visibly under a charge in a frame.
3. Levels 21 to 40 generated on the biome; bands on the human bot as D45
   with milestones 25, 30, 35, 40 separating armed from bare by at least
   0.15 (with D50's rung); greedy 100 of 100; economy still in band to
   level 40; goldens re-captured.
4. Bestiary knows the three new monsters; the level picker shows 40
   levels; audio has the charge, the shield break and the new boss.
5. All checks, smoke with a Frostfell run, hero set, hosted build
   republished, log, ledger, ASSETS.md rows for every new file.

## Team plan

| Phase | Agent | Scope | Owns | Depends on |
|---|---|---|---|---|
| A | assets and biome | Fetch and bake the new rigs and textures, licences, ASSETS.md rows; palette biome overrides and `setBiome`; Frostfell road, verge, sky, fog, props, walls, arena, motes; the biome switch and per-biome warm-up | `assets/**`, `scripts/fetch-assets.mjs`, `scripts/bake-vat.mjs`, `src/data/assets.json`, `src/data/palette.json`, `src/render/palette.ts`, `theme.ts`, `road*.ts`, `sky*.ts`, `props.ts`, `wallLook.ts`, `arena.ts`, `motes.ts`, `scene.ts`, `warmup.ts`, `views.ts` (load order), `docs/ASSETS.md` | none |
| B | sim content | Kinds, boss 2, levels 21 to 40 with `biome`, row kinds, events, tests, goldens; D50's rung | `src/sim/**`, `src/data/balance.json`, `levels.json`, `types.ts`, `progression.json` (the rung only) | none |
| C | render and UI of the monsters | Charger and shielded-brute views (VAT crowd or block), the Rime Fiend view with charge motion, shield label frame, charge and shield-break effects, audio map entries, bestiary entries, picker for 40 levels with a frost tint | `src/render/enemies.ts`, `enemyBlocks.ts`, `streamBodies.ts`, `boss.ts`, `labels.ts`, `effects.ts`, `sprites*.ts`, `src/audio/**`, `src/data/audio.json`, `academy.json`, `src/ui/**`, `src/core/**` | A, B |
| D | balance | Bands 21 to 40 on the human bot, milestones, boss 2 fights, economy to 40, goldens | `balance.json`, `levels.json`, `progression.json`, sim tests | B |
| E | integration and review | Wire, smoke with a Frostfell run, hero set, review, builds | all | C, D |
