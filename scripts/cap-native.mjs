/**
 * The half of `npm run cap:preflight` that reads the generated native projects
 * (`ios/`, `android/`) and says whether they still carry the decisions Milestone
 * 9 made in them: portrait, full screen, no status bar, export compliance
 * declared, a privacy manifest that collects nothing, one bundle id, a stamped
 * version, the plugins registered, and catalogues newer than the art.
 *
 * Both projects are committed (D57), so all of this is checkable here rather
 * than on the owner's Mac — which is the point: a plist key silently reverted by
 * a regenerate would otherwise be found by App Store review.
 *
 * Every function takes the preflight's reporter (`{ ok, fail, warn, stage }`)
 * rather than printing, so the order of the output and the exit code stay in one
 * place (`./cap-preflight.mjs`).
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  ANDROID_GRADLE,
  ANDROID_LAUNCHER,
  ANDROID_MANIFEST,
  ANDROID_PLUGINS,
  ART_DIR,
  IOS_ICONSET,
  IOS_PLIST,
  IOS_PRIVACY,
  IOS_PROJECT,
  IOS_SPLASHSET,
  IOS_SPM,
  ROOT,
  exists,
  newestMtime,
  plistValue,
  readIfPresent,
} from './cap-facts.mjs';
import { expectedVersion, readAndroidVersion, readIosVersion } from './cap-version.mjs';

/** Plugins the app is built against; each must be installed and registered. */
const PLUGINS = [
  '@capacitor/app',
  '@capacitor/haptics',
  '@capacitor/screen-orientation',
  '@capacitor/splash-screen',
  '@capacitor/status-bar',
];

/** Every Info.plist key Milestone 9 set, and why, so a silent revert is caught. */
const PLIST_KEYS = [
  ['ITSAppUsesNonExemptEncryption', '<false/>', 'export compliance, answered once instead of per upload'],
  ['UIRequiresFullScreen', '<true/>', 'no Split View or Stage Manager aspect ratio'],
  ['UIStatusBarHidden', '<true/>', 'no status bar over the level chip, from the first frame'],
  ['UIViewControllerBasedStatusBarAppearance', '<true/>', '@capacitor/status-bar is inert without it'],
];

/**
 * The required-reason APIs WebKit's own storage needs (docs/DEVICE.md, §9).
 *
 * All three that `PrivacyInfo.xcprivacy` declares, not a sample of them: the
 * point of the check is that a regenerate or an Xcode plist rewrite cannot
 * quietly drop one, and a category dropped is an upload rejected by App Store
 * Connect months later. The codes are Apple's own — CA92.1 "access info from
 * same app", C617.1 "inside app container", E174.1 "check for sufficient space
 * before writing".
 */
const PRIVACY_REASONS = [
  ['NSPrivacyAccessedAPICategoryUserDefaults', 'CA92.1'],
  ['NSPrivacyAccessedAPICategoryFileTimestamp', 'C617.1'],
  ['NSPrivacyAccessedAPICategoryDiskSpace', 'E174.1'],
];

