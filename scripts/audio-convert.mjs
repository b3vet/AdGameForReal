/**
 * Turns the Kenney source clips into the seventeen sounds the game plays.
 *
 * Kenney's current downloads are Ogg Vorbis only — the WAVs the older packs
 * shipped are gone — and Safari on iOS cannot play Ogg, so every clip has to be
 * re-encoded. There is no encoder in this repo and none may be added, so the
 * decode is done by the one Vorbis decoder we already have: Chromium, driven by
 * Playwright (already a devDependency for the smoke test). It hands back mono
 * PCM at 22050 Hz, because `decodeAudioData` resamples to the context's rate
 * for free; Node does the trimming, the fades, the peak normalise and the WAV
 * header, so the DSP stays readable and testable here rather than in a string.
 *
 *   node scripts/audio-convert.mjs
 *
 * Writes `assets/audio/*.wav` and prints every size. Source packs come from the
 * cache `fetch-assets.mjs` fills; run that first.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

import { findZipEntry } from './fetch-assets.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'node_modules', '.asset-cache', 'kenney');
const OUT = path.join(ROOT, 'assets', 'audio');

const SAMPLE_RATE = 22050;

/** Below this the clip counts as silence for trimming. About -52 dBFS. */
const SILENCE = 0.0025;
/** Kept either side of the trimmed span so nothing is clipped off an attack. */
const GUARD_MS = 8;
const FADE_IN_MS = 2;
const FADE_OUT_MS = 12;
/** Peak target, just under full scale, so the mixer sees consistent levels. */
const PEAK = 0.89;
/** Nothing in this set is music; anything longer is a mistake in the picks. */
const MAX_SECONDS = 3;

/**
 * The seventeen events, and the Kenney clip each one is cut from. Three shot
 * variants so the staffs read apart; everything else is one clip. Paths are
 * entries inside `<pack>.zip` in the asset cache.
 */
const SOUNDS = [
  { id: 'shot_ember', pack: 'sci-fi-sounds', entry: 'Audio/laserLarge_002.ogg' },
  { id: 'shot_storm', pack: 'sci-fi-sounds', entry: 'Audio/laserSmall_001.ogg' },
  { id: 'shot_frost', pack: 'sci-fi-sounds', entry: 'Audio/laserRetro_003.ogg' },
  { id: 'enemy_hit', pack: 'impact-sounds', entry: 'Audio/impactGeneric_light_001.ogg' },
  { id: 'block_kill', pack: 'impact-sounds', entry: 'Audio/impactPunch_heavy_001.ogg' },
  { id: 'shatter', pack: 'impact-sounds', entry: 'Audio/impactGlass_heavy_003.ogg' },
  { id: 'gate_tick', pack: 'ui-audio', entry: 'Audio/click3.ogg' },
  { id: 'gate_pass_good', pack: 'rpg-audio', entry: 'Audio/metalLatch.ogg' },
  { id: 'gate_pass_bad', pack: 'sci-fi-sounds', entry: 'Audio/forceField_002.ogg' },
  { id: 'units_gained', pack: 'rpg-audio', entry: 'Audio/handleCoins.ogg' },
  { id: 'units_lost', pack: 'impact-sounds', entry: 'Audio/impactSoft_medium_002.ogg' },
  { id: 'boss_stomp', pack: 'sci-fi-sounds', entry: 'Audio/lowFrequency_explosion_000.ogg' },
  { id: 'boss_hit', pack: 'impact-sounds', entry: 'Audio/impactMetal_heavy_002.ogg' },
  { id: 'boss_death', pack: 'sci-fi-sounds', entry: 'Audio/explosionCrunch_004.ogg' },
  { id: 'win_fanfare', pack: 'music-jingles', entry: 'Audio/Steel jingles/jingles_STEEL00.ogg' },
  { id: 'lose_sting', pack: 'music-jingles', entry: 'Audio/Hit jingles/jingles_HIT09.ogg' },
  { id: 'ui_tap', pack: 'ui-audio', entry: 'Audio/click1.ogg' },
];

const CHROMIUM_FALLBACKS = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
];

function resolveChromiumPath() {
  try {
    const fromPlaywright = chromium.executablePath();
    if (existsSync(fromPlaywright)) return fromPlaywright;
  } catch {
    // Fall through to the preinstalled browser.
  }
  const fallback = CHROMIUM_FALLBACKS.find((candidate) => existsSync(candidate));
  if (fallback === undefined) throw new Error('Chromium not found for the Vorbis decode');
  return fallback;
}

