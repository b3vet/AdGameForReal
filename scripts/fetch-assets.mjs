/**
 * Downloads the CC0 source packs and copies the files we ship into `assets/`.
 *
 * Idempotent: every download lands in the git-ignored cache under
 * `node_modules/.asset-cache/`, and a cached file is reused rather than
 * re-fetched. Delete the cache to force a refresh.
 *
 * Three transforms happen on the way in, and they are the reason this is a
 * script rather than a list of curl lines:
 *
 *   1. The KayKit character `.glb` files carry 76 to 95 animations each, and
 *      the Quaternius monsters fourteen, which is most of their bytes. We keep
 *      six at most, so `trimGlb` drops the rest and garbage-collects the
 *      accessors and buffer views that go with them. A 3.5 MB Mage becomes
 *      ~0.5 MB with no loss of what we use.
 *   2. Quaternius ships `.gltf` with a base64 buffer, and KayKit props ship
 *      `.gltf` + `.bin` + a shared `.png`. Both become self-contained `.glb`
 *      so the runtime fetches one file per model and the single-file build has
 *      one thing to base64.
 *   3. KayKit keeps weapons and shields out of its character files, so the
 *      skeleton warrior's shield is grafted into its rig here (`SHIELD` and
 *      `graftAccessory`) — the renderer only knows how to merge an accessory
 *      that is already parented to a bone (D23).
 *
 *   node scripts/fetch-assets.mjs            every step
 *   node scripts/fetch-assets.mjs textures   one of them, by name
 *
 * The step names are the keys of `STEPS` at the bottom. Re-running one step is
 * what a re-encode is: the road albedo's colour grade (`tint` below) was tuned
 * by running `textures` against the cached zips and looking at the frames.
 *
 * Sources and licences are recorded in docs/ASSETS.md.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

import { gltfToGlb, graftAccessory, readGlb, trimGlb } from './glb.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'node_modules', '.asset-cache');
const ASSETS = path.join(ROOT, 'assets');

/** jsDelivr mirrors the KayKit GitHub org; github.com itself is unreachable here. */
const KAYKIT = 'https://cdn.jsdelivr.net/gh/KayKit-Game-Assets';
const ADVENTURERS = `${KAYKIT}/KayKit-Character-Pack-Adventures-1.0@main/addons/kaykit_character_pack_adventures`;
const SKELETONS = `${KAYKIT}/KayKit-Character-Pack-Skeletons-1.0@main/addons/kaykit_character_pack_skeletons`;
const HALLOWEEN = `${KAYKIT}/KayKit-Halloween-Bits-1.0@main/addons/kaykit_halloween_bits/Assets`;
const DUNGEON = `${KAYKIT}/KayKit-Dungeon-Remastered-1.0@main/addons/kaykit_dungeon_remastered/Assets`;

/** ambientCG serves its zips through a redirect to its own CDN; `fetch` follows it. */
const AMBIENTCG = 'https://ambientcg.com/get?file=';

/** Quaternius publishes through Google Drive; these are file ids in that folder. */
const DRIVE = 'https://drive.google.com/uc?export=download&id=';
const QUATERNIUS_LICENSE = '16GqsDGESyEOfRbc4dS7EqAwkIUSIW4_y';

/**
 * The Ultimate Monsters we ship, as `<game id>: <Drive file id>`.
 *
 * The ids are files inside `Big/glTF/` of the pack's shared folder. They were
 * read off `https://drive.google.com/embeddedfolderview?id=<folder>#list`,
 * which serves a plain list where the ordinary folder page is script-rendered:
 * the pack folder is `18m4KpzpEzhC9wl7jzr6dUc0N8Jozr79C` (linked from
 * `quaternius.com/packs/ultimatemonsters.html`) and `Big/glTF` inside it is
 * `1sOXLt5U3ofaujPlQRL11s4ub2UsqN8V8`. Every monster in that folder shares one
 * 43-bone rig and the same fourteen clips, so a swap is one line here and one
 * `url` in `assets.json` (docs/ASSETS.md, "The boss").
 *
 *   boss_demon  the biome-1 boss
 *   charger     Milestone 7's charger (D49): a runner, so the Dino
 *   boss_rime   the Rime Fiend (D49), the heaviest cold silhouette in the pack
 */
