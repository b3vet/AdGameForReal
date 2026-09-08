/**
 * Game audio (Milestone 2, Phase B4).
 *
 * Owner: app agent. `src/core/App.ts` is the only caller.
 *
 *   const audio = new GameAudio({ muted: save.muted });
 *   void audio.load();            // engine plus every clip, in the background
 *   audio.unlock();               // from inside the Play tap, never before
 *   audio.onEvents(events, state);
 */

export { GameAudio } from './GameAudio';
export type { AudioStatus } from './GameAudio';
