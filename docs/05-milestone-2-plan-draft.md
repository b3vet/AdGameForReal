# Milestone 2 plan, draft v1: it looks and feels like a game

Author: tech lead. Status: DRAFT awaiting product owner playtest feedback on
Milestone 1. The final plan will be `06-milestone-2-plan.md`; this draft stays
as the record of the starting point.

## Goal

The greybox becomes Arcane Rush. Same loop, but the squad is a crowd of
animated apprentice mages, enemies are animated skeletons and monsters that
ragdoll when they die, spells are distinct and loud, the road sits in a real
place, and every event has juice and sound.

Out of scope for M2: the Academy meta, Capacitor and device builds, new gate
kinds beyond the staff swap, a wider enemy roster than listed here,
monetization of any kind.

## Definition of done

1. All checks pass. Smoke extended with a stress scene and a physics scene.
2. The squad renders as animated mages via baked vertex animation on thin
   instances: run while moving, cast loop while firing, cheer on win. 500
   units in one draw call per staff.
3. Enemies render as animated units per block; a block's death spawns
   ragdolls for the visible units (capped) with the rest puffing away. Frost
   kills shatter into shards. The boss is a distinct large model with an
   animated stomp and a death.
4. Three staffs with distinct projectiles, impacts, and mechanics. Staff gates
   appear in the generator from level 2. Bots value them sensibly. Balance
   tests still pass.
5. Sound for every event class, unlocked on first tap, with a persisted mute.
6. Biome 1 dressed: textured road, side props, sky and fog, lighting, glow.
7. The juice checklist below is done.
8. Performance on the product owner's iPhone: 55 fps or better average at
   300 units with ragdoll bursts, measured with `?debug`. A degrade path
   exists for weaker devices.
9. `docs/ASSETS.md` lists every asset with source, license, and where it is
   used. Milestone log updated per phase.

## Architecture additions

| Module | Role |
|---|---|
| `src/physics/` | Presentation-only physics on Havok: ragdolls, shards, gate glass, debris. Consumes sim events. Never writes to sim state and the sim never reads it, so determinism and tests are untouched. |
| `src/render/characters/` | glTF loading, animation catalog, the VAT crowd renderer, per-instance animation state. |
| `src/audio/` | Babylon audio engine v2, event-to-sound map with variation and throttling, mute. |
| `src/data/weapons.json` | Staff definitions. |
| `src/data/assets.json` | Manifest: model paths, animation ranges, VAT texture paths, sounds. |
| `assets/` | glTF models, baked VAT textures, audio, textures. Budget: 25 MB total in the app, 12 MB in the hosted single-file build. |
| `scripts/bake-vat.mjs` | Build-time baking with Babylon's NullEngine: bakes the mage (merged with each staff) and the enemy units to half-float textures plus a JSON of frame ranges. Never bakes on the phone. |

Decision to record when the plan is final: physics is presentation-only.

## Weapons (sim)

```
WeaponDef {
  id: "ember" | "storm" | "frost"
  damage: number            // per projectile
  fireRateMul: number       // multiplies balance.squad.fireRate
  projectileSpeed: number
  splash?: { radius: number; falloff: number }        // ember
  chain?: { count: number; range: number; damageMul: number }   // storm
  slow?: { factor: number; seconds: number; shatterOnKill: true } // frost
}
```

- **Ember**: baseline damage, splash 1.2 m so it punishes tight enemy rows.
- **Storm**: fastest projectile, chains to two more targets within 3 m at
  60 percent damage. Best against spread-out swarms.
- **Frost**: lower damage, slows the target by half for 1.5 s; a slowed
  target that dies shatters (a visual event) and, as a rule, cannot
  trigger any on-death behavior we add later (reassembly, splitting).
- Gate kind `weapon` with `weaponId`. Not shootable. Passing it swaps the
  squad's staff for the rest of the run. Generator places at most one per
  level before level 4 and up to two after, never on the first row.
- New events: `projectileHit` (with weaponId), `splash`, `chain`
  (from, to), `enemySlowed`, `enemyShattered`, `weaponChanged`.
- Bots: value a weapon gate by expected damage per second against the next
  three rows' enemy layout (splash vs chain vs single), so greedy makes a
  sensible choice and worst makes the wrong one.

M1 tuning items carried into this milestone's sim work: identical gate values
on one row, rows that offer only penalties and fire rate, full-block contact
on a graze (scale by overlap fraction), the three oversized files, second
finger takeover.

## Characters and assets (all CC0)

