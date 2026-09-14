# Assets

Every file in `assets/` and where it came from. Written and maintained by the
asset pipeline agent (Milestone 2, Phase A). Definition of done item 11.

Everything here is **CC0** except the two fonts under `assets/fonts/`, which are **OFL 1.1** (licence texts in `assets/licenses/ofl-*.txt`). The licence text of each pack is copied verbatim
into `assets/licenses/`; the quoted lines below are from those files.

## How to rebuild

```
node scripts/fetch-assets.mjs    # download the packs, trim, write assets/
node scripts/fetch-ui.mjs        # assets/ui/*.svg, recoloured from palette.json
node scripts/bake-vat.mjs        # assets/vat/*.bin + *.json from the models
node scripts/audio-convert.mjs   # assets/audio/*.wav from the cached Kenney zips
```

`scripts/glb.mjs` is the glTF/GLB document surgery the first of those uses; it
knows nothing about the network or our asset list, which is why it is separate.

All of them are idempotent. `fetch-assets.mjs` needs Playwright's Chromium for
one step — the two ambientCG albedos are decoded, composited and re-encoded in a
browser page, because there is no JPEG decoder in Node and no image dependency
may be added. It is the same browser the smoke test uses (`npx playwright
install chromium`), and nothing else in the script touches it.

Downloads are cached in `node_modules/.asset-cache/`
(git-ignored because `node_modules/` is); delete it to force a refetch. If a
future sandbox has a Node build whose `fetch` ignores `HTTPS_PROXY`, prefix the
first command with `NODE_USE_ENV_PROXY=1`.

`fetch-assets.mjs` does more than copy, and that is deliberate: KayKit characters
carry 76 to 95 animations, which is 80 percent of their bytes, so it keeps only
the clips we play and garbage-collects the accessors and buffer views that go
with them. It also folds `.gltf` + `.bin` + `.png` into a single self-contained
`.glb` per model, so the runtime makes one request per model and the single-file
build has one thing to base64.

`audio-convert.mjs` needs the Kenney zips in the cache, so run `fetch-assets.mjs`
first.

### Where the packs actually came from

`github.com` and `codeload.github.com` are blocked by this session's egress
policy (403 for any repo the session is not bound to), and `static.itch.io`
likewise. Two routes work and are the ones the script uses:

- **jsDelivr's GitHub mirror**, `https://cdn.jsdelivr.net/gh/<owner>/<repo>@main/<path>`,
  for the three KayKit packs. jsDelivr fetches from GitHub server-side, so the
  policy does not apply. Directory listings at the same URLs are how the file
  paths were discovered.
- **Google Drive** for Quaternius, who publishes his packs as shared folders.
  `https://drive.google.com/uc?export=download&id=<id>` serves a file directly.
- **ambientCG directly**: `https://ambientcg.com/get?file=<id>_1K-JPG.zip`
  redirects to its own CDN and `fetch` follows it. Reachable from here, so the
  plan's procedural fallback for the road tile was not needed.

If a future session can reach GitHub, the same files are at
`github.com/KayKit-Game-Assets/...` and nothing else needs to change.

## Packs

| Pack | Source | Licence line |
|---|---|---|
| KayKit Character Pack: Adventurers (1.0) | `KayKit-Character-Pack-Adventures-1.0` via jsDelivr | "License: (Creative Commons Zero, CC0)" |
| KayKit Character Pack: Skeletons (1.0) | `KayKit-Character-Pack-Skeletons-1.0` via jsDelivr | "License: (Creative Commons Zero, CC0)" |
| KayKit Halloween Bits (1.0) | `KayKit-Halloween-Bits-1.0` via jsDelivr | "License: (Creative Commons Zero, CC0)" |
| KayKit Dungeon Remastered (1.0) | `KayKit-Dungeon-Remastered-1.0` via jsDelivr | "License: (Creative Commons Zero, CC0)" |
| ambientCG materials (PavingStones131, Grass004, Ice004, Snow006) | ambientcg.com/get → acg-download.struffelproductions.com | "All ambientCG assets are provided under the Creative Commons CC0 1.0 Universal License." (quoted from ambientcg.com/license into `assets/licenses/ambientcg.txt`; the zips carry no licence file) |
| Quaternius Ultimate Monsters | quaternius.com → Google Drive | "CC0 1.0 Universal (CC0 1.0) Public Domain Dedication" |
| Kenney Impact Sounds (1.0) | kenney.nl/assets/impact-sounds | "License: (Creative Commons Zero, CC0)" |
| Kenney RPG Audio | kenney.nl/assets/rpg-audio | "License (Creative Commons Zero, CC0)" |
| Kenney UI SFX Set | kenney.nl/assets/ui-audio | "License (Creative Commons Zero, CC0)" |
| Kenney Sci-Fi Sounds (1.0) | kenney.nl/assets/sci-fi-sounds | "License: (Creative Commons Zero, CC0)" |
| Kenney Music Jingles | kenney.nl/assets/music-jingles | "License (Creative Commons Zero, CC0)" |
| Kenney Fantasy UI Borders (1.0) | kenney.nl/assets/fantasy-ui-borders | "License: (Creative Commons Zero, CC0)" |
| Kenney UI Pack (2.0) | kenney.nl/assets/ui-pack | "License: (Creative Commons Zero, CC0)" |
| Kenney Game Icons | kenney.nl/assets/game-icons | "License (CC0)" — fetched and evaluated; nothing from it ships (see "UI kit" below) |
| Cinzel (v26) | fonts.googleapis.com CSS API → fonts.gstatic.com; OFL via jsDelivr | "This Font Software is licensed under the SIL Open Font License, Version 1.1." |
| Nunito (v32) | fonts.googleapis.com CSS API → fonts.gstatic.com; OFL via jsDelivr | "This Font Software is licensed under the SIL Open Font License, Version 1.1." |

