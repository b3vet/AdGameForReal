/**
 * The squad: a crowd of animated apprentice mages, one baked-animation thin
 * instance per *agent* — per index of `state.crowd` — standing exactly where
 * the sim put it.
 *
 * All three staffs are loaded at init and only the one in hand is drawn, so a
 * `weapon` gate swaps a mesh rather than loading anything mid-run.
 *
 * Milestone 5 drew a *formation*: the sim handed render a list of slot offsets,
 * the view placed a mage on each and then lagged it behind its slot through a
 * spring, so five hundred units did not read as one rigid sheet
 * (`./squadFlock.ts`, now gone). The units are agents now (D43) — they seek
 * their own slots, separate, slide along fences, funnel through arches and are
 * shoved by bodies, all of it in the sim — so the view's whole job is to draw
 * where they are. A second lag on top would be a slower crowd drawn over the
 * real one, hiding exactly the behaviour the milestone is about.
 *
 * A unit keeps its index for its whole life (`CrowdSim`), so an instance never
 * swaps person: everything a unit is given "at random" — its facing, its clip
 * phase, whether it casts — comes from that index and survives every gate. A
 * dead index is drawn at scale zero, once, on the frame it dies.
 *
 * The sim steps at a fixed 1/60 s and the display may run at 120, so the view
 * never draws a step: it keeps the last two and draws between them
 * (`./squadAgents.ts`). The rest of it is `./squadGait.ts` (running, casting,
 * cheering), `./squadReact.ts` (what the flags left behind),
 * `./squadDust.ts` (the scuff at a fence) and `./squadCorpses.ts` (the dead) —
 * all split out for the file-size rule (CLAUDE.md), on the seam of *what a unit
 * looks like this frame* against *what happened to it*.
 */

import type { Scene } from '@babylonjs/core/scene';

import type { Crowd } from './characters';
import { loadCrowds } from './models';
import type { ShadowLayer } from './shadows';
import type { SpriteLayer } from './sprites';
import { AgentFrame } from './squadAgents';
import { CorpseRing } from './squadCorpses';
import { SquadDust } from './squadDust';
import { SquadGait } from './squadGait';
import { AgentLook } from './squadReact';
import {
  BUMP_DURATION,
  BUMP_SQUASH,
  BUMP_YAW,
  EMBER_COLOR,
  FROST_COLOR,
  GATE_BOUNCE_DURATION,
  GATE_BOUNCE_HEIGHT,
  IDLE_SWAY_LIFT,
  IDLE_SWAY_YAW,
  MAGE_LIFT,
  MAGE_SCALE,
  POOL,
  POP_DURATION,
  POP_STRETCH,
  REJOIN_CLIP_SPEED,
  REJOIN_CROUCH,
  REJOIN_WIDEN,
  SHADOW,
  STORM_COLOR,
  STUMBLE_DIP,
  STUMBLE_DURATION,
  STUMBLE_SQUASH,
  STUMBLE_YAW,
  clipSpeed,
  crowdScale,
  popScale,
  timeOffsetOf,
  yawOf,
} from './theme';
import {
  CROWD_ON_FENCE,
  CROWD_REJOINING,
  CROWD_SHOVED,
  startWeapon,
  weaponIds,
  weaponOf,
} from '@/sim';
import type { RunState, RunStatus, WeaponId } from '@/sim';

/**
 * Re-exported where it has always lived, for the stress scene: the number
 * itself moved to `./crowdLook.ts` with the rest of how a crowd is drawn.
 */
export { crowdScale } from './crowdLook';

/** Fallback capsule colours, one per staff, when the model cannot be loaded. */
const FALLBACK_COLORS: Record<WeaponId, typeof EMBER_COLOR> = {
  ember: EMBER_COLOR,
  storm: STORM_COLOR,
  frost: FROST_COLOR,
};

export class SquadView {
  private readonly scene: Scene;
  private readonly crowds = new Map<WeaponId, Crowd>();
  private active: WeaponId = startWeapon;

  /** The two sim steps this frame is drawn between (`./squadAgents.ts`). */
  private readonly agents = new AgentFrame(POOL.squad);
  /** Lean, stumble, bump, pop: what the flags left behind (`./squadReact.ts`). */
  private readonly look = new AgentLook(POOL.squad);
  /** Scuffs at a fence, into the shared sprite batch (`./squadDust.ts`). */
  private readonly dust = new SquadDust();
  /** The dead, drawn out of the same buffer as the living (`./squadCorpses.ts`). */
  private readonly corpses = new CorpseRing();
  /** Running, standing, casting or cheering (`./squadGait.ts`). */
  private readonly gait = new SquadGait();

