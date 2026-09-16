import { describe, expect, it } from 'vitest';

import { beat, ORDINARY, scripted, testLibrary } from './beatFixtures';
import { withUpgrade } from './fixtures';
import { printRound } from '../beats/beatSize';
import { staffDemand, staffHosts } from '../beats/budgets';
import { composeLevel, resolveScript } from '../beats/compose';
import { forkGap } from '../beats/roles';
import { findBeat, resolveTier } from '../beats/library';
import { generateLevel } from '../level';
import type { LevelDef } from '../level';
import { weaponBudget } from '../levelPasses';
import type { Lane } from '../types';
import { balance, beats, levelConfig, levelCount } from '@/data';
import type { LevelGenConfig, ScriptBeat } from '@/data/types';

const SPACING = balance.level.rowSpacing;

function compose(config: LevelGenConfig, seed = config.seed): LevelDef {
  return composeLevel(config.index, config, seed, undefined, testLibrary, []);
}

function gateRows(level: LevelDef): number[] {
  return level.rows.flatMap((row, index) => (row.gates.some((g) => g !== null) ? [index] : []));
}

describe('composer: rows and marks', () => {
  const level = compose(scripted(8, ORDINARY));

  it('lays every beat as a lead-in row and a gate row, 18 m apart', () => {
    expect(level.rows).toHaveLength(ORDINARY.length * 2);
    level.rows.forEach((row, index) => expect(row.z).toBe(SPACING * (index + 1)));
    // Only the second row of each beat carries panels.
    expect(gateRows(level)).toEqual(ORDINARY.map((_, k) => 2 * k + 1));
    expect(level.arenaZ).toBe(SPACING * (level.rows.length + 1));
  });

  it('marks each beat at its gate row with its tier and prize lane', () => {
    expect(level.beats?.map((mark) => mark.beat)).toEqual(ORDINARY.map((entry) => entry.beat));
    level.beats?.forEach((mark, k) => {
      expect(mark.z).toBe(SPACING * (2 * k + 2));
      expect(mark.tier).toBe(ORDINARY[k]?.tier);
      const gate = level.rows[2 * k + 1]?.gates[mark.prize + 1];
      // The prize is the beat's best panel; on the fixture that is a plus.
      expect(gate?.kind).toBe('add');
    });
    expect(level.squadRates).toBe(true);
  });

  it('stands threats at their anchor: in front on the lead-in row, behind on the gate row', () => {
    const marks = level.beats ?? [];
    const guardAt = marks.findIndex((mark) => mark.beat === 'guard');
    const guardMark = marks[guardAt];
    const lead = level.rows[2 * guardAt];
    const guardBlock = lead?.enemies[0];
    expect(guardBlock?.kind).toBe('brute');
    expect((lead?.z ?? 0) + (guardBlock?.dz ?? 0)).toBe((guardMark?.z ?? 0) - 8);
    expect(guardBlock?.lane).toBe(guardMark?.prize);

    const ambushAt = marks.findIndex((mark) => mark.beat === 'ambush');
    const ambushMark = marks[ambushAt];
    const gateRow = level.rows[2 * ambushAt + 1];
    const ambushBlock = gateRow?.enemies[0];
    expect((gateRow?.z ?? 0) + (ambushBlock?.dz ?? 0)).toBe((ambushMark?.z ?? 0) + 5);
    // Behind a plus: held to its own lane so the panel screens all of it.
    expect(ambushBlock?.maxHalf).toBe(balance.road.laneWidth / 2 - balance.projectiles.radius);
    expect(guardBlock?.maxHalf).toBeUndefined();

    const tollAt = marks.findIndex((mark) => mark.beat === 'toll');
    const river = level.rows[2 * tollAt + 1]?.streams?.[0];
    expect(river?.anchorZ).toBe((marks[tollAt]?.z ?? 0) + 8);
    expect(river?.openAt).toBe(50);
    expect(river?.lane).toBe(marks[tollAt]?.prize);
  });

  it('dispatches from generateLevel on the script, and deals a config without one', () => {
    const config = scripted(3, [beat('open'), beat('open')]);
    const viaGenerate = generateLevel(3, config);
    expect(viaGenerate.beats).toBeDefined();
    const { script: _script, ...recipe } = levelConfig(1);
    const dealt = generateLevel(1, recipe);
    expect(dealt.beats).toBeUndefined();
    expect(dealt.squadRates).toBeUndefined();
  });
});