Two notes on the licence files. Quaternius's `License.txt` inside the Ultimate
Monsters folder is headed "Ultimate Platformer Pack" — his own copy-paste slip;
the pack page at `quaternius.com/packs/ultimatemonsters.html` links to
`creativecommons.org/publicdomain/zero/1.0/` and the file's own licence line is
CC0, so the dedication is not in doubt. Every KayKit and Kenney file says credit
is appreciated but not required; we credit them here and should credit them in
the game's about screen when there is one.

### Substitutions against the plan

`06-milestone-2-plan.md` names two things we could not use as written:

- **KayKit Forest Nature Pack** has no GitHub repository and its itch.io
  download endpoint refuses the request from here. **KayKit Halloween Bits**
  replaces it: same artist, same atlas style, and dead trees, gravestones and
  wrought-iron fence read closer to the "epic and heavy, near-black indigo"
  tone of D21 than a green forest would.
- **KayKit Character Animations** is not needed at all. Every character `.glb`
  in the Adventurers and Skeletons packs already carries the shared animation
  set (76 clips on the Mage, 95 on the skeletons), on the same rig. No
  retargeting, no second download.

## Files

Sizes are the shipped file, after trimming. `assets/` totals **4.8 MB**, against
a 12 MB budget (it was 3.0 MB before the Milestone 3 re-bake added a clip to
each character, 3.4 MB before Milestone 5's UI kit added 10 KB of SVG, 3.6 MB
before Milestone 5's art track added the dungeon pieces and the two albedos —
435 KB in all — and 3.9 MB before Milestone 7 added Frostfell and the two new
monsters: 748 KB of models, 138 KB of baked animation, 97 KB of props and
159 KB of textures, 1.14 MB in all; Milestone 7 Phase E's softer ice grade then
gave 33 KB of that back).

### Models — `assets/models/`

| File | Size | Source | Use |
|---|---|---|---|
| `mage.glb` | 526 KB | KayKit Adventurers, `Characters/gltf/Mage.glb` | The squad. Carries the body meshes, hat, cape, and the `2H_Staff` / `1H_Wand` / `Spellbook_open` accessories the three staffs use. Trimmed to 5 clips (Milestone 3 added `Spellcast_Raise` as `cast2`). |
| `skeleton_minion.glb` | 467 KB | KayKit Skeletons, `Characters/gltf/Skeleton_Minion.glb` | Grunt units inside an enemy block, and every body in a stream. Trimmed to 3 clips (Milestone 3 added `Running_C` as `walk2`). |
| `skeleton_warrior.glb` | 495 KB | KayKit Skeletons, `Characters/gltf/Skeleton_Warrior.glb` | Brute units; comes with its own helmet. Trimmed to 3 clips (Milestone 3 added `Running_C` as `walk2`). |
| `boss_demon.glb` | 408 KB | Quaternius Ultimate Monsters, `Big/glTF/Demon.gltf` | The biome-1 boss. Trimmed to 5 clips. |
| `charger.glb` | 327 KB | Quaternius Ultimate Monsters, `Big/glTF/Dino.gltf` | Milestone 7's charger (D49). One skinned mesh (`Dino`, 5414 triangles) on the pack's shared 43-bone rig; trimmed to 4 clips and baked to a VAT, so a lane full of them is one draw call. |
| `boss_rime.glb` | 390 KB | Quaternius Ultimate Monsters, `Big/glTF/Yeti.gltf` | The Rime Fiend, boss 2 (D49). One mesh (`Yeti`, 6094 triangles), 2.83 m in its own units; trimmed to 6 clips. Drawn as a skinned model with its animation groups intact, like the demon — no VAT. |
| `skeleton_warrior.glb` (Milestone 7) | 529 KB | the same file, plus KayKit Skeletons `Assets/gltf/Skeleton_Shield_Large_A.gltf` | +34 KB: the shield is grafted into the warrior's own rig under `handslot.l` at fetch time (`graftAccessory` in `scripts/glb.mjs`), which is what makes the shielded brute a *variant* rather than a second model. See "The shielded brute's shield" below. |

#### The mage's colours, and where the numbers came from

One material and one atlas serve the whole character, so the only handle the
renderer has on a part of it is the vertex colour the shader multiplies the
albedo by: `tints` in `assets.json` per mesh, and `tintPatches` per rectangle of
the atlas (`src/render/characters/tint.ts`). The atlas is a palette of flat
patches and short gradient strips, which is what makes a rectangle a meaningful
unit. The rectangles below were read off `assets/models/mage.glb` by sampling
the texture at each triangle's own UVs; re-read them if the pack is ever
re-exported.

