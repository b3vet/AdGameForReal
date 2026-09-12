/**
 * The `title` phase: the Academy's screens and the road they stand on.
 *
 * Split out of `App` in Milestone 4 Phase D, for the file-size rule and because
 * the two halves answer different questions. `App` is the state machine — which
 * of `title | playing | result` is up — and this is everything that happens
 * *inside* `title`: which Academy screen the player is looking at, which level
 * the Play card is pointed at, and the never-ticked run behind the cards that
 * makes the home screen a place rather than a menu.
 *
 * The backdrop is the part worth reading twice. It is a real `RunSession` built
 * with the real `PlayerState`, so the crowd carries the chosen staff and the
 * wisp is beside it without anything here knowing what a staff or a wisp is
 * (`src/render/preview.ts`). It is rebuilt only when it is actually stale — a
 * different level, or a purchase — because every Back tap would otherwise cost
 * a generated level plus a renderer and physics reload for a picture that has
 * not changed.
 */

import { levelCount } from '@/data';
import type { PhysicsLayer } from '@/physics';
import type { Renderer } from '@/render/Renderer';

import type { AcademyController } from './academy';
import { NO_EVENTS } from './frame';
import type { RoomId } from './player';
import { clampLevel } from './query';
import type { QueryOptions } from './query';
import { RunSession } from './session';

export interface MenuDeps {
  renderer: Renderer;
  academy: AcademyController;
  /** Shared with `App`: `level` is which level the Play card is pointed at. */
  options: QueryOptions;
  physics: () => PhysicsLayer | null;
  /** The backdrop changed, so the frame loop owes it a draw (`./frame.ts`). */
  markDirty: () => void;
}

export class MenuStage {
  private readonly deps: MenuDeps;

  /** A never-ticked session whose level and state back the Academy screens. */
  private preview: RunSession | null = null;
  /** Which level the standing preview was built for; 0 when there is none. */
  private previewLevel = 0;

  constructor(deps: MenuDeps) {
    this.deps = deps;
  }

  /** The backdrop session, for the frame loop and the physics layer. */
  get session(): RunSession | null {
    return this.preview;
  }

  /** The Academy home, over a fresh backdrop of the selected level. */
  showHome(): void {
    this.loadPreview();
    this.deps.academy.showHome(this.deps.options.level);
  }

  /** The level picker, behind the home's Play card. */
  showLevels(): void {
    this.deps.academy.showLevels(this.deps.options.level);
  }

  /** A card was tapped: `play` is the picker, the rest are rooms. */
  openRoom(room: RoomId): void {
    if (room === 'play') this.showLevels();
    else this.deps.academy.openRoom(room);
  }

  selectLevel(level: number): void {
    this.deps.options.level = clampLevel(level, levelCount);
    // The backdrop is the level the player is about to walk, so it changes
    // with the chip rather than only when Play is tapped.
    this.loadPreview();
    this.showLevels();
  }

  /**
   * Re-paints whatever screen is up after a debug injection. The home is this
   * class's to re-show rather than the controller's, because its backdrop is a
   * generated level and a new player means a new one.
   */
  repaint(): void {
    if (this.deps.academy.menu === 'home') this.showHome();
    else this.deps.academy.repaint(this.deps.options.level);
  }

  /**
   * A run is starting: the camera stops drifting, the wisp goes back to being
   * the run's own rather than the Academy's stand-in, and the next Academy
   * screen draws a fresh backdrop whatever happens.
   */
  end(): void {
    this.deps.renderer.setPreviewPlayer(null);
    this.deps.markDirty();
    this.preview = null;
    this.previewLevel = 0;
  }

  /** A purchase changed the player, so the standing backdrop is stale. */
  invalidate(): void {
    this.previewLevel = 0;
  }

  private loadPreview(): void {
    // Before the early return and before the frame is marked dirty: this is
    // what puts the chosen staff and the owned wisp on the backdrop and starts
    // the camera's drift (`src/render/preview.ts`). A standing preview that is
    // re-shown still needs it, because `end` cleared it.
    this.deps.renderer.setPreviewPlayer(this.deps.academy.player);
    if (this.preview !== null && this.previewLevel === this.deps.options.level) return;

    const preview = new RunSession(
      this.deps.options.level,
      this.deps.options,
      this.deps.academy.player,
    );
    this.preview = preview;
    this.previewLevel = this.deps.options.level;
    this.deps.renderer.loadLevel(preview.level);
    this.deps.physics()?.loadLevel(preview.level);
    this.deps.renderer.update(preview.state, NO_EVENTS, 0);
    this.deps.markDirty();
  }
}
