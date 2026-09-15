/**
 * Draws the placeholder app icon, splash screens and web icons from the palette
 * (decision D57, docs/ART.md).
 *
 *   node scripts/app-art.mjs
 *
 * Everything below is one SVG mark — a tall wizard's hat with a gold band — laid
 * out in the sizes the stores and the browsers ask for and rasterised in the
 * headless Chromium `scripts/fetch-assets.mjs` already uses to encode textures.
 * SVG because the mark is then one description drawn at five sizes, and
 * Chromium because no dependency may be added (CLAUDE.md). Writes:
 *
 *   assets/app/icon.png            1024  square, opaque; iOS masks the corners
 *   assets/app/icon-foreground.png 1024  Android adaptive layer, transparent
 *   assets/app/icon-background.png 1024  Android adaptive layer, opaque
 *   assets/app/splash.png          2732  subject inside the centre 40 percent
 *   assets/app/splash-dark.png     2732  the same composition, night sky
 *   public/favicon.svg                   the mark itself, vector
 *   public/apple-touch-icon.png     180
 *   public/icon-192.png             192  the web manifest's icons
 *   public/icon-512.png             512
 *   public/manifest.webmanifest
 *
 * Idempotent: it only writes, never reads its own output, and the same palette
 * through the same Chromium gives the same bytes. The owner replaces
 * `assets/app/icon.png` and `splash.png` with their own art and runs
 * `npm run cap:assets`; this script is what makes the repository build an app
 * before they have. The placeholders are our own work (docs/ASSETS.md).
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PALETTE_FILE = path.join(ROOT, 'src', 'data', 'palette.json');
const CAPACITOR_CONFIG = path.join(ROOT, 'capacitor.config.ts');
const CINZEL = path.join(ROOT, 'assets', 'fonts', 'cinzel-latin.woff2');

/** SwiftShader: headless Chromium has no GPU (`scripts/smoke-browser.mjs`). */
const CHROMIUM_ARGS = [
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
];

const CHROMIUM_FALLBACKS = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
];

/** A radial gradient across 2732 px costs this much on its own, which is why
 * every sky below is a vertical ramp. */
const MAX_BYTES = 400 * 1024;

const APP_NAME = 'Arcane Rush';
const APP_DESCRIPTION = 'A portrait lane-defense auto-shooter.';

/** Roles, never hex (D36): every colour in this file comes through here. */
let palette = {};
function c(role) {
  const value = role.split('.').reduce((node, key) => node?.[key], palette);
  if (typeof value !== 'string') throw new Error(`palette.json has no role "${role}"`);
  return value;
}

/**
 * The colour the native shell paints before the web view draws, read out of
 * `capacitor.config.ts` rather than repeated here: the splash has to end on
 * exactly that colour or the launch flashes. Not a palette role — it is the
 * shell's own.
 */
function appBackground(source) {
  const match = /const APP_BACKGROUND = '(#[0-9a-fA-F]{6})';/.exec(source);
  if (match?.[1] === undefined) {
    throw new Error("capacitor.config.ts no longer declares `const APP_BACKGROUND = '#rrggbb';`");
  }
  return match[1];
}

// --- The mark ---------------------------------------------------------------

/**
 * The hat is drawn in a 512-square space; this is the box its ink fills, brim
 * edge to wisp glow. Canvases place the mark through this rather than through
 * the whole 512, so the art fills the space it is given instead of carrying
 * invisible margins into five sizes.
 */
const HAT_VIEW = '62 28 416 416';

function hatDefs({ cone, band, shade, wisp }) {
  return `
    <linearGradient id="hat-cone" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${cone.light}"/>
      <stop offset="1" stop-color="${cone.base}"/>
    </linearGradient>
    <linearGradient id="hat-band" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${band.light}"/>
      <stop offset="0.55" stop-color="${band.base}"/>
      <stop offset="1" stop-color="${band.deep}"/>
    </linearGradient>
    <!-- The light falls from the upper left, so the far side of the cone rolls
         into shadow. A ramp rather than a second shape: a hard edge down the
         middle of a cone reads as a fold in it. -->
    <linearGradient id="hat-roll" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0.38" stop-color="${shade}" stop-opacity="0"/>
      <stop offset="1" stop-color="${shade}" stop-opacity="0.34"/>
    </linearGradient>
    <radialGradient id="hat-wisp">
      <stop offset="0.3" stop-color="${wisp.base}" stop-opacity="0.55"/>
      <stop offset="1" stop-color="${wisp.base}" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="hat-cone-clip"><path d="${CONE}"/></clipPath>`;
}

