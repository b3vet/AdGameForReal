/**
 * Every view the renderer owns, in one bundle: built together, handed the
 * level together, and disposed together.
 *
 * Split out of `./Renderer.ts` in Milestone 4 Phase C, which had grown past the
 * file-size rule (CLAUDE.md). The line between the two files is the one the
 * renderer's own rules draw: *this* file is the allocation — every mesh,
 * material and label exists by the time it is built, and `loadLevel` only hands
 * them out — and `Renderer.ts` is the frame: the engine, the camera, the draw
 * order, the quality rung and what the debug panel reads.
 *
 * The views are public fields rather than methods on this class on purpose. The
 * order they are written in is the frame's business, not theirs, and it is a
 * real order with real reasons (the sprite batch opens once, the wisp homes on
 * positions the enemy view has just refreshed); hiding it behind a `draw` here
 * would move the comments away from the code that needs them.
 */

import type { Scene } from '@babylonjs/core/scene';

import { BossView } from './boss';
import { BurnView } from './burn';
import { EffectsView } from './effects';
import { EnemyView } from './enemies';
import { GateView } from './gates';
import { NumberLabels } from './labels';
import { ProjectileView } from './projectiles';
import { PropsView } from './props';
import { RoadView } from './road';
import { RendererEvents } from './rendererEvents';
import { SpriteLayer } from './sprites';
import { SquadView } from './squad';
import { POOL } from './theme';
import { WallView } from './walls';
import { WispView } from './wisp';
import type { LevelDef } from '@/sim';

export class SceneViews {
  readonly labels: NumberLabels;
  readonly road: RoadView;
  readonly props: PropsView;
  readonly squad: SquadView;
  /** Every spell quad in the scene, in one batch; see `./sprites.ts`. */
  readonly sprites: SpriteLayer;
  readonly projectiles: ProjectileView;
  readonly effects: EffectsView;
  readonly gates: GateView;
  readonly enemies: EnemyView;
  readonly boss: BossView;
  /** Lane walls (D32) and the familiar (D33). */
  readonly walls: WallView;
  readonly wisp: WispView;
  /** Ember's burn (D33, tier 2), read off the bodies themselves. */
  readonly burn: BurnView;
  /** Turns "the sim says this happened" into "start that animation". */
  readonly events: RendererEvents;

  /**
   * `shake` is the renderer's own camera kick, passed in rather than reached
   * for: the rig belongs to the frame and this bundle never sees it.
   */
  constructor(scene: Scene, shake: (strength: number, seconds: number) => void) {
    this.labels = new NumberLabels(scene);
    this.road = new RoadView(scene);
    this.props = new PropsView(scene);
    this.squad = new SquadView(scene);
    this.sprites = new SpriteLayer(scene, POOL.sprites);
    this.projectiles = new ProjectileView(this.sprites);
    this.effects = new EffectsView(scene, this.sprites);
    this.gates = new GateView(scene, this.labels);
    this.enemies = new EnemyView(scene, this.labels);
    this.boss = new BossView(scene, this.labels);
    this.walls = new WallView(scene, this.sprites);
    this.wisp = new WispView(this.sprites);
    this.burn = new BurnView(this.sprites);
    this.events = new RendererEvents({
      squad: this.squad,
      projectiles: this.projectiles,
      effects: this.effects,
      gates: this.gates,
      enemies: this.enemies,
      boss: this.boss,
      walls: this.walls,
      wisp: this.wisp,
      shake,
    });
  }

  /**
   * The models, in parallel. Each loader is fail-soft: a missing `/assets/`
   * costs the art, never the boot.
   */
  async load(): Promise<void> {
    await Promise.all([
      this.squad.load(),
      this.enemies.load(),
      this.boss.load(),
      this.gates.load(),
      this.props.load(),
    ]);
  }

  /** Builds the road for this level and hands every pool back to its owner. */
  loadLevel(level: LevelDef, roadStartZ: number, roadEndZ: number): void {
    this.road.setExtent(roadStartZ, roadEndZ, level.arenaZ);
    this.props.build(level.index, roadStartZ, roadEndZ);
    // The fences are placed once here and only culled per frame afterwards
    // (`./walls.ts`); `walls` is optional on `LevelDef` for the fixtures that
    // predate D32, and an absent list is simply a level with no walls.
    this.walls.setWalls(level.walls);
    this.squad.reset();
    this.sprites.reset();
    this.projectiles.reset();
    this.effects.reset();
    this.gates.reset();
    this.enemies.reset();
    this.boss.reset();
    this.wisp.reset();
    this.burn.reset();
    this.events.reset();
  }

  dispose(): void {
    this.squad.dispose();
    this.projectiles.dispose();
    this.effects.dispose();
    this.sprites.dispose();
    this.gates.dispose();
    this.enemies.dispose();
    this.boss.dispose();
    this.walls.dispose();
    this.props.dispose();
    this.road.dispose();
    this.labels.dispose();
  }
}
