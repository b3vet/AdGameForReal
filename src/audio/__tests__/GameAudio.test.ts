/**
 * The one thing about `GameAudio` that is not "ask Babylon to play a sound":
 * when the audio context is allowed to start.
 *
 * `App` starts `load()` without awaiting it, so the whole engine and all
 * seventeen clips are still in flight while the title screen is up. The Play
 * tap is the only user gesture a browser is guaranteed to give us, and it can
 * land inside that window — on a cold cache it always does.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const engine = {
  state: 'suspended',
  volume: 1,
  unlockAsync: vi.fn(),
  dispose: vi.fn(),
};

vi.mock('@babylonjs/core/AudioV2', () => ({
  CreateAudioEngineAsync: vi.fn(() => Promise.resolve(engine)),
  CreateSoundAsync: vi.fn(() =>
    Promise.resolve({ playbackRate: 1, play: vi.fn(), dispose: vi.fn() }),
  ),
}));

// Every clip's bytes would otherwise be fetched from `/assets/`.
vi.mock('@/render/characters', () => ({
  audioAssets: () => [{ kind: 'audio', id: 'sfx_ui_tap', url: 'audio/ui_tap.wav' }],
  resolveAssetUrl: (id: string) => `/assets/${id}.wav`,
  assetBytes: () => Promise.resolve(new ArrayBuffer(0)),
}));

import { GameAudio } from '../GameAudio';

beforeEach(() => {
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

  it('mutes by dropping the engine to silence, unlocked or not', async () => {
    const audio = new GameAudio({ muted: true });
    await audio.load();
    expect(engine.volume).toBe(0);

    audio.setMuted(false);
    expect(engine.volume).toBe(1);
  });
});
