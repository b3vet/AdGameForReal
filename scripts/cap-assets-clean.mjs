/**
 * Removes the PNGs an asset catalogue no longer names.
 *
 * Runs at the end of `npm run cap:assets` (package.json), so that command
 * leaves the tree exactly as it found it plus the art it just generated.
 *
 * ## What it is for
 *
 * `npx cap add ios` lays down Capacitor's project template, and that template
 * ships its own placeholder launch images — `Splash.imageset/
 * splash-2732x2732.png` and two siblings — with a `Contents.json` that names
 * them. `@capacitor/assets` then writes *its* names (`Default@1x~universal~
 * anyany.png` and five more) and rewrites `Contents.json` to match, but it does
 * not delete what it replaced. The template's three are then a megabyte of
 * orphans that Xcode never reads, that `git status` shows after every
 * regenerate, and that someone eventually commits.
 *
 * The rule here is the catalogue's own: a `.imageset` or `.appiconset` is
 * defined by its `Contents.json`, and a PNG beside it that no entry names is
 * not part of it. That is a rule rather than a list of filenames on purpose —
 * it will still be right when the generator changes its naming again.
 *
 * Nothing outside those two directories is touched, and a directory without a
 * `Contents.json` is left alone entirely: an unreadable catalogue is a reason
 * to do nothing, not a reason to delete.
 */

import { readdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';

import { IOS_ICONSET, IOS_SPLASHSET } from './cap-facts.mjs';

/** Every `filename` in a catalogue's `Contents.json`, or null if there is none. */
async function named(dir) {
  let text;
  try {
    text = await readFile(path.join(dir, 'Contents.json'), 'utf8');
  } catch {
    return null;
  }
  try {
    const catalogue = JSON.parse(text);
    const images = Array.isArray(catalogue.images) ? catalogue.images : [];
    return new Set(images.map((image) => image?.filename).filter((name) => typeof name === 'string'));
  } catch {
    return null;
  }
}

async function clean(dir, label) {
  const keep = await named(dir);
  if (keep === null) return 0;

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }

  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.png')) continue;
    if (keep.has(entry.name)) continue;
    await unlink(path.join(dir, entry.name));
    console.log(`[cap] removed ${label}/${entry.name} — the catalogue does not name it`);
    removed++;
  }
  return removed;
}

const removed =
  (await clean(IOS_SPLASHSET, 'Splash.imageset')) + (await clean(IOS_ICONSET, 'AppIcon.appiconset'));

console.log(
  removed === 0
    ? '[cap] catalogues clean — every PNG is named by its Contents.json'
    : `[cap] ${removed} orphaned catalogue PNG(s) removed`,
);