/**
 * The cone: a long left edge, a tip that hooks right, and a base that bulges
 * down into the brim the way a real crown meets a real brim — a flat base line
 * would read as a triangle sitting on a plate.
 */
const CONE =
  'M152 380 C 176 278 232 148 296 60 C 307 42 333 47 335 74 ' +
  'C 345 188 359 288 368 380 C 332 402 188 402 152 380 Z';

function hat({ band }) {
  return `
    <g>
      <!-- Brim first, cone over it: the brim's far edge is hidden by the cone
           exactly as it is on a hat, so no second layer is needed. It takes the
           crown's own ramp, which each element resolves against its own box, so
           the brim is light where the crown meets it and falls away at the
           front lip. Lighter than the crown, not darker, because the brim is
           the one part of the mark that sits against the deep end of the
           background and a brim in shadow there disappears. -->
      <ellipse cx="260" cy="384" rx="190" ry="52" fill="url(#hat-cone)"/>
      <path d="${CONE}" fill="url(#hat-cone)"/>
      <g clip-path="url(#hat-cone-clip)">
        <path d="M120 30 L400 30 L400 410 L120 410 Z" fill="url(#hat-roll)"/>
        <path d="M110 296 L420 288 L420 352 L110 360 Z" fill="url(#hat-band)"/>
      </g>
      <rect x="234" y="298" width="62" height="50" rx="10" fill="none"
            stroke="${band.deep}" stroke-width="11"/>
      <rect x="240" y="304" width="50" height="38" rx="7" fill="none"
            stroke="${band.light}" stroke-width="5"/>
      <!-- The wisp familiar, off the tip: the one round shape in a mark made of
           straight edges, which is what keeps the silhouette from reading as a
           traffic cone at 60 px. -->
      <circle cx="152" cy="152" r="58" fill="url(#hat-wisp)"/>
      <circle cx="152" cy="152" r="30" fill="${band.base}"/>
      <circle cx="152" cy="152" r="17" fill="${band.light}"/>
    </g>`;
}

/** The mark's colours, all of them palette roles (D36). */
function markColours() {
  return {
    cone: { light: c('arcane.light'), base: c('arcane.base') },
    band: { light: c('gold.light'), base: c('gold.base'), deep: c('gold.deep') },
    shade: c('ink.base'),
    wisp: { base: c('gold.base'), light: c('gold.light') },
  };
}

// --- The canvases -----------------------------------------------------------

function svg(size, body, defs = '') {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 ${size} ${size}">` +
    (defs === '' ? '' : `<defs>${defs}</defs>`) +
    body +
    '</svg>'
  );
}

/** The top-left corner of a box of `size` centred in a square of `canvas`. */
function corner(canvas, size) {
  return (canvas - size) / 2;
}

/**
 * The violet field both icon layers stand on. Vertical rather than corner to
 * corner because each row of a vertical ramp is one colour, which is what a PNG
 * row filter reduces to nothing: a diagonal ramp across 1024 px is a megabyte.
 */
function fieldDefs(bloom) {
  return `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
       <stop offset="0" stop-color="${c('arcane.base')}"/>
       <stop offset="1" stop-color="${c('arcane.deep')}"/>
     </linearGradient>
     <radialGradient id="halo">
       <stop offset="0" stop-color="${c('arcane.light')}" stop-opacity="${bloom}"/>
       <stop offset="1" stop-color="${c('arcane.light')}" stop-opacity="0"/>
     </radialGradient>`;
}

/**
 * The icon: the mark on the violet field, with a 10 percent margin so iOS's
 * squircle and a maskable crop both take corners and not the hat.
 */
