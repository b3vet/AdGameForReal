# Device playtest fixes: stretched scene, pause menu

Status: requested by the product owner on 2026-09-16 after the first run of
the Capacitor build on their iPhone (a 6.9-inch Pro Max, 1320×2868 at 3x).
Milestone 9 is closed; this is a follow-up and its log is a dated entry in
document 26. Still no ads, no IAP, no analytics (D6).

The owner's words: "The game has distorted aspect ratio in the app, this was
not the case while I was testing it on the web" and "there is no way to pause
during gameplay, I want a pause button and menu, the button can be next to the
sound button in the ui in the gameplay screen."

## A. The scene is stretched in the app

What the screenshot shows: the HTML overlay is right and the 3D scene is
squeezed sideways by about 2.2. The same level on the web at 440×956 has a
wide road and round hats; on the phone the road is a strip and the wizards
are tall blobs. 956 / 440 = 2.17, which is what a square backing store
(1320×1320) stretched over a portrait canvas looks like. That is a lead, not a
finding: the cause is established in the iOS Simulator before anything is
changed, and the fix is verified there.

Wanted:

- The cause, measured: `canvas.width/height`, `drawingBufferWidth/Height`,
  `clientWidth/clientHeight`, `innerWidth/innerHeight` and `devicePixelRatio`
  at boot and during a run in the WKWebView.
- A fix that keeps the backing store the shape of the canvas whatever the
  shell does to the web view's frame and whether or not a `resize` event is
  fired; and that, where the browser clamps the drawing buffer, lowers the
  pixel ratio rather than letting the aspect drift.
- The same numbers in the device report and the debug panel, so the next
  device run can confirm it without a Mac.
- The web build unchanged in look and cost.

## B. A pause button and a pause menu

Decided here on the owner's behalf, as the conventional defaults; the owner
may change any of them.

- A round pause button beside the sound button, same size and look, shown
  only while a run is being played. It never steers the squad.
- Pressing it stops the run: the sim clock, the frame loop's catch-up, the
  sound effects and music. The frozen frame stays on screen, dimmed.
- The pause menu: title "Paused"; Resume (primary); Restart level; Home (the
  Academy). Restart and Home abandon the run: no coins, no mission, streak or
  bestiary progress from it, no result screen.
- Coming back to the app after it was backgrounded mid-run opens the pause
  menu instead of throwing the player straight back into the fight.
- On the web, Escape and P toggle it.
- Endless runs get the same menu.

## C. Every sound effect fails to load in the app (found on the way)

Not reported by the owner: found by agent A in the simulator's console,
where all seventeen clips logged `failed to load {}`. The console bridge
prints an `Error` as `{}`, so the reason was hidden; the warning now reads
as one line. Added to this document once found, before anything was
committed, because a silent game on the next device run would have been
the owner's first finding.

Wanted: the reason, measured in the simulator; every clip loading and
reaching `play()` there; the web build unchanged.

## Team plan (three agents, never more than two at once, inside D56)

- Agent A owns `src/render`, `src/core/appInput.ts`, the report and debug
  numbers, `dist/` and `ios/`, and the iOS Simulator.
- Agent B owns the pause button, the menu and the pause state (`src/ui`,
  `src/core`, `src/data`), builds to its own output directory, and does not
  touch `dist/` or `ios/`.
- Agent C (added with section C, once A had finished) owns the clip loading
  path: `src/audio` loading and `assetBytes` in
  `src/render/characters/manifest.ts`, and `dist/`, `ios/` and the simulator
  after A.
- The tech lead integrates, runs the full checks and the smoke, verifies all
  three on the simulator, and commits.

## Definition of done

1. On the simulator at iPhone Pro Max size the scene has the web build's
   proportions, at boot and after backgrounding and returning.
2. The pause button pauses, the menu's three actions do what they say, and a
   return from the background lands on the menu.
3. Every sound clip loads in the simulator with no warning.
4. Typecheck, lint, tests and the smoke pass; the smoke covers pause.
