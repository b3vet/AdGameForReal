/**
 * A small beat library of the test's own, so the composer's rules are checked
 * against numbers the test chose rather than against `beats.json`, which the
 * tuning pass will keep moving. Its shapes are the pinned ones (document 31,
 * 4.2); its numbers are round so the arithmetic can be written out.
 */

import type { BeatDef, BeatLibrary, LevelGenConfig, ScriptBeat } from '@/data/types';

const open: BeatDef = {
  id: 'open',
  rows: 2,
  tiers: {
    '1': {
      rating: 0,
      expectLoss: 0,
      gates: {
        prize: { kind: 'add', size: 'big' },
        safe: { kind: 'add', size: 'mid' },
        other: { kind: 'add', size: 'small' },
      },
    },
  },
};

const rest: BeatDef = {
  id: 'rest',
  rows: 2,
  tiers: {
    '1': {
      rating: 0,
      expectLoss: 0,
      gates: {
        prize: { kind: 'add', size: 'big' },
        safe: { kind: 'add', size: 'mid' },
        other: { kind: 'fireRate' },
      },
    },
  },
};

const guard: BeatDef = {
  id: 'guard',
  rows: 2,
  tiers: {
    '1': {
      rating: 1,
      expectLoss: 0.05,
      gates: {
        prize: { kind: 'add', size: 'big' },
        safe: { kind: 'add', size: 'small' },
        other: { kind: 'sub', size: 'price' },
      },
      enemies: [{ kind: 'brute', lane: 'prize', at: -8, wake: 45, killSeconds: 2 }],
    },
    '2': {
      rating: 2,
      expectLoss: 0.1,
      enemies: [{ kind: 'shieldBrute', lane: 'prize', at: -8, wake: 40, killSeconds: 3 }],
    },
  },
};

const ambush: BeatDef = {
  id: 'ambush',
  rows: 2,
  tiers: {
    '1': {
      rating: 2,
      expectLoss: 0.1,
      gates: {
        prize: { kind: 'add', size: 'big' },
        safe: { kind: 'add', size: 'mid' },
        other: { kind: 'sub', size: 'price' },
      },
      enemies: [{ kind: 'brute', lane: 'prize', at: 5, wake: 34, killSeconds: 2 }],
    },
  },
};

const toll: BeatDef = {
  id: 'toll',
  rows: 2,
  tiers: {
    '1': {
      rating: 1,
      expectLoss: 0.05,
      gates: {
        prize: { kind: 'add', size: 'big' },
        safe: { kind: 'add', size: 'mid' },
        other: { kind: 'sub', size: 'price' },
      },
      rivers: [{ lanes: ['prize'], at: -10, open: 50, seconds: 4, pressure: 1, density: 0.4 }],
    },
    '2': {
      rating: 2,
      expectLoss: 0.1,
      rivers: [{ lanes: ['prize'], at: 8, open: 50, seconds: 5, pressure: 1, density: 0.4 }],
    },
  },
};

const flip: BeatDef = {
  id: 'flip',
  rows: 2,
  tiers: {
    '1': {
      rating: 1,
      expectLoss: 0.05,
      gates: {
        prize: { kind: 'add', size: 'big' },
        safe: { kind: 'add', size: 'mid' },
        other: { kind: 'sub', size: 'flip' },
      },
    },
  },
};

const fork: BeatDef = {
  id: 'fork',
  rows: 2,
  tiers: {
    '1': {
      rating: 2,
      expectLoss: 0.1,
      gates: {
        prize: { kind: 'add', size: 'mid' },
        safe: { kind: 'add', size: 'mid' },
        other: { kind: 'sub', size: 'price' },
      },
      rivers: [
        { lanes: ['prize'], at: -6, open: 50, seconds: 4, pressure: 1, density: 0.3 },
        { lanes: ['safe'], at: -6, open: 50, seconds: 4, pressure: 1, density: 0.3 },
      ],
    },
  },
};

const chargeFork: BeatDef = {
  id: 'chargeFork',
  rows: 2,
  tiers: {
    '1': {
      rating: 1,
      expectLoss: 0.05,
      gates: {
        prize: { kind: 'add', size: 'mid' },
        safe: { kind: 'add', size: 'mid' },
        other: { kind: 'sub', size: 'price' },
      },
      enemies: [
        { kind: 'charger', lane: 'prize', lanes: ['prize', 'safe'], at: -10, wake: 30, killSeconds: 1 },
      ],
    },
  },
};

const fence: BeatDef = {
  id: 'fence',
  rows: 2,
  tiers: {
    '1': {
      rating: 2,
      expectLoss: 0.1,
      gates: {
        prize: { kind: 'add', size: 'big' },
        safe: { kind: 'add', size: 'mid' },
        other: { kind: 'sub', size: 'price' },
      },
      rivers: [{ lanes: ['prize'], at: 6, open: 50, seconds: 5, pressure: 1.2, density: 0.4 }],
      fence: { outer: 'prize', from: 20 },
    },
  },
};

const prep: BeatDef = {
  id: 'prep',
  rows: 2,
  tiers: {
    '1': {
      rating: 1,
      expectLoss: 0.05,
      gates: {
        prize: { kind: 'add', size: 'big' },
        safe: { kind: 'fireRate' },
        other: { kind: 'sub', size: 'price' },
      },
      enemies: [{ kind: 'brute', lane: 'prize', at: 8, wake: 45, killSeconds: 1.5 }],
    },
  },
};

export const testLibrary: BeatLibrary = {
  dps: { block: { meadow: 1, frost: 2 }, river: { meadow: 0.8, frost: 1.6 } },
  values: {
    small: [0.1, 0.1],
    mid: [0.3, 0.3],
    big: [0.5, 0.5],
    flip: [0.07, 0.07],
    price: [0.15, 0.15],
  },
  defs: [open, rest, guard, ambush, toll, flip, fork, chargeFork, fence, prep],
};

/** A script line. */
export function beat(id: string, tier = 1, prize?: ScriptBeat['prize']): ScriptBeat {
  return prize === undefined ? { beat: id, tier } : { beat: id, tier, prize };
}

/** A scripted level recipe: only the fields a script reads. */
export function scripted(
  index: number,
  script: ScriptBeat[],
  overrides: Partial<LevelGenConfig> = {},
): LevelGenConfig {
  return {
    index,
    seed: 1000 + index,
    startCount: 10,
    peakTarget: 200,
    boss: { hp: 10_000, bite: 0.5 },
    script,
    ...overrides,
  };
}

/** Nine beats in the shape of a Phase 1 ordinary level, with two rests. */
export const ORDINARY: ScriptBeat[] = [
  beat('open'),
  beat('guard'),
  beat('toll', 2),
  beat('rest'),
  beat('fence'),
  beat('ambush'),
  beat('open'),
  beat('flip'),
  beat('prep'),
];
