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