  /** 1 while this slot holds a zero-scale instance, so a hide is written once. */
  private readonly hidden = new Uint8Array(POOL.squad);

  constructor(scene: Scene) {
    this.scene = scene;
  }

  /**
   * Loads all three staffs, from one parse of `mage.glb`: the file carries all
   * three props and one baked texture drives every one of them.
   */
  async load(): Promise<void> {
    const capacity = POOL.squad + POOL.dyingUnits;
    const loaded = await loadCrowds(this.scene, {
      modelId: 'mage',
      variants: weaponIds,
      capacity,
      fallbackColor: FALLBACK_COLORS[startWeapon],
      fallbackColors: FALLBACK_COLORS,
      fallbackName: 'mage',
      lift: MAGE_LIFT,
    });
    weaponIds.forEach((id, index) => {
      const crowd = loaded[index];
      if (crowd === undefined) return;
      // A crowd starts hidden and `commit` turns it on when it has instances,
      // so nothing here has to enable anything.
      this.crowds.set(id, crowd);
    });
  }

  /** New level: the starting squad is simply there, with no pop animation, and
   *  nothing is left standing from the run before. */
  reset(): void {
    this.agents.reset();
    this.look.clear();
    this.dust.clear();
    this.corpses.clear();
    this.gait.reset();
    this.hidden.fill(0);
    for (const crowd of this.crowds.values()) {
      crowd.setCount(0);
      crowd.commit();
    }
  }

  /** The squad picked up a different staff: draw the crowd that carries it. */
  setWeapon(weaponId: WeaponId): void {
    if (weaponId === this.active) return;
    // The old crowd keeps its stale instances but stops being drawn; the new
    // one holds whatever *it* was last left with, so every slot is re-declared
    // on the update that follows — which is what `hidden` being cleared means.
    this.crowds.get(this.active)?.mesh.setEnabled(false);
    this.hidden.fill(0);
    this.active = weaponId;
  }

  /** Won: the survivors cheer until the next level is loaded. */
  onRunEnded(status: RunStatus): void {
    this.gait.onRunEnded(status);
  }

  /** The squad crossed a gate row: the crowd hops, front rank first. */
  onGatePassed(): void {
    this.gait.onGatePassed();
  }

  /** Where unit `index` was drawn last frame, for the probes and the harness. */
  drawnX(index: number): number {
    const frame = this.agents;
    const from = frame.prevX[index] ?? 0;
    return from + ((frame.curX[index] ?? 0) - from) * frame.alpha;
  }

  drawnZ(index: number): number {
    const frame = this.agents;
    const from = frame.prevZ[index] ?? 0;
    return from + ((frame.curZ[index] ?? 0) - from) * frame.alpha;
  }