const QUATERNIUS_MONSTERS = {
  boss_demon: '1XhBLnR6tjqIrFy0AUfRlqKf-hYmVwIR4',
  charger: '1xBAObQmJQP1kCslielMmS_KMfPZUsdNm',
  boss_rime: '1_skNq11VXoaGPu9D-hHb4-0OQXEWNTzY',
};

/**
 * The animations we keep per character. Everything else is dropped at fetch
 * time, so `bake-vat.mjs` and the dev pages see a small file with exactly the
 * ranges the game plays. Names are KayKit's / Quaternius's own.
 */
export const KEPT_ANIMATIONS = {
  // `Spellcast_Raise` and `Running_C` are Milestone 3's animation variety
  // (docs/09-milestone-3-plan.md, "more animation"): the squad alternates two
  // cast clips so a firing crowd is not one silhouette repeated, and the
  // skeleton streams mix a walk with a run so a river of bodies has a gait
  // spread through it. Each one costs about 30 rows of its rig's baked texture.
  mage: ['Idle', 'Running_A', 'Spellcast_Shoot', 'Spellcast_Raise', 'Cheer'],
  skeleton_minion: ['Walking_D_Skeletons', 'Running_C', 'Death_C_Skeletons'],
  skeleton_warrior: ['Walking_C', 'Running_C', 'Death_A'],
  boss_demon: ['Idle', 'Walk', 'Punch', 'HitReact', 'Death'],
  // The charger (D49) only ever does three things: it appears, it runs its
  // lane, and it dies. `Idle` comes along for the frame before it is released
  // and for a stand-in pose; `Punch` is the lunge it kills a column with.
  charger: ['Idle', 'Run', 'Punch', 'Death'],
  // The Rime Fiend is a boss, so it keeps the demon's five and adds `Run` —
  // the lane charge of D49, which is the one thing boss 1 cannot do.
  boss_rime: ['Idle', 'Walk', 'Run', 'Punch', 'HitReact', 'Death'],
};

/**
 * The shielded brute's shield (D49), grafted into the skeleton warrior.
 *
 * KayKit keeps weapons and shields out of the character files and in
 * `Assets/gltf/`, so this one accessory has to be put into the shape the
 * renderer already understands — a mesh parented to a hand bone (D23). The
 * grip is the Adventurers pack's own: `Knight.glb` hangs all four of its
 * shields off `handslot.l` at exactly this offset, and the loose
 * `shield_round.gltf` has byte-identical geometry to the one in that file, so
 * the offset is the rig's, not the knight's.
 */
const SHIELD = {
  file: 'Skeleton_Shield_Large_A',
  parent: 'handslot.l',
  material: 'skeleton',
  transform: { translation: [0, 0.017011786, 0.155885339] },
};

/**
 * Halloween Bits props: the conifers, the gravestone, the fence and the lantern.
 *
 * Five of the pack's pieces that Milestone 2 shipped are gone as of Milestone 7
 * — `tree_dead_large/medium/small`, `grave_A` and `pillar`. No view has placed
 * one since Milestone 3 re-weighted the roadside around the pines
 * (`src/render/propKinds.ts`), and an unplaced model is not free: every entry in
 * `assets.json` is base64'd into the single-file builds whether anything draws
 * it or not, and those five were 128 KB of file — 171 KB of the 12 MB hosted
 * ceiling (D25). Adding one back is a line here and an entry in the manifest.
 */
const PROPS = [
  'tree_pine_orange_large',
  'tree_pine_orange_medium',
  'gravestone',
  'post_lantern',
  'fence',
];