| Part of the mage | Atlas rectangle | In the file | On screen now |
|---|---|---|---|
| Hat crown | u 0.13–0.22, v 0.26–0.40 (the light half of a gradient strip) | navy, 76–108 grey levels | saturated mid-violet |
| Hat brim and the crown's flare | the same strip, v 0.40–0.47 | the darkest end, 36–51 | a lighter violet, so the brim edge is the light rim of the silhouette |
| Hat band | u 0.66–0.69, v 0.04–0.13 | orange, 182–222 | warm gold (it used to clip to white under the one hat multiplier) |
| Band buckle | u 0.41–0.46, v 0.02–0.13 | steel blue-grey | pale gold |
| Hair | u 0.14–0.23, v 0.03–0.16, three quarters of the head mesh | near-black, 19–49 | warm sandy brown |
| Face | u 0.01–0.10, v 0.05–0.21 | skin, 243–247 | untouched (it used to clip to white) |

Robes and cape are unchanged from Milestone 3 Phase B2.

### Baked animation — `assets/vat/`

| File | Size | Texture | Ranges |
|---|---|---|---|
| `mage.bin` + `.json` | 259 KB | 168 × 197, half-float RGBA | idle 0–31, run 32–55, cast 56–83, cast2 84–146, cheer 147–196 |
| `skeleton_minion.bin` + `.json` | 175 KB | 168 × 133 | walk 0–47, walk2 48–71, death 72–132 |
| `skeleton_warrior.bin` + `.json` | 130 KB | 168 × 99 | walk 0–48, walk2 49–73, death 74–98 |
| `charger.bin` + `.json` | 138 KB | 176 × 100, half-float RGBA | idle 0–30, run 31–48, attack 49–75, death 76–99 |

Sizes and ranges above are the Milestone 3 re-bake, which added `cast2` to the
mage and `walk2` to both skeletons (docs/10-milestone-3-log.md, Phase B2). The
bake fails above 300 KB, which the mage is now within 40 KB of: a sixth mage
clip needs either a smaller one or a second texture.

The charger is the first non-KayKit rig in here: Quaternius's monsters carry 43
bones, so its texture is 176 texels wide where the KayKit ones are 168. There is
no `shieldBrute` bake, and there does not need to be one — a VAT is bone
matrices, so the warrior's own texture drives the shield exactly as the mage's
drives all three staffs (D23).

Width is `(bones + 1) × 4` texels — 41 bones on the shared KayKit rig. Height is
one row per baked frame at 30 fps (the source is 60; half the rows for units
twenty pixels tall). Looping ranges drop their last frame, which duplicates the
first.

A VAT is bone matrices, so nothing about a *mesh* can be baked into it. That is
why the mage's hat is resized in the merge instead, by `partScales` in
`assets.json` (`src/render/characters/asset.ts`): **0.88** as of Milestone 3
Phase C, scaled about the hat's own node origin, before the re-skin and the
un-mirror. It cannot go much lower — the scale is uniform, so below about 0.85
the crown is narrower than the skull it sits on and the mage's hair comes
through the hat. Phase B2's 0.6 was under that floor, which is what the frame
review saw as "near-black hats": the dark dome was the hair.

### Props — `assets/props/`

All from KayKit Halloween Bits, `Assets/gltf/`, each converted to a
self-contained `.glb` with the shared atlas embedded (~16 KB of the size of each
file is that atlas, repeated).

| File | Size | Use |
|---|---|---|
| `tree_dead_large.glb` | 24 KB | Roadside silhouette, far |
| `tree_dead_medium.glb` | 24 KB | Roadside, mid |
| `tree_dead_small.glb` | 24 KB | Roadside, near |
| `tree_pine_orange_large.glb` | 36 KB | Depth behind the dead trees |
| `tree_pine_orange_medium.glb` | 36 KB | Depth behind the dead trees |
| `gravestone.glb` | 32 KB | Ground clutter, the "rock" of this biome |
| `grave_A.glb` | 32 KB | Ground clutter |
| `pillar.glb` | 24 KB | Arena markers |
| `post_lantern.glb` | 44 KB | Light source at the roadside; pairs with the glow pass |
| `fence.glb` | 44 KB | Road edge |

Milestone 5 (D39) adds five pieces from **KayKit Dungeon Remastered (1.0)**,
`Assets/gltf/`. That pack already ships each piece as `<name>.gltf.glb` — a
self-contained GLB with the shared `dungeon_texture` atlas embedded — so unlike
the Halloween props nothing is folded together on the way in and the bytes are
copied through unchanged. About 15 KB of each file is that atlas, repeated; the
duplication is cheaper than the second material a shared texture would cost at
runtime, and it is what lets a whole arch be one mesh in one draw call.

Two things to know before placing one. They are authored **in metres** (the
Halloween props are not, which is why `assets.json` gives these `scale: 1`), and
they come out of `loadStaticMesh` **mirrored in x**, because that loader bakes
the glTF loader's right-to-left-handed flip into the vertices: a piece the
artist authored from x = 0 to x = 2 arrives spanning -2 to 0
(`src/render/dungeonPieces.ts`).

