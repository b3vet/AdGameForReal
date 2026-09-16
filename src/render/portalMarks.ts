/**
 * The mark on the road a river pours from (document 31, 3.2 and 4.1).
 *
 * A scripted road's rivers do not keep pace with the squad any more: each one
 * pours from a fixed point, a portal, that opens when the squad is `openAt`
 * short of it. The player has to be able to see that place from as far off as
 * the river's count (`THREAT_SIGHT`), because whether the portal stands in
 * front of a panel or behind one is the whole question of a toll beat. So a
 * portal is a ring on the road in the enemies' own colour, a lane wide: it
 * breathes while it waits, throws a burst of dust and swells as it opens, and
 * fades once it is poured out, cut short, or reached.
 *
 * What it draws is `StreamState.anchorZ` and the stream's own flags, read every
 * frame. The one thing remembered is per portal *in sight* — how far the ring
 * has opened and faded, and whether its burst has been thrown — in a handful of
 * slots found by stream id each frame, so a road with any number of rivers
 * needs no more than the few that can be on screen at once. Both marks are
 * ground decals (`./groundDecals.ts`) and the burst is a `DustKicks` shape: no
 * draw call, no material, nothing allocated on the frame path.
 */

import type { DustKicks, KickShape } from './dustKicks';
import type { GroundDecals } from './groundDecals';
import {
  LABEL_BEHIND,
  PORTAL_BURST_ALPHA,
  PORTAL_BURST_COLOR,
  PORTAL_BURST_DRIFT,
  PORTAL_BURST_PUFFS,
  PORTAL_BURST_SECONDS,
  PORTAL_BURST_SIZE,
  PORTAL_COLOR,
  PORTAL_DRAW_RANGE,
  PORTAL_FADE_SECONDS,
  PORTAL_OPEN_ALPHA,
  PORTAL_OPEN_SCALE,
  PORTAL_OPEN_SECONDS,
  PORTAL_PULSE_DEPTH,
  PORTAL_PULSE_HZ,
  PORTAL_RING_ALPHA,
  PORTAL_RING_INNER,
  PORTAL_RING_POOL,
  PORTAL_RING_SIZE,
} from './theme';
import { balance } from '@/data';
import { laneCenter } from '@/sim';
import type { StreamState } from '@/sim';

const BURST: KickShape = {
  puffs: PORTAL_BURST_PUFFS,
  seconds: PORTAL_BURST_SECONDS,
  size: PORTAL_BURST_SIZE,
  drift: PORTAL_BURST_DRIFT,
  alpha: PORTAL_BURST_ALPHA,
  color: PORTAL_BURST_COLOR,
};

export class PortalMarks {
  /** The stream each slot follows, or -1 when the slot is free. */
  private readonly stream = new Int32Array(PORTAL_RING_POOL).fill(-1);
  /** How far the ring has opened and faded, each 0 to 1. */
  private readonly opened = new Float32Array(PORTAL_RING_POOL);
  private readonly faded = new Float32Array(PORTAL_RING_POOL);
  /** Whether the opening burst has been thrown. */
  private readonly burst = new Uint8Array(PORTAL_RING_POOL);
  /** The frame each slot was last in sight, so a portal left behind frees it. */
  private readonly seen = new Uint32Array(PORTAL_RING_POOL);
  private frame = 0;
  /** Seconds of breathing, for the waiting ring's pulse. */
  private clock = 0;
  private drawn = 0;

  reset(): void {
    this.stream.fill(-1);
    this.clock = 0;
    this.drawn = 0;
  }

  /**
   * Draws every portal in sight into `decals`, and throws the burst of any
   * that opened since the last frame into `kicks`. Called between the decal
   * layer's `begin` and `end`; `dt` is the frame's sim time.
   */
  update(
    streams: readonly StreamState[],
    squadZ: number,
    dt: number,
    decals: GroundDecals,
    kicks: DustKicks,
  ): void {
    this.frame++;
    this.clock += dt;
    this.drawn = 0;
    const pulse = 1 + PORTAL_PULSE_DEPTH * Math.sin(this.clock * PORTAL_PULSE_HZ * Math.PI * 2);
    const stopGap = balance.enemies.portal.stopGap;

    for (let i = 0; i < streams.length; i++) {
      const stream = streams[i];
      const anchor = stream?.anchorZ;
      if (stream === undefined || anchor === undefined) continue;
      const ahead = anchor - squadZ;
      if (ahead > PORTAL_DRAW_RANGE || ahead < -LABEL_BEHIND) continue;
      const slot = this.slotFor(stream);
      if (slot < 0) continue;
      this.seen[slot] = this.frame;

      const x = laneCenter(stream.lane);
      if (stream.started && this.burst[slot] === 0) {
        this.burst[slot] = 1;
        kicks.kick(x, anchor, PORTAL_RING_SIZE / 2, BURST);
      }
      const poured =
        stream.done || stream.cut === true || stream.spawned >= stream.count || ahead <= stopGap;
      const opened = stream.started
        ? Math.min(1, (this.opened[slot] ?? 0) + dt / PORTAL_OPEN_SECONDS)
        : 0;
      const faded = poured ? Math.min(1, (this.faded[slot] ?? 0) + dt / PORTAL_FADE_SECONDS) : 0;
      this.opened[slot] = opened;
      this.faded[slot] = faded;
      if (faded >= 1) continue;

      // Eased out, so the ring snaps open and settles rather than growing at
      // a constant rate the eye reads as a zoom.
      const open = 1 - (1 - opened) * (1 - opened);
      const size = PORTAL_RING_SIZE * (1 + (PORTAL_OPEN_SCALE - 1) * open);
      const waiting = PORTAL_RING_ALPHA * pulse;
      const alpha = (waiting + (PORTAL_OPEN_ALPHA - waiting) * open) * (1 - faded);
      decals.add(
        x,
        anchor,
        size,
        PORTAL_COLOR.r,
        PORTAL_COLOR.g,
        PORTAL_COLOR.b,
        alpha,
        PORTAL_RING_INNER,
      );
      this.drawn++;
    }

    // A portal that left sight gives its slot back.
    for (let slot = 0; slot < PORTAL_RING_POOL; slot++) {
      if (this.seen[slot] !== this.frame) this.stream[slot] = -1;
    }
  }

  /** Rings drawn last frame, for the dev harness. */
  get count(): number {
    return this.drawn;
  }

  /**
   * The slot following this stream, binding a free one the first time it is in
   * sight, or -1 when every slot is taken. A portal first seen already open —
   * a road picked up mid-pour — is bound open, with its burst spent.
   */
  private slotFor(stream: StreamState): number {
    let free = -1;
    for (let slot = 0; slot < PORTAL_RING_POOL; slot++) {
      const id = this.stream[slot];
      if (id === stream.id) return slot;
      if (id === -1 && free < 0) free = slot;
    }
    if (free < 0) return -1;
    this.stream[free] = stream.id;
    this.opened[free] = stream.started ? 1 : 0;
    this.faded[free] = 0;
    this.burst[free] = stream.started ? 1 : 0;
    return free;
  }
}
