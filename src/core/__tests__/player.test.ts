/**
 * Purchases. Every one of them is a price the room already showed the player,
 * so the rule under test is always the same: the state that comes back has
 * paid exactly that price, and an offer that cannot be taken comes back null
 * rather than half-applied.
 */

import { describe, expect, it } from 'vitest';

import { balance } from '@/data';
import { weaponOf } from '@/sim';

import {
  buildLevel,
  buildRun,
  addCoins,
  buyFamiliar,
  buyStaff,
  buyUpgrade,
  clonePlayer,
  defaultPlayer,
  familiarCost,
  maxUpgradeLevel,
  rememberSeen,
  roomUnlockLevel,
  selectStaff,
  staffCost,
  upgradeCost,
} from '../player';
import type { PlayerState } from '../player';

function rich(coins = 100_000): PlayerState {
  const player = defaultPlayer();
  player.coins = coins;
  return player;
}

describe('upgrades', () => {
  it('charges the printed price and raises the level by one', () => {
    const player = rich(1000);
    const price = upgradeCost(player, 'damage');
    expect(price).not.toBeNull();

    const next = buyUpgrade(player, 'damage');
    expect(next).not.toBeNull();
    expect(next?.coins).toBe(1000 - (price ?? 0));
    expect(next?.upgrades.damage).toBe(1);
    // The state handed in is untouched: the app decides what to keep.
    expect(player.coins).toBe(1000);
    expect(player.upgrades.damage).toBe(0);
  });

  it('gets more expensive with every level', () => {
    let player = rich();
    let last = 0;
    for (let level = 0; level < maxUpgradeLevel; level++) {
      const price = upgradeCost(player, 'fireRate') ?? 0;
      expect(price).toBeGreaterThan(last);
      last = price;
      const next = buyUpgrade(player, 'fireRate');
      expect(next).not.toBeNull();
      player = next ?? player;
    }
    expect(player.upgrades.fireRate).toBe(maxUpgradeLevel);
    expect(upgradeCost(player, 'fireRate')).toBeNull();
    expect(buyUpgrade(player, 'fireRate')).toBeNull();
  });

  it('refuses a price the purse cannot pay', () => {
    const player = defaultPlayer();
    expect(buyUpgrade(player, 'damage')).toBeNull();
  });
});

describe('staffs', () => {
  it('unlocks, then evolves, then has nothing left to sell', () => {
    let player = rich();

    const unlock = staffCost(player, 'storm');
    const unlocked = buyStaff(player, 'storm');
    expect(unlocked?.staffs.storm).toEqual({ unlocked: true, tier: 1 });
    expect(unlocked?.coins).toBe(100_000 - (unlock ?? 0));
    // Buying a staff is also choosing it.
    expect(unlocked?.selectedStaff).toBe('storm');
    player = unlocked ?? player;

    const evolve = staffCost(player, 'storm');
    expect(evolve).not.toBeNull();
    const evolved = buyStaff(player, 'storm');
    expect(evolved?.staffs.storm).toEqual({ unlocked: true, tier: 2 });
    player = evolved ?? player;

    expect(staffCost(player, 'storm')).toBeNull();
    expect(buyStaff(player, 'storm')).toBeNull();
  });

  it('ember is owned from the start and can still be evolved', () => {
    const player = rich();
    expect(player.staffs.ember.unlocked).toBe(true);
    expect(staffCost(player, 'ember')).toBeGreaterThan(0);
    expect(buyStaff(player, 'ember')?.staffs.ember.tier).toBe(2);
  });

  it('only an owned staff can be put in hand', () => {
    const player = rich();
    expect(selectStaff(player, 'frost')).toBeNull();
    // Already in hand: nothing to do, and the app skips the repaint.
    expect(selectStaff(player, 'ember')).toBeNull();

    const owner = buyStaff(player, 'frost') ?? player;
    const swapped = selectStaff(clonePlayer({ ...owner, selectedStaff: 'ember' }), 'frost');
    expect(swapped?.selectedStaff).toBe('frost');
  });
});

describe('the wisp', () => {
  it('stays shut until the Sanctum level is reached', () => {
    const player = rich();
    player.unlockedLevel = roomUnlockLevel('sanctum') - 1;
    expect(buyFamiliar(player)).toBeNull();
  });

  it('binds at tier 1 and climbs one tier at a time to the last', () => {
    let player = rich();
    player.unlockedLevel = roomUnlockLevel('sanctum');

    const bound = buyFamiliar(player);
    expect(bound?.familiar).toEqual({ unlocked: true, tier: 1 });
    player = bound ?? player;

    for (let tier = 2; tier <= 3; tier++) {
      const price = familiarCost(player);
      expect(price).not.toBeNull();
      const next = buyFamiliar(player);
      expect(next?.familiar.tier).toBe(tier);
      expect(next?.coins).toBe(player.coins - (price ?? 0));
      player = next ?? player;
    }

    expect(familiarCost(player)).toBeNull();
    expect(buyFamiliar(player)).toBeNull();
  });
});

describe('coins and the bestiary', () => {
  it('never lets the purse go below zero', () => {
    expect(addCoins(defaultPlayer(), -50).coins).toBe(0);
    expect(addCoins(defaultPlayer(), 40).coins).toBe(40);
  });

  it('adds only ids that are new', () => {
    const player = defaultPlayer();
    player.bestiary = ['grunt'];

    expect(rememberSeen(player, ['grunt'])).toBeNull();
    expect(rememberSeen(player, [])).toBeNull();
    const next = rememberSeen(player, ['grunt', 'brute', 'brute', 'demon']);
    expect(next?.bestiary).toEqual(['grunt', 'brute', 'demon']);
  });
});

/**
 * The seam this phase owns: the app hands its `PlayerState` to the sim once,
 * at the start of a run (D35). Two things have to arrive — the staff the
 * Workbench put in hand, and the upgrades the Yard was paid for — and a broken
 * hand-off is silent otherwise, because a run with no player is a perfectly
 * good run.
 */
describe('the run the player walks into', () => {
  it('starts with the staff the Workbench put in hand', () => {
    const player = defaultPlayer();
    player.staffs.storm = { unlocked: true, tier: 1 };
    player.selectedStaff = 'storm';

    const run = buildRun(buildLevel(1, 1, player), balance, player);

    expect(weaponOf(run.state.squad)).toBe('storm');
  });

  it('leaves ember in hand when the chosen staff is not owned', () => {
    const player = defaultPlayer();
    player.selectedStaff = 'frost';

    const run = buildRun(buildLevel(1, 1, player), balance, player);

    expect(weaponOf(run.state.squad)).toBe('ember');
  });

  it('starts the level with the recruits the Yard was paid for', () => {
    const plain = defaultPlayer();
    const drilled = defaultPlayer();
    drilled.upgrades.startCount = 3;

    expect(buildLevel(1, 1, drilled).startCount).toBeGreaterThan(
      buildLevel(1, 1, plain).startCount,
    );
  });
});
