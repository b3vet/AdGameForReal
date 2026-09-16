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
 * The level is worked out each time the picker opens rather than remembered
 * (docs/29): the newest level the player has unlocked, whichever way they came
 * back — a clear left by Home, a loss, a walk through the rooms, a fresh boot.
 * A chip tap points Play somewhere else for that visit to the picker only; the
 * level a finished run replays or continues from is the run's own
 * (`RunStage.level`), so nothing here has to follow the road. The home's
 * backdrop follows the same rule, because it is the road Play is about to
 * offer: after a clear it is the level that clear opened, and after level 20 it
 * is already Frostfell.
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
  /**
   * The URL's: the seed and the bot the backdrop is built with, and `level`,
   * which pins the picker for the page's life when the URL names one (the
   * smoke boots a fresh save on `?level=23` and walks it through Play).
   */
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
  /**
   * A chip tapped on the picker that is up, or null. Dropped whenever the
   * picker opens and whenever the home does, so it lasts one visit.
   */
  private chosen: number | null = null;

  constructor(deps: MenuDeps) {
    this.deps = deps;
  }

  /** The backdrop session, for the frame loop and the physics layer. */
  get session(): RunSession | null {
    return this.preview;
  }

  /**
   * The level Play starts: the chip tapped on this visit to the picker, or
   * else the newest level. Read when Play is tapped, never stored anywhere.
   */
  get playLevel(): number {
    return this.chosen ?? this.newestLevel();
  }

  /** The Academy home, over a fresh backdrop of the newest level. */
  showHome(): void {
    this.chosen = null;
    // The save before the level: a won run writes its unlock straight to
    // storage (`RunSession.advanceEnding`), and the newest level is read off
    // the player that comes back.
    this.deps.academy.reload();
    this.loadPreview();
    this.deps.academy.showHome(this.playLevel);
  }

  /** A card was tapped: `play` is the picker, the rest are rooms. */
  openRoom(room: RoomId): void {
    if (room === 'play') this.openPicker();
    else this.deps.academy.openRoom(room);
  }

  selectLevel(level: number): void {
    this.chosen = clampLevel(level, levelCount);
    // The backdrop is the level the player is about to walk, so it changes
    // with the chip rather than only when Play is tapped.
    this.loadPreview();
    this.deps.academy.showLevels(this.playLevel);
  }

  /**
   * Re-paints whatever screen is up after a debug injection. The home is this
   * class's to re-show rather than the controller's, because its backdrop is a
   * generated level and a new player means a new one.
   */
  repaint(): void {
    const menu = this.deps.academy.menu;
    if (menu === 'home') {
      this.showHome();
      return;
    }
    // An injected unlock moves the newest level, and the picker's backdrop
    // with it.
    if (menu === 'levels') this.loadPreview();
    this.deps.academy.repaint(this.playLevel);
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

  /**
   * The picker, opened from the home: on the newest level every time
   * (docs/29), whatever chip the last visit left pressed.
   */
  private openPicker(): void {
    this.chosen = null;
    this.loadPreview();
    this.deps.academy.showLevels(this.playLevel);
  }

  /**
   * The level the picker opens on: the URL's, when it names one, or else the
   * highest the player has unlocked, inside the campaign.
   */
  private newestLevel(): number {
    return (
      this.deps.options.level ?? clampLevel(this.deps.academy.player.unlockedLevel, levelCount)
    );
  }

  private loadPreview(): void {
    // Before the early return and before the frame is marked dirty: this is
    // what puts the chosen staff and the owned wisp on the backdrop and starts
    // the camera's drift (`src/render/preview.ts`). A standing preview that is
    // re-shown still needs it, because `end` cleared it.
    this.deps.renderer.setPreviewPlayer(this.deps.academy.player);
    const level = this.playLevel;
    if (this.preview !== null && this.previewLevel === level) return;

    const preview = new RunSession(level, this.deps.options, this.deps.academy.player);
    this.preview = preview;
    this.previewLevel = level;
    this.deps.renderer.loadLevel(preview.level);
    this.deps.physics()?.loadLevel(preview.level);
    this.deps.renderer.update(preview.state, NO_EVENTS, 0);
    this.deps.markDirty();
  }
}
