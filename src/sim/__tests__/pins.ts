/**
 * Pins a design change is expected to move: hashes of the scripted campaign's
 * runs (`./regression.test.ts`) and recipes (`./frost.test.ts`), kept in JSON
 * files beside this one so re-recording them is one command rather than a
 * hand edit of a table:
 *
 *   RECORD=1 npx vitest run src/sim/__tests__/regression.test.ts src/sim/__tests__/frost.test.ts
 *
 * With `RECORD=1` a pin test writes what it measured into its file and passes;
 * `git diff src/sim/__tests__/*.pins.json` then shows exactly which pins
 * moved, and the reason goes in the milestone log in the same commit. Without
 * it, a moved or missing pin fails and the message lists every one of them.
 *
 * Only pins of the scripted campaign live here. The dealt path's goldens (the
 * endless road, the fixtures) are constants in the test files and are never
 * re-recorded by this command: that path must replay byte for byte.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const RECORDING = process.env['RECORD'] === '1';

export const RECORD_COMMAND =
  'RECORD=1 npx vitest run src/sim/__tests__/regression.test.ts src/sim/__tests__/frost.test.ts';

interface PinFile {
  note: string;
  pins: Record<string, string>;
}

function pathOf(file: string): string {
  return fileURLToPath(new URL(`./${file}`, import.meta.url));
}

function readPinFile(file: string): PinFile {
  try {
    const parsed: unknown = JSON.parse(readFileSync(pathOf(file), 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return { note: '', pins: {} };
    const fields = parsed as Partial<PinFile>;
    return { note: typeof fields.note === 'string' ? fields.note : '', pins: { ...(fields.pins ?? {}) } };
  } catch {
    return { note: '', pins: {} };
  }
}

/**
 * Checks `actual` against the pins in `file` and returns a report of every
 * pin that moved or was never recorded, empty when all of them hold. When
 * recording, merges `actual` into the file instead and returns empty.
 */
export function checkPins(file: string, actual: Readonly<Record<string, string>>): string {
  const stored = readPinFile(file);
  if (RECORDING) {
    const pins = { ...stored.pins, ...actual };
    const sorted: Record<string, string> = {};
    for (const key of Object.keys(pins).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))) {
      sorted[key] = pins[key] ?? '';
    }
    writeFileSync(pathOf(file), `${JSON.stringify({ note: stored.note, pins: sorted }, null, 2)}\n`);
    return '';
  }
  const moved: string[] = [];
  for (const [key, hash] of Object.entries(actual)) {
    const pinned = stored.pins[key];
    if (pinned === hash) continue;
    moved.push(`  ${key}: ${hash} (${pinned === undefined ? 'never recorded' : `pinned ${pinned}`})`);
  }
  if (moved.length === 0) return '';
  return (
    `${String(moved.length)} of ${String(Object.keys(actual).length)} pins in ${file} moved. ` +
    `A deliberate design change is re-recorded with\n  ${RECORD_COMMAND}\n` +
    `and its reason written in the milestone log:\n${moved.join('\n')}`
  );
}

/** FNV-1a, 32 bit. Any stable hash would do; this one is short enough to read. */
export function hashOf(text: string): string {
  let hash = 0x81_1c_9d_c5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01_00_01_93) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