function iconSvg(size, { margin = 0.8 } = {}) {
  const colours = markColours();
  const art = Math.round(size * margin);
  const at = corner(size, art);
  return svg(
    size,
    `<rect width="${size}" height="${size}" fill="url(#bg)"/>` +
      `<circle cx="${size / 2}" cy="${size * 0.44}" r="${size * 0.36}" fill="url(#halo)"/>` +
      `<svg x="${at}" y="${at}" width="${art}" height="${art}" ` +
      `viewBox="${HAT_VIEW}">${hat(colours)}</svg>`,
    fieldDefs(0.62) + hatDefs(colours),
  );
}

/**
 * Android masks foreground over background to whatever shape the launcher
 * wants, cropping up to a third of the canvas, so the hat stays inside the
 * centre 66 percent and the layer is transparent everywhere else.
 */
function iconForegroundSvg(size) {
  const colours = markColours();
  const art = Math.round(size * 0.62);
  const at = corner(size, art);
  return svg(
    size,
    `<svg x="${at}" y="${at}" width="${art}" height="${art}" ` +
      `viewBox="${HAT_VIEW}">${hat(colours)}</svg>`,
    hatDefs(colours),
  );
}

function iconBackgroundSvg(size) {
  return svg(
    size,
    `<rect width="${size}" height="${size}" fill="url(#bg)"/>` +
      `<circle cx="${size / 2}" cy="${size / 2}" r="${size * 0.38}" fill="url(#halo)"/>`,
    fieldDefs(0.45),
  );
}

/**
 * The splash, square because every device crops it to its own shape: a phone
 * keeps the full height and about the middle half of the width, so hat and
 * wordmark together sit inside the centre 40 percent. The sky begins and ends
 * on the shell colour (`APP_BACKGROUND`), so the top and bottom of the splash
 * and the first frame of the launch are one colour and nothing flashes.
 */
function splashSvg(size, shell, { dark, font }) {
  const colours = markColours();
  // The hat, a gap and the wordmark as shares of the canvas. `CAP` is Cinzel's
  // cap height in ems, which turns a font size into the height the wordmark
  // occupies — the face has no descenders in this word.
  const HAT = 0.27;
  const GAP = 0.016;
  const TYPE = 0.05;
  const CAP = 0.7;
  const block = HAT + GAP + TYPE * CAP;
  const top = (1 - block) / 2;

  const art = Math.round(size * HAT);
  const sky = dark
    ? { edge: c('ink.base'), middle: c('arcane.deep') }
    : { edge: shell, middle: c('sky.horizon') };
  const wordmark = dark ? c('gold.light') : c('ink.base');

  return svg(
    size,
    `<rect width="${size}" height="${size}" fill="url(#sky)"/>` +
      `<svg x="${corner(size, art)}" y="${size * top}" width="${art}" height="${art}" ` +
      `viewBox="${HAT_VIEW}">${hat(colours)}</svg>` +
      `<text x="${size / 2}" y="${size * (top + block)}" text-anchor="middle" ` +
      `font-family="Cinzel" font-weight="900" font-size="${size * TYPE}" ` +
      `fill="${wordmark}">${APP_NAME}</text>`,
    `<style>@font-face{font-family:'Cinzel';font-style:normal;font-weight:700 900;` +
      `src:url(data:font/woff2;base64,${font}) format('woff2');}</style>` +
      `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
         <stop offset="0" stop-color="${sky.edge}"/>
         <stop offset="0.46" stop-color="${sky.middle}"/>
         <stop offset="1" stop-color="${sky.edge}"/>
       </linearGradient>` +
      hatDefs(colours),
  );
}

// --- Rendering --------------------------------------------------------------

function resolveChromium(chromium) {
  try {
    const fromPlaywright = chromium.executablePath();
    if (existsSync(fromPlaywright)) return fromPlaywright;
  } catch {
    // Fall through to the preinstalled browser.
  }
  const fallback = CHROMIUM_FALLBACKS.find((candidate) => existsSync(candidate));
  if (fallback === undefined) {
    throw new Error(`Chromium not found. Looked in:\n  ${CHROMIUM_FALLBACKS.join('\n  ')}`);
  }
  return fallback;
}

