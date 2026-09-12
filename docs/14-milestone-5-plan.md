# Milestone 5 plan: studio-quality look and feel

Author: tech lead. Status: approved in principle by the product owner on
2026-09-15 ("plan and implement"); design calls below are the tech lead's.
Immutable.

## Goal

The game should look like a studio designed it: one coherent palette from
sky to UI, a road and gates with real craft, a crowd that fills the road in
lines and moves like a flock, crisp rendering at the phone's native
resolution with a long view, and a game UI rather than an app UI.

## Feedback to response

| Feedback | Response |
|---|---|
| The horde is circular; it should fill the road in lines | Formation becomes line-filling: units fill the available width first in staggered rows, then extend backward. Available width shrinks under walls, so the crowd narrows into its lane. |
| Movement must be smoother | The squad's lateral motion becomes a critically damped spring with an acceleration limit; each drawn unit follows its slot through its own spring with a lag that grows toward the back, so the crowd flows like a flock; units lean into turns; the camera's lateral follow is smoothed. |
| Visibility range crazy low | Fog starts at 120 m and ends at 260 m; the road runs to the horizon; a sky dome with a gradient, soft clouds and distant hills; gentle atmospheric haze instead of a wall of fog. |
| Resolution very low | Rung 0 renders at the device pixel ratio up to 3 (native on the iPhone), no multisampling; the ladder steps 3 → 2 → 1.5 only when frame time demands. Textures at 1024 px. |
| UI looks like an app | A game UI kit: nine-slice ornate frames and buttons from Kenney's Fantasy UI Borders (CC0), gold trims, parchment panels, a logo treatment for the wordmark, icons for coins, staffs and upgrades, an ornate HUD plaque for the count and a framed boss bar, a victory banner on the result screen. |
| Gates too basic | Gates become magical arches built from KayKit Dungeon pieces (pillars and an arch) with a glowing rune plaque that carries the number, a shimmer inside the arch tinted by kind, and distinct silhouettes: green vine arch for add, red thorn arch for curses, gold crown arch for multipliers, blue crystal arch for fire rate, violet staff arch for weapons. |
| Road texture bad | A real cobblestone albedo at 1024 px (CC0 from ambientCG, or a high-quality procedural fallback), kerbs along both edges, grass blending at the sides, baked ambient darkening at the kerbs, subtle wear stripes where the lanes are. |
| Colors random | `src/data/palette.json` is the single source of truth: render materials and effects and the UI's CSS variables all derive from it. No literal colors in code. |

## Palette (binding)

See `src/data/palette.json`. Roles: `arcane` (primary, violet), `gold`
(accent), `sky`, `grass`, `stone`, `ink` (text on light), `parchment`
(panels), `bone` (enemies), `danger`, `spell.{ember,storm,frost}`,
`gate.{add,sub,mul,fireRate,weapon}`, `shadow`. Code references roles, never
hex strings; render exposes them as `Color3`s, UI as CSS variables generated
at build (`--c-arcane-base`, and so on).

## Contracts

### Formation (sim)

```
formationOffsets(count, availableWidth): ReadonlyArray<{x, z}>   // cached per (count, width bucket)
halfWidth(count, availableWidth): number
availableWidth(state): number   // road clamp width, reduced by walls at the squad's z
```

- Staggered rows across the available width with spacing 0.42 m at small
  counts shrinking to 0.28 m at 500; front row centered; z extends backward;
  the squad anchor stays the front-center; `halfWidth` saturates at the
  available half-width. The x clamp is `roadHalf − halfWidth`, floor 0.6 m.
- Lateral motion: `x` follows `targetX` through a critically damped spring
  with `lateralSpeed` as the speed cap and `lateralAccel` (data) as the
  acceleration cap. Bots unchanged; bands re-verified.

### Per-unit smoothing (render only)

Each drawn unit keeps a position that follows its slot through a spring
whose stiffness decreases with the unit's row index (front row tightest);
units lean by lateral velocity; no per-frame allocation; the sim's hitbox
is unchanged.

