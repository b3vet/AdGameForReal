/**
 * Everything about the device build that can be checked without a Mac
 * (decision D34, extended by D57; `docs/DEVICE.md` is the guide this backs up).
 *
 *   npm run cap:preflight
 *
 * Xcode and Android Studio are the two things this side cannot run, so this is
 * the rest of it: that the art exists at the sizes the catalogues want, that the
 * config still evaluates, that the native projects are there and agree with it,
 * that the Info.plist and the privacy manifest still say what we decided they
 * would say, that the version is stamped, and that `dist/` is not stale.
 *
 * It ends with one line — the exact next command for wherever the repository has
 * got to. Drop the art, generate the catalogues, sync, open. That line is the
 * whole point: nobody should have to work out which of four commands they are
 * due.
 *
 * Exit codes: 1 when something is *wrong* (art the wrong size, a plist key that
 * has drifted, a half-generated project), 0 when a stage is simply not done yet
 * — running the command it prints is the fix, and that is not a failure.
 *
 * This file owns the reporter, the order and the exit code; the checks that read
 * `ios/` and `android/` are `./cap-native.mjs`, and the paths and file readers
 * they share are `./cap-facts.mjs`.
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  ART_DIR,
  CLI_BIN,
  IOS_WEB_COPY,
  PALETTE_CSS,
  STYLES,
  WEB_INDEX,
  exists,
  mtime,
  newestMtime,
  pngSize,
  readIfPresent,
  ROOT,
} from './cap-facts.mjs';
import {
  checkCatalogues,
  checkPlist,
  checkPlugins,
  checkPrivacyManifest,
  checkProjects,
  checkVersion,
} from './cap-native.mjs';

const execFileAsync = promisify(execFile);

/**
 * What `scripts/app-art.mjs` writes and what the owner replaces (`docs/ART.md`).
 * The sizes are @capacitor/assets' inputs, not a preference: it downsamples from
 * these and never upsamples, so a small source is a blurry icon on the phone.
 */
const ART = [
  // `icon-only.png` is the name @capacitor/assets treats as a finished,
  // full-bleed icon; a bare `icon.png` it treats as a logo and pads onto the
  // background colour first. Both end in the same place for our square opaque
  // art, so either name passes.
  { file: 'icon.png', alt: 'icon-only.png', size: 1024, required: true, what: 'the app icon' },
  { file: 'icon-foreground.png', size: 1024, required: false, what: "Android's adaptive foreground" },
  { file: 'icon-background.png', size: 1024, required: false, what: "Android's adaptive background" },
  { file: 'splash.png', size: 2732, required: true, what: 'the launch splash' },
  { file: 'splash-dark.png', size: 2732, required: false, what: 'the dark-mode splash' },
];

const problems = [];
/** `{ rank, command, why }` — the lowest rank wins the "next" line at the end. */
const stages = [];

const report = {
  fail(message) {
    problems.push(message);
    console.log(`[cap] FAIL — ${message}`);
  },
  warn(message) {
    console.log(`[cap] warn — ${message}`);
  },
  ok(message) {
    console.log(`[cap] ok   — ${message}`);
  },
  stage(rank, command, why) {
    stages.push({ rank, command, why });
  },
  /** Problems so far, for a check that wants to know whether it found any. */
  count() {
    return problems.length;
  },
};

async function checkArt() {
  if (!(await exists(ART_DIR))) {
    report.fail('assets/app/ is missing — the icon and splash the app is built from (docs/ART.md)');
    report.stage(1, 'node scripts/app-art.mjs', 'the placeholder art is not in the tree');
    return;
  }

  let missing = 0;
  for (const spec of ART) {
    let file = path.join(ART_DIR, spec.file);
    let name = spec.file;
    if (spec.alt !== undefined && !(await exists(file))) {
      const alt = path.join(ART_DIR, spec.alt);
      if (await exists(alt)) {
        file = alt;
        name = spec.alt;
      }
    }

    const size = await pngSize(file);
    if (size === null) {
      if (spec.required) {
        report.fail(`assets/app/${spec.file} is missing or not a PNG — ${spec.what} (docs/ART.md)`);
        missing += 1;
      } else {
        report.warn(`assets/app/${spec.file} is missing — ${spec.what} falls back to a generated one`);
      }
      continue;
    }
    if (size.width !== spec.size || size.height !== spec.size) {
      report.fail(
        `assets/app/${name} is ${size.width}x${size.height}; ${spec.what} must be ` +
          `${spec.size}x${spec.size} (@capacitor/assets never upsamples)`,
      );
      continue;
    }
    report.ok(`art ${name} ${size.width}x${size.height} — ${spec.what}`);
  }

  if (missing > 0) {
    report.stage(
      1,
      'node scripts/app-art.mjs',
      'the required art is not in the tree (or drop your own, docs/ART.md)',
    );
  }
}

