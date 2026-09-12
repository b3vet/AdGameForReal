/**
 * The Academy, on the app's side of the overlay (decision D33): who the player
 * is, which menu is up, what a purchase costs them, and what a finished run
 * pays.
 *
 * Split out of `App` so the state machine stays a state machine: everything
 * here is about the meta layer and nothing here knows about the renderer, the
 * frame loop or physics. `App` owns the three phases and the scene behind the
 * menus, and calls in here for the rest.
 *
 * The rules themselves are `./player.ts` (pure) and the storage is `./save.ts`;
 * this is the controller that puts the two together and repaints the screen.
 */

import type { GameAudio } from '@/audio';
import type { WeaponId } from '@/sim';
import type { AcademyView, Overlay } from '@/ui';

import {
  addCoins,
  buyFamiliar,
  buyStaff,
  buyUpgrade,
  rememberSeen,
  roomIds,
  roomUnlockLevel,
  runRewards,
  selectStaff,
  upgradeIds,
} from './player';
import type { PlayerState, RoomId } from './player';
import {
  isFirstClear,
  loadSave,
  markFirstClear,
  markRoomRevealed,
  mergePlayer,
  setPlayer,
} from './save';
import type { RunSession } from './session';

/** Which Academy screen is up. `home` is the one with the cards. */
export type MenuScreen = 'home' | 'levels' | RoomId;

export interface AcademyDeps {
  overlay: Overlay;
  audio: GameAudio;
  /** How many levels the picker offers. */
  levelCount: number;
  /** The player's coins or upgrades changed, so the backdrop is stale. */
  onPlayerChanged: () => void;
}

/** What a finished run paid, for the result sheet. */
export interface RunPayout {
  coins: number;
  totalCoins: number;
  firstClear: boolean;
}

export class AcademyController {
  private readonly deps: AcademyDeps;
  private state: PlayerState;
  private screen: MenuScreen = 'home';

  constructor(deps: AcademyDeps) {
    this.deps = deps;
    this.state = loadSave().player;
  }

  /** The player the run is about to be built with. */
  get player(): PlayerState {
    return this.state;
  }

  get menu(): MenuScreen {
    return this.screen;
  }

  /**
   * The home screen. Any room whose level has just been reached plays its
   * reveal here, once ever: the save is written before the animation is asked
   * for, so a reload mid-animation does not owe it again.
   */
  showHome(selectedLevel: number): void {
    this.screen = 'home';
    const save = loadSave();
    this.state = save.player;

    const reveal: RoomId[] = [];
    for (const room of roomIds) {
      if (room === 'play' || save.revealedRooms.includes(room)) continue;
      if (this.state.unlockedLevel >= roomUnlockLevel(room)) reveal.push(room);
    }
    for (const room of reveal) markRoomRevealed(room);
    if (reveal.length > 0) this.deps.audio.playRoomReveal();

    this.deps.overlay.showAcademy(this.view(selectedLevel, reveal));
  }

  /** The level picker, behind the home's Play card. */
  showLevels(selectedLevel: number): void {
    this.screen = 'levels';
    this.deps.overlay.showLevels(this.view(selectedLevel));
  }

  /** A room card was tapped. `play` is the picker and is the app's business. */
  openRoom(room: Exclude<RoomId, 'play'>): void {
    // The card is disabled while the room is shut, so this is belt and braces
    // for a tap that arrives through the debug handle or a stale frame.
    if (this.state.unlockedLevel < roomUnlockLevel(room)) return;
    this.screen = room;
    this.deps.overlay.showRoom(room, this.state);
  }

  /**
   * Re-paints the menu that is up without touching the scene behind it. The
   * home is the app's to re-show, because its backdrop is a level.
   */
  repaint(selectedLevel: number): void {
    if (this.screen === 'home') return;
    if (this.screen === 'levels') this.showLevels(selectedLevel);
    else this.deps.overlay.showRoom(this.screen, this.state);
  }

  // --- The purse -----------------------------------------------------------

  /**
   * One shape for every purchase: ask `./player.ts` what the new state would
   * be, and do nothing at all when the answer is null. A dead button is the
   * normal way that happens — the room disables what cannot be afforded — so
   * this is the guard against a stale screen, not an error path.
   */
  buyUpgrade(rawId: string): void {
    const id = upgradeIds.find((known) => known === rawId);
    if (id === undefined) return;
    const next = buyUpgrade(this.state, id);
    if (next === null) return;
    this.commit(next);
    this.deps.audio.playPurchase();
    this.deps.overlay.showRoom('yard', this.state, { kind: 'upgrade', id });
  }

  buyStaff(id: WeaponId): void {
    const wasLocked = !this.state.staffs[id].unlocked;
    const next = buyStaff(this.state, id);
    if (next === null) return;
    this.commit(next);
    // A staff changing hands is a bigger moment than one more level of a
    // drill, and it gets the heavier clip.
    if (wasLocked) this.deps.audio.playUnlock();
    else this.deps.audio.playPurchase();
    this.deps.overlay.showRoom('workbench', this.state, { kind: 'staff', id });
  }

  selectStaff(id: WeaponId): void {
    const next = selectStaff(this.state, id);
    if (next === null) return;
    this.commit(next);
    this.deps.overlay.showRoom('workbench', this.state, { kind: 'staff', id });
  }

  buyFamiliar(): void {
    const wasBound = this.state.familiar.unlocked;
    const next = buyFamiliar(this.state);
    if (next === null) return;
    this.commit(next);
    if (wasBound) this.deps.audio.playPurchase();
    else this.deps.audio.playUnlock();
    this.deps.overlay.showRoom('sanctum', this.state, { kind: 'familiar' });
  }

  /**
   * Pays a finished run and records what it met.
   *
   * The first-clear flag is read before the level is marked, and the level is
   * only marked once the coins for it have been counted — so the bonus is paid
   * exactly once however the run ended. `RunSession.advanceEnding` has already
   * written the unlock by the time this runs, which is why the save is re-read
   * rather than assumed.
   */
  payRun(session: RunSession, level: number): RunPayout {
    const save = loadSave();
    const firstClear = session.won && isFirstClear(save, level);
    const { coins } = runRewards(session.state, level, firstClear);

    let player = addCoins(save.player, coins);
    const remembered = rememberSeen(player, session.seen);
    if (remembered !== null) player = remembered;
    this.commit(player);
    if (session.won) markFirstClear(level);

    return { coins, totalCoins: this.state.coins, firstClear };
  }

  /** The debug handle's writable player; every field is validated on the way in. */
  setPlayer(patch: unknown): void {
    this.commit(mergePlayer(this.state, patch));
  }

  private view(selectedLevel: number, reveal: readonly RoomId[] = []): AcademyView {
    return {
      coins: this.state.coins,
      unlockedLevel: Math.min(this.deps.levelCount, this.state.unlockedLevel),
      levelCount: this.deps.levelCount,
      selectedLevel,
      reveal,
    };
  }

  /** The one place a new `PlayerState` reaches storage. */
  private commit(player: PlayerState): void {
    this.state = setPlayer(player).player;
    this.deps.onPlayerChanged();
  }
}
