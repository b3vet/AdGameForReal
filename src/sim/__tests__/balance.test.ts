/**
 * The balance contract, re-based on the human-like bot for Milestone 6 (D45).
 *
 * Through Milestone 5 every band here was measured on the greedy bot, which
 * sees the whole board every step and is never on the wrong side of a fence: a
 * campaign tuned against it is tuned against nobody, and that is how the owner
 * came to read levels as too easy while greedy cleared 100 of 100. D45 moves
 * the bands to the human bot — reaction delay, a swipe limit, the right lane
 * about seven times in ten — and leaves greedy as the ceiling it always was.
 *
 * What is asserted here, and why each is where it is:
 *
 *   clears      70 to 80 percent of first attempts on the ordinary levels, over
 *               the campaign rather than level by level: ten seeds resolve a
 *               level's rate to about a tenth, so a per-level band of ten
 *               points would be a band on the noise. Per level there is a floor
 *               instead, which is what catches a level nobody can pass.
 *   survivors   25 to 50 percent of peak over clears, on the same mean, with a
 *               per-level ceiling. See the note on `SURVIVOR_BAND`: this and
 *               the clear band are one dial, and the campaign sits at the top
 *               of this one to sit inside that one.
 *   boss        20 to 30 seconds per level, on the human's clears.
 *   milestones  levels 7, 10, 15, 20 and Frostfell's 25, 30, 35, 40 are the
 *               levels the road does not give up (D45, D48, D49). Bare they are
 *               far under the ordinary band; with the set the campaign says the
 *               player is holding when they first arrive (D46) they open up.
 *               See the note above the milestone tests for how far that
 *               actually goes, which is not as far as D45 asks.
 *   greedy      still 100 of 100 on the ordinary levels, and on the milestone
 *               levels with the set the road paid for.
 *
 * Milestone 7 doubled the campaign (D49), and the twenty levels it added are
 * measured on a *different hand*: the same human bot, carrying the kit the
 * campaign says it is holding when it first walks onto each level (D46). By
 * level 21 the Academy has sold four or five rungs and two staffs, so a bare
 * hand there is not a player anybody will ever be — the wave-one readout put
 * it at 0.36 against 0.74 armed — and a road tuned for the bare one would be
 * tuned for nobody, which is the same mistake D45 corrected for greedy.
 *
 * The same move is what the greedy tests below do with Frostfell: greedy with
 * nothing bought clears 33 of 100 there, because the Rime Fiend's hit points
 * are sized against a squad carrying `bossDamage` and two damage rungs, and
 * greedy's own ceiling is the cap on the crowd. Greedy *armed* is 100 of 100,
 * and that is what the ceiling means from level 21 on.
 *
 * Every number below is deterministic: a failure here is a design change, not
 * a flake.
 */

import { describe, expect, it } from 'vitest';

import { runCampaign } from '../campaign';
import type { BotKind } from '../bots';
import { playerHolding } from './fixtures';
import { playLevel, summarise } from './harness';
import type { PlayResult } from './harness';
import { levelConfig, levelCount } from '@/data';
import type { PlayerState } from '@/data/types';

const SEEDS = [1, 2, 3, 4, 5];

/** Ten seeds where the target is itself "of ten". */
const TEN_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** How far a level's realised peak may drift from the size it was designed for. */
const PEAK_MIN_RATIO = 0.6;
const PEAK_MAX_RATIO = 1.4;

/**
 * A campaign of a hundred-odd bot runs at sixty-odd seconds of road each is
 * minutes of simulated time. Well past vitest's five-second default, and not a
 * hang.
 */
const CAMPAIGN_TIMEOUT_MS = 300_000;

/**
 * The levels the road is not meant to give up without upgrades (D45, D48, D55).
 *
 * Level 5 was the first of them until the Milestone 6 follow-up moved it to 7,
 * and 7 came off the list in Milestone 8 (D55): it never separated armed from
 * bare at any `gateBonus` size, and the Milestone 8 balance pass measured it as
 * an ordinary-hard level that sits inside the ordinary bands — 5 clears in ten,
 * 0.28 of its peak walking away, a 30 second boss — so it is measured as one.
 * The first upgrade gate is level 10.
 */
const MILESTONES: readonly number[] = [10, 15, 20, 25, 30, 35, 40];