export async function checkProjects(report, app) {
  const pbx = await readIfPresent(IOS_PROJECT);
  if (pbx === null) {
    report.fail('ios/App/App.xcodeproj is missing — run `npx cap add ios` (it is committed, D57)');
    report.stage(2, 'npx cap add ios', 'the iOS project is not in the tree');
  } else {
    report.ok('ios/ project present');
  }

  const gradle = await readIfPresent(ANDROID_GRADLE);
  if (gradle === null) {
    report.warn('android/ is missing — iOS is the platform being tested (D4); `npx cap add android` adds it');
  } else {
    report.ok('android/ project present');
  }

  if (app === null) return;

  // The single most expensive mistake in docs/DEVICE.md: change the bundle id in
  // Xcode only, and the next `cap sync` writes the config's id back over it and
  // Xcode asks for signing all over again.
  if (pbx !== null) {
    const ids = new Set([...pbx.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)].map((m) => m[1].trim()));
    if (ids.size !== 1 || !ids.has(String(app.appId))) {
      report.fail(
        `Xcode's PRODUCT_BUNDLE_IDENTIFIER is ${[...ids].join(', ')} but capacitor.config.ts says ` +
          `${String(app.appId)}; set both to the same value (docs/DEVICE.md section 4)`,
      );
    } else {
      report.ok(`bundle id agrees: ${String(app.appId)}`);
    }

    if (/TARGETED_DEVICE_FAMILY = 1;/.test(pbx)) {
      report.ok('targeted device family 1 — iPhone only, portrait');
    } else {
      report.warn('TARGETED_DEVICE_FAMILY is not 1; the App Store will then ask for iPad screenshots too');
    }
  }

  if (gradle !== null) {
    const appId = /applicationId\s+"([^"]+)"/.exec(gradle)?.[1];
    if (appId !== String(app.appId)) {
      report.fail(`android applicationId is ${String(appId)} but capacitor.config.ts says ${String(app.appId)}`);
    }
  }

  const manifest = await readIfPresent(ANDROID_MANIFEST);
  if (manifest !== null && !manifest.includes('android:screenOrientation="portrait"')) {
    report.fail('android manifest has lost android:screenOrientation="portrait"');
  }
}

export async function checkPlist(report, app) {
  const text = await readIfPresent(IOS_PLIST);
  if (text === null) return;

  const before = report.count();

  const name = plistValue(text, 'CFBundleDisplayName');
  const wanted = `<string>${String(app?.appName ?? 'Arcane Rush')}</string>`;
  if (name !== wanted) report.fail(`Info.plist CFBundleDisplayName is ${String(name)}, not ${wanted}`);

  for (const [key, value, why] of PLIST_KEYS) {
    const found = plistValue(text, key);
    if (found === null) report.fail(`Info.plist has no ${key} — ${why}`);
    else if (found !== value) report.fail(`Info.plist ${key} is ${found}, not ${value} — ${why}`);
  }

  const orientations = plistValue(text, 'UISupportedInterfaceOrientations') ?? '';
  const listed = [...orientations.matchAll(/<string>([^<]+)<\/string>/g)].map((m) => m[1]);
  if (listed.length !== 1 || listed[0] !== 'UIInterfaceOrientationPortrait') {
    report.fail(`Info.plist UISupportedInterfaceOrientations is [${listed.join(', ')}]; the game is portrait only`);
  }

  // Literal numbers here would be a second place to bump a version, and the one
  // nobody remembers (`scripts/cap-version.mjs`).
  const version = plistValue(text, 'CFBundleShortVersionString');
  const build = plistValue(text, 'CFBundleVersion');
  if (
    version !== '<string>$(MARKETING_VERSION)</string>' ||
    build !== '<string>$(CURRENT_PROJECT_VERSION)</string>'
  ) {
    report.fail('Info.plist has literal version numbers; they must stay $(MARKETING_VERSION) and $(CURRENT_PROJECT_VERSION)');
  }

  if (report.count() === before) {
    report.ok('Info.plist: portrait, full screen, status bar hidden, encryption declared');
  }
}

export async function checkPrivacyManifest(report) {
  const text = await readIfPresent(IOS_PRIVACY);
  if (text === null) {
    report.fail('ios/App/App/PrivacyInfo.xcprivacy is missing — App Store Connect rejects the upload without it');
    return;
  }

  if (plistValue(text, 'NSPrivacyTracking') !== '<false/>') {
    report.fail('PrivacyInfo.xcprivacy does not declare NSPrivacyTracking false (D6: no ads, no analytics)');
  }
  if (plistValue(text, 'NSPrivacyCollectedDataTypes') !== '<array/>') {
    report.fail('PrivacyInfo.xcprivacy claims collected data types; the game collects nothing');
  }
  for (const [category, reason] of PRIVACY_REASONS) {
    if (!text.includes(category) || !text.includes(reason)) {
      report.fail(`PrivacyInfo.xcprivacy is missing ${category} (${reason}) — WebKit's storage needs it`);
    }
  }

  const pbx = await readIfPresent(IOS_PROJECT);
  if (pbx !== null && !/PrivacyInfo\.xcprivacy in Resources/.test(pbx)) {
    report.fail('PrivacyInfo.xcprivacy exists but is not in the Xcode target: it will not be in the bundle');
  }

  report.ok('privacy manifest: no tracking, no collected data, required-reason APIs declared');
}

