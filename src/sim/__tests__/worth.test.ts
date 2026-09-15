/**
 * Not a test: the readout that measures `progression.json`'s `worth` figures,
 * skipped unless `PROBE=1`. Kept beside the balance tests so the numbers the
 * Milestone 8 log records can be reproduced, exactly as `./tune.test.ts` is.
 *
 * What one rung of the Academy is worth, in the one unit the shopper in
 * `../campaignShop.ts` ranks by: a share of the squad's own output. A case is
 * scored as survivors over peak across `PROBE_SEEDS` seeds of a level, and the
 * gain it shows over the kit below it — `against` — is divided by the gain a
 * *known* rung shows on the same level, three levels of `damage`, which is 24
 * percent of output. The answer comes out as "this rung is worth n percent of
 * the squad's own fire", with the standard error of the seed-by-seed
 * differences beside it, because on a level that clears seven times in ten the
 * spread between seeds is wider than most of the rungs being measured.
 *
 * Two runs, because one campaign is thirty seconds and every case would pay for
 * it again:
 *
 *     PROBE=1 PROBE_KIND=kits PROBE_KITS=/tmp/kits.json vitest run worth
 *     PROBE=1 PROBE_KITS=/tmp/kits.json PROBE_LEVELS=12 PROBE_SEEDS=24 \
 *       PROBE_SPEC='[{"label":"ember t2","staff":"ember","tier":2}]' vitest run worth
 *
 * The kit is the campaign's own hand at that level with every staff owned and
 * none of them evolved, so a case is the one rung it names and nothing else:
 * the burn and the shatter follow the *player* rather than the staff in hand
 * (`../evolutions.ts`), so a kit carrying an evolved ember would put a fire
 * under a frost measurement.
 */

import { describe, expect, it } from 'vitest';

import { runCampaign } from '../campaign';
import { playerHolding } from './fixtures';
import { playLevel } from './harness';
import { progression } from '../progression';
import { weaponDef, weaponIds } from '../weapons';
import { balance } from '@/data';
import type { FamiliarTier, PlayerState, StaffTier, UpgradeId, WeaponId } from '@/data/types';

const ON = process.env['PROBE'] === '1';
const KIND = process.env['PROBE_KIND'] ?? 'worth';
const KITS = process.env['PROBE_KITS'] ?? '/tmp/kits.json';
const LEVELS = (process.env['PROBE_LEVELS'] ?? '12,28').split(',').map((text) => Number(text));
const SEED_COUNT = Number(process.env['PROBE_SEEDS'] ?? '16');
const SPEC = process.env['PROBE_SPEC'] ?? '[]';
const SEED_FROM = Number(process.env['PROBE_SEED_FROM'] ?? '1');
const SEEDS = Array.from({ length: SEED_COUNT }, (_, i) => i + SEED_FROM);

/** The reference rung: three levels of `damage`, whose size is known. */
const REF_RUNGS = 3;

interface HeldKit {
  upgrades: Partial<Record<UpgradeId, number>>;
  staffs: WeaponId[];
  evolved: WeaponId[];
  tiers: Partial<Record<WeaponId, StaffTier>>;
  wispTier: FamiliarTier;
}

interface Case {
  label: string;
  /** The staff in hand and the tier it is held at. Default: ember at 1. */
  staff?: WeaponId;
  tier?: StaffTier;
  wisp?: FamiliarTier;
  upgrade?: UpgradeId;
  rungs?: number;
  /** Dotted paths into `balance`, `progression` or `weapons`, set for this case. */
  set?: Record<string, number>;
  /** The label of the case this one is measured over. Default: the bare kit. */
  against?: string;
}

interface Score {
  /** Survivors over peak, one entry per seed: the paired sample. */
  each: number[];
  s: number;
  c: number;
}

function score(level: number, player: PlayerState): Score {
  const each: number[] = [];
  let clears = 0;
  for (const seed of SEEDS) {
    const result = playLevel(level, seed, 'human', player);
    each.push(result.survivors / Math.max(1, result.peakCount));
    if (result.status === 'won') clears++;
  }
  const mean = each.reduce((total, value) => total + value, 0) / Math.max(1, each.length);
  return { each, s: mean, c: clears / SEEDS.length };
}

/** Mean and standard error of the paired differences, seed by seed. */
function paired(high: Score, low: Score): { mean: number; se: number } {
  const n = Math.min(high.each.length, low.each.length);
  let total = 0;
  for (let i = 0; i < n; i++) total += (high.each[i] ?? 0) - (low.each[i] ?? 0);
  const mean = total / Math.max(1, n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const delta = (high.each[i] ?? 0) - (low.each[i] ?? 0) - mean;
    sum += delta * delta;
  }
  const variance = sum / Math.max(1, n - 1);
  return { mean, se: Math.sqrt(variance / Math.max(1, n)) };
}

const copy = (player: PlayerState): PlayerState => structuredClone(player);

