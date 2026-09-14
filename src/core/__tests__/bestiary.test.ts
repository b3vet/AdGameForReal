/**
 * Kill counters, the tint ladders they pay, and the Wardrobe that wears them
 * (D53).
 *
 * The rule under test everywhere here is "once": a rung pays its coins and
 * hands over its tint the first time the count crosses it, and never again,
 * however many runs the player walks afterwards.
 */

import { describe, expect, it } from 'vitest';

import { academy } from '@/data/academy-types';
import { NO_COSMETIC, cosmeticDef, cosmetics, killKinds } from '@/data';

import { bestiaryView, creditKills, emptyKills, tiersOf } from '../bestiary';
import type { KillCounts } from '../bestiary';
import { cosmeticSlots, ownCosmetics, selectCosmetic, wardrobeView, wornCosmetic } from '../cosmetics';
import { defaultPlayer } from '../player';
import type { PlayerState } from '../player';

function kills(fields: Partial<KillCounts>): KillCounts {
  return { ...emptyKills(), ...fields };
}

describe('the manifest', () => {
  it('gives every bestiary entry three rising rungs', () => {
    for (const entry of academy.bestiary.entries) {
      const tiers = tiersOf(entry.id);
      expect(tiers).toHaveLength(3);
      expect(tiers[0]?.kills).toBeLessThan(tiers[1]?.kills ?? 0);
      expect(tiers[1]?.kills).toBeLessThan(tiers[2]?.kills ?? 0);
      for (const tier of tiers) {
        expect(tier.coins).toBeGreaterThan(0);
        expect(cosmeticDef(tier.cosmetic)).not.toBeNull();
      }
    }
  });

  it('has a bestiary entry for every kind a kill can be filed under', () => {
    for (const kind of killKinds) {
      expect(academy.bestiary.entries.some((entry) => entry.id === kind)).toBe(true);
    }
  });

  it('offers at least two tints in every slot, each hung off a real rung', () => {
    for (const slot of cosmeticSlots) {
      const entries = cosmetics.entries.filter((entry) => entry.slot === slot);
      expect(entries.length).toBeGreaterThanOrEqual(2);
    }

    for (const entry of cosmetics.entries) {
      const rungs = tiersOf(entry.unlockedBy.kind);
      const rung = rungs[entry.unlockedBy.tier - 1];
      expect(rung?.cosmetic).toBe(entry.id);
      // A tint is a palette role or three multipliers, and nothing else.
      if (typeof entry.tint === 'string') expect(entry.tint.length).toBeGreaterThan(0);
      else expect(entry.tint).toHaveLength(3);
    }
  });

  it('never hangs two tints off one rung', () => {
    const seen = new Set<string>();
    for (const entry of cosmetics.entries) {
      const key = `${entry.unlockedBy.kind}:${String(entry.unlockedBy.tier)}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});

describe('crediting kills', () => {
  it('adds the run to the totals and leaves the rungs alone below them', () => {
    const outcome = creditKills(kills({ grunt: 10 }), kills({ grunt: 5, brute: 2 }), []);
    expect(outcome.kills.grunt).toBe(15);
    expect(outcome.kills.brute).toBe(2);
    expect(outcome.coins).toBe(0);
    expect(outcome.awards).toEqual([]);
    expect(outcome.unlocked).toEqual([]);
  });

  it('pays a rung on the run that crosses it, and never again', () => {
    const rung = tiersOf('brute')[0];
    expect(rung).toBeDefined();
    if (rung === undefined) return;

    const before = kills({ brute: rung.kills - 1 });
    const crossing = creditKills(before, kills({ brute: 1 }), []);
    expect(crossing.coins).toBe(rung.coins);
    expect(crossing.unlocked).toEqual([rung.cosmetic]);
    expect(crossing.awards[0]).toMatchObject({ kind: 'brute', tier: 1, coins: rung.coins });

    const after = creditKills(crossing.kills, kills({ brute: 3 }), crossing.unlocked);
    expect(after.coins).toBe(0);
    expect(after.unlocked).toEqual([]);
  });

  it('pays every rung a single hand-edited jump crosses', () => {
    const rungs = tiersOf('rime');
    const outcome = creditKills(emptyKills(), kills({ rime: 9999 }), []);
    expect(outcome.awards.map((award) => award.tier)).toEqual([1, 2, 3]);
    expect(outcome.coins).toBe(rungs.reduce((total, tier) => total + tier.coins, 0));
    expect(outcome.unlocked).toHaveLength(3);
  });

  it('does not hand over a tint the player already owns', () => {
    const rung = tiersOf('grunt')[0];
    if (rung === undefined) return;
    const outcome = creditKills(emptyKills(), kills({ grunt: rung.kills }), [rung.cosmetic]);
    // The coins are still owed — a rung is a payment, not only a hat — but the
    // id is not added to `owned` twice.
    expect(outcome.coins).toBe(rung.coins);
    expect(outcome.unlocked).toEqual([]);
  });
});

describe('the bestiary view', () => {
  it('names the next rung and counts down to it', () => {
    const rung = tiersOf('grunt')[0];
    if (rung === undefined) return;
    const view = bestiaryView(kills({ grunt: rung.kills - 10 }), ['grunt']);
    const entry = view.find((candidate) => candidate.id === 'grunt');
    expect(entry).toBeDefined();
    expect(entry?.seen).toBe(true);
    expect(entry?.kills).toBe(rung.kills - 10);
    expect(entry?.countLabel).toContain(String(rung.kills - 10));
    expect(entry?.nextLabel).toContain('10');
    expect(entry?.nextLabel).toContain(cosmeticDef(rung.cosmetic)?.name ?? '');
    expect(entry?.tiers.map((tier) => tier.taken)).toEqual([false, false, false]);
  });

  it('says so once the ladder is finished', () => {
    const view = bestiaryView(kills({ demon: 99999 }), ['demon']);
    const entry = view.find((candidate) => candidate.id === 'demon');
    expect(entry?.nextLabel).toBe(academy.bestiary.maxedLabel);
    expect(entry?.tiers.map((tier) => tier.taken)).toEqual([true, true, true]);
  });

  it('draws an entry the player has never met, unseen', () => {
    const view = bestiaryView(emptyKills(), []);
    expect(view).toHaveLength(academy.bestiary.entries.length);
    expect(view.every((entry) => !entry.seen)).toBe(true);
  });
});

describe('the Wardrobe', () => {
  function dressed(owned: string[]): PlayerState {
    const player = defaultPlayer();
    player.cosmetics = { owned, selected: {} };
    return player;
  }

  it('starts bare, with nothing selected', () => {
    const player = defaultPlayer();
    expect(player.cosmetics).toEqual({ owned: [], selected: {} });
    const view = wardrobeView(player);
    expect(view.slots).toHaveLength(cosmeticSlots.length);
    for (const slot of view.slots) {
      expect(slot.choices[0]).toMatchObject({ id: NO_COSMETIC, owned: true, selected: true });
      expect(slot.choices.length).toBeGreaterThan(2);
    }
  });

  it('refuses a tint the player does not own', () => {
    const player = defaultPlayer();
    expect(selectCosmetic(player, 'hat', 'hatBone')).toBeNull();
    expect(selectCosmetic(player, 'hat', 'not-a-tint')).toBeNull();
    // And refuses one that belongs to a different slot.
    expect(selectCosmetic(dressed(['hatBone']), 'cape', 'hatBone')).toBeNull();
  });

  it('wears one that is owned, and takes it off again', () => {
    const owned = dressed(['hatBone']);
    const worn = selectCosmetic(owned, 'hat', 'hatBone');
    expect(worn).not.toBeNull();
    if (worn === null) return;
    expect(worn.cosmetics.selected.hat).toBe('hatBone');
    expect(wornCosmetic(worn, 'hat')?.name).toBe(cosmeticDef('hatBone')?.name);
    // The state it was asked about is untouched: a selection is a new player.
    expect(owned.cosmetics.selected.hat).toBeUndefined();

    // Selecting the same tint twice is not a change.
    expect(selectCosmetic(worn, 'hat', 'hatBone')).toBeNull();

    const bare = selectCosmetic(worn, 'hat', NO_COSMETIC);
    expect(bare).not.toBeNull();
    expect(bare?.cosmetics.selected.hat).toBeUndefined();
    expect(wornCosmetic(bare ?? worn, 'hat')).toBeNull();
    // Taking off nothing is not a change either.
    expect(selectCosmetic(bare ?? worn, 'hat', NO_COSMETIC)).toBeNull();
  });

  it('hands over earned tints once, and ignores ids it does not know', () => {
    const player = defaultPlayer();
    const owned = ownCosmetics(player, ['hatBone', 'hatBone', 'nonsense']);
    expect(owned?.cosmetics.owned).toEqual(['hatBone']);
    expect(ownCosmetics(owned ?? player, ['hatBone'])).toBeNull();
    expect(ownCosmetics(player, ['nonsense'])).toBeNull();
  });

  it('tells a locked chip what it wants', () => {
    const view = wardrobeView(defaultPlayer());
    const hats = view.slots.find((slot) => slot.id === 'hat');
    const locked = hats?.choices.find((choice) => choice.id === 'hatBone');
    const rung = tiersOf('grunt')[0];
    expect(locked?.owned).toBe(false);
    expect(locked?.hint).toContain(String(rung?.kills ?? 0));
    expect(locked?.hint).toContain('Grunt');
  });
});