describe('composer: roles', () => {
  const long: ScriptBeat[] = Array.from({ length: 9 }, () => beat('open'));

  it('draws the prize lane from the seed, and the same seed draws it again', () => {
    const seen = new Set<Lane>();
    for (let seed = 1; seed <= 30; seed++) {
      const level = compose(scripted(8, long), seed);
      for (const mark of level.beats ?? []) seen.add(mark.prize);
      expect(compose(scripted(8, long), seed)).toEqual(level);
    }
    expect([...seen].sort()).toEqual([-1, 0, 1]);
    const a = compose(scripted(8, long), 1).beats?.map((mark) => mark.prize);
    const b = compose(scripted(8, long), 2).beats?.map((mark) => mark.prize);
    expect(a).not.toEqual(b);
  });

  it('never puts the prize in the same lane three beats running', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const prizes = (compose(scripted(8, long), seed).beats ?? []).map((mark) => mark.prize);
      for (let k = 2; k < prizes.length; k++) {
        const run = prizes[k] === prizes[k - 1] && prizes[k] === prizes[k - 2];
        expect(run, `seed ${String(seed)} beat ${String(k)}`).toBe(false);
      }
    }
  });

  it('puts a fence beat\'s outer lane on a side and the fence on its boundary', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const level = compose(scripted(8, [beat('open'), beat('fence')]), seed);
      const mark = level.beats?.[1];
      expect(mark?.prize).not.toBe(0);
      expect(level.walls).toHaveLength(1);
      const wall = level.walls?.[0];
      expect(wall?.boundary).toBe(mark?.prize);
      expect(wall?.zStart).toBe((mark?.z ?? 0) - 20);
      expect(wall?.zEnd).toBe((mark?.z ?? 0) - balance.walls.gateGap);
    }
  });

  it('never leaves a fork\'s riverless lane in the middle twice running', () => {
    const forks: ScriptBeat[] = [beat('fork'), beat('fork'), beat('fork'), beat('fork'), beat('fork')];
    for (let seed = 1; seed <= 200; seed++) {
      const level = compose(scripted(8, forks), seed);
      // The fork's portals stand in front of the panels, on each lead-in row.
      const gaps = level.rows
        .filter((_, index) => index % 2 === 0)
        .map((lead) => {
          const poured = new Set((lead.streams ?? []).map((s) => s.lane));
          expect(poured.size).toBe(2);
          return ([-1, 0, 1] as Lane[]).find((lane) => !poured.has(lane));
        });
      for (let k = 1; k < gaps.length; k++) {
        expect(gaps[k] === 0 && gaps[k - 1] === 0, `seed ${String(seed)}`).toBe(false);
      }
    }
  });

  it('knows a fork by its id and finds the lane it leaves unthreatened', () => {
    const tierOf = (id: string, tier = 1) => resolveTier(findBeat(testLibrary, id), tier);
    expect(forkGap('fork', tierOf('fork'))).toBe('other');
    expect(forkGap('chargeFork', tierOf('chargeFork'))).toBe('other');
    // A prep beat that pours two rivers is not a fork.
    const prep = { ...tierOf('prep'), rivers: tierOf('fork').rivers };
    expect(forkGap('prep', prep)).toBeNull();
    expect(forkGap('toll', tierOf('toll'))).toBeNull();
    // The shipped forks, every tier.
    for (const id of ['fork', 'chargeFork']) {
      const def = beats.defs.find((d) => d.id === id);
      for (const tier of Object.keys(def?.tiers ?? {})) {
        if (def !== undefined) expect(forkGap(id, resolveTier(def, Number(tier))), `${id} ${tier}`).toBe('other');
      }
    }
  });

  it('keeps a charger fork\'s curse out of the middle twice running', () => {
    const forks: ScriptBeat[] = Array.from({ length: 5 }, () => beat('chargeFork'));
    for (let seed = 1; seed <= 100; seed++) {
      const level = compose(scripted(21, forks), seed);
      const gaps = level.rows
        .filter((_, index) => index % 2 === 1)
        .map((row) => row.gates.findIndex((g) => g?.kind === 'sub') - 1);
      for (let k = 1; k < gaps.length; k++) {
        expect(gaps[k] === 0 && gaps[k - 1] === 0, `seed ${String(seed)}`).toBe(false);
      }
    }
  });

  it('spreads chargers over their lanes and gives them the beat\'s wake and bite', () => {
    const level = compose(scripted(21, [beat('open'), beat('chargeFork')], { biome: 'frost' }));
    const lead = level.rows[2];
    expect(lead?.enemies).toHaveLength(2);
    const lanes = new Set(lead?.enemies.map((e) => e.lane));
    expect(lanes.size).toBe(2);
    for (const enemy of lead?.enemies ?? []) {
      expect(enemy.kind).toBe('charger');
      expect(enemy.wake).toBe(30);
      expect(enemy.killShare).toBe(balance.enemies.beat.chargerKillShare);
    }
  });
});

