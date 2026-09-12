/**
 * Every sound the game makes.
 *
 * Babylon's v2 audio engine (`CreateAudioEngineAsync`), one `StaticSound` per
 * clip in `src/data/assets.json`, and a map from sim events to those clips.
 *
 * Three rules this module never breaks:
 *
 *   1. Nothing plays before the player taps Play. Browsers require a gesture to
 *      start an `AudioContext`, and a game that tries anyway prints an error in
 *      the console — which the smoke test treats as a failure.
 *   2. Nothing here throws. A missing clip, a blocked context or a browser
 *      without WebAudio degrades to silence; a run must never die for a sound.
 *   3. It reads sim state and events and writes neither (the same rule the
 *      physics layer follows, decision D18).
 *
 * Loudness and throttles are tuning, so they live in `src/data/audio.json`
 * (`audio-types.ts` is the schema).
 */

import { CreateAudioEngineAsync, CreateSoundAsync } from '@babylonjs/core/AudioV2';
import type { AudioEngineV2, StaticSound } from '@babylonjs/core/AudioV2';

import { audioMix } from '@/data';
import { assetBytes, audioAssets, resolveAssetUrl } from '@/render/characters';
import { mulberry32, weaponOf } from '@/sim';
import type { RunState, SimEvent } from '@/sim';



/**
 * `off`   — no engine: construction failed, or the browser has no WebAudio.
 * `loading` — the engine exists and clips are still decoding.
 * `locked`  — ready, but the audio context has not been started by a gesture.
 * `unlocked` — playing.
 */
export type AudioStatus = 'off' | 'loading' | 'locked' | 'unlocked';

/** Wall clock, in milliseconds. Never the sim's clock: this is presentation. */
const now = (): number => (typeof performance === 'undefined' ? 0 : performance.now());

/** Seeded so a replayed run sounds the same twice (CLAUDE.md: no Math.random). */
const PITCH_SEED = 0x51_04_c0_de;

/**
 * A sliding window: at most `max` plays in any `windowMs`.
 *
 * Two event classes need this rather than a minimum interval — shots and stream
 * kills — because both arrive in bursts that an interval would thin to a
 * metronome: an interval plays one of every twenty shots, evenly spaced, which
 * is the sound of a machine and not of a volley. A window lets the first eight
 * through together and then holds, which is what a crackle is.
 */
class Burst {
  private start = 0;
  private count = 0;

  allow(at: number, windowMs: number, max: number): boolean {
    if (at - this.start >= windowMs) {
      this.start = at;
      this.count = 0;
    }
    if (this.count >= max) return false;
    this.count++;
    return true;
  }

  reset(): void {
    this.start = 0;
    this.count = 0;
  }
}

export class GameAudio {
  private engine: AudioEngineV2 | null = null;
  private readonly sounds = new Map<string, StaticSound>();
  private readonly random = mulberry32(PITCH_SEED);

  private loading = false;
  private unlocked = false;
  /**
   * A gesture asked for the context before the engine existed.
   *
   * `load` is started without being awaited so twenty clips cannot hold up the
   * title screen, and a player can tap Play well before it resolves — on a cold
   * cache, every time. `unlock` then had nothing to unlock and the whole run
   * was silent, because nothing asks again until the next button. The request
   * is remembered here and replayed at the end of `load` instead.
   */
  private unlockWanted = false;
  private mutedFlag: boolean;
  private disposed = false;

  /** Last time each throttled event class played, in `now()` milliseconds. */
  private readonly lastPlayed = new Map<string, number>();

  private readonly shotBurst = new Burst();
  private readonly streamKillBurst = new Burst();

  /**
   * Displayed value of each gate the last time it ticked. The gate tick follows
   * the number the player reads, so a gate taking sixty hits to climb from 6 to
   * 9 clicks three times and not sixty.
   */
  private readonly gateShown = new Map<number, number>();

  constructor(options: { muted?: boolean } = {}) {
    this.mutedFlag = options.muted ?? false;
  }

  get muted(): boolean {
    return this.mutedFlag;
  }

  get status(): AudioStatus {
    if (this.engine === null) return this.loading ? 'loading' : 'off';
    if (this.loading) return 'loading';
    return this.refreshUnlocked() ? 'unlocked' : 'locked';
  }

  /** How many clips are decoded and playable. For the debug panel. */
  get loadedCount(): number {
    return this.sounds.size;
  }

