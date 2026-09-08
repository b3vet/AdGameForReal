# Assets

Every file in `assets/` and where it came from. Written and maintained by the
asset pipeline agent (Milestone 2, Phase A). Definition of done item 11.

Everything here is **CC0**. The licence text of each pack is copied verbatim
into `assets/licenses/`; the quoted lines below are from those files.

## How to rebuild

```
node scripts/fetch-assets.mjs    # download the packs, trim, write assets/
node scripts/bake-vat.mjs        # assets/vat/*.bin + *.json from the models
node scripts/audio-convert.mjs   # assets/audio/*.wav from the cached Kenney zips
```

`scripts/glb.mjs` is the glTF/GLB document surgery the first of those uses; it
knows nothing about the network or our asset list, which is why it is separate.

All three are idempotent. Downloads are cached in `node_modules/.asset-cache/`
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

If a future session can reach GitHub, the same files are at
`github.com/KayKit-Game-Assets/...` and nothing else needs to change.

## Packs

| Pack | Source | Licence line |
|---|---|---|
| KayKit Character Pack: Adventurers (1.0) | `KayKit-Character-Pack-Adventures-1.0` via jsDelivr | "License: (Creative Commons Zero, CC0)" |
| KayKit Character Pack: Skeletons (1.0) | `KayKit-Character-Pack-Skeletons-1.0` via jsDelivr | "License: (Creative Commons Zero, CC0)" |
| KayKit Halloween Bits (1.0) | `KayKit-Halloween-Bits-1.0` via jsDelivr | "License: (Creative Commons Zero, CC0)" |
| Quaternius Ultimate Monsters | quaternius.com → Google Drive | "CC0 1.0 Universal (CC0 1.0) Public Domain Dedication" |
| Kenney Impact Sounds (1.0) | kenney.nl/assets/impact-sounds | "License: (Creative Commons Zero, CC0)" |
| Kenney RPG Audio | kenney.nl/assets/rpg-audio | "License (Creative Commons Zero, CC0)" |
| Kenney UI SFX Set | kenney.nl/assets/ui-audio | "License (Creative Commons Zero, CC0)" |
| Kenney Sci-Fi Sounds (1.0) | kenney.nl/assets/sci-fi-sounds | "License: (Creative Commons Zero, CC0)" |
| Kenney Music Jingles | kenney.nl/assets/music-jingles | "License (Creative Commons Zero, CC0)" |

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

Sizes are the shipped file, after trimming. `assets/` totals **3.0 MB**, against
a 12 MB budget.

### Models — `assets/models/`

| File | Size | Source | Use |
|---|---|---|---|
| `mage.glb` | 472 KB | KayKit Adventurers, `Characters/gltf/Mage.glb` | The squad. Carries the body meshes, hat, cape, and the `2H_Staff` / `1H_Wand` / `Spellbook_open` accessories the three staffs use. Trimmed to 4 clips. |
| `skeleton_minion.glb` | 428 KB | KayKit Skeletons, `Characters/gltf/Skeleton_Minion.glb` | Grunt units inside an enemy block. Trimmed to 2 clips. |
| `skeleton_warrior.glb` | 456 KB | KayKit Skeletons, `Characters/gltf/Skeleton_Warrior.glb` | Brute units; comes with its own helmet. Trimmed to 2 clips. |
| `boss_demon.glb` | 408 KB | Quaternius Ultimate Monsters, `Big/glTF/Demon.gltf` | The biome-1 boss. Trimmed to 5 clips. |

### Baked animation — `assets/vat/`

| File | Size | Texture | Ranges |
|---|---|---|---|
| `mage.bin` + `.json` | 176 KB | 168 × 134, half-float RGBA | idle 0–31, run 32–55, cast 56–83, cheer 84–133 |
| `skeleton_minion.bin` + `.json` | 144 KB | 168 × 109 | walk 0–47, death 48–108 |
| `skeleton_warrior.bin` + `.json` | 96 KB | 168 × 73 | walk 0–47, death 48–72 |

Width is `(bones + 1) × 4` texels — 41 bones on the shared KayKit rig. Height is
one row per baked frame at 30 fps (the source is 60; half the rows for units
twenty pixels tall). Looping ranges drop their last frame, which duplicates the
first.

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

### Licences — `assets/licenses/`

Nine `.txt` files, one per pack, copied verbatim from the source archives.

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

## The three staffs, and how they are attached

The Mage `.glb` already contains `2H_Staff`, `1H_Wand`, `Spellbook` and
`Spellbook_open` as accessory meshes parented to the `handslot.r` / `handslot.l`
bones, all using the same `mage_texture` material as the body. So:

| Staff | Mesh | Why |
|---|---|---|
| Ember | `2H_Staff` | Big gnarled staff, the heaviest silhouette |
| Storm | `1H_Wand` | Short and quick, matches the fastest projectile |
| Frost | `Spellbook_open` | A frozen grimoire. See the open issue below. |

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
