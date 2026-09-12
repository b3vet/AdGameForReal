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
