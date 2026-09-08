# Milestone 2 plan: it looks and feels like a game

Author: tech lead. Status: approved by product owner on 2026-09-08 after the
Milestone 1 playtest. Supersedes `05-milestone-2-plan-draft.md`. Immutable.

## Playtest feedback that shaped this plan (levels 1 to 6 played)

| Feedback | Response in this plan |
|---|---|
| Run speed is good | `runSpeed` stays 5 m/s |
| Gates can be closer and more numerous | `rowSpacing` 18 → 11 m; rows 12 (level 1) → 20 (level 10) |
| Boss fight is far too short | Boss fights target 20 to 30 s for a good squad; boss HP, stomp, and an enrage phase retuned |
| Too easy through level 6 | Difficulty targets rewritten: a good player finishes with 35 to 65 percent of peak, random loses 6 of 10 |
| Gate numbers move too fast to be a challenge | Shoot-to-grow becomes a rate per second scaled by the fraction of squad fire on the gate, so a 300-unit squad cannot max a gate in one volley |
| Negative gates can start smaller | Curse values start at 2 to 6 and never exceed 35 percent of the expected squad, so shooting them down to zero and flipping them is a real tactic |
| Camera a bit closer, too much unused screen | Camera lower and closer; road fills the frame; horizon near the top third |
| Three staffs: no preference | Ember, Storm, Frost as proposed |
| Boss identity: does not matter | Asset agent picks; there will be many bosses |
| Tone: epic and heavy | Sound, palette, camera shake, boss weight, and UI copy follow that tone |

## Goal

The greybox becomes Arcane Rush. Same loop. The squad is a crowd of animated
apprentice mages, enemies are animated skeletons and monsters that ragdoll
when they die, spells are distinct and loud, the road sits in a real place,
every event has juice and sound, and the difficulty has teeth.

Out of scope: the Academy meta, Capacitor and device builds, gate kinds beyond
the staff swap, a wider enemy roster than listed, monetization of any kind.

## Definition of done

1. All checks pass. Smoke extended with a stress scene and a physics scene.
2. Balance tests pass against the new targets (section "Feel and difficulty").
3. Squad renders as animated mages via baked vertex animation on thin
   instances: run while moving, cast while firing, cheer on win. 500 units in
   one draw call per staff.
4. Enemies render as animated units per block with ragdoll deaths (capped);
   frost kills shatter; the boss is a distinct large model with an animated
   stomp and death.
5. Three staffs with distinct projectiles, impacts, and mechanics; staff gates
   in the generator from level 2; bots value them sensibly.
6. Sound for every event class, unlocked on first tap, persisted mute.
7. Biome 1 dressed: textured road, side props, sky and fog, lighting, glow.
8. Juice checklist done.
9. On the product owner's iPhone: 55 fps or better average at 300 units with
   ragdoll bursts, read from `?debug`. A degrade ladder exists.
10. Hosted and standalone builds work with all assets inlined and stay under
    12 MB and 16 MB respectively.
11. `docs/ASSETS.md` lists every asset with source, license, and use.
    `07-milestone-2-log.md` updated per phase.

## Feel and difficulty (sim targets)

Starting values; the sim agent tunes them and records the final numbers.

- Rows: `rowSpacing` 11 m. Row count 12 at level 1 rising to 20 at level 10.
  Level length before the boss 30 to 45 s.
- Gate growth is rate-based. Each step, a gate's growth is
  `growthPerSecond[kind] × dt × (hits on this gate this step / total shots
  this step)`. Starting rates: add +2.0 per second, sub −2.0 per second toward
  zero then +2.0 as add, fireRate +0.04 per second. Cap per gate:
  `base + max(4, 0.6 × base)`. Displayed values are rounded; internal values
  are floats. A projectile still counts as consumed by the gate.
- Curse values: level 1 range 2 to 6, level 10 range 15 to 60, never above
  35 percent of the expected squad at that row.
- Multiplier gates: x2 only until level 5, x3 from level 6, always paired with
  a curse or an enemy block behind it.