async function checkConfig() {
  if (!(await exists(CLI_BIN))) {
    report.fail('@capacitor/cli is not installed — run `npm install`');
    return null;
  }

  let raw;
  try {
    // The CLI's own loader: if this prints a config, `cap sync` will read the
    // same one, TypeScript and all.
    const { stdout } = await execFileAsync(process.execPath, [CLI_BIN, 'config', '--json'], {
      cwd: ROOT,
      maxBuffer: 16 * 1024 * 1024,
    });
    raw = JSON.parse(stdout);
  } catch (error) {
    report.fail(`capacitor.config.ts did not evaluate — ${error.message}`);
    return null;
  }

  const app = raw.app ?? {};
  const ext = app.extConfig ?? {};

  if (typeof app.appId !== 'string' || !app.appId.includes('.')) {
    report.fail(`appId "${String(app.appId)}" is not a reverse-DNS bundle id`);
  }
  if (typeof app.appName !== 'string' || app.appName.length === 0) {
    report.fail('appName is empty');
  }
  if (app.webDir !== 'dist') {
    report.fail(`webDir is "${String(app.webDir)}"; the device build ships the dist/ build`);
  }
  if (ext.server !== undefined) {
    // A `server.url` left in the config makes the phone load a dev machine that
    // will not be there later, and a changed scheme drops saved progress.
    report.warn('a `server` block is set; the app will not run from its own bundle');
  }

  report.ok(`config evaluated: ${String(app.appName)} (${String(app.appId)}) -> ${String(app.webDir)}/`);
  report.ok(`plugins configured: ${Object.keys(ext.plugins ?? {}).join(', ') || 'none'}`);

  await checkShellColour(ext);
  return app;
}

/**
 * The launch is three surfaces painting the same colour: the native shell, the
 * splash art's edges, and the page under the canvas. When they drift, launch
 * flashes — which is the one thing `docs/DEVICE.md` asks the owner to watch for,
 * so it should not be their job to notice it.
 */
async function checkShellColour(ext) {
  const shell = typeof ext.backgroundColor === 'string' ? ext.backgroundColor.toLowerCase() : null;
  if (shell === null) return;

  const styles = await readIfPresent(STYLES);
  const palette = await readIfPresent(PALETTE_CSS);
  if (styles === null || palette === null) return;

  const rule = /html,\s*body\s*\{[\s\S]*?\n\}/.exec(styles)?.[0];
  const token = rule === undefined ? null : (/background:\s*var\((--[\w-]+)\)/.exec(rule)?.[1] ?? null);
  const page =
    token === null
      ? /background:\s*(#[0-9a-fA-F]{6})/.exec(rule ?? '')?.[1]
      : new RegExp(`${token}:\\s*(#[0-9a-fA-F]{6})`).exec(palette)?.[1];

  if (page === undefined || page === null) return;
  if (page.toLowerCase() === shell) {
    report.ok(`shell colour ${shell} matches the page background — no flash at launch`);
    return;
  }
  report.warn(
    `shell colour ${shell} (APP_BACKGROUND in capacitor.config.ts) is not the page background ` +
      `${page.toLowerCase()} (${token ?? 'html, body'} in src/ui): launch will step through two ` +
      'colours. Make them one value, then re-run `node scripts/app-art.mjs` and `npm run cap:sync`',
  );
}

async function checkWebBuild() {
  if (!(await exists(WEB_INDEX))) {
    report.fail('dist/index.html is missing — `npm run cap:sync` builds it and copies it in');
    report.stage(4, 'npm run cap:sync', 'there is no web build to put in the app');
    return;
  }

  const html = await readFile(WEB_INDEX, 'utf8');
  if (!/<script[^>]+src=/i.test(html)) {
    report.fail('dist/index.html has no script tag; the build looks incomplete');
    return;
  }

  const built = await mtime(WEB_INDEX);
  report.ok(`dist/index.html present (${(html.length / 1024).toFixed(1)} kB of HTML)`);

  if ((await newestMtime(path.join(ROOT, 'src'))) > built) {
    report.warn('src/ is newer than dist/; the app would ship the old game');
    report.stage(4, 'npm run cap:sync', 'dist/ is older than src/');
    return;
  }

  // What `cap sync` actually copies. If this is older than dist/, the project
  // holds a previous build — the classic "I fixed that, why is it still wrong".
  if (!(await exists(IOS_WEB_COPY))) {
    report.stage(4, 'npm run cap:sync', 'the web build has never been copied into the iOS project');
    return;
  }
  if ((await mtime(IOS_WEB_COPY)) < built) {
    report.warn('ios/App/App/public is older than dist/');
    report.stage(4, 'npm run cap:sync', 'the iOS project holds an older copy of the web build');
    return;
  }
  report.ok('ios/App/App/public matches the current build');
}

function printNext() {
  stages.sort((a, b) => a.rank - b.rank);
  const next = stages[0];
  console.log('');
  if (next === undefined) {
    console.log('[cap] next: npm run cap:open      # Xcode — pick your iPhone, then Run (Cmd+R)');
    return;
  }
  console.log(`[cap] next: ${next.command}`);
  console.log(`[cap]       (${next.why})`);
}

async function main() {
  console.log('[cap] preflight for the device build (docs/DEVICE.md)\n');

  await checkArt();
  const app = await checkConfig();
  await checkProjects(report, app);
  await checkPlist(report, app);
  await checkPrivacyManifest(report);
  await checkVersion(report);
  await checkPlugins(report);
  await checkCatalogues(report);
  await checkWebBuild();

  printNext();

  console.log('');
  if (problems.length > 0) {
    console.log(`[cap] FAIL — ${problems.length} problem(s) above`);
    process.exitCode = 1;
    return;
  }
  console.log('[cap] PASS');
}

main().catch((error) => {
  console.error(`[cap] FAIL — ${error.message}`);
  process.exitCode = 1;
});
