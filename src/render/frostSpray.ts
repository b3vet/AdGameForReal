/**
 * The spray a body running down a lane kicks up (D49): the charger's dust and
 * the Rime Fiend's frost wake.
 *
 * One class, two instances, because they are the same effect at two sizes and
 * two hues — a mark left behind a moving body, spreading and fading where it
 * fell. Both go into the shared ground-decal batch (`./groundDecals.ts`), so
 * neither costs a draw call of its own and neither needs a material.
 *
 * Doubly capped, exactly as the squad's fence dust is (`./squadDust.ts`): a
 * ring of `SPRAY_POOL`, and at most one new puff every `every` seconds — the
 * emitter's own cadence, since the two bodies lay down different lengths of
 * road (see the constructor). A charge is a second or two of a body moving at
 * 9 m/s, and a puff per frame is a fog bank down the lane rather than a trail.
 *
 * Both clocks — when a puff is shed and how fast it ages — run on the *sim's*
 * own time rather than on the frame's, which is the one thing here that is not
 * arbitrary. The body they follow moves at sim speed, so an emitter counting
 * frame seconds sheds marks `turbo` times further apart than the game draws
 * them: at turbo 1 the two clocks are the same number and nothing changes, and
 * at the turbo a capture runs at the trail was a dotted line that had to be
 * paced around (`scripts/smoke-run.mjs`). A track is metres of road, so it is
 * measured in the clock the metres are measured in (Milestone 7 review).
 *
 * Preallocated in full and written in place: this is on the frame path.
 */

import type { GroundDecals } from './groundDecals';
import {
  SPRAY_ALPHA,
  SPRAY_DRIFT,
  SPRAY_DURATION,
  SPRAY_EVERY,
  SPRAY_POOL,
  SPRAY_SIZE_END,
  SPRAY_SIZE_START,
} from './theme';

export class FrostSpray {
  private readonly x = new Float32Array(SPRAY_POOL);
  private readonly z = new Float32Array(SPRAY_POOL);
  private readonly age = new Float32Array(SPRAY_POOL);
  /** Which way this puff drifts across the road; ±1, from the body's motion. */
  private readonly drift = new Float32Array(SPRAY_POOL);
  private count = 0;
  /** Sim time the next puff may be shed at; one clock per emitter. */
  private nextAt = 0;
  /** Sim time `draw` last ran at, so a mark ages by sim seconds. */
  private lastTime = 0;
  /** Where the body was on the previous `emit`, and when: the two ends of the
   *  stretch of road this frame covered, which is what the back-fill lerps
   *  along. `fromTime` below zero means "no previous call". */
  private fromX = 0;
  private fromZ = 0;
  private fromTime = -1;
  /** Which side of the body the next puff is thrown from; ±1, alternating. */
  private side = 1;

  /**
   * `size` is the puff's own diameter in metres and `(r, g, b)` its hue — both
   * fixed for the life of the emitter, because one emitter is one thing
   * running. The colour is read every frame rather than copied, so a biome
   * switch moves it with the rest of the palette.
   *
   * `spread` is how far either side of the body a mark is thrown, and it is a
   * framing number rather than a physical one: the camera looks *up* the road,
   * so a trail left directly behind a body running at it is hidden by that
   * body. Thrown out from under alternate feet it reads as spray and stays in
   * frame — which is also what a heavy thing running through snow does.
   *
   * `every` and `seconds` are how often a mark is shed and how long it lasts,
   * and the two emitters want different ones because the bodies are different
   * lengths of road apart. A charger's whole run is a second inside the
   * camera's reach, so close marks that go quickly are a scuff under its feet;
   * the Rime Fiend covers seven metres and most of them are behind its own
   * three-metre body, so its track only exists as a *line* — marks far enough
   * apart not to pile into one blot, alive long enough that the far end of the
   * run is still there when the near end is laid down (Milestone 7 review).
   */
  constructor(
    private readonly size: number,
    private readonly color: { r: number; g: number; b: number },
    private readonly spread = 0,
    private readonly every = SPRAY_EVERY,
    private readonly seconds = SPRAY_DURATION,
  ) {}

  /** A new level, or a body that stopped: nothing hanging over the road. */
  clear(): void {
    this.count = 0;
    this.nextAt = 0;
    this.lastTime = 0;
    this.fromTime = -1;
  }

