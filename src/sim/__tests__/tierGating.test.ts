/**
 * What an evolution tier *is* (D54): the number the Workbench sells, and the
 * mechanics it switches on.
 *
 * The companion to `./tiers.test.ts`, which is about what each mechanic *does*.
 * Split from it for the file-size rule (CLAUDE.md) on the seam the milestone
 * has: this half is the gate — a player at tier 0 resolves to the run the
 * campaign's bands were measured on, whatever the shop has learned to sell —
 * and the last two tests are the other side of the same promise, that a tier
 * the player has bought is not quietly off either.
 */

import { describe, expect, it } from 'vitest';

import { createBot } from '../bots';
import { hasEvolution, heldEvolutions } from '../evolutions';
import { generateLevel } from '../level';
import { emptyPlayer, playerMods, NO_MODS } from '../player';
import { Run } from '../Run';
import type { SimEvent } from '../types';
import { withStaff } from './fixtures';
import { balance, levelConfig } from '@/data';
import type { EvolutionMechanic, EvolutionTier, StaffTier, WeaponId } from '@/data/types';

describe('tier gating', () => {
  it('reads a staff tier as the evolutions held: 0 for a plain staff, 3 for a maxed one', () => {
    expect(playerMods(emptyPlayer()).tiers).toEqual({ ember: 0, storm: 0, frost: 0 });
    expect(playerMods()).toBe(NO_MODS);
    expect(playerMods(withStaff('ember', 1)).tiers.ember).toBe(0);
    expect(playerMods(withStaff('ember', 2)).tiers.ember).toBe(1);
    expect(playerMods(withStaff('ember', 4)).tiers.ember).toBe(3);
    // A tier on a staff nobody owns is worth nothing, the same rule the save
    // repairs a file with.
    const locked = emptyPlayer();
    locked.staffs.storm = { unlocked: false, tier: 4 };
    expect(playerMods(locked).tiers.storm).toBe(0);
  });

  it('switches each of the six on at exactly one tier, and never below it', () => {
    const rungs: ReadonlyArray<[WeaponId, EvolutionMechanic, StaffTier]> = [
      ['ember', 'wildfire', 3],
      ['ember', 'meteor', 4],
      ['storm', 'fullChains', 3],
      ['storm', 'overcharge', 4],
      ['frost', 'freezePulse', 3],
      ['frost', 'glacier', 4],
    ];
    for (const [id, mechanic, staffTier] of rungs) {
      for (let tier = 1; tier <= 4; tier++) {
        const held = tier - 1;
        const where = `${id} ${mechanic} at staff tier ${String(tier)}`;
        expect(`${where} ${String(hasEvolution(id, held as EvolutionTier, mechanic))}`).toBe(
          `${where} ${String(tier >= staffTier)}`,
        );
      }
    }
  });

  it('resolves a player with nothing bought to none of them at all', () => {
    const held = heldEvolutions(NO_MODS);
    expect(held.burn).toBeNull();
    expect(held.shatter).toBeNull();
    expect(held.extraChains).toEqual({ ember: 0, storm: 0, frost: 0 });
    const flagSets = [
      held.wildfire,
      held.meteor,
      held.fullChains,
      held.overcharge,
      held.freezePulse,
      held.glacier,
    ];
    for (const flags of flagSets) {
      expect(flags).toEqual({ ember: false, storm: false, frost: false });
    }
    // And the Milestone 4 evolution is still exactly staff tier 2.
    expect(heldEvolutions(playerMods(withStaff('ember', 2))).burn).not.toBeNull();
    expect(heldEvolutions(playerMods(withStaff('frost', 2))).shatter).not.toBeNull();
    expect(heldEvolutions(playerMods(withStaff('storm', 2))).extraChains.storm).toBeGreaterThan(0);
  });
});

describe('a run with the tiers on', () => {
  it('replays step for step from the same inputs, on a real road', () => {
    // The determinism contract (CLAUDE.md) over everything D54 adds: a meteor's
    // clock, a wildfire's hop, an overcharge's beat and a wall of ice are all
    // functions of the state and the fixed step, and not one of them reaches
    // for a wall clock or an unseeded random. Played on a Frostfell level
    // rather than a hand-made one, so the rivers, the chargers and the boss are
    // all in it with them.
    for (const staff of ['ember', 'storm', 'frost'] as const) {
      const player = withStaff(staff, 4);
      const config = levelConfig(25);
      const seed = 3;
      const a = new Run(generateLevel(25, config, seed, player), balance, player);
      const b = new Run(generateLevel(25, config, seed, player), balance, player);
      const botA = createBot('greedy', seed);
      const botB = createBot('greedy', seed);
      for (let step = 0; step < 1800; step++) {
        a.setTargetX(botA(a.state));
        a.tick(1 / 60);
        b.setTargetX(botB(b.state));
        b.tick(1 / 60);
      }
      expect(`${staff} ${JSON.stringify(b.state)}`).toBe(`${staff} ${JSON.stringify(a.state)}`);
    }
  }, 60_000);

  it('fires every mechanic the player holds somewhere on that road', () => {
    // The companion to the gating tests: those say a tier is off below its
    // rung, and this says the six are not quietly off *above* it either.
    const seen = new Set<string>();
    for (const staff of ['ember', 'storm', 'frost'] as const) {
      const player = withStaff(staff, 4);
      const run = new Run(generateLevel(25, levelConfig(25), 3, player), balance, player);
      const bot = createBot('greedy', 3);
      for (let step = 0; step < 3600 && run.state.status === 'running'; step++) {
        run.setTargetX(bot(run.state));
        for (const event of run.tick(1 / 60)) seen.add(event.type);
      }
    }
    for (const type of ['enemyBurning', 'meteor', 'overcharge', 'freezePulse', 'glacier']) {
      expect(`${type} fired ${String(seen.has(type as SimEvent['type']))}`).toBe(`${type} fired true`);
    }
  }, 60_000);
});
