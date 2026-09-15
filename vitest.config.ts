import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * How long a test may run before Vitest calls it hung.
 *
 * Vitest's default is five seconds, and that is the wrong shape for this suite.
 * `src/sim` is checked by *sweeps* — the whole campaign walked level by level,
 * every staff against every band, a thousand seeded runs compared — and the
 * heavy ones already carry a budget of their own written beside them — a
 * literal, or a named constant like `CAMPAIGN_TIMEOUT_MS`, from 60 s to an hour
 * (`worth.test.ts` and `tune.test.ts` are the extremes). Those are untouched:
 * an explicit argument to `it` always wins over this, and each of them says in
 * its own file why it is the size it is.
 *
 * What this number is for is every *unsized* test around them. Measured over a
 * whole run on a quiet box: every test in the suite that takes more than about
 * four seconds already carries a budget, so the slowest unsized one is under
 * four seconds — and the sweeps beside it hold all four cores while it runs.
 * That is the shape that broke: under the four concurrent suites of this
 * milestone's wave one, nine files timed out on tests that were never anywhere
 * near five seconds of work (`docs/26-milestone-9-log.md`).
 *
 * Two minutes, which is thirty times the slowest unsized test. Sanity check
 * against the heaviest file, `src/sim/__tests__/weapons.test.ts`: 139 s alone on
 * a quiet box and about 270 s under load, of which 139 s is one test that
 * carries its own 300 s budget and the other seventeen are 130 ms between them.
 * Two minutes leaves all of that room and is still small enough that a genuine
 * hang — an accumulator that never drains, a `while` that never ends — fails the
 * run in minutes instead of holding it for an hour.
 */
const TEST_TIMEOUT_MS = 120_000;

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    testTimeout: TEST_TIMEOUT_MS,
    // The same reasoning, for the setup a file does once. No hook in the suite
    // is slow today; this is here so that adding one — a level table built
    // ahead of a sweep — does not fail at Vitest's ten-second default while the
    // test it feeds has two minutes.
    hookTimeout: TEST_TIMEOUT_MS,
  },
});