/** The kit with every staff owned but unevolved, so nothing bleeds into a case. */
function kitOf(kits: Record<string, HeldKit>, level: number): PlayerState {
  const held = kits[String(level)];
  if (held === undefined) throw new Error(`no kit for L${String(level)}`);
  const player = playerHolding({
    upgrades: held.upgrades,
    staffs: held.staffs,
    wispTier: held.wispTier,
    unlockedLevel: level,
  });
  for (const id of weaponIds) player.staffs[id] = { unlocked: true, tier: 1 };
  player.selectedStaff = 'ember';
  return player;
}

function playerFor(base: PlayerState, entry: Case): PlayerState {
  const player = copy(base);
  const staff = entry.staff ?? 'ember';
  player.staffs[staff] = { unlocked: true, tier: entry.tier ?? 1 };
  player.selectedStaff = staff;
  if (entry.wisp !== undefined) player.familiar = { unlocked: entry.wisp > 0, tier: entry.wisp };
  if (entry.upgrade !== undefined) {
    player.upgrades[entry.upgrade] = (player.upgrades[entry.upgrade] ?? 0) + (entry.rungs ?? 1);
  }
  return player;
}

/** The three mutable tuning roots a case may bend, by the name a path starts with. */
function rootOf(name: string): Record<string, unknown> {
  if (name === 'balance') return balance as unknown as Record<string, unknown>;
  if (name === 'progression') return progression as unknown as Record<string, unknown>;
  if (name === 'weapons') return { ember: weaponDef('ember'), storm: weaponDef('storm'), frost: weaponDef('frost') } as unknown as Record<string, unknown>;
  throw new Error(`unknown root ${name}`);
}

/** Sets a dotted path and returns what was there, so the case can be undone. */
function poke(path: string, value: number): number {
  const parts = path.split('.');
  const first = parts.shift() ?? '';
  const leaf = parts.pop() ?? '';
  let node = rootOf(first);
  for (const part of parts) node = node[part] as Record<string, unknown>;
  const before = node[leaf] as number;
  node[leaf] = value;
  return before;
}

function withOverrides<T>(set: Record<string, number> | undefined, body: () => T): T {
  if (set === undefined) return body();
  const undo: [string, number][] = [];
  for (const [path, value] of Object.entries(set)) undo.push([path, poke(path, value)]);
  try {
    return body();
  } finally {
    for (const [path, value] of undo) poke(path, value);
  }
}

describe.skipIf(!ON || KIND !== 'kits')('probe: kits', () => {
  it('writes the campaign kits', async () => {
    const fs = await import('node:fs');
    const campaign = runCampaign({ bot: 'human', seed: 1, evolutions: false });
    const kits: Record<string, HeldKit> = {};
    for (const entry of campaign.levels) {
      kits[String(entry.level)] = {
        upgrades: entry.held.upgrades,
        staffs: entry.held.staffs,
        evolved: entry.held.evolved,
        tiers: entry.held.tiers,
        wispTier: entry.held.wispTier,
      };
    }
    fs.writeFileSync(KITS, JSON.stringify(kits));
    process.stdout.write(`kits -> ${KITS}\n`);
    expect(Object.keys(kits).length).toBeGreaterThan(0);
  }, 900_000);
});

describe.skipIf(!ON || KIND !== 'worth')('probe: worth', () => {
  it('prints what each case is worth', async () => {
    const fs = await import('node:fs');
    const kits = JSON.parse(fs.readFileSync(KITS, 'utf8')) as Record<string, HeldKit>;
    const cases = JSON.parse(SPEC) as Case[];
    const output = progression.upgrades.effects.damage * REF_RUNGS;
    const lines: string[] = [];
    for (const level of LEVELS) {
      const kit = kitOf(kits, level);
      const base = score(level, playerFor(kit, {} as Case));
      const ref = score(level, playerFor(kit, { label: 'ref', upgrade: 'damage', rungs: REF_RUNGS }));
      const scale = paired(ref, base);
      lines.push(
        `L${String(level)} base ${base.s.toFixed(4)} clears ${base.c.toFixed(2)} | ` +
          `+${String(REF_RUNGS)} damage ${ref.s.toFixed(4)} clears ${ref.c.toFixed(2)} ` +
          `delta ${scale.mean.toFixed(4)} +-${scale.se.toFixed(4)}`,
      );
      const scored = new Map<string, Score>([['', base]]);
      for (const entry of cases) {
        const got = withOverrides(entry.set, () => score(level, playerFor(kit, entry)));
        scored.set(entry.label, got);
        // Against the case named in `against`, so a rung is measured over the
        // rung below it rather than over the bare kit.
        const low = scored.get(entry.against ?? '') ?? base;
        const step = paired(got, low);
        const unit = scale.mean > 0 ? output / scale.mean : 0;
        lines.push(
          `L${String(level)} ${entry.label}: ${(step.mean * unit * 100).toFixed(1)}%` +
            ` +-${(step.se * unit * 100).toFixed(1)}  s ${got.s.toFixed(4)} clears ${got.c.toFixed(2)}`,
        );
      }
      process.stdout.write(`${lines.join('\n')}\n`);
      lines.length = 0;
    }
    expect(true).toBe(true);
  }, 3_600_000);
});
