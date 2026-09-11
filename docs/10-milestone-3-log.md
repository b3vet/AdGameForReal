# Milestone 3 log (append-only)

## 2026-09-11 — Kickoff

- Product owner answered the draft's questions: soft toon ramp without
  outlines; one soldier lost per touching enemy with streams tuned so the
  squad barely clears each wave; font is the tech lead's pick (Cinzel plus
  Nunito); a frame-rate baseline from the iPhone 17 Pro Max to follow.
- Tech lead wrote `09-milestone-3-plan.md` with the pressure bands for
  streams, the performance order, and the team plan.
- Launched in parallel: the FPS toggle task (so the baseline can be read
  without query parameters, which may not reach the game inside the hosted
  page) and the sim streams phase.

## 2026-09-11 — Task T: in-game debug toggle (verified and committed)

- Triple-tap the title wordmark or the level chip toggles the debug panel;
  taps are hit-tested from window pointer events so the targets keep
  `pointer-events: none` and a drag starting on the chip still steers.
  Persisted as `debug` in the save; `?debug` also sets it.
- "Capture 10s" records fps (wall clock, not the clamped loop dt), sim,
  render and physics ms, draw calls, rung, pixel ratio, level and squad
  range into preallocated arrays and shows a 176-character summary, copied
  to the clipboard when allowed.
- Verified on a clean checkout of the commit (the shared tree carried the
  sim phase's in-flight streams): lint clean, three-run smoke passes,
  hosted build 9.28 MB. Ten type errors remain in `debug.ts` for the stream
  event cases added ahead of the sim phase; they resolve when B1 lands.
- Published to the product owner's link as the baseline-measurement build.

## 2026-09-11 — Phase B3: fonts and HUD reduction (verified and committed)

- Cinzel and Nunito fetched from the Google Fonts CSS API (Latin subsets
  only) with OFL licences from the jsDelivr GitHub mirror. Both families are
  served as variable fonts, so one file per family covers the weight range:
  Cinzel 25.9 KB, Nunito 39.1 KB. Manifest entries of kind `font`; the
  single-file builds inline the woff2 files into the `@font-face` rules and
  skip them in the JSON manifest so glyphs never ship twice.
- `fontsReady` promise exported from `src/ui` for the renderer's digit atlas.
- HUD reduced: gate legend, title hint and staff-name flash removed; result
  copy shortened. Cinzel 900 on the wordmark and the count, Cinzel 700 on
  chips, buttons and result numbers, Nunito for body lines.
- Verified in a clean worktree: lint, 152 tests, build, smoke, hosted
  (9.38 MB) and artifact (12.78 MB) builds; both single-file builds render
  Cinzel with every non-document request blocked.
- `balance.ui.legendSeconds` is now unused (sim owner to drop it).
