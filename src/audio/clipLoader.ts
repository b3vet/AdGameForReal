/**
 * One clip from `src/data/assets.json`, turned into a playable `StaticSound`.
 *
 * Split from `GameAudio.ts`, which decides when a sound may be heard; this
 * file only decides how its bytes arrive and how a failure reads in a log.
 */

import { CreateSoundAsync } from '@babylonjs/core/AudioV2';
import type { AudioEngineV2, StaticSound } from '@babylonjs/core/AudioV2';

import { audioMix } from '@/data';
import { assetBytes, resolveAssetUrl } from '@/render/characters';
import type { AudioAsset } from '@/render/characters';

/**
 * Fetches and decodes one clip.
 *
 * Babylon is handed the bytes, never the URL. Given a URL it fetches the file
 * itself and refuses anything but an HTTP success, and in the iOS app a sound
 * comes back with status 0 (`fetchBytes` in `src/render/characters/manifest.ts`
 * says why) — so every clip failed there while the web build was fine.
 * `assetBytes` also reads the single-file builds' data URIs, so both builds now
 * take the same road.
 */
export async function loadClip(engine: AudioEngineV2, asset: AudioAsset): Promise<StaticSound> {
  const bytes = await assetBytes(resolveAssetUrl(asset.id));
  return CreateSoundAsync(
    asset.id,
    bytes,
    {
      volume: audioMix.volume[asset.id] ?? 0.5,
      maxInstances: audioMix.maxInstances[asset.id] ?? audioMix.defaultMaxInstances,
    },
    engine,
  );
}

/**
 * An error as one readable line.
 *
 * Handing the error object to `console.warn` reads well in a desktop console
 * and not at all from the phone: Capacitor's console bridge serialises its
 * arguments, an `Error` or a `DOMException` has no enumerable fields of its
 * own, and Xcode prints `{}`. That `{}` was all the first iOS report of silent
 * sounds had to go on.
 */
export function describeError(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const { name, message } = error as { name?: unknown; message?: unknown };
    if (typeof message === 'string') {
      return typeof name === 'string' && name !== '' ? `${name}: ${message}` : message;
    }
  }
  return String(error);
}
