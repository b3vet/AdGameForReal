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

## 2026-09-13 — Phase B1: walls, 20 levels, progression, wisp (verified and committed)

- Upgrades split by where they act: `generateLevel` applies starting units
  and the add-gate bonus (they shape the level), `Run` applies damage, fire
  rate and boss damage (they shape the squad); a player with no upgrades
  resolves to frozen multipliers of exactly 1. Golden run hashes for
  levels 1 to 3 from before the milestone still reproduce byte for byte;
  levels 4 to 20 change by design (walls, the 20-level retune).
- `selectedStaff` added to `PlayerState`. Burn ignites only the struck body
  (splash already pays the neighbors). Frost shatter reads the player's
  tier and cannot cascade. `familiar`, `walls` and `bossId` are optional
  on the state so fixtures outside the sim still compile.
- Walls start at row 5 (`walls.fromRow`): a wall guarding the opening rows
  turned a level-7 seed from a clear into a wipe. A new row rule keeps two
  horde rows from following each other (about 1200 bodies in two lanes cost
  the greedy bot levels 16 and 17).
- 20-level curve: survivors 0.70 to 0.80 on 1 to 3, 0.55 to 0.70 on 4 to 5,
  0.35 to 0.65 from 6; leaks under cap and non-zero from 6; boss 19 to 28 s;
  peaks within band. Greedy 100 of 100 wins at 0.58 survivor share; random
  loses 18.8 of 20 and clears level 1 on every seed; worst loses every
  level from 2. Perf 0.30 ms per tick at 300 bodies plus 300 units.
- Affordance: a greedy shopper clearing 1..N once each clears N+3 for N in
  {3, 6, 9, 12, 15}; all five upgrades max out by level 12 to 13, ember
  evolves at 13, wisp tier 3 at 17.
- Events: `enemyBurning` on ignite only, `familiarShot`, `wallBlocked`
  edge-triggered once per wall. Numbers in `progression.json`, `walls` and
  `bots.wallCommitDistance` in balance, `wallRows` and levels 11 to 20 in
  levels.json. Sim tests 176 → 219.
- Open: a peak and boss-HP step between levels 10 and 11; walls only nudge
  because the 2 m gate clearance allows a last-second swerve; `events.ts`
  at 412 lines; `dpsTrim` unchanged.

## 2026-09-13 — Phase B3: Academy, coins, save v2 (verified and committed)

- Save v2 holds `unlockedLevel`, `muted`, `debug`, `firstClears`,
  `revealedRooms` and the `PlayerState`; v1 migrates once with defaults;
  corrupt or absent storage yields a fresh save; every field is repaired on
  read (clamped levels, tiers on unowned staffs walked back, selected staff
  reset to ember when unowned). 24 tests.
- The home screen is the Academy over the dressed road: coin pill, cards
  for Play, Yard, Workbench, Sanctum and Bestiary, locked cards showing
  their level, a one-shot reveal persisted per room. Play opens a two-page
  level picker. Rooms share one overlay screen. Result adds coins with a
  count-up, the total, and a first-clear badge; the Academy is always
  offered so a won run can shop. Copy and unlock levels in
  `src/data/academy.json`.
- The player flows `AcademyController → RunSession → generateLevel/Run`;
  rewards paid on `runEnded`; the bestiary is a Set fed by activation
  events with no allocation.
- Sounds for purchase, unlock, reveal, coin tick, wall bump and wisp shot
  from reused clips with pitch and volume in `audio.json`.
- Smoke gains a fourth run with an injected save (coins, two upgrades,
  storm, wisp) and shots of the home, the yard and the coin result; a
  cleared level that pays no coins now fails the smoke. About 5.5 minutes.
- Incident: a git stash from another agent briefly reverted this agent's
  tracked files mid-flight; it restored them from a backup and the tech
  lead verified the tree (no stash entries, typecheck, lint and 284 tests
  clean). Agents are reminded not to run git commands that touch the tree.
- Tech lead frame review: the wordmark sits mid-screen over the gate
  preview on the home screen and should move up (Phase C).
- Open: `src/core/player.ts` deep-imports `@/sim/player` until the sim
  index re-exports the meta layer; the first Yard reveal is silent because
  audio is locked before the first gesture.
