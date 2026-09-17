/**
 * The beat library (`beats.json`, document 31, 3.3, 3.4 and 4.2) as a
 * designer reads it, before any level uses it: every Phase 1 beat present,
 * tiers that climb, losses inside their rating's band, and every threat
 * standing where the grammar says, seen for long enough to be answered.
 *
 * Tiers are resolved with the composer's own `resolveTier`, so a tier that
 * reads well here is the tier the composer lays.
 */

import { describe, expect, it } from 'vitest';

import { ROLES, resolveTier } from '../beats/library';
import type { ResolvedTier } from '../beats/library';
import { portalOpen } from '../pressure';
import { CHARGER_SECONDS, PHASE_ONE, SIGHT, SIGHT_SECONDS, curses } from './levelDesignRules';
import { balance, beats } from '@/data';

/** 3.4: expected loss for the reference player, by rating. */
const LOSS_BANDS: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.02, 0.05],
  [0.05, 0.1],
  [0.1, 0.15],
  [0.15, 0.22],
  [0.22, 0.3],
];
/** A threat stands between the lead-in row and where the next beat's threats begin. */
const AT_MAX = 12;
const BLOCKS: ReadonlySet<string> = new Set(['grunt', 'brute', 'shieldBrute']);

/** Every tier of every def, resolved, with a label for failures. */
function everyTier(): Array<{ id: string; key: number; at: string; tier: ResolvedTier }> {
  const out: Array<{ id: string; key: number; at: string; tier: ResolvedTier }> = [];
  for (const def of beats.defs) {
    for (const key of Object.keys(def.tiers).map(Number)) {
      out.push({ id: def.id, key, at: `${def.id}:${String(key)}`, tier: resolveTier(def, key) });
    }
  }
  return out;
}

/** Seconds from first sight to contact, for something that starts closing at `trigger`. */
function sightToContact(trigger: number, ownSpeed: number): number {
  const run = balance.squad.runSpeed;
  const still = Math.max(0, SIGHT - trigger) / run;
  return still + (Math.min(SIGHT, trigger) - balance.enemies.contactDistance) / (run + ownSpeed);
}

