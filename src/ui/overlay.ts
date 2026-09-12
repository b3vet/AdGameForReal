/**
 * The HTML overlay. Markup lives in `index.html`; this module binds to it and
 * owns nothing else — the `App` state machine decides *when* each screen shows,
 * the overlay only knows *how*.
 *
 * Five screens: the Academy home (`#title-screen`), the level picker
 * (`#levels-screen`), the rooms (`#room-screen`), the HUD and the result sheet.
 * Three of them are delegated — `./academy.ts` owns the home and the picker,
 * `./rooms.ts` the four rooms, `./result.ts` the result numbers — so this file
 * stays what it has always been: which screen is up, and one place where every
 * listener is added and removed.
 *
 * Element ids are a contract with `scripts/smoke-run.mjs`, which clicks
 * `#academy-play` and then `#play-button` — do not rename either without
 * updating the smoke test.
 *
 * Every listener this class adds goes through one `AbortController`, so
 * `dispose` takes them all off in one call and a re-created app never ends up
 * with two overlays fighting over the same buttons.
 */

import './styles.css';
// Imported for the effect, not the value: it starts the display faces loading
// at boot (see `./fonts`), which the overlay itself only benefits from.
import './fonts';

import type { PlayerState, RoomId } from '@/core/player';
import type { RunState, SimEvent, WeaponId } from '@/sim';

import { Academy } from './academy';
import type { AcademyView } from './academy';
import { Confetti } from './confetti';
import { DebugPanel } from './debug';
import type { DebugStats } from './debug';
import { Hud } from './hud';
import { ResultPanel } from './result';
import type { ResultView } from './result';
import { Rooms } from './rooms';
import type { RoomBump } from './rooms';
import { watchTripleTap } from './taps';

export interface OverlayCallbacks {
  onPlay: () => void;
  onRetry: () => void;
  onNext: () => void;
  /** A level picker chip was tapped. The app decides whether to accept it. */
  onSelectLevel: (level: number) => void;
  /** An Academy card: `play` opens the picker, the rest open a room. */
  onOpenRoom: (room: RoomId) => void;
  /** Back, from the picker or from a room. */
  onCloseRoom: () => void;
  /** "Academy" on the result screen: back to the home and its cards. */
  onLevels: () => void;
  /** Any button at all, for the tap sound. Fires before the button's own call. */
  onTap: () => void;
  /** The mute control was used. The app owns the flag and calls `setMuted`. */
  onToggleMute: () => void;
  /**
   * The wordmark or the level chip was triple-tapped. The app flips the debug
   * panel and writes the choice to the save.
   */
  onToggleDebug: () => void;
  /** One step of the result screen's count-up, for its tick sound. */
  onCountTick: () => void;
  /** One step of the coin count-up; a brighter tick. */
  onCoinTick: () => void;
  /** A Buy button. The app owns the purse and decides whether it happens. */
  onBuyUpgrade: (id: string) => void;
  onBuyStaff: (id: WeaponId) => void;
  onSelectStaff: (id: WeaponId) => void;
  onBuyFamiliar: () => void;
}

export type { AcademyView, ResultView, RoomBump };

export class Overlay {
  private readonly academyScreen: HTMLElement;
  private readonly levelsScreen: HTMLElement;
  private readonly roomScreen: HTMLElement;
  private readonly hudRoot: HTMLElement;
  private readonly result: HTMLElement;
  private readonly muteButtons: HTMLButtonElement[];

  private readonly academy: Academy;
  private readonly rooms: Rooms;
  private readonly resultPanel: ResultPanel;
  private readonly hud: Hud;
  private readonly debugPanel: DebugPanel;
  private readonly confetti: Confetti;

  private readonly callbacks: OverlayCallbacks;
  private readonly listeners = new AbortController();

