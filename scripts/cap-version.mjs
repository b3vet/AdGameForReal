/**
 * Stamps `package.json`'s version into the native projects, so the App Store
 * build number and the repository's version can never disagree (Milestone 9,
 * `docs/25-milestone-9-plan.md` section C).
 *
 *   npm run cap:version              # stamp both projects
 *   npm run cap:version -- --check   # report only, exit 1 if anything is stale
 *   npm run cap:version -- --build 901
 *
 * `npm run cap:sync` runs it, so the ordinary path never calls it by hand.
 *
 * What gets written:
 *
 *   iOS      MARKETING_VERSION        = 0.9.0   (CFBundleShortVersionString)
 *            CURRENT_PROJECT_VERSION  = 900     (CFBundleVersion)
 *   Android  versionName              "0.9.0"
 *            versionCode              900
 *
 * The two plist keys are `$(MARKETING_VERSION)` and `$(CURRENT_PROJECT_VERSION)`
 * in `Info.plist`, which is why the build settings are what this edits: Xcode
 * expands them at build time and the plist stays free of literal numbers.
 *
 * The build number is derived, not counted: `major * 10000 + minor * 100 +
 * patch`. Deriving it keeps the script idempotent — `cap:sync` runs on every
 * build and must not dirty the tree — and keeps it monotonic as long as the
 * version only ever goes up, which is what App Store Connect requires. The one
 * case deriving cannot cover is a *second* upload of the same version (the
 * first was rejected, say): pass `--build 901` for that, or bump the patch.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PBXPROJ = path.join(ROOT, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');
export const APP_GRADLE = path.join(ROOT, 'android', 'app', 'build.gradle');

/** `0.9.0` -> `{ version: '0.9.0', build: 900 }`. */
export async function expectedVersion(buildOverride) {
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const version = String(pkg.version);
  // Anchored, so `0.9.0-rc.1` is rejected rather than parsed as 0.9.0 and
  // stamped as a build that has already been uploaded.
  const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (parts === null) {
    throw new Error(`package.json version "${version}" is not major.minor.patch`);
  }
  const [major, minor, patch] = parts.slice(1).map((n) => Number.parseInt(n, 10));
  // Two digits each for minor and patch: 0.9.0 -> 900, 1.0.0 -> 10000. Which is
  // also the ceiling: 0.9.100 and 0.10.0 would both derive 1000, and a build
  // number that repeats is an upload App Store Connect refuses.
  if (minor > 99 || patch > 99) {
    throw new Error(
      `package.json version "${version}" has a minor or patch above 99; the derived ` +
        'build number would collide with another version (see the note at the top of this file)',
    );
  }
  const derived = major * 10000 + minor * 100 + patch;
  return { version, build: buildOverride ?? derived };
}

async function readIfPresent(file) {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

/** What the Xcode project currently says, or null if there is no project. */
export async function readIosVersion() {
  const text = await readIfPresent(PBXPROJ);
  if (text === null) return null;
  const version = /MARKETING_VERSION = ([^;]+);/.exec(text)?.[1]?.trim();
  const build = /CURRENT_PROJECT_VERSION = ([^;]+);/.exec(text)?.[1]?.trim();
  if (version === undefined || build === undefined) return null;
  return { version, build: Number.parseInt(build, 10) };
}

/** What `android/app/build.gradle` currently says, or null if absent. */
export async function readAndroidVersion() {
  const text = await readIfPresent(APP_GRADLE);
  if (text === null) return null;
  const version = /versionName\s+"([^"]+)"/.exec(text)?.[1];
  const build = /versionCode\s+(\d+)/.exec(text)?.[1];
  if (version === undefined || build === undefined) return null;
  return { version, build: Number.parseInt(build, 10) };
}

async function stampIos({ version, build }, write) {
  const text = await readIfPresent(PBXPROJ);
  if (text === null) return 'ios/ does not exist — nothing to stamp';

  // Every build configuration carries its own copy of both settings, so this
  // is a replace-all rather than a single edit.
  const next = text
    .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`)
    .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${build};`);

  if (next === text) return `ios already at ${version} (${build})`;
  if (write) await writeFile(PBXPROJ, next);
  return `ios ${write ? 'stamped' : 'would be stamped'} ${version} (${build})`;
}

async function stampAndroid({ version, build }, write) {
  const text = await readIfPresent(APP_GRADLE);
  if (text === null) return 'android/ does not exist — nothing to stamp';

  const next = text
    .replace(/versionName\s+"[^"]*"/, `versionName "${version}"`)
    .replace(/versionCode\s+\d+/, `versionCode ${build}`);

  if (next === text) return `android already at ${version} (${build})`;
  if (write) await writeFile(APP_GRADLE, next);
  return `android ${write ? 'stamped' : 'would be stamped'} ${version} (${build})`;
}

async function main(argv) {
  const check = argv.includes('--check');
  const buildFlag = argv.indexOf('--build');
  const override =
    buildFlag >= 0 ? Number.parseInt(String(argv[buildFlag + 1] ?? ''), 10) : undefined;
  if (buildFlag >= 0 && !Number.isInteger(override)) {
    throw new Error('--build needs an integer, e.g. `npm run cap:version -- --build 901`');
  }

  const target = await expectedVersion(override);
  console.log(`[cap] version ${target.version}, build ${target.build} (from package.json)`);
  console.log(`[cap] ${await stampIos(target, !check)}`);
  console.log(`[cap] ${await stampAndroid(target, !check)}`);

  if (!check) return;

  const stale = [];
  const ios = await readIosVersion();
  if (ios !== null && (ios.version !== target.version || ios.build !== target.build)) {
    stale.push(`ios is ${ios.version} (${ios.build})`);
  }
  const android = await readAndroidVersion();
  if (android !== null && (android.version !== target.version || android.build !== target.build)) {
    stale.push(`android is ${android.version} (${android.build})`);
  }
  if (stale.length > 0) {
    console.log(`[cap] FAIL — ${stale.join('; ')}; run \`npm run cap:version\``);
    process.exitCode = 1;
  }
}

// Only when run as a command; `cap-preflight.mjs` imports the readers above.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`[cap] FAIL — ${error.message}`);
    process.exitCode = 1;
  });
}
