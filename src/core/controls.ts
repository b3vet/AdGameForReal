/**
 * What the overlay's buttons ask of the app.
 *
 * Split out of `App` in Milestone 4 Phase D, for the file-size rule and because
 * it is the one part of that file with no state in it at all: a list of
 * callbacks that each turn a tap into one call. Keeping it here leaves `App` reading as a
 * state machine, and leaves the wiring somewhere it can be checked against
 * `OverlayCallbacks` in one screenful.
 *
 * `App` implements `AppCommands`, and the callbacks read it lazily — they are
 * built inside `App`'s own constructor, before every field of it exists.
 */

import type { GameAudio } from '@/audio';
import type { CosmeticSlot } from '@/data';
import type { OverlayCallbacks } from '@/ui';

import type { AcademyController } from './academy';
import type { RunPause } from './pause';
import { endlessOpen } from './player';
import type { RoomId } from './player';

/** The app, as a tap sees it. */
export interface AppCommands {
  readonly audio: GameAudio;
  /** The meta layer: purchases go straight through (`./academy.ts`). */
  readonly academy: AcademyController;
  /**
   * The pause menu (docs/27): the button, Resume, Restart and Home go straight
   * through, and each is a no-op when there is nothing to do (`./pause.ts`).
   */
  readonly pause: RunPause;
  /** Play: start the road the picker is pointed at. */
  startRun(): void;
  /**
   * Retry on the result sheet: the road just walked, on the seed it was walked
   * on. It has to know the *mode* rather than the level, because the endless
   * road has none (D52).
   */
  retryRun(): void;
  /** The picker's Endless card: a walk of the road with no end (D52). */
  startEndless(seed?: number | null): void;
  /** Continue: the level after this one. */
  nextLevel(): void;
  selectLevel(level: number): void;
  /** A card on the home screen; `play` opens the picker. */
  openRoom(room: RoomId): void;
  /** Back, from the picker or a room, and Home on the result sheet. */
  showHome(): void;
  toggleMute(): void;
  toggleDebug(): void;
}

export function overlayCallbacks(app: AppCommands): OverlayCallbacks {
  return {
    onPlay: () => {
      app.startRun();
    },
    onRetry: () => {
      app.retryRun();
    },
    onNext: () => {
      app.nextLevel();
    },
    onSelectLevel: (level: number) => {
      app.selectLevel(level);
    },
    onOpenRoom: (room: RoomId) => {
      app.openRoom(room);
    },
    onCloseRoom: () => {
      app.showHome();
    },
    onResultHome: () => {
      app.showHome();
    },
    onTap: () => {
      // Every button is a user gesture, which is the only moment a browser lets
      // an audio context start. Play is the one the plan names; the others cost
      // nothing once it is already running.
      app.audio.unlock();
      app.audio.playTap();
    },
    onToggleMute: () => {
      app.toggleMute();
    },
    onToggleDebug: () => {
      app.toggleDebug();
    },
    onCountTick: () => {
      app.audio.playTick();
    },
    onCoinTick: () => {
      app.audio.playCoinTick();
    },
    onBuyUpgrade: (id: string) => {
      app.academy.buyUpgrade(id);
    },
    onBuyStaff: (id) => {
      app.academy.buyStaff(id);
    },
    onSelectStaff: (id) => {
      app.academy.selectStaff(id);
    },
    onBuyFamiliar: () => {
      app.academy.buyFamiliar();
    },
    onSelectCosmetic: (slot: CosmeticSlot, id: string) => {
      app.academy.selectCosmetic(slot, id);
    },
    onEndless: () => {
      // The card is disabled until the player reaches its level (docs/28), so
      // this is belt and braces for a tap on a stale frame, as `openRoom` has.
      // Only the tap is gated: the debug handle and `?endless=1` call the app.
      if (!endlessOpen(app.academy.player)) return;
      app.startEndless();
    },
    onPause: () => {
      app.pause.pause();
    },
    onResume: () => {
      app.pause.resume();
    },
    onRestart: () => {
      app.pause.restart();
    },
    onHome: () => {
      app.pause.home();
    },
  };
}
