/**
 * The runs this smoke plays, and what each one is a picture of.
 *
 * Split out of `./smoke.mjs` in Milestone 8 Phase E for the file-size rule
 * (CLAUDE.md), on the seam that file's own header has claimed since Milestone 3:
 * it is the *plan*, and a plan is a list of runs and the reasoning behind each
 * one. What is left there is the driver — build, serve, a browser, the phases
 * and the budget line. Nothing here is executed; it is data with its working
 * shown.
 */

/**
 * `turbo=60` runs the sim sixty times faster than the wall clock — the app's
 * ceiling, and the only reason a scripted run fits in this budget.
 *
 * Milestone 2's scene is expensive under SwiftShader — a level-1 frame measured
 * about 800 ms on this machine and a level-10 crowd is slower still — so the
 * wall clock of a run is frames, not sim seconds: the sim advanced at 0.56x
 * real time at turbo 8 and 1.18x at turbo 20. The whole smoke has a five-minute
 * budget (docs/06-milestone-2-plan.md) and turbo is what buys it. The app's own
 * ceiling is 40.
 */

const TURBO = 60;

/**
 * Yesterday, as the game's own clock writes a day (`src/core/clock.ts`).
 *
 * The streak is a local calendar day and nothing else (D51), so a run
 * photographed with a five-day streak has to name a day the device agrees is
 * yesterday — a fixed string would read as "longer ago" and the plaque would
 * show a streak about to reset.
 */