  constructor(root: ParentNode, callbacks: OverlayCallbacks) {
    this.callbacks = callbacks;
    this.academyScreen = requireElement(root, '#title-screen');
    this.levelsScreen = requireElement(root, '#levels-screen');
    this.roomScreen = requireElement(root, '#room-screen');
    this.hudRoot = requireElement(root, '#hud');
    this.result = requireElement(root, '#result-screen');
    this.muteButtons = [
      requireElement<HTMLButtonElement>(root, '#mute-title'),
      requireElement<HTMLButtonElement>(root, '#mute-hud'),
    ];

    const bind = (button: HTMLButtonElement, action: () => void): void => {
      this.onTap(button, action);
    };

    this.academy = new Academy(
      {
        cards: requireElement(root, '#academy-cards'),
        coinValue: requireElement(root, '#academy-coin-value'),
        picker: requireElement(root, '#level-picker'),
        caption: requireElement(root, '#picker-caption'),
        pager: requireElement(root, '#picker-pages'),
      },
      {
        onOpenRoom: callbacks.onOpenRoom,
        onSelectLevel: callbacks.onSelectLevel,
      },
      bind,
    );

    this.rooms = new Rooms(
      {
        title: requireElement(root, '#room-title'),
        subtitle: requireElement(root, '#room-subtitle'),
        coinValue: requireElement(root, '#room-coin-value'),
        yard: requireElement(root, '#yard-rows'),
        workbench: requireElement(root, '#workbench-cards'),
        sanctum: requireElement(root, '#sanctum-card'),
        bestiary: requireElement(root, '#bestiary-cards'),
      },
      {
        onBuyUpgrade: callbacks.onBuyUpgrade,
        onBuyStaff: callbacks.onBuyStaff,
        onSelectStaff: callbacks.onSelectStaff,
        onBuyFamiliar: callbacks.onBuyFamiliar,
      },
      bind,
    );

    this.resultPanel = new ResultPanel(
      {
        kicker: requireElement(root, '#result-kicker'),
        title: requireElement(root, '#result-title'),
        badge: requireElement(root, '#result-first-clear'),
        survivors: requireElement(root, '#result-survivors'),
        peak: requireElement(root, '#result-peak'),
        coins: requireElement(root, '#result-coins'),
        total: requireElement(root, '#result-total'),
        next: requireElement<HTMLButtonElement>(root, '#next-button'),
        levels: requireElement<HTMLButtonElement>(root, '#levels-button'),
      },
      { onCountTick: callbacks.onCountTick, onCoinTick: callbacks.onCoinTick },
    );

    this.hud = new Hud({
      levelLabel: requireElement(root, '#hud-level'),
      count: requireElement(root, '#hud-count'),
      staffBadge: requireElement(root, '#hud-staff'),
      bossBar: requireElement(root, '#boss-bar'),
      bossFill: requireElement(root, '#boss-bar-fill'),
      bossValue: requireElement(root, '#boss-bar-value'),
      bossLabel: requireElement(root, '#boss-bar-label'),
    });
    this.debugPanel = new DebugPanel(
      {
        root: requireElement(root, '#debug-panel'),
        text: requireElement(root, '#debug-text'),
        summary: requireElement(root, '#debug-capture'),
        button: requireElement<HTMLButtonElement>(root, '#debug-capture-button'),
      },
      this.listeners.signal,
    );
    this.confetti = new Confetti(requireElement<HTMLCanvasElement>(root, '#confetti'));

    // The hosted playtest wrapper may not pass `?debug` through, so the panel
    // needs a way in from inside the game. Hit-tested rather than bound to the
    // elements, so a drag that starts on the chip still steers (`./taps.ts`).
    // The room heading is a target too: only one of the three is ever on screen
    // (a hidden element measures zero and is skipped), and without it the
    // gesture is unreachable from the four Academy rooms.
    watchTripleTap(
      [
        requireElement(root, '#title-wordmark'),
        requireElement(root, '#hud-level'),
        requireElement(root, '#room-title'),
      ],
      () => {
        callbacks.onToggleDebug();
      },
      this.listeners.signal,
    );

    this.onTap(requireElement<HTMLButtonElement>(root, '#play-button'), callbacks.onPlay);
    this.onTap(requireElement<HTMLButtonElement>(root, '#retry-button'), callbacks.onRetry);
    this.onTap(requireElement<HTMLButtonElement>(root, '#next-button'), callbacks.onNext);
    this.onTap(requireElement<HTMLButtonElement>(root, '#levels-button'), callbacks.onLevels);
    this.onTap(requireElement<HTMLButtonElement>(root, '#levels-back'), callbacks.onCloseRoom);
    this.onTap(requireElement<HTMLButtonElement>(root, '#room-back'), callbacks.onCloseRoom);
    for (const button of this.muteButtons) this.onTap(button, callbacks.onToggleMute);
  }

