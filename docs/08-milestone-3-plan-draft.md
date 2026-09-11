# Milestone 3 plan, draft v1: bright, magical, swarming, smooth

Author: tech lead. Status: DRAFT awaiting product owner answers to the
questions at the end. The final plan will be `09-milestone-3-plan.md`.

## Why this milestone, and not the Academy yet

The Milestone 2 playtest says the core presentation is wrong in four ways
(dark, hats, bullets, weak enemies), the pacing is wrong in two (gate
spacing, early difficulty), and the frame rate is not smooth on a flagship
phone. Every later milestone builds on these, so they come first.

## Feedback to response

| Feedback | Response |
|---|---|
| Too dark, too realistic, wants casual | Art direction reset: daylight palette, saturated colors, high ambient with a soft key light, a toon shading ramp on characters, bouncier animation timing. Epic stays in the boss weight and the sound, not in darkness. Supersedes the "dark dusk" half of D21. |
| Squad reads as hats | Camera elevation drops from about 36° to about 26° with the look-ahead retuned so the road still fills the frame; the mage hat scaled to 0.8 in the bake; units 0.66 → 0.78 m with formation spacing widened to match. Verified by screenshots at 5, 60 and 400 units. |
| Shots look like bullets | Projectiles become animated magic sprites: a fireball with a flame trail, a crackling zigzag bolt, a spinning ice crystal with mist. Billboarded flipbook quads as thin instances with additive blending, plus a sparkle trail pool. Bigger and slightly slower than the bolts. |
| Enemies too weak, wants hundreds streaming | New enemy model: individual enemies in streams. A stream lane pours 40 to 300 grunts over 6 to 15 s, each with 1 to 3 HP, each dying on its own (baked death animation, ragdoll for one in ten). Each grunt that touches the squad removes one unit. Brute blocks stay as tanky groups. A "horde" row pours two lanes at once. A remaining-count number floats over the head of each stream. |
| Gates too close | Gate rows every 18 m again; the space between rows is where streams live. Levels become 8 to 12 gate rows with streams between, 60 to 75 s before the boss. |
| First levels easier | Levels 1 to 3 are generous: more add gates, no curses on level 1, weak streams, a good player finishes with 70 to 80 percent of peak; random loses at most 2 of 10 on level 1. The current targets apply from level 6. |
| Boss health text blocks the boss | The in-world number moves above the boss's head, smaller; the HUD bar stays the primary readout. |
| Unnecessary UI text, generic font | UI reduced to: count, staff badge, boss bar, level chip, mute. Legend, hint and staff flash go. Font: Cinzel (magical, classic, numerals stay readable) for title, numbers and labels, with Nunito for the few lines of body text. Both Google Fonts, OFL licence, subset and embedded so the offline builds carry them. Gate and enemy numbers drawn in the same font. |
| Not smooth on iPhone 17 Pro Max | Measure first, then fix the known suspects (below), then re-measure with the product owner. Target: 60 fps at 300 units plus 200 live stream enemies. |

## Performance plan (the suspects, in order)

1. **Fullscreen GUI texture.** Every number label is a Babylon GUI control
   linked to a mesh. Linked controls move every frame, which marks the
   fullscreen texture dirty, which re-uploads a 2× screen-size canvas to the
   GPU every frame. On a 3× phone that is the single largest cost we have.
   Replace with a digit atlas: numbers drawn as thin-instanced quads sampling
   a glyph sheet rendered once from the chosen font. Zero per-frame uploads.
2. **`preserveDrawingBuffer: true`** on the engine (set for screenshots)
   forces an extra copy per frame on mobile. Off by default; on only under
   the smoke's query flag.
3. **Antialiasing and pixel ratio.** MSAA on a 2× buffer is expensive and
   invisible on a 460 ppi screen. Default pixel ratio cap 2 with MSAA off;
   the ladder starts there.
