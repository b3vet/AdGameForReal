// `./fonts` is first so the display faces are requested — and `./styles.css`
// with its `@font-face` rules is in the document — before anything else here
// evaluates. `fontsReady` is what the renderer's digit atlas waits on.
export { fontsReady } from './fonts';
export { Overlay } from './overlay';
export type { OverlayCallbacks, ResultView, TitleView } from './overlay';
export type { DebugStats } from './debug';
