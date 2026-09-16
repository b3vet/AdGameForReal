/**
 * Schema for the `bots` block of `balance.json`: the scripted players the
 * difficulty bands are measured on (D45, amended by document 31, 4.4).
 *
 * Split out of `./types.ts` when the priced lane read arrived, because that
 * file is well past the size rule and this block is owned by the bot track.
 * Re-exported from `./types.ts`, so `Balance['bots']` reads as it always did.
 */

/**
 * How a bot prices the road between here and a gate row (document 31, 4.4):
 * what a threat standing in a lane will take from a column that stands there
 * and shoots it. The aim shares are measured, not assumed — a probe of a
 * column standing in a lane against a block and against a river, on the
 * starting staff — so the bot's arithmetic and the sim agree about what a lane
 * costs.
 */
export interface BotPriceBalance {
  /**
   * Share of the column's raw output that lands on a block, counted from the
   * moment it enters projectile range: the shots still in flight and the ones
   * that pass beside a block are the rest. Measured 0.85 to 0.98 across squads
   * of ten to four hundred.
   */
  blockAim: number;
  /**
   * A river is priced by the pressure — hit points over the column's raw
   * output times the fire window — it clears without a leak:
   * `max(riverFloor, riverBase * gain)`, where `gain` is what the staff makes
   * of a river's density. For a splash staff `gain` is
   * `1 + splashGain * perMetre ^ splashPower`: a blast takes every body within
   * its radius, so a portal's river, released at one place and walking away
   * from it, is several times easier per hit point than one that keeps pace
   * with the squad. Fitted to a column holding a lane on the starting staff,
   * 30 to 450 units, against both kinds of river: clean at 0.85 to 0.95 for
   * the spawner's, 1.1 at thirty units to 4.9 at three hundred for a portal's.
   */
  riverBase: number;
  riverFloor: number;
  splashGain: number;
  splashPower: number;
  /**
   * How fast a river overwhelms a column past its clean pressure: the share
   * that walks through is `1 - (clean / pressure) ^ steepness`. A plain
   * `1 - 1 / pressure` under-reads the leak, because a backlog makes the fire
   * in flight overkill the bodies in front; the probes put the exponent at 1.3
   * for portals and 1.9 for the spawner, and one number between them serves.
   */
  riverSteepness: number;
  /** Pieces the unpoured rest of a river is priced in, so a late tail can cost more than its head. */
  riverChunks: number;
  /** Seconds of road a price looks ahead; anything later belongs to a later row. */
  horizon: number;
  /**
   * Metres past the row a threat still belongs to the lane chosen for it: a
   * toll poured from behind the panels, an ambush that walked through them
   * late. The column is still standing in that lane when they arrive.
   */
  afterRow: number;
  /**
   * Metres behind the column's head a threat that has walked past still
   * counts, beyond the contact distance. Contact is measured from the head
   * both ways (`contact.ts`), so a block level with the head is still a block
   * for the step or two a head swinging back into its lane takes: without this
   * a bot saw the lane go free the instant the block drew level, steered
   * straight in, and paid the graze.
   */
  trailing: number;
  /**
   * How fast a column is assumed to change lanes, in metres per second, when a
   * lane is priced from where the squad stands: fire in a lane starts once the
   * column is in it, so a far lane is dearer than the one underfoot.
   */
  shiftSpeed: number;
}

/** The human-like bot the difficulty bands are measured on (D45). */
export interface HumanBotBalance {
  /**
   * Steps the bot's hand is behind the board. Fifteen at the sim's fixed
   * 1/60 s step is the 250 ms of the plan: long enough that a gate value
   * seen at the last moment is acted on after it, short enough that the
   * player is clearly playing rather than watching.
   */
  reactionSteps: number;
  /**
   * How fast its finger crosses the road, in metres per second. Below the
   * speed the head itself can move, so the limit is the thumb rather than
   * the crowd: a full lane takes about a third of a second to ask for and
   * a little longer than that to arrive.
   */
  swipeSpeed: number;
  /**
   * How far ahead of a wall's approach zone it notices the fence, in metres
   * of road. Well inside greedy's `wallCommitDistance`: a player watching
   * their own crowd starts the crossing late, and the units still outside
   * the line when the stretch begins to hold are cut off (D44).
   */
  wallReach: number;
  /**
   * The noisy read that replaced the flat seven-in-ten lane accuracy
   * (document 31, 4.4). What a lane's panel gives and what its road takes are
   * each seen through a log-normal factor of this spread, drawn once per row
   * per lane: two gates a few units apart are misread about three times in
   * ten, a x2 beside a +50 on a squad of a hundred about once in forty, and a
   * curse is never mistaken for a plus.
   */
  readNoise: number;
  /**
   * How far past a panel that stops shots it sees what is standing behind it,
   * in metres from the squad. An ambush further back than this is not on its
   * screen yet; the price appears when the block does, and the hand is still
   * `reactionSteps` late on it.
   */
  behindReach: number;
  /**
   * The nearest and furthest a row is read from, in metres: each row's read
   * distance is drawn between them. Later than greedy's `readDistance` on
   * average — the plan's reference player commits about 25 m short of a
   * guard standing 8 m in front of its panels — and sometimes after a fence's
   * approach zone, which is where D44's stragglers come from now that the
   * lane plan settles the side long before the fence.
   */
  readLate: number;
  readDistance: number;
}

export interface BotBalance {
  /** How far ahead a scripted player looks for a block about to reach it. */
  threatLookahead: number;
  /** Inside this distance to the next gate row, a bot commits to its lane. */
  gateCommitDistance: number;
  /** Rows of enemy layout a bot reads when valuing a staff gate. */
  weaponLookaheadRows: number;
  /** How much of the squad a doubling of expected DPS is worth to a bot. */
  weaponWorth: number;
  /** What a slow is worth as a share of DPS, since it buys time not damage. */
  weaponSlowWorth: number;
  /** How far ahead greedy looks for the stream lane it should stand in. */
  streamLookahead: number;
  /** Most bodies a staff valuation reads, so a stream cannot swamp it. */
  weaponLayoutMax: number;
  /**
   * How close to a wall's approach zone a bot commits to the side it wants
   * (D32). Inside the fence there is no changing sides, so the lane has to be
   * chosen before it, and far enough out that the crowd can cross the road in
   * time — six metres of road is a little over a second, and the squad moves
   * sideways faster than it runs.
   */
  wallCommitDistance: number;
  /**
   * How far ahead a bot reads a charger that has set off (D49). Past the
   * charger's own `triggerRange`, so a bot sees one the moment it moves.
   */
  chargerLookahead: number;
  /**
   * Share of the squad's raw output a bot assumes actually lands on a
   * charger running at it. Below 1 because the river, the gates and the
   * blocks in the same lane are eating shots too, and a bot that believed
   * its whole output was on the charger would stand in the lane and lose the
   * argument.
   */
  chargerAimShare: number;
  /**
   * Squad-to-row distance at which greedy chooses its lane plan and walks into
   * it (document 31, 4.4), so it shoots the guard it is paying for. Past
   * projectile range, so a guard 8 m in front of the panels is not yet in
   * range when the choice is made.
   */
  readDistance: number;
  /**
   * How much better, as a share of the squad, another lane has to price before
   * a bot abandons the plan it is standing in. A price moves every step as the
   * lane underfoot is shot clear; without the margin two near-equal lanes
   * would have the column swaying between them and shooting neither.
   */
  planMargin: number;
  price: BotPriceBalance;
  human: HumanBotBalance;
}