- Contact kills scale by the overlap fraction between the block's footprint
  and the squad's half-width (minimum 25 percent of the block's units on any
  overlap).
- Boss: HP retuned so a greedy squad needs 20 to 30 s of fire at every level.
  Stomp every 2.0 s within range removes `max(3, 6% of count)` units. At 30
  percent HP the boss enrages: stomp interval 1.2 s, walk speed +30 percent.
  Contact removes 15 percent of count per second.
- Balance targets: greedy clears all ten levels on all seeds with survivors
  between 35 and 65 percent of peak on average; random loses at least six of
  ten; worst loses ten of ten. Greedy peak stays within 0.6× to 1.4× of each
  level's `peakTarget`.
- Carried from M1: no identical gate values on a row, every row offers a way
  to grow, second-finger takeover in input, the three oversized files split.

## Camera (render)

Closer and lower: position about `(squad.x × 0.35, 6.5, squad.z − 6.5)`,
target `(squad.x × 0.35, 0.8, squad.z + 11)`, vertical FOV 0.95 rad. The squad
sits in the bottom quarter of the screen, the horizon near the top third, and
the next two rows (11 m and 22 m ahead) are always readable. Pull-back with
count stays but capped at 2 m.

## Weapons (sim)

```
WeaponDef {
  id: "ember" | "storm" | "frost"
  damage: number; fireRateMul: number; projectileSpeed: number
  splash?: { radius: number; falloff: number }                  // ember
  chain?: { count: number; range: number; damageMul: number }   // storm
  slow?: { factor: number; seconds: number; shatterOnKill: true } // frost
}
```

- Ember: baseline damage, splash 1.2 m; punishes tight enemy rows.
- Storm: fastest projectile, chains to two more targets within 3 m at 60
  percent damage; best against spread swarms.
- Frost: lower damage, slows the target by half for 1.5 s; a slowed target
  that dies shatters and can never trigger on-death behaviors added later.
- Gate kind `weapon` with `weaponId`, not shootable, swaps the staff for the
  rest of the run. At most one per level before level 4, up to two after,
  never on the first row.
- New events: `projectileHit` (weaponId), `splash`, `chain` (from, to),
  `enemySlowed`, `enemyShattered`, `weaponChanged`.
- Bots value a weapon gate by expected damage per second against the next
  three rows' layout.

## Characters and assets (all CC0)

| Role | Asset | Animations |
|---|---|---|
| Squad | KayKit Adventurers Mage, merged with a KayKit staff per weapon before baking | Idle, Run, Cast, Cheer |
| Grunt units | KayKit Skeletons Minion | Walk, Death |
| Brute units | KayKit Skeletons Warrior with shield | Walk, Death |
| Boss | A large Quaternius monster chosen by the asset agent after verifying the pack, scaled to about 3 m | Walk, Attack, Death |
| Props | KayKit Forest Nature pack | none |
| Road and sky | Tiled stone texture, rune lane strips, dusk gradient | none |
| Audio | Kenney packs converted to mp3 mono 44.1 kHz | |

Rules: glTF loaded directly, no Blender. KayKit's animation pack shares the
rig, so no retargeting. Staffs are merged into the mage per weapon in the bake
script because bones do not exist after baking. Enemies inside a block are
drawn as `units` instances in a loose cluster that thins as HP drops.

## Asset delivery in builds

- Dev and production builds load from `/assets/` by URL through
  `src/data/assets.json`.
- Hosted and standalone single-file builds inline every asset as a data URI at
  build time (glTF as `.glb` base64, VAT textures, audio) and the Havok WASM
  as base64 passed through the `wasmBinary` option, because the page host
  blocks every runtime fetch. Budget: hosted 12 MB, standalone 16 MB.

## Physics (Havok, presentation-only)

`src/physics/` consumes sim events and never writes sim state; the sim never
reads physics, so determinism and tests are untouched.

