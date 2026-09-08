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
