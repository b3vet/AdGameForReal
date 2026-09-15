/**
 * The Academy home's two Milestone 8 fixtures: the streak plaque and the
 * missions board (D51).
 *
 * Both are read-only. A streak is advanced by *finishing a road* and a mission
 * by playing one, so there is nothing on either to tap — which is why they live
 * beside the room cards rather than behind one, and why this file has no
 * callbacks in it at all.
 *
 * Three cards, always: the board holds `missions.board.active` of them and the
 * views come in already filled (`src/core/missions.ts`). A card that has no
 * mission to show is hidden rather than removed, so the board does not jump
 * when one is replaced at the next session.
 */

import { academy, fill } from '@/data/academy-types';
import type { MissionView } from '@/core/missions';
import type { StreakView } from '@/core/streak';

import { icon } from './icons';
import { element, text } from './widgets';

export interface BoardElements {
  /** The plaque, its day count and the line under it. */
  streak: HTMLElement;
  streakDays: HTMLElement;
  streakHint: HTMLElement;
  /** The board the mission cards are built into, and the word over it. */
  missions: HTMLElement;
  missionsHeading: HTMLElement;
}

/** One mission card's parts, kept so a repaint writes rather than rebuilds. */
interface MissionCard {
  root: HTMLElement;
  text: HTMLElement;
  bar: HTMLElement;
  progress: HTMLElement;
  reward: HTMLElement;
}

export class MetaBoard {
  private readonly elements: BoardElements;
  private readonly cards: MissionCard[] = [];

  constructor(elements: BoardElements) {
    this.elements = elements;
    // The markup carries a placeholder so the screen is never blank in a
    // half-loaded page; the copy is the data's (`academy.json`).
    elements.missionsHeading.textContent = academy.meta.missions.heading;
  }

  /** The plaque: which day the streak is on and what the next road pays. */
  showStreak(view: StreakView): void {
    const copy = academy.meta.streak;
    const started = view.days > 0;
    this.elements.streak.dataset['claimed'] = view.claimedToday ? 'true' : 'false';
    this.elements.streak.dataset['started'] = started ? 'true' : 'false';
    this.elements.streakDays.textContent = started ? String(view.days) : '';
    this.elements.streakHint.textContent = !started
      ? copy.startLabel
      : view.claimedToday
        ? copy.claimedLabel
        : fill(copy.nextLabel, { coins: String(view.nextBonus) });
    this.elements.streak.setAttribute(
      'aria-label',
      started ? fill(copy.title, { days: String(view.days) }) : copy.startLabel,
    );
  }

  /** The three missions, with a bar each and the coins they pay. */
  showMissions(missions: readonly MissionView[]): void {
    const copy = academy.meta.missions;
    this.build(missions.length);

    for (const [index, card] of this.cards.entries()) {
      const mission = missions[index];
      card.root.hidden = mission === undefined;
      if (mission === undefined) continue;

      const target = Math.max(1, mission.target);
      const progress = Math.min(target, Math.max(0, mission.progress));
      card.root.dataset['done'] = mission.done ? 'true' : 'false';
      card.text.textContent = mission.text;
      card.progress.textContent = mission.done
        ? copy.doneLabel
        : fill(copy.progressLabel, {
            progress: String(Math.floor(progress)),
            target: String(Math.floor(target)),
          });
      // One custom property for the fill, exactly as the boss bar does it: the
      // bar is a `scaleX` on a pseudo element, so no layout happens here.
      card.bar.style.setProperty('--bar-fill', String(mission.done ? 1 : progress / target));
      card.reward.textContent = String(mission.reward);
    }

    this.elements.missions.dataset['empty'] = missions.length === 0 ? 'true' : 'false';
  }

  /** One card per mission, built on the first paint and written afterwards. */
  private build(count: number): void {
    for (let i = this.cards.length; i < count; i++) {
      const root = element('div', 'mission frame frame--card');
      const line = text('p', 'mission__text', '');

      const bar = element('div', 'mission__bar');
      bar.append(element('span', 'mission__fill'));

      const foot = element('div', 'mission__foot');
      const progress = text('span', 'mission__progress', '');
      const reward = element('span', 'mission__reward');
      reward.append(icon('coin', 'mission__coin'), text('span', 'mission__coins', ''));
      foot.append(progress, reward);

      root.append(line, bar, foot);
      this.elements.missions.append(root);
      const coins = reward.lastElementChild;
      this.cards.push({
        root,
        text: line,
        bar,
        progress,
        // The reward's number, not its wrapper: the coin glyph beside it stays.
        reward: coins instanceof HTMLElement ? coins : reward,
      });
    }
  }
}
