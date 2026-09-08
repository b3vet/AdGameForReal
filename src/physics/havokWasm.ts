/**
 * Where the Havok WASM comes from.
 *
 * Two shapes, one module. Dev and production builds keep Vite's `?url` asset:
 * the browser fetches `HavokPhysics.wasm` next to the bundle. The single-file
 * builds replace this whole module with the same two exports, `havokWasmUrl`
 * empty and `havokWasmBase64` filled (`scripts/inline-assets.mjs`), because the
 * page host blocks every runtime fetch — the bytes have to be in the file.
 *
 * The module is replaced rather than a `define` substituted so that the `?url`
 * import below disappears from the inlined builds entirely; otherwise Vite
 * would emit the two megabytes a second time as a data URI nothing reads.
 */

import havokWasmAssetUrl from '@babylonjs/havok/lib/esm/HavokPhysics.wasm?url';

/** Where to fetch the WASM, or empty when it is carried as base64. */
export const havokWasmUrl: string = havokWasmAssetUrl;

/** The WASM itself, base64-encoded. Empty in every build that can fetch. */
export const havokWasmBase64: string = '';
