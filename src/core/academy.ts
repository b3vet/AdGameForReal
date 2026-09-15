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
import type { CosmeticSlot } from '@/data';
import type { WeaponId } from '@/sim';
import type { AcademyView, Overlay } from '@/ui';

import { bestiaryView } from './bestiary';
import type { BestiaryEntryView, TierAward } from './bestiary';
import { systemClock, today } from './clock';
import type { Clock } from './clock';
import { selectCosmetic, wardrobeView } from './cosmetics';
import type { WardrobeView } from './cosmetics';
import { applyRunMeta } from './meta';
import { missionBoard, rollMissions } from './missions';
import type { MissionView } from './missions';
import { streakView } from './streak';
import type { StreakView } from './streak';
import {
  addCoins,
  buyFamiliar,
  buyStaff,
  buyUpgrade,
  clonePlayer,
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
  /**
   * The device clock, for the daily streak and nothing else (D51). Injectable
   * so a test can pin the day: the whole of the streak's behaviour is about
   * which calendar day a run finished on, and a test that cannot say what day
   * it is cannot test it.
   */
  now?: Clock;
}

/** What a finished run paid, for the result sheet. */
export interface RunPayout {
  /** True when this was a walk of the endless road (D52). */
  endless: boolean;
  /** Metres walked on it; 0 on a campaign run. */
  metres: number;
  /** The endless record after this run, which `endlessBest` says it set. */
  bestMetres: number;
  /** The road's own reward (D46). */
  coins: number;
  /** What the meta layer paid on top: the streak, missions and kill tiers. */
  bonusCoins: number;
  totalCoins: number;
  firstClear: boolean;
  /** The streak after this run, and whether it advanced or reset (D51). */
  streak: StreakView;
  streakCoins: number;
  /** Missions completed by this run, already paid. */
  completed: MissionView[];
  missionCoins: number;
  /** Bestiary rungs crossed, and the tints they handed over (D53). */
  awards: TierAward[];
  tierCoins: number;
  unlocked: string[];
  /** The level's best walk after this run, and whether this run set it. */
  best: { survivors: number; peak: number } | null;
  bestImproved: boolean;
  /** True when an endless run went further than any before it (D52). */
  endlessBest: boolean;
  /** The seed of the road just walked, for "same road again". */
  seed: number;
}

export class AcademyController {
  private readonly deps: AcademyDeps;
  private readonly clock: Clock;
  private state: PlayerState;
  private screen: MenuScreen = 'home';

  constructor(deps: AcademyDeps) {
    this.deps = deps;
    this.clock = deps.now ?? systemClock;
    this.state = loadSave().player;
  }

  /** The player the run is about to be built with. */
  get player(): PlayerState {
    return this.state;
  }

  /** Today, on the device clock. The one place the meta layer reads it (D51). */
  get day(): string {
    return today(this.clock);
  }

  get menu(): MenuScreen {
    return this.screen;
  }

  /**
   * The start of a play session: the board drops whatever was finished and
   * draws replacements (D51).
   *
   * Here rather than in the constructor because it *writes* — a board that
   * rolled would otherwise roll every time anything constructed a controller,
   * including a test that only wanted to read a price.
   */
  beginSession(): void {
    const rolled = rollMissions(this.state.missions);
    if (rolled === null) return;
    const next = clonePlayer(this.state);
    next.missions = rolled;
    this.commit(next);
  }

  // --- The meta layer's views ----------------------------------------------

  /** The streak, for the title screen (D51). */
  streakView(): StreakView {
    return streakView(this.state.streak, this.day);
  }

  /** The three missions, for the board in the Academy (D51). */
  missionsView(): MissionView[] {
    return missionBoard(this.state.missions);
  }

  /** The Bestiary's cards, with their kill ladders (D53). */
  bestiaryView(): readonly BestiaryEntryView[] {
    return bestiaryView(this.state.kills, this.state.bestiary);
  }

  /** The Wardrobe: four slots of tints, owned and locked (D53). */
  wardrobeView(): WardrobeView {
    return wardrobeView(this.state);
  }

