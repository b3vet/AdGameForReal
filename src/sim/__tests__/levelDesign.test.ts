/**
 * The forty scripts (document 31, 3.5 and 3.9, and the targets in section 5
 * that are about shape): budgets, rhythm, what guards a multiplier, and tiers
 * that climb with the campaign, read from `levels.json` before a run is
 * played.
 *
 * Tiers, prize overrides and the curse budget are resolved with the
 * composer's own functions, so a script that passes here is one the composer
 * builds as written. The library itself is checked in
 * `levelDesignBeats.test.ts`, the composed roads and the pinned outline in
 * `levelDesignRoads.test.ts`, and what a beat costs is the beat lab's.
 */

import { describe, expect, it } from 'vitest';

import { solveCurve } from '../beats/beatCurve';
import { checkMultipliers, fundCurses, mulAllowance } from '../beats/budgets';
import { findBeat, resolveTier, withPrize } from '../beats/library';
import type { ResolvedTier } from '../beats/library';
import { FROST_FROM, MILESTONES, NOT_A_THREAT, PHASE_ONE, ROWS, blockBehind, curses, priced } from './levelDesignRules';
import { balance, beats, levelConfig, levelCount } from '@/data';
import type { LevelGenConfig, ScriptBeat } from '@/data/types';

/** Section 5: gate beats that carry a curse, and prizes with nothing in their lane, per biome. */
const CURSE_SHARE = [0.35, 0.55] as const;
const UNPRICED_MAX = 0.3;
/** 3.4: late multipliers stay decisions while the expected squad is under about this. */
const EARLY_E_MAX = 350;
/** 3.9: a rest after every two or three threat beats. */
const MAX_THREAT_RUN = 3;
/** 3.5: x3 on 13, 15, 18 and 20 in Meadow, and from 25 on Frostfell. */
const X3_MEADOW: readonly number[] = [13, 15, 18, 20];
const X3_FROST_FROM = 25;

interface Beat {
  entry: ScriptBeat;
  /** The tier with the prize override written in, before the curse budget. */
  tier: ResolvedTier;
  /** What the composer prints once the curse budget is spent. */
  funded: ResolvedTier;
}

interface Level {
  index: number;
  config: LevelGenConfig;
  beats: Beat[];
  milestone: boolean;
  release: boolean;
  /** Introduces a threat beat no earlier level has used (3.9's teach levels). */
  teach: boolean;
  frost: boolean;
}

function buildLevels(): Level[] {
  const seen = new Set<string>();
  const out: Level[] = [];
  for (let index = 1; index <= levelCount; index++) {
    const config = levelConfig(index);
    const script = config.script ?? [];
    const resolved = script.map((entry) => ({
      entry,
      tier: withPrize(resolveTier(findBeat(beats, entry.beat), entry.tier), entry.prize),
    }));
    const funded = fundCurses(
      resolved.map(({ entry, tier }) => ({ id: entry.beat, tier })),
      config.curses,
    );
    const fresh = script.filter((entry) => !seen.has(entry.beat) && !NOT_A_THREAT.has(entry.beat));
    for (const entry of script) seen.add(entry.beat);
    out.push({
      index,
      config,
      beats: resolved.map((beat, i) => ({ ...beat, funded: funded[i] ?? beat.tier })),
      milestone: config.milestone === true,
      release: MILESTONES.includes(index - 1),
      teach: fresh.length > 0,
      frost: index >= FROST_FROM,
    });
  }
  return out;
}

const LEVELS = buildLevels();

function where(level: Level, beat?: number): string {
  const at = `L${String(level.index)}`;
  return beat === undefined ? at : `${at} beat ${String(beat + 1)}`;
}

function printed(tier: ResolvedTier): number {
  const slots = curses(tier);
  return slots.flip + slots.price;
}

/** Mean tier of the rated beats on these levels. */
function meanTier(levels: readonly Level[]): number {
  const tiers = levels.flatMap((level) =>
    level.beats.filter((beat) => beat.tier.rating > 0).map((beat) => beat.entry.tier),
  );
  return tiers.reduce((sum, tier) => sum + tier, 0) / Math.max(1, tiers.length);
}

function topTier(level: Level): number {
  return Math.max(...level.beats.map((beat) => beat.entry.tier));
}