export async function checkVersion(report) {
  const target = await expectedVersion();
  const ios = await readIosVersion();
  const android = await readAndroidVersion();

  const stale = [];
  if (ios !== null && (ios.version !== target.version || ios.build !== target.build)) {
    stale.push(`ios ${ios.version} (${ios.build})`);
  }
  if (android !== null && (android.version !== target.version || android.build !== target.build)) {
    stale.push(`android ${android.version} (${android.build})`);
  }

  if (stale.length > 0) {
    report.warn(`version not stamped: package.json is ${target.version} (${target.build}), ${stale.join(', ')}`);
    report.stage(4, 'npm run cap:sync', 'the native projects carry an older version than package.json');
    return;
  }
  report.ok(`version ${target.version}, build ${target.build}, stamped in both projects`);
}

export async function checkPlugins(report) {
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  const missing = PLUGINS.filter((name) => deps[name] === undefined);
  if (missing.length > 0) {
    report.fail(`plugins not in package.json: ${missing.join(', ')} — run \`npm install\``);
    return;
  }
  const uninstalled = [];
  for (const name of PLUGINS) {
    if (!(await exists(path.join(ROOT, 'node_modules', name)))) uninstalled.push(name);
  }
  if (uninstalled.length > 0) {
    report.fail(`plugins not installed: ${uninstalled.join(', ')} — run \`npm install\``);
    return;
  }
  report.ok(`plugins installed: ${PLUGINS.map((n) => n.replace('@capacitor/', '')).join(', ')}`);

  // Registration is what `cap sync` writes; a plugin that is installed but not
  // registered is a plugin whose calls silently do nothing on the device.
  const spm = await readIfPresent(IOS_SPM);
  if (spm !== null) {
    const unregistered = PLUGINS.filter((name) => !spm.includes(`node_modules/${name}`));
    if (unregistered.length > 0) {
      report.warn(`ios has not registered ${unregistered.join(', ')}`);
      report.stage(4, 'npm run cap:sync', 'a plugin is installed but not in the iOS Package.swift');
    } else {
      report.ok('plugins registered in the iOS Swift package');
    }
  }

  const androidPlugins = await readIfPresent(ANDROID_PLUGINS);
  if (androidPlugins !== null) {
    const unregistered = PLUGINS.filter((name) => !androidPlugins.includes(`"${name}"`));
    if (unregistered.length > 0) report.warn(`android has not registered ${unregistered.join(', ')}`);
  }
}

/**
 * Whether `npm run cap:assets` has been run since the art last changed. The
 * catalogues are generated files that are committed, so the only way to know
 * they are current is the same mtime test `dist/` gets.
 */
export async function checkCatalogues(report) {
  const art = await newestMtime(ART_DIR);
  if (art === 0) return;

  const stale = [];
  for (const [what, dir] of [
    ['the iOS app icon', IOS_ICONSET],
    ['the iOS splash', IOS_SPLASHSET],
    ['the Android launcher icons', ANDROID_LAUNCHER],
  ]) {
    if (!(await exists(dir))) continue;
    if ((await newestMtime(dir)) < art) stale.push(what);
  }

  if (stale.length > 0) {
    report.warn(`${stale.join(', ')} predate assets/app/ — the app would ship the placeholder catalogue`);
    report.stage(3, 'npm run cap:assets', 'the icon and splash catalogues are older than the art');
    return;
  }
  report.ok('icon and splash catalogues are newer than the art');
}