const YESTERDAY = (() => {
  const day = new Date();
  day.setDate(day.getDate() - 1);
  const pad = (value) => String(value).padStart(2, '0');
  const year = String(day.getFullYear()).padStart(4, '0');
  return `${year}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
})();

/**
 * The runs this smoke drives, in order. The first is the definition-of-done
 * run: a greedy clear of level 1, photographed early, mid and late down the
 * road and then in the boss fight. The others exist to prove a loss screen, the
 * Academy's six rooms and the meta layer on them (D51 to D54), a walk of the
 * endless road across two of its biome boundaries (D52), a Frostfell level with
 * both new kinds and its own boss (D49), and a big level-10 squad all render.
 *
 * A shot is keyed to a point on the road (`z`, in metres) or to a moment in the
 * sim — a gate row, a shield breaking, a body charging, a biome boundary —
 * never to the wall clock. The frame loop is stopped on the first frame that
 * satisfies each step and started again once the picture is taken, so the same
 * frames come out of a fast machine and a slow one — and a turbo frame, which
 * is three seconds of sim, cannot carry the run past the moment being
 * photographed. The `t1/t6/t12` names are historical: they were wall-clock
 * seconds in Milestone 1, and the distances below are where those seconds
 * landed.
 *
 * `screenshot=1` is on every URL here and nowhere else: it is what turns
 * `preserveDrawingBuffer` back on (`src/render/scene.ts`). The flag is off in
 * play because it makes the driver keep a second copy of the back buffer, and
 * without it the canvas the compositor hands Playwright can come back empty.
 */
export const RUNS = [
  {
    label: 'greedy level 1',
    query: `?bot=greedy&level=1&seed=1&turbo=${TURBO}&screenshot=1`,
    titleShot: 'title.png',
    shots: [
      { at: 'z', value: 25, name: 't1.png' },
      { at: 'z', value: 65, name: 't6.png' },
      { at: 'z', value: 110, name: 't12.png' },
      // The fight, with the boss still standing: bar, HP label and stomp ring.
      { at: 'boss', name: 'boss.png' },
    ],
    endShot: 'end.png',
    // The frame the blank-frame check runs on: mid-run, squad and gates on screen.
    assertNotBlank: 't6.png',
  },
  {
    // The loss sheet: a defeat ribbon and, since D46, a purse that still fills
    // — a lost run pays 30 percent of the road it walked, and `src/ui/result.ts`
    // rolls those coins up where it used to skip the roll entirely.
    //
    // Level 4, not the level 3 this run photographed through Milestone 5: the
    // balance retune made levels 1 to 3 generous (D31) and a *random* bot now
    // clears level 3 on this seed, which quietly turned the smoke's loss frame
    // into a second win frame. Level 4 seed 2 is a loss in 53 s of sim.
    label: 'random level 4',
    query: `?bot=random&level=4&seed=2&turbo=${TURBO}&screenshot=1`,
    shots: [],
    endShot: 'end-random.png',
  },
  {
    /**
     * The Academy with something in it (D33), and with the whole Milestone 8
     * meta layer on it (D51 to D54): a save injected through the debug handle
     * before the home is photographed, so the purse, the bought upgrades, the
     * chosen staff, the streak plaque and the missions board are all on screen
     * — and the result sheet at the end is the one with every kind of bonus
     * line on it.
     *
     * One run rather than four: every one of these screens is HTML over a
     * scene that is already drawn, so a room costs a click and a screenshot,
     * and a fifth page booting Babylon costs a minute of this container's wall
     * clock (`scripts/smoke.mjs`, "The budget").
     */
    label: 'academy level 6',
    query: `?bot=greedy&level=6&seed=3&turbo=${TURBO}&screenshot=1`,
    // 6000 rather than Milestone 5's 2400: the economy re-priced the ladder
    // (D46), a Yard rung is `900 * 1.6^level`, and this save's next two rungs
    // cost 3686 and 2304. 2400 bought one row of five and greyed the rest;
    // 6000 buys two, which is what `yard.png` is a picture of.
    save: {
      coins: 6000,
      upgrades: { damage: 3, fireRate: 2, startCount: 0, gateBonus: 0, bossDamage: 0 },
      // Ember at tier 3 and storm at 2, so the Workbench card is photographed
      // *above* tier 1 (D54): the evolved tag, two lit rungs and the next
      // price against the purse.
      staffs: {
        ember: { unlocked: true, tier: 3 },
        storm: { unlocked: true, tier: 2 },
        frost: { unlocked: false, tier: 1 },
      },
      selectedStaff: 'storm',
      familiar: { unlocked: true, tier: 1 },
      unlockedLevel: 7,
      // A streak mid-run and unclaimed today, so the plaque reads "Day 5" with
      // what the next road pays under it rather than "claimed" (D51). Yesterday
      // on the device's own clock, which is the only clock the streak knows.
      streak: { days: 5, lastDay: YESTERDAY },
      // Three cards with progress on them, and one of them a road short of
      // done: clearing level 6 ticks it, which is what puts a mission line on
      // the result sheet (`src/core/missions.ts`).
      missions: {
        active: [
          { id: 'roads3', progress: 2, done: false },
          { id: 'sigils12', progress: 5, done: false },
          { id: 'endless600', progress: 180, done: false },
        ],
        rolled: 3,
      },
      // Enough of each kind to have crossed the first rung or two, so the
      // Bestiary's ladders are photographed mid-climb and the Wardrobe has
      // both owned and locked tints in it (D53).
      kills: { grunt: 16_000, brute: 70, charger: 20, shieldBrute: 12, demon: 9, rime: 2 },
      // The kinds this player has met on a road, which is a different record
      // from how many of them they have killed: without it every card reads
      // "Not yet met" over a four-figure tally (`src/core/session.ts`).
      bestiary: ['grunt', 'brute', 'charger', 'shieldBrute', 'demon'],
      cosmetics: {
        owned: ['hatBone', 'capeBone', 'hatStone', 'hatHound', 'glowBulwark', 'glowEmber'],
        selected: { hat: 'hatStone', cape: 'capeBone', staffGlow: 'glowEmber' },
      },
    },
    titleShot: 'academy.png',
    menuShots: [
      { open: '#academy-yard', name: 'yard.png', back: '#room-back' },
      // Through the handle rather than the card, so a change to the home
      // screen's layout cannot quietly stop photographing a room.
      { room: 'wardrobe', name: 'wardrobe.png' },
      { room: 'workbench', name: 'workbench.png', noScroll: true },
      { room: 'bestiary', name: 'bestiary.png', noScroll: true },
    ],
    shots: [],
    endShot: 'result-coins.png',
    // A campaign win's sheet: the bonus lines the meta layer paid, the level's
    // best walk, and the next thing the Academy sells against the purse — and
    // no metres row, which belongs to the endless road alone.
    sheet: {
      visible: ['#result-bonuses', '#result-best', '#result-next', '#next-button'],
      hidden: ['#result-metres-row'],
    },
  },
  {
    /**
     * Frostfell (D49), and the one run keyed to *moments* rather than to places:
     * a charger running its lane, a shielded brute before and after its shield
     * breaks, and the Rime Fiend's charge. `scripts/smoke-run.mjs` paces the sim
     * down as each comes into reach, because at turbo 60 a frame is three
     * seconds of sim and none of those windows is a second long.
     *
     * Level 23 because it is the first that carries both new kinds — one
     * charger row and one shield row (`src/data/levels.json`) — and seed 1 puts
     * the shielded brute at z 215 and the charger at z 342, so the road offers
     * them in the order the shot list asks for.
     *
     * Armed, because from level 21 the game is balanced for a player who has
     * shopped (Milestone 7 Phase D): the save below is what the campaign says
     * the human is holding when it first reaches level 23, read off
     * `runCampaign` rather than invented. Bare, the greedy bot clears 37 of 100
     * up here and this run would be a coin flip.
     *
     * Scale 1 like every other run: the boss's volley is additive fill, and
     * Phase C measured a fraction of a frame per second at 2x on this
     * rasteriser. The 2x pictures of all of this are the hero set's job.
     */
    label: 'greedy frost level 23',
    query: `?bot=greedy&level=23&seed=1&turbo=${TURBO}&screenshot=1`,
    save: {
      coins: 0,
      upgrades: { damage: 2, fireRate: 2, startCount: 2, gateBonus: 2, bossDamage: 1 },
      staffs: {
        ember: { unlocked: true, tier: 1 },
        storm: { unlocked: true, tier: 1 },
        frost: { unlocked: true, tier: 1 },
      },
      selectedStaff: 'frost',
      familiar: { unlocked: false, tier: 0 },
      unlockedLevel: 23,
    },
    shots: [
      { at: 'shield', name: 'frost-shield.png' },
      { at: 'shieldBroken', name: 'frost-shield-broken.png' },
      { at: 'charge', name: 'frost-charger.png' },
      { at: 'bossCharge', name: 'frost-boss-charge.png' },
    ],
    endShot: 'end-frost.png',
    // The Frostfell road, the crowd and the plaques in one frame: the biome has
    // to be able to fail this check too, not only the meadow.
    assertNotBlank: 'frost-charger.png',
    // A level with a charger row that drew none is a level whose charger frame
    // is a picture of an empty lane; see `smoke-run.mjs`.
    expectChargers: true,
  },
  {
    /**
     * The endless road (D52), from the one entry point that has no picker in
     * front of it: `?endless=1` starts the run itself, as soon as the physics
     * layer has landed (`App.start`).
     *
     * It is here for four things a campaign level cannot show. The road changes
     * biome as it is walked, so the frame is a *crossing* — the span being left
     * underfoot, the one ahead already painted on the far half of the road —
     * and the run asserts it crossed two of them with the draw budget and the
     * shader count unmoved, which is what the second set of ground meshes and
     * materials was measured at in Phase C. The HUD counts metres instead of a
     * level. The sheet reads metres, a new record and no Ascend. And Again on
     * that sheet walks the endless road again rather than whatever level the
     * picker was pointed at.
     *
     * Bare, with no save at all: a greedy walk on nothing bought reaches about
     * 1900 to 2400 m of the 2898 m road (measured on the sim over five seeds),
     * which is nine to eleven spans — so the two crossings this run is stopped
     * after (`endAfter`) are not close to the margin, and the record it sets is
     * the first one.
     */
    label: 'endless greedy',
    query: `?endless=1&bot=greedy&seed=3&turbo=${TURBO}&screenshot=1`,
    autoStart: true,
    endless: true,
    shots: [{ at: 'boundary', value: 1, name: 'endless-boundary.png' }],
    endShot: 'end-endless.png',
    // The crossing is the frame this run exists for, so it is the one the
    // blank-frame check runs on.
    assertNotBlank: 'endless-boundary.png',
    sheet: {
      visible: ['#result-metres-row'],
      hidden: ['#next-button', '#result-best'],
    },
    againStaysEndless: true,
    /**
     * Stopped two spans in, rather than walked to the wipe.
     *
     * The run exists for the crossing, the metres chip and the sheet behind
     * them, and every one of those is true by the second boundary. Left to
     * itself a greedy walk reached 1915 m of the 2898 m road — two thirds of it
     * — and the Milestone 8 review measured that tail at 633 s of this
     * container's wall clock, a third of the whole smoke, for a stretch of road
     * nothing photographs and nothing asserts. So the driver ends the run
     * through the debug handle once the squad is past the second boundary and
     * the renderer has repainted at both (`stopAfterSpans` in
     * `./smoke-run.mjs`).
     *
     * Nothing is weakened: the two crossings are still asserted, the draw-call
     * and shader counts are still measured over everything the run drew, and
     * the sheet still owes the same identity — a stopped run is a lost run, and
     * an endless run is paid by distance whichever way it ended (D52).
     *
     * The margin is forty metres past the line — eight seconds of road — because
     * the camera trails the squad and it is the *camera* crossing that repaints
     * the world. The watcher waits for that repaint as well, so the margin is
     * slack rather than the test.
     */
    endAfter: { spans: 2, margin: 40 },
    // Still generous: what is left is the walk to the second boundary at the
    // pace ladder's own speed, not the whole road.
    endTimeoutMs: 600_000,
  },
  {
    label: 'greedy level 10',
    // Seed 2 is the one whose level 10 puts a staff gate on row 4 of twenty,
    // so the staff shot has something to photograph early in the run.
    query: `?bot=greedy&level=10&seed=2&turbo=${TURBO}&screenshot=1`,
    shots: [
      // A `weapon` gate on screen: the staff prop over the panel and its name
      // on it (plan, definition of done 5).
      { at: 'staff', name: 'staff-l10.png' },
      { at: 'z', value: 120, name: 't12-l10.png' },
    ],
    endShot: 'end-l10.png',
  },
];