describe('composer: budgets', () => {
  it('refuses more multipliers than the level allows', () => {
    const one = [beat('open'), beat('guard', 1, 'x2'), beat('prep')];
    const two = [beat('open'), beat('guard', 1, 'x2'), beat('guard', 1, 'x2'), beat('prep')];
    expect(() => compose(scripted(1, one))).toThrow(/level 1: .*allows 0/);
    expect(() => compose(scripted(5, one))).not.toThrow();
    expect(() => compose(scripted(5, two))).toThrow(/level 5: .*2 multipliers.*allows 1/);
    expect(() => compose(scripted(12, two))).not.toThrow();
  });

  it('refuses a x3 before x3s are allowed', () => {
    const x3 = [beat('open'), beat('guard', 1, 'x3'), beat('prep')];
    expect(() => compose(scripted(12, x3))).toThrow(/x3/);
    expect(() => compose(scripted(13, x3))).not.toThrow();
  });

  it('names a missing beat or tier with the level', () => {
    expect(() => compose(scripted(4, [beat('nope')]))).toThrow(/level 4: beat "nope"/);
    expect(() => compose(scripted(4, [beat('open', 3)]))).toThrow(/level 4: beat "open" has no tier 3/);
  });

  const curses = (level: LevelDef): number =>
    level.rows.reduce((sum, row) => sum + row.gates.filter((g) => g?.kind === 'sub').length, 0);

  it('spends the curse budget flips first, and prints a small plus for the rest', () => {
    const script = [beat('open'), beat('guard'), beat('flip'), beat('fork'), beat('prep')];
    expect(curses(compose(scripted(8, script)))).toBe(4);
    expect(curses(compose(scripted(8, script, { curses: 0 })))).toBe(0);

    const one = compose(scripted(8, script, { curses: 1 }));
    expect(curses(one)).toBe(1);
    const flipRow = one.rows[5];
    const flipCurse = flipRow?.gates.find((g) => g?.kind === 'sub');
    // The flip prints 7 percent of E, the price curses 15.
    const e = one.beats?.[2]?.expected ?? 0;
    expect(flipCurse?.value).toBe(printRound(e * 0.07));

    // The next funded slot is the highest-rated price curse: the fork's.
    const two = compose(scripted(8, script, { curses: 2 }));
    expect(two.rows[7]?.gates.some((g) => g?.kind === 'sub')).toBe(true);
    expect(two.rows[3]?.gates.some((g) => g?.kind === 'sub')).toBe(false);
  });
});

function staffsOf(level: LevelDef): Array<{ beat: number; lane: Lane }> {
  const staffs: Array<{ beat: number; lane: Lane }> = [];
  level.rows.forEach((row, index) =>
    row.gates.forEach((gate, slot) => {
      if (gate?.kind === 'weapon') staffs.push({ beat: (index - 1) / 2, lane: (slot - 1) as Lane });
    }),
  );
  return staffs;
}

describe('composer: passes', () => {
  it('stands staff gates only on open and rest beats past the first, one each, beside a plus', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const level = compose(scripted(8, ORDINARY), seed);
      const staffs = staffsOf(level);
      expect(staffs).toHaveLength(weaponBudget(8));
      expect(new Set(staffs.map((staff) => staff.beat)).size).toBe(staffs.length);
      for (const staff of staffs) {
        const mark = level.beats?.[staff.beat];
        expect(staff.beat).toBeGreaterThan(0);
        expect(['open', 'rest']).toContain(mark?.beat);
        expect(staff.lane).not.toBe(mark?.prize);
        // The rest gives up its fire rate, the open its smaller plus.
        const row = level.rows[2 * staff.beat + 1];
        const beside = row?.gates.filter((g, slot) => slot - 1 !== mark?.prize && g?.kind !== 'weapon');
        expect(beside?.[0]?.kind).toBe('add');
      }
    }
  });

  it('offers no more staffs than the level has hosts, and carries the rest on', () => {
    const one = [beat('open'), beat('guard'), beat('rest'), beat('prep')];
    expect(staffsOf(compose(scripted(8, one)))).toHaveLength(1);
    expect(staffsOf(compose(scripted(8, [beat('open'), beat('guard'), beat('prep')])))).toHaveLength(0);
    // Two short on level 5, which has a single host: level 6 is asked for four.
    const campaign = [scripted(5, one), scripted(6, ORDINARY)];
    expect(staffDemand(6, campaign)).toBe(weaponBudget(6) + weaponBudget(5) - 1);
    expect(staffDemand(6, [])).toBe(weaponBudget(6));
    expect(staffHosts(ORDINARY)).toEqual([3, 6]);
  });

  it('applies the gate-bonus upgrade to plus panels only', () => {
    const config = scripted(8, ORDINARY);
    const plain = composeLevel(8, config, config.seed, undefined, testLibrary, []);
    const bonus = composeLevel(8, config, config.seed, withUpgrade('gateBonus', 3), testLibrary, []);
    plain.rows.forEach((row, r) =>
      row.gates.forEach((gate, slot) => {
        const other = bonus.rows[r]?.gates[slot];
        if (gate?.kind === 'add') expect(other?.value ?? 0).toBeGreaterThanOrEqual(gate.value);
        else expect(other).toEqual(gate);
      }),
    );
  });
});