describe('the beat library', () => {
  it('holds every Phase 1 beat once, with measured fire and value ranges in order', () => {
    const ids = beats.defs.map((def) => def.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...PHASE_ONE].sort());
    for (const what of ['block', 'river'] as const) {
      for (const biome of ['meadow', 'frost'] as const) {
        expect(beats.dps?.[what]?.[biome], `dps.${what}.${biome}`).toBeGreaterThan(0);
      }
    }
    // Each size prints more than the one before it: a flip below a price, a small plus below a mid.
    for (const sizes of [['flip', 'price'], ['small', 'mid', 'big']] as const) {
      let floor = 0;
      for (const size of sizes) {
        const range = beats.values?.[size];
        expect(range, size).toBeDefined();
        if (range === undefined) continue;
        expect(range[0], size).toBeGreaterThan(floor);
        expect(range[1], size).toBeGreaterThanOrEqual(range[0]);
        floor = range[1];
      }
    }
  });

  it('keys tiers from 1 with no gaps; the rating is the tier and the loss sits in its band', () => {
    for (const def of beats.defs) {
      const keys = Object.keys(def.tiers).map(Number).sort((a, b) => a - b);
      expect(keys, def.id).toEqual(keys.map((_, i) => i + 1));
      expect(keys.length, def.id).toBeLessThanOrEqual(5);
      let lastLoss = -1;
      for (const key of keys) {
        const tier = resolveTier(def, key);
        const at = `${def.id}:${String(key)}`;
        // A calm beat has one tier and rating 0 (3.3); every other tier is its own rating (3.9).
        const calm = tier.rating === 0 && keys.length === 1;
        expect(`${at} rating ${String(tier.rating)}`).toBe(`${at} rating ${String(calm ? 0 : key)}`);
        const band = LOSS_BANDS[tier.rating] ?? [0, 0];
        expect(tier.expectLoss, at).toBeGreaterThanOrEqual(band[0]);
        expect(tier.expectLoss, at).toBeLessThanOrEqual(band[1]);
        expect(tier.expectLoss, `${at} rises with the tier`).toBeGreaterThan(lastLoss);
        lastLoss = tier.expectLoss;
      }
    }
  });

  it('threatens every rated tier and nothing else, and prints no multiplier of its own', () => {
    for (const { at, tier } of everyTier()) {
      const threats = tier.enemies.length + tier.rivers.length;
      expect(`${at} threatened ${String(threats > 0)}`).toBe(`${at} threatened ${String(tier.rating > 0)}`);
      if (tier.rating === 0) expect(curses(tier), at).toEqual({ flip: 0, price: 0 });
      // Multipliers come only from a script's prize override, so a level's count reads off its script.
      for (const role of ROLES) expect(`${at} ${role} ${tier.gates[role].kind}`).not.toMatch(/ mul$/);
      // At most one curse a beat: the staff pass may take a second curse (`levelPasses.ts`), and a budget must print whole.
      const printed = curses(tier);
      expect(printed.flip + printed.price, at).toBeLessThanOrEqual(1);
    }
  });

  it('stands blocks and chargers where the grammar says, in sight for long enough', () => {
    const spacing = balance.level.rowSpacing;
    const line = -balance.enemies.beat.holdGap;
    for (const { at, tier } of everyTier()) {
      for (const enemy of tier.enemies) {
        expect(enemy.at, at).toBeGreaterThanOrEqual(-spacing);
        expect(enemy.at, at).toBeLessThanOrEqual(AT_MAX);
        expect(enemy.killSeconds, at).toBeGreaterThan(0);
        if (enemy.hold === true && enemy.at <= 0) {
          // A guard holds the gateway (Phase 1, wave two): it stands on its
          // hold line, inside the panels' clearance, because only there does
          // the column meet it as it crosses the row; and it wakes when the
          // column reaches it, since a block that never walks has no run to
          // start out of range (the 34 m rule below is for walkers).
          expect(enemy.at, `${at} a guard stands on its line`).toBe(line);
          expect(enemy.wake, `${at} a guard wakes on contact`).toBeLessThanOrEqual(balance.enemies.contactDistance);
          expect(BLOCKS.has(enemy.kind), at).toBe(true);
          expect(sightToContact(enemy.wake, 0), `${at} sight to contact`).toBeGreaterThanOrEqual(SIGHT_SECONDS);
          continue;
        }
        expect(Math.abs(enemy.at), `${at} clear of the panels`).toBeGreaterThanOrEqual(balance.streams.gateClearance);
        expect(enemy.wake, `${at} wakes in sight`).toBeLessThanOrEqual(SIGHT);
        if (enemy.kind === 'charger') {
          expect(enemy.lanes?.[0], `${at} a charger's lane leads its lanes`).toBe(enemy.lane);
          expect(enemy.at, `${at} a charger waits in front`).toBeLessThan(0);
          const closing = balance.squad.runSpeed + balance.enemies.charger.speed;
          const seconds = (enemy.wake - balance.enemies.contactDistance) / closing;
          expect(seconds, `${at} charger trigger to contact`).toBeGreaterThanOrEqual(CHARGER_SECONDS);
          continue;
        }
        expect(BLOCKS.has(enemy.kind), at).toBe(true);
        expect(enemy.lanes, `${at} only chargers spread`).toBeUndefined();
        const speed = enemy.kind === 'grunt' ? balance.enemies.grunt.speed : balance.enemies.brute.speed;
        expect(sightToContact(enemy.wake, speed), `${at} sight to contact`).toBeGreaterThanOrEqual(SIGHT_SECONDS);
        if (enemy.at > 0) {
          // 3.2 rule 2: behind the panels only where the panel stops shots.
          expect(['add', 'sub', 'fireRate'], `${at} behind a ${tier.gates[enemy.lane].kind}`).toContain(
            tier.gates[enemy.lane].kind,
          );
        } else {
          // A block out front is already running when it comes into range, so the fight is out there (3.2 rule 3).
          expect(enemy.wake, `${at} a guard wakes out of range`).toBeGreaterThanOrEqual(balance.projectiles.range);
        }
      }
    }
  });

  it('pours rivers from portals in sight that run their full length', () => {
    const spacing = balance.level.rowSpacing;
    for (const { at, tier } of everyTier()) {
      for (const river of tier.rivers) {
        expect(river.lanes.length, at).toBeGreaterThan(0);
        expect(river.at, at).toBeGreaterThanOrEqual(-spacing);
        expect(river.at, at).toBeLessThanOrEqual(AT_MAX);
        expect(Math.abs(river.at), `${at} clear of the panels`).toBeGreaterThanOrEqual(balance.streams.gateClearance);
        expect(Math.min(river.seconds, river.pressure, river.density), at).toBeGreaterThan(0);
        expect(`${at} open ${String(river.open !== undefined)} tail ${String(river.tail !== undefined)}`).toMatch(
          / open (true tail false|false tail true)$/,
        );
        const open = portalOpen(river, balance.streams.speed, balance);
        expect(open, `${at} opens in sight`).toBeLessThanOrEqual(SIGHT);
        expect(sightToContact(open, balance.streams.speed), `${at} sight to contact`).toBeGreaterThanOrEqual(
          SIGHT_SECONDS,
        );
        // The pour runs its whole length before the squad closes to the stop gap (3.2 rule 4).
        const window = (open - balance.enemies.portal.stopGap) / balance.squad.runSpeed;
        expect(window, `${at} pour window`).toBeGreaterThanOrEqual(river.seconds);
      }
    }
  });

  it('leaves no cheap dodge: every block holds the gateway and every river is still arriving at the row', () => {
    // Phase 1, wave two. A block that walks from in front of the panels meets
    // the column rows before them, and a portal that stops pouring before its
    // bodies reach the row has sent its last one long before the column gets
    // there: a column that stepped aside let either pass and stepped back into
    // the prize for nothing (both bots did, on every guard and fork).
    const run = balance.squad.runSpeed;
    const walk = balance.streams.speed;
    const contact = balance.enemies.contactDistance;
    for (const { at, tier } of everyTier()) {
      for (const enemy of tier.enemies) {
        if (enemy.kind === 'charger') continue;
        expect(enemy.hold, `${at} ${enemy.kind} holds`).toBe(true);
      }
      for (const river of tier.rivers) {
        expect(river.tail, `${at} a river timed by its tail`).toBeDefined();
        // Where the pour's last body really meets the column: at or past the row.
        const open = portalOpen(river, walk, balance);
        const lastPoured = river.at - open + run * river.seconds;
        const meets = lastPoured + (run * (river.at - lastPoured - contact)) / (run + walk);
        expect(meets, `${at} the last body meets the column past the row`).toBeGreaterThanOrEqual(0);
        expect(meets, at).toBeCloseTo(river.tail ?? Number.NaN, 6);
      }
    }
  });

  it('fences only in the fence beat, with the prize and its toll outside and a plus inside', () => {
    const walls = balance.walls;
    for (const { id, at, tier } of everyTier()) {
      const fence = tier.fence ?? null;
      expect(`${at} fenced ${String(fence !== null)}`).toBe(`${at} fenced ${String(id === 'fence')}`);
      if (fence === null) continue;
      expect(fence.outer, at).toBe('prize');
      expect(fence.both, `${at} both boundaries are Phase 2's`).toBeUndefined();
      expect(fence.from, at).toBeGreaterThanOrEqual(walls.minLength + walls.gateGap);
      // The stretch and its approach stay clear of the gate row behind (3.6).
      const room = 2 * balance.level.rowSpacing - walls.gateClearance;
      expect(fence.from + walls.approach, `${at} clear of the row behind`).toBeLessThanOrEqual(room);
      expect(tier.rivers.some((river) => river.lanes.includes('prize') && river.at > 0), `${at} toll`).toBe(true);
      expect(tier.gates.prize, at).toEqual({ kind: 'add', size: 'big' });
      expect(tier.gates.safe.kind, `${at} a plus inside`).toBe('add');
    }
  });
});