describe('the forty scripts', () => {
  it('script every level, from beats and tiers the library has, in 16 to 19 rows', () => {
    expect(LEVELS).toHaveLength(40);
    for (const level of LEVELS) {
      expect(level.beats.length, `${where(level)} has a script`).toBeGreaterThan(0);
      const rows = level.beats.reduce((sum, beat) => sum + findBeat(beats, beat.entry.beat).rows, 0);
      expect(rows, where(level)).toBeGreaterThanOrEqual(ROWS[0]);
      expect(rows, where(level)).toBeLessThanOrEqual(ROWS[1]);
      for (const beat of level.beats) expect(Number.isInteger(beat.entry.tier), where(level)).toBe(true);
      // The fields the plan keeps beside the script (3.9).
      expect(level.config.index, where(level)).toBe(level.index);
      expect(level.config.peakTarget, where(level)).toBeGreaterThan(level.config.startCount);
      expect(level.config.boss.hp, where(level)).toBeGreaterThan(0);
      expect(`${where(level)} milestone ${String(level.milestone)}`).toBe(
        `${where(level)} milestone ${String(MILESTONES.includes(level.index))}`,
      );
      expect(`${where(level)} ${level.config.biome ?? 'meadow'}`).toBe(
        `${where(level)} ${level.frost ? 'frost' : 'meadow'}`,
      );
    }
  });

  it('spends multipliers inside 3.5, each behind a guard, a toll or a fence and never an ambush', () => {
    for (const level of LEVELS) {
      const muls = level.beats.filter((beat) => beat.entry.prize === 'x2' || beat.entry.prize === 'x3');
      const x3 = muls.filter((beat) => beat.entry.prize === 'x3').length;
      const want = level.index === 1 ? 0 : level.index <= 9 || level.teach || level.release ? 1 : 2;
      expect(muls.length, `${where(level)} multipliers`).toBe(want);
      expect(muls.length, `${where(level)} the composer's ceiling`).toBeLessThanOrEqual(mulAllowance(level.index));
      const asked = level.beats.map((beat) => ({ id: beat.entry.beat, tier: beat.tier }));
      expect(() => checkMultipliers(level.index, asked), where(level)).not.toThrow();
      if (!level.frost) {
        expect(`${where(level)} x3 ${String(x3 > 0)}`).toBe(
          `${where(level)} x3 ${String(X3_MEADOW.includes(level.index))}`,
        );
      } else if (level.index < X3_FROST_FROM) {
        expect(x3, `${where(level)} x3 before level ${String(X3_FROST_FROM)}`).toBe(0);
      }
      for (const beat of muls) {
        const base = resolveTier(findBeat(beats, beat.entry.beat), beat.entry.tier);
        const at = `${where(level)} ${beat.entry.beat}${String(beat.entry.tier)}`;
        // The override replaces a big plus in a lane priced by a guard in front or a river...
        expect(base.gates.prize, at).toEqual({ kind: 'add', size: 'big' });
        expect(priced(base, 'prize'), `${at} unguarded`).toBe(true);
        // ...and never with a block behind it: a multiplier lets shots through, so there is no ambush (3.3).
        expect(blockBehind(base, 'prize'), `${at} a multiplier behind an ambush`).toBe(false);
      }
    }
    const first = LEVELS.flatMap((level) => level.beats).find((beat) => beat.entry.prize?.startsWith('x') === true);
    expect(`${String(first?.entry.beat)}${String(first?.entry.tier)}`, 'the first x2: guarded, tier 1').toBe('guard1');
  });

  it('funds its curses inside 3.5, every flip printed and the flip first where it teaches', () => {
    for (const level of LEVELS) {
      const budget = level.config.curses;
      expect(budget, `${where(level)} names a curse budget`).toBeDefined();
      const b = budget ?? -1;
      const top = level.index === 1 ? 0 : level.index <= 3 ? 2 : level.index <= 9 ? 3 : level.frost ? 6 : 5;
      expect(b, where(level)).toBeGreaterThanOrEqual(level.index === 1 ? 0 : 2);
      expect(b, where(level)).toBeLessThanOrEqual(top);
      const slots = level.beats.reduce((sum, beat) => sum + printed(beat.tier), 0);
      expect(slots, `${where(level)} slots enough for the budget`).toBeGreaterThanOrEqual(b);
      expect(level.beats.reduce((sum, beat) => sum + printed(beat.funded), 0), where(level)).toBe(b);
      level.beats.forEach((beat, i) => {
        if (beat.entry.beat !== 'flip') return;
        expect(curses(beat.funded).flip, `${where(level, i)} a flip unfunded`).toBe(1);
      });
      const flips = level.beats.reduce((sum, beat) => sum + curses(beat.funded).flip, 0);
      if (level.index >= 4 && level.index <= 9) {
        expect(flips, `${where(level)} one curse flips`).toBeGreaterThanOrEqual(1);
      }
      if (level.index <= 3 && b > 0) {
        const first = level.beats.find((beat) => printed(beat.funded) > 0);
        expect(first?.entry.beat, `${where(level)} the first curse flips`).toBe('flip');
      }
    }
  });

  it('puts a curse on 35 to 55 percent of gate rows and a price on at least 70 percent of prizes', () => {
    for (const frost of [false, true]) {
      const biome = LEVELS.filter((level) => level.frost === frost).flatMap((level) => level.beats);
      const label = frost ? 'Frostfell' : 'Meadow';
      const cursed = biome.filter((beat) => printed(beat.funded) > 0).length / biome.length;
      expect(cursed, `${label} rows with a curse`).toBeGreaterThanOrEqual(CURSE_SHARE[0]);
      expect(cursed, `${label} rows with a curse`).toBeLessThanOrEqual(CURSE_SHARE[1]);
      const unpriced = biome.filter((beat) => !priced(beat.tier, 'prize')).length / biome.length;
      expect(unpriced, `${label} prizes with no price`).toBeLessThanOrEqual(UNPRICED_MAX);
    }
  });

  it('fences where a level calls for a commit, and a milestone twice', () => {
    for (const level of LEVELS) {
      const fences = level.beats.filter((beat) => (beat.tier.fence ?? null) !== null).length;
      // Frostfell teaches its new kinds on an open road; a release breathes.
      const quiet = level.index < balance.walls.fromLevel || level.release || (level.frost && level.teach);
      expect(fences, `${where(level)} fences`).toBe(level.milestone ? 2 : quiet ? 0 : 1);
    }
  });

  it('keeps the rhythm: open first, rests between threats, a set piece before a milestone prep, a breath after', () => {
    for (const level of LEVELS) {
      const ids = level.beats.map((beat) => beat.entry.beat);
      expect(ids[0], where(level)).toBe('open');
      expect(ids.indexOf('prep'), `${where(level)} the prep is last and once`).toBe(ids.length - 1);
      let run = 0;
      level.beats.forEach((beat, i) => {
        if (beat.tier.rating === 0) run = 0;
        else if (!NOT_A_THREAT.has(beat.entry.beat)) run++;
        expect(run, `${where(level, i)} threats without a rest`).toBeLessThanOrEqual(MAX_THREAT_RUN);
      });
      if (level.milestone) {
        const piece = level.beats[level.beats.length - 2];
        const big = (piece?.entry.tier ?? 0) >= 4;
        expect(`${String(piece?.entry.beat)} ${String(big)}`, `${where(level)} set piece`).toBe('fence true');
      }
      if (level.release) {
        const opening = level.beats.slice(0, 2).map((beat) => beat.tier.rating);
        expect(Math.max(...opening), `${where(level)} opens with two easy beats`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('introduces a beat at tier 1, and one new threat per level after the first', () => {
    const seen = new Set<string>();
    for (const level of LEVELS) {
      const fresh = new Set<string>();
      level.beats.forEach((beat, i) => {
        const id = beat.entry.beat;
        if (seen.has(id) || fresh.has(id)) return;
        fresh.add(id);
        expect(beat.entry.tier, `${where(level, i)} ${id} is new`).toBe(1);
      });
      const threats = [...fresh].filter((id) => !NOT_A_THREAT.has(id));
      if (level.index > 1) expect(threats.length, `${where(level)} new: ${threats.join(' ')}`).toBeLessThanOrEqual(1);
      for (const id of fresh) seen.add(id);
    }
    expect([...seen].sort(), 'every Phase 1 beat is used').toEqual([...PHASE_ONE].sort());
  });

  it('climbs: blocks of five rise, a milestone spikes over its neighbours, the level after breathes', () => {
    for (const first of [1, FROST_FROM]) {
      let last = 0;
      for (let block = 0; block < 4; block++) {
        const from = first + 5 * block;
        const mean = meanTier(LEVELS.slice(from - 1, from + 4));
        expect(mean, `levels ${String(from)} to ${String(from + 4)}`).toBeGreaterThan(last);
        last = mean;
      }
    }
    for (const frost of [false, true]) {
      const biome = LEVELS.filter((level) => level.frost === frost);
      const spike = biome.find((level) => level.milestone);
      // An ordinary level stays under the biome's first spike until it is met, then
      // never above the last spike, and tier 5 is a milestone's alone.
      let ceiling = (spike === undefined ? 5 : topTier(spike)) - 1;
      for (const level of biome) {
        if (level.milestone) {
          ceiling = topTier(level);
          continue;
        }
        expect(topTier(level), `${where(level)} top tier`).toBeLessThanOrEqual(Math.min(4, ceiling));
      }
    }
    for (const level of LEVELS.filter((l) => l.milestone)) {
      const mine = meanTier([level]);
      for (const back of [2, 3]) {
        const before = LEVELS[level.index - back];
        if (before === undefined) continue;
        expect(mine, `${where(level)} over ${where(before)}`).toBeGreaterThan(meanTier([before]));
      }
      const after = LEVELS[level.index];
      if (after !== undefined) expect(meanTier([after]), `${where(after)} breathes`).toBeLessThan(mine);
    }
  });

  it('keeps the expected squad under about 350 until the last two beats', () => {
    for (const level of LEVELS) {
      const trim = level.config.curveTrim ?? 1;
      // The composer's own target: never above the pool's ceiling.
      const target = Math.min(balance.squad.maxCount, level.config.peakTarget * trim);
      const curve = solveCurve(
        level.config.startCount,
        level.beats.map((beat) => ({
          prize: beat.funded.gates.prize,
          prizeU: 0.5,
          expectLoss: beat.tier.expectLoss,
        })),
        target,
        beats,
      );
      const last = curve.expected[curve.expected.length - 1] ?? 0;
      expect(Math.abs(last - target) / target, `${where(level)} the gates carry the curve`).toBeLessThan(0.01);
      const early = Math.max(...curve.expected.slice(0, -2));
      expect(early, `${where(level)} E before the last two beats`).toBeLessThanOrEqual(EARLY_E_MAX);
    }
  });
});
