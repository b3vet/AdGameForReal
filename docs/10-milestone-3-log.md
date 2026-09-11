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
