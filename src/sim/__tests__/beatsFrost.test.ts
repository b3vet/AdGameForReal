/**
 * Every Phase 1 beat Frostfell's scripts use, in its rating band at the squad
 * sizes the scripts put it at (document 31, 4.5 and section 5), on the kit the
 * human campaign holds at level 30. Frostfell's beats are sized with the armed
 * hand's measured fire (`beats.dps.*.frost`, 3.4), so a bare hand would read
 * every beat a tier too hard. Level 30 is the biome's middle: the kit grows
 * across the twenty levels and `beats.dps` is one number for all of them, so
 * the lab reads it where the biome is on average. The scripts are composed on
 * each level's own kit, as the balance files play them. The bands and the
 * size rule are in `./beatBands.ts`.
 *
 * Runtime: about 1,300 short roads and one campaign, about two minutes on a
 * quiet box.
 *
 *   BEATLAB=1 BEATLAB_BIOME=frost npx vitest run src/sim/__tests__/beatLabReadout.test.ts
 *
 * prints the table (on a bare hand, as that readout plays).
 */

import { describe } from 'vitest';

import { beatBands } from './beatBands';
import { FROST, kitOf } from './balanceRuns';

/** The level whose campaign kit the Frostfell lab is played with. */
const LAB_KIT_LEVEL = 30;

describe('beat lab: Frostfell, armed', () => {
  beatBands(
    {
      biome: 'frost',
      name: 'Frostfell',
      from: FROST.from,
      to: FROST.to,
      player: () => kitOf('kit', LAB_KIT_LEVEL),
      levelPlayer: (level) => kitOf('kit', level),
    },
    900_000,
  );
});
