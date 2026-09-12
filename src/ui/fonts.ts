/**
 * Boot-time loading of the display faces (decision D30).
 *
 * `font-display: swap` is enough for the overlay — a heading that arrives one
 * frame late is a heading that arrived. The renderer is not so relaxed: the
 * digit atlas rasterises Cinzel glyphs into a texture *once* (plan, performance
 * item 1), and if it does that before the face is ready it bakes the fallback
 * serif into every gate number for the rest of the run. So the faces are asked
 * for explicitly here and `fontsReady` is the promise the atlas waits on.
 *
 * A `<link rel="preload">` would be the usual answer and is not available to
 * us: the single-file builds turn these into `data:` URIs inside the stylesheet
 * (`scripts/inline-assets.mjs`), and there is no URL left to preload.
 *
 * `./styles.css` is imported here, not merely assumed: `document.fonts.load`
 * matches against the `@font-face` rules the document has *already* parsed, so
 * asking before the stylesheet exists resolves instantly with nothing loaded.
 * The import is what guarantees the rules are in by the time the call is made.
 */

import './styles.css';
// The screens' own controls, after the layout and the tokens they use.
import './screens.css';
// The Academy's purse and cards, then the rooms behind them (D33).
import './academy.css';
import './rooms.css';

/** CSS `font` shorthands, one per face `styles.css` declares. */
const DISPLAY_FACES = ['700 40px Cinzel', '900 40px Cinzel'] as const;
const BODY_FACES = ['400 16px Nunito', '700 16px Nunito'] as const;

/**
 * The glyphs that have to be in the face before the atlas bakes: the digits and
 * the separators every in-world number is made of. Passing them explicitly also
 * documents what the atlas needs, should the subset ever be narrowed further.
 */
const ATLAS_GLYPHS = '0123456789+-×/%';

function load(face: string, text: string): Promise<unknown> {
  // `document.fonts` is missing on nothing we support, but a renderer smoke run
  // in a stripped environment should degrade to the fallback, not throw.
  if (typeof document === 'undefined' || document.fonts === undefined) {
    return Promise.resolve();
  }
  return document.fonts.load(face, text);
}

/**
 * Resolves once both Cinzel weights are usable — or once they have failed, which
 * is the same thing as far as the atlas is concerned: it has to bake *something*
 * and the fallback serif is what it gets. A rejected promise here would only
 * strand the caller.
 */
async function loadDisplayFonts(): Promise<void> {
  // Body text is requested at the same time but not awaited: `swap` handles a
  // late arrival on a paragraph, and nothing downstream is blocked on it.
  for (const face of BODY_FACES) void load(face, 'Survivors Peak').catch(() => undefined);

  try {
    await Promise.all(DISPLAY_FACES.map((face) => load(face, ATLAS_GLYPHS)));
  } catch (error) {
    console.warn('[arcane-rush] display font did not load; falling back', error);
  }
}

/**
 * Settles when the display faces are ready. Started on import, so the request
 * is in flight from the first module evaluation rather than from the first
 * `await`.
 */
export const fontsReady: Promise<void> = loadDisplayFonts();