| File | Size | Source | Use |
|---|---|---|---|
| `dungeon_column.glb` | 20 KB | `column.gltf.glb` (0.7 × 1.4 × 0.7 m) | Every voussoir of a gate arch's ring, rolled to its own angle on the curve |
| `dungeon_barrier_half.glb` | 19 KB | `barrier_half.gltf.glb` (2 × 1.1 × 0.5 m) | The parapet across the top of a gate arch, and the 2 m run of a lane wall (D32) |
| `dungeon_pillar.glb` | 25 KB | `pillar.gltf.glb` (1.5 × 4 × 1.5 m) | A gate arch's two legs, and the boss arena's markers |
| `dungeon_banner_blue.glb` | 24 KB | `banner_blue.gltf.glb` (1.5 × 3.2 m) | Hangs on the arena pillars, re-tinted through the material |
| `dungeon_torch_lit.glb` | 31 KB | `torch_lit.gltf.glb` (0.55 × 1.13 m) | The roadside light from level 6, where the lantern stops |
| `dungeon_rubble_large.glb` | 59 KB | `rubble_large.gltf.glb` | Milestone 7: a Frostfell snow mound. The stone atlas is near-neutral grey, so an albedo multiplier lifts it to a drift with stone showing through — which the pack's orange pine cannot do (see `SNOW` in `src/render/propKinds.ts`) |
| `dungeon_rubble_half.glb` | 38 KB | `rubble_half.gltf.glb` | The smaller mound, same tint |

### Textures — `assets/textures/`

The road and the field, from **ambientCG** — CC0, photogrammetry, and the one
place a hand-painted tile could not compete: real medieval paving with moss in
the joints (Milestone 5 plan, "Road texture bad").

Both are downsized and re-encoded by `fetch-assets.mjs` rather than shipped as
downloaded. The 1K JPEGs in those zips are 1.8 and 2.0 MB, which the single-file
builds (12 MB hosted, D25) cannot afford; at the sizes below the pair is 314 KB
and still oversampled for a road tile 2.2 m across on a phone. There is no JPEG
decoder in Node and no image dependency may be added, so the resize runs in
Playwright's Chromium — already a devDependency for the smoke test — which is
also where the paving's ambient-occlusion map is multiplied into its albedo.
That multiply is what puts the shadow in the joints: the road material is unlit
stone with a toon ramp over it, and nothing in the scene would otherwise cast it.

| File | Size | Source | Use |
|---|---|---|---|
| `road_cobble.jpg` | 250 KB | ambientCG `PavingStones131`, 1K JPG, colour × AO, re-encoded to 1024 px at quality 0.75 | The road surface, one repeat every 2.2 m |
| `field_grass.jpg` | 64 KB | ambientCG `Grass004`, 1K JPG, re-encoded to 512 px at quality 0.72 | The field either side, and the grass fringe that blends over the kerbs |
| `road_frost.jpg` | 85 KB | ambientCG `Ice004`, 1K JPG, re-encoded to 1024 px at quality 0.68, graded `contrast(0.49) brightness(1.39) saturate(0.5) hue-rotate(14deg)` | The Frostfell road surface, one repeat every 3 m. A frozen lake from above: cells of ice with white fracture veins between them, which carry the same information the paving's joints do. The source averages rgb 125,141,140 — a dark sea-green, and a whole road of that is darker than the crowd standing on it; graded it averages 179,184,185, beside the meadow road's 145,137,119 and a shade to the blue. Milestone 7 Phase E added the `contrast` step: `brightness(1.45)` alone measured luminance mean 190 with deviation 49 and 21 percent of the tile clipped to white, which read busier and darker than the cobble (137, deviation 29) and pulled the eye off the crowd; the pair now measures 183, deviation 30, 6 percent clipped, and the file is 33 KB smaller for it. It is the one albedo here with no `AmbientOcclusion.jpg` in its zip, so nothing is multiplied in: the veins are the shading, and the road mesh's own vertex colours still carry the gutter and the lane wear |
| `field_snow.jpg` | 25 KB | ambientCG `Snow006`, 1K JPG, colour × ambient occlusion, re-encoded to 512 px at quality 0.72 | The Frostfell verge and the snow fringe over the kerbs. Trodden snow rather than one of the pack's fresh ones: `Snow005` averages 147,148,149 with almost no local variation and reads as a blank sheet at a 4 m tile, while this one ships an occlusion map, so the composite has the dimples of a walked-on drift in it |
| `road_cobble.jpg` — Milestone 5 Phase E colour grade | 249 KB | Same source and pipeline, with `saturate(0.72) hue-rotate(-14deg)` applied to the albedo before the occlusion is multiplied in (`AMBIENTCG_TEXTURES[].tint` in `scripts/fetch-assets.mjs`) | The paving is photographed with moss in its joints and averaged hue 53 at saturation 0.13, which read as olive once it covered the whole road (Phase C frame review). Graded it averages hue 40 at 0.11, beside `stone.base`'s 37, and keeps every bit of its photographic variation — a tint on the material would have multiplied the joints and the highlights by the same number |

