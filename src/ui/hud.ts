/**
 * The in-run HUD: squad count, level chip, staff badge, boss HP bar.
 *
 * That is the whole list now (plan, "UI text, font"). The gate legend and the
 * full-screen staff-name flash were cut: the legend taught a rule the first
 * gate teaches better, and the flash covered the road at the exact moment the
 * player had just changed weapon. The badge keeps its swap animation, which is
 * what actually announced the change.
 *
 * Reads sim state and events only — it never touches the `Run`. Every DOM write
 * is guarded by a "did this actually change?" check, because `update` runs on
 * every frame and layout thrash is the one thing an overlay can do to a 60 fps
 * scene.
 */

import { academy, fill } from '@/data/academy-types';
import { weaponOf } from '@/sim';
import type { BossKind, RunState, SimEvent, WeaponId } from '@/sim';

import { setIcon, staffIcon } from './icons';

import './hud.css';

const BUMP_CLASS = 'hud__count--bump';
const HURT_CLASS = 'hud__count--hurt';
const SWAP_CLASS = 'hud__staff--swap';
const BOSS_HIT_CLASS = 'boss--hit';
const BOSS_ENRAGED_CLASS = 'boss--enraged';

/**
 * Minimum milliseconds between two boss-bar shakes. The bar takes a hit every
 * few frames during a fight, and a 180 ms animation restarted every frame never
 * moves at all.
 */
const BOSS_SHAKE_INTERVAL_MS = 220;

const STAFF_NAMES: Readonly<Record<WeaponId, string>> = {
  ember: 'Ember',
  storm: 'Storm',
  frost: 'Frost',
};

/** Wall clock. Presentation only: the sim's own clock never leaves the sim. */
const now = (): number => (typeof performance === 'undefined' ? 0 : performance.now());

export interface HudElements {
  levelLabel: HTMLElement;
  count: HTMLElement;
  /** The plaque the count sits on; it carries the staff colour. */
  plaque: HTMLElement;
  /** The staff's glyph on the plaque, re-pointed rather than rebuilt. */
  staffIcon: HTMLElement;
  staffBadge: HTMLElement;
  bossBar: HTMLElement;
  bossValue: HTMLElement;
  bossLabel: HTMLElement;
}

export class Hud {
  private readonly elements: HudElements;

  private shownCount = -1;
  /**
   * An endless run (D52) has no level number, so the chip counts metres
   * instead. Held here rather than read off the state every frame because the
   * chip is written only when the number it prints changes.
   */
  private endless = false;
  private shownMetres = -1;
  private shownBossHp = -1;
  private shownBossRatio = -1;
  private shownStaff: WeaponId | null = null;
  private bossVisible = false;
  private bossEnraged = false;
  /** Which boss is in the arena, so the bar can print its name (D49). */
  private bossKind: BossKind = 'demon';
  private shownBossTitle = '';
  private lastBossShake = 0;

  constructor(elements: HudElements) {
    this.elements = elements;
  }

  /** Resets every transient bit of HUD state for a fresh run. */
  begin(levelIndex: number, staff: WeaponId, endless = false): void {
    this.endless = endless;
    this.shownMetres = -1;
    this.elements.levelLabel.dataset['endless'] = endless ? 'true' : 'false';
    this.elements.levelLabel.textContent = endless
      ? fill(academy.meta.endless.hudLabel, { metres: '0' })
      : `Level ${String(levelIndex)}`;
    this.shownCount = -1;
    this.elements.count.classList.remove(BUMP_CLASS, HURT_CLASS);

    this.shownStaff = null;
    this.setStaff(staff, false);

    this.setBossVisible(false);
    this.bossKind = 'demon';
    this.shownBossTitle = '';
    this.setBossEnraged(false);
    this.shownBossHp = -1;
    this.shownBossRatio = -1;
    // The fill is an inline custom property, so it outlives a run unless it is
    // taken off; a fresh bar would otherwise open on the last boss's HP.
    this.elements.bossBar.style.removeProperty('--boss-fill');
  }

  update(state: Readonly<RunState>, events: readonly SimEvent[]): void {
    if (this.endless) this.updateMetres(state);
    const count = Math.max(0, Math.round(state.squad.count));
    if (count !== this.shownCount) {
      this.elements.count.textContent = String(count);
      this.shownCount = count;
    }

    const bossId = state.boss?.id;
    let bumped = false;
    let hurt = false;
    let bossHit = false;
    let enraged = state.boss?.enraged === true;
    let swappedTo: WeaponId | null = null;

    for (const event of events) {
      switch (event.type) {
        case 'gatePassed':
          bumped = true;
          break;
        case 'unitsLost':
          hurt = true;
          break;
        case 'enemyHit':
          if (bossId !== undefined && event.enemyId === bossId) bossHit = true;
          break;
        case 'bossEnraged':
          enraged = true;
          break;
        case 'weaponChanged':
          swappedTo = event.to;
          break;
        default:
          break;
      }
    }

    // Losing units is the more urgent read, so it wins the shared animation slot.
    if (hurt) this.replayCount(HURT_CLASS);
    else if (bumped) this.replayCount(BUMP_CLASS);

    if (swappedTo !== null) this.setStaff(swappedTo, true);
    else this.setStaff(weaponOf(state.squad), false);

    this.updateBoss(state, bossHit, enraged);
  }

