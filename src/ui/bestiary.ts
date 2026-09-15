/**
 * The Bestiary (D33), with the kill ladders Milestone 8 hung off it (D53).
 *
 * Split out of `./rooms.ts` for the file-size rule (CLAUDE.md) when the cards
 * grew from a name and a blurb into a name, a blurb, a count and three rungs.
 *
 * A card says four things, in the order they are read: what this thing is
 * (once it has been met), how many of them the player has put down, which of
 * its three tints are taken, and how many more the next one wants. The ladder
 * is drawn even on a card that has never been met — the tint is the goal, and a
 * goal the player cannot see is not one.
 *
 * Six cards, and more later: the strip scrolls rather than shrinking, which is
 * what keeps a seventh kind from making the first six unreadable.
 */

import { bestiaryView } from '@/core/bestiary';
import type { BestiaryEntryView, TierView } from '@/core/bestiary';
import type { PlayerState } from '@/core/player';
import { academy, fill } from '@/data/academy-types';

import { beastIcon, icon } from './icons';
import { element, text } from './widgets';

export interface BestiaryElements {
  /** The strip the cards are built into. */
  root: HTMLElement;
  /** The room's subtitle line, which counts what has been met. */
  subtitle: HTMLElement;
}

/** One card's writable parts, so a repaint writes rather than rebuilds. */
interface BeastCard {
  root: HTMLElement;
  blurb: HTMLElement;
  count: HTMLElement;
  next: HTMLElement;
  rungs: HTMLElement[];
}

export class BestiaryRoom {
  private readonly elements: BestiaryElements;
  private readonly cards = new Map<string, BeastCard>();

  constructor(elements: BestiaryElements) {
    this.elements = elements;
  }

  show(player: PlayerState): void {
    const views = bestiaryView(player.kills, player.bestiary);
    let seen = 0;
    for (const view of views) {
      if (view.seen) seen++;
      const card = this.cards.get(view.id) ?? this.build(view);
      paint(card, view);
    }
    this.elements.subtitle.textContent = fill(academy.bestiary.seenLabel, {
      seen: String(seen),
      total: String(views.length),
    });
  }

  private build(view: BestiaryEntryView): BeastCard {
    const root = element('div', 'beast frame frame--card');
    root.dataset['beast'] = view.id;

    const head = element('div', 'row__head');
    head.append(icon(beastIcon(view.id), 'beast__icon'), text('span', 'beast__name', view.name));
    const count = text('span', 'beast__count', '');
    head.append(count);

    const blurb = text('p', 'beast__blurb', '');

    // Three pips, one per rung, filled as the kills cross them: the ladder at a
    // glance, with the words for the next one underneath.
    const ladder = element('div', 'beast__ladder');
    const rungs: HTMLElement[] = [];
    for (const tier of view.tiers) {
      const rung = element('span', 'beast__rung');
      rung.append(text('span', 'beast__rung-kills', String(tier.kills)));
      ladder.append(rung);
      rungs.push(rung);
    }
    const next = text('p', 'beast__next', '');

    root.append(head, blurb, ladder, next);
    this.elements.root.append(root);
    const card: BeastCard = { root, blurb, count, next, rungs };
    this.cards.set(view.id, card);
    return card;
  }
}

function paint(card: BeastCard, view: BestiaryEntryView): void {
  card.root.dataset['seen'] = view.seen ? 'true' : 'false';
  card.blurb.textContent = view.seen ? view.blurb : academy.bestiary.unknown;
  card.count.textContent = view.countLabel;
  card.next.textContent = view.nextLabel;
  for (const [index, rung] of card.rungs.entries()) {
    const tier: TierView | undefined = view.tiers[index];
    if (tier === undefined) continue;
    rung.dataset['taken'] = tier.taken ? 'true' : 'false';
    // The tint the rung pays, which is what the player is counting kills for.
    rung.title = tier.cosmeticName;
  }
}
