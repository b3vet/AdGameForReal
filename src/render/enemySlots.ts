/**
 * The slot book: which body on the road is bound to which drawing slot, what a
 * slot remembers about it, and the numbers it prints.
 *
 * Split out of `./enemies.ts` for the file-size rule (CLAUDE.md) when D49 gave
 * a slot a second label and two more states to carry. The line between the two
 * files is the one the view's own rules draw: *this* is the bookkeeping — ids
 * to slots, the strings the atlas is handed, the ink they are printed in — and
 * `./enemies.ts` is the frame: which crowd draws which kind, the death sweep,
 * and the rivers.
 *
 * Nothing here allocates per frame. A slot's strings are rebuilt only when the
 * number they print actually moves, which is what keeps a block taking sixty
 * hits from making sixty strings.
 */

import type { ChargerDeath } from './chargers';
import { SHIELD_GLYPH } from './glyphAtlas';
import { gateCrowdsLabel } from './labelClearance';
import type { LabelView } from './labelClearance';
import { labelPixels, type NumberLabels } from './labels';
import {
  CHARGER_LABEL_HEIGHT,
  DANGER_LABEL_COLOR,
  ENEMY_LABEL_COLOR,
  ENEMY_LABEL_MIN,
  ENEMY_LABEL_SIZE,
  LABEL_BEHIND,
  LABEL_RANGE,
  SHIELD_LABEL_COLOR,
  SHIELD_LABEL_MIN,
  SHIELD_LABEL_RISE,
  SHIELD_LABEL_SIZE,
} from './theme';
import { balance } from '@/data';
import { enemyFootprint } from '@/sim';
import type { EnemyKind, EnemyState, GateState, RunState } from '@/sim';

/** Where a block's HP number is anchored: on the cluster, not floating above it. */
export const LABEL_HEIGHT = 0.95;

export interface EnemySlot {
  /** This slot's label id in the shared atlas; see `src/render/labels.ts`. */
  label: number;
  /** Its second one, for a shielded brute's shield count. */
  shieldLabel: number;
  enemyId: number;
  kind: EnemyKind;
  x: number;
  z: number;
  units: number;
  /** Seconds into the baked death animation, or -1 while alive. */
  dying: number;
  /** How this body is being taken away; only a charger has two ways, and it
   *  is the charger view that reads it (`./chargers.ts`). */
  death: ChargerDeath;
  /** Seconds of frost left on this block. */
  slow: number;
  footprint: number;
  /** The frame this slot was last seen alive in; the sweep reads it. */
  seen: number;
  /** Last hp printed, so the string is only rebuilt when the number changes. */
  shownHp: number;
  /** The string that number produced, handed back to the atlas every frame. */
  shownText: string;
  /** The same pair for the shield count, which moves on its own clock. */
  shownShield: number;
  shownShieldText: string;
  /** True once this body's shield has broken; its number turns to the alarm. */
  broken: boolean;
  /** True while the body is running a lane down (`EnemyState.charge`). */
  charging: boolean;
}

export class EnemySlotBook {
  private readonly labels: NumberLabels;
  private readonly pool: EnemySlot[] = [];
  private readonly byEnemyId = new Map<number, EnemySlot>();

  /** Every label id a slot can ever need is claimed here, once, at boot. */
  constructor(labels: NumberLabels, capacity: number) {
    this.labels = labels;
    for (let i = 0; i < capacity; i++) {
      this.pool.push({
        label: labels.claim(),
        shieldLabel: labels.claim(),
        enemyId: -1,
        kind: 'grunt',
        x: 0,
        z: 0,
        units: 0,
        dying: -1,
        death: 'shot',
        slow: 0,
        footprint: 1,
        seen: 0,
        shownHp: Number.NaN,
        shownText: '',
        shownShield: Number.NaN,
        shownShieldText: '',
        broken: false,
        charging: false,
      });
    }
  }

  /** Every slot, live or free: the death sweep walks all of them. */
  get slots(): readonly EnemySlot[] {
    return this.pool;
  }

  get(enemyId: number): EnemySlot | undefined {
    return this.byEnemyId.get(enemyId);
  }

  /** The slot for this body, binding a free one the first time it is seen. */
  bind(enemy: EnemyState): EnemySlot | undefined {
    const existing = this.byEnemyId.get(enemy.id);
    if (existing !== undefined) return existing;
    if (!enemy.alive) return undefined;

    const slot = this.freeSlot();
    if (slot === undefined) return undefined;

    slot.enemyId = enemy.id;
    slot.kind = enemy.kind;
    slot.dying = -1;
    slot.death = 'shot';
    slot.slow = 0;
    slot.shownHp = Number.NaN;
    slot.shownText = '';
    slot.shownShield = Number.NaN;
    slot.shownShieldText = '';
    // A shielded brute that is bound with no shield left is one the sim has
    // already broken — a body the view lost sight of and picked up again.
    slot.broken = enemy.kind === 'shieldBrute' && (enemy.shield ?? 0) <= 0;
    slot.charging = false;

    this.byEnemyId.set(enemy.id, slot);
    return slot;
  }