describe('composer: the shipped scripts', () => {
  const scriptedLevels = Array.from({ length: levelCount }, (_, i) => i + 1).filter(
    (index) => levelConfig(index).script !== undefined,
  );

  it.skipIf(scriptedLevels.length === 0)('composes every scripted level, the same way twice', () => {
    for (const index of scriptedLevels) {
      const config = levelConfig(index);
      const level = generateLevel(index, config);
      expect(level.beats?.length, `level ${String(index)}`).toBe(config.script?.length);
      expect(generateLevel(index, config)).toEqual(level);
      for (const mark of level.beats ?? []) {
        expect(mark.expected).toBeLessThanOrEqual(balance.squad.maxCount);
      }
    }
  });

  it.skipIf(scriptedLevels.length === 0)('never lets a staff take a designed plus, a curse or a fence\'s inner plus', () => {
    const plus = new Set(['add', 'mul', 'fireRate']);
    for (const index of scriptedLevels) {
      const config = levelConfig(index);
      const script = config.script ?? [];
      const designed = resolveScript(index, script, config.curses, beats);
      const hosts = new Set(staffHosts(script));
      for (const seed of [config.seed, 1, 2, 3]) {
        const level = generateLevel(index, config, seed);
        const where = `level ${String(index)} seed ${String(seed)}`;
        expect(staffsOf(level), where).toHaveLength(Math.min(staffDemand(index), hosts.size));
        designed.forEach((beatDef, k) => {
          const mark = level.beats?.[k];
          const row = level.rows[2 * k + 1];
          if (mark === undefined || row === undefined) throw new Error(where);
          // The prize is marked; the two lanes beside it still carry every
          // kind they were designed with but for at most one staff.
          const staffs = row.gates.filter((g) => g?.kind === 'weapon').length;
          expect(staffs, `${where} beat ${String(k)}`).toBeLessThanOrEqual(hosts.has(k) ? 1 : 0);
          expect(row.gates[mark.prize + 1]?.kind, `${where} beat ${String(k)} prize`).toBe(
            beatDef.tier.gates.prize.kind === 'none' ? undefined : beatDef.tier.gates.prize.kind,
          );
          const beside = row.gates.filter((_, slot) => slot - 1 !== mark.prize);
          const designedBeside = [beatDef.tier.gates.safe, beatDef.tier.gates.other];
          const designedPluses = designedBeside.filter((slot) => plus.has(slot.kind)).length;
          const composedPluses = beside.filter((g) => g !== null && plus.has(g.kind)).length;
          expect(composedPluses, `${where} beat ${String(k)} pluses`).toBe(designedPluses - staffs);
          if (staffs > 0) expect(composedPluses, `${where} beat ${String(k)}`).toBeGreaterThan(0);
          const curses = beside.filter((g) => g?.kind === 'sub').length;
          expect(curses, `${where} beat ${String(k)} curses`).toBe(
            designedBeside.filter((slot) => slot.kind === 'sub').length,
          );
          const fence = beatDef.tier.fence;
          if (fence !== null && fence !== undefined && fence.both !== true) {
            // Every shipped fence stands its prize in the outer lane.
            expect(fence.outer, where).toBe('prize');
            expect(mark.prize, where).not.toBe(0);
            const inner = mark.prize < 0 ? [0, 1] : [-1, 0];
            expect(
              inner.some((lane) => row.gates[lane + 1]?.kind === 'add' || row.gates[lane + 1]?.kind === 'mul'),
              `${where} beat ${String(k)} inner plus`,
            ).toBe(true);
          }
        });
      }
    }
  });

  it.skipIf(scriptedLevels.length === 0)('designs no stretch of road with more river bodies than the ceiling', () => {
    // Counted as if nothing were shot (4.7): the live peak the bots measure is
    // at most this plus the blocks.
    const despawn = balance.streams.despawnBehind;
    for (const index of scriptedLevels) {
      for (const seed of [1, 2, 3]) {
        const streams = generateLevel(index, levelConfig(index), seed).rows.flatMap((row) => row.streams ?? []);
        for (const probe of streams) {
          const at = (probe.anchorZ ?? 0) - (probe.openAt ?? 0);
          let live = 0;
          for (const other of streams) {
            const start = (other.anchorZ ?? 0) - (other.openAt ?? 0);
            if (start <= at && (other.anchorZ ?? 0) + despawn >= at) live += other.count;
          }
          expect(live, `level ${String(index)} seed ${String(seed)}`).toBeLessThanOrEqual(
            balance.enemies.portal.maxLiveBodies,
          );
        }
      }
    }
  });
});
