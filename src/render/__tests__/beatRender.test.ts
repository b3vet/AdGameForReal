/**
 * What the level-design plan asked of the road's picture (document 31, 4.1):
 * how far out things are drawn and numbered, where a threat's number goes when
 * a gate's is in the way, which plaques turn see-through, and the wake cue.
 *
 * Every rule here is arithmetic on positions, so it is pinned without a GPU:
 * the placement rule is checked by projecting its answer back through the same
 * analytic camera, and the plaque rule on real one-beat roads out of the
 * composer, so a beat that stops screening its threat fails here first.
 */

import { describe, expect, it } from 'vitest';

import { balance } from '@/data';
import { Run, buildBeatLevel, laneCenter } from '@/sim';
import type { GateState } from '@/sim';

import { stanceOf } from '../enemyBlocks';
import type { BlockStance } from '../enemyBlocks';
import { GATE_PLAQUE_HEIGHT } from '../gateLook';
import { GateScreens } from '../gateScreens';
import {
  createLabelView,
  gateCoversLabel,
  heightAtScreen,
  placeBlockLabel,
  screenY,
  setLabelView,
} from '../labelClearance';
import { labelPixels } from '../labels';
import {
  CAMERA,
  ENEMY_DRAW_RANGE,
  ENEMY_LABEL_MIN,
  ENEMY_LABEL_RANGE,
  ENEMY_LABEL_SIZE,
  FOG_START,
  GATE_CENTER_Y,
  GATE_DRAW_RANGE,
  GATE_LABEL_MIN,
  GATE_LABEL_RANGE,
  GATE_LABEL_SIZE,
  GATE_SIDE_GLANCE_SCALE,
  SIDE_GATE_LABEL_RANGE,
  THREAT_SIGHT,
  WAKE_SQUASH_SECONDS,
  gateLabelReach,
  gateLabelScale,
  wakePop,
  wakeSquash,
} from '../theme';

/** A squad the camera has fully pulled back for, standing at the origin. */
const SQUAD = 300;

function gate(lane: -1 | 0 | 1, z: number, kind: GateState['kind'] = 'add'): GateState {
  return { id: lane + 1, rowIndex: 0, lane, z, kind, value: 25, hits: 0, passed: false };
}

function view(): ReturnType<typeof createLabelView> {
  return setLabelView(createLabelView(), 0, SQUAD);
}

describe('draw and label ranges', () => {
  it('draws and numbers a threat from the plan’s sight line, bodies first', () => {
    expect(ENEMY_LABEL_RANGE).toBeGreaterThanOrEqual(THREAT_SIGHT);
    expect(ENEMY_DRAW_RANGE).toBeGreaterThan(ENEMY_LABEL_RANGE);
    // The camera stands at most about fifteen metres behind the squad, so the
    // furthest body drawn is still short of the haze.
    expect(ENEMY_DRAW_RANGE + 15).toBeLessThan(FOG_START);
  });

  it('draws an arch a row past its number, and numbers every lane from 45 m', () => {
    expect(GATE_DRAW_RANGE).toBeGreaterThan(GATE_LABEL_RANGE);
    expect(GATE_LABEL_RANGE).toBeGreaterThanOrEqual(45);
    expect(gateLabelReach(0, false)).toBe(GATE_LABEL_RANGE);
    expect(gateLabelReach(2, false)).toBe(GATE_LABEL_RANGE);
    expect(gateLabelReach(0, true)).toBe(GATE_LABEL_RANGE);
    // A side staff word does not fit between two lanes that far out.
    expect(gateLabelReach(-2, true)).toBe(SIDE_GATE_LABEL_RANGE);
  });

  it('shrinks a side lane’s number smoothly to a glance, and never the middle one', () => {
    expect(gateLabelScale(0, GATE_LABEL_RANGE)).toBe(1);
    expect(gateLabelScale(2, SIDE_GATE_LABEL_RANGE)).toBe(1);
    expect(gateLabelScale(-2, GATE_LABEL_RANGE)).toBeCloseTo(GATE_SIDE_GLANCE_SCALE);
    const mid = gateLabelScale(2, (SIDE_GATE_LABEL_RANGE + GATE_LABEL_RANGE) / 2);
    expect(mid).toBeLessThan(1);
    expect(mid).toBeGreaterThan(GATE_SIDE_GLANCE_SCALE);
  });
});

