# Milestone 4 log (append-only)

## 2026-09-13 — Kickoff

- Product owner chose the maximum scope for one milestone and asked that
  implementation run to completion without pauses. Skipped questions were
  settled by the tech lead's recommendations: low walls, full first-cut
  progression with a familiar and the bestiary, device track prepared for
  the Mac.
- Task P (walking glitch) was started before the plan as a bug fix.
- First wave launched in parallel: sim (B1), app and UI (B3), device (B4).
  Render (B2) starts when task P releases the render files.

## 2026-09-13 — Phase B4: device track (verified in a clean window and committed)

- Capacitor 8.5.2 core, iOS, haptics, status bar and splash installed exact;
  no Android package. `capacitor.config.ts` documents every field
  (placeholder app id `com.arcanerush.app`, `webDir: dist`, status bar
  hidden, splash on the app color).
- `src/device/`: platform detection, haptics (medium on boss stomp, heavy
  on boss kill, success on a won run, 90 ms throttle, inert on web with
  four tests), shell (status bar, splash hide after the first frame, Screen
  Wake Lock instead of a keep-awake plugin), and a tap that wraps the live
  run's `tick` through the debug handle on native only, so no core edit was
  needed; it steps aside if the app ever calls `onSimEvents` directly.
- Scripts `cap:sync`, `cap:open`, `cap:preflight`; `docs/DEVICE.md` is the
  Mac guide. Capacitor 8 defaults to SwiftPM, so no Homebrew or CocoaPods.
- Single-file builds grew by 11 KB. `npx cap doctor` and config echo pass;
  `cap sync` needs the `ios/` folder the product owner creates on the Mac.
- For Phase C: the splash and background color in the config is the old
  dark indigo; it should match the page's light sky. App icon and splash
  art still to do with `@capacitor/assets` later. The product owner must
  pick a unique app id and sign with a personal team.

## 2026-09-13 — Task P: walking glitch (verified and committed)

- Three confirmed causes. (1) The squad view decided "advancing" from a
  single frame's z delta, but the sim moves in fixed 1/60 s steps behind an
  accumulator; at the phone's 120 Hz display half the frames saw no
  movement, so the crowd cut between run and idle every frame with the
  idle sway snapping on. (2) A 30 fps bake played at 1.3× on a 60 Hz
  display holds poses in a 2-1-2-2-1 pattern. (3) Babylon's frame
  correction expects the loop's end frame to repeat the first; the M3 bake
  dropped it, so every wrap skipped a pose. Per-body speed jitter was ruled
  out (constant per body).
- Fixes: looping ranges keep the repeated end frame; a new
  `vatSampling.ts` replaces Babylon's baked-animation includes with
  phase-in-frames math and a fractional row sample (one bilinear fetch
  where half-float filtering exists, otherwise two fetches and a mix),
  verified pixel-identical between paths; `durationOf` counts intervals
  (a corpse's last frame no longer pops to frame 0); the advancing
  decision is a low-passed speed with hysteresis.
- Results: idle flips 240 → 0 at both 60 and 120 Hz; frame-to-frame
  motion coefficient of variation 0.30 → 0.046. VAT sizes 265 / 177 /
  130 KB. Smoke passes with 0 compiles during play; no stress regression.
- Note for the record: the iPhone 17 Pro Max runs the page at 120 Hz, which
  also explains the capture maxima above 100 fps.
