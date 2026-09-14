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
import { ShadowLayer, addPropShadows } from './shadows';
import { SkyDome } from './sky';
import { SpriteLayer } from './sprites';
import { SquadView } from './squad';
import { POOL } from './theme';
import { WallView } from './walls';
import { WispView } from './wisp';
import type { BiomeId } from '@/data/biome-types';
import type { LevelDef } from '@/sim';

/**
 * Moving blob shadows one frame can hold: every mage, every minion the crowd
 * pool can draw, every brute and the boss, with a little slack. One `Float32`
 * matrix each, so the whole buffer is under 70 KB.
 */
const SHADOW_CAPACITY = POOL.squad + POOL.grunts + POOL.brutes + 8;
/** Roadside props a level dresses with; see `PropsView.build`. */
const PROP_SHADOW_CAPACITY = 192;

export class SceneViews {
  readonly labels: NumberLabels;
  /** The dome, its clouds and the hills (`./sky.ts`); drawn before everything. */
  readonly sky: SkyDome;
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
  /**
   * Blob shadows (D38), shared by every view that puts something on the road.
   *
   * Public here rather than reached for through a view, because five owners
   * write into it — the squad, the enemy blocks and their stream bodies, the
   * boss and the roadside props — and the one that opens and closes it is the
   * frame (`Renderer.update`). See `./shadows.ts` for the call order.
   */
  readonly shadows: ShadowLayer;
  /** Turns "the sim says this happened" into "start that animation". */
  readonly events: RendererEvents;

  /** Kept for `dressRoadside`, which reads the props back off the scene. */
  private readonly scene: Scene;

  /**
   * `shake` is the renderer's own camera kick, passed in rather than reached
   * for: the rig belongs to the frame and this bundle never sees it.
   */
  constructor(scene: Scene, shake: (strength: number, seconds: number) => void) {
    this.scene = scene;
    this.labels = new NumberLabels(scene);
    // First, so its meshes are the first opaque submeshes the scene registers
    // and the dome is painted before the road that stands in front of it.
    this.sky = new SkyDome(scene);
    this.road = new RoadView(scene);
    this.shadows = new ShadowLayer(scene, {
      capacity: SHADOW_CAPACITY,
      staticCapacity: PROP_SHADOW_CAPACITY,
    });
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
   *
   * The road's arena markers and the wall piece are in here for the warm-up's
   * sake rather than for the art's: both views kick their own load off in their
   * constructor and would arrive on their own, but a slow one would arrive
   * *after* `Renderer.init` had compiled the scene — and a material that misses
   * the pass compiles inside the first frame that draws it, which is the frame
   * the squad reaches a fence or the arena.
   */
  async load(): Promise<void> {
    await Promise.all([
      this.squad.load(),
      this.enemies.load(),
      this.boss.load(),
      this.gates.load(),
      this.props.load(),
      this.road.load(),
      this.walls.load(),
    ]);
  }

  /**
   * Repaints every view that a biome changes (D49): the ground under the road,
   * the sky over it, and which kinds the roadside is dressed with.
   *
   * Called from `Renderer.setBiome`, which has already switched the palette —
   * so every role these views read has moved before any of them is asked to
   * re-read one. Nothing here creates or destroys a mesh, a material or a
   * texture: both biomes' albedos and both biomes' prop meshes were built at
   * boot, so a campaign's worth of switches leaves the scene exactly as it
   * booted. The roadside's own instances are written by the `dressRoadside`
   * that follows in `loadLevel`.
   */
  setBiome(id: BiomeId): void {
    this.road.setBiome(id);
    this.sky.setBiome();
    this.props.setBiome(id);
  }

  /** Locks the materials that never change, after the first readiness pass. */
  freeze(): void {
    this.props.freeze();
    this.road.freeze();
    this.sky.freeze();
    this.shadows.freeze();
  }

  /**
   * Dresses a stretch of road with props and puts a blob under each of them.
   *
   * The two go together and always have to: the roadside never moves again
   * inside a level, so its shadows are written once here rather than
   * re-uploaded sixty times a second with the crowd's, and a `props.build` that
   * forgot this would leave a level's trees hovering.
   */
  dressRoadside(levelIndex: number, startZ: number, endZ: number): void {
    this.props.build(levelIndex, startZ, endZ);
    this.shadows.reset();
    addPropShadows(this.scene, this.shadows);
  }

  /** Builds the road for this level and hands every pool back to its owner. */
  loadLevel(level: LevelDef, roadStartZ: number, roadEndZ: number): void {
    this.road.setExtent(roadStartZ, roadEndZ, level.arenaZ);
    this.dressRoadside(level.index, roadStartZ, roadEndZ);
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
    this.shadows.dispose();
    this.sky.dispose();
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
