/**
 * Typed access to `src/data/assets.json`.
 *
 * Every asset URL in the app comes from here. Nothing else builds a path,
 * because the single-file builds (decision D22) rewrite the manifest's `url`
 * fields into `data:` URIs at build time — a hand-written `/assets/...` string
 * would survive that rewrite and fetch nothing on a host that blocks fetches.
 *
 * How the inlining works, for whoever writes that build step: read
 * `src/data/assets.json`, replace each entry's `url` (and a VAT entry's
 * `metaUrl`) with `data:<mime>;base64,<file>`, set `basePath` to the empty
 * string, and hand the rewritten JSON to the bundle. `resolveAssetUrl` already
 * passes an absolute URI through untouched, so no runtime code changes.
 */

import manifestJson from '@/data/assets.json';
import type {
  AssetEntry,
  AssetManifest,
  AudioAsset,
  ModelAsset,
  VatAsset,
} from '@/data/assets-types';

export type {
  AssetEntry,
  AssetKind,
  AssetManifest,
  AudioAsset,
  ModelAsset,
  TextureAsset,
  VatAsset,
  VatMeta,
  VatRangeMeta,
} from '@/data/assets-types';

export const assetManifest: AssetManifest = manifestJson as AssetManifest;

const byId = new Map<string, AssetEntry>(assetManifest.entries.map((entry) => [entry.id, entry]));

export function assetEntry(id: string): AssetEntry {
  const entry = byId.get(id);
  if (entry === undefined) throw new Error(`assets.json has no entry "${id}"`);
  return entry;
}

/** Narrowing lookups, so callers do not repeat the `kind` check. */
export function modelAsset(id: string): ModelAsset {
  return expect(assetEntry(id), 'model') as ModelAsset;
}

export function vatAsset(id: string): VatAsset {
  return expect(assetEntry(id), 'vat') as VatAsset;
}

export function audioAsset(id: string): AudioAsset {
  return expect(assetEntry(id), 'audio') as AudioAsset;
}

function expect(entry: AssetEntry, kind: AssetEntry['kind']): AssetEntry {
  if (entry.kind !== kind) {
    throw new Error(`asset "${entry.id}" is a ${entry.kind}, not a ${kind}`);
  }
  return entry;
}

/** Every audio entry, for the audio engine to preload in one pass. */
export function audioAssets(): readonly AudioAsset[] {
  return assetManifest.entries.filter((entry): entry is AudioAsset => entry.kind === 'audio');
}

/**
 * The URL to fetch for `id`. Absolute URIs — which is what the inlined builds
 * leave behind — are returned as they are; everything else is joined onto
 * `basePath`.
 */
export function resolveAssetUrl(id: string): string {
  return resolveUrl(assetEntry(id).url);
}

/** Same rule, for the second URL a VAT entry carries. */
export function resolveVatMetaUrl(id: string): string {
  return resolveUrl(vatAsset(id).metaUrl);
}

function resolveUrl(url: string): string {
  if (/^(data:|blob:|https?:|\/\/)/.test(url)) return url;
  return `${assetManifest.basePath}${url}`;
}

/**
 * The bytes behind an asset URL.
 *
 * A `data:` URI is decoded here rather than handed to `fetch`. Both work in a
 * browser, but the single-file builds exist because the page host blocks
 * requests, and a request for a `data:` URI is still a request as far as a
 * strict host — or a Playwright route that aborts everything — is concerned.
 */
export async function assetBytes(url: string): Promise<ArrayBuffer> {
  const base64 = base64Payload(url);
  if (base64 === null) {
    const response = await fetch(url);
    return response.arrayBuffer();
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** The same rule for a JSON asset: decode a data URI, fetch anything else. */
export async function assetJson<T>(url: string): Promise<T> {
  const base64 = base64Payload(url);
  if (base64 === null) {
    const response = await fetch(url);
    return (await response.json()) as T;
  }
  return JSON.parse(atob(base64)) as T;
}

/** The base64 payload of a `data:...;base64,` URI, or null for anything else. */
function base64Payload(url: string): string | null {
  if (!url.startsWith('data:')) return null;
  const comma = url.indexOf(',');
  if (comma < 0 || !url.slice(0, comma).endsWith(';base64')) return null;
  return url.slice(comma + 1);
}