/** Reads one member out of a cached pack zip. */
async function sourceClip(pack, entry) {
  const zip = await readFile(path.join(CACHE, `${pack}.zip`));
  const escaped = entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const bytes = findZipEntry(zip, new RegExp(`^${escaped}$`));
  if (bytes === null) throw new Error(`${entry} is not in ${pack}.zip`);
  return bytes;
}

/**
 * Decodes one Ogg to mono `Float32Array` at `SAMPLE_RATE`. Runs in the page:
 * `decodeAudioData` resamples to the context's rate, so the resampler is the
 * browser's rather than one written here.
 */
async function decodeInBrowser(page, base64) {
  const decoded = await page.evaluate(async (data) => {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    // `globalThis.` because this callback is stringified into the page: the
    // lint config sees this file as Node, where the constructor does not exist.
    const context = new globalThis.OfflineAudioContext(1, 1, 22050);
    const buffer = await context.decodeAudioData(bytes.buffer);

    const mono = new Float32Array(buffer.length);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const source = buffer.getChannelData(channel);
      for (let i = 0; i < mono.length; i++) mono[i] += source[i] / buffer.numberOfChannels;
    }
    return { sampleRate: buffer.sampleRate, samples: Array.from(mono) };
  }, base64);

  if (decoded.sampleRate !== SAMPLE_RATE) {
    throw new Error(`decoded at ${String(decoded.sampleRate)} Hz, expected ${String(SAMPLE_RATE)}`);
  }
  return Float32Array.from(decoded.samples);
}

/** Trims silence, caps the length, fades the edges and normalises the peak. */
function shape(samples) {
  const guard = Math.round((GUARD_MS / 1000) * SAMPLE_RATE);
  let first = 0;
  while (first < samples.length && Math.abs(samples[first]) < SILENCE) first++;
  let last = samples.length - 1;
  while (last > first && Math.abs(samples[last]) < SILENCE) last--;
  if (first > last) return new Float32Array(0);

  const start = Math.max(0, first - guard);
  const end = Math.min(samples.length, last + guard + 1);
  const limit = Math.round(MAX_SECONDS * SAMPLE_RATE);
  const clip = samples.slice(start, Math.min(end, start + limit));

  let peak = 0;
  for (const value of clip) peak = Math.max(peak, Math.abs(value));
  const gain = peak > 0.02 ? PEAK / peak : 1;

  const fadeIn = Math.round((FADE_IN_MS / 1000) * SAMPLE_RATE);
  const fadeOut = Math.round((FADE_OUT_MS / 1000) * SAMPLE_RATE);
  for (let i = 0; i < clip.length; i++) {
    let envelope = gain;
    if (i < fadeIn) envelope *= i / fadeIn;
    const tail = clip.length - 1 - i;
    if (tail < fadeOut) envelope *= tail / fadeOut;
    clip[i] *= envelope;
  }
  return clip;
}

/** 16-bit mono PCM WAV. The 44-byte canonical header, then the samples. */
function toWav(samples) {
  const header = Buffer.alloc(44);
  const dataBytes = samples.length * 2;
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataBytes, 40);

  const body = Buffer.alloc(dataBytes);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    body.writeInt16LE(Math.round(clamped * 32767), i * 2);
  }
  return Buffer.concat([header, body]);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const executablePath = resolveChromiumPath();
  console.log(`[audio] decoding with ${executablePath}`);

  const browser = await chromium.launch({ executablePath });
  const page = await browser.newPage();
  await page.setContent('<!doctype html><title>decode</title>');

  let total = 0;
  try {
    for (const sound of SOUNDS) {
      const ogg = await sourceClip(sound.pack, sound.entry);
      const decoded = await decodeInBrowser(page, ogg.toString('base64'));
      const shaped = shape(decoded);
      if (shaped.length === 0) throw new Error(`${sound.id} decoded to silence`);

      const wav = toWav(shaped);
      await writeFile(path.join(OUT, `${sound.id}.wav`), wav);
      total += wav.length;
      const seconds = (shaped.length / SAMPLE_RATE).toFixed(2);
      console.log(
        `  ${sound.id.padEnd(16)} ${seconds}s  ${(wav.length / 1024).toFixed(0).padStart(4)} KB` +
          `   <- ${sound.pack}/${path.basename(sound.entry)}`,
      );
    }
  } finally {
    await browser.close();
  }

  console.log(
    `[audio] ${String(SOUNDS.length)} clips, ${(total / 1024).toFixed(0)} KB total in assets/audio/`,
  );
  if (total > 1.5 * 1024 * 1024) throw new Error('audio is over the 1.5 MB budget');
}

main().catch((error) => {
  console.error(`[audio] FAIL — ${error.message}`);
  process.exitCode = 1;
});
