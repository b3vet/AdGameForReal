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

## 2026-09-08 — Phase C: integration, builds, perf (verified and committed)

- Single-file builds: one Vite plugin (`scripts/inline-assets.mjs`) rewrites
  the asset manifest to data URIs and replaces the Havok WASM module with
  base64 passed as `wasmBinary`. A `locateFile` stub is still required or
  emscripten computes a URL from `import.meta` and the hosted IIFE throws.
  VAT and audio decode base64 instead of fetching. Hosted build adds the
  loaders UMD as a third CDN script. Sizes: artifact 12.78 MB, hosted
  9.28 MB. Offline probes with every request blocked except the document and
  the CDN scripts play level 1 to the result with physics at quality 2 and no
  console errors.
- Weapon gates on from level 2. Placing a staff inside a row's random deal
  cost the row a curse and shifted every later draw; staffs are now placed
  after layout into a lane the row can spare. Storm at damage parity with a
  small rate bonus. Greedy 0 losses, survivor share 0.54, boss 19 to 23 s,
  random 9.6 losses, worst 10. Tests 143.
- Visual fixes: hat and cape tints from the manifest lighten the crowd; the
  stomp ring capped at 5 m with lower alpha; the missing boss bar was the
  screenshot landing after the boss died; lighter title scrim.
- Draw calls: shards are Havok bodies on invisible nodes copied into one
  thin-instance mesh per size (64 shards = 3 calls); ragdoll pool 8 with
  live caps by quality; the boss no longer opts out of culling; gate panels
  draw to 2.7 rows. Peaks: level 1 44, level 3 47, level 10 46 (was 66),
  stress 37. Smoke fails above 52.
- Degrade ladder moved to `src/core/quality.ts`: six rungs (pixel ratio
  2 → 1.5 → 1, glow off, ragdolls 8 → 4 → 0), never up, `?quality=` pins.
- Cleanups: audio mix in `src/data/audio.json`; time-scale numbers in
  `balance.ui`; mage glb parsed once; `App.ts` split into `frame.ts` and
  `session.ts`; stress crowd at game scale; a staff swap plays its own clip.
- Smoke shots are keyed to road position and events with the loop stopped
  in-page, so frames match across machine speeds; about 2.5 minutes.
- Open: two of five level-10 seeds carry no staff gate because every row
  there is one curse and one grower; the generator should guarantee one
  spare lane per level (sim owner).

## 2026-09-08 — Phase D: review and hardening (verified and committed)

- Fixed: tapping Play before the audio engine finished loading left a run
  permanently silent (unlock request is now latched and replayed; new test);
  splash and chain kills did not clear the target's live flag so a later shot
  in the same step emitted a second `enemyKilled` (second ragdoll burst, sound
  and hit-stop; regression test); the run after a Frost run drew Frost bolts
  for an Ember squad (`loadLevel` resets the weapon views); the physics layer
  stepped every pool slot on every title-screen frame (early return when
  pools are empty); duplicated `laneOf`; corpse yaw jumping as older corpses
  expired; 60 materials leaked per renderer teardown; a throw inside the
  frame loop at ragdoll cap 0; debug panel clipping at 390 px.
- Deferred (low): one-frame muzzle tint after shattering off Frost; the VAT
  settings buffer uploads its full size each frame; the formation offset
  cache is large but bounded; a per-frame map iteration in gates; a 64-entry
  shatter scratch under extreme turbo; smoke frame drift by one turbo frame.
- Checked clean: turbo event handling, time-scale edges, physics lifecycle,
  sim determinism (staff placement is a salted seeded stream), save
  migration, screen-cycle leaks, manifest coverage of `assets/`, and an
  artifact probe with every request but the document aborted.
- Generator: staff gates now fall back to a walk-through lane of a gate row,
  so all 45 level-seed pairs carry a staff gate (was 36). Bots unchanged:
  greedy 0 losses at 0.54 survivor share, random 9.6, worst 10.
- Splits: `smoke.mjs` into `smoke-browser.mjs`; boss-death burst moved into
  the effects view. `?debug` now shows fps, phase, time scale, sim, render
  and physics ms, draw calls current and peak, rung, pixel ratio, physics
  counts, audio state and clip count.
- Tests 143 → 152. Draw-call peaks 44 / 46 / 47; stress 37.

## Milestone 2 status

| Definition of done | Status |
|---|---|
| 1. All checks pass; smoke has stress and physics coverage | Done (physics covered through the game runs and the stress scene) |
| 2. Balance tests pass the new targets | Done: greedy 0 losses at 54 percent survivors, random 9.6, worst 10, boss 19 to 23 s |
| 3. Animated mage squad via VAT, one draw call per staff | Done, 0.66 m units |
| 4. Animated enemy units with ragdolls, frost shatter, animated boss | Done |
| 5. Three staffs, weapon gates from level 2, bots value them | Done, every level carries a staff gate |
| 6. Sound for every event class, unlock on tap, persisted mute | Done |
| 7. Biome 1 dressed | Done |
| 8. Juice checklist | Done except damage numbers, which the plan listed as optional |
| 9. 55 fps on the product owner's iPhone at 300 units | Pending the product owner's measurement with `?debug` |
| 10. Hosted under 12 MB and standalone under 16 MB, offline | Done: 9.28 MB and 12.78 MB, both verified offline at physics quality 2 |
| 11. `docs/ASSETS.md` and this log | Done |

Carried forward: the six deferred low findings above, the plan's rung for
brute ragdolls using the minion model, debris not colliding with live
enemies, and gate growth worth about 4 to 5 units at any squad size (a feel
question for the product owner).

## 2026-09-11 — Post-close: product owner playtest of the reviewed build

Feedback on the Milestone 2 build (iPhone 17 Pro Max):
1. Too dark; animations read as realistic; wants brighter, more casual.
2. From behind and above the squad reads as hats; the 3D models are wasted.
3. Shots still look like bullets, not magic.
4. Enemies on the road are too weak; wants hundreds streaming down lanes
   that the squad eliminates as they come.
5. Gates are too close together; more space to fight enemies.
6. First levels can be easier; collecting more soldiers may be enough.
7. The boss health text blocks the boss model.
8. Remove unnecessary UI text; the font is generic; wants something magical.
9. Not smooth enough on the phone; optimization needed before more models.

Tech lead response: Milestone 3 is a look, feel, and performance milestone
and comes before the Academy or the device wrapper. Draft plan in
`08-milestone-3-plan-draft.md`.