describe('placing a threat’s number', () => {
  it('solves the projection it places against', () => {
    const v = view();
    for (const [y, z] of [
      [0.95, 12],
      [1.6, 40],
      [0.3, 66],
    ] as const) {
      expect(heightAtScreen(v, screenY(v, y, z), z)).toBeCloseTo(y, 6);
    }
  });

  it('lifts an ambush’s number over the plaque it would print on', () => {
    const v = view();
    const row = [gate(1, 26)];
    const x = laneCenter(1);
    const z = 31;
    const top = screenY(v, GATE_CENTER_Y + (GATE_PLAQUE_HEIGHT * 1.25) / 2, 26);
    // Left where it rides, the number is inside the plaque's band.
    expect(screenY(v, 0.95, z)).toBeLessThan(top);
    const y = placeBlockLabel(row, x, z, 0.95, 12, v);
    expect(Number.isNaN(y)).toBe(false);
    expect(y).toBeGreaterThan(0.95);
    expect(screenY(v, y, z)).toBeGreaterThan(top);
    // A river's count is only hidden inside that band, never moved.
    expect(gateCoversLabel(row, x, z, 0.95, v)).toBe(true);
  });

  it('keeps a guard’s number on screen under the number it guards', () => {
    const v = view();
    const x = laneCenter(-1);
    for (const g of [30, 38, 44]) {
      const row = [gate(-1, g)];
      for (const at of [-6, -8, -10]) {
        const y = placeBlockLabel(row, x, g + at, 0.95, 12, v);
        expect(Number.isNaN(y)).toBe(false);
        expect(y).toBeLessThanOrEqual(0.95);
        expect(screenY(v, y, g + at)).toBeLessThan(screenY(v, GATE_CENTER_Y, g));
      }
    }
  });

  it('keeps a guard on its hold line numbered, clear of the glyphs as the sheet draws them', () => {
    // The sheet's own ink, outline included: figures reach 0.422 em above
    // their anchor and a 3, 5 or 9 hangs 0.469 em below it.
    const pixel = (2 * Math.tan(CAMERA.fov / 2)) / 844;
    const x = laneCenter(-1);
    for (const count of [100, SQUAD]) {
      const v = setLabelView(createLabelView(), 0, count);
      for (const g of [44, 38, 30, 22, 14, 8, 5, 3]) {
        const px = labelPixels(ENEMY_LABEL_SIZE, ENEMY_LABEL_MIN, g - 1);
        const y = placeBlockLabel([gate(-1, g)], x, g - 1, 0.95, px, v);
        expect(Number.isNaN(y), `${String(count)} at ${String(g)} m`).toBe(false);
        const gatePx = labelPixels(GATE_LABEL_SIZE, GATE_LABEL_MIN, g);
        const apart = (screenY(v, GATE_CENTER_Y, g) - screenY(v, y, g - 1)) / pixel;
        expect(apart, `${String(count)} at ${String(g)} m`).toBeGreaterThan(
          0.422 * px + 0.469 * gatePx + 2,
        );
      }
    }
  });

  it('leaves a number alone beside an unnumbered or another lane’s gate', () => {
    const v = view();
    // Past the numbers: the arch is drawn but carries no plaque.
    expect(placeBlockLabel([gate(0, 50)], 0, 55, 0.95, 12, v)).toBe(0.95);
    expect(gateCoversLabel([gate(0, 50)], 0, 55, 0.95, v)).toBe(false);
    // Another lane's plaque is two metres away on screen.
    expect(placeBlockLabel([gate(1, 26)], laneCenter(-1), 31, 0.95, 12, v)).toBe(0.95);
    // A passed row prints nothing.
    const passed = { ...gate(0, 26), passed: true };
    expect(placeBlockLabel([passed], 0, 31, 0.95, 12, v)).toBe(0.95);
  });
});

