/**
 * The picker's Endless card is shut until the level `academy.json` names
 * (docs/28): a first-time player walked into Endless before the campaign.
 *
 * Only the card and its tap are gated. A save already past the level is open
 * from its first paint, and the debug handle and `?endless=1` call the app
 * directly, which is how the smoke walks the road on a fresh save.
 */

import { describe, expect, it } from 'vitest';

import { academy } from '@/data/academy-types';

import { overlayCallbacks } from '../controls';
import type { AppCommands } from '../controls';
import { defaultPlayer, endlessOpen, endlessUnlockLevel } from '../player';
import type { PlayerState } from '../player';

function playerAt(level: number): PlayerState {
  const player = defaultPlayer();
  player.unlockedLevel = level;
  return player;
}

/** Just enough of the app for the Endless tap: the player, and a counter. */
function appWith(player: PlayerState): { app: AppCommands; started: () => number } {
  let started = 0;
  const app = {
    audio: { unlock: () => undefined, playTap: () => undefined },
    academy: { player },
    startEndless: () => {
      started += 1;
    },
  } as unknown as AppCommands;
  return { app, started: () => started };
}

describe('the Endless lock', () => {
  it('opens at the level the data names, which is past the first', () => {
    expect(endlessUnlockLevel()).toBe(academy.meta.endless.unlockLevel);
    expect(endlessUnlockLevel()).toBeGreaterThan(1);
  });

  it('is shut below that level and open from it on, a veteran included', () => {
    const unlock = endlessUnlockLevel();
    expect(endlessOpen(playerAt(1))).toBe(false);
    expect(endlessOpen(playerAt(unlock - 1))).toBe(false);
    expect(endlessOpen(playerAt(unlock))).toBe(true);
    expect(endlessOpen(playerAt(40))).toBe(true);
  });

  it('drops a tap on a shut card and passes one on an open card', () => {
    const fresh = appWith(playerAt(1));
    overlayCallbacks(fresh.app).onEndless();
    expect(fresh.started()).toBe(0);

    const veteran = appWith(playerAt(endlessUnlockLevel()));
    overlayCallbacks(veteran.app).onEndless();
    expect(veteran.started()).toBe(1);
  });
});
