/**
 * Everything that can be checked about the device build without a Mac
 * (decision D34; `docs/DEVICE.md` is the guide this backs up).
 *
 * `npx cap sync` needs an `ios/` folder, and that folder is created by Xcode's
 * side of the work on the product owner's Mac, so this is what CI and the rest
 * of us can run instead:
 *
 *   1. `dist/index.html` exists — that is what `cap sync` copies into the app,
 *      and a stale or missing one is the single most common way to end up
 *      staring at a white screen on the phone.
 *   2. `capacitor.config.ts` parses and evaluates, through the same CLI that
 *      the native build uses, and says what it resolved to.
 *   3. Whether the iOS project exists yet, and the exact commands to run next.
 *
 *   npm run cap:preflight
 */

import { execFile } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB_INDEX = path.join(ROOT, 'dist', 'index.html');
const IOS_DIR = path.join(ROOT, 'ios');
const CLI_BIN = path.join(ROOT, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor');

const problems = [];

function fail(message) {
  problems.push(message);
  console.log(`[cap] FAIL — ${message}`);
}

function ok(message) {
  console.log(`[cap] ok   — ${message}`);
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

/** Newest mtime under a directory, so a stale `dist/` can be called out. */
async function newestMtime(dir) {
  let newest = 0;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, await newestMtime(full));
    } else {
      const info = await stat(full);
      newest = Math.max(newest, info.mtimeMs);
    }
  }
  return newest;
}

async function checkWebBuild() {
  if (!(await exists(WEB_INDEX))) {
    fail('dist/index.html is missing — run `npm run build` before `npx cap sync ios`');
    return;
  }

  const html = await readFile(WEB_INDEX, 'utf8');
  if (!/<script[^>]+src=/i.test(html)) {
    fail('dist/index.html has no script tag; the build looks incomplete');
    return;
  }

  const built = (await stat(WEB_INDEX)).mtimeMs;
  const sources = await newestMtime(path.join(ROOT, 'src'));
  ok(`dist/index.html present (${(html.length / 1024).toFixed(1)} kB of HTML)`);
  if (sources > built) {
    // Not a failure: `npm run cap:sync` rebuilds anyway. It is a warning
    // because someone running `npx cap sync` by hand would ship the old game.
    console.log('[cap] warn — src/ is newer than dist/; run `npm run build` first');
  }
}

async function checkConfig() {
  if (!(await exists(CLI_BIN))) {
    fail('@capacitor/cli is not installed — run `npm install`');
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
    fail(`capacitor.config.ts did not evaluate — ${error.message}`);
    return null;
  }

  const app = raw.app ?? {};
  const ext = app.extConfig ?? {};

  if (typeof app.appId !== 'string' || !app.appId.includes('.')) {
    fail(`appId "${String(app.appId)}" is not a reverse-DNS bundle id`);
  }
  if (typeof app.appName !== 'string' || app.appName.length === 0) {
    fail('appName is empty');
  }
  if (app.webDir !== 'dist') {
    fail(`webDir is "${String(app.webDir)}"; the device build ships the dist/ build`);
  }
  if (ext.server !== undefined) {
    // A `server.url` left in the config makes the phone load a dev machine
    // that will not be there later, and a changed scheme drops saved progress.
    console.log('[cap] warn — a `server` block is set; the app will not run from its own bundle');
  }

  ok(`config evaluated: ${String(app.appName)} (${String(app.appId)}) -> ${String(app.webDir)}/`);
  ok(`plugins configured: ${Object.keys(ext.plugins ?? {}).join(', ') || 'none'}`);
  return raw;
}

async function main() {
  console.log('[cap] preflight for the iOS wrapper (docs/DEVICE.md)\n');

  await checkWebBuild();
  await checkConfig();

  const hasIOS = await exists(IOS_DIR);
  ok(hasIOS ? 'ios/ exists' : 'ios/ does not exist yet (created once, on the Mac)');

  console.log('\n[cap] next steps on the Mac:');
  const steps = hasIOS
    ? [
        'npm install',
        'npm run cap:sync      # build + copy the web app into ios/',
        'npm run cap:open      # Xcode',
        'pick your iPhone in the toolbar, then Run (Cmd+R)',
      ]
    : [
        'npm install',
        'npm run build',
        'npx cap add ios       # once, ever; commit the ios/ folder it creates',
        'npm run cap:sync',
        'npm run cap:open      # Xcode: set the team under Signing & Capabilities',
        'pick your iPhone in the toolbar, then Run (Cmd+R)',
      ];
  for (const [index, step] of steps.entries()) {
    console.log(`  ${index + 1}. ${step}`);
  }

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
