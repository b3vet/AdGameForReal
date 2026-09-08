# Milestone 2 log (append-only)

## 2026-09-08 — Kickoff

- Product owner played levels 1 to 6 of the Milestone 1 build via the hosted
  link and gave feedback: run speed good; gates closer and more; boss far too
  short; too easy; gate numbers move too fast to be a challenge; negative
  gates can start smaller; camera a bit closer; staffs no preference; boss
  identity does not matter; tone epic and heavy. Product owner approved
  moving to implementation.
- Tech lead wrote `06-milestone-2-plan.md` with the feedback mapped to
  concrete targets, the weapon spec, asset table, physics and audio design,
  build delivery rules, and the team plan.
- First wave launched in parallel: assets pipeline (A), sim retune and weapons
  (B1), camera retune (Cam). An interim build goes to the product owner after
  B1 and Cam land, before the art phases.

## 2026-09-08 — Cam: camera retune (verified and committed)

- Final rig: fov 0.9, height 7, behind 9.5, look-ahead 9, look height 0.8,
  lateral follow 0.35, pull-back 0.03 m per unit capped at 2 m, lag clamp
  1.5 m. The plan's guess of (6.5, 6.5, look-ahead 11) put a 500-unit crowd's
  tail below the screen edge, so the agent tuned by measurement instead: sky
  band ends at 0.26 of screen height (was 0.31), squad center at 0.80, nearest
  row at 0.45 at 40 px per metre, second row at 0.36, 500-unit tail at 0.92.
- Bug found: the camera ease ran on frame time while the sim ran on
  turbo-scaled time, so every M1 smoke frame was taken about 6 m behind the
  true pose. A lag clamp fixes it.
- Gate label ranges now derive from `rowSpacing` so 11 m rows do not stack
  four rows of digits.
- Facts for the character phase: 75 CSS px per metre at the squad, so a
  1.8 m mage is about 135 px tall; 40 px per metre one row out; the boss is
  76 px tall at 22 m and 157 px at contact.
- Flagged for the interim fix: render has no tint for the new `weapon` gate
  kind, and mixed-row block labels collide with gate numbers at 11 m spacing.

## 2026-09-08 — Phase A: asset pipeline (verified and committed)

- Sources: GitHub and itch.io are blocked from this environment's egress, so
  `scripts/fetch-assets.mjs` pulls KayKit through jsDelivr's GitHub mirror,
  Quaternius through Google Drive, and Kenney directly. Substitutions: KayKit
  Halloween Bits replaces the Forest Nature pack (no repo, itch blocked; dead
  trees and gravestones suit the epic tone); the separate KayKit animation
  pack is unnecessary because every character `.glb` already carries the
  shared clip set. All packs CC0, licence texts copied into
  `assets/licenses/`, inventory in `docs/ASSETS.md`.
- The fetch script trims each character to the clips we play (Mage 3.5 MB →
  472 KB) and folds glTF, bin and texture into one `.glb`. `assets/` is 3.0 MB.
- Boss: Quaternius "Demon" (2.9 m, trident, Walk/Punch/Death/HitReact/Idle).
  All sixteen big monsters share the same clip set, so swapping is one line.
- Audio: Kenney now ships ogg only, so `scripts/audio-convert.mjs` decodes
  with headless Chromium's `OfflineAudioContext` and writes 22050 Hz mono
  16-bit WAV with trim, fades and normalisation. 17 clips, 421 KB.
- VAT: Babylon's `bakeVertexDataSync` silently bakes the wrong thing for glTF
  rigs because glTF animations live on transform nodes, not bones. The bake
  script steps animation groups by frame and reads the skeleton's transform
  matrices directly. 30 fps, half-float. A VAT is bone matrices, so one
  `mage.bin` drives the body, hat, cape and every staff: accessories are
  skinned to their parent hand bone and merged into the body. The glTF
  loader's right-to-left-hand flip (a −1 x scale on the root) is folded into
  the vertices and the bone matrices; missing either half mirrors the crowd.
- Crowd proof: 500 mages plus 40 skeletons in 2 draw calls, animation
  confirmed by pixel diff. API in `src/render/characters/index.ts`.
