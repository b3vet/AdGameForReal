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