  /**
   * Draws the crowd for this frame.
   *
   * `shadows` is the scene's one blob layer (`./shadows.ts`) and `sprites` the
   * one spell batch (`./sprites.ts`), both opened by the frame before this is
   * called: the crowd takes a block of shadow slots up front and writes into it
   * as it places each unit, so five hundred contact patches cost one
   * reservation and no allocation at all.
   */
  update(
    state: RunState,
    dt: number,
    shadows: ShadowLayer | null,
    sprites: SpriteLayer | null,
  ): void {
    const squad = state.squad;
    this.setWeapon(weaponOf(squad));
    const crowd = this.crowds.get(this.active);
    if (crowd === undefined) return;

    const agentState = state.crowd;
    if (agentState === undefined) {
      // No crowd on this state: nothing to draw, and nothing left standing from
      // whatever was drawn before.
      crowd.setCount(0);
      crowd.commit();
      return;
    }

    const agents = this.agents;
    agents.beginFrame(agentState, state.time, dt);
    this.look.beginFrame(dt);
    this.dust.beginFrame();
    if (this.gait.unprimed) this.gait.prime(this.measureSpeed());

    const crowdScaleNow = crowdScale(Math.max(1, agents.live));
    this.takeBirths();
    this.takeDeaths(crowdScaleNow);

    const inArena = squad.z >= state.arenaZ - 0.5;
    // The gate row does not reach the whole crowd at once: it passes the front
    // rank first and the seventy-seventh 13 m of road later, so the hop is a
    // wave down the column rather than one beat for five hundred units
    // (`./squadGait.ts`).
    const gait = this.gait;
    gait.beginFrame(dt, inArena);
    const hopSpeed = gait.hopSpeed;
    const limit = agents.limit;
    // One block for the whole crowd, claimed before the loop: a shared buffer
    // with several writers needs an allocator, and this is it (`./shadows.ts`).
    // -1 means the buffer is full, and a crowd with no blobs is the one thing
    // here that may quietly not happen.
    const shadowBase = shadows === null ? -1 : shadows.reserve(agents.live);
    const shadowRadius = SHADOW.mage * crowdScaleNow;

    const alive = agents.alive;
    const flags = agents.flags;
    const wasFlags = agents.wasFlags;
    const prevX = agents.prevX;
    const prevZ = agents.prevZ;
    const curX = agents.curX;
    const curZ = agents.curZ;
    const curVX = agents.curVX;
    const curVZ = agents.curVZ;
    const alpha = agents.alpha;
    const stepped = agents.stepped;
    const leaderX = squad.x;
    const frontZ = squad.z;
    let forward = 0;
    let blob = shadowBase;

    for (let i = 0; i < limit; i++) {
      if ((alive[i] ?? 0) === 0) {
        // Hidden by a scale of zero rather than by a count: indices are never
        // compacted, so a dead unit is a hole in the middle of the buffer and
        // the slots behind it are still people.
        if ((this.hidden[i] ?? 0) === 0) {
          crowd.setInstance(i, 0, 0, 0, 0, 0, 'idle', 0, 0);
          this.hidden[i] = 1;
        }
        continue;
      }
      this.hidden[i] = 0;

      const fromX = prevX[i] ?? 0;
      const fromZ = prevZ[i] ?? 0;
      const drawnX = fromX + ((curX[i] ?? 0) - fromX) * alpha;
      const drawnZ = fromZ + ((curZ[i] ?? 0) - fromZ) * alpha;
      const speedX = curVX[i] ?? 0;
      forward += curVZ[i] ?? 0;

      // The flags, read once. Everything but `REJOINING` is one step's news, so
      // the reactions are armed on the step and then run on the frame clock.
      const flag = flags[i] ?? 0;
      if (stepped && flag !== 0) {
        if ((flag & CROWD_SHOVED) !== 0) this.look.shove(i, speedX);
        if ((flag & CROWD_ON_FENCE) !== 0) {
          // The sim zeroes a held unit's lateral velocity, so which side the
          // line is on has to be inferred: the fence is the thing between this
          // unit and the head it is trying to reach, so it lies in the head's
          // direction. That holds both ways round — a column jammed against a
          // fence its finger is beyond, and a straggler shut out on the far
          // side of one — which a test against the road's centre would not.
          const side = leaderX >= drawnX ? 1 : -1;
          this.look.press(i, side);
          if (((wasFlags[i] ?? 0) & CROWD_ON_FENCE) === 0) {
            this.dust.scuff(drawnX, drawnZ, -side);
          }
        }
      }
      const rejoining = (flag & CROWD_REJOINING) !== 0;
      const lean = this.look.advance(i, speedX, dt);

      // How far back this unit stands, in metres: what the hop wave arrives on.
      const depth = frontZ > drawnZ ? frontZ - drawnZ : 0;
      const hopPhase = (gait.hopAge - depth / hopSpeed) / GATE_BOUNCE_DURATION;
      let lift =
        hopPhase > 0 && hopPhase < 1 ? Math.sin(hopPhase * Math.PI) * GATE_BOUNCE_HEIGHT : 0;

      let scale = crowdScaleNow;
      // Squash and stretch: a unit pops in thin and tall, then settles. The
      // overshoot alone reads as a unit that grew; the stretch is what reads as
      // a unit that landed.
      let stretch = 1;
      const age = this.look.pop[i] ?? -1;
      if (age >= 0) {
        const p = age / POP_DURATION;
        scale = crowdScaleNow * popScale(age);
        stretch = 1 + POP_STRETCH * Math.sin(Math.min(1, p) * Math.PI) * (1 - p * 0.5);
      }

      const sway = gait.swayOf(i);
      lift += sway * IDLE_SWAY_LIFT;
      let yaw = yawOf(i) + sway * IDLE_SWAY_YAW + lean;

      // A shove: the unit crouches, twists away from whatever hit it, and comes
      // back up. No pitch on a thin instance, so the weight is in the dip.
      const stumble = this.look.stumble[i] ?? 0;
      if (stumble > 0) {
        const dip = Math.sin((1 - stumble / STUMBLE_DURATION) * Math.PI);
        lift -= STUMBLE_DIP * dip;
        stretch *= 1 - STUMBLE_SQUASH * dip;
        yaw += (this.look.stumbleSide[i] ?? 1) * STUMBLE_YAW * dip;
      }
      // A fence: the shoulder goes into the line while the column presses.
      const bump = this.look.bump[i] ?? 0;
      if (bump > 0) {
        const press = bump / BUMP_DURATION;
        stretch *= 1 - BUMP_SQUASH * press;
        yaw += (this.look.bumpSide[i] ?? 1) * BUMP_YAW * press;
      }
      // Scurrying home from a straggler group: hunched, wider and quicker.
      if (rejoining) {
        scale *= REJOIN_WIDEN;
        stretch *= REJOIN_CROUCH;
      }

      // Under the *drawn* position, never a slot: the blob is the contact patch
      // of the mage the player is watching. The pop's own scale rides in it
      // too, so a recruit's shadow grows with it.
      if (shadows !== null && blob >= 0) {
        const grown = crowdScaleNow > 0 ? scale / crowdScaleNow : 1;
        shadows.setInstance(blob, drawnX, drawnZ, shadowRadius * grown, 1);
        blob++;
      }

      const animation = gait.animationFor(i, inArena);
      const speed = clipSpeed(animation) * (rejoining && animation === 'run' ? REJOIN_CLIP_SPEED : 1);
      crowd.setInstance(
        i,
        drawnX,
        lift,
        drawnZ,
        yaw,
        scale * MAGE_SCALE,
        animation,
        timeOffsetOf(i) + (this.look.clipKick[i] ?? 0),
        speed,
        // Uniform except while a unit is popping, stumbling or scurrying, which
        // is the whole point of the three of them.
        scale * MAGE_SCALE * stretch,
      );
    }

    gait.endFrame(agents.live > 0 ? forward / agents.live : 0, dt);
    if (sprites !== null) this.dust.draw(sprites, dt);

    const dying = this.corpses.write(crowd, limit, dt);
    // The corpses have just written over the slots above the live crowd, so
    // those slots no longer hold the zero-scale matrix `hidden` claims they do:
    // an index that fell out of the live range and comes back as a dead one
    // would otherwise keep a corpse's pose forever.
    this.hidden.fill(0, Math.min(POOL.squad, limit), Math.min(POOL.squad, limit + dying));
    crowd.setCount(limit + dying);
    crowd.commit();
    crowd.update(dt);
  }

