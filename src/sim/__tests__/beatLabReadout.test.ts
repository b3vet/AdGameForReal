/**
 * Not a test: the beat lab's readout, skipped unless `BEATLAB=1` (document 31,
 * section 5's first step). Every beat and tier in `beats.json`, at the three
 * lab sizes, on both bots, against the rating band the tier claims.
 *
 *   BEATLAB=1 npx vitest run src/sim/__tests__/beatLabReadout.test.ts
 *
 * Narrowed while a beat is being tuned:
 *
 *   BEATLAB_BEATS=guard,ambush   only these beats
 *   BEATLAB_TIERS=3              only this tier
 *   BEATLAB_SIZES=30,100,300     squad sizes (the lab's three by default)
 *   BEATLAB_SEEDS=12             seeds per cell
 *   BEATLAB_BIOME=frost          the biome the road is laid in
 *   BEATLAB_OUT=path             where the table goes (default below)
 *
 * One line per cell: the band, the human's median / mean / p90 / worst loss,
 * greedy's median and worst, how often each took the prize, the decision
 * value (priced, then face), the peak of live enemies and a verdict — `ok` when
 * the human's median sits in the band and greedy's median does not exceed its
 * top, `low` or `high` otherwise.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { describe, expect, it } from 'vitest';

import { LAB_SIZES, labBeat } from './beatLab';
import type { BeatReport } from './beatLab';
import { beats } from '@/data';
import type { BiomeId } from '@/data/types';

const ON = process.env['BEATLAB'] === '1';
const OUT = process.env['BEATLAB_OUT'] ?? 'artifacts/design/beat-lab.txt';

function list(name: string): string[] | null {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? null : raw.split(',').map((part) => part.trim());
}

function pct(value: number): string {
  return (value * 100).toFixed(1).padStart(5);
}

function verdict(human: BeatReport, greedy: BeatReport): string {
  const [lo, hi] = human.band;
  if (greedy.lossMedian > hi + 1e-9) return 'high (greedy)';
  if (human.lossMedian < lo - 1e-9) return 'low';
  if (human.lossMedian > hi + 1e-9) return 'high';
  return 'ok';
}

describe.skipIf(!ON)('beat lab readout', () => {
  it('prints every beat against its band', () => {
    const only = list('BEATLAB_BEATS');
    const tiers = list('BEATLAB_TIERS');
    const sizes = (list('BEATLAB_SIZES') ?? LAB_SIZES.map(String)).map(Number);
    const seedCount = Number(process.env['BEATLAB_SEEDS'] ?? '12');
    const seeds = Array.from({ length: seedCount }, (_, i) => i + 1);
    const biome: BiomeId = process.env['BEATLAB_BIOME'] === 'frost' ? 'frost' : 'meadow';

    const lines: string[] = [
      `beat lab, ${biome}, ${String(seedCount)} seeds a cell; losses are % of E`,
      'beat         t  size  r band      | human med  mean   p90 worst prize | greedy med worst prize | dec  face | peak | verdict',
    ];
    let cells = 0;
    let inBand = 0;
    for (const def of beats.defs) {
      if (only !== null && !only.includes(def.id)) continue;
      for (const key of Object.keys(def.tiers)) {
        if (tiers !== null && !tiers.includes(key)) continue;
        const tier = Number(key);
        for (const size of sizes) {
          const human = labBeat(def.id, tier, size, 'human', seeds, biome);
          const greedy = labBeat(def.id, tier, size, 'greedy', seeds, biome);
          const call = verdict(human, greedy);
          cells++;
          if (call === 'ok') inBand++;
          lines.push(
            [
              def.id.padEnd(12),
              key.padStart(2),
              String(size).padStart(5),
              String(human.rating).padStart(2),
              `${pct(human.band[0])}-${pct(human.band[1]).trim()}`.padEnd(10),
              '|',
              pct(human.lossMedian),
              pct(human.lossMean),
              pct(human.lossP90),
              pct(human.lossWorst),
              human.prizeShare.toFixed(2).padStart(5),
              '|',
              pct(greedy.lossMedian),
              pct(greedy.lossWorst),
              greedy.prizeShare.toFixed(2).padStart(5),
              '|',
              greedy.decisionMedian.toFixed(2),
              greedy.decisionFaceMedian.toFixed(2),
              '|',
              String(Math.max(human.peakLive, greedy.peakLive)).padStart(4),
              '|',
              `${call}${human.wipes + greedy.wipes > 0 ? ` wipes ${String(human.wipes)}/${String(greedy.wipes)}` : ''}`,
            ].join(' '),
          );
        }
      }
    }
    lines.push(`${String(inBand)} of ${String(cells)} cells in band`);
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, `${lines.join('\n')}\n`);
    expect(cells).toBeGreaterThan(0);
  }, 3_600_000);
});
