/**
 * The map from one tick's sim events to the clips they are said with.
 *
 * Split out of `./GameAudio.ts` in Milestone 8 Phase E for the file-size rule
 * (CLAUDE.md), on the seam that file already had: everything there is about
 * *having* an audio engine — building it, decoding into it, unlocking it,
 * muting it — and everything here is about *what the game sounds like*, which
 * is a switch over `SimEvent` and the three throttles that only it uses.
 *
 * The rules it keeps are `GameAudio`'s own: it reads sim state and events and
 * writes neither (D18), and nothing here throws.
 */

import { audioMix } from '@/data';
import type { Cue } from '@/data/audio-types';
import { weaponOf } from '@/sim';
import type { RunState, SimEvent } from '@/sim';

/** Wall clock, in milliseconds. Never the sim's clock: this is presentation. */
const now = (): number => (typeof performance === 'undefined' ? 0 : performance.now());

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

/**
 * What the map needs of the engine behind it: one clip played, and the minimum
 * interval every event class is rationed by.
 *
 * An interface rather than the `GameAudio` instance, so the two halves cannot
 * reach into each other: this one decides *what* is said and that one owns
 * whether there is anything to say it with.
 */
export interface ClipPlayer {
  play: (id: string, playbackRate?: number, volumeScale?: number) => void;
  playCue: (cue: Cue) => void;
  /** True when this key played less than `minIntervalMs` ago; stamps it if not. */
  throttled: (key: string, minIntervalMs: number) => boolean;
}

/** Turns a tick's events into clips. One per `GameAudio`, built with it. */
export class EventVoices {
  private readonly clips: ClipPlayer;
  /**
   * The engine's own pitch stream, handed in rather than made here: the result
   * screen's ticks draw from it too, and two streams would be two different
   * sequences for one seed (CLAUDE.md: no `Math.random`).
   */
  private readonly random: () => number;

  private readonly shotBurst = new Burst();
  private readonly streamKillBurst = new Burst();

  /**
   * Displayed value of each gate the last time it ticked. The gate tick follows
   * the number the player reads, so a gate taking sixty hits to climb from 6 to
   * 9 clicks three times and not sixty.
   */
  private readonly gateShown = new Map<number, number>();

  constructor(clips: ClipPlayer, random: () => number) {
    this.clips = clips;
    this.random = random;
  }

  /** Clears every throttle this map owns. Called when a run starts. */
  beginRun(): void {
    this.gateShown.clear();
    this.shotBurst.reset();
    this.streamKillBurst.reset();
  }

