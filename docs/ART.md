# App art: icon and splash

What the app is dressed in outside the game — the home-screen icon, the launch
splash, the browser tab — and how the product owner replaces the placeholders
with their own AI-generated art (decision D57, `docs/25-milestone-9-plan.md`
section A).

Everything in `assets/app/` is a **placeholder drawn from the palette** by
`scripts/app-art.mjs`. It is our own work, not a downloaded asset; it exists so
that the repository builds a signable app before any art arrives, and so that
the shapes and colours of the real thing have something to be measured against.

## The files

| File | Size | What it is |
|---|---|---|
| `assets/app/icon.png` | 1024×1024 | The app icon. Square, full bleed, **no rounded corners and no alpha channel** — iOS masks the corners itself and the App Store rejects an icon with transparency. |
| `assets/app/icon-foreground.png` | 1024×1024 | Android adaptive icon, foreground layer. Transparent outside the mark. |
| `assets/app/icon-background.png` | 1024×1024 | Android adaptive icon, background layer. Opaque, no subject — a launcher may crop a third of it away. |
| `assets/app/splash.png` | 2732×2732 | The launch screen, light mode. Square because every device crops it to its own shape. |
| `assets/app/splash-dark.png` | 2732×2732 | The same composition for dark mode. |
| `public/favicon.svg` | vector | The tab icon, the mark itself rather than a rasterisation. |
| `public/apple-touch-icon.png` | 180×180 | iOS "Add to Home Screen" from Safari. |
| `public/icon-192.png`, `public/icon-512.png` | 192, 512 | The web manifest's icons. |
| `public/manifest.webmanifest` | — | Name, colours, `display: standalone`, `orientation: portrait`, the icons. |

Every PNG is kept **under 400 KB**. They are copied into the app bundle rather
than downloaded by a player, so the limit is modest housekeeping rather than a
budget — but a 2732×2732 image with a radial or diagonal gradient across it
costs half a megabyte on its own, which is why the placeholder skies are
vertical ramps.

## Safe zones

The three that matter, because art that ignores them gets cut:

- **Icon — a 10 percent margin.** iOS masks the 1024 square to a squircle and a
  maskable web icon crops to a circle. Keep the subject inside the centre 80
  percent; let the background run to all four edges.
- **Android adaptive foreground — the centre 66 percent.** The launcher decides
  the shape (circle, squircle, teardrop) and may crop everything outside a
  66 percent circle. `@capacitor/assets` then insets both layers by a further
  16.7 percent, so a mark that fills the centre 66 percent of the source lands
  at about 40 percent of the launcher icon — deliberately conservative.
- **Splash — the centre 40 percent.** A phone keeps the square's full height
  and crops the width to roughly the middle half (a 19.5:9 screen keeps about
  46 percent). Everything that must be seen goes inside the centre 40 percent
  in *both* axes; the rest of the square is sky that gets thrown away.

The splash's top and bottom edges are exactly `APP_BACKGROUND` (`#bfe4f5` in
`capacitor.config.ts`), which is also the colour the native shell paints before
the web view draws and the `theme_color` in the manifest and in `index.html`.
Those four are one colour on purpose: if they diverge, the launch flashes.
`scripts/app-art.mjs` reads it out of `capacitor.config.ts` so the art cannot
drift from the shell; `index.html`'s `<meta name="theme-color">` is hand-kept
and has to be changed with it.

Two consequences of that, both deliberate:

- The **dark splash** is the one place the shell colour and the image disagree.
  Capacitor has a single `backgroundColor`, and it is the light one, so a phone
  in dark mode paints one pale frame before the dark splash arrives. Living
  with a single frame is better than launching the light build on a dark field
  every time; if it ever grates, delete `splash-dark.png` and the light splash
  is used in both modes.
- The placeholder splash **draws the wordmark itself**, in Cinzel out of
  `assets/fonts`. Generated art should carry no text at all — image generators
  spell badly, and a wordmark baked into someone else's typeface is not the
  game's. If the owner's splash has no title on it, that is the intended
  result: the app's name is under its icon already.

## Replacing the art

Two files, one command:

1. Overwrite `assets/app/icon.png` (1024×1024) and `assets/app/splash.png`
   (2732×2732). Optionally `splash-dark.png`, and the two Android layers.
2. Run `npm run cap:assets`.

That runs `@capacitor/assets`, which crops and resizes the sources into the
native catalogues:

- **iOS** — `ios/App/App/Assets.xcassets/AppIcon.appiconset/` (one
  1024×1024 `AppIcon-512@2x.png`, the single size modern Xcode wants, written
  with no alpha channel) and `ios/App/App/Assets.xcassets/Splash.imageset/`
  (`Default@1x/2x/3x~universal~anyany.png` plus the `-dark` variants).
- **Android** — `android/app/src/main/res/mipmap-*/` (`ic_launcher`,
  `ic_launcher_round`, `ic_launcher_foreground`, `ic_launcher_background` at
  every density, and the `mipmap-anydpi-v26/ic_launcher.xml` adaptive
  descriptions) and `drawable-*/splash.png` for every density and orientation,
  day and night.