/**
 * KayKit Dungeon Remastered pieces (Milestone 5, decision D39): the gate arches,
 * the lane walls and the boss arena are built from these five.
 *
 * The pack ships each piece as `<name>.gltf.glb` — already a self-contained GLB
 * with the shared `dungeon_texture` atlas embedded — so unlike the Halloween
 * props there is nothing to fold together here and the bytes are copied through.
 * About 15 KB of every file is that atlas, repeated; five pieces is 75 KB of
 * duplication, which is cheaper than the second material a shared texture file
 * would cost at runtime.
 *
 * Only the pieces we actually place are kept (the pack has 203):
 *   column        — the arch legs, and the post between two wall runs
 *   barrier_half  — a 2 m stone parapet: the arch lintel, and the wall run
 *   pillar        — the boss arena's corner markers
 *   banner_blue   — hangs on those pillars, re-tinted to `arcane` in render
 *   torch_lit     — roadside light beside the gate rows of later levels
 */
const DUNGEON_PIECES = [
  'column',
  'barrier_half',
  'pillar',
  'banner_blue',
  'torch_lit',
  // Milestone 7: Frostfell's snow mounds. A heap of broken stone under a
  // near-white tint is a drift with something buried in it, and the pack has
  // no snow of its own — this is the cheapest real mesh that reads as one.
  'rubble_large',
  'rubble_half',
];

/**
 * The road and field albedos (Milestone 5 plan, "Road texture bad"), from
 * ambientCG — CC0, photogrammetry, and the one place a hand-painted tile cannot
 * compete: real medieval paving with moss in the joints.
 *
 * Both are downsized and re-encoded here rather than shipped as downloaded. The
 * 1K JPEGs in those zips are 1.8 and 2.0 MB, which the single-file builds (12 MB
 * hosted, decision D25) cannot afford; at the sizes below the pair is under
 * 320 KB and still oversampled for a road tile 2.4 m across on a phone.
 *
 * `ao` multiplies the pack's ambient-occlusion map into the albedo, which is
 * what puts the shadow in the joints — the road material is unlit stone with a
 * toon ramp over it, so there is no light in the scene that would do it.
 */