4. **Glow layer.** Two extra passes even at quarter resolution. Emissive
   sprites with additive blending replace it for projectiles; glow is off by
   default and becomes a quality-rung option.
5. **Babylon housekeeping**: freeze materials and world matrices on static
   meshes, `scene.freezeActiveMeshes` when the set is stable, skip pointer
   picking, block the material-dirty mechanism during batched changes.
6. **Physics** stays: 8 ragdolls and thin-instanced shards are cheap; stream
   deaths use baked animations, not ragdolls, except one in ten.

Instrumentation: `?debug` already shows fps, sim, render and physics ms,
draw calls, rung and pixel ratio. Add a 10-second "perf capture" button that
records the readout to the clipboard so the product owner can paste it.

## Enemy streams (sim design)

```
StreamDef   { lane, kind: "grunt", count, durationSeconds, hpPerEnemy, speed }
EnemyState  { id, kind, x, z, hp, alive, streamId? }        // one per enemy
StreamState { id, lane, remaining, spawned, headZ }        // for the floating count
```

- Enemies spawn at the stream's origin over its duration and walk toward
  −z at `speed` with slight lateral jitter, so a stream reads as a river.
- Projectile sweeps hit the first live enemy in the lane band; splash hits
  neighbors; chain jumps along the stream.
- Contact: each enemy that reaches the squad removes one unit and dies.
- Streams scale with the expected squad: `count ≈ dps × window × pressure`
  so a good squad clears them just before contact and a weak one is chewed.
- Cost: up to 300 live enemies. Targeting keeps a per-lane sorted list;
  the sim perf test grows to 300 enemies and 300 units under 8 ms per tick.
- Render: one `VatCrowd` per enemy kind; stream enemies are instances with
  walk and death ranges; a floating count per stream in the digit atlas.

## Definition of done

1. All checks pass; balance tests pass the new per-band targets (levels 1
   to 3 generous, 4 to 5 ramp, 6 to 10 current).
2. Product owner measures 60 fps on the iPhone 17 Pro Max with `?debug`
   at level 8, and reports the game feels smooth.
3. Frames reviewed for: bright daylight look, squad reads as mages, magical
   projectiles, streams of enemies dying as they come, boss number above the
   head, Cinzel numbers, minimal HUD.
4. Offline builds under budget with fonts embedded.
5. Docs: plan, log per phase, ledger entries for the art direction change
   and the enemy model change.

## Team plan

| Phase | Agent | Scope | Depends on |
|---|---|---|---|
| A | perf | Digit atlas labels replacing the GUI texture; engine flags; glow policy; housekeeping; perf capture in `?debug` | none |
| B1 | sim | Enemy streams, 18 m rows, new generator and balance bands, tests | none |
| B2 | render | Art direction reset, toon ramp, camera and unit scale, magical projectiles, boss label placement, stream rendering | A (labels) |
| B3 | ui | Font pipeline (subset, embed), HUD reduction, result screen in the new font, offline build font check | none |
| C | integration | Wire streams into render, physics and audio; tune; perf re-measure with the product owner; builds | B |
| D | review | Independent review and fixes | C |

Interim build after A and B3: product owner measures frame rate before the
new enemies land, so the perf fixes are judged on their own.

## Questions for the product owner

1. Look reference: bright and flat with a soft toon ramp and no outlines
   (cheap, my recommendation), or full cel shading with black outlines
   (costs a second pass per character)?
2. Streams: one soldier lost per enemy that touches the squad, as in the
   ads? My recommendation is yes.
3. Font: Cinzel (classic magical, clean numerals) or MedievalSharp (hand-cut,
   more casual)? Cinzel is my recommendation; I can show both on the title
   and a gate before committing.
4. Before I start the perf phase, please open the current build with
   `?debug` on the phone at level 8 and send the readout (fps, render ms,
   draw calls, rung, pixel ratio). It is the baseline the milestone is
   measured against.
