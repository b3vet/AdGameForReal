/**
 * One playthrough of one level.
 *
 * The sim is deterministic: a fixed 1/60 s step behind an accumulator, no
 * `Math.random`, no `Date`. `state` is the live object the sim mutates, not a
 * copy — render reads it every frame and must never write to it.
 *
 * The heavy phases live next door: `crowd.ts` owns the units as agents,
 * `firing.ts` owns the shot clock, projectiles and weapon effects, `contact.ts`
 * owns blocks walking in, `boss.ts` owns the arena fight, and `crossings.ts`
 * owns which group takes which gate. `Run` is the order they happen in and the
 * one place the run ends.
 *
 * Milestone 6 moved every path that changes the count through the crowd (D43):
 * a gate spawns people at the back of the group it resolved for or takes them
 * off its tail, a block or a body kills the people it landed on, and a stomp
 * kills whoever was standing under the foot. `squad.count` is the total alive
 * and the crowd maintains it, so the plaque, the bots and the balance model
 * read exactly what they always did.
 */

import { Arenas } from './arenas';
import { BossController } from './boss';
import { advanceEnemies } from './contact';
import type { Burn } from './burn';
import { Crossings } from './crossings';
import type { GateSink } from './crossings';
import { CrowdSim } from './crowd';
import type { Swath } from './crowdState';
import type { Evolutions } from './evolutions';
import { EventBuffer } from './events';
import type { Familiar } from './familiar';
import type { Firing } from './firing';
import { availableWidth, clampLimit, openRoadWidth } from './formation';
import { steerLeader } from './leader';
import type { LevelDef } from './level';
import { buildLoadout } from './loadout';
import { playerMods } from './player';
import type { PlayerMods } from './player';
import { buildWorld } from './spawn';
import { Streams } from './streams';
import { TargetList } from './targeting';
import type {
  EnemyState,
  RunState,
  RunStatus,
  SimEvent,
  SquadState,
  UnitLossReason,
  WeaponId,
} from './types';
import { wallX } from './walls';
import type { WallDef } from './walls';
import { weaponDef, weaponOf } from './weapons';
import type { Balance, PlayerState } from '@/data/types';

/** The sim always steps at 1/60 s regardless of frame rate, so runs are reproducible. */
const FIXED_DT = 1 / 60;

/** Guards against a huge `dt` after a tab stall turning into a spiral of steps. */
const MAX_STEPS_PER_TICK = 8;

/**
 * Steps a fence keeps its `wallBlocked` latch after the last shoulder comes off
 * it. A crowd leaning on a fence touches it in bursts — a group is cut in two,
 * both halves settle, and for a step or two nobody is quite against the line —
 * and without this every burst would be a fresh thud. A quarter of a second is
 * long enough to bridge the settling and short enough that walking into the
 * *next* stretch still sounds.
 */
const WALL_LATCH_STEPS = 15;

export class Run {
  private readonly level: LevelDef;
  private readonly balance: Balance;
  private readonly runState: RunState;
  private readonly events = new EventBuffer();
  private readonly targets = new TargetList();
  private readonly firing: Firing;
  private readonly burn: Burn | null;
  private readonly streams: Streams;
  private readonly boss = new BossController();
  /** The endless road's boss stops (document 28); null on a campaign level. */
  private readonly arenas: Arenas | null;
  private readonly crowd: CrowdSim;
  private readonly crossings: Crossings;
  /** The two evolutions that run on a clock of their own (D54). */
  private readonly evolutions: Evolutions;

  /** Left-over time from the previous `tick`, carried into the next fixed step. */
  private accumulator = 0;

  /** Set by `abandon`, acted on by the next `tick`. Debug only; see `abandon`. */
  private abandoned = false;

  /** The player's upgrades, resolved once (D35). `NO_MODS` when there is none. */
  private readonly mods: PlayerMods;
  private readonly walls: readonly WallDef[];
  private readonly familiar: Familiar | null;

  /** Wall currently holding units, so `wallBlocked` fires on the edge only. */
  private blockedWall = -1;

  /** Steps since a unit was last held by `blockedWall`. See `WALL_LATCH_STEPS`. */
  private blockedIdle = 0;

  /** Bound once, not per frame: `contact.ts` calls back into the loss check. */
  private readonly hitSquad = (
    amount: number,
    reason: UnitLossReason,
    x: number,
    z: number,
    group: number,
  ): void => {
    this.loseUnits(amount, reason, x, z, group);
  };

  /** The same, for the stream a leaked body belonged to. */
  private readonly onLeak = (enemy: EnemyState): void => {
    this.streams.noteLeaked(enemy);
  };