Then `npm run cap:sync` and build. No code path reads the source files, so a bad
icon is one re-run away from a good one. They do get *copied*: `vite.config.ts`
copies the whole of `assets/` into `dist/`, so `dist/assets/app/` carries a
second copy of the 944 KB into the app bundle. Harmless, and a one-line filter
in that plugin would drop it if the bundle size ever matters.

To regenerate the *placeholders* — after a palette change, say —
`node scripts/app-art.mjs`. It is idempotent: it only writes, and the same
palette through the same Chromium gives the same bytes. It also rewrites
`public/`, so the web icons and the app icon can never disagree.

### The web icons

`public/` is copied verbatim into `dist/` by Vite and is **not** part of the two
single-file builds: `build:artifact` and `build:hosted` emit a fragment of
title, styles, body and scripts, with no `<head>`, so the favicon, the
apple-touch-icon and the manifest never reach a playtest link and cost it
nothing. The favicon is an SVG rather than a PNG because a tab icon is 16 px in
one browser and 64 px in another.

## Prompts for the image generator

Two prompts, each self-contained — paste one, get one image. They name the hex
values so the result sits inside the game's own palette
(`src/data/palette.json`).

### Icon

> A mobile game app icon, square, 1024×1024 pixels. The subject is a young
> apprentice wizard's tall pointed hat, violet, seen from slightly above, with a
> wide brim, a broad gold band around the base and a square gold buckle on the
> band; a small glowing gold wisp orb floats in the air beside the hat's tip.
> The background is a smooth vertical gradient from violet #6d4fd6 at the top to
> deep indigo #3b2a7a at the bottom, with a soft light bloom behind the hat.
> The hat is violet #6d4fd6 with lighter violet #a48cff on the lit side; the
> band, the buckle and the orb are gold #f2b33d with pale gold #ffd97a
> highlights. Style: bright, casual, stylised low-poly or flat vector with soft
> shading, clean silhouettes, high contrast, no line art. It must read at 60
> pixels: one strong shape, one horizontal gold band, one round gold orb.
> Fill the frame edge to edge, with the hat and the orb inside the centre 80
> percent so a 10 percent margin stays clear all round. No text, no lettering,
> no logo, no border, no frame, no rounded corners, no drop shadow outside the
> square, no transparency. Not photorealistic, no realistic textures, no human
> face, no character looking at the camera, no watermark.

### Splash

> A mobile game launch screen, square, 2732×2732 pixels. Looking straight down a
> pale cobblestone road that runs away into the distance across bright green
> grass #7cc35a, with stylised autumn pine trees along both sides and two or
> three stone arch gateways standing over the road ahead. A column of small
> wizards in purple pointed hats walks away from the viewer down the road,
> seen from behind and small in the frame. The sky is a smooth vertical
> gradient from blue #4f9de6 at the top to very pale blue #e2f1fb at the
> horizon; the stone is warm pale grey, the gate arches carry gold #f2b33d
> details, the wizards' hats are violet #6d4fd6. Style: bright, casual,
> stylised low-poly or flat vector with soft shading, sunny daylight, high
> contrast, clean shapes, no line art. Composition: everything that matters —
> the road, the gates, the column of wizards — sits inside the centre 40
> percent of the square, because phones crop this to a tall portrait strip;
> the middle of that band stays calm, uncluttered and low in contrast, because
> the game's title is laid over it; the outer edges are plain sky and plain
> grass with nothing in them, and the top and bottom edges of the square are a
> pale sky blue close to #bfe4f5. No text, no lettering, no title, no logo, no
> border, no frame, no vignette, no UI elements. Not photorealistic, no
> realistic textures, no faces, no character looking at the camera, no
> watermark.

For the **dark variant** (`splash-dark.png`), run the splash prompt again with
this appended:

> Night version of the same composition, from the same camera: the same road,
> the same gates and the same column of wizards, under a night sky that is a
> vertical gradient from near-black indigo #1e1633 at the top to deep violet
> #3b2a7a lower down. The grass is a deep desaturated green, the gate arches and
> the wisp lights glow gold #ffd97a, and the wizards' hats stay violet. Same
> framing, same safe area, no text.

### If your generator makes portrait images

Most image generators offer 2:3 or 9:16 but not a true square at 2732. Generate
the tallest portrait it will give you, then pad it to a square:

- Put the portrait image in the middle of a 2732×2732 canvas and fill the bars
  left and right with the image's own sky colour at the top and grass colour at
  the bottom — or, simplest and safest, with flat `#bfe4f5`, the shell colour.
- Do not scale the portrait up to fill the square: that pushes the subject
  outside the centre 40 percent and a phone crops it away.

The icon has no such problem — ask for 1:1 and scale to 1024×1024. If your
generator only emits 512 or 768, upscale to 1024 before dropping the file in:
`@capacitor/assets` refuses a source under 1024×1024.
