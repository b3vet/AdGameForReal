// `./fonts` is first so the display faces are requested — and `./styles.css`
// with its `@font-face` rules is in the document — before anything else here
// evaluates. `fontsReady` is what the renderer's digit atlas waits on.
export { fontsReady } from './fonts';
export { Overlay } from './overlay';
export type { AcademyView, OverlayCallbacks, ResultBonus, ResultView, RoomBump } from './overlay';
export type { DebugStats } from './debugStats';
export type { ReportSource } from './debug';
// The device report quotes a capture's numbers in its own layout
// (`src/core/report.ts`), so the shape crosses out of `src/ui`.
export type { CaptureSummary, Spread } from './capture';
export { MAX_CAPTURE_SECONDS } from './capture';