  /** The Academy home: the purse, the five cards, and any reveal owed. */
  showAcademy(view: AcademyView): void {
    this.academy.showHome(view);
    this.showOnly(this.academyScreen);
  }

  /** The level picker behind the Play card. */
  showLevels(view: AcademyView): void {
    this.academy.showLevels(view);
    this.showOnly(this.levelsScreen);
  }

  /** One of the four rooms, painted from the player's state. */
  showRoom(room: RoomId, player: PlayerState, bump: RoomBump | null = null): void {
    this.rooms.show(room, player, bump);
    this.academy.setCoins(player.coins);
    this.showOnly(this.roomScreen);
  }

  showPlaying(levelIndex: number, staff: WeaponId): void {
    this.hud.begin(levelIndex, staff);
    this.showOnly(this.hudRoot);
  }

  showResult(view: ResultView): void {
    // The switch first, the numbers second: `showOnly` stops whatever the last
    // screen was animating, and that includes this screen's own count-up.
    this.showOnly(this.result);
    this.resultPanel.show(view);
    if (view.won) this.confetti.burst();
  }

  /** `?scene=render-test` and `?scene=stress` show the raw scene, no overlay. */
  hideAll(): void {
    this.showOnly(null);
  }

  updateHud(state: Readonly<RunState>, events: readonly SimEvent[]): void {
    this.hud.update(state, events);
  }

  /** Both mute buttons show the same state; the app owns the flag. */
  setMuted(muted: boolean): void {
    for (const button of this.muteButtons) {
      button.setAttribute('aria-pressed', muted ? 'true' : 'false');
      button.setAttribute('aria-label', muted ? 'Sound off' : 'Sound on');
    }
  }

  setDebugEnabled(enabled: boolean): void {
    this.debugPanel.setEnabled(enabled);
  }

  /** False lets the app skip gathering numbers only the panel would read. */
  get debugEnabled(): boolean {
    return this.debugPanel.isEnabled;
  }

  updateDebug(
    state: Readonly<RunState> | null,
    events: readonly SimEvent[],
    dt: number,
    phase: string,
    stats: DebugStats,
  ): void {
    this.debugPanel.update(state, events, dt, phase, stats);
  }

  dispose(): void {
    this.resultPanel.stop();
    this.confetti.dispose();
    this.listeners.abort();
  }

  /**
   * Exactly one screen is up at a time, and every switch stops whatever the
   * last one was animating: a count-up left running behind the Academy would
   * still be asking for tick sounds a minute later.
   */
  private showOnly(screen: HTMLElement | null): void {
    this.resultPanel.stop();
    if (screen !== this.result) this.confetti.stop();
    for (const candidate of [
      this.academyScreen,
      this.levelsScreen,
      this.roomScreen,
      this.hudRoot,
      this.result,
    ]) {
      candidate.hidden = candidate !== screen;
    }
  }

  /** Wires a button: tap sound first, then what the button is for. */
  private onTap(button: HTMLButtonElement, action: () => void): void {
    button.addEventListener(
      'click',
      () => {
        this.callbacks.onTap();
        action();
      },
      { signal: this.listeners.signal },
    );
  }
}

function requireElement<T extends HTMLElement = HTMLElement>(
  root: ParentNode,
  selector: string,
): T {
  const element = root.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Overlay is missing required element "${selector}" (see index.html)`);
  }
  return element;
}