  /**
   * A body is at `(x, z)` moving across the road at `lateral` metres a second,
   * at sim time `time`. Call it every frame the body is running; the clock
   * inside decides how much of the road it covered actually sheds anything.
   *
   * *How much*, not whether, and that is the second half of running on the sim's
   * clock. One frame is one frame however much sim time it carried, so an
   * emitter that shed at most one mark per call left a `?turbo` capture with as
   * many marks as it had frames — three down a lane the game draws a dozen in.
   * A frame is a *stretch* of road here, and the marks the body owed along it
   * are laid where they fell, lerped between where it was and where it is. At
   * turbo 1 a frame is a sixtieth of a second and at most one deadline falls
   * inside it, so play is exactly what it was.
   */
  emit(x: number, z: number, lateral: number, time: number): void {
    const fromX = this.fromX;
    const fromZ = this.fromZ;
    const fromTime = this.fromTime;
    const span = time - fromTime;
    // Interpolate only across a real step of this emitter's own: the first call
    // of a run has nowhere to come from, and a gap longer than a mark's life is
    // a body that stopped and started again rather than one that ran.
    const lerp = fromTime >= 0 && span > 0 && span <= this.seconds;
    this.fromX = x;
    this.fromZ = z;
    this.fromTime = time;
    // No stretch to fill: the first call of a run sheds one mark where the body
    // is standing and starts the clock there. Without this the loop below would
    // fire every deadline since the level began, all at one spot.
    if (!lerp) this.nextAt = time;

    while (time >= this.nextAt && this.count < SPRAY_POOL) {
      // How far into the stretch this mark was owed: 0 at the far end, 1 here.
      const share = lerp ? (this.nextAt - fromTime) / span : 1;
      const at = this.count++;
      this.nextAt += this.every;
      this.side = -this.side;
      this.x[at] = fromX + (x - fromX) * share + this.side * this.spread;
      this.z[at] = fromZ + (z - fromZ) * share;
      // Aged by the part of the step that has already passed, so a back-filled
      // trail fades from its far end exactly as a drawn one does.
      this.age[at] = (1 - share) * span;
      // Outward: away from the body, and away from wherever it is heading when
      // it is crossing the road, so a turn throws its spray to the outside.
      this.drift[at] = lateral === 0 ? this.side : lateral < 0 ? 1 : -1;
    }
    // A clock that fell behind — the first mark of a run, or a stretch the pool
    // filled up part way through — starts again from here rather than firing
    // every missed deadline at once on the next call.
    if (this.nextAt < time) this.nextAt = time + this.every;
  }

  /**
   * Ages every mark and draws the live ones, compacting the ring as it goes.
   * Called between the decal layer's `begin` and `end`, with the sim's clock.
   *
   * The step is taken from `time` rather than handed in, because this is the
   * one call that happens on every frame whether anything is emitting or not:
   * one clock, read in one place. A restart winds it back, and a frame the app
   * spent paused or loading hands over a jump, so the step is clamped to a
   * mark's own lifetime — past that every live mark is gone anyway.
   */
  draw(decals: GroundDecals, time: number): void {
    const dt = Math.min(this.seconds, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    if (time < this.nextAt - this.every) this.nextAt = time;
    let write = 0;
    for (let i = 0; i < this.count; i++) {
      const age = (this.age[i] ?? 0) + dt;
      if (age >= this.seconds) continue;
      const phase = age / this.seconds;
      const x = this.x[i] ?? 0;
      const z = this.z[i] ?? 0;
      const away = this.drift[i] ?? 1;
      decals.add(
        x + away * phase * SPRAY_DRIFT,
        z,
        this.size * (SPRAY_SIZE_START + phase * (SPRAY_SIZE_END - SPRAY_SIZE_START)),
        this.color.r,
        this.color.g,
        this.color.b,
        // Squared rather than linear, so a mark holds most of its opacity for
        // the first half of its life and then goes quickly: a linear fade left
        // everything but the newest puff too faint to see on an ice road, which
        // is a trail that is only ever one disc long.
        (1 - phase * phase) * SPRAY_ALPHA,
      );

      if (write !== i) {
        this.x[write] = x;
        this.z[write] = z;
        this.drift[write] = away;
      }
      this.age[write] = age;
      write++;
    }
    this.count = write;
  }
}