  /** A tint chip was tapped. Unowned ids and unknown slots do nothing. */
  selectCosmetic(slot: CosmeticSlot, id: string): void {
    const next = selectCosmetic(this.state, slot, id);
    if (next === null) return;
    this.commit(next);
    this.deps.audio.playPurchase();
    this.deps.overlay.showRoom('wardrobe', this.state);
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
   *
   * A lost run pays too since D46 — a share of the clear, scaled by how far up
   * the road it got — so this is called for every finished run and not only for
   * a won one. The whole `RunState` goes to `runRewards` rather than a count,
   * because where the squad stopped is half of what a loss is worth.
   */
  payRun(session: RunSession, level: number): RunPayout {
    const save = loadSave();
    // An endless run clears no level, however it ended (D52): it has no index,
    // so it can neither be a first clear nor mark one.
    const endless = session.isEndless;
    const paidLevel = endless ? 0 : level;
    const firstClear = !endless && session.won && isFirstClear(save, level);
    // `bestLevel` is what caps an endless run's pay (D52) and is ignored on a
    // campaign road, so it is passed either way rather than branched on.
    const { coins } = runRewards(session.state, paidLevel, firstClear, {
      bestLevel: bestClearedLevel(save.player),
    });

    let player = addCoins(save.player, coins);
    const remembered = rememberSeen(player, session.seen);
    if (remembered !== null) player = remembered;

    // The meta layer, on the same finished run and in the same commit: the
    // streak for the day, the missions it moved, the bestiary rungs it crossed
    // and the level's best walk (D51 to D53). It is paid *after* the road so
    // that a mission reward can never change what clearing a level is worth.
    const meta = applyRunMeta(player, { level: paidLevel, tally: session.tally() }, this.day);
    this.commit(meta.player);
    if (firstClear) markFirstClear(level);

    return {
      endless,
      metres: Math.floor(session.metres),
      bestMetres: this.state.endless.bestMetres,
      coins,
      bonusCoins: meta.coins,
      totalCoins: this.state.coins,
      firstClear,
      streak: this.streakView(),
      streakCoins: meta.streakCoins,
      completed: meta.completed,
      missionCoins: meta.missionCoins,
      awards: meta.awards,
      tierCoins: meta.tierCoins,
      unlocked: meta.unlocked,
      best: meta.levelBest,
      bestImproved: meta.bestImproved,
      endlessBest: meta.endlessBest,
      seed: session.seed,
    };
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
      selectedStaff: this.state.selectedStaff,
      streak: this.streakView(),
      missions: this.missionsView(),
      endlessBest: Math.max(0, Math.floor(this.state.endless.bestMetres)),
      stars: starredLevels(this.state),
    };
  }

  /** The one place a new `PlayerState` reaches storage. */
  private commit(player: PlayerState): void {
    this.state = setPlayer(player).player;
    this.deps.onPlayerChanged();
  }
}

/**
 * The highest campaign level this player has actually *cleared* — the ceiling
 * an endless run is paid under (D52).
 *
 * Read off `levelBest`, which is only written on a cleared level (`./meta.ts`),
 * rather than off `unlockedLevel`: a save carried forward from before D52 has
 * an unlock but no bests, so the unlock minus one is the floor under it. Both
 * are held at 1, because a player who has cleared nothing still walks a road
 * that has to pay something.
 */
export function bestClearedLevel(player: PlayerState): number {
  let best = Math.max(1, Math.floor(player.unlockedLevel) - 1);
  for (const key of Object.keys(player.levelBest)) {
    const level = Number.parseInt(key, 10);
    if (Number.isFinite(level) && level > best) best = level;
  }
  return best;
}

/**
 * Levels whose best walk arrived with at least `STAR_SHARE` of the crowd the
 * run ever held — the picker's star (D45's own band: a good player ends with 35
 * to 65 percent of peak, so the star is the top of it).
 */
const STAR_SHARE = 0.6;

function starredLevels(player: PlayerState): readonly number[] {
  const stars: number[] = [];
  for (const key of Object.keys(player.levelBest)) {
    const best = player.levelBest[key];
    const level = Number.parseInt(key, 10);
    if (best === undefined || !Number.isFinite(level)) continue;
    if (best.peak > 0 && best.survivors >= best.peak * STAR_SHARE) stars.push(level);
  }
  return stars;
}
