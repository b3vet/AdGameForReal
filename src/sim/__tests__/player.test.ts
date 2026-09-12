/**
 * The meta layer's arithmetic (D33, D35): what an upgrade is worth inside a
 * run, what it costs, and what a finished run pays.
 */

import { describe, expect, it } from 'vitest';

import { generateLevel } from '../level';
import {
  emptyPlayer,
  familiarPrice,
  maxUpgradeLevel,
  nextUpgradeCost,
  playerMods,
  progression,
  runRewards,
  staffPrices,
  upgradeCost,
  upgradeIds,
  NO_MODS,
} from '../player';
import { Run } from '../Run';
import { weaponDef } from '../weapons';
import { level, play, row, runOf, testBalance, withFamiliar, withStaff, withUpgrade } from './fixtures';
import { balance, levelConfig } from '@/data';

const EFFECTS = progression.upgrades.effects;

describe('upgrade prices', () => {
  it('charges 50 coins times 1.35 per level, to a ceiling of ten', () => {
    expect(progression.upgrades.baseCost).toBe(50);
    expect(progression.upgrades.costGrowth).toBe(1.35);
    expect(maxUpgradeLevel).toBe(10);
    expect(upgradeCost(0)).toBe(50);
    expect(upgradeCost(1)).toBe(68);
    expect(upgradeCost(9)).toBe(Math.round(50 * Math.pow(1.35, 9)));

    const player = emptyPlayer();
    expect(nextUpgradeCost(player, 'damage')).toBe(50);
    player.upgrades.damage = maxUpgradeLevel;
    expect(nextUpgradeCost(player, 'damage')).toBeNull();
  });

  it('prices every staff and every wisp tier', () => {
    expect(staffPrices('ember').unlock).toBe(0);
    for (const id of ['storm', 'frost'] as const) {
      expect(staffPrices(id).unlock).toBeGreaterThan(0);
      expect(staffPrices(id).evolve).toBeGreaterThan(staffPrices(id).unlock);
    }
    expect(familiarPrice(0)).toBe(0);
    expect(familiarPrice(1)).toBe(progression.wisp.unlock);
    expect(familiarPrice(3)).toBeGreaterThan(familiarPrice(2));
    expect(familiarPrice(2)).toBeGreaterThan(familiarPrice(1));
  });
});

describe('rewards', () => {
  it('pays a survivor each, plus the level on a clear and again on a first clear', () => {
    const won = { status: 'won', survivors: 120 };
    expect(runRewards(won, 3, false).coins).toBe(120 + 25 * 3);
    expect(runRewards(won, 3, true).coins).toBe(120 + 25 * 3 + 100 * 3);
    // A lost run leaves no survivors, so it pays nothing at all.
    expect(runRewards({ status: 'lost', survivors: 0 }, 9, true).coins).toBe(0);
  });

  it('pays nothing for a run that is still going', () => {
    // `survivors` is the live squad while a run is under way, so a screen that
    // let the player walk out of a level would otherwise turn "take the fat
    // gate, then leave" into the best rate in the game.
    expect(runRewards({ status: 'running', survivors: 300 }, 5, true).coins).toBe(0);
  });
});