  release(slot: EnemySlot): void {
    if (slot.enemyId >= 0) this.byEnemyId.delete(slot.enemyId);
    slot.enemyId = -1;
    slot.dying = -1;
    slot.death = 'shot';
    slot.slow = 0;
    slot.shownHp = Number.NaN;
    slot.shownText = '';
    slot.shownShield = Number.NaN;
    slot.shownShieldText = '';
    slot.broken = false;
    slot.charging = false;
  }

  releaseAll(): void {
    this.byEnemyId.clear();
    for (const slot of this.pool) this.release(slot);
  }

  /**
   * What the slot has to know about the body this frame. Answers the seconds of
   * frost left on it, which is the caller's business to draw a ring with.
   */
  track(slot: EnemySlot, enemy: EnemyState, state: RunState, dt: number): number {
    slot.x = enemy.x;
    slot.z = enemy.z;
    slot.units = Math.max(1, enemy.units);
    slot.footprint = enemyFootprint(enemy.kind, slot.units, balance);
    slot.charging = enemy.charge !== undefined;

    // Two sources for the same fact, because both can be missing: the sim's
    // deadline is authoritative when it is there, and the event's countdown
    // covers the fixtures and hand-built states that carry no `slowUntil`.
    const remaining = enemy.slowUntil === undefined ? 0 : enemy.slowUntil - state.time;
    slot.slow = Math.max(slot.slow - dt, remaining);
    return slot.slow;
  }

  /**
   * The numbers over one body: its own, and — for a shielded brute — the shield
   * the fire has to break first (D49).
   *
   * The shield rides above the body's number rather than beside it, so the two
   * stay one column whatever the block is standing next to, and it is printed
   * in ice with the atlas's shield glyph in front of it: `⛨` then the count, one
   * string, one label, one draw call with every other number in the scene.
   *
   * The alarm ink is for a body that is happening *now* — a charger from the
   * step it sets off, a shielded brute from the step its shield breaks — and
   * nothing else on the road prints in it.
   */
  paint(
    slot: EnemySlot,
    enemy: EnemyState,
    gates: readonly GateState[],
    squadZ: number,
    view: LabelView,
  ): void {
    const ahead = enemy.z - squadZ;
    const height = enemy.kind === 'charger' ? CHARGER_LABEL_HEIGHT : LABEL_HEIGHT;
    const readable =
      ahead < LABEL_RANGE &&
      ahead > -LABEL_BEHIND &&
      !gateCrowdsLabel(gates, enemy.x, enemy.z, height, view);
    if (!readable) return;

    const hp = Math.max(0, Math.round(enemy.hp));
    if (hp !== slot.shownHp) {
      slot.shownHp = hp;
      slot.shownText = String(hp);
    }
    const alarmed = slot.charging || (slot.kind === 'shieldBrute' && slot.broken);
    this.labels.set(
      slot.label,
      slot.shownText,
      enemy.x,
      height,
      enemy.z,
      alarmed ? DANGER_LABEL_COLOR : ENEMY_LABEL_COLOR,
      labelPixels(ENEMY_LABEL_SIZE, ENEMY_LABEL_MIN, ahead),
    );

    const shield = Math.max(0, Math.round(enemy.shield ?? 0));
    if (shield <= 0) return;
    if (shield !== slot.shownShield) {
      slot.shownShield = shield;
      slot.shownShieldText = `${SHIELD_GLYPH}${String(shield)}`;
    }
    this.labels.set(
      slot.shieldLabel,
      slot.shownShieldText,
      enemy.x,
      height + SHIELD_LABEL_RISE,
      enemy.z,
      SHIELD_LABEL_COLOR,
      labelPixels(SHIELD_LABEL_SIZE, SHIELD_LABEL_MIN, ahead),
    );
  }

  /** First unbound slot. An index loop, not `find`: this runs per block per
   *  frame and a closure per call is an allocation in the steady-state path. */
  private freeSlot(): EnemySlot | undefined {
    for (let i = 0; i < this.pool.length; i++) {
      const slot = this.pool[i];
      if (slot !== undefined && slot.enemyId < 0) return slot;
    }
    return undefined;
  }
}