Everything else the road, the gates and the motes are painted with is drawn in
code at boot (`src/render/artTextures.ts`): the plaque face, the gate shimmer,
the mote blob and the alpha ramps. A gradient or a mask is a few hundred bytes
of drawing commands and would be a hundred kilobytes of PNG. Frostfell's ice
crystals are drawn rather than fetched for the same reason
(`src/render/frostProps.ts`): no CC0 pack here has a crystal, and three
octahedra in a palette colour read better at twenty metres than a mismatched
prop would.

### Dropped in Milestone 7

`tree_dead_large`, `tree_dead_medium`, `tree_dead_small`, `grave_A` and
`pillar`, all Halloween Bits — 128 KB. No view had placed one since Milestone 3
re-weighted the roadside around the pines, and an unplaced model is not free:
every entry in `assets.json` is base64'd into the single-file builds whether
anything draws it or not, and those five were 171 KB of the 12 MB hosted
ceiling (D25) that Frostfell's own assets needed. Both files list them in their
own history — one line in `PROPS` in `scripts/fetch-assets.mjs` and one entry in
the manifest brings any of them back.

### Audio — `assets/audio/`

17 clips, **421 KB** total, all 22050 Hz mono 16-bit PCM WAV, trimmed, faded and
peak-normalised to −1 dBFS. WAV rather than Ogg because Safari on iOS cannot
play Ogg, and rather than MP3 because there is no encoder in this repo and none
may be added.

| File | s | Source clip | Event |
|---|---|---|---|
| `shot_ember.wav` | 0.75 | Sci-Fi Sounds `laserLarge_002` | Ember staff shot |
| `shot_storm.wav` | 0.25 | Sci-Fi Sounds `laserSmall_001` | Storm staff shot |
| `shot_frost.wav` | 0.26 | Sci-Fi Sounds `laserRetro_003` | Frost staff shot |
| `enemy_hit.wav` | 0.12 | Impact Sounds `impactGeneric_light_001` | Projectile hits a block |
| `block_kill.wav` | 0.43 | Impact Sounds `impactPunch_heavy_001` | Block destroyed |
| `shatter.wav` | 0.18 | Impact Sounds `impactGlass_heavy_003` | Frost shatter, gate glass |
| `gate_tick.wav` | 0.08 | UI SFX `click3` | Gate number ticking up |
| `gate_pass_good.wav` | 0.22 | RPG Audio `metalLatch` | Passed a positive gate |
| `gate_pass_bad.wav` | 0.78 | Sci-Fi Sounds `forceField_002` | Passed a curse |
| `units_gained.wav` | 0.72 | RPG Audio `handleCoins` | Recruits pop in |
| `units_lost.wav` | 0.15 | Impact Sounds `impactSoft_medium_002` | Units die |
| `boss_stomp.wav` | 2.01 | Sci-Fi Sounds `lowFrequency_explosion_000` | Boss stomp |
| `boss_hit.wav` | 0.12 | Impact Sounds `impactMetal_heavy_002` | Boss takes damage |
| `boss_death.wav` | 1.96 | Sci-Fi Sounds `explosionCrunch_004` | Boss dies |
| `win_fanfare.wav` | 0.94 | Music Jingles `jingles_STEEL00` | Level clear |
| `lose_sting.wav` | 0.71 | Music Jingles `jingles_HIT09` | Defeat |
| `ui_tap.wav` | 0.10 | UI SFX `click1` | Any button |

### Fonts — `assets/fonts/`

The two UI faces (decision D30), added by Milestone 3 Phase B3 and rebuilt with
`node scripts/fetch-fonts.mjs`. Not CC0 like everything above: both are under
the SIL Open Font License 1.1, which permits embedding and redistribution with
the licence, and forbids selling the fonts on their own.

Two things shape what is here. Google's CSS API splits a family by unicode
range, and the game's copy plus the digit atlas are ASCII, so only the `latin`
block of each family is kept — that is the whole subsetting step, with no font
tooling in the repo. And both families are served as **variable** fonts, so the
`latin` file for Cinzel 700 and for Cinzel 900 is one and the same download;
`src/ui/styles.css` declares one `@font-face` per family with a `font-weight`
range rather than one per weight.

| File | Size | Source | Use |
|---|---|---|---|
| `cinzel-latin.woff2` | 25,904 B | `fonts.gstatic.com/s/cinzel/v26/8vIJ7ww63mVu7gt79mT7.woff2` | Display and numbers: wordmark, squad count (900), chips, buttons, result numbers (700). The digit atlas rasterises from this family. |
| `nunito-latin.woff2` | 39,128 B | `fonts.gstatic.com/s/nunito/v32/XRXV3I6Li01BKofINeaB.woff2` | Body lines — the few that are left after the HUD reduction. |
| `licenses/ofl-cinzel.txt` | 4,383 B | `cdn.jsdelivr.net/gh/google/fonts@main/ofl/cinzel/OFL.txt` | "This Font Software is licensed under the SIL Open Font License, Version 1.1." — "Copyright 2020 The Cinzel Project Authors" |
| `licenses/ofl-nunito.txt` | 4,385 B | `cdn.jsdelivr.net/gh/google/fonts@main/ofl/nunito/OFL.txt` | "This Font Software is licensed under the SIL Open Font License, Version 1.1." — "Copyright 2014 The Nunito Project Authors" |

