/**
 * What an evolution leaves on the road: the shatter's chips (D33), the
 * meteor's landing and the overcharge's flash (D54).
 *
 * Split out of `./effects.ts` in Milestone 8 Phase E for the file-size rule
 * (CLAUDE.md), on the seam the milestone itself drew: everything left there is
 * a spell's own hit — a muzzle, an impact, a leak's puff, a shield coming apart
 * — and every one of these is a *mechanic* firing, a composite of the others.
 * None owns a pool or a mesh, so all three are free functions over the sink the
 * effects view hands them.
 *
 * The geometry half of each — the meteor's blast ring and the overcharge's arcs
 * — is not here: the ring is ember's own splash (`./effectsGeometry.ts`) and
 * the arcs are thrown by `./rendererEvents.ts`, which is the half that knows
 * where the bodies are.
 */

import { dyeToRef } from './cosmetics';
import type { Tint } from './cosmetics';
import {
  METEOR_BURSTS,
  METEOR_FLASH_DURATION,
  METEOR_FLASH_SIZE,
  OVERCHARGE_FLASH_DURATION,
  OVERCHARGE_FLASH_SIZE,
  OVERCHARGE_GLOW_BOOST,
} from './evolutionLook';
import type { SpriteBook } from './spriteSheets';
import {
  EMBER_COLOR,
  FROST_COLOR,
  IMPACT_GLOW_BOOST,
  IMPACT_Y,
  SHATTER_PUFF_DURATION,
  SHATTER_PUFF_SIZE,
  SHATTER_PUFF_SPOKES,
  STORM_COLOR,
} from './theme';
import type { WeaponId } from '@/sim';

/**
 * The three ways an emitter outside `./effects.ts` puts something on the road:
 * one flipbook quad, one staff impact, and ember's blast ring.
 *
 * An interface rather than the view itself, so these two cannot reach into its
 * pool: a burst is written through `push` or it is not written.
 */
export interface BurstSink {
  push: (
    book: SpriteBook,
    x: number,
    y: number,
    z: number,
    size: number,
    life: number,
    red: number,
    green: number,
    blue: number,
  ) => void;
  impact: (weaponId: WeaponId, x: number, z: number) => void;
  splash: (x: number, z: number, radius: number) => void;
}

/**
 * Frost tier 2: the body came apart and took its neighbours with it.
 *
 * A ring of chips thrown out to the shatter's own radius rather than the ember
 * splash ring, which is a torus in the ember hue and would read as a fire blast
 * on an ice kill. The radius is the sim's — it comes off the `splash` event the
 * shatter emits — so what the player sees is exactly how far the damage reached.
 */
export function shatterPuff(sink: BurstSink, x: number, z: number, radius: number): void {
  const tint = FROST_COLOR;
  for (let i = 0; i < SHATTER_PUFF_SPOKES; i++) {
    const angle = (i / SHATTER_PUFF_SPOKES) * Math.PI * 2 + 0.4;
    sink.push(
      'frostImpact',
      x + Math.cos(angle) * radius * 0.75,
      IMPACT_Y,
      z + Math.sin(angle) * radius * 0.75,
      SHATTER_PUFF_SIZE,
      SHATTER_PUFF_DURATION,
      tint.r * IMPACT_GLOW_BOOST,
      tint.g * IMPACT_GLOW_BOOST,
      tint.b * IMPACT_GLOW_BOOST,
    );
  }
}

/**
 * Ember tier 4: the flash and the rim bursts where a meteor landed.
 *
 * The blast ring is the ember splash's own, at the radius the sim struck at, so
 * a meteor and a big splash agree about what a blast looks like; what separates
 * them is the head falling into it (`./evolutions.ts`) and the bursts thrown
 * round the rim here.
 */
export function meteorLanding(sink: BurstSink, x: number, z: number, radius: number): void {
  sink.splash(x, z, radius);
  const tint = EMBER_COLOR;
  sink.push(
    'emberImpact',
    x,
    IMPACT_Y,
    z,
    radius * METEOR_FLASH_SIZE,
    METEOR_FLASH_DURATION,
    tint.r * IMPACT_GLOW_BOOST,
    tint.g * IMPACT_GLOW_BOOST,
    tint.b * IMPACT_GLOW_BOOST,
  );
  for (let i = 0; i < METEOR_BURSTS; i++) {
    const angle = (i / METEOR_BURSTS) * Math.PI * 2 + 0.3;
    sink.impact('ember', x + Math.cos(angle) * radius * 0.8, z + Math.sin(angle) * radius * 0.8);
  }
}

/**
 * Storm tier 4: the flash at the crowd when the volley arcs to everything at
 * once. `glow` is the worn staff tint (D53) and `dyed` the view's own scratch,
 * so this allocates nothing.
 */
export function overchargeFlash(
  sink: BurstSink,
  x: number,
  z: number,
  glow: Tint,
  dyed: [number, number, number],
): void {
  const tint = STORM_COLOR;
  dyeToRef(tint.r, tint.g, tint.b, glow, dyed);
  sink.push(
    'stormImpact',
    x,
    IMPACT_Y,
    z,
    OVERCHARGE_FLASH_SIZE,
    OVERCHARGE_FLASH_DURATION,
    dyed[0] * OVERCHARGE_GLOW_BOOST,
    dyed[1] * OVERCHARGE_GLOW_BOOST,
    dyed[2] * OVERCHARGE_GLOW_BOOST,
  );
}