/**
 * One page per image at exactly the output size, so the screenshot *is* the
 * file. Chromium writes 8-bit RGB for an opaque page — which is what the App
 * Store wants, an icon with an alpha channel being rejected — and RGBA only
 * where `transparent` asks for it.
 */
async function render(browser, markup, size, { transparent = false } = {}) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  try {
    await page.setContent(
      `<!doctype html><html><body style="margin:0;overflow:hidden">${markup}</body></html>`,
    );
    // The wordmark is Cinzel from `assets/fonts`, embedded in the SVG; a
    // screenshot taken before it loads is the fallback serif.
    await page.evaluate(async () => {
      // `globalThis`, because this body runs in Chromium and the file is linted
      // as Node (the convention of `scripts/fetch-assets.mjs`).
      await globalThis.document.fonts.ready;
    });
    return await page.screenshot({ type: 'png', omitBackground: transparent });
  } finally {
    await page.close();
  }
}

async function write(relative, bytes) {
  const file = path.join(ROOT, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
  const kilobytes = bytes.length / 1024;
  console.log(`[app-art] ${relative} — ${kilobytes.toFixed(0)} KB`);
  if (relative.endsWith('.png') && bytes.length > MAX_BYTES) {
    throw new Error(`${relative} is ${kilobytes.toFixed(0)} KB, over the 400 KB ceiling`);
  }
}

function manifest(shell) {
  return `${JSON.stringify(
    {
      name: APP_NAME,
      short_name: APP_NAME,
      description: APP_DESCRIPTION,
      start_url: './',
      scope: './',
      display: 'standalone',
      orientation: 'portrait',
      // The shell colour, so an installed web app and the native one open on
      // the same field of sky.
      background_color: shell,
      theme_color: shell,
      icons: [
        { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      ],
    },
    null,
    2,
  )}\n`;
}

async function main() {
  palette = JSON.parse(await readFile(PALETTE_FILE, 'utf8'));
  const shell = appBackground(await readFile(CAPACITOR_CONFIG, 'utf8'));
  const font = (await readFile(CINZEL)).toString('base64');
  console.log(`[app-art] shell colour ${shell} from capacitor.config.ts`);

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (error) {
    throw new Error("this script needs Playwright's Chromium (npm i)", { cause: error });
  }

  const executablePath = resolveChromium(chromium);
  console.log(`[app-art] chromium: ${executablePath}`);
  const browser = await chromium.launch({ executablePath, args: CHROMIUM_ARGS });

  // `[file, markup, size, options]`. Serial rather than parallel: five pages at
  // 2732 square are a gigabyte of compositor memory if they overlap.
  const pages = [
    ['assets/app/icon.png', iconSvg(1024), 1024, {}],
    ['assets/app/icon-foreground.png', iconForegroundSvg(1024), 1024, { transparent: true }],
    ['assets/app/icon-background.png', iconBackgroundSvg(1024), 1024, {}],
    ['assets/app/splash.png', splashSvg(2732, shell, { dark: false, font }), 2732, {}],
    ['assets/app/splash-dark.png', splashSvg(2732, shell, { dark: true, font }), 2732, {}],
    ['public/apple-touch-icon.png', iconSvg(180), 180, {}],
    ['public/icon-192.png', iconSvg(192), 192, {}],
    ['public/icon-512.png', iconSvg(512), 512, {}],
  ];

  try {
    for (const [file, markup, size, options] of pages) {
      await write(file, await render(browser, markup, size, options));
    }
    // The favicon is the mark itself rather than a rasterisation of it: a tab
    // icon is 16 px on one machine and 64 px on another.
    await write('public/favicon.svg', Buffer.from(`${iconSvg(64, { margin: 0.84 })}\n`, 'utf8'));
    await write('public/manifest.webmanifest', Buffer.from(manifest(shell), 'utf8'));
  } finally {
    await browser.close();
  }

  console.log('[app-art] PASS');
}

main().catch((error) => {
  console.error(`[app-art] FAIL — ${error.message}`);
  process.exitCode = 1;
});