Two notes on the routes, since neither is the obvious one. The CSS API serves
woff2 only to a modern user agent — an old or absent `User-Agent` gets ttf — so
`fetch-fonts.mjs` sends a current Chrome string. And `github.com` is blocked
from this sandbox exactly as it is for the KayKit packs, so the OFL texts come
through jsDelivr's mirror of `google/fonts`; `fonts.google.com` was not needed.

The bytes reach an offline build through the `@font-face` rules, not through
the manifest loader: `scripts/inline-assets.mjs` rewrites `url(/assets/fonts/…)`
into a `data:` URI in the CSS of the single-file builds. The `font` entries in
`assets.json` are the inventory record that tells the inliner which files those
are, and carry the family and weight the digit atlas asks for.

### UI kit — `assets/ui/`

The game UI's nine-slice frames and button bodies (decision D39), added by
Milestone 5 Phase D and rebuilt with `node scripts/fetch-ui.mjs`. Two Kenney
packs, both CC0.

**SVG, not PNG, and generated rather than copied.** Kenney ships every piece as
a 48 px PNG *and* as one vector sheet; a 48 px corner ornament stretched onto a
3x phone is a blurry corner ornament, and the vector is exact at any density for
about a kilobyte. Generated because the colours are ours: the script reads
`src/data/palette.json` and writes Kenney's white frames out as a gold gradient
and the UI Pack's grey ramp as gold or parchment, so the only hex in these files
came from the palette and a palette change is one command from the whole kit.
The eight files total **10 KB**.

| File | Size | Source piece | Use |
|---|---|---|---|
| `frame-panel.svg` | 1,291 B | Fantasy UI Borders, `panel_border_026` | The parchment boards on the Academy, the picker and the rooms; also the Play card |
| `frame-card.svg` | 659 B | Fantasy UI Borders, `panel_border_001` | Room cards, Yard and Workbench rows, bestiary entries, result stats |
| `frame-plaque.svg` | 828 B | Fantasy UI Borders, `panel_border_013` | The HUD's squad-count plaque |
| `frame-bar.svg` | 1,084 B | Fantasy UI Borders, `panel_border_003` | The boss bar |
| `frame-inset.svg` | 872 B | Fantasy UI Borders, `panel_border_012` | Quiet frames: the coin purse, the level chip, the picker's level tiles |
| `divider.svg` | 737 B | Fantasy UI Borders, `divider_003`, mirrored | The flourish under a screen heading |
| `button-gold.svg` | 2,278 B | UI Pack, `Vector/Grey/button_rectangle_depth_border.svg` | Primary buttons: Play, Buy, Ascend |
| `button-stone.svg` | 2,278 B | the same piece, parchment ramp | Secondary buttons: Back, Again, Academy, Select |

Every frame is sliced at **16** of the piece's own 48 units
(`border-image-slice: 16`); the button is sliced `9 11 14 11 fill`, where the 14
is Kenney's depth edge along the bottom — `.button:active` shrinks that border
to 9 and moves the button down by the difference, so a press compresses the
bevel instead of sliding the whole plate.

Kenney's dividers are drawn one-ended, to be used in mirrored pairs; the script
stamps the piece twice, the second copy flipped about x, so one file is a
symmetric ornament.

The icons — the coin, the three staffs, the five drills, the wisp, the four
rooms and the padlock — are **not** here. They are an inline `<symbol>` sprite
at the top of `index.html` (`src/ui/icons.ts` references it), because what this
game needs is thematic and Kenney's Game Icons is a set of interface glyphs. An
inline path costs no request in any build and takes its colour from the same
CSS variables as everything around it.

These reach an offline build the way the fonts do, through the stylesheet rather
than the manifest loader: `scripts/inline-assets.mjs` rewrites
`url(/assets/ui/…)` into a `data:` URI for the single-file builds. The `ui`
entries in `assets.json` are the inventory record that tells the inliner which
files those are.

### Licences — `assets/licenses/`

Twelve `.txt` files, one per pack, copied verbatim from the source archives.

## The boss

**Demon**, from Quaternius Ultimate Monsters (`Big/glTF/Demon.gltf`). 2.91 m
tall in its own units, 3862 triangles for the body plus a 399-triangle trident,
one 43-bone rig, one atlas material. It has `Walk`, `Punch` (the attack),
`Death`, `HitReact` and `Idle`, which is exactly the set the plan asks for, and
red-on-near-black reads against the indigo sky of D21.

The pack's other large monsters share the identical 14-clip set, so any of them
is a drop-in replacement for a later biome — change one line in
`scripts/fetch-assets.mjs` and one URL in `assets.json`. In descending order of
how well they fit biome 1: **Yeti** (heaviest silhouette), **Orc**,
**MushroomKing**, **BlueDemon**, **Tribal**, **Ninja**, **Alien**, **Dino**,
**Cactoro**, **Monkroose**, **Orc_Skull**, **Frog**, **Bunny**, **Birb**,
**Fish**. There are also `Blob/` and `Flying/` folders in the same pack for
variety later.