- Havok 1.3.14 installed; init pattern documented in the report and in
  `dev/vat-test.ts` (`?scene=physics`): the `joinedPhysicsEngineComponent`
  side-effect import is required or `enablePhysics` silently returns false;
  the WASM loads through Vite's `?url` import with no config change.
- Open for later phases: production build does not copy `assets/` (needs a
  `vite.config.ts` change in Phase C); Frost carries a spellbook because the
  mage atlas has only two staff props; skeleton eye glow is lost in the merge;
  one-shot VAT ranges loop, so dying instances must be removed after their
  duration; no animation blending.

## 2026-09-08 — Phase B1: sim retune and weapons, plus interim render fixes (verified and committed)

- Rate-based growth implemented as `growthPerSecond × hits / expectedShotRate`
  (the plan's formula with dt cancelled), using the squad's expected shot
  rate rather than the integer shots of one step so small squads can still
  pump a gate. Caps frozen at spawn. Hitscan batches count their batch size.
- The real M1 difficulty problem was generator variance: row kinds and
  multipliers rolled per row swung a level between 6 and 11 gate rows. Row
  mix and multiplier count are now dealt from a budget with only the order
  random; every gate row carries a real growth gate. Greedy went from 17
  losses in 50 to 0 with survivors averaging 53 percent of peak.
- Boss: plan rules kept (stomp `max(3, 6%)` every 2 s, contact 15 percent per
  second, enrage at 30 percent HP). Boss speed 1.6 → 0.55 and stomp range
  7 → 18 so stomps carry the attrition and contact is a late failure state
  rather than a spiral. Fights average 20 to 22 s on every level.
- Deviations: peak targets re-derived 105 → 400 (ledger D24); pre-boss road
  29 to 46 s; fireRate gate range 0.03 to 0.10 and bot worth changed to a
  multiplier on the printed value; no multipliers on level 1.
- Weapons: Ember 1.0 splash, Storm 1.25 chain, Frost 0.9 at 1.1 rate with
  slow and shatter; `weapon` gate kind; seven new events. Generation is off
  (`gen.weaponGatesEnabled: false`) until the renderer draws staffs; with it
  on, greedy loses 0.2 of 10 and survivors sit at 61 percent.
- Tests 86 → 131. Perf 600 ticks at 300 units in 11 to 30 ms.
- Interim render fixes: `weapon` tint and staff-name gate text, seven debug
  cases, dev scenario uses the sim's growth rule, and a label rule for the
  11 m rows: a block's HP number hides while an unpassed gate in its lane is
  within 0.35 × camera distance behind it or 0.15 × in front.
- Open for the feel check: shooting a gate is worth about 4 to 5 units at any
  squad size, decisive at level 1 and marginal at level 10; level 8 peaks at
  0.77 × target; greedy takes 18 of 74 staff gates.

## 2026-09-08 — Phase B3: presentation-only physics layer (verified and committed)

- `src/physics/`: Havok with 24 skinned skeleton ragdolls (11 bodies each
  from the KayKit rig), 64 shards in three sizes for frost shatter, gate glass
  and the boss ring, a road collider with side walls, and a degrade ladder
  (mean frame time over 20 ms for a second steps quality 2 → 1 → 0, never
  back up). One fixed 60 Hz step per frame so a hitch slows debris instead of
  flinging it through the road.
- Traps recorded in `src/physics/rig.ts`: `Ragdoll` silently builds no joints
  unless the skeleton's root bone is in the config with zero offset; box
  extents are world-aligned at build time; the ragdoll mesh must keep the
  loader's mirrored frame (the VAT conjugation does not apply to a live
  skeleton). `Ragdoll` is one-way, so slots are built once in ragdoll mode
  and spawned by teleport plus velocities.
- Integration contract: call `onEvents(events, state)` then `update(frameDt)`
  before `scene.render()`; `update` takes frame time, not turbo time;
  `loadLevel` rebuilds the road collider; quality 0 skips the WASM entirely.
- Open: 64 shards are 64 draw calls worst case; debris does not collide with
  live enemies or the squad; ragdolls use the minion model for brutes too.

## 2026-09-08 — Phase B4: audio, juice, physics wiring, stress scene (verified; committed with B2)