  /**
   * Builds the engine and decodes every clip. Resolves either way: the caller
   * starts it and forgets it, and the game is playable while it runs.
   */
  async load(): Promise<void> {
    if (this.disposed || this.engine !== null || this.loading) return;
    this.loading = true;

    try {
      const engine = await CreateAudioEngineAsync({
        // Babylon's own unmute button would land on top of our title screen.
        // The game has its own mute control and unlocks on the Play tap.
        disableDefaultUI: true,
        volume: this.mutedFlag ? 0 : 1,
      });
      if (this.disposed) {
        engine.dispose();
        return;
      }
      this.engine = engine;
      await this.loadSounds(engine);
    } catch (error: unknown) {
      // Not `console.error`: a browser that refuses audio is not a broken game,
      // and the smoke test fails on errors.
      console.warn('[arcane-rush] audio unavailable', error);
      this.engine = null;
    } finally {
      this.loading = false;
      this.syncVolume();
      // The tap that asked for this happened while it was in flight. Browsers
      // allow a resume shortly after a gesture, and the worst case is a context
      // that stays suspended until the next button — which is where we were.
      if (this.unlockWanted) this.unlock();
    }
  }

  /**
   * Starts the audio context. Must be called from inside a user gesture — the
   * Play tap — or the browser leaves it suspended.
   */
  unlock(): void {
    if (this.disposed) return;
    this.unlockWanted = true;
    const engine = this.engine;
    if (engine === null) return;
    engine.unlockAsync().then(
      () => {
        this.unlocked = engine.state === 'running';
      },
      (error: unknown) => {
        console.warn('[arcane-rush] audio could not be unlocked', error);
      },
    );
  }

  setMuted(muted: boolean): void {
    this.mutedFlag = muted;
    this.syncVolume();
  }

  /** Clears every throttle. Call when a run starts, not every frame. */
  beginRun(): void {
    this.lastPlayed.clear();
    this.gateShown.clear();
    this.shotBurst.reset();
    this.streamKillBurst.reset();
  }

  /** A button was tapped. Separate from `onEvents`: buttons are not sim events. */
  playTap(): void {
    if (this.throttled('uiTap', audioMix.minIntervalMs.uiTap)) return;
    this.play('sfx_ui_tap');
  }

  /**
   * One tick's events. Called for every tick, including the intermediate ones
   * `?turbo` runs between frames, so throttling here is what keeps a
   * fast-forwarded run from sounding like static.
   */
  onEvents(events: readonly SimEvent[], state: Readonly<RunState>): void {
    // The context can start on its own — Babylon resumes it on any interaction —
    // so the cached flag is refreshed once here rather than per event.
    if (this.engine === null || this.mutedFlag || !this.refreshUnlocked()) return;

    const bossId = state.boss?.id;
    for (const event of events) {
      switch (event.type) {
        case 'projectileFired':
          this.playShot(state);
          break;
        case 'enemyHit':
          if (bossId !== undefined && event.enemyId === bossId) {
            if (!this.throttled('bossHit', audioMix.minIntervalMs.bossHit)) {
              this.play('sfx_boss_hit');
            }
          } else if (!this.throttled('enemyHit', audioMix.minIntervalMs.enemyHit)) {
            this.play('sfx_enemy_hit');
          }
          break;
        case 'enemyKilled':
          if (event.kind === 'boss') break;
          if (event.streamId !== undefined) {
            this.playStreamKill();
          } else if (!this.throttled('blockKill', audioMix.minIntervalMs.blockKill)) {
            this.play('sfx_block_kill');
          }
          break;
        case 'enemyLeaked':
          if (!this.throttled('leak', audioMix.minIntervalMs.leak)) {
            this.play(audioMix.leak.sound, audioMix.leak.playbackRate);
          }
          break;
        case 'streamCleared':
          if (!this.throttled('streamClear', audioMix.minIntervalMs.streamClear)) {
            this.play(audioMix.streamClear.sound, audioMix.streamClear.playbackRate);
          }
          break;
        case 'enemyShattered':
          // A block bursting into ice is its own event. A stream body doing it
          // is not: `enemyKilled` for the same body already played the stream
          // kill a line above, so a second voice here is every frost kill in a
          // river said twice. The physics layer draws the same line (it throws
          // no shards for a stream body) and so does the renderer.
          if (event.streamId !== undefined) break;
          if (!this.throttled('shatter', audioMix.minIntervalMs.shatter)) this.play('sfx_shatter');
          break;
        case 'gateHit':
          // `fireRate` prints as a percentage, so that is the number to follow.
          this.playGateTick(
            event.gateId,
            event.kind === 'fireRate' ? event.value * 100 : event.value,
          );
          break;
        case 'weaponChanged':
          // The staff the squad just picked up, said once and deep.
          this.play(
            audioMix.shot.sound[event.to] ?? 'sfx_shot_ember',
            audioMix.swap.playbackRate,
          );
          break;
        case 'gatePassed':
          if (!this.throttled('gatePass', audioMix.minIntervalMs.gatePass)) {
            // A `sub` gate shot down to zero flips to `add` in the sim, so the
            // kind alone does not say whether this was good news. The count does.
            this.play(
              event.countAfter < event.countBefore ? 'sfx_gate_pass_bad' : 'sfx_gate_pass_good',
            );
          }
          break;
        case 'unitsGained':
          if (!this.throttled('unitsGained', audioMix.minIntervalMs.unitsGained)) {
            this.play('sfx_units_gained');
          }
          break;
        case 'unitsLost':
          // A leak is already saying this in its own voice, one body at a time:
          // playing both would double every tick of a stream getting through.
          if (event.reason === 'leak') break;
          if (!this.throttled('unitsLost', audioMix.minIntervalMs.unitsLost)) {
            this.play('sfx_units_lost');
          }
          break;
        case 'bossStomp':
          if (!this.throttled('stomp', audioMix.minIntervalMs.stomp)) this.play('sfx_boss_stomp');
          break;
        case 'bossKilled':
          this.play('sfx_boss_death');
          break;
        case 'runEnded':
          this.play(event.status === 'won' ? 'sfx_win_fanfare' : 'sfx_lose_sting');
          break;
        default:
          // projectileHit, splash, chain, enemySlowed, streamStarted,
          // bossActivated and bossEnraged are carried by the sounds above or by
          // the renderer's effects. `enemyActivated` is deliberately silent:
          // since Milestone 3 it fires once per stream body, about twenty a
          // second, and a stream walking into range is a thing you can see.
          break;
      }
    }
  }

