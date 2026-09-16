/**
 * The two cues the level-design plan asks the road to give (document 31, 4.1):
 * the dust a block kicks up the step it sets off, and the portal a river
 * pours from, with the burst it throws as it opens.
 *
 * One small owner for both, because they share their marks — both are
 * `DustKicks` in the enemy view's ground-decal batch — and because the enemy
 * view, which decides when a block wakes, is at its file-size limit. The
 * squash a waking block plays is not here: it is the block's own geometry
 * (`./enemyBlocks.ts`), driven off the slot's clock (`./enemySlots.ts`).
 */

import { DustKicks } from './dustKicks';
import type { KickShape } from './dustKicks';
import type { GroundDecals } from './groundDecals';
import { PortalMarks } from './portalMarks';
import {
  WAKE_KICK_ALPHA,
  WAKE_KICK_COLOR,
  WAKE_KICK_DRIFT,
  WAKE_KICK_PUFFS,
  WAKE_KICK_SECONDS,
  WAKE_KICK_SIZE,
} from './theme';
import type { StreamState } from '@/sim';

const WAKE_KICK: KickShape = {
  puffs: WAKE_KICK_PUFFS,
  seconds: WAKE_KICK_SECONDS,
  size: WAKE_KICK_SIZE,
  drift: WAKE_KICK_DRIFT,
  alpha: WAKE_KICK_ALPHA,
  color: WAKE_KICK_COLOR,
};

export class BeatCues {
  private readonly kicks = new DustKicks();
  private readonly portals = new PortalMarks();

  /** `decals` is the frame's shared ground-mark batch, opened by the frame. */
  constructor(private readonly decals: GroundDecals) {}

  reset(): void {
    this.kicks.clear();
    this.portals.reset();
  }

  /** A block standing at `(x, z)`, `footprint` metres either side, set off. */
  wake(x: number, z: number, footprint: number): void {
    this.kicks.kick(x, z, footprint, WAKE_KICK);
  }

  /**
   * The portals in sight and every live kick, into the decal batch. Once a
   * frame, inside the batch's `begin` and `end`, after every block has been
   * looked at (a wake this frame is drawn this frame).
   */
  update(streams: readonly StreamState[], squadZ: number, dt: number): void {
    this.portals.update(streams, squadZ, dt, this.decals, this.kicks);
    this.kicks.draw(this.decals, dt);
  }

  /** Portal rings drawn last frame, for the dev harness. */
  get portalRings(): number {
    return this.portals.count;
  }
}
