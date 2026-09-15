/**
 * Where the device build's files are, and how to read the three formats the
 * preflight has to look inside. No opinions and no printing: everything here
 * answers a question, and `./cap-preflight.mjs` and `./cap-native.mjs` decide
 * what the answer means.
 *
 * Split out of the preflight because the two check modules both need it and a
 * single file carrying the paths, the readers, the checks and the command-line
 * was well past the length this project keeps files to (CLAUDE.md).
 */

import { open, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const WEB_INDEX = path.join(ROOT, 'dist', 'index.html');
export const ART_DIR = path.join(ROOT, 'assets', 'app');
export const STYLES = path.join(ROOT, 'src', 'ui', 'styles.css');
export const PALETTE_CSS = path.join(ROOT, 'src', 'ui', 'palette.css');
export const CLI_BIN = path.join(ROOT, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor');

const IOS_DIR = path.join(ROOT, 'ios');
export const IOS_APP = path.join(IOS_DIR, 'App', 'App');
export const IOS_PROJECT = path.join(IOS_DIR, 'App', 'App.xcodeproj', 'project.pbxproj');
export const IOS_PLIST = path.join(IOS_APP, 'Info.plist');
export const IOS_PRIVACY = path.join(IOS_APP, 'PrivacyInfo.xcprivacy');
export const IOS_ICONSET = path.join(IOS_APP, 'Assets.xcassets', 'AppIcon.appiconset');
export const IOS_SPLASHSET = path.join(IOS_APP, 'Assets.xcassets', 'Splash.imageset');
export const IOS_SPM = path.join(IOS_DIR, 'App', 'CapApp-SPM', 'Package.swift');
export const IOS_WEB_COPY = path.join(IOS_APP, 'public', 'index.html');

const ANDROID_DIR = path.join(ROOT, 'android');
const ANDROID_MAIN = path.join(ANDROID_DIR, 'app', 'src', 'main');
export const ANDROID_GRADLE = path.join(ANDROID_DIR, 'app', 'build.gradle');
export const ANDROID_MANIFEST = path.join(ANDROID_MAIN, 'AndroidManifest.xml');
export const ANDROID_PLUGINS = path.join(ANDROID_MAIN, 'assets', 'capacitor.plugins.json');
export const ANDROID_LAUNCHER = path.join(ANDROID_MAIN, 'res', 'mipmap-xxxhdpi');

export async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

export async function mtime(file) {
  try {
    return (await stat(file)).mtimeMs;
  } catch {
    return 0;
  }
}

export async function readIfPresent(file) {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

/** Newest mtime under a directory, so a stale copy can be called out. */
export async function newestMtime(dir) {
  let newest = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    newest = entry.isDirectory()
      ? Math.max(newest, await newestMtime(full))
      : Math.max(newest, await mtime(full));
  }
  return newest;
}

/**
 * Width and height out of a PNG's IHDR, which is the first chunk and always at
 * a fixed offset. Reading 24 bytes rather than decoding: `splash.png` is 2732
 * square and a pure-JS decode of it would cost more than every other check in
 * the preflight put together.
 */
export async function pngSize(file) {
  let handle;
  try {
    handle = await open(file, 'r');
  } catch {
    return null;
  }
  try {
    const buf = Buffer.alloc(24);
    const { bytesRead } = await handle.read(buf, 0, 24, 0);
    if (bytesRead < 24) return null;
    if (buf.toString('latin1', 1, 4) !== 'PNG' || buf.toString('latin1', 12, 16) !== 'IHDR') {
      return null;
    }
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } finally {
    await handle.close();
  }
}

/**
 * The XML between a plist `<key>` and the next one. `Info.plist` is flat apart
 * from UIApplicationSceneManifest and nothing we check lives inside it, so this
 * does not need to be a parser.
 *
 * Comments are stripped first, because both plists explain each key in one and
 * those comments name the keys.
 */
export function plistValue(text, key) {
  const bare = text.replace(/<!--[\s\S]*?-->/g, '');
  const tag = `<key>${key}</key>`;
  const at = bare.indexOf(tag);
  if (at < 0) return null;
  const after = bare.slice(at + tag.length);
  const end = after.indexOf('<key>');
  let value = end < 0 ? after : after.slice(0, end);
  // The last key in a dict has no `<key>` after it, only the file's closing
  // tags. None of the keys read here has a nested dict for a value, so cutting
  // at the first `</dict>` cannot truncate a real one.
  const close = value.indexOf('</dict>');
  if (close >= 0) value = value.slice(0, close);
  return value.trim();
}
