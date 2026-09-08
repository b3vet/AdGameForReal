/**
 * The in-run HUD: squad count, level label, boss HP bar, first-level legend.
 *
 * Reads sim state and events only — it never touches the `Run`. Every DOM write
 * is guarded by a "did this actually change?" check, because `update` runs on
 * every frame and layout thrash is the one thing an overlay can do to a 60 fps
 * scene.
 */

import type { RunState, SimEvent } from '@/sim';

import './hud.css';

/** The level-1 gate legend is a teaching aid, not chrome: it leaves quickly. */
const LEGEND_SECONDS = 6;

const BUMP_CLASS = 'hud__count--bump';
const HURT_CLASS = 'hud__count--hurt';

export class Hud {
  private readonly levelLabel: HTMLElement;
  private readonly count: HTMLElement;
  private readonly bossBar: HTMLElement;
  private readonly bossFill: HTMLElement;
  private readonly bossValue: HTMLElement;
  private readonly legend: HTMLElement;

  private shownCount = -1;
  private shownBossValue = '';
  private shownBossRatio = -1;
  private bossVisible = false;
  private legendArmed = false;

  constructor(
    elements: {
      levelLabel: HTMLElement;
      count: HTMLElement;
      bossBar: HTMLElement;
      bossFill: HTMLElement;
      bossValue: HTMLElement;
      legend: HTMLElement;
    },
  ) {
    this.levelLabel = elements.levelLabel;
    this.count = elements.count;
    this.bossBar = elements.bossBar;
    this.bossFill = elements.bossFill;
    this.bossValue = elements.bossValue;
    this.legend = elements.legend;
  }

  /** Resets every transient bit of HUD state for a fresh run. */
  begin(levelIndex: number): void {
    this.levelLabel.textContent = `Level ${String(levelIndex)}`;
    this.shownCount = -1;
    this.count.classList.remove(BUMP_CLASS, HURT_CLASS);

    this.setBossVisible(false);
    this.shownBossValue = '';
    this.shownBossRatio = -1;

    // The legend only ever teaches the first level (docs/03-milestone-1-plan.md).
    this.legendArmed = levelIndex === 1;
    this.setLegendVisible(this.legendArmed);
  }

  update(state: Readonly<RunState>, events: readonly SimEvent[]): void {
    const count = Math.max(0, Math.round(state.squad.count));
    if (count !== this.shownCount) {
      this.count.textContent = String(count);
      this.shownCount = count;
    }

    let bumped = false;
    let hurt = false;
    for (const event of events) {
      if (event.type === 'gatePassed') bumped = true;
      else if (event.type === 'unitsLost') hurt = true;
    }
    // Losing units is the more urgent read, so it wins the shared animation slot.
    if (hurt) this.replay(HURT_CLASS);
    else if (bumped) this.replay(BUMP_CLASS);

    this.updateBoss(state);

    if (this.legendArmed && state.time >= LEGEND_SECONDS) {
      this.legendArmed = false;
      this.setLegendVisible(false);
    }
  }

  private updateBoss(state: Readonly<RunState>): void {
    const boss = state.boss;
    const visible = boss !== null && boss.active && boss.alive;
    if (visible !== this.bossVisible) this.setBossVisible(visible);
    if (!visible || boss === null) return;

    const maxHp = boss.maxHp > 0 ? boss.maxHp : 1;
    const ratio = Math.min(1, Math.max(0, boss.hp / maxHp));
    // Rounded before comparing: sub-pixel bar changes are not worth a style write.
    const quantised = Math.round(ratio * 200) / 200;
    if (quantised !== this.shownBossRatio) {
      this.bossFill.style.transform = `scaleX(${String(quantised)})`;
      this.shownBossRatio = quantised;
    }

    const value = `${String(Math.max(0, Math.ceil(boss.hp)))} / ${String(Math.ceil(maxHp))}`;
    if (value !== this.shownBossValue) {
      this.bossValue.textContent = value;
      this.shownBossValue = value;
    }
  }

  private setBossVisible(visible: boolean): void {
    this.bossVisible = visible;
    this.bossBar.hidden = !visible;
  }

  private setLegendVisible(visible: boolean): void {
    this.legend.hidden = !visible;
  }

  /** Restarts a CSS animation that may already be running on the element. */
  private replay(className: string): void {
    const element = this.count;
    element.classList.remove(BUMP_CLASS, HURT_CLASS);
    // Reading a layout property flushes the removal, so re-adding restarts it.
    void element.offsetWidth;
    element.classList.add(className);
  }
}
