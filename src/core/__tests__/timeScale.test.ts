import { describe, expect, it } from 'vitest';

import {
  BOSS_KILL_SCALE,
  BOSS_KILL_SECONDS,
  DEFEAT_SCALE,
  HIT_STOP_COOLDOWN,
  HIT_STOP_SECONDS,
  TimeScale,
} from '../timeScale';

/** Advances by `seconds` in 60 fps steps, the way the frame loop would. */
function run(scale: TimeScale, seconds: number): void {
  const step = 1 / 60;
  for (let elapsed = 0; elapsed < seconds; elapsed += step) scale.advance(step);
}

describe('TimeScale', () => {
  it('runs at normal speed by default', () => {
    const scale = new TimeScale();
    expect(scale.value).toBe(1);
    expect(scale.active).toBe(false);
  });

  it('freezes for the hit-stop duration and then recovers', () => {
    const scale = new TimeScale();
    expect(scale.hitStop()).toBe(true);
    expect(scale.value).toBe(0);

    // Half of it: still frozen.
    run(scale, HIT_STOP_SECONDS / 2);
    expect(scale.value).toBe(0);

    run(scale, HIT_STOP_SECONDS);
    expect(scale.value).toBe(1);
  });

  it('throttles hit-stops so a wiped row is one hitch', () => {
    const scale = new TimeScale();
    expect(scale.hitStop()).toBe(true);
    expect(scale.hitStop()).toBe(false);

    run(scale, HIT_STOP_COOLDOWN + 0.02);
    expect(scale.hitStop()).toBe(true);
  });

  it('slows to the boss-kill scale for its span', () => {
    const scale = new TimeScale();
    scale.slowMo(BOSS_KILL_SCALE, BOSS_KILL_SECONDS);
    expect(scale.value).toBeCloseTo(BOSS_KILL_SCALE);

    run(scale, BOSS_KILL_SECONDS / 2);
    expect(scale.value).toBeCloseTo(BOSS_KILL_SCALE);

    run(scale, BOSS_KILL_SECONDS);
    expect(scale.value).toBe(1);
  });

  it('keeps the slower of two overlapping slow-mos', () => {
    const scale = new TimeScale();
    scale.slowMo(0.5, 0.2);
    scale.slowMo(0.25, 0.6);
    expect(scale.value).toBeCloseTo(0.25);
  });

  it('holds the defeat crawl until it is cleared', () => {
    const scale = new TimeScale();
    scale.setHold(DEFEAT_SCALE);
    run(scale, 5);
    expect(scale.value).toBeCloseTo(DEFEAT_SCALE);

    scale.setHold(1);
    expect(scale.value).toBe(1);
  });

  it('lets a hit-stop win over the defeat crawl', () => {
    const scale = new TimeScale();
    scale.setHold(DEFEAT_SCALE);
    scale.hitStop();
    expect(scale.value).toBe(0);
  });

  it('reset clears every timer, including the throttle', () => {
    const scale = new TimeScale();
    scale.setHold(DEFEAT_SCALE);
    scale.slowMo(0.2, 4);
    scale.hitStop();

    scale.reset();
    expect(scale.value).toBe(1);
    // The cooldown is cleared too, so the next run's first kill still hitches.
    expect(scale.hitStop()).toBe(true);
  });
});
