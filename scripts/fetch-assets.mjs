/**
 * Downloads the CC0 source packs and copies the files we ship into `assets/`.
 *
 * Idempotent: every download lands in the git-ignored cache under
 * `node_modules/.asset-cache/`, and a cached file is reused rather than
 * re-fetched. Delete the cache to force a refresh.
 *
 * Two transforms happen on the way in, and they are the reason this is a
 * script rather than a list of curl lines:
 *
 *   1. The KayKit character `.glb` files carry 76 to 95 animations each, which
 *      is 80 percent of their bytes. We keep four at most, so `trimGlb` drops
 *      the rest and garbage-collects the accessors and buffer views that go
 *      with them. A 3.5 MB Mage becomes ~0.4 MB with no loss of what we use.
 *   2. Quaternius ships `.gltf` with a base64 buffer, and KayKit props ship
 *      `.gltf` + `.bin` + a shared `.png`. Both become self-contained `.glb`
 *      so the runtime fetches one file per model and the single-file build has
 *      one thing to base64.
 *
 *   node scripts/fetch-assets.mjs
 *
 * Sources and licences are recorded in docs/ASSETS.md.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

import { gltfToGlb, readGlb, trimGlb } from './glb.mjs';

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
const QUATERNIUS_DEMON = '1XhBLnR6tjqIrFy0AUfRlqKf-hYmVwIR4';
const QUATERNIUS_LICENSE = '16GqsDGESyEOfRbc4dS7EqAwkIUSIW4_y';

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
};

/** Halloween Bits props: dead trees, graves and fence posts line the road. */
const PROPS = [
  'tree_dead_large',
  'tree_dead_medium',
  'tree_dead_small',
  'tree_pine_orange_large',
  'tree_pine_orange_medium',
  'gravestone',
  'grave_A',
  'pillar',
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
const DUNGEON_PIECES = ['column', 'barrier_half', 'pillar', 'banner_blue', 'torch_lit'];

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

async function character(name, base, file, cacheName) {
  const source = await cached(`${base}/Characters/gltf/${file}`, cacheName);
  const trimmed = trimGlb(readGlb(source), KEPT_ANIMATIONS[name]);
  return await writeAsset(`models/${name}.glb`, trimmed);
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
        context.drawImage(await load(job.color), 0, 0, job.size, job.size);
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

async function boss() {
  const doc = JSON.parse(
    (await cached(`${DRIVE}${QUATERNIUS_DEMON}`, 'quaternius/Demon.gltf')).toString('utf8'),
  );
  const glb = await gltfToGlb(doc, () => {
    throw new Error('Demon.gltf was expected to be self-contained');
  });
  const trimmed = trimGlb(readGlb(glb), KEPT_ANIMATIONS.boss_demon);
  return await writeAsset('models/boss_demon.glb', trimmed);
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

async function main() {
  console.log('[assets] cache:', path.relative(ROOT, CACHE));
  let total = 0;

  console.log('[assets] KayKit characters (animations trimmed)');
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
  );

  console.log('[assets] Quaternius boss');
  total += await boss();

  console.log('[assets] KayKit Halloween Bits props');
  total += await props();

  console.log('[assets] KayKit Dungeon Remastered pieces');
  total += await dungeon();

  console.log('[assets] ambientCG road and field albedos');
  total += await ambientcg();

  console.log('[assets] licences');
  total += await licenses();
  total += await kenney();

  console.log(`[assets] wrote ${kb(total)} into assets/ (audio is added by audio-convert.mjs)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`[assets] FAIL — ${error.message}`);
    process.exitCode = 1;
  });
}