  /**
   * What a gate does once `Crossings` has decided whose it was. Built once,
   * not per frame: the sim must not allocate a closure in a step (CLAUDE.md).
   */
  private readonly sink: GateSink = {
    resize: (group: number, wanted: number): void => {
      const held = this.crowd.groups[group]?.count ?? 0;
      const target = Math.max(0, Math.floor(wanted));
      if (target > held) this.crowd.spawn(group, target - held);
      else if (target < held) this.crowd.killBack(group, held - target);
      this.runState.squad.count = this.crowd.total;
    },
    swapWeapon: (id: WeaponId | undefined): void => {
      this.swapWeapon(id);
    },
    wiped: (): void => {
      this.finish('lost');
    },
  };

  /**
   * `player` is optional and a player with nothing bought resolves to the
   * identity: every multiplier is 1, no wisp, ember at tier 1 (D35). The
   * campaign's balance bands are defined at exactly that point, and everything
   * bought above it is the squad getting stronger against the same road.
   *
   * The level's own two upgrades — starting units and what an `add` gate prints
   * — were applied by `generateLevel`, so they are not applied again here.
   */
  constructor(level: LevelDef, balance: Balance, player?: PlayerState) {
    this.level = level;
    this.balance = balance;
    this.mods = playerMods(player);
    this.walls = level.walls ?? [];

    const staff = this.mods.staff;
    const squad: SquadState = {
      count: 0,
      x: 0,
      targetX: 0,
      z: 0,
      fireRate: balance.squad.fireRate * this.mods.fireRate,
      damage: balance.squad.damage * weaponDef(staff).damage * this.mods.damage,
      fireRateBonus: 0,
      weaponId: staff,
      vx: 0,
      // Overwritten by the first step; a sensible width before it, so anything
      // that reads the state before the run starts sees the open road.
      formationWidth: openRoadWidth(balance),
    };

    const world = buildWorld(level, balance);
    this.arenas = level.arenas === undefined ? null : new Arenas(level, world.bosses, balance);
    this.crowd = new CrowdSim(balance, this.walls);
    this.crossings = new Crossings(level, balance, this.crowd.groups.length, this.sink);
    squad.count = this.crowd.spawn(0, level.startCount);

    this.runState = {
      levelIndex: level.index,
      seed: level.seed,
      time: 0,
      status: 'running',
      squad,
      gates: world.gates,
      enemies: world.enemies,
      streams: [],
      projectiles: [],
      boss: world.boss,
      peakCount: squad.count,
      survivors: squad.count,
      // On the endless road, the first boss's line rather than the road's end:
      // `arenaZ` is always the next place the squad stops (`./arenas.ts`).
      arenaZ: this.arenas?.firstLine ?? level.arenaZ,
      familiar: null,
      walls: this.walls,
      crowd: this.crowd.crowd,
      groups: this.crowd.groups,
      ice: null,
    };
    // Written only on the endless road, and its presence is what tells the two
    // roads apart everywhere outside the generator (D52) — the HUD's chip, the
    // result sheet and `runRewards`, which pays by distance when it is there.
    if (level.endless === true) this.runState.endless = { metres: 0 };

    this.streams = new Streams(balance, this.events, this.targets, level.seed, world.nextId);
    for (const row of level.rows) {
      for (const def of row.streams ?? []) this.runState.streams.push(this.streams.add(def, row.z));
    }
    this.streams.countStanding(world.enemies);
    this.targets.build(this.runState, balance);

    const loadout = buildLoadout(
      balance,
      this.events,
      this.targets,
      this.streams,
      this.mods,
      () => {
        // A campaign boss is the end of the level; an endless one opens the
        // road to the next (document 28).
        if (this.arenas === null) this.finish('won');
        else this.arenas.opened(this.runState);
      },
      this.crowd,
    );
    this.firing = loadout.firing;
    this.burn = loadout.burn;
    this.familiar = loadout.familiar;
    this.evolutions = loadout.evolutions;
    if (this.familiar !== null) {
      this.runState.familiar = this.familiar.create(squad, this.mods.familiarTier);
    }
  }

  /** The live state object. Render reads it; nothing outside the sim writes it. */
  get state(): Readonly<RunState> {
    return this.runState;
  }

  /** Clamped to the road; the head eases onto it through the leader spring. */
  setTargetX(x: number): void {
    const limit = this.clampLimit();
    this.runState.squad.targetX = Math.min(Math.max(x, -limit), limit);
  }

