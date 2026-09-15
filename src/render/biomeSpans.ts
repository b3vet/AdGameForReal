/**
 * The endless road's biomes, span by span (D52).
 *
 * A campaign level is one biome for its whole length (D49) and switches at a
 * level load. The endless road alternates every `biomeSpan` metres *inside one
 * run*, which is a different problem: there is no load to hide the switch
 * behind, and at any moment the player can see two spans at once — the fog
 * reaches 260 m and a span is about 216.
 *
 * So a crossing is three things, and they happen at three different places:
 *
 *   the road     is already right. Its far half was laid in the *next* span's
 *                biome the last time a boundary was crossed (`RoadView`), so
 *                the snow starts ahead of the squad rather than arriving under
 *                it. Nothing here touches it except to say which span is which.
 *   the palette  switches as the *camera* crosses the line, not the squad: the
 *                part of the world a palette switch repaints in place — the
 *                props' tint, the kerbs, the gates — is then behind the lens.
 *   the sky      crosses the line rather than switching at it. The dome, the
 *                fog and the clear colour are lerped over `FADE_METRES` either
 *                side of the boundary, because the sky is the one surface the
 *                player sees all of at once and a cut in it is a cut in the
 *                world.
 *
 * Nothing here allocates per frame: the two `Color3`s a fade needs are built
 * when the boundary comes into range and reused until it is behind.
 */

import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';

import { paletteHexIn } from './palette';
import type { SceneViews } from './views';
import type { BiomeId } from '@/data/biome-types';
import type { LevelDef } from '@/sim';

/**
 * How far either side of a boundary the sky and the fog cross over.
 *
 * Twelve metres is about a second and a half of road at the squad's own speed:
 * long enough that the change is a transition rather than a cut, short enough
 * that the sky is never half one biome and half the other for the length of a
 * gate row.
 */
const FADE_METRES = 12;

export class BiomeSpans {
  /** The biomes the road cycles through, or empty on a single-biome level. */
  private cycle: readonly BiomeId[] = [];
  private spanMetres = 0;
  /** The span the camera was last known to stand in. */
  private index = 0;

  /** The two skies of the fade in hand, and which boundary they belong to. */
  private readonly fadeFrom = new SkyColors();
  private readonly fadeTo = new SkyColors();
  private fadeBoundary = Number.NaN;
  /** Scratch for the lerp, so a fading frame allocates nothing. */
  private readonly scratch = new Color3();

  /**
   * Reads the road's spans off the level. A level with one biome — every
   * campaign level — leaves this inactive, and `?biome=` pins the whole road
   * to one look whatever it says (the probe affordance, D49).
   */
  setLevel(level: LevelDef, forced: BiomeId | undefined): void {
    const biomes = level.biomes;
    const span = level.biomeSpan;
    const spanned =
      forced === undefined && biomes !== undefined && biomes.length > 1 && span !== undefined && span > 0;
    this.cycle = spanned && biomes !== undefined ? biomes : [];
    this.spanMetres = spanned && span !== undefined ? span : 0;
    this.index = 0;
    this.fadeBoundary = Number.NaN;
  }

  /** True when this road changes biome as it is walked. */
  get active(): boolean {
    return this.cycle.length > 1 && this.spanMetres > 0;
  }

  /** The biomes in cycle order, for the road's near and far halves. */
  get biomes(): readonly BiomeId[] {
    return this.cycle;
  }

  get span(): number {
    return this.spanMetres;
  }

  /** The span the last `applySpan` settled on. */
  get current(): number {
    return this.index;
  }

  setCurrent(index: number): void {
    this.index = index;
  }

  /** Which span `z` falls in. Never below zero: the road starts behind zero. */
  indexAt(z: number): number {
    if (!this.active) return 0;
    return Math.max(0, Math.floor(z / this.spanMetres));
  }

  /** The biome a span is painted in; the cycle repeats for ever. */
  biomeOf(index: number): BiomeId {
    const biomes = this.cycle;
    if (biomes.length === 0) return 'meadow';
    return biomes[Math.max(0, index) % biomes.length] ?? 'meadow';
  }

  /** Where the span after `index` starts. */
  boundaryAfter(index: number): number {
    return (index + 1) * this.spanMetres;
  }

  /**
   * Crossfades the sky, the fog and the clear colour across the boundary the
   * camera is nearest to.
   *
   * Outside the fade window nothing is written at all: the palette switch has
   * already put the dome and the fog on the biome in force, and rewriting them
   * every frame with the same numbers would be an upload of the dome's whole
   * colour buffer sixty times a second for no change.
   */
  blendSky(scene: Scene | null, views: SceneViews | null, cameraZ: number): void {
    if (!this.active || scene === null || views === null) return;
    // The nearest boundary: the one ahead, unless the one behind is closer.
    const ahead = this.boundaryAfter(this.indexAt(cameraZ));
    const behind = ahead - this.spanMetres;
    const boundary = cameraZ - behind < ahead - cameraZ ? behind : ahead;
    const distance = cameraZ - boundary;
    if (Math.abs(distance) > FADE_METRES) {
      this.fadeBoundary = Number.NaN;
      return;
    }

    if (boundary !== this.fadeBoundary) {
      this.fadeBoundary = boundary;
      const after = this.indexAt(boundary + this.spanMetres / 2);
      this.fadeFrom.read(this.biomeOf(after - 1));
      this.fadeTo.read(this.biomeOf(after));
    }

    // 0 a fade-width before the line, 1 a fade-width after it, smoothed so the
    // change has no corner at either end.
    const t = smoothstep((distance + FADE_METRES) / (FADE_METRES * 2));
    views.sky.setBlend(this.fadeFrom, this.fadeTo, t);
    Color3.LerpToRef(this.fadeFrom.haze, this.fadeTo.haze, t, this.scratch);
    scene.fogColor.copyFrom(this.scratch);
    Color3.LerpToRef(this.fadeFrom.zenith, this.fadeTo.zenith, t, this.scratch);
    scene.clearColor.set(this.scratch.r, this.scratch.g, this.scratch.b, 1);
  }
}

/**
 * One biome's sky, read out of the palette *without* switching it.
 *
 * The four roles the dome is built from plus the haze the fog fades into. They
 * are read by biome rather than through the roles in force, because a fade
 * needs both ends at once and the palette only ever holds one.
 */
export class SkyColors {
  readonly horizon = new Color3();
  readonly mid = new Color3();
  readonly zenith = new Color3();
  readonly haze = new Color3();

  read(biome: BiomeId): void {
    this.horizon.copyFrom(Color3.FromHexString(paletteHexIn(biome, 'sky.horizon')));
    this.mid.copyFrom(Color3.FromHexString(paletteHexIn(biome, 'sky.mid')));
    this.zenith.copyFrom(Color3.FromHexString(paletteHexIn(biome, 'sky.top')));
    this.haze.copyFrom(Color3.FromHexString(paletteHexIn(biome, 'sky.haze')));
  }
}

function smoothstep(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}
