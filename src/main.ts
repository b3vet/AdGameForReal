/**
 * Boot. Everything past this point is the `App` state machine.
 */

import { App } from '@/core/App';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
const overlayRoot = document.querySelector<HTMLElement>('#overlay-root');

if (canvas === null || overlayRoot === null) {
  throw new Error('index.html is missing #game-canvas or #overlay-root');
}

const app = new App(canvas, overlayRoot, window.location.search);

app.start().catch((error: unknown) => {
  console.error('[arcane-rush] failed to start', error);
});
