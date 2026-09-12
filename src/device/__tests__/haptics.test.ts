/**
 * The one thing about the device layer that can be tested off a device: that it
 * does nothing at all in a browser.
 *
 * `src/main.ts` imports `src/device` unconditionally, so every web build — the
 * dev server, `build`, `build:hosted`, `build:artifact` — runs this code. If a
 * native call ever escaped a guard, it would throw inside the frame loop on a
 * machine none of us is holding, which is exactly the kind of bug that reaches
 * the product owner's playtest link instead of us.
 *
 * Vitest runs in Node, where Capacitor reports platform `web`, so these
 * assertions describe a browser as faithfully as they describe a test.
 */

import { describe, expect, it } from 'vitest';

import type { SimEvent } from '@/sim';

import { hapticsActive, hasExternalFeed, onSimEvents } from '../haptics';
import { isIOS, isNative, platformName } from '../platform';

const EVENTS: readonly SimEvent[] = [
  { type: 'bossStomp', x: 0, z: 12 },
  { type: 'bossKilled' },
  { type: 'runEnded', status: 'won', survivors: 40, peakCount: 120 },
];

describe('device layer off a device', () => {
  it('reports the web platform', () => {
    expect(platformName()).toBe('web');
    expect(isNative()).toBe(false);
    expect(isIOS()).toBe(false);
  });

  it('never buzzes', () => {
    expect(hapticsActive()).toBe(false);
  });

  it('takes sim events without touching a plugin', () => {
    expect(hasExternalFeed()).toBe(false);
    expect(() => {
      onSimEvents(EVENTS);
    }).not.toThrow();
    // The flag is what makes `./simTap` stand down once the app feeds us
    // directly, so a double buzz per stomp is impossible whichever lands first.
    expect(hasExternalFeed()).toBe(true);
  });

  it('takes an empty tick', () => {
    expect(() => {
      onSimEvents([]);
    }).not.toThrow();
  });
});
