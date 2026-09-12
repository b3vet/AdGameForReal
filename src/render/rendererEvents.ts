/**
 * What a batch of sim events does to the views.
 *
 * Split out of `./Renderer.ts` in Milestone 3 Phase D: the renderer is about
 * the frame — build the scene, write the transforms, draw — and this is the one
 * place that turns "the sim says this happened" into "start that animation".
 * It is the only stateful part of that translation, and the state is small:
 * which body is the boss, whether its death burst has already been thrown, and
 * which staff is in hand for the effects whose events do not name one.
 *
 * Positions always come from `RunState`; events only ever start things
 * (docs/03-milestone-1-plan.md).
 */

import type { BossView } from './boss';
import type { EffectsView } from './effects';
import type { EnemyView } from './enemies';
import type { GateView } from './gates';
import type { ProjectileView } from './projectiles';
import type { SquadView } from './squad';
import { SHAKE_BOSS_KILL, SHAKE_STOMP } from './theme';
import type { WallView } from './walls';
import type { WispView } from './wisp';
import { startWeapon } from '@/sim';
import type { SimEvent, WeaponId } from '@/sim';

/** The views an event can reach, plus the camera kick. `Renderer` owns them. */
export interface EventViews {
  squad: SquadView;
  projectiles: ProjectileView;
  effects: EffectsView;
  gates: GateView;
  enemies: EnemyView;
  boss: BossView;
  walls: WallView;
  wisp: WispView;
  shake: (strength: number, seconds: number) => void;
}

/** Scratch for the position lookups, which must not allocate per event. */
const scratchFrom = { x: 0, z: 0 };
const scratchTo = { x: 0, z: 0 };

/**
 * Shatters remembered inside one batch, so the `splash` the sim emits straight
 * after one can be told from an ember blast. Eight is plenty: the sim guards
 * against a shatter cascading (`Firing.applyShatter`), so one step can only
 * resolve as many as the volley had direct kills on frozen bodies.
 */
const SHATTER_MEMORY = 8;

export class RendererEvents {
  private readonly views: EventViews;

  /** The boss's enemy id, so `enemyHit` can be routed to its hit reaction. */
  private bossId = -1;
  /** A boss death arrives as two events; the burst belongs to whichever is first. */
  private bossBurstDone = false;
  /** The staff in hand, for effects fired by events that do not name one. */
  private lastWeapon: WeaponId = startWeapon;

  /**
   * Where the bodies that shattered in the batch being applied stood.
   *
   * Frost's evolution resolves as a splash centred on the body that came apart
   * (`Firing.applyShatter`), and the sim emits it as an ordinary `splash` — the
   * same event ember's blast uses. The two want different pictures, and the
   * only thing that tells them apart without the renderer knowing the player's
   * staff tiers is that a shatter's splash is centred exactly on the position
   * the `enemyShattered` just before it carried. Ember's is centred on the
   * *shooter's* x, so the pair cannot collide by construction.
   */
  private readonly shatterX = new Float64Array(SHATTER_MEMORY);
  private readonly shatterZ = new Float64Array(SHATTER_MEMORY);
  private shatterCount = 0;

  constructor(views: EventViews) {
    this.views = views;
  }

  /**
   * Where an enemy is, for the wisp's spark to home on. Bound once: it is
   * handed to `WispView.update` every frame and a closure per frame is an
   * allocation in the steady-state path.
   */
  private readonly positionOf = (enemyId: number, out: { x: number; z: number }): boolean =>
    this.views.enemies.positionOf(enemyId, out);

  /** The lookup a spark follows its target with; see `positionOf`. */
  get targetLookup(): (enemyId: number, out: { x: number; z: number }) => boolean {
    return this.positionOf;
  }

  /**
   * A level is starting. Every run starts on `startWeapon`, and the views only
   * learn about a staff from a `weaponChanged` event — which the new run has
   * not emitted. Without this the first frames of the level after a frost run
   * draw frost bolts and cyan muzzle flashes for a squad holding ember.
   */
  reset(): void {
    this.bossId = -1;
    this.bossBurstDone = false;
    this.shatterCount = 0;
    this.setWeapon(startWeapon);
  }

  /** What `update` knows before the events are read: the boss and the staff. */
  observe(bossId: number | undefined, weaponId: WeaponId): void {
    this.bossId = bossId ?? this.bossId;
    this.lastWeapon = weaponId;
  }