const AMBIENTCG_TEXTURES = [
  {
    file: 'road_cobble.jpg',
    asset: 'PavingStones131',
    size: 1024,
    quality: 0.75,
    ao: true,
    /**
     * The colour grade, as a canvas filter on the albedo before the occlusion
     * is multiplied in (Milestone 5 Phase E).
     *
     * PavingStones131 is photographed with moss in its joints and averages
     * hue 53 at saturation 0.13 — a yellow-green that reads as olive once the
     * whole road is covered in it, which is what the Phase C frame review
     * called out. The palette's own stone is hue 37: warm grey-brown. Fourteen
     * degrees of rotation with a quarter of the saturation taken out lands the
     * mean at hue 40 and 0.11, which reads as weathered granite, and because it
     * is a *filter on the source pixels* rather than a tint on the material the
     * stones keep every bit of their photographic variation — a material tint
     * would have multiplied the joints and the highlights by the same number.
     *
     * Ten degrees was tried first and measured hue 43.5: still olive in a
     * frame, because the road material multiplies the albedo by `stone.light`
     * and the key light is warm, both of which push it back the other way.
     */
    tint: 'saturate(0.72) hue-rotate(-14deg)',
    use: 'the road surface',
  },
  {
    file: 'field_grass.jpg',
    asset: 'Grass004',
    size: 512,
    quality: 0.72,
    ao: false,
    use: 'the field either side and the grass fringe along the kerbs',
  },
  /**
   * Frostfell (D49). The pair does the same two jobs one biome over, and the
   * choice between them is the same one the meadow made: the road has to be the
   * surface with structure in it and the verge the large quiet mass, or the
   * kerb line disappears and the road stops being a road.
   *
   * `Ice004` is a frozen lake photographed from above — cells of dark ice with
   * white fracture veins between them, which is the same *shape* of information
   * the paving's joints carry and the reason it beats every "Snow" material for
   * this job (they are all near-featureless at a 2 m tile; `Snow005` averages
   * rgb 147,148,149 with almost no local variation). It is the one texture here
   * with no `AmbientOcclusion.jpg` in its zip, so unlike the cobble nothing is
   * multiplied into it: the veins are already the shading, and the road mesh's
   * own vertex colours still carry the gutter and the lane wear.
   *
   * `Snow006` is trodden snow and *does* ship an occlusion map, so the verge is
   * the composite this time — the dimples of a walked-on drift, which is what
   * keeps a white field from reading as a blank sheet of paper.
   */
  {
    file: 'road_frost.jpg',
    asset: 'Ice004',
    size: 1024,
    // 0.68 where the cobble is 0.75: ice is a smooth field with a few hard
    // veins in it, which is the easiest thing a DCT ever has to encode, and the
    // single-file builds are 130 KB under their 12 MB ceiling (D25).
    quality: 0.68,
    ao: false,
    /**
     * The grade, in the order it is read: tame the range, lift it, cool it.
     *
     * The source averages rgb 125,141,140 — a dark sea-green, which is what
     * lake ice actually looks like and what a whole road of it must not be: at
     * that value the road is darker than the crowd standing on it and the
     * frame loses its floor. The desaturation takes the green out and the small
     * positive rotation lands the residue on the blue side of neutral, so it
     * sits beside `spell.frost` rather than fighting it.
     *
     * `contrast` is Milestone 7 Phase E's correction and the reason the pair of
     * numbers moved. `brightness(1.45)` alone measured mean 190 with a standard
     * deviation of 49 and *21 percent of the tile clipped to white* — the
     * fracture veins blew out and the cells went slate, so the road read busier
     * and darker than the meadow's cobble (mean 137, deviation 29) and pulled
     * the eye off the crowd and the plaques standing on it. A road is the
     * frame's floor, not its subject. Compressing the range about its middle
     * first and lifting the result keeps the mean and lands the cobble's own
     * deviation: 183, deviation 30, 6 percent clipped. The veins still read as
     * joints at the far end of the road; they have stopped being the brightest
     * thing in the frame.
     *
     * Derived rather than dialled. The grade is affine in the source, so
     * `contrast` c and `brightness` b give slope `b*c` and offset
     * `b*127.5*(1-c)`; solving those for the cobble's deviation at this tile's
     * own mean is where 0.49 and 1.39 come from. `scripts/` has no image
     * dependency to check it with, so the check is the tile itself — 1024 px of
     * it in `assets/textures/` — and the numbers above were measured off it.
     */
    tint: 'contrast(0.49) brightness(1.39) saturate(0.5) hue-rotate(14deg)',
    use: 'the Frostfell road surface',
  },
  {
    file: 'field_snow.jpg',
    asset: 'Snow006',
    size: 512,
    quality: 0.72,
    ao: true,
    use: 'the Frostfell verge and the snow fringe along the kerbs',
  },
];

/**
 * What `assets/licenses/ambientcg.txt` records. ambientCG's zips carry no
 * licence file — the statement is on the site, so it is quoted here with the
 * page it came from, exactly as the Quaternius note in docs/ASSETS.md does.
 */
const AMBIENTCG_LICENSE = `ambientCG (ambientcg.com) — licence record
Copied from https://ambientcg.com/license on 2026-09-13:

  "All ambientCG assets are provided under the Creative Commons CC0 1.0
   Universal License. This applies to the downloadable asset files and the
   material preview renders shown for each asset on the site."

  "You don't need to give credit but I would of course appreciate it, if you
   did it anyways. You can do so using this text:
   Created using <asset name> from ambientCG.com, licensed under the Creative
   Commons CC0 1.0 Universal License."

Assets used here, downloaded as <id>_1K-JPG.zip through https://ambientcg.com/get:
`;

const KENNEY_PACKS = [
  'impact-sounds',
  'rpg-audio',
  'ui-audio',
  'sci-fi-sounds',
  'music-jingles',
];

// --- tiny http + cache ------------------------------------------------------

async function exists(file) {
  try {
    const info = await stat(file);
    return info.size > 0;
  } catch {
    return false;
  }
}

/** Fetches `url` into the cache once. Returns the cached file's contents. */
async function cached(url, name) {
  const file = path.join(CACHE, name);
  if (await exists(file)) return await readFile(file);

  await mkdir(path.dirname(file), { recursive: true });
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { redirect: 'follow' });
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length === 0) throw new Error('empty body');
      await writeFile(file, body);
      console.log(`  fetched ${name} (${kb(body.length)})`);
      return body;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`${url}: ${String(lastError)}`);
}

