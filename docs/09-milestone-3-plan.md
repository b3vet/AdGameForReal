# Milestone 3 plan: bright, magical, swarming, smooth

Author: tech lead. Status: approved by product owner on 2026-09-11 with the
answers below. Supersedes `08-milestone-3-plan-draft.md`. Immutable.

## Product owner answers

1. Look: bright and flat with a soft toon ramp, no outlines.
2. Streams: one soldier lost per enemy that touches the squad, and stream
   density set so the squad can barely clear each incoming wave.
3. Font: tech lead's pick (Cinzel for display and numbers, Nunito for body),
   may change later.
4. Baseline frame-rate readout from the iPhone 17 Pro Max to follow; the
   build gains an in-game FPS toggle because query parameters may not reach
   the game inside the hosted page.

## Goal

Fix the presentation and pacing the Milestone 2 playtest called out and make
the game smooth on a flagship phone, before any meta or device work.

## Feedback to response

| Feedback | Response |
|---|---|
| Too dark, too realistic, wants casual | Daylight palette, saturated colors, high ambient with a soft key, a toon ramp (two or three bands, no outline) applied through a material plugin so it works with baked vertex animation; bouncier animation timing (faster clips, squash-and-stretch on pop-in). Epic stays in boss weight and sound. Supersedes the dark half of D21. |
| Squad reads as hats | Camera elevation about 26° (from 36°), look-ahead retuned so the road still fills the frame; hat scaled to 0.8 in the bake; units 0.66 → 0.78 m with formation spacing widened to match. Verified at 5, 60 and 400 units. |
| Shots look like bullets | Animated magic sprites as billboarded flipbook quads (thin instances, additive): fireball with flame trail, crackling zigzag bolt, spinning ice crystal with mist, plus a sparkle trail pool. Bigger and slightly slower than the bolts. |
| Enemies too weak | Enemy streams: individual grunts, 40 to 300 per lane over 6 to 15 s, each 1 to 3 HP, dying on its own (baked death, ragdoll for one in ten), each removing one unit on contact. Brute blocks stay. Horde rows pour two lanes. A remaining-count number floats over each stream's head. |
| Gates too close | Rows every 18 m; streams live between rows; 8 to 12 gate rows; 60 to 75 s before the boss. |
| First levels easier | Levels 1 to 3 generous (no curses on level 1, more add gates, light streams); ramp on 4 and 5; Milestone 2 targets from level 6. |
| Boss text blocks the boss | Number above the boss's head, smaller; HUD bar remains primary. |
| UI text, font | HUD reduced to count, staff badge, boss bar, level chip, mute. Legend, hint and staff flash removed. Cinzel for title, numbers, labels; Nunito for body. OFL, subset, embedded for offline builds. Gate and enemy numbers in Cinzel via the digit atlas. |
| Not smooth on the phone | Measure, fix the suspects in order, re-measure with the product owner. Target 60 fps at 300 units plus 200 live stream enemies. |

## Stream pressure (the "barely clear" rule)

For a stream with `count` enemies of `hp` each, the window is the time from
the stream's first enemy entering projectile range to the last enemy
reaching the squad if none died. Pressure is
`count × hp / (expected squad dps × window)`.

| Level band | Pressure for the expected squad | Greedy leaks per stream |
|---|---|---|
| 1 to 3 | 0.45 to 0.6 | at most 3 percent |
| 4 to 5 | 0.65 to 0.8 | at most 6 percent |
| 6 to 10 | 0.85 to 0.95 | at most 10 percent, never zero on average |

Each leak costs one unit. The balance test asserts these bands with the
greedy bot, and random and worst bots keep the Milestone 2 loss targets from
level 6 (random at most 2 losses of 10 on level 1).

## Enemy streams (sim)

```
StreamDef   { lane, kind: "grunt", count, durationSeconds, hpPerEnemy, speed, jitter }
EnemyState  { id, kind, x, z, hp, alive, streamId?, ... }   // one per enemy
StreamState { id, lane, remaining, spawned, headZ, done }
RowDef gains streams: StreamDef[] (a "horde" row is two streams)
```

- Enemies spawn at the origin over the duration and walk toward −z with
  slight lateral jitter, so the stream reads as a river.
- Projectile sweeps hit the first live enemy in the lane band; splash hits
  neighbors within radius; chain jumps along the stream.
- Contact: each enemy reaching the squad removes one unit and dies.
- Up to 300 live enemies; per-lane sorted target lists; perf test 300
  enemies plus 300 units under 8 ms per tick.
- Events: `streamStarted`, `streamCleared`, `enemyKilled` per enemy
  (carrying `streamId`), `enemyLeaked`.
- Bots: greedy centers on the densest live stream lane when no gate row is
  within commit distance.

## Performance plan (in order)

1. Replace the fullscreen GUI texture with a digit atlas: glyphs rendered
   once from Cinzel into a texture; numbers drawn as thin-instanced quads
   with per-instance glyph index, color and scale. Zero per-frame uploads.
   Used for gate numbers, block HP, stream counts, boss number.
2. `preserveDrawingBuffer` off by default (on under `?screenshot=1` for the
   smoke).
3. MSAA off at pixel ratio ≥ 1.5; pixel ratio cap 2; ladder starts there.
4. Glow layer off by default; projectiles glow through additive sprites;
   glow becomes a quality-rung option.
5. Freeze materials and world matrices on static meshes;
   `freezeActiveMeshes` when the set is stable; skip pointer-move picking;
   block the material-dirty mechanism during batched changes.
6. In-game FPS toggle (triple-tap the level chip or the title) persisted in
   the save, plus a "capture" button that copies a 10-second readout.

## Definition of done

1. All checks pass; balance tests pass the pressure bands and level-band
   targets.
2. Product owner reports 60 fps at level 8 with the FPS overlay on the
   iPhone 17 Pro Max and that it feels smooth.
3. Frames reviewed for: daylight look, squad reads as mages, magical
   projectiles, streams dying as they come, boss number above the head,
   Cinzel numbers, minimal HUD.
4. Offline builds under budget with fonts embedded and no GUI texture.
5. Docs: log per phase; ledger entries D28 to D31.

## Team plan

| Phase | Agent | Scope | Depends on |
|---|---|---|---|
| T | toggle | In-game FPS toggle and capture button on the current build, interim publish | none |
| A | perf | Digit atlas labels replacing the GUI texture; engine flags; glow policy; housekeeping | T |
| B1 | sim | Streams, 18 m rows, generator, pressure bands, tests | none |
| B3 | ui | Font pipeline (subset, embed), HUD reduction, result screen, offline font check | T |
| B2 | render | Art direction reset, toon ramp, camera and unit scale, magical projectiles, boss number placement, stream rendering | A |
| C | integration | Wire streams into render, physics and audio; tune; builds; re-measure with the product owner | B |
| D | review | Independent review and fixes | C |

Interim builds: after T (baseline measurement), after A and B3 (perf fixes
judged alone), after C (full milestone).
