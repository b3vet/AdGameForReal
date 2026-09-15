# Milestone 9 plan, approved: device and store readiness

Status: approved by the product owner on 2026-09-15 ("have the milestone 9
ready. Plan and implement it"). Scoped from the roadmap (D47). Log is
document 26. Still no ads, no IAP, no analytics (D6).

## How this milestone ends

The owner clones the repository on a Mac, drops their own AI-generated icon
and splash over the placeholders, runs three commands, opens Xcode, signs,
and installs on their iPhone; then plays the campaign through and sends
feedback. So the deliverable is a repository that builds an app with no
step this side needs, and the guides that carry the owner from clone to
phone without a question.

## The owner's inputs

- Icon and splash come from the owner's AI image generator; this side ships
  placeholders drawn from the palette and the prompts to use (D57,
  `docs/ART.md`). Replacing the art is dropping two files and running one
  command.
- Process rule (D56): at most five general-purpose Opus agents run in
  parallel; every milestone plans its waves inside that.

## Scope

### A. App art pipeline (assets, scripts, web)

- Placeholders drawn from the palette by a script (`scripts/app-art.mjs`,
  SVG rendered to PNG in Chromium as the textures were): `assets/app/
  icon.png` 1024×1024 (no rounded corners, iOS masks them), `assets/app/
  splash.png` 2732×2732 with the subject in the centre 40 percent (it is
  cropped to portrait), `assets/app/splash-dark.png`, and Android adaptive
  foreground and background layers.
- `@capacitor/assets` as a dev dependency and `npm run cap:assets`
  generating the iOS and Android catalogues from those files.
- Web: `public/` favicon, apple-touch-icon and a web manifest with the theme
  colour; index.html links them; the single-file builds are unaffected.
- `docs/ART.md`: the exact files, sizes and safe zones, the regenerate
  command, and the prompts for the owner's generator (icon and splash,
  with the palette's hex values and the constraints that make the result
  drop-in).

### B. Native shell polish (device, ui, core, render)

- Safe areas: every plaque, chip and button clears the notch and the home
  indicator (`env(safe-area-inset-*)` audited on every screen); `100dvh`;
  no rubber-band, callout, selection or zoom on the canvas.
- Portrait lock through the screen-orientation plugin at boot on native.
- Pause and resume: the app-state plugin's background event pauses the sim
  clock and mutes audio, foreground resumes; the web build does the same
  on `visibilitychange`; a save is flushed on background.
- WebGL context loss and restore in the renderer (iOS drops contexts under
  memory pressure and on backgrounding): rebuild what is lost, keep the run.
- Haptics for the systems since Milestone 4, throttled: a light tap on a
  gate pass, a medium on a shield break and a charger's contact, a heavy on
  a meteor and a boss charge, a success on a mission completing or a tier
  unlocking, a warning on the wipe; nothing during ordinary shooting.

### C. Project, pipeline and guides (scripts, config, docs)

- Generate the native projects here if the CLI can do it without Xcode
  (`npx cap add ios`, `npx cap add android`) and commit them, so the owner's
  first build is open-and-sign; otherwise the guide keeps the create step.
- Info.plist: portrait only, `ITSAppUsesNonExemptEncryption` false, a
  privacy manifest declaring no tracking and no required-reason APIs beyond
  what WebKit itself uses; version and build stamped from package.json
  (`npm run cap:version`).
- `cap-preflight.mjs` checks the art files and sizes, the plugins, the
  projects, the plist keys, and prints the next command.
- `docs/DEVICE.md` rewritten for the new flow (clone, install, drop art,
  `cap:assets`, `cap:sync`, open, sign, run; every time after; what to
  report; TestFlight; Android). `docs/STORE.md`: the App Store metadata
  draft (name, subtitle, description, keywords, category, age rating
  answers, screenshot plan from the hero set, privacy answers, export
  compliance) so nothing is invented at submission time.

### D. Device report and performance (ui, core)

- The debug panel gains "Copy report": device and browser, screen and
  pixel ratio, WebGL renderer string, ladder rung and quality, the last
  capture's numbers, the last run's summary, and the save's headline
  (level, coins, streak), copied to the clipboard as text the owner can
  paste into feedback. `?perf` runs a scripted level-20 capture of 30 s
  and shows the report.
- The ladder's first rung and the capture's thresholds re-checked against
  native pixel ratio 3; anything the phone needs on day one is a data
  change.

## Definition of done

1. From a fresh clone on a Mac: `npm ci`, drop two PNGs, `npm run
   cap:assets`, `npm run cap:sync`, `npm run cap:open`, sign, run. No other
   step. The guide says exactly that and the preflight proves each part
   that can be proved without Xcode.
2. Placeholders in place and the prompts written; the web build has a
   favicon and manifest.
3. Safe areas clean on 390×844 with a 47 px top inset and 34 px bottom
   inset simulated; pause and resume tested in the smoke by firing the
   visibility event mid-run; context loss simulated with the WebGL
   extension and the run continuing.
4. Haptics wired and throttled with tests; the report copies.
5. All checks, smoke, hosted build (the playtest link keeps working),
   log, ledger.

## Team plan (five agents at most, D56)

| Wave | Agents | Scope |
|---|---|---|
| 1 | A art, B shell, C project and guides, D report | as above, file ownership below |
| 2 | E integration and review (one agent) | wire, smoke, review, builds |

Ownership: A owns `assets/app/**`, `public/**`, `scripts/app-art.mjs`,
`index.html` head links, `docs/ART.md`, the `cap:assets` script line; B owns
`src/device/**`, `src/ui/**` CSS for safe areas, `src/core/frame.ts`,
`App.ts` wiring for pause and resume, `src/render/Renderer.ts` for context
loss, `src/audio` for mute; C owns `capacitor.config.ts`, `scripts/cap-*.mjs`,
`ios/**`, `android/**`, `docs/DEVICE.md`, `docs/STORE.md`, package.json
scripts and dependencies for the plugins; D owns `src/ui/debug.ts` and its
CSS, `src/core/handle.ts`, `query.ts`, a new `src/core/report.ts`.