const isMilestone = (level: number): boolean => MILESTONES.includes(level);

/**
 * Where biome 1 ends: the last level whose bands are measured on a bare hand.
 *
 * Milestone 6 measured D45's bands over these twenty with nothing bought, and
 * they are still measured that way — the tuning behind them has not moved.
 * From `FROST_FROM` the same bands are measured on the armed hand instead, for
 * the reason in the file note above.
 */
const BANDED = 20;

/** Frostfell's first level (D49). */
const FROST_FROM = BANDED + 1;

/**
 * Ceiling on any one ordinary Frostfell level's armed clear rate.
 *
 * The floor below catches a level nobody can pass; this catches the other
 * failure, which the armed hand makes possible for the first time: a level the
 * kit walks through. It is also the guard the `gateBonus` effect size was
 * picked against — 0.09 opens level 10 and none of the twenty goes over this.
 */
const ARMED_CLEAR_CEILING = 0.85;

/**
 * Where the tier ceilings start: Frostfell, because that is where a level is
 * *tuned* for a hand that has shopped (D49). The campaign first buys an
 * evolution at level 17, but levels 15 to 20 were fitted against a bare hand
 * and an armed one is expected to walk them — measured, the kit alone clears
 * level 17 nine times in ten with or without a tier on it — so a ceiling there
 * would be a band on the Milestone 6 design rather than on anything D54 added.
 */
const TIER_FROM = FROST_FROM;

/** What a milestone may fall to for the hand that also bought tiers (D54). */
const TIER_MILESTONE_CEILING = 0.75;

/** D45's headline: a decent thumb clears an ordinary level most of the time. */
const CLEAR_BAND: readonly [number, number] = [0.7, 0.8];

/** Below this on any one ordinary level and the level is a wall, not a level. */
const CLEAR_FLOOR = 0.35;

/** D31: levels 1 to 3 are generous, and a thumb finishes them. */
const EARLY_CLEAR_FLOOR = 0.9;

/** How often a Frostfell milestone may fall to a hand carrying nothing (D49). */
const FROST_MILESTONE_BARE = 0.45;

/**
 * D45's survivor band.
 *
 * Phase C2 first measured this and the clear band as one dial: with the boss's
 * stomps taking a share of whoever is standing under them, a run is won exactly
 * when the crowd outlasts the fight, so both numbers were `1 - e^{-kT}` for the
 * single decay the fight had, and the campaign could clear 71 percent keeping
 * 50, or keep 37 and clear 58, whatever the boss's hp, bite, enrage or the
 * river's density were set to.
 *
 * The C2 follow-up separated them by making the boss's contact grind real: it
 * walks the squad down at `enemies.boss.speed` 1.75 and is on the crowd 11.9
 * seconds into a 24 second fight, so a fight that runs past its arrival costs
 * the crowd whether or not it is won. At the same 74 percent clear rate the
 * campaign now keeps 0.447 of its peak where before it kept 0.497, and the
 * per-level numbers run 0.35 to 0.58 instead of 0.42 to 0.60.
 */
const SURVIVOR_BAND: readonly [number, number] = [0.25, 0.5];
const SURVIVOR_CEILING = 0.6;

/**
 * Seconds of boss fight the human signs up for (D45's 20 to 30), widened at
 * both ends by the C2 follow-up's third decision: the boss's hp is a *monotone*
 * ladder now, so a player never meets a smaller boss than the one before, and a
 * level whose crowd the human under-delivers on meets a boss it may not shrink.
 * Levels 13 and 19 are where that shows — the human brings 250 and 320 to
 * bosses of 14,600 and 18,500, against level 12's 345 to 14,400 — and their
 * fights run into the thirties. The cost of the ladder, paid knowingly.
 */
const BOSS_MIN_SECONDS = 19;
const BOSS_MAX_SECONDS = 35;

/**
 * Frostfell's boss band (D20's original 20 to 30, held per level).
 *
 * It can be the narrow band where biome 1's could not because the hand it is
 * measured on is the armed one: the kit grows with the level at about the rate
 * the boss ladder does, so what the fight measures at stops drifting with the
 * level index and only the crowd's own spread is left.
 */