  dispose(): void {
    for (const crowd of this.crowds.values()) crowd.dispose();
    this.crowds.clear();
  }

  /** Units that took an index this step pop in; the first frame of a level
   *  finds everyone already standing and settles them instead. */
  private takeBirths(): void {
    const agents = this.agents;
    for (let k = 0; k < agents.bornCount; k++) {
      const index = agents.born[k] ?? 0;
      this.look.spawn(index);
    }
  }

  /**
   * Units that died this step, laid down where they were: the sim's own last
   * live position and velocity for that index, not a formation slot.
   */
  private takeDeaths(scale: number): void {
    const agents = this.agents;
    for (let k = 0; k < agents.deadCount; k++) {
      const index = agents.dead[k] ?? 0;
      this.corpses.push(
        agents.prevX[index] ?? 0,
        agents.prevZ[index] ?? 0,
        agents.prevVX[index] ?? 0,
        agents.prevVZ[index] ?? 0,
        scale,
        index,
      );
    }
  }

  /**
   * The crowd's forward speed right now, for the one frame a level has no
   * history to low-pass: a level that starts with the squad already moving
   * starts with it already running.
   */
  private measureSpeed(): number {
    const agents = this.agents;
    if (agents.live === 0) return 0;
    let sum = 0;
    for (let i = 0; i < agents.limit; i++) {
      if ((agents.alive[i] ?? 0) === 0) continue;
      sum += agents.curVZ[i] ?? 0;
    }
    return sum / agents.live;
  }
}
