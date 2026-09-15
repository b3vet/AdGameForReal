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
import { mulberry32 } from '@/sim';
import type { RunState, SimEvent } from '@/sim';

import { EventVoices } from './audioEvents';
import type { ClipPlayer } from './audioEvents';

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
  /**
   * A room reveal that was owed while the context was still locked.
   *
   * The Academy paints its home — and plays the reveal of any room the save has
   * just opened — on the frame the game boots, which is always before the first
   * gesture, so the very first reveal (the Yard, at level 1) was silent every
   * time. Remembered here and played from the `unlock` that the next tap runs,
   * which is a gesture the browser will start a context for.
   */
  private revealOwed = false;
  private mutedFlag: boolean;
  /**
   * The app is in the background (`src/device/lifecycle.ts`, D34).
   *
   * A second flag rather than a share of `mutedFlag`, because it answers a
   * different question and has a different owner. `mutedFlag` is the player's
   * choice and is written to the save; this is the phone taking the app away —
   * a call, the lock screen, the app switcher — and it must not touch that
   * choice, or a run interrupted by a notification would come back silent for
   * good. Either one silences the engine (`silent` below); only the player's
   * one survives a return to the foreground.
   */
  private suspendedFlag = false;
  private disposed = false;

  /** Last time each throttled event class played, in `now()` milliseconds. */
  private readonly lastPlayed = new Map<string, number>();

  /**
   * What a tick's events sound like (`./audioEvents.ts`), and the three ways
   * it reaches the clips. Both are built once, here: `onEvents` runs on every
   * sim tick — several per frame under `?turbo` — and nothing on that path may
   * allocate (CLAUDE.md).
   */
  private readonly clips: ClipPlayer = {
    play: (id: string, playbackRate?: number, volumeScale?: number): void => {
      this.play(id, playbackRate, volumeScale);
    },
    playCue: (cue: { sound: string; playbackRate: number; volume: number }): void => {
      this.playCue(cue);
    },
    throttled: (key: string, minIntervalMs: number): boolean =>
      this.throttled(key, minIntervalMs),
  };
  private readonly voices = new EventVoices(this.clips, this.random);

  constructor(options: { muted?: boolean } = {}) {
    this.mutedFlag = options.muted ?? false;
  }

  get muted(): boolean {
    return this.mutedFlag;
  }

  /** True while the app is in the background. */
  get suspended(): boolean {
    return this.suspendedFlag;
  }

  /**
   * Whether anything at all may be heard right now: the player's mute, or the
   * app being off screen. Every gate in this file asks this rather than
   * `mutedFlag`, so a new reason to be quiet is one line here.
   */
  private get silent(): boolean {
    return this.mutedFlag || this.suspendedFlag;
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
        volume: this.silent ? 0 : 1,
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
        if (this.unlocked && this.revealOwed) {
          this.revealOwed = false;
          this.playCue(audioMix.ui.roomReveal);
        }
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

  /**
   * The app went to the background, or came back (D34).
   *
   * iOS keeps a WebAudio context running under a lock screen and behind the app
   * switcher, so without this a paused run keeps singing in the player's
   * pocket. The engine's master volume is what is turned down — a clip already
   * playing goes quiet with it — and `play` and `onEvents` stop starting new
   * ones, so nothing queues up to shout on the way back.
   *
   * The context itself is left running: suspending and resuming it costs a
   * gesture to unlock again on some browsers, which the player would have to
   * find by tapping a button, and the run they came back to has none.
   */
  setSuspended(suspended: boolean): void {
    if (this.suspendedFlag === suspended) return;
    this.suspendedFlag = suspended;
    this.syncVolume();
  }

  /** Clears every throttle. Call when a run starts, not every frame. */
  beginRun(): void {
    this.lastPlayed.clear();
    this.voices.beginRun();
  }

  /** A button was tapped. Separate from `onEvents`: buttons are not sim events. */
  playTap(): void {
    if (this.throttled('uiTap', audioMix.minIntervalMs.uiTap)) return;
    this.play('sfx_ui_tap');
  }

  /**
   * The Academy's own voices (plan, "Academy"). None of them is a sim event —
   * a purchase happens on a menu with no run behind it — so each gets an entry
   * point of its own rather than a place in the event map.
   */
  playPurchase(): void {
    if (this.throttled('purchase', audioMix.minIntervalMs.purchase)) return;
    this.playCue(audioMix.ui.purchase);
  }

  /** A staff or the wisp changing hands: heavier than a plain purchase. */
  playUnlock(): void {
    this.playCue(audioMix.ui.unlock);
  }

  /**
   * A room opening for the first time. Once per room, ever — and the first one
   * is owed at boot, before any gesture has been made, so a locked context
   * holds it over to the next tap rather than dropping it (`revealOwed`).
   */
  playRoomReveal(): void {
    if (!this.silent && !this.refreshUnlocked()) {
      this.revealOwed = true;
      return;
    }
    this.playCue(audioMix.ui.roomReveal);
  }

  /** One step of the result screen's coin count-up. */
  playCoinTick(): void {
    const cue = audioMix.ui.coinTick;
    this.play(
      cue.sound,
      cue.playbackRate + (this.random() - 0.5) * audioMix.shot.pitchSpread * 2,
      cue.volume,
    );
  }

  /**
   * One tick's events, handed to the map that knows what each one sounds like
   * (`./audioEvents.ts`). Called for every tick, including the intermediate
   * ones `?turbo` runs between frames.
   */
  onEvents(events: readonly SimEvent[], state: Readonly<RunState>): void {
    // The context can start on its own — Babylon resumes it on any interaction —
    // so the cached flag is refreshed once here rather than per event.
    if (this.engine === null || this.silent || !this.refreshUnlocked()) return;
    this.voices.onEvents(events, state);
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

  /** A reused clip at its own pitch and level (`audio-types.ts`, `Cue`). */
  private playCue(cue: { sound: string; playbackRate: number; volume: number }): void {
    this.play(cue.sound, cue.playbackRate, cue.volume);
  }

  private throttled(key: string, minIntervalMs: number): boolean {
    const at = now();
    const last = this.lastPlayed.get(key);
    if (last !== undefined && at - last < minIntervalMs) return true;
    this.lastPlayed.set(key, at);
    return false;
  }

  /**
   * `volumeScale` is always written, never left from the last caller: the
   * clips are shared instances, so a cue that plays a clip quietly would
   * otherwise leave every later play of that clip quiet too.
   */
  private play(id: string, playbackRate = 1, volumeScale = 1): void {
    if (this.silent || !this.unlocked) return;
    const sound = this.sounds.get(id);
    if (sound === undefined) return;
    try {
      sound.playbackRate = playbackRate;
      sound.volume = (audioMix.volume[id] ?? 0.5) * volumeScale;
      sound.play();
    } catch (error: unknown) {
      console.warn(`[arcane-rush] sound "${id}" failed to play`, error);
    }
  }

  private syncVolume(): void {
    const engine = this.engine;
    if (engine === null) return;
    engine.volume = this.silent ? 0 : 1;
    this.refreshUnlocked();
  }

  private refreshUnlocked(): boolean {
    this.unlocked = this.engine?.state === 'running';
    return this.unlocked;
  }
}
