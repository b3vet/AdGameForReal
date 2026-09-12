/**
 * Two things about `GameAudio` that are not "ask Babylon to play a sound":
 * when the audio context is allowed to start, and how much of a stream it is
 * allowed to say out loud.
 *
 * `App` starts `load()` without awaiting it, so the whole engine and all
 * seventeen clips are still in flight while the title screen is up. The Play
 * tap is the only user gesture a browser is guaranteed to give us, and it can
 * land inside that window — on a cold cache it always does.
 *
 * And a stream is dozens of kills a second (D29), so the event map's job there
 * is to throw most of them away.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const engine = {
  state: 'suspended',
  volume: 1,
  unlockAsync: vi.fn(),
  dispose: vi.fn(),
};

/** Every clip the engine was asked to build, by asset id, with its play spy. */
const sounds = new Map<
  string,
  { play: ReturnType<typeof vi.fn>; playbackRate: number; volume: number }
>();

vi.mock('@babylonjs/core/AudioV2', () => ({
  CreateAudioEngineAsync: vi.fn(() => Promise.resolve(engine)),
  CreateSoundAsync: vi.fn((id: string) => {
    // `volume` as well as `playbackRate`: Milestone 4's cues set both on the
    // shared clip, so a mock without it would not catch a cue that leaves a
    // clip quiet for everything after it (`GameAudio.play`).
    const sound = { playbackRate: 1, volume: 1, play: vi.fn(), dispose: vi.fn() };
    sounds.set(id, sound);
    return Promise.resolve(sound);
  }),
}));

// Every clip's bytes would otherwise be fetched from `/assets/`.
vi.mock('@/render/characters', () => ({
  audioAssets: () =>
    [
      'sfx_ui_tap',
      'sfx_enemy_hit',
      'sfx_block_kill',
      'sfx_units_lost',
      'sfx_gate_pass_good',
      'sfx_shatter',
      // Milestone 4 reuses these three as the wisp's spark, the Academy's
      // purchase chime and its coin tick, and the win fanfare as a room's
      // reveal (D33).
      'sfx_shot_storm',
      'sfx_units_gained',
      'sfx_gate_tick',
      'sfx_win_fanfare',
    ].map((id) => ({ kind: 'audio', id, url: `audio/${id}.wav` })),
  resolveAssetUrl: (id: string) => `/assets/${id}.wav`,
  assetBytes: () => Promise.resolve(new ArrayBuffer(0)),
}));

import { GameAudio } from '../GameAudio';
import type { RunState, SimEvent } from '@/sim';

/** Just enough state for the event map: it reads the boss id and the staff. */
const state = {
  squad: { count: 10, x: 0, targetX: 0, z: 0, fireRate: 1, damage: 1, fireRateBonus: 0 },
  boss: null,
} as unknown as RunState;

const plays = (id: string): number => sounds.get(id)?.play.mock.calls.length ?? 0;

/** An unlocked engine with every clip decoded — where a run actually is. */
async function playing(): Promise<GameAudio> {
  const audio = new GameAudio();
  await audio.load();
  audio.unlock();
  await Promise.resolve();
  audio.beginRun();
  return audio;
}

beforeEach(() => {
  sounds.clear();
  engine.state = 'suspended';
  engine.volume = 1;
  engine.unlockAsync.mockReset();
  engine.unlockAsync.mockImplementation(() => {
    engine.state = 'running';
    return Promise.resolve();
  });
});

