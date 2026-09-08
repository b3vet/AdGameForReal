/**
 * Minimal PNG reader for the smoke test's blank-frame check.
 *
 * Hand-rolled rather than pulled from npm because the smoke test must not add
 * dependencies (docs/03-milestone-1-plan.md). Handles what Playwright emits:
 * 8-bit, non-interlaced, truecolour with or without alpha, and greyscale.
 */

import { inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CHANNELS_BY_COLOR_TYPE = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Returns `{ width, height, channels, pixels }` with one byte per sample. */
export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error('not a PNG file');
  }

  let offset = 8;
  let header = null;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  if (header === null) throw new Error('PNG has no IHDR chunk');
  if (header.bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${header.bitDepth}`);
  if (header.interlace !== 0) throw new Error('interlaced PNGs are not supported');

  const channels = CHANNELS_BY_COLOR_TYPE[header.colorType];
  if (channels === undefined) throw new Error(`unsupported PNG colour type ${header.colorType}`);

  const { width, height } = header;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const rowStart = y * (stride + 1) + 1;
    const outStart = y * stride;

    for (let i = 0; i < stride; i++) {
      const value = raw[rowStart + i];
      const a = i >= channels ? pixels[outStart + i - channels] : 0;
      const b = y > 0 ? pixels[outStart - stride + i] : 0;
      const c = i >= channels && y > 0 ? pixels[outStart - stride + i - channels] : 0;

      let restored;
      switch (filter) {
        case 0:
          restored = value;
          break;
        case 1:
          restored = value + a;
          break;
        case 2:
          restored = value + b;
          break;
        case 3:
          restored = value + ((a + b) >> 1);
          break;
        case 4:
          restored = value + paeth(a, b, c);
          break;
        default:
          throw new Error(`unknown PNG filter type ${filter} on row ${y}`);
      }
      pixels[outStart + i] = restored & 0xff;
    }
  }

  return { width, height, channels, pixels };
}

/**
 * Luminance statistics over the decoded image. A blank frame — a dead canvas or
 * a flat clear colour with nothing drawn — has a standard deviation near zero
 * and only a handful of distinct luminance buckets.
 */
export function luminanceStats(image) {
  const { width, height, channels, pixels } = image;
  const buckets = new Set();

  let sum = 0;
  let sumSquares = 0;
  let count = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const r = pixels[i];
      const g = channels >= 3 ? pixels[i + 1] : r;
      const b = channels >= 3 ? pixels[i + 2] : r;
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;

      sum += luma;
      sumSquares += luma * luma;
      count++;
      buckets.add(luma >> 2);
    }
  }

  const mean = sum / count;
  const variance = Math.max(0, sumSquares / count - mean * mean);

  return {
    mean,
    stdDev: Math.sqrt(variance),
    distinctBuckets: buckets.size,
  };
}