  /**
   * One tick's events. Called for every tick, including the intermediate ones
   * `?turbo` runs between frames, so throttling here is what keeps a
   * fast-forwarded run from sounding like static.
   */
  onEvents(events: readonly SimEvent[], state: Readonly<RunState>): void {
    const bossId = state.boss?.id;
    const clips = this.clips;
    for (const event of events) {
      switch (event.type) {
        case 'projectileFired':
          this.playShot(state);
          break;
        case 'enemyHit':
          if (bossId !== undefined && event.enemyId === bossId) {
            if (!clips.throttled('bossHit', audioMix.minIntervalMs.bossHit)) {
              clips.play('sfx_boss_hit');
            }
          } else if (!clips.throttled('enemyHit', audioMix.minIntervalMs.enemyHit)) {
            clips.play('sfx_enemy_hit');
          }
          break;
        case 'enemyKilled':
          if (event.kind === 'boss') break;
          if (event.streamId !== undefined) {
            this.playStreamKill();
          } else if (!clips.throttled('blockKill', audioMix.minIntervalMs.blockKill)) {
            clips.play('sfx_block_kill');
          }
          break;
        case 'enemyLeaked':
          if (!clips.throttled('leak', audioMix.minIntervalMs.leak)) {
            clips.play(audioMix.leak.sound, audioMix.leak.playbackRate);
          }
          break;
        case 'familiarShot':
          // The wisp fires on its own clock beside the squad, so the ceiling is
          // an interval rather than a window: it is one voice, not a volley.
          if (!clips.throttled('familiarShot', audioMix.minIntervalMs.familiarShot)) {
            clips.playCue(audioMix.familiarShot);
          }
          break;
        case 'wallBlocked':
          // Emitted on every step the clamp holds the squad, which is sixty a
          // second while a finger leans on a wall: one knock, then silence.
          if (!clips.throttled('wallBump', audioMix.minIntervalMs.wallBump)) {
            clips.playCue(audioMix.wallBump);
          }
          break;
        case 'streamCleared':
          if (!clips.throttled('streamClear', audioMix.minIntervalMs.streamClear)) {
            clips.play(audioMix.streamClear.sound, audioMix.streamClear.playbackRate);
          }
          break;
        case 'enemyShattered':
          // A block bursting into ice is its own event. A stream body doing it
          // is not: `enemyKilled` for the same body already played the stream
          // kill a line above, so a second voice here is every frost kill in a
          // river said twice. The physics layer draws the same line (it throws
          // no shards for a stream body) and so does the renderer.
          if (event.streamId !== undefined) break;
          if (!clips.throttled('shatter', audioMix.minIntervalMs.shatter)) {
            clips.play('sfx_shatter');
          }
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
          clips.play(
            audioMix.shot.sound[event.to] ?? 'sfx_shot_ember',
            audioMix.swap.playbackRate,
          );
          break;
        case 'gatePassed':
          if (!clips.throttled('gatePass', audioMix.minIntervalMs.gatePass)) {
            // A `sub` gate shot down to zero flips to `add` in the sim, so the
            // kind alone does not say whether this was good news. The count does.
            clips.play(
              event.countAfter < event.countBefore ? 'sfx_gate_pass_bad' : 'sfx_gate_pass_good',
            );
          }
          break;
        case 'unitsGained':
          if (!clips.throttled('unitsGained', audioMix.minIntervalMs.unitsGained)) {
            clips.play('sfx_units_gained');
          }
          break;
        case 'unitsLost':
          // A leak is already saying this in its own voice, one body at a time:
          // playing both would double every tick of a stream getting through.
          if (event.reason === 'leak') break;
          if (!clips.throttled('unitsLost', audioMix.minIntervalMs.unitsLost)) {
            clips.play('sfx_units_lost');
          }
          break;
        case 'bossStomp':
          // Per boss (D49): the Fiend's landing carries a crack of ice the
          // demon's does not, which is two voices on one event rather than a
          // second clip in `assets/`.
          if (!clips.throttled('stomp', audioMix.minIntervalMs.stomp)) {
            const stomp = audioMix.bossStomp;
            if (state.boss?.variant === 'rime') {
              clips.playCue(stomp.rime);
              clips.playCue(stomp.rimeIce);
            } else {
              clips.playCue(stomp.demon);
            }
          }
          break;
        case 'charge':
          // One voice at two sizes: a charger's rush, and the Rime Fiend's an
          // octave under it. Throttled together, because they are the same
          // sound and two of them at once is one muddy roar.
          if (!clips.throttled('charge', audioMix.minIntervalMs.charge)) {
            clips.playCue(event.kind === 'boss' ? audioMix.charge.boss : audioMix.charge.charger);
          }
          break;
        case 'shieldBreak':
          if (!clips.throttled('shieldBreak', audioMix.minIntervalMs.shieldBreak)) {
            clips.playCue(audioMix.shieldBreak);
          }
          break;
        // The four evolutions with a voice (D54). Every one of them is
        // throttled harder than the events it sits among, because every one of
        // them is a *moment* — the player is meant to notice it happened, not
        // to hear it running underneath the volley.
        case 'meteor':
          if (!clips.throttled('meteor', audioMix.minIntervalMs.meteor)) {
            clips.playCue(audioMix.evolutions.meteor);
          }
          break;
        case 'overcharge':
          // Only when it reached something: an arc into empty road is a
          // cooldown spent, not an event.
          if (
            event.targets > 0 &&
            !clips.throttled('overcharge', audioMix.minIntervalMs.overcharge)
          ) {
            clips.playCue(audioMix.evolutions.overcharge);
          }
          break;
        case 'freezePulse':
          if (!clips.throttled('freezePulse', audioMix.minIntervalMs.freezePulse)) {
            clips.playCue(audioMix.evolutions.freezePulse);
          }
          break;
        case 'glacier':
          if (!clips.throttled('glacier', audioMix.minIntervalMs.glacier)) {
            clips.playCue(audioMix.evolutions.glacier);
          }
          break;
        case 'bossKilled':
          clips.play('sfx_boss_death');
          break;
        case 'runEnded':
          clips.play(event.status === 'won' ? 'sfx_win_fanfare' : 'sfx_lose_sting');
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

  /** Shots: a window rather than an interval, and a little pitch each time. */
  private playShot(state: Readonly<RunState>): void {
    if (!this.shotBurst.allow(now(), audioMix.shot.windowMs, audioMix.shot.windowMax)) return;
    const id = audioMix.shot.sound[weaponOf(state.squad)] ?? 'sfx_shot_ember';
    this.clips.play(id, 1 + (this.random() * 2 - 1) * audioMix.shot.pitchSpread);
  }

  /** One body out of a stream: eight a second, each at its own pitch. */
  private playStreamKill(): void {
    const mix = audioMix.streamKill;
    if (!this.streamKillBurst.allow(now(), mix.windowMs, mix.windowMax)) return;
    this.clips.play(mix.sound, mix.playbackRate + (this.random() * 2 - 1) * mix.pitchSpread);
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
    if (this.clips.throttled('gateTick', audioMix.minIntervalMs.gateTick)) return;
    this.clips.play('sfx_gate_tick');
  }
}
