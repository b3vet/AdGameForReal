import { describe, expect, it } from 'vitest';
import { runCampaign } from '../campaign';
import { playLevel } from './harness';
import { playerHolding } from './fixtures';
import { weaponDef } from '../weapons';
import type { PlayerState } from '@/data/types';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const LEVELS = (process.env['PROBE_LEVELS'] ?? '27').split(',').map(Number);

describe('boss seconds', () => {
  it('prints', () => {
    const campaign = runCampaign({ bot: 'human', seed: 1, evolutions: false });
    const kit = (level: number): PlayerState => {
      const held = campaign.levels.find((e) => e.level === level)?.held;
      if (held === undefined) throw new Error('no kit');
      return playerHolding({
        upgrades: held.upgrades, staffs: held.staffs, evolved: held.evolved,
        tiers: held.tiers, wispTier: held.wispTier, unlockedLevel: level,
      });
    };
    const chain = weaponDef('storm').chain;
    if (chain === undefined) throw new Error('no chain');
    for (const mul of (process.env['PROBE_MULS'] ?? '0.3').split(',').map(Number)) {
      chain.damageMul = mul;
      for (const level of LEVELS) {
        const player = kit(level);
        let seconds = 0, wins = 0, survivors = 0, peak = 0;
        for (const seed of SEEDS) {
          const r = playLevel(level, seed, 'human', player);
          if (r.status !== 'won') continue;
          wins++; seconds += r.bossSeconds; survivors += r.survivors; peak += r.peakCount;
        }
        process.stdout.write(
          `mul ${mul.toFixed(2)} L${String(level)}: boss ${(seconds / Math.max(1, wins)).toFixed(1)}s` +
            ` clears ${(wins / SEEDS.length).toFixed(2)} surv ${(survivors / Math.max(1, peak)).toFixed(2)}` +
            ` held ${JSON.stringify(player.upgrades)}\n`,
        );
      }
    }
    expect(true).toBe(true);
  }, 900000);
});