  /** The count-up on the result screen. Its own entry point: it is not an event. */
  playTick(): void {
    this.play('sfx_gate_tick', 1 + (this.random() - 0.5) * audioMix.shot.pitchSpread * 4);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const sound of this.sounds.values()) sound.dispose();
    this.sounds.clear();
    this.engine?.dispose();
    this.engine = null;
  }

  private async loadSounds(engine: AudioEngineV2): Promise<void> {
    await Promise.all(
      audioAssets().map(async (asset) => {
        try {
          const url = resolveAssetUrl(asset.id);
          // A single-file build carries its clips as data URIs; those are
          // decoded here rather than fetched, because that build exists for a
          // host that blocks requests (`src/render/characters/manifest.ts`).
          const source = url.startsWith('data:') ? await assetBytes(url) : url;
          const sound = await CreateSoundAsync(
            asset.id,
            source,
            {
              volume: audioMix.volume[asset.id] ?? 0.5,
              maxInstances: audioMix.maxInstances[asset.id] ?? audioMix.defaultMaxInstances,
            },
            engine,
          );
          if (this.disposed) sound.dispose();
          else this.sounds.set(asset.id, sound);
        } catch (error: unknown) {
          console.warn(`[arcane-rush] sound "${asset.id}" failed to load`, error);
        }
      }),
    );
  }

  /** Shots: a window rather than an interval, and a little pitch each time. */
  private playShot(state: Readonly<RunState>): void {
    if (!this.shotBurst.allow(now(), audioMix.shot.windowMs, audioMix.shot.windowMax)) return;
    const id = audioMix.shot.sound[weaponOf(state.squad)] ?? 'sfx_shot_ember';
    this.play(id, 1 + (this.random() * 2 - 1) * audioMix.shot.pitchSpread);
  }

  /** One body out of a stream: eight a second, each at its own pitch. */
  private playStreamKill(): void {
    const mix = audioMix.streamKill;
    if (!this.streamKillBurst.allow(now(), mix.windowMs, mix.windowMax)) return;
    this.play(mix.sound, mix.playbackRate + (this.random() * 2 - 1) * mix.pitchSpread);
  }

  /** One click per number the gate's panel actually shows. */
  private playGateTick(gateId: number, displayed: number): void {
    const rounded = Math.round(displayed);
    const previous = this.gateShown.get(gateId);
    if (previous === rounded) return;
    this.gateShown.set(gateId, rounded);
    // The first hit on a gate sets the baseline rather than clicking: the
    // player has not seen the number change yet.
    if (previous === undefined) return;
    if (this.throttled('gateTick', audioMix.minIntervalMs.gateTick)) return;
    this.play('sfx_gate_tick');
  }

  private throttled(key: string, minIntervalMs: number): boolean {
    const at = now();
    const last = this.lastPlayed.get(key);
    if (last !== undefined && at - last < minIntervalMs) return true;
    this.lastPlayed.set(key, at);
    return false;
  }

  private play(id: string, playbackRate = 1): void {
    if (this.mutedFlag || !this.unlocked) return;
    const sound = this.sounds.get(id);
    if (sound === undefined) return;
    try {
      sound.playbackRate = playbackRate;
      sound.play();
    } catch (error: unknown) {
      console.warn(`[arcane-rush] sound "${id}" failed to play`, error);
    }
  }

  private syncVolume(): void {
    const engine = this.engine;
    if (engine === null) return;
    engine.volume = this.mutedFlag ? 0 : 1;
    this.refreshUnlocked();
  }

  private refreshUnlocked(): boolean {
    this.unlocked = this.engine?.state === 'running';
    return this.unlocked;
  }
}