- Ragdoll pool (24) from the skeleton rig via Babylon's `Ragdoll`. On
  `enemyKilled`, up to 8 ragdolls per block get an impulse away from the last
  projectile direction; the rest puff. Ragdolls sink and fade after 2.5 s.
- Shard pool (64) for frost shatter and gate glass: convex boxes, radial
  impulse, fade after 1.5 s.
- Boss stomp pushes debris outward. The squad stays kinematic.
- 60 Hz physics step, sleeping on, hard caps on live bodies, automatic degrade
  (fewer ragdolls, then none) when frame time exceeds 20 ms for a second.

## Juice checklist

- Cast animation and muzzle flash per shot; projectile trails.
- Impact particles per weapon: ember burst, storm arc, frost crystals.
- Hit flash stays; hit-stop 40 ms on block kills via an app-level time scale
  on sim dt (deterministic for a given input; bots and tests unaffected).
- Camera shake on boss stomp and kill, heavier than M1 boxes suggest;
  slow-mo 0.3× for 0.6 s on boss kill.
- Gate pass: glass shards, count roll, unit pop-in with a puff, lost units
  shrink with a puff.
- Level clear: cheer, confetti, count-up with ticks. Defeat: desaturate and
  slow-mo. Copy in the epic register ("Slain", "Overwhelmed", "Ascend").
- HUD: count tween, boss bar shake on hit, staff icon on swap.

## Audio (epic and heavy)

- Babylon audio engine v2, unlocked on the Play tap.
- Low, weighty impacts; boss footsteps that shake; choral or brass hits on
  boss kill and level clear; a short ominous sting on defeat. Shots per
  weapon throttled to 8 per 100 ms with pitch variation. Total under 2 MB.
- Mute on the title and HUD, persisted in the save.

## Palette and tone (render and UI)

Darker ground, higher contrast: ember orange, storm violet, frost cyan
against a near-black indigo sky with a dusk band. Gate panels stay readable
first, pretty second.

## Performance

- Under 40 draw calls at 500 units.
- `?scene=stress` in the smoke (500 mages, 40 skeletons, 12 ragdolls) with a
  render-ms tripwire under SwiftShader.
- Degrade ladder: pixel ratio 2 → 1.5 → 1, glow off, ragdolls 24 → 8 → 0.

## Team plan

| Phase | Agent | Scope | Depends on |
|---|---|---|---|
| A | assets | Download and inventory packs with licenses; prove glTF loading; `scripts/bake-vat.mjs`; prove 500 animated instances in a dev scene; pick the boss; convert audio; install `@babylonjs/havok`; asset manifest; inline-assets build step | none |
| B1 | sim | Feel and difficulty retune, rate-based gate growth, weapons and weapon gate, events, bots, data, tests, carried-over items | none |
| Cam | camera | Camera rig retune with screenshot verification | none |
| B2 | render | Characters via VAT, enemy clusters, boss, biome, weapon effects, palette | A |
| B3 | physics | `src/physics/`, pools, degrade ladder, physics dev scene | A |
| B4 | app | Audio, juice, HUD additions, hit-stop time scale, stress scene, smoke extension, epic copy | A |
| C | integration | Wire, tune, perf pass, hosted and standalone builds with inlined assets | B |
| D | review | Independent review and fixes | C |

A, B1, and Cam run first in parallel. After B1 and Cam land, an interim build
goes to the product owner so the difficulty and camera changes get feedback
before the art lands. B2, B3, B4 run in parallel after A. Subagents never
commit; the tech lead verifies and commits per phase.

## Risks and fallbacks

- VAT fidelity with KayKit rigs: fallback is normal skinning for the nearest
  60 units and VAT or static for the rest.
- Havok WASM size and iOS memory: fallback is fewer ragdolls, then baked
  death animations only.
- Single-file size with assets inlined: keep textures small and audio short;
  if a build exceeds budget, the hosted link ships a reduced asset set and the
  full build is tested through the local dev server.
- Rate-based gate growth changes the balance model completely; the sim agent
  re-derives the curve from scratch rather than patching the M1 numbers.
