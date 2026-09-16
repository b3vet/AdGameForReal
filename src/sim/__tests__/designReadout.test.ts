/**
 * Not a test: the design readout, skipped unless `DESIGN=1`. It reproduces the
 * diagnosis tables of document 31, section 1, and the acceptance metrics of
 * section 5, on whatever the campaign is when it runs — dealt levels before
 * Phase 1, beat scripts after — so a change is kept only if this shows it.
 *
 *   DESIGN=1 npx vitest run src/sim/__tests__/designReadout.test.ts
 *
 *   DESIGN_LEVELS=1-40        levels (ranges and lists: `4,8,12-16`)
 *   DESIGN_SEEDS=shipped,1-6  roads: `shipped` is the level's own seed
 *   DESIGN_KIT=0              Frostfell on a bare hand instead of the kit the
 *                             campaign affords (skips the campaign simulation)
 *   DESIGN_OUT=path           where the tables go (default below)
 *
 * Seven roads over forty levels on both bots is 560 runs and a few minutes;
 * narrow it while a dial is being turned. Meadow is played bare and Frostfell
 * on the human campaign's kit, as `balance.test.ts` measures them (D45, D49).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { BotKind } from '../bots';
import { runCampaign } from '../campaign';
import { generateLevel } from '../level';
import { DesignTrace, quantile } from './designTrace';
import type { RunTrace, ThreatTrace } from './designTrace';
import { playerHolding } from './fixtures';
import { playDef } from './harness';
import type { PlayResult } from './harness';
import { levelConfig, levelCount } from '@/data';
import type { PlayerState } from '@/data/types';

const ON = process.env['DESIGN'] === '1';
const OUT = process.env['DESIGN_OUT'] ?? 'artifacts/design/readout.txt';
const BOTS: readonly BotKind[] = ['human', 'greedy'];

interface Played {
  level: number;
  frost: boolean;
  milestone: boolean;
  bot: BotKind;
  result: PlayResult;
  trace: RunTrace;
}

function range(spec: string, max: number): number[] {
  const out: number[] = [];
  for (const part of spec.split(',')) {
    const [from, to] = part.split('-').map((text) => Number(text.trim()));
    if (from === undefined || Number.isNaN(from)) continue;
    for (let n = from; n <= Math.min(max, to ?? from); n++) out.push(n);
  }
  return out;
}

function seedList(spec: string): (number | 'shipped')[] {
  const out: (number | 'shipped')[] = [];
  for (const part of spec.split(',')) {
    if (part.trim() === 'shipped') out.push('shipped');
    else out.push(...range(part, Number.MAX_SAFE_INTEGER));
  }
  return out;
}

function kits(): Map<number, PlayerState> {
  const map = new Map<number, PlayerState>();
  if (process.env['DESIGN_KIT'] === '0') return map;
  for (const entry of runCampaign({ bot: 'human', seed: 1, evolutions: false }).levels) {
    const held = entry.held;
    map.set(
      entry.level,
      playerHolding({
        upgrades: held.upgrades,
        staffs: held.staffs,
        evolved: held.evolved,
        tiers: held.tiers,
        wispTier: held.wispTier,
        unlockedLevel: entry.level,
      }),
    );
  }
  return map;
}

const f2 = (value: number): string => value.toFixed(2);
const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
const share = (part: number, whole: number): number => (whole > 0 ? part / whole : 0);

function losses(runs: readonly Played[]): { threats: number; curses: number; boss: number } {
  let threats = 0;
  let curses = 0;
  let boss = 0;
  for (const run of runs) {
    const road = run.result.road;
    threats += road.contact + road.leak + road.charge;
    curses += road.gate;
    const b = run.result.boss;
    boss += b.contact + b.leak + b.charge + b.gate + b.stomp + road.stomp;
  }
  const total = threats + curses + boss;
  return { threats: share(threats, total), curses: share(curses, total), boss: share(boss, total) };
}

function clears(runs: readonly Played[]): number {
  return share(runs.filter((run) => run.result.status === 'won').length, runs.length);
}

function headline(runs: readonly Played[], lines: string[]): void {
  lines.push('== clears (ordinary; milestones apart) and where the squad is lost ==');
  lines.push('biome   bot     clear  ms-clear  surv  boss-s | threats curses  boss | road/peak  falls');
  for (const frost of [false, true]) {
    for (const bot of BOTS) {
      const mine = runs.filter((run) => run.frost === frost && run.bot === bot);
      if (mine.length === 0) continue;
      const ordinary = mine.filter((run) => !run.milestone);
      const won = ordinary.filter((run) => run.result.status === 'won');
      const lost = losses(mine);
      const roadPeak = mean(
        mine.map((run) => {
          const road = run.result.road;
          return share(road.contact + road.leak + road.charge, Math.max(1, run.result.peakCount));
        }),
      );
      lines.push(
        [
          (frost ? 'frost' : 'meadow').padEnd(7),
          bot.padEnd(7),
          f2(clears(ordinary)).padStart(5),
          f2(clears(mine.filter((run) => run.milestone))).padStart(9),
          f2(mean(won.map((run) => share(run.result.survivors, run.result.peakCount)))).padStart(5),
          mean(won.map((run) => run.result.bossSeconds)).toFixed(1).padStart(7),
          '|',
          f2(lost.threats).padStart(7),
          f2(lost.curses).padStart(6),
          f2(lost.boss).padStart(5),
          '|',
          f2(roadPeak).padStart(9),
          f2(mean(mine.map((run) => run.trace.falls))).padStart(6),
        ].join(' '),
      );
    }
    const human = runs.filter((run) => run.frost === frost && run.bot === 'human' && !run.milestone);
    const greedy = runs.filter((run) => run.frost === frost && run.bot === 'greedy' && !run.milestone);
    if (human.length > 0 && greedy.length > 0) {
      lines.push(`        greedy-human clear gap ${f2(clears(greedy) - clears(human))}`);
    }
  }
}

function threatTable(runs: readonly Played[], lines: string[]): void {
  lines.push('', '== threats (a block or a river; share of the squad when it woke) ==');
  lines.push('biome   bot     per-run  free  median   p90   p99 | dents/run (L4+)');
  for (const frost of [false, true]) {
    for (const bot of BOTS) {
      const mine = runs.filter((run) => run.frost === frost && run.bot === bot);
      if (mine.length === 0) continue;
      const all: ThreatTrace[] = mine.flatMap((run) => run.trace.threats);
      const shares = all.map((threat) => threat.share);
      const late = mine.filter((run) => run.level >= 4);
      const dents = mean(late.map((run) => run.trace.threats.filter((t) => t.share >= 0.08).length));
      lines.push(
        [
          (frost ? 'frost' : 'meadow').padEnd(7),
          bot.padEnd(7),
          (all.length / mine.length).toFixed(1).padStart(7),
          f2(share(all.filter((threat) => threat.cost <= 0).length, all.length)).padStart(5),
          f2(quantile(shares, 0.5)).padStart(7),
          f2(quantile(shares, 0.9)).padStart(5),
          f2(quantile(shares, 0.99)).padStart(5),
          '|',
          dents.toFixed(1).padStart(6),
        ].join(' '),
      );
    }
  }

  lines.push('', '== when and where threats end (greedy and human together) ==');
  lines.push('kind          n  wake-end  sight-end  end-gap  within-10m  leaked/hit');
  const kinds = ['grunt', 'brute', 'shieldBrute', 'charger', 'river'] as const;
  const every = runs.flatMap((run) => run.trace.threats);
  for (const kind of kinds) {
    const mine = every.filter((threat) => threat.kind === kind);
    if (mine.length === 0) continue;
    const shot = mine.filter((threat) => !threat.contact);
    // A river has no single place it ends; its bodies are the line below.
    const river = kind === 'river';
    lines.push(
      [
        kind.padEnd(11),
        String(mine.length).padStart(4),
        quantile(mine.map((t) => t.wakeToEnd), 0.5).toFixed(1).padStart(9),
        quantile(mine.map((t) => t.sightToEnd), 0.5).toFixed(1).padStart(10),
        (river ? '-' : quantile(mine.map((t) => t.endGap), 0.5).toFixed(1)).padStart(8),
        (river ? '-' : f2(share(mine.filter((t) => t.endGap <= 10).length, mine.length))).padStart(11),
        f2(share(mine.length - shot.length, mine.length)).padStart(8),
      ].join(' '),
    );
  }
  const gaps = runs.flatMap((run) => run.trace.bodyDeathGaps);
  lines.push(`river bodies die at a median ${quantile(gaps, 0.5).toFixed(1)} m (${String(gaps.length)} bodies)`);
}

function rowTable(runs: readonly Played[], lines: string[]): void {
  lines.push('', '== gate rows (priced by greedy at its read distance) ==');
  lines.push('biome   rows/lvl curse-rows curses/lvl  dec-med face-med dec>0.5 unpriced | greedy red  mul/lvl mul-taken');
  for (const frost of [false, true]) {
    const greedy = runs.filter((run) => run.frost === frost && run.bot === 'greedy');
    if (greedy.length === 0) continue;
    const rows = greedy.flatMap((run) => run.trace.rows);
    const mulRows = rows.filter((row) => row.hasMul);
    lines.push(
      [
        (frost ? 'frost' : 'meadow').padEnd(7),
        (rows.length / greedy.length).toFixed(1).padStart(8),
        f2(share(rows.filter((row) => row.hasCurse).length, rows.length)).padStart(10),
        (rows.filter((row) => row.hasCurse).length / greedy.length).toFixed(1).padStart(10),
        f2(quantile(rows.map((row) => row.decision), 0.5)).padStart(8),
        f2(quantile(rows.map((row) => row.decisionFace), 0.5)).padStart(8),
        f2(share(rows.filter((row) => row.decision > 0.5).length, rows.length)).padStart(7),
        f2(share(rows.filter((row) => row.unpriced).length, rows.length)).padStart(8),
        '|',
        f2(share(rows.filter((row) => row.tookRed).length, rows.length)).padStart(10),
        (mulRows.length / greedy.length).toFixed(1).padStart(8),
        f2(share(mulRows.filter((row) => row.tookMul).length, mulRows.length)).padStart(9),
      ].join(' '),
    );
  }
}

function levelTable(runs: readonly Played[], levels: readonly number[], lines: string[]): void {
  lines.push('', '== per level ==');
  lines.push(' L ms  h-clear g-clear  h-surv h-boss | h-threat h-curse h-boss | g-free  dec  peak-live');
  for (const level of levels) {
    const human = runs.filter((run) => run.level === level && run.bot === 'human');
    const greedy = runs.filter((run) => run.level === level && run.bot === 'greedy');
    if (human.length === 0) continue;
    const won = human.filter((run) => run.result.status === 'won');
    const lost = losses(human);
    const greedyThreats = greedy.flatMap((run) => run.trace.threats);
    lines.push(
      [
        String(level).padStart(2),
        (human[0]?.milestone === true ? 'M' : ' ').padStart(2),
        f2(clears(human)).padStart(8),
        f2(clears(greedy)).padStart(7),
        f2(mean(won.map((run) => share(run.result.survivors, run.result.peakCount)))).padStart(7),
        mean(won.map((run) => run.result.bossSeconds)).toFixed(1).padStart(6),
        '|',
        f2(lost.threats).padStart(8),
        f2(lost.curses).padStart(7),
        f2(lost.boss).padStart(6),
        '|',
        f2(share(greedyThreats.filter((t) => t.cost <= 0).length, greedyThreats.length)).padStart(6),
        f2(quantile(greedy.flatMap((run) => run.trace.rows.map((row) => row.decision)), 0.5)).padStart(5),
        `${mean(human.concat(greedy).map((run) => run.result.peakLive)).toFixed(0)}/${String(
          Math.max(0, ...human.concat(greedy).map((run) => run.result.peakLive)),
        )}`.padStart(10),
      ].join(' '),
    );
  }
}

function beatTable(runs: readonly Played[], lines: string[]): void {
  const keyed = new Map<string, { human: number[]; greedy: number[] }>();
  for (const run of runs) {
    for (const beat of run.trace.beats) {
      const key = `${beat.beat}:${String(beat.tier)}`;
      const entry = keyed.get(key) ?? { human: [], greedy: [] };
      (run.bot === 'human' ? entry.human : entry.greedy).push(beat.share);
      keyed.set(key, entry);
    }
  }
  if (keyed.size === 0) return;
  lines.push('', '== beats on the campaign (loss over the squad entering the beat) ==');
  lines.push('beat:tier         n  human-med  p90 | greedy-med  p90');
  for (const [key, entry] of [...keyed.entries()].sort()) {
    lines.push(
      [
        key.padEnd(15),
        String(entry.human.length).padStart(4),
        f2(quantile(entry.human, 0.5)).padStart(10),
        f2(quantile(entry.human, 0.9)).padStart(4),
        '|',
        f2(quantile(entry.greedy, 0.5)).padStart(10),
        f2(quantile(entry.greedy, 0.9)).padStart(4),
      ].join(' '),
    );
  }
}

describe.skipIf(!ON)('design readout', () => {
  it('prints the diagnosis tables and the acceptance metrics', () => {
    const levels = range(process.env['DESIGN_LEVELS'] ?? `1-${String(levelCount)}`, levelCount);
    const seeds = seedList(process.env['DESIGN_SEEDS'] ?? 'shipped,1-6');
    const kit = kits();
    const runs: Played[] = [];
    let peakLive = 0;

    for (const level of levels) {
      const config = levelConfig(level);
      const frost = (config.biome ?? 'meadow') !== 'meadow';
      const player = frost ? kit.get(level) : undefined;
      for (const seed of seeds) {
        const value = seed === 'shipped' ? config.seed : seed;
        for (const bot of BOTS) {
          const def = generateLevel(level, config, value, player);
          const trace = new DesignTrace(def);
          const result = playDef(def, bot, { player, botSeed: value * 7919 + level, onStep: trace.onStep });
          peakLive = Math.max(peakLive, result.peakLive);
          runs.push({ level, frost, milestone: config.milestone === true, bot, result, trace: trace.finish() });
        }
      }
    }

    const lines: string[] = [
      `design readout: levels ${String(levels[0] ?? 0)}-${String(levels[levels.length - 1] ?? 0)}, ` +
        `roads ${seeds.join(',')}, Frostfell ${kit.size > 0 ? 'on the campaign kit' : 'bare'}, ` +
        `${String(runs.length)} runs, peak live ${String(peakLive)}`,
    ];
    headline(runs, lines);
    threatTable(runs, lines);
    rowTable(runs, lines);
    levelTable(runs, levels, lines);
    beatTable(runs, lines);
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, `${lines.join('\n')}\n`);
    expect(runs.length).toBeGreaterThan(0);
  }, 7_200_000);
});