  /**
   * How far from the centre line the head may stand: the road less the crowd's
   * own half-width, never wider than `road.clampX` and never tighter than
   * `road.clampMin` (D37, D42).
   *
   * The road is the *only* thing that bounds it now (D43). A wall used to clamp
   * it as well, which is what made a fence a rail the finger slid along; the
   * fence stops the units instead, and whoever is on the wrong side of it when
   * it starts to hold is cut off as a straggler (D44).
   */
  private clampLimit(): number {
    const squad = this.runState.squad;
    return clampLimit(squad.count, squad.formationWidth, this.balance);
  }

  /**
   * Advances the sim and returns the events produced since the last call.
   * The array and the event objects in it are re-used by the next `tick`.
   */
  tick(dt: number): SimEvent[] {
    this.events.reset();
    // A run stopped from outside ends *here*, so its `runEnded` goes out with
    // this tick's events rather than into a buffer `reset` throws away.
    if (this.abandoned) {
      this.abandoned = false;
      this.finish('lost');
      return this.events.list;
    }
    if (this.runState.status !== 'running') return this.events.list;

    this.accumulator += dt;

    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_TICK) {
      this.accumulator -= FIXED_DT;
      steps++;
      this.step(FIXED_DT);
      if (this.runState.status !== 'running') break;
    }

    // A stall long enough to exhaust the step budget is dropped rather than
    // replayed, so the sim never falls permanently behind wall-clock time.
    if (steps >= MAX_STEPS_PER_TICK) this.accumulator = 0;