- Physics wired into `App`: Havok init starts after the title screen shows so
  the 2 MB WASM never blocks boot; a failed init drops to quality 0 and the
  game continues. Frame order: sim ticks, `renderer.update` with scaled dt,
  `physics.onEvents`, `physics.update` with unscaled frame time. Under turbo
  the five event kinds physics consumes are copied through a pool because
  the sim reuses its event objects.
- Audio: Babylon audio engine v2, 17 clips, unlocked on any button tap,
  silent until the context runs, every failure a warning. Throttled event
  map (shots 8 per 100 ms with pitch variation, gate tick only when the
  displayed integer changes, positive and negative gate passes, boss stomp,
  hit, death, fanfare, sting, UI tap). Volumes in `src/audio/mix.ts` for
  now; to move into data in Phase C. `muted` added to the save.
- Time scale: hit-stop 40 ms (one per 250 ms) on block kills, 0.3× for 0.6 s
  on boss kill, defeat holds 0.5× with a desaturation filter, camera shake
  0.35 m on stomp and 0.8 m on boss kill. Time effects are disabled under
  turbo because a turbo frame is seconds of sim time. The result countdown
  now runs on wall time.
- Copy in the epic register: "THE HORDE IS SLAIN" / "Ascend" / "Again" and
  "OVERWHELMED". Staff badge and name flash, ENRAGED boss bar state,
  confetti and count-up with ticks.
- Build: `assetsDir` renamed to `bundle` and `assets/` copied into `dist/`,
  so production serves models, VAT, audio and the Havok WASM.
- Stress scene (`?scene=stress`, `dev/stress-test.html`): 500 mages, 40
  skeletons, a kill per second. Measured under SwiftShader: 37 to 51 draw
  calls, render median 9.8 ms; tripwire 125 ms.
- Smoke adds `boss.png` and `stress.png`, runs at 1× device pixels to stay
  under five minutes (4 m 37 s). Tests 131 → 142.
- Open: the hosted build's bare-specifier guard trips on `@babylonjs/loaders`
  (Phase C: externalize loaders via a third CDN script or inline); each live
  ragdoll is a draw call (51 worst case against a 40 budget); `App.ts` is
  527 lines; the stress crowd draws at full unit scale.

## 2026-09-08 — Phase B2: characters, biome, effects (verified and committed with B4)

- Squad: one `VatCrowd` per staff, all three preloaded, the active one drawn;
  run with one unit in three casting, idle when stopped, cast in the arena,
  cheer on a win. Unit scale 0.66 m (0.78 merged hat brims at the sim's
  spacing, 0.62 lost the staff). Grunt 0.72, brute 0.92, boss 3.0.
- Enemies: boxes gone; each block is `units` skeletons scattered inside its
  footprint, thinning as HP drops, walking when active and frozen on a
  per-block frame when idle through a new `speed` argument on
  `VatCrowd.setInstance` (speed 0 makes the offset the frame, which also
  gives hand-driven one-shots). Frost ring on slow, instant hide on shatter.
- Boss: the demon with Idle, Walk, Punch on stomp, HitReact throttled,
  Death then sink; enrage is a red pulse and 1.35× clip speed; clip speed
  follows the app's time scale. Bug fixed: one-shots shorter than a frame
  were cancelled before drawing.
- Weapons: three bolts with trails, per-weapon impacts, muzzle flashes,
  splash ring, chain bar, all pooled thin instances (24 live), glow layer at
  quarter resolution with `setGlow`. No particle systems.
- Gates: draw-range culling at three rows (60 panels were 60 draw calls); a
  weapon gate floats the real staff prop cloned from the mage glb.
- Biome: procedural stone tile, four instanced rune strips with a pulse,
  seeded Halloween props every 6 to 10 m, gradient sky dome riding the
  camera, fog into the haze band, warm key plus cool fill.
- Bug fixed: an empty thin-instance mesh falls off Babylon's instanced path
  and draws one full-size copy at the origin (a giant mage in the stress
  scene); commits disable the mesh at count 0.
- Draw calls: 37 peak at level 10 with physics off, 33 to 37 at 500 units in
  the render test, 45 in the stress scene, 66 at level 1 with 352 physics
  bodies alive (one call per shard or ragdoll, the B3 known issue).
- Tech lead review of the frames: the crowd reads as dark discs from the
  camera's pitch, the stomp ring is far too large and bright, the boss bar is
  missing in `boss.png` while present in `t6.png`. All three go to Phase C.