  apply(events: readonly SimEvent[]): void {
    const effects = this.views.effects;
    const enemies = this.views.enemies;
    // A shatter and the splash it throws are always in the same batch, because
    // they are emitted in the same sim step.
    this.shatterCount = 0;

    for (const event of events) {
      switch (event.type) {
        case 'projectileFired':
          effects?.onMuzzle(event.x, event.z);
          break;
        case 'projectileHit':
          effects?.onImpact(event.weaponId, event.x, event.z);
          break;
        case 'splash':
          if (this.takeShatter(event.x, event.z)) {
            effects?.onShatterPuff(event.x, event.z, event.radius);
          } else {
            effects?.onSplash(event.x, event.z, event.radius);
          }
          break;
        case 'chain':
          // The event carries block ids, not positions: the view that draws
          // them is the one that knows where they are. A block that has already
          // been taken away — killed by the same volley, or shattered — has no
          // position any more, and the arc to it is simply not drawn.
          if (
            enemies !== null &&
            enemies.positionOf(event.from, scratchFrom) &&
            enemies.positionOf(event.to, scratchTo)
          ) {
            effects?.onChain(scratchFrom.x, scratchFrom.z, scratchTo.x, scratchTo.z);
          }
          break;
        case 'weaponChanged':
          this.setWeapon(event.to);
          break;
        case 'gateHit':
          this.views.gates?.onHit(event.gateId);
          break;
        case 'gatePassed':
          this.views.gates?.onPassed(event.gateId);
          // The whole squad hops through the row: a beat of feedback on the
          // choice, and the most visible place the crowd had no animation.
          this.views.squad?.onGatePassed();
          break;
        case 'enemyHit':
          if (event.enemyId === this.bossId) this.views.boss?.onHit();
          break;
        case 'enemySlowed':
          enemies?.onSlowed(event.enemyId, event.seconds);
          break;
        case 'enemyShattered':
          enemies?.onShattered(event.enemyId);
          // The shards are the physics layer's; the frost flash is the tell
          // that this *block* did not fall over, it broke. A stream body has no
          // slot to take away and keeps its baked death either way, so the
          // flash would only be a second burst on top of the `projectileHit`
          // already drawn on the same spot — twenty a second out of a pool of
          // twenty-four, which is the real impacts starved by ice chips.
          this.noteShatter(event.x, event.z);
          if (event.streamId !== undefined) break;
          effects?.onImpact('frost', event.x, event.z);
          break;
        case 'enemyLeaked':
          // The body is hidden rather than animated — it did not die, it got
          // through — and a pale puff says where it reached.
          enemies?.onLeaked(event.enemyId);
          effects?.onPuff(event.x, event.z);
          break;
        case 'enemyKilled':
          if (event.kind === 'boss') {
            this.views.boss?.onKilled();
            this.bossDeathBurst(event.x, event.z);
          } else {
            enemies?.onKilled(event.enemyId);
          }
          break;
        case 'familiarShot':
          this.views.wisp?.onShot(event.x, event.z, event.targetId, this.positionOf);
          break;
        case 'wallBlocked':
          this.views.walls?.onBlocked(event.boundary, event.z);
          break;
        case 'bossActivated':
          this.bossId = event.enemyId;
          this.views.boss?.onActivated();
          break;
        case 'bossStomp':
          this.views.boss?.onStomp(event.x, event.z);
          this.views.shake(SHAKE_STOMP.strength, SHAKE_STOMP.seconds);
          break;
        case 'bossKilled':
          this.views.boss?.onKilled();
          // `bossKilled` carries no position, unlike the `enemyKilled` that
          // usually precedes it; the view knows where it last drew the body.
          this.views.boss?.positionOf(scratchTo);
          this.bossDeathBurst(scratchTo.x, scratchTo.z);
          this.views.shake(SHAKE_BOSS_KILL.strength, SHAKE_BOSS_KILL.seconds);
          break;
        case 'runEnded':
          this.views.squad?.onRunEnded(event.status);
          break;
        default:
          // Everything else (activated, gained, lost) is already visible through
          // `RunState`; the UI layer owns the rest.
          break;
      }
    }
  }

  /** Points every view that has a per-staff look at the same staff. */
  setWeapon(weaponId: WeaponId): void {
    this.lastWeapon = weaponId;
    this.views.squad?.setWeapon(weaponId);
    this.views.projectiles?.setWeapon(weaponId);
    this.views.effects?.setWeapon(weaponId);
  }

  /** Remembers where a body came apart, for the `splash` that may follow it. */
  private noteShatter(x: number, z: number): void {
    // A ring rather than a bounded push: on the rare step that overruns the
    // memory, the newest shatter is the one whose splash is still coming.
    const at = this.shatterCount % SHATTER_MEMORY;
    this.shatterX[at] = x;
    this.shatterZ[at] = z;
    this.shatterCount++;
  }

  /** True if `(x, z)` is a shatter this batch recorded; consumes the match. */
  private takeShatter(x: number, z: number): boolean {
    const kept = Math.min(this.shatterCount, SHATTER_MEMORY);
    for (let i = 0; i < kept; i++) {
      if (this.shatterX[i] !== x || this.shatterZ[i] !== z) continue;
      // Consumed by moving the last live entry over it, so one shatter cannot
      // claim two splashes.
      const last = kept - 1;
      this.shatterX[i] = this.shatterX[last] ?? 0;
      this.shatterZ[i] = this.shatterZ[last] ?? 0;
      this.shatterCount = last;
      return true;
    }
    return false;
  }

  /**
   * A boss death reaches us as `enemyKilled` and then `bossKilled`; the burst
   * belongs to whichever arrives first, and the latch is what keeps it to one.
   */
  private bossDeathBurst(x: number, z: number): void {
    if (this.bossBurstDone) return;
    this.bossBurstDone = true;
    this.views.effects?.onBossDeath(this.lastWeapon, x, z);
  }
}
