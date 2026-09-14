/**
 * The v3 save's meta block, read defensively (D51 to D53).
 *
 * Six fields joined the `PlayerState` in Milestone 8 — the streak, the mission
 * board, the kill counters, the Wardrobe, the endless record and the level
 * bests — and every one of them is something a hand-edited save, a rolled-back
 * build or a half-written `localStorage` can hand back as nonsense. The readers
 * live here rather than in `./save.ts` because that file is at the size budget
 * (CLAUDE.md) and because this is one job: turn `unknown` into a value the
 * Academy can be painted from.
 *
 * The rule throughout is the one v2 established: read *against the defaults*,
 * field by field, and never trust a shape. A v2 save reaching a v3 build has
 * none of these fields at all, which is simply the case where every reader
 * returns its default — which is why the migration needs no code of its own.
 */

import { cosmeticDef, killKinds, missionDef } from '@/data';
import type {
  CosmeticSlot,
  CosmeticsState,
  EndlessState,
  KillKind,
  LevelBest,
  MissionState,
  MissionsState,
  StreakState,
} from '@/data';

import { isDayKey } from './clock';
import { cosmeticSlots } from './cosmetics';
import { boardSize } from './missions';

/** The six fields of a `PlayerState` the meta layer owns. */
export interface MetaBlock {
  streak: StreakState;
  missions: MissionsState;
  kills: Record<KillKind, number>;
  cosmetics: CosmeticsState;
  endless: EndlessState;
  levelBest: Record<string, LevelBest>;
}

/**
 * Reads the whole block off a stored player's fields.
 *
 * `fields` is whatever was under `player` in the save, already known to be an
 * object. Anything missing, wrong-typed or impossible reads as the default for
 * that field alone: one bad mission must not cost the player their streak.
 */
export function readMeta(fields: Record<string, unknown>): MetaBlock {
  return {
    streak: readStreak(fields['streak']),
    missions: readMissions(fields['missions']),
    kills: readKills(fields['kills']),
    cosmetics: readCosmetics(fields['cosmetics']),
    endless: readEndless(fields['endless']),
    levelBest: readLevelBest(fields['levelBest']),
  };
}

/**
 * A streak is a count and the day it was last claimed. A day that is not a day
 * takes the count with it: "twelve days, last claimed never" is not a streak
 * any rule here could advance, and the next finished run starts a real one.
 */
function readStreak(raw: unknown): StreakState {
  const fields = record(raw);
  const lastDay = fields['lastDay'];
  if (!isDayKey(lastDay)) return { days: 0, lastDay: '' };
  return { days: Math.max(0, Math.floor(number(fields['days'], 0))), lastDay };
}

/**
 * The board. A mission whose id has been retired from the pool is dropped
 * rather than kept as a row nothing can describe; the next session start draws
 * a replacement (`./missions.ts`).
 */
function readMissions(raw: unknown): MissionsState {
  const fields = record(raw);
  const active: MissionState[] = [];
  const stored = fields['active'];

  if (Array.isArray(stored)) {
    for (const entry of stored) {
      if (active.length >= boardSize) break;
      const mission = record(entry);
      const id = mission['id'];
      if (typeof id !== 'string' || missionDef(id) === null) continue;
      if (active.some((other) => other.id === id)) continue;
      active.push({
        id,
        progress: Math.max(0, Math.floor(number(mission['progress'], 0))),
        done: mission['done'] === true,
      });
    }
  }

  return { active, rolled: Math.max(0, Math.floor(number(fields['rolled'], 0))) };
}

function readKills(raw: unknown): Record<KillKind, number> {
  const fields = record(raw);
  const kills = {} as Record<KillKind, number>;
  for (const kind of killKinds) {
    kills[kind] = Math.max(0, Math.floor(number(fields[kind], 0)));
  }
  return kills;
}

/**
 * The Wardrobe. Owning a tint that is not in the manifest is meaningless, and
 * *wearing* one that is not owned is the one state that would let a player
 * keep a tint they never earned — so a selection is only kept when the id is
 * owned and belongs to the slot it is filed under.
 */
function readCosmetics(raw: unknown): CosmeticsState {
  const fields = record(raw);
  const owned: string[] = [];
  const stored = fields['owned'];
  if (Array.isArray(stored)) {
    for (const entry of stored) {
      if (typeof entry !== 'string' || cosmeticDef(entry) === null) continue;
      if (!owned.includes(entry)) owned.push(entry);
    }
  }

  const selected: Partial<Record<CosmeticSlot, string>> = {};
  const wearing = record(fields['selected']);
  for (const slot of cosmeticSlots) {
    const id = wearing[slot];
    if (typeof id !== 'string' || !owned.includes(id)) continue;
    if (cosmeticDef(id)?.slot !== slot) continue;
    selected[slot] = id;
  }

  return { owned, selected };
}

function readEndless(raw: unknown): EndlessState {
  const fields = record(raw);
  return {
    bestMetres: Math.max(0, Math.floor(number(fields['bestMetres'], 0))),
    runs: Math.max(0, Math.floor(number(fields['runs'], 0))),
  };
}

/** Keyed by the level index as a string, which is the only key shape allowed. */
function readLevelBest(raw: unknown): Record<string, LevelBest> {
  const fields = record(raw);
  const bests: Record<string, LevelBest> = {};
  for (const key of Object.keys(fields)) {
    const level = Number(key);
    if (!Number.isInteger(level) || level < 1) continue;
    const best = record(fields[key]);
    bests[String(level)] = {
      survivors: Math.max(0, Math.floor(number(best['survivors'], 0))),
      peak: Math.max(0, Math.floor(number(best['peak'], 0))),
    };
  }
  return bests;
}

function record(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null) return {};
  return raw as Record<string, unknown>;
}

function number(raw: unknown, fallback: number): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
}