describe('GameAudio', () => {
  it('starts the context when the tap lands before the engine exists', async () => {
    const audio = new GameAudio();

    // The Play tap, while `load()` has not been called yet: this is the whole
    // bug. Before the fix `unlock` saw a null engine, returned, and nothing
    // ever asked again — the run played in silence.
    audio.unlock();
    expect(engine.unlockAsync).not.toHaveBeenCalled();

    await audio.load();
    expect(engine.unlockAsync).toHaveBeenCalledTimes(1);
    expect(audio.status).toBe('unlocked');
  });

  it('leaves the context alone when nobody has tapped anything', async () => {
    const audio = new GameAudio();
    await audio.load();

    expect(engine.unlockAsync).not.toHaveBeenCalled();
    expect(audio.status).toBe('locked');
  });

  it('unlocks on a tap that lands after the engine is up', async () => {
    const audio = new GameAudio();
    await audio.load();
    audio.unlock();

    expect(engine.unlockAsync).toHaveBeenCalledTimes(1);
  });

  /**
   * The Academy paints its home on the boot frame, so the first room reveal is
   * always owed before any gesture has happened. Dropped on the floor before
   * Milestone 4 Phase C, which is why the very first Yard opened in silence.
   */
  it('holds a room reveal owed while the context is locked and plays it on the next gesture', async () => {
    const audio = new GameAudio();
    await audio.load();

    audio.playRoomReveal();
    expect(plays('sfx_win_fanfare')).toBe(0);

    audio.unlock();
    await Promise.resolve();
    expect(plays('sfx_win_fanfare')).toBe(1);

    // Owed once, not once per tap.
    audio.unlock();
    await Promise.resolve();
    expect(plays('sfx_win_fanfare')).toBe(1);
  });

  /**
   * The plan's "a stream should sound like a crackle, not a machine gun":
   * `audio.json` allows eight stream kills a second, and a test that runs in a
   * millisecond therefore hears exactly eight of forty.
   */
  it('caps stream-body kills at the window and pitches each one', async () => {
    const audio = await playing();
    const kills: SimEvent[] = [];
    for (let i = 0; i < 40; i++) {
      kills.push({ type: 'enemyKilled', enemyId: i, kind: 'grunt', x: 0, z: 0, streamId: 1 });
    }

    audio.onEvents(kills, state);

    expect(plays('sfx_enemy_hit')).toBe(8);
    // The heavy punch belongs to a whole block coming apart, not to one body.
    expect(plays('sfx_block_kill')).toBe(0);
    expect(sounds.get('sfx_enemy_hit')?.playbackRate).not.toBe(1);
  });

  it('still plays a block kill in full', async () => {
    const audio = await playing();
    audio.onEvents([{ type: 'enemyKilled', enemyId: 1, kind: 'brute', x: 0, z: 0 }], state);

    expect(plays('sfx_block_kill')).toBe(1);
    expect(plays('sfx_enemy_hit')).toBe(0);
  });

  /**
   * A leak emits `enemyLeaked` *and* `unitsLost` with reason `leak`. Both used
   * to reach the mixer, so one body getting through said the same thing twice.
   */
  it('says a leak once, in the leak voice, and throttles the rest', async () => {
    const audio = await playing();
    const leaks: SimEvent[] = [];
    for (let i = 0; i < 5; i++) {
      leaks.push({ type: 'enemyLeaked', enemyId: i, streamId: 1, x: 0, z: 0 });
      leaks.push({ type: 'unitsLost', amount: 1, reason: 'leak' });
    }

    audio.onEvents(leaks, state);

    expect(plays('sfx_units_lost')).toBe(1);
    expect(sounds.get('sfx_units_lost')?.playbackRate).toBeLessThan(1);
  });

  it('keeps the units-lost thud for losses that are not leaks', async () => {
    const audio = await playing();
    audio.onEvents([{ type: 'unitsLost', amount: 4, reason: 'stomp' }], state);

    expect(plays('sfx_units_lost')).toBe(1);
    expect(sounds.get('sfx_units_lost')?.playbackRate).toBe(1);
  });

  it('chimes once when a stream is cleared', async () => {
    const audio = await playing();
    audio.onEvents(
      [
        { type: 'streamCleared', streamId: 1, lane: 0, leaked: 0 },
        { type: 'streamCleared', streamId: 2, lane: 1, leaked: 2 },
      ],
      state,
    );

    // Two lanes of a horde clear together; the throttle makes that one chime.
    expect(plays('sfx_gate_pass_good')).toBe(1);
    expect(sounds.get('sfx_gate_pass_good')?.playbackRate).toBeGreaterThan(1);
  });

  /**
   * A frost staff shatters what it kills, so a frozen stream emits
   * `enemyKilled` *and* `enemyShattered` for every body — twenty a second. The
   * kill is already saying it in the stream voice; the ice crack belongs to a
   * whole block coming apart, which is the line the physics layer draws too (it
   * throws no shards for a stream body).
   */
  it('does not crack ice for every body of a frozen stream', async () => {
    const audio = await playing();
    const frozen: SimEvent[] = [];
    for (let i = 0; i < 12; i++) {
      frozen.push({ type: 'enemyKilled', enemyId: i, kind: 'grunt', x: 0, z: 0, streamId: 1 });
      frozen.push({ type: 'enemyShattered', enemyId: i, x: 0, z: 0, streamId: 1 });
    }

    audio.onEvents(frozen, state);

    expect(plays('sfx_shatter')).toBe(0);
    expect(plays('sfx_enemy_hit')).toBe(8);
  });

  it('still cracks ice when a block shatters', async () => {
    const audio = await playing();
    audio.onEvents([{ type: 'enemyShattered', enemyId: 1, x: 0, z: 0 }], state);

    expect(plays('sfx_shatter')).toBe(1);
  });

  it('is silent when a stream body walks into range', async () => {
    const audio = await playing();
    const activations: SimEvent[] = [];
    for (let i = 0; i < 20; i++) activations.push({ type: 'enemyActivated', enemyId: i });

    audio.onEvents(activations, state);

    for (const [, sound] of sounds) expect(sound.play).not.toHaveBeenCalled();
  });

  /**
   * The wisp fires on its own clock and a finger can lean on a wall for a whole
   * row, so both of Milestone 4's new sim events are intervals, not volleys.
   */
  it('says the wisp and the wall once, however many events arrive', async () => {
    const audio = await playing();
    const spam: SimEvent[] = [];
    for (let i = 0; i < 10; i++) {
      spam.push({ type: 'familiarShot', x: 0, z: 0, targetId: i });
      spam.push({ type: 'wallBlocked', boundary: 1, x: 1, z: 0 });
    }

    audio.onEvents(spam, state);

    expect(plays('sfx_shot_storm')).toBe(1);
    // High and quiet for the spark, low for the knock on stone.
    expect(sounds.get('sfx_shot_storm')?.playbackRate).toBeGreaterThan(1.5);
    expect(plays('sfx_enemy_hit')).toBe(1);
    expect(sounds.get('sfx_enemy_hit')?.playbackRate).toBeLessThan(0.6);
  });

  it('gives the Academy its own voices from clips it already had', async () => {
    const audio = await playing();

    audio.playPurchase();
    audio.playUnlock();
    audio.playCoinTick();

    expect(plays('sfx_units_gained')).toBe(1);
    expect(plays('sfx_gate_pass_good')).toBe(1);
    // The gate tick, taken up: coins are brighter than gates.
    expect(plays('sfx_gate_tick')).toBe(1);
    expect(sounds.get('sfx_gate_tick')?.playbackRate).toBeGreaterThan(1.2);
  });

  it('mutes by dropping the engine to silence, unlocked or not', async () => {
    const audio = new GameAudio({ muted: true });
    await audio.load();
    expect(engine.volume).toBe(0);

    audio.setMuted(false);
    expect(engine.volume).toBe(1);
  });
});