const FROST_BOSS_MIN_SECONDS = 20;
/**
 * Widened by two seconds in Milestone 8, for one reason the value model in
 * `../campaignShop.ts` makes unavoidable: ranked by output per coin,
 * `bossDamage` is the worst rung in the Yard — it is worth its effect times the
 * share of the run that is the boss fight, about a quarter — so the shopper
 * buys it last, and the kit the campaign holds at the top of Frostfell carries
 * one fewer rung of it than the lockstep shopper's did. Level 31 measures 30.8
 * seconds; nothing else goes over 30. The alternative was to lower its boss's
 * hit points, which the monotone ladder (levels 30, 31 and 32 all stand 31,100)
 * does not have room for.
 */
const FROST_BOSS_MAX_SECONDS = 32;

/** What the Rime Fiend's lane charge may be worth against its own stomp. */
const CHARGE_SHARE_CEILING = 1 / 3;

/** Greedy's fight against the same boss is shorter, because greedy is bigger. */
const GREEDY_BOSS_MIN_SECONDS = 12;
const GREEDY_BOSS_MAX_SECONDS = 36;

interface Band {
  from: number;
  to: number;
  /** Ceiling on the share of one stream that reaches the greedy squad. */
  leak: number;
  /** True where a stream that never leaks would mean the level is too soft. */
  mustLeak: boolean;
}

/** docs/09-milestone-3-plan.md, "Stream pressure". */
const LATE: Band = { from: 6, to: 20, leak: 0.1, mustLeak: true };
const BANDS: readonly Band[] = [
  { from: 1, to: 3, leak: 0.035, mustLeak: false },
  { from: 4, to: 5, leak: 0.06, mustLeak: false },
  LATE,
];

function bandOf(level: number): Band {
  return BANDS.find((band) => level >= band.from && level <= band.to) ?? LATE;
}

/** Runs are expensive; every test in this file reads the same ones. */
const played = new Map<string, PlayResult>();

function run(level: number, seed: number, kind: BotKind, player?: PlayerState, tag = ''): PlayResult {
  const key = `${kind}:${tag}:${String(level)}:${String(seed)}`;
  const cached = played.get(key);
  if (cached !== undefined) return cached;
  const result = playLevel(level, seed, kind, player);
  played.set(key, result);
  return result;
}

/** `expect` on a labelled string, so a failure names the level that broke. */
function expectTrue(where: string, value: boolean): void {
  expect(`${where}: ${String(value)}`).toBe(`${where}: true`);
}

/** Share of `TEN_SEEDS` the human clears at the first attempt. */
function humanClearRate(level: number, player?: PlayerState, tag = ''): number {
  let wins = 0;
  for (const seed of TEN_SEEDS) {
    if (run(level, seed, 'human', player, tag).status === 'won') wins++;
  }
  return wins / TEN_SEEDS.length;
}

/**
 * What the campaign says the human is carrying the first time it reaches each
 * level (D46). Read off the real campaign rather than written down here,
 * because the set moves whenever the difficulty does — which is the whole
 * coupling D45 asks the milestone levels to be tuned against, and from D49 the
 * coupling the whole of Frostfell is tuned against.
 */
function kitsOf(evolutions: boolean): Map<number, PlayerState> {
  const campaign = runCampaign({ bot: 'human', seed: 1, evolutions });
  const kit = new Map<number, PlayerState>();
  for (const entry of campaign.levels) {
    kit.set(
      entry.level,
      playerHolding({
        upgrades: entry.held.upgrades,
        staffs: entry.held.staffs,
        evolved: entry.held.evolved,
        tiers: entry.held.tiers,
        wispTier: entry.held.wispTier,
        unlockedLevel: entry.level,
      }),
    );
  }
  return kit;
}

const campaignKit = kitsOf(false);

/**
 * The same, for the player who *does* climb the Workbench's ladders (D54).
 *
 * Two campaigns rather than one because "never mandatory below level 40" is a
 * promise about two different hands, and both have to hold. The kit above buys
 * only the Yard, the staffs and the wisp, and the Milestone 6 and 7 bands are
 * measured on it; this one spends a share of the same purse on evolutions
 * instead, and what has to be true of it is the opposite — that no level it
 * walks onto becomes a formality (`TIER_CLEAR_CEILING` below).
 */
const tierKit = kitsOf(true);