describe('see-through plaques', () => {
  /**
   * Whether the prize gate of a one-beat road screens a threat once the squad
   * has walked to `gap` metres short of it, where its number is up.
   */
  function prizeScreened(beat: string, tier: number, gap: number): boolean {
    const level = buildBeatLevel(beat, tier, 100, 1);
    const run = new Run(level, balance);
    const mark = level.beats?.[0];
    expect(mark).toBeDefined();
    const row = mark?.z ?? 0;
    while (run.state.status === 'running' && row - run.state.squad.z > gap) run.tick(1 / 60);
    const screens = new GateScreens();
    screens.gather(run.state);
    return screens.covers(laneCenter(mark?.prize ?? 0), mark?.z ?? 0);
  }

  it('turns the panel an ambush stands behind see-through', () => {
    expect(prizeScreened('ambush', 3, 30)).toBe(true);
  });

  it('turns the panel a toll portal pours through see-through', () => {
    expect(prizeScreened('toll', 3, 30)).toBe(true);
  });

  it('leaves a guard’s panel solid: the guard stands in front of it', () => {
    expect(prizeScreened('guard', 2, 30)).toBe(false);
  });
});

describe('a block holding its line', () => {
  it('is held on or in front of its line, woken or not, and otherwise waits or walks', () => {
    expect(stanceOf({ active: false, z: 35, holdZ: 35 })).toBe('held');
    expect(stanceOf({ active: true, z: 35, holdZ: 35 })).toBe('held');
    expect(stanceOf({ active: false, z: 30, holdZ: 35 })).toBe('held');
    expect(stanceOf({ active: false, z: 40, holdZ: 35 })).toBe('waiting');
    expect(stanceOf({ active: true, z: 40, holdZ: 35 })).toBe('walking');
    expect(stanceOf({ active: true, z: 40 })).toBe('walking');
    expect(stanceOf({ active: false, z: 40 })).toBe('waiting');
  });

  /** The stances a beat's one block passes through, in order, until it dies. */
  function stancesOf(beat: string, tier: number): BlockStance[] {
    // A seed whose prize is a side lane: the squad stands in the middle and
    // the block in its lane is not shot down before it reaches its line.
    let seed = 1;
    while (buildBeatLevel(beat, tier, 100, seed).beats?.[0]?.prize === 0) seed++;
    const run = new Run(buildBeatLevel(beat, tier, 100, seed), balance);
    const block = run.state.enemies.find((e) => e.streamId === undefined && e.kind !== 'boss');
    expect(block?.holdZ).toBeDefined();
    const seen: BlockStance[] = [];
    while (run.state.status === 'running' && block?.alive === true) {
      const stance = stanceOf(block);
      if (seen[seen.length - 1] !== stance) seen.push(stance);
      run.tick(1 / 60);
    }
    return seen;
  }

  it('braces a guard from its first frame, and never walks it', () => {
    expect(stancesOf('guard', 2)).toEqual(['held']);
  });

  it('walks an ambush through its panel to its line, and holds it there', () => {
    expect(stancesOf('ambush', 3)).toEqual(['waiting', 'walking', 'held']);
  });
});

describe('the wake cue', () => {
  it('crouches, then rises, then is over', () => {
    expect(wakeSquash(0)).toBe(0);
    expect(wakeSquash(WAKE_SQUASH_SECONDS * 0.15)).toBeGreaterThan(0);
    expect(wakeSquash(WAKE_SQUASH_SECONDS * 0.7)).toBeLessThan(0);
    expect(wakeSquash(WAKE_SQUASH_SECONDS)).toBe(0);
    expect(wakeSquash(-1)).toBe(0);
  });

  it('pops the number and lets it go', () => {
    expect(wakePop(-1)).toBe(1);
    expect(wakePop(0.1)).toBeGreaterThan(1);
    expect(wakePop(5)).toBe(1);
  });
});
