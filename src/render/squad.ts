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
 * (`./squadAgents.ts`). What is left here is one loop: where each unit is drawn
 * this frame, and the instance and blob shadow that come out of it.
 *
 * The rest is split out for the file-size rule (CLAUDE.md), on the seam of
 * *what a unit looks like this frame* against *what happened to it*:
 * `./squadGait.ts` (running, casting, cheering, and the crowd's speed),
 * `./squadReact.ts` (what the flags left behind, and what they do to a unit's
 * transform), `./squadDust.ts` (the scuff at a fence), `./squadDeaths.ts` (who
 * popped in, who fell, and which of them the physics layer takes) and
 * `./squadCorpses.ts` (the ring the rest of them lie in).
 */

import type { Scene } from '@babylonjs/core/scene';

import type { Crowd } from './characters';
import { WornParts } from './cosmetics';
import type { WornTints } from './cosmetics';
import { loadCrowds } from './models';
import type { ShadowLayer } from './shadows';
import type { SpriteLayer } from './sprites';
import { AgentFrame } from './squadAgents';
import { SquadDeaths } from './squadDeaths';
import type { FallenSink } from './squadDeaths';
import { SquadDust } from './squadDust';
import { SquadGait } from './squadGait';
import { AgentLook } from './squadReact';
import {
  EMBER_COLOR,
  FROST_COLOR,
  GATE_BOUNCE_DURATION,
  GATE_BOUNCE_HEIGHT,
  IDLE_SWAY_LIFT,
  IDLE_SWAY_YAW,
  MAGE_LIFT,
  MAGE_SCALE,
  POOL,
  REJOIN_CLIP_SPEED,
  SHADOW,
  STORM_COLOR,
  clipSpeed,
  crowdScale,
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
  /** Who popped in, who fell, and what became of them (`./squadDeaths.ts`). */
  private readonly deaths = new SquadDeaths();
  /** Running, standing, casting or cheering (`./squadGait.ts`). */
  private readonly gait = new SquadGait();

  /** 1 while this slot holds a zero-scale instance, so a hide is written once. */
  private readonly hidden = new Uint8Array(POOL.squad);

  /** The hat and cape tints the player is wearing (D53), dyed once for all
   *  three crowds (`./cosmetics.ts`). */
  private readonly dressing = new WornParts();

  constructor(scene: Scene) {
    this.scene = scene;
  }

  /**
   * The tints the squad is wearing (D53). Called at a level load and when the
   * Academy's backdrop is re-dressed — never per frame: one call re-tints every
   * mage of every staff, because a crowd is one mesh drawn many times.
   *
   * The three crowds are told together rather than only the one in hand, so a
   * staff gate mid-run hands over a mage already wearing the right hat.
   */
  setCosmetics(tints: WornTints): void {
    const parts = this.dressing.set(tints);
    for (const crowd of this.crowds.values()) crowd.setPartTints(parts);
  }

  /** Whether `src/physics` takes one squad death in ten (`./squadDeaths.ts`). */
  setRagdolls(enabled: boolean): void {
    this.deaths.setRagdolls(enabled);
  }

  /** Hands this frame's fallen units to `sink` and forgets them. */
  drainFallen(sink: FallenSink): void {
    this.deaths.drain(sink);
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
    // The models arrive after the first `setCosmetics` in the normal case (the
    // load is not awaited by the title screen), so whatever is worn is applied
    // again here rather than lost.
    this.setCosmetics(this.dressing.worn);
  }

  /** New level: the starting squad is simply there, with no pop animation, and
   *  nothing is left standing from the run before. */
  reset(): void {
    this.agents.reset();
    this.look.clear();
    this.dust.clear();
    this.deaths.clear();
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
    if (this.gait.unprimed) this.gait.prime(this.gait.measureSpeed(agents));

    const crowdScaleNow = crowdScale(Math.max(1, agents.live));
    this.deaths.takeBirths(agents, this.pop);
    this.deaths.takeDeaths(agents, crowdScaleNow);

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
      // Everything this unit's own reactions do to its transform, in one pass
      // over its timers (`./squadReact.ts`).
      const react = this.look.advance(i, speedX, dt, rejoining);

      // How far back this unit stands, in metres: what the hop wave arrives on.
      const depth = frontZ > drawnZ ? frontZ - drawnZ : 0;
      const hopPhase = (gait.hopAge - depth / hopSpeed) / GATE_BOUNCE_DURATION;
      const hop =
        hopPhase > 0 && hopPhase < 1 ? Math.sin(hopPhase * Math.PI) * GATE_BOUNCE_HEIGHT : 0;

      const sway = gait.swayOf(i);
      const lift = hop + sway * IDLE_SWAY_LIFT + react.lift;
      const yaw = yawOf(i) + sway * IDLE_SWAY_YAW + react.yaw;
      const scale = crowdScaleNow * react.scale;
      const stretch = react.stretch;

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

    const dying = this.deaths.write(crowd, limit, dt);
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

  /**
   * A unit took a free index: it pops in where it stands. A field rather than a
   * closure made per frame, because nothing on the frame path may allocate.
   */
  private readonly pop = (index: number): void => {
    this.look.spawn(index);
  };
}
