/**
 * What the overlay's buttons ask of the app.
 *
 * Split out of `App` in Milestone 4 Phase D, for the file-size rule and because
 * it is the one part of that file with no state in it at all: sixteen callbacks
 * that each turn a tap into one call. Keeping it here leaves `App` reading as a
 * state machine, and leaves the wiring somewhere it can be checked against
 * `OverlayCallbacks` in one screenful.
 *
 * `App` implements `AppCommands`, and the callbacks read it lazily — they are
 * built inside `App`'s own constructor, before every field of it exists.
 */

import type { GameAudio } from '@/audio';
import type { OverlayCallbacks } from '@/ui';

import type { AcademyController } from './academy';
import type { RoomId } from './player';

/** The app, as a tap sees it. */
export interface AppCommands {
  readonly audio: GameAudio;
  /** The meta layer: purchases go straight through (`./academy.ts`). */
  readonly academy: AcademyController;
  /** Play, or Again: start the selected level. */
  startRun(): void;
  /** Ascend: the level after this one. */
  nextLevel(): void;
  selectLevel(level: number): void;
  /** A card on the home screen; `play` opens the picker. */
  openRoom(room: RoomId): void;
  /** Back, from the picker or a room, and "Academy" on the result sheet. */
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
      app.startRun();
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
    onLevels: () => {
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
  };
}
