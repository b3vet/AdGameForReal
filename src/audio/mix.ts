/**
 * The audio mix: how loud each clip is, how many may overlap, and how often
 * each event class may retrigger.
 *
 * CLAUDE.md says tuning numbers live in `src/data/*.json`, and these belong
 * there. They are here for Milestone 2 Phase B4 only because `balance.json` is
 * the sim agent's file and two agents editing one JSON in the same phase is a
 * merge conflict waiting to happen. **Phase C should lift `audioMix` into an
 * `audio` block in `src/data/balance.json` and delete this file**; nothing else
 * in `src/audio` holds a number that is not defined here.
 *
 * Volumes are relative to the engine's own volume (1, or 0 while muted) and
 * were set by ear against `assets/audio/*.wav`, which are peak-normalised to
 * −1 dBFS — so a clip at 1.0 is as loud as the hardware goes. Keys are asset
 * ids from `src/data/assets.json`.
 */

/** Per-clip playback volume. */
const VOLUME: Readonly<Record<string, number>> = {
  sfx_shot_ember: 0.16,
  sfx_shot_storm: 0.14,
  sfx_shot_frost: 0.15,
  sfx_enemy_hit: 0.3,
  sfx_block_kill: 0.5,
  sfx_shatter: 0.45,
  sfx_gate_tick: 0.18,
  sfx_gate_pass_good: 0.5,
  sfx_gate_pass_bad: 0.55,
  sfx_units_gained: 0.45,
  sfx_units_lost: 0.5,
  sfx_boss_stomp: 0.7,
  sfx_boss_hit: 0.35,
  sfx_boss_death: 0.85,
  sfx_win_fanfare: 0.7,
  sfx_lose_sting: 0.7,
  sfx_ui_tap: 0.45,
};

/**
 * How many instances of one clip may overlap. A shot has to be able to stack —
 * that is what a volley sounds like — while a second boss death is always a
 * mistake.
 */
const MAX_INSTANCES: Readonly<Record<string, number>> = {
  sfx_shot_ember: 6,
  sfx_shot_storm: 6,
  sfx_shot_frost: 6,
  sfx_enemy_hit: 6,
  sfx_block_kill: 4,
  sfx_shatter: 3,
  sfx_gate_tick: 4,
  sfx_boss_hit: 4,
  sfx_boss_stomp: 2,
  sfx_boss_death: 1,
  sfx_win_fanfare: 1,
  sfx_lose_sting: 1,
};

/**
 * Minimum milliseconds between two plays of the same event class. Anything not
 * listed plays every time it fires.
 */
const MIN_INTERVAL_MS = {
  enemyHit: 55,
  bossHit: 90,
  blockKill: 45,
  shatter: 60,
  gateTick: 45,
  gatePass: 60,
  unitsGained: 140,
  unitsLost: 140,
  stomp: 150,
  uiTap: 60,
};

/** The clip each staff fires with, keyed by `WeaponId`. */
const SHOT_SOUND: Readonly<Record<string, string>> = {
  ember: 'sfx_shot_ember',
  storm: 'sfx_shot_storm',
  frost: 'sfx_shot_frost',
};

export const audioMix = {
  volume: VOLUME,
  maxInstances: MAX_INSTANCES,
  /** Used when `maxInstances` has no entry for a clip. */
  defaultMaxInstances: 2,
  minIntervalMs: MIN_INTERVAL_MS,
  /**
   * Shots are the one event that can arrive hundreds of times in a frame, so
   * they get a window rather than an interval: at most `windowMax` in any
   * `windowMs`, which is the plan's "8 per 100 ms". `pitchSpread` is the
   * playback-rate spread that keeps a volley from being one sample stuttering.
   */
  shot: {
    windowMs: 100,
    windowMax: 8,
    pitchSpread: 0.05,
    sound: SHOT_SOUND,
  },
};
