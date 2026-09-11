/**
 * The in-run HUD: squad count, level label, staff badge, boss HP bar, and the
 * first-level legend.
 *
 * Reads sim state and events only — it never touches the `Run`. Every DOM write
 * is guarded by a "did this actually change?" check, because `update` runs on
 * every frame and layout thrash is the one thing an overlay can do to a 60 fps
 * scene.
 */

import { balance } from '@/data';
import { weaponOf } from '@/sim';
import type { RunState, SimEvent, WeaponId } from '@/sim';

import './hud.css';

const BUMP_CLASS = 'hud__count--bump';
const HURT_CLASS = 'hud__count--hurt';
const SWAP_CLASS = 'hud__staff--swap';
const FLASH_CLASS = 'staff-flash--show';
const BOSS_HIT_CLASS = 'boss--hit';
const BOSS_ENRAGED_CLASS = 'boss--enraged';

/**
 * Minimum milliseconds between two boss-bar shakes. The bar takes a hit every
 * few frames during a fight, and a 180 ms animation restarted every frame never
 * moves at all.
 */
const BOSS_SHAKE_INTERVAL_MS = 220;

/** How long the staff announcement stays up. Matches the CSS animation. */
const STAFF_FLASH_MS = 1100;

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
  staffBadge: HTMLElement;
  staffFlash: HTMLElement;
  bossBar: HTMLElement;
  bossFill: HTMLElement;
  bossValue: HTMLElement;
  bossLabel: HTMLElement;
  legend: HTMLElement;
}

export class Hud {
  private readonly elements: HudElements;

  private shownCount = -1;
  private shownBossHp = -1;
  private shownBossRatio = -1;
  private shownStaff: WeaponId | null = null;
  private bossVisible = false;
  private bossEnraged = false;
  private legendArmed = false;
  private legendSuppressed = false;
  private lastBossShake = 0;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(elements: HudElements) {
    this.elements = elements;
  }

  /**
   * The debug panel shares the bottom-left corner with the legend, and two
   * blocks of text over each other are worse than either alone. Debug wins: a
   * player who typed `?debug` — or triple-tapped the level chip to get the
   * panel up — is not the player the legend is teaching.
   */
  setDebugEnabled(enabled: boolean): void {
    this.legendSuppressed = enabled;
    if (enabled && this.legendArmed) {
      this.legendArmed = false;
      this.setLegendVisible(false);
    }
  }

  /** Resets every transient bit of HUD state for a fresh run. */
  begin(levelIndex: number, staff: WeaponId): void {
    this.elements.levelLabel.textContent = `Level ${String(levelIndex)}`;
    this.shownCount = -1;
    this.elements.count.classList.remove(BUMP_CLASS, HURT_CLASS);

    this.shownStaff = null;
    this.setStaff(staff, false);
    this.hideFlash();

    this.setBossVisible(false);
    this.setBossEnraged(false);
    this.shownBossHp = -1;
    this.shownBossRatio = -1;

    // The legend only ever teaches the first level (docs/03-milestone-1-plan.md).
    this.legendArmed = levelIndex === 1 && !this.legendSuppressed;
    this.setLegendVisible(this.legendArmed);
  }

  update(state: Readonly<RunState>, events: readonly SimEvent[]): void {
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

    // The legend is a teaching aid, not chrome: it leaves quickly.
    if (this.legendArmed && state.time >= balance.ui.legendSeconds) {
      this.legendArmed = false;
      this.setLegendVisible(false);
    }
  }

  /** Stops the flash timer. The overlay owns the elements, so nothing else. */
  dispose(): void {
    this.hideFlash();
  }

  private updateBoss(state: Readonly<RunState>, hit: boolean, enraged: boolean): void {
    const boss = state.boss;
    const visible = boss !== null && boss.active && boss.alive;
    if (visible !== this.bossVisible) this.setBossVisible(visible);
    if (!visible || boss === null) return;

    if (enraged !== this.bossEnraged) this.setBossEnraged(enraged);

    const maxHp = boss.maxHp > 0 ? boss.maxHp : 1;
    const ratio = Math.min(1, Math.max(0, boss.hp / maxHp));
    // Rounded before comparing: sub-pixel bar changes are not worth a style write.
    const quantised = Math.round(ratio * 200) / 200;
    if (quantised !== this.shownBossRatio) {
      this.elements.bossFill.style.transform = `scaleX(${String(quantised)})`;
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
    this.elements.bossLabel.textContent = enraged ? 'Enraged' : 'Boss';
  }

  /** The badge always shows the staff in hand; a swap also announces itself. */
  private setStaff(staff: WeaponId, announce: boolean): void {
    if (staff === this.shownStaff && !announce) return;
    this.shownStaff = staff;

    const name = STAFF_NAMES[staff];
    const badge = this.elements.staffBadge;
    badge.textContent = name;
    badge.dataset['staff'] = staff;
    if (!announce) return;

    replayAnimation(badge, SWAP_CLASS);

    const flash = this.elements.staffFlash;
    flash.textContent = `${name} Staff`;
    flash.dataset['staff'] = staff;
    flash.hidden = false;
    replayAnimation(flash, FLASH_CLASS);

    if (this.flashTimer !== null) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => {
      this.hideFlash();
    }, STAFF_FLASH_MS);
  }

  private hideFlash(): void {
    if (this.flashTimer !== null) {
      clearTimeout(this.flashTimer);
      this.flashTimer = null;
    }
    this.elements.staffFlash.classList.remove(FLASH_CLASS);
    this.elements.staffFlash.hidden = true;
  }

  private setBossVisible(visible: boolean): void {
    this.bossVisible = visible;
    this.elements.bossBar.hidden = !visible;
  }

  private setLegendVisible(visible: boolean): void {
    this.elements.legend.hidden = !visible;
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

/** The same trick for elements with only one animation class. */
function replayAnimation(element: HTMLElement, className: string): void {
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}
