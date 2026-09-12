/**
 * Schema for `audio.json`: how loud each clip is, how many may overlap, and how
 * often an event class may retrigger.
 *
 * A file of its own, like `assets-types.ts`: `src/data/types.ts` is the sim's
 * tuning schema and nothing in here is gameplay. Keys under `volume` and
 * `maxInstances` are asset ids from `assets.json`; keys under `shot.sound` are
 * `WeaponId`s, kept as strings so the data layer stays free of sim types.
 *
 * Volumes are relative to the engine's own volume (1, or 0 while muted) and
 * were set by ear against `assets/audio/*.wav`, which are peak-normalised to
 * -1 dBFS — so a clip at 1.0 is as loud as the hardware goes.
 */

export interface AudioMix {
  /** Per-clip playback volume, by asset id. */
  volume: Readonly<Record<string, number>>;
  /**
   * How many instances of one clip may overlap. A shot has to be able to
   * stack — that is what a volley sounds like — while a second boss death is
   * always a mistake.
   */
  maxInstances: Readonly<Record<string, number>>;
  /** Used when `maxInstances` has no entry for a clip. */
  defaultMaxInstances: number;
  /** Minimum milliseconds between two plays of the same event class. */
  minIntervalMs: {
    enemyHit: number;
    bossHit: number;
    blockKill: number;
    shatter: number;
    gateTick: number;
    gatePass: number;
    unitsGained: number;
    unitsLost: number;
    stomp: number;
    uiTap: number;
    /** One body walked into the squad. The plan's "six a second". */
    leak: number;
    /** A stream ran out. Two lanes of a horde clear together; this is the flam. */
    streamClear: number;
  };
  /**
   * Shots are the one event that can arrive hundreds of times in a frame, so
   * they get a window rather than an interval: at most `windowMax` in any
   * `windowMs`, which is the plan's "8 per 100 ms". `pitchSpread` is the
   * playback-rate spread that keeps a volley from being one sample stuttering.
   */
  shot: {
    windowMs: number;
    windowMax: number;
    pitchSpread: number;
    /** The clip each staff fires with, keyed by weapon id. */
    sound: Readonly<Record<string, string>>;
  };
  /**
   * Picking up a staff plays that staff's own shot clip, slowed down: the
   * sound the squad is about to make for the rest of the run, said once and
   * heavily. No new asset, and it cannot be mistaken for a different gate.
   */
  swap: { playbackRate: number };
  /**
   * A single stream body dying (Milestone 3, D29).
   *
   * Streams kill dozens of bodies a second, so this gets the same sliding
   * window the shots do rather than an interval: eight in any second, each at
   * its own pitch, so a stream reads as a crackle running down the lane instead
   * of one sample machine-gunning. The clip is the light hit rather than
   * `block_kill` — that heavy punch is a whole block collapsing, and a grunt is
   * one skeleton — pitched down a little so a kill still lands under the hits.
   */
  streamKill: {
    windowMs: number;
    windowMax: number;
    playbackRate: number;
    pitchSpread: number;
    sound: string;
  };
  /**
   * A body reached the squad and cost a soldier: the units-lost thud dropped an
   * octave and a bit, which is short, low and unmistakably bad news. It stands
   * in for the `unitsLost` sound on a leak, which would otherwise say the same
   * thing twice in the same millisecond.
   */
  leak: { sound: string; playbackRate: number };
  /**
   * A stream is spent: the gate's own good-news latch pitched up into a bright
   * tick. Nothing else in the mix is that high, and it cannot be mistaken for a
   * gate because a gate is a panel the squad is standing in.
   */
  streamClear: { sound: string; playbackRate: number };
}