describe('upgrade effects', () => {
  it('resolves nothing bought to the identity', () => {
    const mods = playerMods(emptyPlayer());
    expect(mods).toEqual(NO_MODS);
    expect(playerMods()).toBe(NO_MODS);
  });

  it('raises the squad\'s damage and fire rate by the levels bought', () => {
    const def = level({ startCount: 10 });
    const base = new Run(def, balance).state.squad;
    const strong = new Run(def, balance, withUpgrade('damage', 10)).state.squad;
    const fast = new Run(def, balance, withUpgrade('fireRate', 10)).state.squad;

    expect(strong.damage).toBeCloseTo(base.damage * (1 + EFFECTS.damage * 10), 9);
    expect(fast.fireRate).toBeCloseTo(base.fireRate * (1 + EFFECTS.fireRate * 10), 9);
    // One dial each: the damage upgrade does not quietly buy fire rate.
    expect(strong.fireRate).toBe(base.fireRate);
    expect(fast.damage).toBe(base.damage);
  });

  it('hands the squad an extra unit per level of the starting upgrade', () => {
    const config = levelConfig(4);
    const base = generateLevel(4, config, 7);
    const bigger = generateLevel(4, config, 7, withUpgrade('startCount', 6));
    expect(bigger.startCount).toBe(base.startCount + 6);
    // The level itself is untouched: same rows, same gates, same streams.
    expect(JSON.stringify(bigger.rows)).toBe(JSON.stringify(base.rows));
  });

  it('prints bigger add gates with the gate-bonus upgrade, and touches nothing else', () => {
    const config = levelConfig(6);
    const base = generateLevel(6, config, 3);
    const rich = generateLevel(6, config, 3, withUpgrade('gateBonus', 10));
    const bonus = 1 + EFFECTS.gateBonus * 10;

    let compared = 0;
    base.rows.forEach((baseRow, i) => {
      const richRow = rich.rows[i];
      if (richRow === undefined) throw new Error('row mismatch');
      baseRow.gates.forEach((gate, slot) => {
        const other = richRow.gates[slot];
        if (gate === null || other === null || other === undefined) {
          expect(other ?? null).toEqual(gate);
          return;
        }
        expect(other.kind).toBe(gate.kind);
        if (gate.kind !== 'add') {
          expect(other.value).toBe(gate.value);
          return;
        }
        compared++;
        expect(other.value).toBe(Math.max(1, Math.round(gate.value * bonus)));
        expect(other.cap ?? 0).toBeGreaterThanOrEqual(gate.cap ?? 0);
      });
    });
    expect(compared).toBeGreaterThan(3);
  });

  it('hits the boss harder with the boss-damage upgrade, and only the boss', () => {
    const arena = (player?: ReturnType<typeof withUpgrade>): number => {
      const def = level({ startCount: 100, rows: [], arenaZ: 4, boss: { hp: 400_000, units: 40_000 } });
      const run = player === undefined ? runOf(def) : new Run(def, testBalance(), player);
      play(run, 12, 0);
      return (run.state.boss?.maxHp ?? 0) - (run.state.boss?.hp ?? 0);
    };
    const plain = arena();
    const heavy = arena(withUpgrade('bossDamage', 10));
    expect(heavy / plain).toBeCloseTo(1 + EFFECTS.bossDamage * 10, 1);

    // A block is not a boss: the same upgrade does nothing to it.
    const block = (player?: ReturnType<typeof withUpgrade>): number => {
      const def = level({
        startCount: 20,
        rows: [row(30, [null, null, null], [{ kind: 'brute', lane: 0, units: 400 }])],
      });
      const run = player === undefined ? runOf(def) : new Run(def, testBalance(), player);
      play(run, 3, 0);
      const enemy = run.state.enemies[0];
      return (enemy?.maxHp ?? 0) - (enemy?.hp ?? 0);
    };
    expect(block(withUpgrade('bossDamage', 10))).toBe(block());
  });

  it('starts the run on the staff the player chose', () => {
    const def = level({ startCount: 10 });
    expect(new Run(def, balance).state.squad.weaponId).toBe('ember');
    const storm = new Run(def, balance, withStaff('storm', 1)).state;
    expect(storm.squad.weaponId).toBe('storm');
    expect(storm.squad.damage).toBeCloseTo(balance.squad.damage * weaponDef('storm').damage, 9);

    // A staff the player has selected but never bought is not in their hand.
    const player = emptyPlayer();
    player.selectedStaff = 'frost';
    expect(new Run(def, balance, player).state.squad.weaponId).toBe('ember');
  });

  it('gives the run a wisp only when the Sanctum sold one', () => {
    const def = level({ startCount: 10 });
    expect(new Run(def, balance).state.familiar).toBeNull();
    const withWisp = new Run(def, balance, withFamiliar(2)).state.familiar;
    expect(withWisp?.tier).toBe(2);
    // Unlocked is what counts: a tier with the room still locked is no wisp.
    const locked = emptyPlayer();
    locked.familiar = { unlocked: false, tier: 3 };
    expect(new Run(def, balance, locked).state.familiar).toBeNull();
  });

  it('names five upgrades and prices each of them the same way', () => {
    expect([...upgradeIds]).toEqual(['damage', 'fireRate', 'startCount', 'gateBonus', 'bossDamage']);
    for (const id of upgradeIds) expect(EFFECTS[id]).toBeGreaterThan(0);
  });
});
