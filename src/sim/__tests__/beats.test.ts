/**
 * Every Phase 1 beat Meadow's scripts use, in its rating band at the squad
 * sizes the scripts put it at, on a hand that bought nothing (document 31,
 * 4.5 and section 5; definition of done 3). The bands, the size rule and why
 * each is held are in `./beatBands.ts`; Frostfell's beats are
 * `./beatsFrost.test.ts`.
 *
 * The scripts are composed as the balance files play them: ordinary levels
 * bare, the milestones (10, 15, 20) on the campaign's kit, which is one
 * campaign simulation.
 *
 * Runtime: about 1,000 short roads and one campaign, a minute and a half on a
 * quiet box.
 *
 * To see the whole table rather than the cells that fail:
 *
 *   BEATLAB=1 npx vitest run src/sim/__tests__/beatLabReadout.test.ts
 */

import { describe } from 'vitest';

import { beatBands } from './beatBands';
import { MEADOW, kitOf, referenceHand } from './balanceRuns';

describe('beat lab: Meadow, bare', () => {
  beatBands(
    {
      biome: 'meadow',
      name: 'Meadow',
      from: MEADOW.from,
      to: MEADOW.to,
      player: () => undefined,
      levelPlayer: (level) => kitOf(referenceHand(level), level),
    },
    600_000,
  );
});
