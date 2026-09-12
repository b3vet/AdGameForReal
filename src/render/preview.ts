/**
 * The Academy backdrop (docs/12-milestone-4-plan.md): the dressed road the home
 * screen sits on, and what the player's purchases put on it.
 *
 * The app builds its backdrop as a real preview `Run` with the same
 * `PlayerState` a run would use, so most of it needs nothing here — the crowd
 * already carries the chosen staff, because `SquadView` draws whichever staff
 * `state.squad.weaponId` names, and the road, the props and the walls are the
 * level's own.
 *
 * Two things do not come for free, and they are what this holds:
 *
 *   - the shot is dead still. A preview run is never ticked (`src/core/frame.ts`
 *     draws it once and stops as soon as the camera settles), so without the
 *     drift the home screen is a single frame repeated and reads as a paused
 *     game rather than as a place. `active` is what the rig's drift and
 *     `Renderer.isSettled` are driven from.
 *   - the wisp is never moved. `Run` builds a `FamiliarState` for a player who
 *     owns one, but nothing advances it without ticks — and the Sanctum has to
 *     show the familiar it has just sold, beside the mages, immediately. So
 *     this keeps a stand-in and parks it at the sim's own hover offset.
 */

import { playerMods, progression } from '@/sim';
import type { FamiliarState, FamiliarTier, PlayerState, RunState } from '@/sim';

export class PreviewBackdrop {
  /** Non-null while the Academy is up; the app sets it, never the frame loop. */
  private familiar: FamiliarState | null = null;
  private showing = false;

  /** True while a backdrop is being shown rather than a run being played. */
  get active(): boolean {
    return this.showing;
  }

  /**
   * `null` ends the preview — the app calls it as a run starts — and anything
   * else starts one for that player.
   */
  setPlayer(player: PlayerState | null): void {
    this.showing = player !== null;
    if (player === null) {
      this.familiar = null;
      return;
    }
    const tier = playerMods(player).familiarTier;
    this.familiar =
      tier > 0 ? { x: 0, z: 0, tier: tier as FamiliarTier, cooldown: 0, side: 1 } : null;
  }

  /**
   * The familiar to draw this frame: the run's own whenever there is one, and
   * the backdrop's stand-in otherwise. Mutated in place — the backdrop is drawn
   * every frame the home screen is up, and a fresh object per frame is an
   * allocation in a loop that runs for as long as the player browses.
   */
  familiarFor(state: RunState): FamiliarState | null {
    const live = state.familiar;
    if (live !== null && live !== undefined) return live;
    const preview = this.familiar;
    if (preview === null) return null;
    preview.x = state.squad.x + progression.wisp.offsetX;
    preview.z = state.squad.z + progression.wisp.offsetZ;
    return preview;
  }
}
