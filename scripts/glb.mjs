/**
 * glTF / GLB surgery, in plain Node.
 *
 * `fetch-assets.mjs` uses this to shrink and normalise what the packs ship:
 * a KayKit character `.glb` carries 76 to 95 animations, and props arrive as
 * `.gltf` + `.bin` + a shared `.png`. Both come out of here as one small,
 * self-contained `.glb`.
 *
 * Nothing here knows about the network or about our asset list; it is a pure
 * document transform, which is why it is a module of its own.
 */

// --- glTF / GLB surgery -----------------------------------------------------

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/** Splits a `.glb` into its JSON and binary chunks. */
export function readGlb(buffer) {
  if (buffer.readUInt32LE(0) !== GLB_MAGIC) throw new Error('not a .glb');
  const total = buffer.readUInt32LE(8);
  let offset = 12;
  let json = null;
  let bin = Buffer.alloc(0);
  while (offset < total) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const chunk = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === CHUNK_JSON) json = JSON.parse(chunk.toString('utf8'));
    else if (type === CHUNK_BIN) bin = chunk;
    offset += 8 + length;
  }
  if (json === null) throw new Error('.glb has no JSON chunk');
  return { json, bin };
}

const pad4 = (n) => (4 - (n % 4)) % 4;

/** Packs a glTF document and its single buffer back into a `.glb`. */
export function writeGlb(json, bin) {
  const doc = { ...json, buffers: bin.length > 0 ? [{ byteLength: bin.length }] : [] };
  const jsonChunk = Buffer.from(JSON.stringify(doc), 'utf8');
  const jsonPad = Buffer.alloc(pad4(jsonChunk.length), 0x20);
  const binPad = Buffer.alloc(pad4(bin.length), 0);

  const jsonLength = jsonChunk.length + jsonPad.length;
  const binLength = bin.length + binPad.length;
  const total = 12 + 8 + jsonLength + (bin.length > 0 ? 8 + binLength : 0);

  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);

  const parts = [header, chunkHeader(jsonLength, CHUNK_JSON), jsonChunk, jsonPad];
  if (bin.length > 0) parts.push(chunkHeader(binLength, CHUNK_BIN), bin, binPad);
  return Buffer.concat(parts);
}

function chunkHeader(length, type) {
  const head = Buffer.alloc(8);
  head.writeUInt32LE(length, 0);
  head.writeUInt32LE(type, 4);
  return head;
}

/**
 * Keeps only `names` among the document's animations, then rebuilds the
 * accessor and buffer-view tables from what is still referenced.
 *
 * Everything that can point at an accessor is rewritten: mesh primitives (and
 * their morph targets), skins, and the surviving animation samplers. Anything
 * unreachable from those — which after the cut is most of the file — never
 * makes it into the new binary chunk.
 */
export function trimGlb({ json, bin }, names) {
  const doc = structuredClone(json);
  const wanted = new Set(names);
  const kept = (doc.animations ?? []).filter((animation) => wanted.has(animation.name));
  const missing = names.filter((name) => !kept.some((animation) => animation.name === name));
  if (missing.length > 0) throw new Error(`animations not in file: ${missing.join(', ')}`);
  doc.animations = kept;

  const accessors = new Map();
  const useAccessor = (index) => {
    if (index === undefined) return undefined;
    if (!accessors.has(index)) accessors.set(index, accessors.size);
    return accessors.get(index);
  };

  for (const mesh of doc.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      primitive.attributes = mapValues(primitive.attributes, useAccessor);
      primitive.indices = useAccessor(primitive.indices);
      primitive.targets = primitive.targets?.map((target) => mapValues(target, useAccessor));
    }
  }
  for (const skin of doc.skins ?? []) {
    skin.inverseBindMatrices = useAccessor(skin.inverseBindMatrices);
  }
  for (const animation of doc.animations) {
    for (const sampler of animation.samplers) {
      sampler.input = useAccessor(sampler.input);
      sampler.output = useAccessor(sampler.output);
    }
  }

  const oldAccessors = doc.accessors ?? [];
  doc.accessors = [...accessors.keys()].map((index) => ({ ...oldAccessors[index] }));

  return repackBuffer(doc, bin);
}

/** Rewrites `doc` so its buffer views are dense and returns a fresh `.glb`. */
function repackBuffer(doc, bin) {
  const views = new Map();
  const useView = (index) => {
    if (index === undefined) return undefined;
    if (!views.has(index)) views.set(index, views.size);
    return views.get(index);
  };

  for (const accessor of doc.accessors ?? []) accessor.bufferView = useView(accessor.bufferView);
  for (const image of doc.images ?? []) image.bufferView = useView(image.bufferView);

  const oldViews = doc.bufferViews ?? [];
  const chunks = [];
  let offset = 0;
  doc.bufferViews = [...views.keys()].map((index) => {
    const view = oldViews[index];
    const start = view.byteOffset ?? 0;
    const slice = bin.subarray(start, start + view.byteLength);
    const padding = pad4(slice.length);
    chunks.push(slice);
    if (padding > 0) chunks.push(Buffer.alloc(padding));
    const rebuilt = { ...view, buffer: 0, byteOffset: offset, byteLength: view.byteLength };
    offset += slice.length + padding;
    return rebuilt;
  });

  return writeGlb(doc, Buffer.concat(chunks));
}

function mapValues(record, fn) {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, fn(value)]));
}

/**
 * Turns a `.gltf` document into a `.glb`, pulling in whatever its `uri` fields
 * point at. `resolve(uri)` returns the bytes for a sibling `.bin` or texture.
 */
export async function gltfToGlb(doc, resolve) {
  const json = structuredClone(doc);
  const buffers = [];
  for (const buffer of json.buffers ?? []) buffers.push(await resolveUri(buffer.uri, resolve));

  // Every buffer view already points into `buffers[view.buffer]`; concatenating
  // them means shifting each view's offset by where its buffer landed.
  const bases = [];
  let offset = 0;
  const parts = [];
  for (const buffer of buffers) {
    bases.push(offset);
    parts.push(buffer);
    const padding = pad4(buffer.length);
    if (padding > 0) parts.push(Buffer.alloc(padding));
    offset += buffer.length + padding;
  }
  let bin = Buffer.concat(parts);
  for (const view of json.bufferViews ?? []) {
    view.byteOffset = (view.byteOffset ?? 0) + bases[view.buffer ?? 0];
    view.buffer = 0;
  }

  // Textures referenced by uri become buffer views of their own.
  for (const image of json.images ?? []) {
    if (image.uri === undefined) continue;
    const bytes = await resolveUri(image.uri, resolve);
    const padding = pad4(bin.length);
    image.bufferView = (json.bufferViews ??= []).push({
      buffer: 0,
      byteOffset: bin.length + padding,
      byteLength: bytes.length,
    }) - 1;
    image.mimeType ??= image.uri.endsWith('.jpg') ? 'image/jpeg' : 'image/png';
    delete image.uri;
    bin = Buffer.concat([bin, Buffer.alloc(padding), bytes]);
  }

  return repackBuffer(json, bin);
}

async function resolveUri(uri, resolve) {
  if (uri === undefined) throw new Error('buffer with no uri in a .gltf');
  const match = /^data:[^;]*;base64,(.*)$/s.exec(uri);
  if (match !== null) return Buffer.from(match[1], 'base64');
  return await resolve(decodeURIComponent(uri));
}