    return this.events.list;
  }

  /**
   * Ends the run at the next tick, as a loss, without a body being touched.
   *
   * Nothing in the game calls it and nothing may — a run ends on a wipe, on the
   * boss, or at the end of the endless road, and a fourth way out is a fourth
   * thing the economy has to price. It is for the one caller that has to stop a
   * run it is not playing: the smoke's endless walk, through
   * `ArcaneDebugHandle.endRun`, which photographs two biome crossings and has
   * no business walking the other two kilometres to reach a result sheet.
   *
   * Flagged rather than finished on the spot because `tick` is where the event
   * buffer is emptied: a `runEnded` written between two ticks is dropped by the
   * next `reset`, and the defeat sting rides on it.
   */
  abandon(): void {
    this.abandoned = true;
  }

  private step(dt: number): void {
    const state = this.runState;
    const squad = state.squad;

    state.time += dt;

    // The band the crowd fills before anything reads its width.
    squad.formationWidth = availableWidth(state, this.balance);

    // Re-clamped every step, not only when the player steers: the limit moves
    // as the crowd grows and shrinks (see `clampLimit`).
    const limit = this.clampLimit();
    squad.targetX = Math.min(Math.max(squad.targetX, -limit), limit);
    steerLeader(squad, this.balance, dt);

    // The squad stops at the arena to fight the boss: the level's one, or on
    // the endless road whichever boss is next (document 28).
    this.arenas?.release(state);
    if (squad.z < state.arenaZ) {
      squad.z = Math.min(state.arenaZ, squad.z + this.level.runSpeed * dt);
    }
    if (state.endless !== undefined) state.endless.metres = squad.z;

    // Leaders, stragglers, forces: every unit moves here and nowhere else.
    this.crowd.step(state, dt);
    squad.count = this.crowd.total;
    this.noteWall(this.crowd.fenceWall, squad.z);

    // Every phase can end the run, and `runEnded` is the last event of its
    // tick: nothing may fire, walk or stomp after the run is over.
    this.crossings.update(state, this.crowd, this.events);
    if (state.status !== 'running') return;

    // Spawn before the lists are refreshed, so a body born this step is sorted
    // into its lane and can be shot in the same step it appears in.
    this.streams.spawn(state, dt);
    this.targets.update(state, this.balance, dt);
    this.firing.beginStep(state, dt);
    this.firing.update(state, dt);
    if (state.status !== 'running') return;
    this.firing.fire(state, dt);
    if (state.status !== 'running') return;
    // After the squad's own fire and before anything walks: a burn tick and a
    // spark are hits like any other, and a body they kill must not also get a
    // step of walking this frame.
    if (this.burn !== null) {
      this.burn.update(state);
      if (state.status !== 'running') return;
    }
    if (this.familiar !== null) {
      this.familiar.update(state, dt);
      if (state.status !== 'running') return;
    }
    // The meteor and the glacier, on the same seam as the burn and the wisp:
    // after the squad's own fire and before anything walks, so a body the
    // meteor kills does not also get a step of walking, and a wall of ice is
    // standing before the bodies it holds take their step (D54).
    this.evolutions.update(state, dt);
    if (state.status !== 'running') return;
    advanceEnemies(state, this.balance, this.events, dt, this.hitSquad, this.onLeak);
    if (state.status !== 'running') return;
    // After everything has moved: heads, counts, the `streamCleared` edge and
    // the corpse sweep.
    this.streams.settle(state);
    this.updateBoss(dt);
    if (state.status !== 'running') return;

    if (squad.count > state.peakCount) state.peakCount = squad.count;
    state.survivors = squad.count;
    if (squad.count <= 0) this.finish('lost');
    // An endless run ends on the wipe above or on the end of the road (D52),
    // which is the level's own line rather than the state's: that one is the
    // next boss until the last of them is down. Checked last, so the step that
    // reaches the end still resolves in full.
    else if (state.endless !== undefined && squad.z >= this.level.arenaZ) this.finish('won');
  }

  /**
   * `wallBlocked` on the edge only: a fence holds units on every step the
   * player leans the column against it, and a sound per step is a buzz.
   *
   * It is the *crowd* that reports this now rather than the head's own clamp
   * (D43): the head is never blocked, so the event is exactly what it says —
   * somebody's shoulder is against a fence.
   */
  private noteWall(wall: number, z: number): void {
    if (wall < 0) {
      if (++this.blockedIdle >= WALL_LATCH_STEPS) this.blockedWall = -1;
      return;
    }
    this.blockedIdle = 0;
    if (this.blockedWall === wall) return;
    this.blockedWall = wall;
    const def = this.walls[wall];
    if (def === undefined) return;
    // The event carries the fence's own x, not the squad's: that is where the
    // push is seen and where a sound should come from.
    this.events.wallBlocked(def.boundary, wallX(def.boundary, this.balance.road.laneWidth), z);
  }

  /** A staff gate swaps the squad's staff for the rest of the run. */
  private swapWeapon(next: WeaponId | undefined): void {
    if (next === undefined) return;
    const squad = this.runState.squad;
    const current = weaponOf(squad);
    if (next === current) return;
    squad.weaponId = next;
    squad.damage = this.balance.squad.damage * weaponDef(next).damage * this.mods.damage;
    this.events.weaponChanged(current, next);
  }

  private updateBoss(dt: number): void {
    const state = this.runState;
    // The endless road's next boss, once the column is past the last one: filed
    // for the sweeps like anything else that joins the road, and fought with a
    // fresh set of clocks.
    const next = this.arenas?.advance(state) ?? null;
    if (next !== null) {
      this.targets.insert(next, this.balance);
      this.boss.reset();
    }
    const boss = state.boss;
    if (boss === null || !boss.alive) return;

    const step = this.boss.update(
      boss,
      state.squad,
      state.arenaZ,
      this.balance,
      dt,
      this.arenas?.bite ?? this.level.boss.bite ?? 1,
      state.time,
      state.crowd,
    );
    if (step.activated) this.events.bossActivated(boss.id);
    if (step.enraged) this.events.bossEnraged(boss.id);
    // The Rime Fiend's lane charge (D49). Its dead are the people standing
    // under the body this step and nobody else (document 29). The landing is
    // told before the loss, so a charge that wipes the column still ends its
    // tick on `runEnded`.
    if (step.charged) this.events.charge(boss.id, boss.kind, step.chargeLane);
    if (step.chargeKills > 0) {
      const swath = step.chargeSwath;
      if (step.chargeLanded) this.events.chargeHit(boss.id, swath.x, swath.zLo);
      this.loseUnits(step.chargeKills, 'charge', boss.x, boss.z, -1, swath);
      if (state.status !== 'running') return;
    }
    // Whoever is standing nearest the boss, whichever group they are in: its
    // reach and its foot do not know about fences.
    if (step.contactKills > 0) {
      this.loseUnits(step.contactKills, 'contact', boss.x, boss.z, -1);
      if (state.status !== 'running') return;
    }
    if (step.stomped) {
      this.events.bossStomp(boss.x, boss.z);
      this.loseUnits(step.stompKills, 'stomp', boss.x, boss.z, -1);
    }
  }

  /**
   * Takes the units standing nearest `(x, z)`, in `group` or in any of them,
   * and only from inside `within` when it is given.
   */
  private loseUnits(
    amount: number,
    reason: UnitLossReason,
    x: number,
    z: number,
    group: number,
    within?: Readonly<Swath>,
  ): void {
    const squad = this.runState.squad;
    const before = squad.count;
    const killed = this.crowd.killNearest(group, amount, x, z, within);
    if (killed <= 0) return;
    squad.count = this.crowd.total;
    this.events.unitsLost(before - squad.count, reason);
    if (squad.count <= 0) this.finish('lost');
  }

  private finish(status: RunStatus): void {
    const state = this.runState;
    if (state.status !== 'running') return;
    state.status = status;
    state.survivors = status === 'won' ? state.squad.count : 0;
    this.events.runEnded(status, state.survivors, state.peakCount);
  }
}