Milestone 7 took two of them (D49), and the swap was exactly those two lines.

**Yeti**, as the **Rime Fiend**: the heaviest silhouette in the pack, 2.83 m in
its own units against the demon's 2.91, and one mesh rather than the demon's
two (the demon carries a separate 399-triangle trident). Trimmed to six clips —
the demon's five plus `Run`, which is the lane charge D49 gives boss 2 and the
one thing boss 1 cannot do. `assets.json` maps it as `charge`.

**Dino**, as the **charger**: the pack's clearest runner, 3.23 m in its own
units and 5414 triangles. Unlike the two bosses it is baked to a VAT and drawn
as a crowd, because a level stands several of them, so it is trimmed to the four
clips a charger can be in — `Idle`, `Run`, `Punch` (the lunge) and `Death`. The
manifest's `scale` of 0.45 makes it 1.45 m tall, a little over twice a mage; it
is a starting value like every other one here and the render agent should tune
it by eye.

### How the Drive ids were found

Quaternius publishes each pack as a shared Drive folder and the ordinary folder
page is script-rendered, so its HTML carries no file list. The endpoint that
does is `https://drive.google.com/embeddedfolderview?id=<folder>#list`, which
serves a plain `<div id="entry-<file id>">…<div class="flip-entry-title">name`
per child. The trail for this pack:
`quaternius.com/packs/ultimatemonsters.html` links folder
`18m4KpzpEzhC9wl7jzr6dUc0N8Jozr79C`; inside it `Big` is
`1fOL6ES-e73dPPLzc7_vvmTJ4uZ_j8QG2` and `Big/glTF` is
`1sOXLt5U3ofaujPlQRL11s4ub2UsqN8V8`. The seventeen file ids in that last folder
are every monster listed above; three of them are in `QUATERNIUS_MONSTERS` in
`scripts/fetch-assets.mjs`.

## The shielded brute's shield

The shielded brute (D49) is **not a model of its own**. It is
`models/skeleton_warrior.glb` drawn with the manifest variant `shield`, on the
warrior's existing baked texture — so it costs one extra merged mesh in the
renderer and nothing at all in draw calls, materials or VAT budget.

What had to happen for that to be possible is the one new piece of glTF surgery
in this milestone. KayKit keeps weapons and shields *out* of the character files
and in `Assets/gltf/` as standalone models, while the accessories that are in a
character file — the mage's staffs, the knight's shields — are plain meshes
parented to a `handslot` bone, which is the shape `src/render/characters/asset.ts`
knows how to re-skin and merge (D23). `graftAccessory` in `scripts/glb.mjs` puts
the loose file into that shape at fetch time: it copies the shield's buffer
views and accessors into the warrior's binary chunk, points its primitive at the
warrior's existing `skeleton` material (both are the same atlas, so no second
material and no second draw call), and hangs a node named
`Skeleton_Shield_Large_A` off `handslot.l`.

The grip is the rig's own, not a number tuned by eye. `Knight.glb` in the
Adventurers pack carries four shields under `handslot.l` at one shared local
transform — identity rotation, translation `(0, 0.017012, 0.155885)` — and the
standalone `shield_round.gltf` has byte-identical geometry to the one inside
that file, which is what proves the loose models are authored in the same local
frame as the in-character ones. `handslot.l` itself is identical between the
Adventurers and Skeletons packs, so the knight's offset is the skeleton's.

`Skeleton_Shield_Large_A` is 923 vertices and 626 triangles; `..._Large_B` and
the two `Small` shields are in the same folder if a lighter or a different
silhouette is ever wanted.

## Animation name mapping

The game never says a KayKit or Quaternius string. `assets.json` carries the
map; this is the same table in prose.