  /**
   * The metres chip, in place of the level chip (D52). Compared as a number
   * before the string is built: the distance moves every frame and most of
   * those frames do not change the metre it is standing on.
   */
  private updateMetres(state: Readonly<RunState>): void {
    const metres = Math.max(0, Math.floor(state.endless?.metres ?? 0));
    if (metres === this.shownMetres) return;
    this.shownMetres = metres;
    this.elements.levelLabel.textContent = fill(academy.meta.endless.hudLabel, {
      metres: String(metres),
    });
  }

  private updateBoss(state: Readonly<RunState>, hit: boolean, enraged: boolean): void {
    const boss = state.boss;
    const visible = boss !== null && boss.active && boss.alive;
    if (visible !== this.bossVisible) this.setBossVisible(visible);
    if (!visible || boss === null) return;

    // The bar is titled with whichever boss is standing there (D49), which the
    // state carries; a hand-made one carries none and is boss 1.
    const kind = boss.variant ?? 'demon';
    if (kind !== this.bossKind) {
      this.bossKind = kind;
      this.paintBossTitle();
    }
    if (enraged !== this.bossEnraged) this.setBossEnraged(enraged);

    const maxHp = boss.maxHp > 0 ? boss.maxHp : 1;
    const ratio = Math.min(1, Math.max(0, boss.hp / maxHp));
    // Rounded before comparing: sub-pixel bar changes are not worth a style write.
    const quantised = Math.round(ratio * 200) / 200;
    if (quantised !== this.shownBossRatio) {
      // One property for two elements: the fill scales by it and the gem rides
      // at its head (`./hud.css`), so they cannot disagree and only one style
      // write happens per change.
      this.elements.bossBar.style.setProperty('--boss-fill', String(quantised));
      this.shownBossRatio = quantised;
    }

    // Compared as a number first: building the string every frame to find out
    // it did not change is an allocation on the hot path.
    const hp = Math.max(0, Math.ceil(boss.hp));
    if (hp !== this.shownBossHp) {
      this.shownBossHp = hp;
      this.elements.bossValue.textContent = `${String(hp)} / ${String(Math.ceil(maxHp))}`;
    }

    if (hit) this.shakeBoss();
  }

  private shakeBoss(): void {
    const at = now();
    if (at - this.lastBossShake < BOSS_SHAKE_INTERVAL_MS) return;
    this.lastBossShake = at;
    replayAnimation(this.elements.bossBar, BOSS_HIT_CLASS);
  }

  private setBossEnraged(enraged: boolean): void {
    this.bossEnraged = enraged;
    this.elements.bossBar.classList.toggle(BOSS_ENRAGED_CLASS, enraged);
    this.paintBossTitle();
  }

  /**
   * The bar's title: the boss's own name, from the Bestiary's copy, until it
   * enrages — at which point the word that matters is what it is doing, not
   * what it is called.
   */
  private paintBossTitle(): void {
    const title = this.bossEnraged ? academy.hud.enraged : bossName(this.bossKind);
    if (title === this.shownBossTitle) return;
    this.shownBossTitle = title;
    this.elements.bossLabel.textContent = title;
  }

  /**
   * The badge always shows the staff in hand; a swap also blows it up and lets
   * it settle, which is the whole announcement since the flash was cut.
   */
  private setStaff(staff: WeaponId, announce: boolean): void {
    if (staff === this.shownStaff && !announce) return;
    this.shownStaff = staff;

    const badge = this.elements.staffBadge;
    badge.textContent = STAFF_NAMES[staff];
    badge.dataset['staff'] = staff;
    // The plaque takes the same stamp, which is what colours its glyph.
    this.elements.plaque.dataset['staff'] = staff;
    setIcon(this.elements.staffIcon, staffIcon(staff));
    if (announce) replayAnimation(badge, SWAP_CLASS);
  }

  private setBossVisible(visible: boolean): void {
    this.bossVisible = visible;
    this.elements.bossBar.hidden = !visible;
  }

  /** Restarts a CSS animation that may already be running on the count. */
  private replayCount(className: string): void {
    const element = this.elements.count;
    element.classList.remove(BUMP_CLASS, HURT_CLASS);
    // Reading a layout property flushes the removal, so re-adding restarts it.
    void element.offsetWidth;
    element.classList.add(className);
  }
}

/**
 * What the Bestiary calls a boss (D49). One list of names for the cards and the
 * bar, so a boss that is renamed is renamed once; an id the copy has no entry
 * for falls back to the plain word rather than printing its id.
 */
function bossName(kind: BossKind): string {
  return academy.bestiary.entries.find((entry) => entry.id === kind)?.name ?? academy.hud.bossFallback;
}

/** The same trick for elements with only one animation class. */
function replayAnimation(element: HTMLElement, className: string): void {
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}