const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;


// --- the manifest of what we ship ------------------------------------------

async function writeAsset(relative, bytes) {
  const file = path.join(ASSETS, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
  const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
  console.log(`  assets/${relative} — ${kb(bytes.length)} (${digest})`);
  return bytes.length;
}

async function character(name, base, file, cacheName, graft) {
  const source = await cached(`${base}/Characters/gltf/${file}`, cacheName);
  let glb = trimGlb(readGlb(source), KEPT_ANIMATIONS[name]);
  if (graft !== undefined) glb = await graft(glb);
  return await writeAsset(`models/${name}.glb`, glb);
}

async function props() {
  const texture = await cached(
    `${HALLOWEEN}/gltf/halloweenbits_texture.png`,
    'kaykit/halloweenbits_texture.png',
  );
  let total = 0;
  for (const name of PROPS) {
    const doc = JSON.parse(
      (await cached(`${HALLOWEEN}/gltf/${name}.gltf`, `kaykit/props/${name}.gltf`)).toString('utf8'),
    );
    const glb = await gltfToGlb(doc, async (uri) => {
      if (uri.endsWith('.png')) return texture;
      return await cached(`${HALLOWEEN}/gltf/${uri}`, `kaykit/props/${uri}`);
    });
    total += await writeAsset(`props/${name}.glb`, glb);
  }
  return total;
}

/**
 * The dungeon pieces, copied through as they come. See `DUNGEON_PIECES` for why
 * there is no transform step here.
 */
async function dungeon() {
  let total = 0;
  for (const name of DUNGEON_PIECES) {
    const glb = await cached(`${DUNGEON}/gltf/${name}.gltf.glb`, `kaykit/dungeon/${name}.glb`);
    total += await writeAsset(`props/dungeon_${name}.glb`, glb);
  }
  return total;
}

/**
 * The ambientCG albedos: download the zip, pull the maps out of it, and let
 * Chromium do the compositing and the re-encode.
 *
 * A browser for an image resize looks heavy until you count the alternatives:
 * there is no JPEG decoder in Node and no image dependency may be added
 * (docs/ASSETS.md, "How to rebuild"), and Playwright is already a devDependency
 * with a pinned browser for the smoke test. The whole pass is one page and a few
 * seconds, and only when the cache is cold does it also cost the two downloads.
 */
async function ambientcg() {
  const maps = [];
  for (const texture of AMBIENTCG_TEXTURES) {
    const zip = await cached(
      `${AMBIENTCG}${texture.asset}_1K-JPG.zip`,
      `ambientcg/${texture.asset}_1K-JPG.zip`,
    );
    const color = findZipEntry(zip, /_Color\.jpg$/i);
    if (color === null) throw new Error(`no _Color.jpg in the ${texture.asset} zip`);
    const ao = texture.ao ? findZipEntry(zip, /_AmbientOcclusion\.jpg$/i) : null;
    maps.push({ texture, color, ao });
  }

  const encoded = await encodeTextures(maps);
  let total = 0;
  for (let i = 0; i < maps.length; i++) {
    const bytes = encoded[i];
    const entry = maps[i];
    if (bytes === undefined || entry === undefined) continue;
    total += await writeAsset(`textures/${entry.texture.file}`, bytes);
  }

  const record = `${AMBIENTCG_LICENSE}${AMBIENTCG_TEXTURES.map(
    (texture) =>
      `  ${texture.asset} — https://ambientcg.com/a/${texture.asset} — ${texture.use}\n`,
  ).join('')}`;
  total += await writeAsset('licenses/ambientcg.txt', Buffer.from(record, 'utf8'));
  return total;
}

/** Composites and re-encodes every texture in one Chromium page. */
async function encodeTextures(maps) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (error) {
    throw new Error(
      "the texture step needs Playwright's Chromium (npm i && npx playwright install chromium)",
      { cause: error },
    );
  }

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const jobs = maps.map((entry) => ({
      color: entry.color.toString('base64'),
      ao: entry.ao === null ? null : entry.ao.toString('base64'),
      size: entry.texture.size,
      quality: entry.texture.quality,
      tint: entry.texture.tint ?? null,
    }));
    const dataUris = await page.evaluate(async (list) => {
      const load = (base64) =>
        new Promise((resolve, reject) => {
          // `globalThis`, because this body runs in Chromium and the file is
          // linted as Node (the same convention as `scripts/smoke-run.mjs`).
          const image = new globalThis.Image();
          image.onload = () => {
            resolve(image);
          };
          image.onerror = () => {
            reject(new Error('could not decode a source map'));
          };
          image.src = `data:image/jpeg;base64,${base64}`;
        });

      const out = [];
      for (const job of list) {
        const canvas = globalThis.document.createElement('canvas');
        canvas.width = job.size;
        canvas.height = job.size;
        const context = canvas.getContext('2d');
        // The grade applies to the albedo only: filtering the occlusion pass
        // too would rotate the hue of the shadow it is multiplying in.
        if (job.tint !== null) context.filter = job.tint;
        context.drawImage(await load(job.color), 0, 0, job.size, job.size);
        context.filter = 'none';
        if (job.ao !== null) {
          // Multiply, so the occlusion darkens the joints without touching the
          // hue of the stone itself.
          context.globalCompositeOperation = 'multiply';
          context.drawImage(await load(job.ao), 0, 0, job.size, job.size);
          context.globalCompositeOperation = 'source-over';
        }
        out.push(canvas.toDataURL('image/jpeg', job.quality));
      }
      return out;
    }, jobs);
    return dataUris.map((uri) => Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64'));
  } finally {
    await browser.close();
  }
}

/**
 * One Quaternius monster: fetch, fold into a `.glb`, drop every clip we do not
 * play. Their `.gltf` is self-contained (a base64 buffer with the atlas inside
 * it), so `gltfToGlb` has nothing to resolve.
 */
async function monster(name, driveId) {
  const doc = JSON.parse(
    (await cached(`${DRIVE}${driveId}`, `quaternius/${name}.gltf`)).toString('utf8'),
  );
  const glb = await gltfToGlb(doc, () => {
    throw new Error(`${name}.gltf was expected to be self-contained`);
  });
  const trimmed = trimGlb(readGlb(glb), KEPT_ANIMATIONS[name]);
  return await writeAsset(`models/${name}.glb`, trimmed);
}

async function monsters() {
  let total = 0;
  for (const [name, driveId] of Object.entries(QUATERNIUS_MONSTERS)) {
    total += await monster(name, driveId);
  }
  return total;
}

/**
 * The skeleton warrior's shield, out of the pack's loose `Assets/gltf/` file
 * and into the warrior's rig under `handslot.l` (see `SHIELD`).
 */
async function graftShield(warrior) {
  const doc = JSON.parse(
    (await cached(`${SKELETONS}/Assets/gltf/${SHIELD.file}.gltf`, `kaykit/${SHIELD.file}.gltf`))
      .toString('utf8'),
  );
  const bin = await cached(
    `${SKELETONS}/Assets/gltf/${SHIELD.file}.bin`,
    `kaykit/${SHIELD.file}.bin`,
  );
  return graftAccessory(readGlb(warrior), { json: doc, bin }, {
    name: SHIELD.file,
    parent: SHIELD.parent,
    material: SHIELD.material,
    transform: SHIELD.transform,
  });
}

async function licenses() {
  const files = [
    ['kaykit-adventurers.txt', `${ADVENTURERS}/LICENSE.txt`, 'kaykit/adventurers-LICENSE.txt'],
    ['kaykit-skeletons.txt', `${SKELETONS}/LICENSE.txt`, 'kaykit/skeletons-LICENSE.txt'],
    ['kaykit-halloween-bits.txt', `${HALLOWEEN}/LICENSE.txt`, 'kaykit/halloween-LICENSE.txt'],
    ['kaykit-dungeon-remastered.txt', `${DUNGEON}/LICENSE.txt`, 'kaykit/dungeon-LICENSE.txt'],
    ['quaternius-ultimate-monsters.txt', `${DRIVE}${QUATERNIUS_LICENSE}`, 'quaternius/License.txt'],
  ];
  let total = 0;
  for (const [name, url, cacheName] of files) {
    total += await writeAsset(`licenses/${name}`, await cached(url, cacheName));
  }
  return total;
}

/**
 * Kenney's packs are ogg-only these days, so the zips stay in the cache and
 * `audio-convert.mjs` decodes the clips it needs out of them. Their licence
 * files come along here so `assets/licenses/` is complete without them.
 */
async function kenney() {
  let total = 0;
  for (const pack of KENNEY_PACKS) {
    const page = await (await fetch(`https://kenney.nl/assets/${pack}`)).text();
    const url = /https:\/\/kenney\.nl\/media\/pages\/assets\/[^'"]*\.zip/.exec(page)?.[0];
    if (url === undefined) throw new Error(`no zip link on kenney.nl/assets/${pack}`);
    const zip = await cached(url, `kenney/${pack}.zip`);
    total += await writeAsset(`licenses/kenney-${pack}.txt`, licenseFromZip(zip, pack));
  }
  return total;
}