/**
 * The hand a level is measured on: nothing through biome 1 (D35, D45), the kit
 * the Academy has sold by then from Frostfell on (D49).
 */
function kitFor(level: number): PlayerState | undefined {
  return level >= FROST_FROM ? campaignKit.get(level) : undefined;
}

/** The cache tag that goes with `kitFor`, so an armed run is not read as bare. */
function tagFor(level: number): string {
  return level >= FROST_FROM ? 'kit' : '';
}

describe('balance', () => {
  it('lets the greedy bot clear every ordinary level on every seed', () => {
    // Bare through biome 1 and armed on Frostfell, for the reason in the file
    // note: from level 21 the boss is sized against a squad that bought things.
    for (let level = 1; level <= levelCount; level++) {
      if (isMilestone(level)) continue;
      let wins = 0;
      for (const seed of SEEDS) {
        if (run(level, seed, 'greedy', kitFor(level), tagFor(level)).status === 'won') wins++;
      }
      expectTrue(
        `L${String(level)} greedy ${String(wins)}/${String(SEEDS.length)}`,
        wins === SEEDS.length,
      );
    }
  }, CAMPAIGN_TIMEOUT_MS);

  it('lets the greedy bot clear the milestone levels with the set the road paid for', () => {
    // The milestone levels are the ones a *player* cannot walk into cold. The
    // reference ceiling still gets through them once it is carrying what the
    // Academy has sold by then (D45).
    for (const level of MILESTONES) {
      const player = campaignKit.get(level);
      for (const seed of SEEDS) {
        expectTrue(
          `L${String(level)} s${String(seed)} greedy armed`,
          run(level, seed, 'greedy', player, 'kit').status === 'won',
        );
      }
    }
  }, CAMPAIGN_TIMEOUT_MS);

  it('clears seven or eight ordinary levels in ten for a decent thumb', () => {
    let total = 0;
    let levels = 0;
    for (let level = 1; level <= BANDED; level++) {
      if (isMilestone(level)) continue;
      const rate = humanClearRate(level);
      total += rate;
      levels++;
      expectTrue(`L${String(level)} human ${rate.toFixed(2)}`, rate >= CLEAR_FLOOR);
      // D31: the opening is generous, and a thumb finishes it every time.
      if (level <= 3) {
        expectTrue(`L${String(level)} human ${rate.toFixed(2)} early`, rate >= EARLY_CLEAR_FLOOR);
      }
    }
    const mean = total / levels;
    expectTrue(
      `campaign clear ${mean.toFixed(3)} in [${String(CLEAR_BAND[0])}, ${String(CLEAR_BAND[1])}]`,
      mean >= CLEAR_BAND[0] && mean <= CLEAR_BAND[1],
    );
  }, CAMPAIGN_TIMEOUT_MS);

  it('leaves a clear with a quarter to a half of the crowd that walked the road', () => {
    let total = 0;
    let levels = 0;
    for (let level = 4; level <= BANDED; level++) {
      if (isMilestone(level)) continue;
      let share = 0;
      let wins = 0;
      for (const seed of TEN_SEEDS) {
        const result = run(level, seed, 'human');
        if (result.status !== 'won') continue;
        wins++;
        share += result.survivors / Math.max(1, result.peakCount);
      }
      const mean = share / Math.max(1, wins);
      expectTrue(`L${String(level)} survivors ${mean.toFixed(2)}`, mean <= SURVIVOR_CEILING);
      total += mean;
      levels++;
    }
    const mean = total / levels;
    expectTrue(
      `campaign survivors ${mean.toFixed(3)} in [${String(SURVIVOR_BAND[0])}, ${String(SURVIVOR_BAND[1])}]`,
      mean >= SURVIVOR_BAND[0] && mean <= SURVIVOR_BAND[1],
    );
  }, CAMPAIGN_TIMEOUT_MS);

  it('makes every boss a fight of twenty-odd seconds for the player it is sized for', () => {
    for (let level = 1; level <= BANDED; level++) {
      if (isMilestone(level)) continue;
      let seconds = 0;
      let wins = 0;
      for (const seed of TEN_SEEDS) {
        const result = run(level, seed, 'human');
        if (result.status !== 'won') continue;
        wins++;
        seconds += result.bossSeconds;
      }
      const mean = seconds / Math.max(1, wins);
      const where = `L${String(level)} boss ${mean.toFixed(1)}s`;
      expectTrue(where, mean >= BOSS_MIN_SECONDS && mean <= BOSS_MAX_SECONDS);
    }
  }, CAMPAIGN_TIMEOUT_MS);

  /**
   * Frostfell's three bands (D49), the same three as above on the armed hand.
   *
   * They are separate tests rather than a wider loop because they are measured
   * against a different player and read against a different ceiling: an armed
   * level that clears nine times in ten is a level the kit walks through, and
   * biome 1 has no such failure mode because nothing is bought there.
   */
  it('clears seven or eight ordinary Frostfell levels in ten for the hand it armed', () => {
    let total = 0;
    let levels = 0;
    for (let level = FROST_FROM; level <= levelCount; level++) {
      if (isMilestone(level)) continue;
      const rate = humanClearRate(level, campaignKit.get(level), 'kit');
      total += rate;
      levels++;
      const where = `L${String(level)} human armed ${rate.toFixed(2)}`;
      expectTrue(where, rate >= CLEAR_FLOOR);
      expectTrue(`${where} ceiling`, rate <= ARMED_CLEAR_CEILING);
    }
    const mean = total / levels;
    expectTrue(
      `Frostfell clear ${mean.toFixed(3)} in [${String(CLEAR_BAND[0])}, ${String(CLEAR_BAND[1])}]`,
      mean >= CLEAR_BAND[0] && mean <= CLEAR_BAND[1],
    );
  }, CAMPAIGN_TIMEOUT_MS);

  it('leaves a Frostfell clear with a quarter to a half of the crowd', () => {
    let total = 0;
    let levels = 0;
    for (let level = FROST_FROM; level <= levelCount; level++) {
      if (isMilestone(level)) continue;
      const player = campaignKit.get(level);
      let share = 0;
      let wins = 0;
      for (const seed of TEN_SEEDS) {
        const result = run(level, seed, 'human', player, 'kit');
        if (result.status !== 'won') continue;
        wins++;
        share += result.survivors / Math.max(1, result.peakCount);
      }
      const mean = share / Math.max(1, wins);
      expectTrue(`L${String(level)} survivors ${mean.toFixed(2)}`, mean <= SURVIVOR_CEILING);
      total += mean;
      levels++;
    }
    const mean = total / levels;
    expectTrue(
      `Frostfell survivors ${mean.toFixed(3)} in [${String(SURVIVOR_BAND[0])}, ${String(SURVIVOR_BAND[1])}]`,
      mean >= SURVIVOR_BAND[0] && mean <= SURVIVOR_BAND[1],
    );
  }, CAMPAIGN_TIMEOUT_MS);

  it('makes every Rime Fiend a fight of twenty to thirty seconds', () => {
    // The band D20 asks for, held per level rather than on the mean. It costs
    // the boss ladder its smoothness — `bite` carries most of it, because what
    // a fight *measures* at is the fights that were won, and a heavier bite
    // wins only the quick ones — but the ladder itself is still monotone.
    for (let level = FROST_FROM; level <= levelCount; level++) {
      if (isMilestone(level)) continue;
      const player = campaignKit.get(level);
      let seconds = 0;
      let wins = 0;
      for (const seed of TEN_SEEDS) {
        const result = run(level, seed, 'human', player, 'kit');
        if (result.status !== 'won') continue;
        wins++;
        seconds += result.bossSeconds;
      }
      const mean = seconds / Math.max(1, wins);
      const where = `L${String(level)} rime boss ${mean.toFixed(1)}s`;
      expectTrue(where, mean >= FROST_BOSS_MIN_SECONDS && mean <= FROST_BOSS_MAX_SECONDS);
    }
  }, CAMPAIGN_TIMEOUT_MS);

  it('never lets the Rime Fiend decide a frost level with its charge alone', () => {
    // D49 asks for a charge that visibly costs units on every frost level and
    // does not carry the fight by itself. Both halves are asserted: the lane
    // charge takes somebody on every one of the twenty, and never more than a
    // third of what the stomp does.
    for (let level = FROST_FROM; level <= levelCount; level++) {
      const player = campaignKit.get(level);
      let charge = 0;
      let stomp = 0;
      for (const seed of TEN_SEEDS) {
        const result = run(level, seed, 'human', player, 'kit');
        charge += result.chargeKills;
        stomp += result.stompKills;
      }
      const where = `L${String(level)} charge ${(charge / TEN_SEEDS.length).toFixed(1)} of stomp ${(stomp / TEN_SEEDS.length).toFixed(1)}`;
      expectTrue(where, charge > 0);
      expectTrue(`${where} share`, charge <= stomp * CHARGE_SHARE_CEILING);
    }
  }, CAMPAIGN_TIMEOUT_MS);

  it('keeps the same fight worth fighting for the reference ceiling too', () => {
    // Greedy brings a bigger crowd to a boss sized for the human's, so the same
    // fight is shorter: the floor here is what stops it being a formality.
    for (let level = 1; level <= levelCount; level++) {
      if (isMilestone(level)) continue;
      let seconds = 0;
      for (const seed of SEEDS) {
        seconds += run(level, seed, 'greedy', kitFor(level), tagFor(level)).bossSeconds;
      }
      const mean = seconds / SEEDS.length;
      const where = `L${String(level)} greedy boss ${mean.toFixed(1)}s`;
      expectTrue(where, mean >= GREEDY_BOSS_MIN_SECONDS && mean <= GREEDY_BOSS_MAX_SECONDS);
    }
  }, CAMPAIGN_TIMEOUT_MS);

  /**
   * D45 asks for under 15 percent bare and about 60 percent armed. What the
   * campaign does, over ten seeds, with D50's cheap first `gateBonus` rung and
   * the effect size Milestone 7 picked for it (0.09):
   *
   *     L10  bare 2/10  armed 3/10   (held: damage1 startCount1 gateBonus1, ...)
   *     L15  bare 3/10  armed 5/10
   *     L20  bare 3/10  armed 5/10
   *     L25  bare 0/10  armed 5/10
   *     L30  bare 0/10  armed 4/10
   *     L35  bare 1/10  armed 3/10
   *     L40  bare 0/10  armed 6/10
   *
   * Six of the eight separate by the fifteen points D49 asks for. The `gateBonus`
   * effect was measured at 0.05, 0.07 and 0.09 across all eight with the sets
   * the campaign holds at each: 0.05 and 0.07 separate five, 0.09 separates six
   * — it is what opens level 10 from a dead heat to ten points — and no ordinary
   * Frostfell level goes over `ARMED_CLEAR_CEILING` at it. So 0.09 is the
   * shipped size, and the Yard's rungs are dearer to pay for it (D46's cadence
   * is measured in `./economy.test.ts`, not here).
   *
   * Level 7 was the one that did not separate at any of the three, at 5 of 10
   * either way. It is off the list in Milestone 8 (D55) and measured with the
   * ordinary levels above; 10 is asserted no more strictly than it was.
   */
  it('keeps the milestone levels well under the ordinary band without upgrades', () => {
    for (const level of MILESTONES) {
      const bare = humanClearRate(level);
      // Frostfell's four are held tighter than biome 1's: by level 25 the kit
      // is four rungs and two staffs, so "bare" there is a hypothetical player
      // and the level is free to shut them out.
      const ceiling = level >= FROST_FROM ? FROST_MILESTONE_BARE : 0.55;
      expectTrue(`L${String(level)} milestone bare ${bare.toFixed(2)}`, bare <= ceiling);
      expectTrue(
        `L${String(level)} milestone bare ${bare.toFixed(2)} under the band`,
        bare <= CLEAR_BAND[0] - 0.15,
      );
    }
  }, CAMPAIGN_TIMEOUT_MS);

  it('opens the milestone levels up with the set the road has paid for', () => {
    for (const level of MILESTONES) {
      const player = campaignKit.get(level);
      expectTrue(`L${String(level)} kit`, player !== undefined);
      const bare = humanClearRate(level);
      const armed = humanClearRate(level, player, 'kit');
      // 10 is recorded rather than asserted, for the reason above.
      if (level >= 15) {
        expectTrue(
          `L${String(level)} armed ${armed.toFixed(2)} vs bare ${bare.toFixed(2)}`,
          armed >= bare + 0.15,
        );
      }
    }
  }, CAMPAIGN_TIMEOUT_MS);

  /**
   * The other half of "never mandatory below level 40" (D54).
   *
   * The tests above are the promise to a player who never buys an evolution:
   * the Yard alone still clears seven or eight ordinary levels in ten. This is
   * the promise to the player who does buy them — that the coins they spent on
   * a ladder instead of a rung did not turn the road into a formality. The two
   * hands cost the same purse, so what has to be true is a *ceiling*, and it is
   * measured from the level the campaign first reaches a tier (17 on seed 1).
   *
   * Measured with the tier kit, Milestone 8: no ordinary level of the sixteen
   * goes over 0.85 and no milestone over 0.75.
   */
  it('never lets the evolution tiers the campaign buys walk a level', () => {
    for (let level = TIER_FROM; level <= levelCount; level++) {
      const player = tierKit.get(level);
      expectTrue(`L${String(level)} tier kit`, player !== undefined);
      const rate = humanClearRate(level, player, 'tiers');
      const where = `L${String(level)} tiers ${rate.toFixed(2)}`;
      const ceiling = isMilestone(level) ? TIER_MILESTONE_CEILING : ARMED_CLEAR_CEILING;
      expectTrue(`${where} ceiling ${String(ceiling)}`, rate <= ceiling);
    }
  }, CAMPAIGN_TIMEOUT_MS);

  it("grows the greedy bot to about each level's peak target, not to the cap", () => {
    // The point of `peakTarget`: level 1 is a squad of a hundred and level 20 a
    // squad of hundreds. If every level saturated at `maxCount` instead, growth
    // across the campaign would read as one flat wall of units.
    for (let level = 1; level <= levelCount; level++) {
      const target = levelConfig(level).peakTarget;
      let total = 0;
      for (const seed of SEEDS) total += run(level, seed, 'greedy').peakCount;
      const average = total / SEEDS.length;

      expect(average).toBeGreaterThanOrEqual(target * PEAK_MIN_RATIO);
      expect(average).toBeLessThanOrEqual(target * PEAK_MAX_RATIO);
    }
  }, CAMPAIGN_TIMEOUT_MS);

  it('lets a stream through the greedy bot only as much as its band allows', () => {
    // The "barely clear" rule (D29). A leak is one soldier, so the share of a
    // stream that reaches the squad is the whole difficulty dial on the road.
    for (let level = 1; level <= levelCount; level++) {
      const band = bandOf(level);
      let share = 0;
      let streams = 0;
      for (const seed of SEEDS) {
        const result = run(level, seed, 'greedy');
        share += result.leakShare * result.streamsSeen;
        streams += result.streamsSeen;
      }
      expect(streams).toBeGreaterThan(0);
      const average = share / streams;
      const where = `L${String(level)} leak ${(average * 100).toFixed(1)}%`;
      expectTrue(where, average <= band.leak);
      // From level 6 a stream the squad never leaks at all is not "barely".
      if (band.mustLeak) expectTrue(`${where} nonzero`, average > 0);
    }
  }, CAMPAIGN_TIMEOUT_MS);

  it('lets even a random player clear level 1 eight times in ten', () => {
    // D31: the first levels are generous. Collecting soldiers should be enough
    // on level 1 — no curses, every gate row full, a boss that bites softly.
    let losses = 0;
    for (const seed of TEN_SEEDS) {
      if (run(1, seed, 'random').status !== 'won') losses++;
    }
    expectTrue(`L1 random losses ${String(losses)}`, losses <= 2);
  }, CAMPAIGN_TIMEOUT_MS);

  it('still makes the random bot lose most of the campaign', () => {
    const random = summarise('random', SEEDS);
    expect(random.meanLosses).toBeGreaterThanOrEqual(6);
  }, CAMPAIGN_TIMEOUT_MS);

  it('makes the worst-gate bot lose every level that has a curse on it', () => {
    // Level 1 has no penalties at all, so "the worst gate" there is still a
    // gate that hands over units and the bot can scrape a win. Every level from
    // 2 on it loses, which is the Milestone 2 target where the curses live.
    for (let level = 2; level <= levelCount; level++) {
      for (const seed of SEEDS) {
        expectTrue(
          `L${String(level)} s${String(seed)} worst lost`,
          run(level, seed, 'worst').status === 'lost',
        );
      }
    }
  }, CAMPAIGN_TIMEOUT_MS);
});