### Rendering quality (render core)

- Rung 0 = device pixel ratio up to 3, no MSAA. Ladder 3 → 2 → 1.5 → 1.
- Fog 120 to 260 m, sky dome with gradient, clouds and a distant hill
  band, haze color from `sky.haze`.
- Tone mapping and mild contrast through Babylon's image processing
  configuration in the materials (no extra pass); vignette subtle.
- Blob shadows under units, enemies, the boss and props as one
  thin-instanced soft disc mesh in `shadow.blob`.
- Warm-up must still report 0 compiles during play.

### Environment and gates (render art)

- Road: 1024 px cobblestone albedo, kerbs, grass blend, lane wear.
- Gates: arch assemblies from KayKit Dungeon Remastered (CC0, fetched
  through the existing asset script), rune plaque carrying the atlas
  number, kind-tinted shimmer, distinct silhouette per kind; the plaque
  replaces the translucent panel. Draw budget: gates in view as thin
  instances per piece, under 6 draw calls total.
- Walls: dungeon wall and pillar pieces replace the fence posts.
- Boss arena: pillars and banners marking the arena.
- Props re-tinted to the palette; sky dome; ambient motes.

### UI (ui)

- Nine-slice frames and buttons from Kenney Fantasy UI Borders and UI
  Pack (CC0), icons from Kenney Game Icons (CC0), embedded in the offline
  builds; CSS variables from the palette; Cinzel and Nunito stay.
- HUD: count on an ornate plaque with the staff icon, coins with an icon,
  a framed boss bar with a gem, level chip in the same frame family.
- Academy: logo treatment, menu board with framed cards and icons, rooms as
  framed panels with icon rows, purchase buttons with a gold gradient and
  press animation.
- Result: victory or defeat banner with ribbon, framed stats, coin roll.

## Definition of done

1. All checks; smoke with a new hero-shot set at device pixel ratio 2 and
   3 (title, mid-run, gate row close-up, boss, result, academy, yard).
2. Tech lead frame review against this checklist: one palette, readable
   numbers, road and gates with craft, crowd in lines, long view, game UI.
3. Product owner reads it as studio-designed, and the phone holds rung 0
   at native resolution with render median under 8 ms.
4. Bands and golden tests pass with the new formation and spring.
5. Docs, ASSETS.md rows for every new asset, ledger entries.

## Team plan

| Phase | Agent | Scope | Depends on |
|---|---|---|---|
| B | sim and squad | Formation, spring, available width under walls, bands; per-unit render smoothing in the squad view | none |
| A | render core | DPR policy, fog and sky, tone mapping, blob shadows, palette loader, camera smoothing | none |
| C | render art | Road, kerbs, gates as arches, walls, arena, props, motes; asset fetch for Dungeon pieces and textures | palette loader (A) for colors; builds against the role names |
| D | ui | UI kit fetch and embed, CSS variables from the palette, HUD, Academy, rooms, result | none |
| E | integration | Wire, tune, hero shots, builds | A, B, C, D |
| F | review | Independent review and fixes | E |

Ownership is by file: B owns `src/sim/**`, `src/data/balance.json`,
`src/render/squad.ts`, `src/render/crowdLook.ts`; A owns `Renderer.ts`,
`scene` and engine files, `cameraRig.ts`, `cameraLook.ts`, `quality.ts`,
`palette.ts` (loader), `warmup.ts`, `views.ts`, `shadows.ts` (new); C owns
`road`, `biome`, `gates`, `walls`, `wallLook`, `spriteSheets`, `effects`
palette use, `props`, `sky` files, `scripts/fetch-assets.mjs` additions,
`assets/models`, `assets/textures`; D owns `src/ui/**`, `index.html`,
`assets/ui/**`, `scripts/fetch-ui.mjs`, `scripts/inline-assets.mjs` for the
UI assets, `src/data/academy.json`.