| Role | Asset | Animations |
|---|---|---|
| Squad | KayKit Adventurers: Mage, merged with a KayKit staff mesh per weapon before baking | Idle, Run, Cast (attack), Cheer |
| Grunt block units | KayKit Skeletons: Minion | Walk, Death |
| Brute block units | KayKit Skeletons: Warrior with shield | Walk, Death |
| Boss | A large Quaternius monster chosen by the asset agent from the Ultimate Monsters pack after verifying the pack's contents and rig, scaled to about 3 m | Walk, Attack (stomp), Death |
| Props | KayKit Forest Nature pack (trees, rocks, bushes) | none |
| Road and sky | Tiled stone texture and a sky gradient; lane lines become glowing rune strips | none |
| Audio | Kenney audio packs converted to mp3 mono 44.1 kHz | |

Rules: glTF loaded directly, no Blender. KayKit's animation pack shares the
character rig, so no retargeting. The staff is merged into the mage mesh
per weapon in the bake script (bones are gone after baking, so nothing can
be attached at runtime). Enemies inside a block are drawn as `units`
instances in a loose cluster and thin out as HP drops.

## Physics (Havok, presentation-only)

- Ragdoll pool (24) built from the skeleton rig with Babylon's `Ragdoll`
  class. On `enemyKilled`, up to 8 ragdolls per block get an impulse away
  from the last projectile direction; the rest puff. Ragdolls sink and fade
  after 2.5 s and return to the pool.
- Shard pool (64) for frost shatter and gate glass: convex boxes with a
  radial impulse, fade after 1.5 s.
- Boss stomp pushes debris outward. The squad stays kinematic.
- 60 Hz physics step, sleeping enabled, hard caps on live bodies, and an
  automatic degrade (fewer ragdolls, then none) when frame time exceeds
  20 ms for a second.

## Juice checklist

- Cast animation and a muzzle flash sprite per shot; projectile trails.
- Impact particles per weapon: ember burst, storm arc, frost crystals.
- Hit flash stays; hit-stop 40 ms on block kills via an app-level time
  scale applied to sim dt (deterministic for a given input, bots and tests
  unaffected).
- Camera shake on boss stomp and kill; slow-mo 0.3× for 0.6 s on boss kill.
- Gate pass: glass shards, count roll, new units pop in with a puff,
  lost units shrink with a puff.
- Level clear: cheer animation, confetti, result count-up with ticks.
  Defeat: desaturate and slow-mo.
- HUD: count number tween, boss bar shake on hit, staff icon on swap.

## Audio

- Babylon audio engine v2, unlocked on the Play tap (iOS requirement).
- Event map: shot per weapon (throttled to 8 per 100 ms, pitch ±5 percent),
  enemy hit, block kill, shatter, gate tick, gate pass positive and negative,
  units gained, units lost, boss stomp, boss hit, boss death, win fanfare,
  lose sting, UI tap. Total under 2 MB.
- Mute toggle on the title and HUD, persisted in the save.

## Performance plan

- Draw calls target: under 40 per frame at 500 units.
- Instrumentation already in `?debug`; add `?scene=stress` (500 mages,
  40 skeletons, 12 ragdolls) to the smoke with a render-ms assertion under
  SwiftShader used only as a regression tripwire, not a target.
- Degrade ladder: pixel ratio 2 → 1.5 → 1, glow off, ragdolls 24 → 8 → 0.

## Team plan

| Phase | Agent | Scope | Depends on |
|---|---|---|---|
| A | assets | Download and inventory packs with licenses, prove glTF loading, write `bake-vat.mjs`, prove 500 animated instances in a dev scene, pick the boss, convert audio | none |
| B1 | sim | Weapons, weapon gate, events, bots, data, tests, carried-over tuning items | A (asset manifest shape only) |
| B2 | render | Characters via VAT, enemy clusters, boss, biome, weapon effects | A |
| B3 | physics | `src/physics/` layer, pools, degrade ladder, physics dev scene | A |
| B4 | app | Audio, juice, HUD additions, hit-stop time scale, stress scene, smoke extension | A |
| C | integration | Wire, tune, perf pass, hosted and standalone builds | B |
| D | review | Independent review and fixes | C |

## Risks and fallbacks

- VAT fidelity with KayKit rigs: fallback is normal skinning for the nearest
  60 units and VAT or static for the rest.
- Havok WASM (about 2 MB) and iOS memory: fallback is fewer ragdolls, then
  baked death animations only.
- Hosted single-file size with textures and audio inlined: keep textures
  small and audio short, or accept that the hosted link lags the standalone
  build for M2 and test on the phone through the local dev server.
- Audio unlock on iOS: handled at the Play tap; never autoplay.

## Questions for the product owner after playing M1

1. Feel: run speed, gate spacing, boss fight length, difficulty of levels 1 to 3.
2. Camera: closer for drama, or farther for readability.
3. The three staffs: Ember, Storm, Frost as proposed, or swap one.
4. The biome-1 boss: a big monster, or a giant skeleton king.
5. Tone: cute and bouncy, or epic and heavy, for sound and effects.
