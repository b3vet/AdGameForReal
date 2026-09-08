/**
 * How the Havok module is handed its WASM.
 *
 * Two paths, decided by which build this is (see `./havokWasm.ts`):
 *
 *   - dev and production: `locateFile` points emscripten at the `.wasm` Vite
 *     emitted next to the bundle, and it fetches it.
 *   - the single-file builds: the bytes are already in the page as base64, so
 *     they are decoded here and passed as `wasmBinary`. Emscripten then never
 *     fetches anything, which is the whole point — the host blocks it.
 */

import { havokWasmBase64, havokWasmUrl } from './havokWasm';

/** The subset of emscripten's module overrides we ever set. */
export interface HavokLoaderOptions {
  locateFile: () => string;
  wasmBinary?: ArrayBuffer;
}

export function havokLoaderOptions(): HavokLoaderOptions {
  if (havokWasmBase64.length === 0) return { locateFile: () => havokWasmUrl };
  // `locateFile` is set even though the bytes are already here: without it
  // emscripten works the path out itself as `new URL(name, import.meta.url)`,
  // and the hosted build is an IIFE where `import.meta` is an empty object —
  // which threw "Invalid base URL" and dropped the game to no physics at all.
  // Nothing ever fetches this name; `wasmBinary` short-circuits the load.
  return { wasmBinary: decodeBase64(havokWasmBase64), locateFile: () => WASM_NAME };
}

/** The file emscripten would have fetched. Never actually requested. */
const WASM_NAME = 'HavokPhysics.wasm';

/**
 * Base64 to bytes without a fetch of a `data:` URI: two megabytes through
 * `fetch` would be a request, and a request is what this build cannot make.
 */
function decodeBase64(encoded: string): ArrayBuffer {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