/**
 * Pulls `License.txt` out of a zip without a dependency. Kenney's archives are
 * stored or deflated with no encryption, so the central directory plus one
 * `inflateRaw` is the whole reader.
 */
function licenseFromZip(zip, pack) {
  const entry = findZipEntry(zip, /license\.txt$/i);
  if (entry === null) throw new Error(`no License.txt in the ${pack} zip`);
  return entry;
}

export function findZipEntry(zip, pattern) {
  const end = zip.lastIndexOf(Buffer.from('PK', 'latin1'));
  if (end < 0) throw new Error('not a zip');
  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);

  for (let i = 0; i < count; i++) {
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    const localOffset = zip.readUInt32LE(offset + 42);
    if (pattern.test(name)) return readZipLocal(zip, localOffset);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

function readZipLocal(zip, offset) {
  const method = zip.readUInt16LE(offset + 8);
  const compressed = zip.readUInt32LE(offset + 18);
  const nameLength = zip.readUInt16LE(offset + 26);
  const extraLength = zip.readUInt16LE(offset + 28);
  const start = offset + 30 + nameLength + extraLength;
  const body = zip.subarray(start, start + compressed);
  if (method === 0) return Buffer.from(body);
  return inflateRawSync(body);
}

/** Every step this script can run, in order, by the name the CLI takes. */
const STEPS = {
  characters: [
    'KayKit characters (animations trimmed)',
    async () => {
      let total = 0;
      total += await character('mage', ADVENTURERS, 'Mage.glb', 'kaykit/Mage.glb');
      total += await character(
        'skeleton_minion',
        SKELETONS,
        'Skeleton_Minion.glb',
        'kaykit/Skeleton_Minion.glb',
      );
      total += await character(
        'skeleton_warrior',
        SKELETONS,
        'Skeleton_Warrior.glb',
        'kaykit/Skeleton_Warrior.glb',
        // The shielded brute is the same file with one accessory in its left
        // hand, so the shield rides along here rather than in a model of its
        // own: one `.glb`, one VAT and one material serve both (D49, D23).
        graftShield,
      );
      return total;
    },
  ],
  monsters: ['Quaternius monsters', monsters],
  props: ['KayKit Halloween Bits props', props],
  dungeon: ['KayKit Dungeon Remastered pieces', dungeon],
  textures: ['ambientCG road and field albedos', ambientcg],
  licenses: [
    'licences',
    async () => (await licenses()) + (await kenney()),
  ],
};

async function main() {
  const only = process.argv[2];
  if (only !== undefined && !(only in STEPS)) {
    throw new Error(`unknown step "${only}"; try one of ${Object.keys(STEPS).join(', ')}`);
  }
  console.log('[assets] cache:', path.relative(ROOT, CACHE));
  let total = 0;

  for (const [name, [label, step]] of Object.entries(STEPS)) {
    if (only !== undefined && only !== name) continue;
    console.log(`[assets] ${label}`);
    total += await step();
  }

  console.log(`[assets] wrote ${kb(total)} into assets/ (audio is added by audio-convert.mjs)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`[assets] FAIL — ${error.message}`);
    process.exitCode = 1;
  });
}