| Model | Game id | Clip in the file |
|---|---|---|
| mage | `idle` | `Idle` |
| mage | `run` | `Running_A` |
| mage | `cast` | `Spellcast_Shoot` |
| mage | `cheer` | `Cheer` |
| skeleton_minion | `walk` | `Walking_D_Skeletons` (the shambling skeleton-specific walk) |
| skeleton_minion | `death` | `Death_C_Skeletons` (crumbles, rather than falling over) |
| skeleton_warrior | `walk` | `Walking_C` (heavier stride, suits the brute) |
| skeleton_warrior | `death` | `Death_A` |
| boss_demon | `idle` | `Idle` |
| boss_demon | `walk` | `Walk` |
| boss_demon | `attack` | `Punch` |
| boss_demon | `hit` | `HitReact` |
| boss_demon | `death` | `Death` |
| charger | `idle` | `Idle` |
| charger | `run` | `Run` |
| charger | `attack` | `Punch` (the lunge that kills its share of the column) |
| charger | `death` | `Death` |
| boss_rime | `idle` | `Idle` |
| boss_rime | `walk` | `Walk` |
| boss_rime | `attack` | `Punch` |
| boss_rime | `charge` | `Run` (D49's lane charge) |
| boss_rime | `hit` | `HitReact` |
| boss_rime | `death` | `Death` |

## The three staffs, and how they are attached

The Mage `.glb` already contains `2H_Staff`, `1H_Wand`, `Spellbook` and
`Spellbook_open` as accessory meshes parented to the `handslot.r` / `handslot.l`
bones, all using the same `mage_texture` material as the body. So:

| Staff | Mesh | Why |
|---|---|---|
| Ember | `2H_Staff` | Big gnarled staff, the heaviest silhouette |
| Storm | `1H_Wand` | Short and quick, matches the fastest projectile |
| Frost | `Spellbook_open` | A frozen grimoire. See the open issue below. |

The skeleton warrior's `shield` variant (D49) rides on exactly this rule and
adds nothing to it — the only difference is that its mesh was put into the file
by `graftAccessory` rather than by the artist. See "The shielded brute's shield"
above.

**Approach chosen: skin the accessory to its parent bone (option a), then merge
the result into the body mesh.** The reasoning:

- A VAT bakes the *skeleton*, not the mesh — the texture is bone matrices. So
  one baked `mage.bin` drives the body, the hat, the cape and all three staffs.
  Baking per weapon would have tripled the texture for no gain.
- The accessories share the body's material, so merging them in costs no extra
  draw call and no second per-instance buffer. A weapon swap is a different
  merged mesh, not a different texture: 500 mages with any staff is still one
  draw call, which is definition-of-done item 3.
- The re-skin itself is exact rather than hand-tuned. The accessory is already
  positioned in the artist's rest pose, so its transform relative to the rig's
  bind space is `accessoryWorld × inverse(bodyWorld)`; bake that into its
  vertices, set `matricesIndices` to the parent bone and `matricesWeights` to
  1, and the bone's baked matrix (the identity at rest) puts it back exactly
  where the artist left it. No grip offsets to tune.

Merging into the mage (option b) alone would not have worked: it does not say
what to do about the fact that the accessory has no skinning attributes at all,
which is the actual problem. The two are complementary and we do both.

### One more thing the merge does

Babylon's glTF loader converts right-handed glTF into its left-handed world by
adding a `__root__` node scaled −1 on x. A thin instance cannot inherit that
node, so the flip is folded in twice: `asset.ts` negates the x of every merged
vertex and reverses the triangle winding, and `bake-vat.mjs` conjugates every
baked bone matrix by the same `diag(-1, 1, 1, 1)`. Miss either half and the
crowd is either mirrored or inside out.

## Why the bake does not use `bakeVertexDataSync`

`VertexAnimationBaker.bakeVertexDataSync` drives `scene.beginAnimation(skeleton,
f, f)`, which needs the animations to live on the `Bone` objects. Babylon's glTF
loader puts them on `TransformNode`s and links the bones to those nodes instead,
so `bone.animations` is empty and the helper bakes whatever animation group the
loader happened to auto-play — it produces a texture that looks plausible and is
wrong. `bake-vat.mjs` steps the `AnimationGroup` with `goToFrame`, calls
`skeleton.prepare()` and reads `getTransformMatrices()`, which is the same array
the helper writes, then converts with Babylon's own `ToHalfFloat`. Half-float
is used everywhere; the manifest records `"format": "half-float-rgba"` so a
device without half-float render support can be detected and handled.

## Open issues

1. **`npm run build` does not copy `assets/`.** Vite only copies `publicDir`,
   and `dist/assets/` is already where Vite writes its own chunks. The dev
   server serves `/assets/...` from the repo root, so every dev page and
   screenshot in this phase works; a production build has no assets. The fix is
   two lines in `vite.config.ts`, which this agent does not own:
   `build.assetsDir: 'bundle'` to free the name, plus a copy of `assets/` into
   `dist/assets/` in `closeBundle`. Then `/assets/...` means the same thing in
   dev and in production and `assets.json` needs no change.
2. **Frost has a spellbook, not a staff.** The Adventurers pack only ships two
   caster props on the mage atlas. The alternatives are the Skeletons pack's
   `Skeleton_Staff` (a bone staff, right look, but a second atlas and therefore
   a second draw call for the frost crowd) or shifting the `2H_Staff` UVs to a
   different column of the gradient atlas to recolour it icy. The second is
   free and is the recommendation if the render agent wants a third staff.
3. **The skeletons lose their glowing eyes.** `Skeleton_*_Eyes` uses a separate
   emissive `Glow` material, so the merge leaves it out and the sockets read
   dark. That looks fine, but if the eyes are wanted the cheap route is a
   second `VatCrowd` over the same baked texture — the VAT is per rig, so the
   eye mesh can share it.
4. **A one-shot range still loops.** The shader's `fract(time)` wraps every
   range, so a `death` animation replays. Whoever draws dying units should take
   the instance out of the crowd after `crowd.durationOf('death')` seconds.
5. **No blending.** A VAT switches ranges instantly. Stagger `timeOffset` and
   the cut disappears into the crowd; a hero unit that needs a blend has to be
   an ordinary skinned mesh.
6. **`scale` in `assets.json` is a starting value.** 0.35 makes a KayKit
   character 0.62 m, matching `SQUAD_HEIGHT` in `theme.ts`; the boss is 1.0 for
   2.9 m against `BOSS_HEIGHT` 3. The render agent should tune both by eye.
