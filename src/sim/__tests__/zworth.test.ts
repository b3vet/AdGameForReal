import { describe, expect, it } from 'vitest';
import { runCampaign } from '../campaign';
import { playLevel } from './harness';
import { playerHolding } from './fixtures';
import { progression } from '../player';
import type { FamiliarTier, PlayerState, StaffTier, WeaponId } from '@/data/types';

const ON = process.env['PROBE'] === '1';
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

function score(level: number, player: PlayerState): { s: number; c: number } {
  let survivors = 0, peak = 0, clears = 0;
  for (const seed of SEEDS) {
    const r = playLevel(level, seed, 'human', player);
    survivors += r.survivors; peak += r.peakCount;
    if (r.status === 'won') clears++;
  }
  return { s: survivors / Math.max(1, peak), c: clears / SEEDS.length };
}

const campaign = runCampaign({ bot: 'human', seed: 1 });
function kitAt(level: number): PlayerState {
  const h = campaign.levels.find((e) => e.level === level)?.held;
  if (h === undefined) throw new Error('no kit');
  return playerHolding({ upgrades: h.upgrades, staffs: h.staffs, evolved: h.evolved,
    tiers: h.tiers, wispTier: h.wispTier, unlockedLevel: level });
}
const copy = (p: PlayerState): PlayerState => JSON.parse(JSON.stringify(p)) as PlayerState;
function withTier(base: PlayerState, id: WeaponId, tier: StaffTier): PlayerState {
  const p = copy(base);
  p.staffs[id] = { unlocked: true, tier };
  p.selectedStaff = id;
  return p;
}
const RUNGS = 3;

describe.skipIf(!ON)('probe: tier worth', () => {
  it('prints', () => {
    const lines: string[] = [];
    for (const level of [12, 28]) {
      const kit = kitAt(level);
      const bare = score(level, withTier(kit, 'ember', 1));
      const strong = copy(withTier(kit, 'ember', 1));
      strong.upgrades.damage += RUNGS;
      const ref = score(level, strong).s - bare.s;
      const output = progression.upgrades.effects.damage * RUNGS;
      lines.push(`--- L${String(level)} bare ${bare.s.toFixed(4)} clears ${bare.c.toFixed(2)}; +${String(RUNGS)} damage delta ${ref.toFixed(4)}`);
      for (const id of ['ember', 'storm', 'frost'] as const) {
        let low = score(level, withTier(kit, id, 1));
        const base = low.s;
        for (const tier of [2, 3, 4] as const) {
          const high = score(level, withTier(kit, id, tier));
          lines.push(`${id} t${String(tier)}: worth ${((output * (high.s - low.s)) / ref * 100).toFixed(1)}%  cumulative ${((output * (high.s - base)) / ref * 100).toFixed(1)}%  clears ${low.c.toFixed(2)}->${high.c.toFixed(2)}`);
          low = high;
        }
      }
      for (const tier of [1, 2, 3] as const) {
        const before = copy(kit); before.familiar = { unlocked: tier > 1, tier: (tier - 1) as FamiliarTier };
        const after = copy(kit); after.familiar = { unlocked: true, tier };
        const lo = score(level, before), hi = score(level, after);
        lines.push(`wisp t${String(tier)}: worth ${((output * (hi.s - lo.s)) / ref * 100).toFixed(1)}%`);
      }
    }
    process.stdout.write(`${lines.join('\n')}\n`);
    expect(lines.length).toBeGreaterThan(0);
  }, 3600000);
});
