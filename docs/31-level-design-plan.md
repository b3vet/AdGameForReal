# Level design and difficulty plan, approved: beats instead of dice

Status: approved by the product owner on 2026-09-17, who answered the draft's
questions (document 30) with its recommended defaults. This is document 30
with those answers written in; the draft stays as it was. Written for note 2
of document 29. Still no ads, no IAP, no analytics (D6). The measurements
below were taken on 2026-09-16 on the working tree as it stood then: round 2's
one-gate-per-row rule and Endless bosses were in, and the round 3 Rime Fiend
charge fix was still being edited, so the Frostfell boss numbers are
indicative only. Phase 1 re-measures them on the integrated tree.

The plan in brief: levels stop being dealt from dice and become scripts of
designed beats, each built around one gate row, with its threats placed on
purpose in front of or behind the panels, started early enough to be seen and
sized to cost 10 to 35 percent of the squad if mishandled. Fences commit the
column past a hazard. Curses become rarer and useful. Losses move from the
boss onto the road. The bots learn to price a lane, and the bands are
re-measured on them. Phase 1 does this for all 40 levels with eight beats;
Phase 2 adds set pieces and Endless.

The owner's note, as given in document 29:

> "We need to seriously think about level design and hardness, the gates,
> multiplier count per level, the decreasing gates, the lanes that fixes the
> horde's path should have be hurtful sometimes and it should make me think on
> which path to choose, the enemies are always way too close to us but they
> are always too weak, it is never a challenge, it should have been. Their
> spawn points and run start points are random at the moment, but we could
> increase the quality of the gameplay if we actually consider the gates they
> spawn behind or front, etc."

"Decreasing gates" is read here as the red, negative gates (`sub`). "The lanes
that fix the horde's path" are the lane fences (D32): they fix the path of the
player's own crowd.

## 1. Diagnosis

### How a level is built today

`generateLevel` deals 16 to 19 rows, 18 m apart. `levels.json` sets how many
of them are gate rows, mixed rows (a gate row with a block 6 m in front of its
best gate), hordes, brute rows, charger rows and shield rows; `dealRowKinds`
shuffles that mix under a few order rules (a gate row first, no two hordes
together, no more than two threat rows in a row, a threat row last). Every
gate and threat is sized against a geometric curve from `startCount` to
`peakTarget`. Lanes are picked at random for every panel and every threat.
Rivers do not start at a place: they spawn 34 m in front of the squad
wherever it is (`streams.spawnAhead`, equal to projectile range) once the
squad is 34 m short of the row. Blocks stand on the road and start walking
when the squad is 26 m away, chargers at 22 m. Enemies are drawn from 52 m,
gate panels from 49 m. Fences go on random
gate rows from level 4 under one rule: both halves of the road must keep a
lane that is not a curse (`bothHalvesPayable`), so a fence can never cost
anything by construction. The boss waits at the end.

### How it was measured

An instrumented copy of the balance harness played every level on seven roads
(the shipped road the app plays, plus seeds 1 to 6) with the human-like bot
and with greedy, Frostfell on the kit the campaign simulation says the player
holds (as `balance.test.ts` does): 560 runs. It recorded every gate row
(every lane's value when the bot commits, the lane taken, what greedy would
have taken), every threat (the squad when it started, what it cost, where and
when it died), losses by cause, and the count every 18 m. A static pass read
eleven roads per level without the sim. A second pass mutated generated levels
to test the levers this plan uses (section 1.3). The scripts are throwaway;
Phase 1 commits a `DESIGN=1` readout that reproduces these tables.

### 1.1 The owner's points as numbers

| Owner's words | Measurable problem | Today |
|---|---|---|
| "never a challenge", "too weak" | Where the squad is lost | The boss takes 74 to 81 percent of all the human bot's losses and 89 to 91 percent of greedy's. Road threats take 9 to 18 percent (human) and 8 to 11 percent (greedy); curses the rest. |
| | What one wave costs | Median 0. 62 to 67 percent of all threats cost the squad nothing, for either bot. Greedy's worst tenth costs 5 to 6 percent of the squad, the human's 6 to 10. |
| | What the whole road costs | Greedy loses 3 to 6 percent of its peak to road threats. The human loses 10 to 23 percent from level 4 on, and another 6 to 14 percent to curses it walks into. |
| | The count through a level | Rises monotonically. The human reaches the boss with 95 to 100 percent of its peak, greedy with 99 to 100. There is no dent a player would call a setback. |
| | Enemy hit points on the road | 0.26 to 0.61 of the boss's own on Meadow, 0.18 to 0.29 on Frostfell (shields not counted). The whole road is smaller than the boss. |
| "way too close to us" | Where enemies appear and die | Rivers appear 34 m out and reach the column 4.3 s later. Blocks wake at 26 m and reach it 3.1 to 3.5 s later; chargers wake at 22 m and arrive in 1.5 s. 59 to 63 percent of blocks die within 10 m of the column (median 3 to 7 m, contacts included), 1.6 to 3.2 s after waking. River bodies die at a median 14 to 18 m. |
| | Where that is on screen | At 390x844 the column stands about 78 percent of the way down, 34 m is at about 37 percent, 52 m at 33 percent, the horizon at 22 percent. Everything happens in the lower half; the road between 52 m and the fog is always empty. Side-lane gate numbers are drawn only inside 30 m (`SIDE_GATE_LABEL_RANGE`), 6 s before the row. |
| "the gates", "decreasing gates" | How often a row has a red lane | From level 2, 98 to 100 percent of gate rows carry a curse and 4 to 12 percent carry two: 9.5 to 17 curses per level. |
| | Whether a curse is ever right | Greedy walks through a curse on 0.1 percent of rows. A curse shot until it flips and then taken, the concept's own hook, happens 0.01 times per run from level 10. A curse is wallpaper. |
| | Whether the rest is a choice | The best lane beats the second by a median 8 to 18 percent of the squad; 17 to 30 percent of rows have an obvious answer (over 30 percent). The spread best to worst is large (0.53 to 0.89 of the squad) only because the worst lane is always the curse. An `add` prints 36 percent of the squad on level 1 and 8 percent from level 21. |
| | Whether the best lane costs anything | In 40 to 82 percent of gate rows (by level) no block guards the best lane. |
| "multiplier count per level" | Multipliers | 0 on level 1, exactly 1 on levels 2 to 10, exactly 2 from 11, x2 to x3 (mean 2.0 to 2.7). Greedy takes all of them (1.97 of every 2 on Frostfell). They are the decision that is always made the same way. |
| "spawn points random", "behind or front" | Threats relative to gates | A river or block stands in the lane of the next row's best gate 24 to 34 percent of the time: chance is 33. Placement ignores the gates entirely. |
| "fences should be hurtful" | What a fence costs | Nothing by design (`bothHalvesPayable`). Its only cost is a late read: the human bot leaves about 13 (Meadow, from level 4) to 40 (Frostfell) units per run outside fences as stragglers. Greedy never pays. |

And the headline bands, for reference: the human bot clears 0.72 of ordinary
Meadow levels and 0.76 of ordinary Frostfell levels on seeds 1 to 6 (D45 asks
0.70 to 0.80); on the shipped roads it clears 0.65 and 0.50 (one road per
level, so noisy). Greedy clears everything.

### 1.2 What the numbers say

1. The level is one DPS race at the end. The road only decides how big the
   squad is when it starts, and it does that mostly through gates.
2. Waves are sized just under what the squad can kill: stream pressure 0.45 to
   0.95 in the lane the squad stands in. A column that stands in the lane
   kills everything. That is why the median wave costs nothing and why the
   owner reads the enemies as weak.
3. Every gate row is the same question with the same answer: not red, take
   the multiplier, otherwise the bigger plus. Nothing on the road puts a price
   on the answer.
4. Nothing is placed in relation to anything else. Threats, gates and fences
   are three independent dice.
5. Fights happen at the column's feet because enemies wake late, not because
   they are fast.

### 1.3 The levers, tried

Generated levels were mutated after generation and played on five ordinary
levels per biome (Meadow 5, 8, 12, 16, 18; Frostfell 22, 26, 28, 33, 38), six
seeds, both bots. "Road loss" is threat losses on the road as a share of the
peak, curses excluded.

M is Meadow, F Frostfell. Live enemies are the per-run peak, mean over runs,
with the worst run in brackets.

| Variant | Human clear M / F | Greedy clear M / F | Human road loss M / F | Greedy road loss M / F | Peak live enemies M / F |
|---|---|---|---|---|---|
| As shipped | 0.67 / 0.77 | 1.00 / 1.00 | 0.16 / 0.11 | 0.05 / 0.05 | 156 (255) / 142 (300) |
| Aim: every threat moved into the next row's best lane | 0.70 / 0.77 | 1.00 / 1.00 | 0.12 / 0.11 | 0.05 / 0.05 | 158 (253) / 141 (300) |
| Mid: half the bodies per river, 30 percent more river and block hit points | 0.67 / 0.70 | 1.00 / 1.00 | 0.26 / 0.19 | 0.05 / 0.06 | 85 (146) / 77 (168) |
| Mid with the boss's hit points down a quarter | 0.73 / 0.73 | 1.00 / 1.00 | 0.26 / 0.19 | 0.05 / 0.06 | as Mid |
| Strong: half the bodies, twice the hit points | 0.37 / 0.43 | 0.80 / 0.97 | 0.83 / 0.69 | 0.31 / 0.20 | 84 (215) / 86 (177) |
| Far: rivers spawn 52 m out, blocks wake at 40 m, sizes unchanged | 0.67 / 0.70 | 1.00 / 1.00 | 0.22 / 0.15 | 0.07 / 0.06 | 236 (300) / 227 (300) |
| Far with Mid | 0.63 / 0.63 | 0.97 / 1.00 | 0.29 / 0.14 | 0.06 / 0.05 | 141 (257) / 137 (271) |

What that settles:

- Moving threats into the best lane without changing anything else does
  nothing for greedy and helps the human, because it already stands in that
  lane. Placement matters only when it creates a conflict: a lane the column
  has to be in for the gate but cannot clear in time.
- Fewer, 30 percent stronger bodies move the challenge onto the hand (human
  road loss up by 60 to 70 percent) at nearly the same clear rate, and cut
  the peak number of live enemies by 45 percent. Greedy does not notice: a
  good player is reached through decisions, not through bigger numbers.
- Response to size is steep: doubling the hit points multiplies road losses
  by four to six and costs greedy a fifth of its Meadow clears. Sizes have to
  be tuned per beat, not per level.
- Taking a quarter off the boss buys back three to six points of clear rate.
  The attrition can move from the boss to the road without moving the bands.
- A spawner that keeps pace with the squad cannot simply be moved further
  out: bodies live longer (peak live enemies up 50 to 60 percent, the 300 cap
  hit), and the road got harder rather than fairer, most likely because every
  river now starts a row earlier, on top of the previous gate. Rivers need a
  fixed place on the road.
- The mechanic that makes "behind or in front of a gate" matter already
  exists: an `add`, `sub` or `fireRate` panel is a target (`targeting.ts`), so
  a lane's fire goes into the panel and anything standing behind it is not
  shot until it walks through. A multiplier or staff panel lets shots through.
  Nothing uses this on purpose today.

## 2. Goals and pillars

1. **Every gate row is a decision with a price.** The best lane costs
   something, and the price is on screen before the choice: the number on the
   block, the river pouring through the panel, the fence that shuts the lane.
2. **Threats are placed with intent relative to gates.** A guard in front of
   the prize, an ambush behind it, a river that pours through it, a safe lane
   that is red, a fence that commits the column past a hazard.
3. **Pressure the player can see coming.** Everything a beat uses is visible
   from about 70 m, at least 4.5 s before it can reach the column. Enemies
   start running early enough that fights happen 15 to 34 m out, not at the
   column's feet.
4. **Fewer, stronger, more readable waves.** Five to seven threat beats per
   level, each worth 10 to 35 percent of the squad if mishandled, 0 to 8
   percent if handled well. The number on a threat is what it takes from you.
5. **The road carries the level.** The count visibly falls two or three times
   a level. The boss takes less than half of what is lost, not nine tenths.
6. **Teaching, tension, release.** Each new element is introduced alone, then
   tested, then combined; milestone levels spike and the level after them
   breathes.
7. **Fair failure.** Every loss traces to something visible that the player
   could have answered. No spike nobody measured.

What stays: the lane-wide column that fires down its own lane (D42), one gate
per row, stragglers as the price of a late fence (D44), the boss fight's
length (D20), the difficulty bands' headline (D45, section 5), greedy as the
ceiling, seeded determinism, the economy (D46).

## 3. The level grammar

### 3.1 Words

- **Beat**: a designed situation of one to three rows built around one gate
  row, with its threats and optionally a fence. A level is eight or nine beats.
- **Lane roles**: every beat is written in roles, not lanes. `prize` is the
  lane with the best face value, `safe` the modest one, `other` the third. The
  composer maps roles to lanes from the seed (a permutation), under rules
  (section 3.8).
- **Anchor** (`at`): where a threat stands, in metres from the beat's gate row
  G. Negative is in front of the panels (nearer the squad), positive behind.
- **Wake**: the squad-to-enemy distance at which a block starts walking. Per
  enemy, not per kind.
- **Portal**: a fixed point on the road that a river pours from, with `open`
  (the squad-to-portal distance at which it starts), `seconds` (how long it
  pours), `pressure` and `density`.
- **Rating**: 0 (rest) to 5 (milestone spike); the expected loss for the
  reference player at that beat (section 3.4).
- **E**: the squad the reference player is expected to have at the beat.

### 3.2 Where threats stand and when they run

Four rules replace the dice.

1. **Every threat belongs to a beat and a lane role.** No threat is placed
   without a gate row it is about.
2. **In front of a multiplier or a staff, behind a plus.** Shots pass through
   multiplier and staff panels and stop at plus, curse and fire-rate panels.
   A guard that has to be shot down stands in front (`at` -6 to -10). An
   ambush stands behind a plus (`at` +4 to +8), where the lane's fire cannot
   reach it until it walks through the panel.
3. **Wake sets the fight.** Where a block starts running decides how long it
   is shootable. A brute at `at` -8 that wakes at 45 m closes 11 m before it
   is in range and is then under fire for 4.7 s. A brute at +5 behind a plus
   walks through the panel with 4.5 s of fire left if it wakes at 50 m, 2.2 s
   at 34 m, 1.0 s at 26 m and 0.2 s at 20 m, where it arrives whole. That one
   number turns a guard into an ambush and is the difficulty dial of a beat.
4. **Rivers pour from a place.** A portal at `at` +8 behind a plus panel that
   opens at 50 m pours through the panel: its first bodies cross the panel
   with 3 to 4 s of fire left, and the last seconds of the pour arrive through
   the panel at the column's feet. Those last bodies are the toll, and the
   composer can compute it (pour rate times the seconds whose bodies cross
   inside the last 1.5 s). A portal at `at` -10 has no screen and is simply a
   river to clear. The pour stops when the squad is within 6 m of the portal.

Visibility: enemy, portal and label draw ranges go to 70 m, gate panels to
60 m (render, section 4.7). Every beat must give at least 4.5 s from first
sight to the earliest possible contact, and chargers at least 2 s from trigger
to contact (trigger 22 m becomes 30 m).

### 3.3 The beats

Phase 1 builds eight beats; Phase 2 adds five more and a charger-cross tier
for K. Every number is a starting
value to be tuned in the beat lab (section 5), not a promise.

| Beat | Rows | Ratings | Prize / safe / other | Threat | The question |
|---|---|---|---|---|---|
| **O** open (R when it follows a spike) | 2 | 0 | big + / mid + / small + or fire rate | none | Read the numbers. |
| **G** guard | 2 | 1-4 | x2 or big + / small + / curse | brute (shielded brute on Frostfell tiers) at -8 in the prize lane, wake 45 m | Commit early and shoot it down, or take the small plus. |
| **A** ambush | 2 | 1-4 | big + (a panel that stops shots) / mid + / curse or small + | brute at +5 behind the prize panel, wake 50 / 34 / 26 / 20 m by tier | Is the plus bigger than what is waiting behind it? |
| **T** toll river | 2 | 1-4 | x2 or big + / mid + / curse | portal in the prize lane: -10 at tier 1, +8 from tier 2 | Pay the toll for the prize, or take the mid plus clean. |
| **C** flip | 2 | 1-2 | big + with a tier-2 guard / mid + with a light river / small curse | none in the curse lane | The red panel is the calm lane; shoot it and it turns green. |
| **F** fork (K with chargers) | 2 | 1-4 | mid + / mid + / curse | a river in each of the two plus lanes (K: two or three chargers at -10, trigger 30 m) | Fight one of two rivers, or pay the curse. |
| **W** commit fence | 2 | 1-5 | the single outer lane holds the prize / the two inner lanes hold a mid + and a curse | fence from -20 to -0.5 m; a portal at +6 in the outer lane; a light guard inside | Commit past the hazard for the prize; there is no dodging once the fence holds. |
| **B** prep | 2 | 1-5 | big + / fire rate / curse | the last row before the arena: a brute and a river, sized so the column reaches the boss with 80 to 90 percent of its peak | Units or firepower for the boss, then hold the line. |
| **X** gauntlet (Phase 2) | 3 | 4-5 | the middle lane only: x2 or x3 | both boundaries fenced for 30 m, a guard at -20 and a river at +6 in the middle lane | The milestone set piece: all in. |
| **S** shield wall (Phase 2) | 2 | 3-4 | x2 / mid + / curse | two shielded brutes, prize and safe lanes, wake 55 m | Break a shield in time; Frost and Storm shine. |
| **Y** staff offer (Phase 2) | 2 | 1 | staff / mid + / small + | the next beat's threat suits the offered staff | Change weapon for what is coming. |
| **P** pick (Phase 2) | 1 | 0-1 | big + / fire rate / staff | none | Units or rate. |
| **M** mirror (Phase 2) | 2 | 2-3 | x2 in both side lanes / curse in the middle | an ambush behind one side, a guard in front of the other | Two prices for the same prize. |

Beat details that matter for the build:

- **Guard** sizes the block by kill time: tier 1 to 4 take 2.0 / 2.8 / 3.4 /
  4.0 s of the reference squad's fire (tier 4 wakes at 40 m). A committed
  player has 4.7 s from 34 m; one who commits at 25 m has about 3.3 s.
- **Ambush** sizes the block against the prize: at tiers 3 and 4 the prize
  less the ambush is within a tenth of E of the safe lane, so the choice is
  close on purpose. Its printed number is 12 / 18 / 25 / 30 percent of E, and
  its footprint is held to one lane so the panel covers all of it (a fat
  block reaches into the next lane, where nothing screens it). The prize must
  be a plus: a multiplier lets shots through and there is no ambush.
- **Toll** pours for 4 / 5 / 6 / 6.5 s at pressure 0.8 / 1.0 / 1.2 / 1.4 and
  density 0.35 to 0.5 bodies per unit of E. The expected toll for a column
  that stands in the lane from 34 m is 3 / 7 / 12 / 18 percent of E. Behind a
  plus panel the tail of the pour is screened and is the toll; behind a x2
  the panel lets shots through, so the toll comes from pressure above 1
  alone. A column that slides in at the last moment pays the toll and the
  unkilled front of the river as well.
- **Flip**: the curse prints 6 to 8 percent of E, and a column that stands in
  it from 34 m turns it into about +5 percent. This needs the curse's
  shoot-down rate to scale with the squad (section 4.2): at a flat 2 per
  second a curse of 30 never flips.
- **Fork** rivers pour at 0.9 to 1.3 pressure per lane at 0.3 density per
  lane, from portals at -6. The column covers one lane; the other river walks
  past it. The curse in the third lane costs 8 to 15 percent of E.
- **Commit fence** is the hurtful fence the owner asked for. The outer lane is
  a single lane, the fence holds the column in it (D32, D43), and the river
  pours down it: pressure 1.0 / 1.15 / 1.3 / 1.4 / 1.5 by tier. The inner side
  offers dodging room and less. The side has to be chosen before the approach
  zone, about 22 m (4.4 s) before the gate. A late read still makes
  stragglers, as now.

### 3.4 Sizing

- **The level curve with losses in it.** E starts at `startCount` and moves
  beat by beat: E(k+1) = E(k) x g(k) x (1 - l(k)), where g is the factor of
  the lane the reference player is expected to take and l is the beat's
  expected loss. Gate values are solved so E at the prep beat equals
  `peakTarget x curveTrim`. `curveTrim` is fitted per level in the tuning pass
  so E matches the human bot's measured median count within 15 percent. This
  replaces `squadCurve` on scripted levels; Frostfell keeps sizing against the
  armed hand (D49).
- **Expected loss by rating** (reference human; greedy about half): 0, 2-5,
  5-10, 10-15, 15-22, 22-30 percent of E for ratings 0 to 5. Over a level,
  losses compound on a growing squad and the late beats dominate: eight beats
  of ratings 2 and 3 cost the human roughly 30 to 40 percent of its peak on
  the road by that arithmetic, which is the target in section 5.
- **Effective fire per unit** is measured, not assumed: the beat lab measures
  the reference squad's hit points per second per unit against a block and
  against a river, per biome (Frostfell with the kit), and stores them as
  `beats.dps.block` and `beats.dps.river`. Today's `streams.dpsTrim` of 0.38
  is the same idea for rivers only.
- **Blocks**: units = kill seconds x E x dps.block / hit points per unit. The
  number on a block is what it takes on contact (unchanged rule), so a block
  that is hard to kill should also print a big number. Brute hit points per
  unit come down from 30 to about 12, so a block that takes three seconds to
  clear prints 15 to 30 percent of E rather than today's 6 to 11; the beat lab
  sets the exact figure.
- **Rivers**: bodies = density x E; hit points per body from the pressure,
  E, dps.river and the fire window the portal geometry leaves (the time a
  body is in range and in front of any panel). One body still costs one
  soldier (D29).
- **Chargers**: trigger 30 m (was 22), bite 10 percent of the column with a
  floor of 6 (was 5 percent), sized to die in 1.2 s of fire in the lane.
- **Gate values**, as shares of E: small + 12 to 15, mid + 25 to 30, big + 40
  to 60, curse (flip) 6 to 8, curse (price) 10 to 20, x2, x3. Printed values
  round to 5 above 20 and to 10 above 100, so a late row reads +60 / +150 /
  x2 rather than +31 / +38 / x2. The shoot-to-grow rate on a plus scales with
  the squad as the curse's does, so pumping a gate is visible at 300 units.
- **The 500 cap.** Greedy peaks at 500 on every Frostfell level today, and a
  multiplier on a capped squad is worth nothing. Scripts keep E under about
  350 until the last two beats, so late multipliers stay decisions.

### 3.5 Gate budgets per level

| Levels | Multipliers | Curses | Staff gates | Rule |
|---|---|---|---|---|
| 1 | 0 | 0 | 0 | Learn to read the plus and the block. |
| 2-3 | 1 (x2, guarded, tier 1) | 2 | 1 | The first curse is a flip. |
| 4-9 | 1 (x2) | 2-3 | 2 | One curse per level is a flip. |
| 10-20 | 1 on release levels, else 2 (a x3 on 13, 15, 18 and 20) | 2-5 | 2 | |
| 21-40 | 1 on teach and release levels, else 2 (x3 from 25) | 2-6 | 2 | |

Against today's 9.5 to 17 curses per level: a curse is placed only by a beat
that gives it a role (the price lane beside a prize, the flip, the toll lane
of a fork, the inner side of a fence). No multiplier is ever unguarded: every
x2 and x3 sits in a guard, toll, fence or gauntlet beat. Staff gates keep
today's post-pass (`placeWeaponGates`), restricted to `safe` and `other`
lanes, until Phase 2's staff offer beat takes them over.

### 3.6 Fences that commit

Fences are placed only by fence beats (W, and X in Phase 2), never by the
random pass. `bothHalvesPayable` stays as a guard on the unscripted path and
is replaced on scripts by a per-beat check that the two sides are what the
beat says: outer side a prize and a toll, inner side a smaller plus and more
room. The approach, gate gap and straggler rules are unchanged.

### 3.7 The boss

- The prep beat frames the fight: units or fire rate on the last row, then a
  gauntlet row that takes 10 to 15 percent, so the column arrives at 80 to 90
  percent of its peak instead of 95 to 100.
- The boss takes less. Start with `bite` at three quarters of today's on every
  level (the experiment above), then re-derive each boss's hit points from the
  arrival count the new roads produce so the fight still lasts 20 to 30 s
  (D20) and the ladder stays monotone.
- Milestone levels carry a set piece mid-level (a double commit fence in
  Phase 1, the gauntlet in Phase 2) as well as the boss, so the spike is felt
  before the arena.

### 3.8 Scripts and the composer

Levels 1 to 40 become authored scripts: an ordered list of beats with a tier
and, where it matters, a prize override. The composer turns a script into the
`RowDef[]` the sim already runs, so `buildWorld`, crossings, render and the
bots keep their input shape.

Composer rules:

- Each beat is two rows (three for X): a lead-in row at G - 18 carries threats
  anchored in front of the panels, the gate row at G carries the panels and
  anything anchored behind them. Levels stay 16 to 19 rows and 60 to 75 s of
  road.
- Roles map to lanes by the level seed: a permutation per beat, drawn on its
  own salted stream. Constraints: the prize is not in the same lane three
  beats running; a fence beat's outer lane is a side lane; a fork's two
  rivers are adjacent lanes or the two sides, never leaving the curse in the
  middle twice running.
- Budgets (section 3.5) are checked, not rolled: the composer fails loudly if
  a script asks for more multipliers than its level allows. Curse slots are
  filled in rating order until the level's curse budget is spent; the rest
  print a small plus.
- The shipped road is the script with the level's own seed, so the owner plays
  exactly the designed level. Retry plays the same road (round 2 decision).
- Every generated level carries a list of beat marks (`z`, beat, tier, prize
  lane) for tests, the readout and render hints. The sim's rules and the bots
  never read them: bots read the board, as a player does.

### 3.9 Levels 1 to 40

Notation: O open, R rest (an open beat after a spike), G guard, A ambush,
T toll, C flip, F fork, K fork with chargers, W commit fence, B prep, X
gauntlet; the digit is the tier (rating); `x` means the prize is a x2, `x3` a
x3 (never on an ambush, whose prize must stop shots); `s` on G means a
shielded brute. Eight beats make 16 rows and nine make 18, inside today's 16
to 19.

Rhythm rules: every level opens with O; a rest comes after every two or three
threat beats; a new element is introduced at tier 1 on its own; milestones
build to a set piece (W4 or W5) right before the prep; the level after a
milestone opens with two easy beats. Phase 1 writes the set pieces as W4 and
W5; Phase 2 replaces them with X.

| L | Role | Beats | x | Curses | Fences | New here |
|---|---|---|---|---|---|---|
| 1 | teach | O G1 O T1 G1 R G1 B1 | 0 | 0 | 0 | a block's number is what it takes; a river to clear |
| 2 | teach | O C1 G1x R T1 G1 R B1 | 1 | 2 | 0 | the curse that flips; the first x2, guarded |
| 3 | teach | O T2 C1 R G1x T2 R B1 | 1 | 2 | 0 | a river pouring through a panel |
| 4 | teach | O G1 W1 R T2 C1 G2x B1 | 1 | 2 | 1 | a fence with a toll side |
| 5 | teach | O A1 G2 R W2 A2 G2x B2 | 1 | 2 | 1 | the ambush behind a plus |
| 6 | teach | O F1 G2x R A2 W2 F2 B2 | 1 | 3 | 1 | the fork |
| 7 | test, hard | O T2 F2 A2 R W2x G3 T2 B2 | 1 | 3 | 1 | ordinary-hard (D55) |
| 8 | test | O G2x A2 R F3 W2 C1 T3 B2 | 1 | 3 | 1 | |
| 9 | test | O C1 A2 W2 R F2 T3 G3x B2 | 1 | 3 | 1 | |
| 10 | milestone | O G2x W3 R A3 T3 R W4x B3 | 2 | 4 | 2 | first spike |
| 11 | release | O O G2x T2 R A2 F2 B2 | 1 | 2 | 0 | |
| 12 | test | O T2x W3 R G3x A3 C1 F3 B2 | 2 | 4 | 1 | |
| 13 | twist | O A2 F3 R W3x T3 R G3x3 B3 | 2 | 4 | 1 | the first x3, behind a heavy guard |
| 14 | test | O G2x T3x W3 R F3 A3 C1 B3 | 2 | 4 | 1 | |
| 15 | milestone | O W3x A3 R F4 T3 R W4x3 B3 | 2 | 5 | 2 | |
| 16 | release | O O T2 G2x R A3 F3 B2 | 1 | 3 | 0 | |
| 17 | test | O A3 W3x R G3x T3 F3 C1 B3 | 2 | 4 | 1 | |
| 18 | twist | O F3 W3x R A3 T4 R G3x3 B3 | 2 | 5 | 1 | |
| 19 | test | O T3x A3 W3 R F3 G4x C1 B3 | 2 | 5 | 1 | |
| 20 | milestone, finale | O W3x A4 R F4 T4 R W5x3 B4 | 2 | 5 | 2 | |
| 21 | teach | O G1 K1 R T2 G2x R K2 B2 | 1 | 2 | 0 | the charger |
| 22 | teach | O Gs1 T2 R K2 Gs2x R A2 B2 | 1 | 3 | 0 | the shielded guard |
| 23 | test | O K2 W2 R Gs2x T3 F2 C1 B2 | 1 | 3 | 1 | |
| 24 | test | O A2 K2 R W3x Gs3x T3 C1 B3 | 2 | 4 | 1 | |
| 25 | milestone | O Gs3x W3 R K3 A3 R W4x3 B4 | 2 | 4 | 2 | x3 in a set piece |
| 26 | release | O O K2 G2x R T3 A2 B2 | 1 | 3 | 0 | |
| 27 | test | O T2x K3 R A3 W3x Gs3 C1 B3 | 2 | 4 | 1 | |
| 28 | twist | O Gs2x F3 R W3x K3 T3 R B3 | 2 | 4 | 1 | |
| 29 | test | O A3 W3x R K3 T3 Gs3x C1 B3 | 2 | 5 | 1 | |
| 30 | milestone | O W3x K4 R A4 T4 R W5x3 B4 | 2 | 5 | 2 | |
| 31 | release | O O Gs2x T3 R K2 A3 B3 | 1 | 3 | 0 | |
| 32 | test | O K3 W3x R A3 T3 F3 Gs3x B3 | 2 | 5 | 1 | |
| 33 | twist | O T3 A3 R W4x K3 R Gs3x3 B3 | 2 | 5 | 1 | |
| 34 | test | O Gs3x K3 W3x R T4 A3 C1 B3 | 2 | 5 | 1 | |
| 35 | milestone | O W4x A4 R K4 T4 R W5x3 B4 | 2 | 6 | 2 | |
| 36 | release | O O T3 Gs3x R A3 K3 B3 | 1 | 4 | 0 | |
| 37 | test | O A3 W4x R K3 T4x Gs3 C1 B4 | 2 | 5 | 1 | |
| 38 | twist | O K4 W4x R A4 T4 R Gs4x3 B4 | 2 | 6 | 1 | |
| 39 | test | O T4x A4 W4 R K4 Gs4x C1 B4 | 2 | 6 | 1 | |
| 40 | milestone, finale | O W4x K5 R A5 T5 R W5x3 B5 | 2 | 6 | 2 | |

The milestone flags stay where D55 and D49 put them (10, 15, 20, 25, 30, 35,
40). Milestone levels are rated so the human needs the kit the campaign
affords by then (D45). `startCount`, `peakTarget`, biome and boss kind stay in
`levels.json`; the per-kind row counts go.

### 3.10 Endless on the same grammar

Endless keeps round 2's shape (a boss every 18 rows, the two bosses
alternating, pay by distance) and replaces its dealt rows with beats drawn
from the library on a seeded stream. Stretch n (the road between bosses n and
n + 1) draws beats with a mean rating of 1.5 + 0.4 n, capped at 5; after any
beat of rating 4 or 5 comes a rest; from the third stretch each stretch ends in
a set piece before the boss. E comes from the existing dial (`dialAt`). Tuned
to round 2's targets: a good human-like player dies between the second and
fourth boss, greedy before the sixth. This is Phase 2; Phase 1 leaves Endless
on its current generator.

## 4. How it fits the code

### 4.1 Modules

| Area | Change |
|---|---|
| `src/sim/beats/` (new) | `compose.ts` (script to rows, role permutation, budgets), `beatSize.ts` (the sizing in 3.4), `beatCurve.ts` (E with losses), `fences.ts` (fence beats to `WallDef`s), `marks.ts` (beat marks). Each under 400 lines. |
| `src/sim/level.ts` | `generateLevel` calls the composer when the config has a `script`; the dealt path stays for configs without one (render fixtures, the stress scene, Endless until Phase 2). |
| `src/sim/streams.ts` | Anchored portals: `anchorZ`, `openAt`, a stop gap; the moving spawner stays for unanchored rivers. |
| `src/sim/contact.ts`, `enemies.ts`, `spawn.ts` | Per-enemy wake (`wake ?? activationRange(kind)`). |
| `src/sim/gates.ts`, `firing.ts` | The curse's shoot-down, the plus's shoot-up and the curse creep gain a share-of-squad term beside the flat rate. |
| `src/sim/pressure.ts` | Pressure for anchored rivers (the fire window from the portal geometry, the panel screen). |
| `src/sim/walls.ts` | Unchanged rules; scripted levels take their fences from `beats/fences.ts`. |
| `src/sim/rowKinds.ts`, `rows.ts`, `gateGen.ts` | Unchanged in Phase 1 (Endless and fixtures use them); retired from the campaign path. |
| Bots | Section 4.4. |
| `src/render` | Draw and label ranges (`theme.ts`), including side-lane gate numbers readable from 45 m (today 30 m, because three numbers touch further out: a smaller side label or the kind glyph alone between 30 and 45 m); a portal marker in the enemy's palette role (a ground ring and a dust burst from the existing effects, no new asset); a wake cue (the block's run-start: a short dust kick and a roar-sized squash, the charger's existing windup); a check that bodies behind a panel stay visible through the arch at 390x844. |
| `src/core` | A dev route `?beat=<id>:<tier>&count=<n>` that plays one beat on an endless-style road with no boss, so a beat can be felt in ten seconds (beside `devScenes.ts`). |

### 4.2 Data shapes (pinned, so the tracks can build in parallel)

```ts
// src/data/beat-types.ts (new), re-exported from ./types.ts
export type LaneRole = 'prize' | 'safe' | 'other';
export type GateSlot =
  | { kind: 'add'; size: 'small' | 'mid' | 'big' }
  | { kind: 'mul'; value: 2 | 3 }
  | { kind: 'sub'; size: 'flip' | 'price' }
  | { kind: 'fireRate' }
  | { kind: 'none' };
export interface BeatEnemy {
  kind: 'grunt' | 'brute' | 'shieldBrute' | 'charger';
  lane: LaneRole;
  /** Metres from the beat's gate row; negative is in front of the panels. */
  at: number;
  /** Squad-to-enemy distance at which it starts walking. */
  wake: number;
  /** Seconds of the reference squad's fire it takes to clear (blocks). */
  killSeconds: number;
  /** Chargers: how many, spread over the roles in `lanes`. */
  lanes?: LaneRole[];
}
export interface BeatRiver {
  lanes: LaneRole[];
  at: number;
  open: number;
  seconds: number;
  pressure: number;
  density: number;
}
export interface BeatFence {
  /** The role whose lane is the single outer lane. */
  outer: LaneRole;
  /** Metres before the gate row the stretch starts. */
  from: number;
  /** Both boundaries (the gauntlet, Phase 2). */
  both?: boolean;
}
export interface BeatTier {
  rating: 0 | 1 | 2 | 3 | 4 | 5;
  /** Expected loss for the reference player, share of E. */
  expectLoss: number;
  gates: Record<LaneRole, GateSlot>;
  enemies?: BeatEnemy[];
  rivers?: BeatRiver[];
  fence?: BeatFence;
}
export interface BeatDef {
  id: string;
  rows: 1 | 2 | 3;
  /** Keyed by tier, "1" to "5"; a tier lists only what differs from the one below. */
  tiers: Record<string, Partial<BeatTier>>;
}
// src/data/beats.json: { dps: { block: {meadow, frost}, river: {meadow, frost} },
//   values: { small, mid, big, flip, price } as [min, max] shares of E,
//   defs: BeatDef[] }

// src/data/level-types.ts: LevelGenConfig gains
//   script?: Array<{ beat: string; tier: number; prize?: 'x2' | 'x3' | 'big' }>;
//   curses?: number;      // budget
//   curveTrim?: number;   // fitted, default 1
// and keeps index, seed, startCount, peakTarget, biome, boss, milestone.
// gateRows, mixedRows, hordeRows, bruteRows, chargerRows, shieldRows,
// wallRows, streamPressure, streamDensity, hpScale and gateValues become
// optional and are read only on the unscripted path.

// src/sim/types.ts: StreamDef gains anchorZ?: number; openAt?: number.
// src/sim/rows.ts: RowEnemyDef gains wake?: number. EnemyState gains wake?: number.
// src/sim/level.ts: LevelDef gains beats?: BeatMark[]
//   (BeatMark = { z: number; beat: string; tier: number; prize: Lane }).
// balance.json: enemies.portal { stopGap: 6 }; gates.growthPerSecond gains
//   shares { add, sub } per unit of squad; gates.creep gains share;
//   enemies.charger.triggerRange 30, killShare 0.10; brute hpPerUnit to be set
//   by the tuning pass; bots gains readDistance, human.readNoise, human.behindReach.
```

### 4.3 Determinism

The composer draws only from salted streams of the level seed (role
permutation, value jitter), in a fixed order, so a script and a seed always
give the same road. Portals open on squad distance and pour on sim time, and
blocks wake on squad distance, so a run replays from its inputs as today. No
wall clock, no `Math.random`. The determinism tests in `regression.test.ts`
keep running on every level.

### 4.4 Bots

The bands are only as good as the bots, and today's bots choose lanes on gate
values alone (`laneScore`), which is exactly the blindness this plan removes.

- **Lane value with a price** (`botValue.ts`, new): a lane is worth the gate's
  outcome less what standing in that lane from now to the row will cost:
  blocks and bodies in the lane, each priced as what arrives
  (units x max(0, 1 - fire seconds x dps / hit points)), with zero fire
  seconds for anything behind a shot-stopping panel until it walks through,
  and the toll of a fenced outer lane. Allocation-free, reads only `RunState`.
- **Greedy** chooses its lane plan at `readDistance` (about 45 m) and stands
  in it, so it shoots the guard it is paying for; it keeps the final aim at
  `gateCommitDistance`. Its fence side uses the same value. It stays the
  ceiling: 100 of 100 on ordinary levels.
- **Human**: the flat 70 percent lane accuracy becomes a noisy read: each
  lane's value is perceived with multiplicative noise (`readNoise`, about
  0.25), so close calls are missed often and obvious ones rarely. It sees a
  block behind a panel only within `behindReach` (about 35 m). Reaction delay,
  swipe speed and the late fence read are unchanged. This is a D45 amendment:
  the bands are re-measured on it.
- **The beat lab** (`src/sim/__tests__/beatLab.ts`): plays one beat on a short
  boss-less road at three squad sizes with both bots and returns the loss, the
  lane taken, the decision value (best lane value less second, share of E)
  and the peak of live enemies.

### 4.5 Tests and bands

| Test | Change |
|---|---|
| `levelDesign.test.ts` (new, static, fast) | Every script composes; budgets match section 3.5; no unguarded multiplier; fences only in fence beats and their sides as specified; every threat gives 4.5 s from first sight and chargers 2 s from trigger; the shipped roads are pinned by a hash so a data edit is a visible change. |
| `beats.test.ts` (new, beat lab, about 20 s) | Each beat and tier inside its rating's loss band for the human at three sizes; greedy never above the band; the designed prize lane is greedy's choice at the reference size where the beat says so; peak live enemies per beat under 150. |
| `designReadout.test.ts` (new, `DESIGN=1`) | The tables in section 1, reproducible. |
| `balance.test.ts` | Bands in section 5; road share and boss share added; the star share read from the new survivor band. |
| `level.test.ts`, `levelRules.test.ts`, `walls.test.ts` | Rules written for dealt levels (the row mix per level, eight to fourteen gate rows, a curse or block beside every multiplier, never walled onto curses) hold on the unscripted path only; their scripted equivalents live in `levelDesign.test.ts`. Determinism, spacing and arena rules carry over. |
| `bots.test.ts`, `botHuman.test.ts` | Hand-made boards for an ambush, a toll and a commit fence: greedy prices them; the human misreads close calls. |
| `regression.test.ts` | Goldens for levels 1 to 3 and 21 to 23 re-captured, with the reason in the log. |
| `economy.test.ts` | Re-run unchanged: the campaign still reaches 40 and runs per purchase stay in band. |
| Endless tests | Phase 2. |

### 4.6 Saves, bests and stars

No schema change is needed. Coins, upgrades, staffs, the unlocked level,
missions, streak and cosmetics are untouched. Level bests (`levelBest`,
survivors and peak) are kept as earned, and so is every star: a star is
derived from the best, so keeping the best keeps the star. The star rule
(`STAR_SHARE`, survivors at least 60 percent of peak) is re-derived, because
a road that takes more leaves a smaller share; the target is that about a
third of the human bot's clears earn it (likely near 0.5). The Endless best
metres were set on a different road; Phase 2 keeps the number and the result
sheet compares against it as before (owner question 4).

### 4.7 Performance

The target is 60 fps with p95 under 20 ms on the owner's phone (document 28).

- Fewer bodies: half the bodies per river measured a 45 percent lower peak of
  live enemies (mean 156 to 85, worst 255 to 146; Frostfell's worst 300, the
  cap, to 168).
- Portals keep bodies alive longer than the moving spawner (moving it out to
  52 m cost 50 to 60 percent more live bodies), which the lower count pays
  for. The
  beat lab and `balance.test.ts` assert a peak of 180 live enemies on every
  level and seed; `enemies.maxLive` stays 300 as the hard ceiling.
- Draw ranges to 70 m add a few instanced blocks and labels at the top of the
  play band and nothing else; gate panels stay inside the existing instance
  capacity (16) at 60 m. At most two portal markers are on screen.
- No new simultaneous body kinds. The bots' path pricing is a pass over live
  enemies per lane per step, allocation-free.
- The PERF agent from round 2 is still working on frame time. Phase 1 starts
  after its work is integrated and re-measures the busiest scenes before and
  after.

## 5. Tuning method and acceptance criteria

Method, in order: tune each beat in the beat lab until it sits in its rating
band at three squad sizes (sizes, wake, portal timing); fit `curveTrim` per
level so E matches the human's median count; run the campaign bands; move
boss hit points last. Every number stays in data. A change is kept only if
the readout shows it.

| Metric | Today | Target | Where |
|---|---|---|---|
| Human first-try clear, ordinary levels | 0.72 Meadow, 0.76 Frostfell | 0.70 to 0.80 per biome; per-level floor 0.35; levels 1 to 3 at least 0.9 | `balance.test.ts` |
| Greedy, ordinary levels | 1.00 | 1.00 | `balance.test.ts` |
| Milestone gating | D45, D49, D55 | unchanged | `balance.test.ts` |
| Road share of the human's losses (threats and curses) | 0.19 to 0.26 | 0.45 to 0.65 | `balance.test.ts` |
| Road share of greedy's losses | 0.09 to 0.11 | 0.30 to 0.50 | `balance.test.ts` |
| Boss share of the human's losses | 0.74 to 0.81 | 0.35 to 0.55 | `balance.test.ts` |
| Boss fight | 20 to 33 s | 20 to 30 s (D20) | `balance.test.ts` |
| Threats that cost greedy nothing | 0.63 to 0.67 | at most 0.30 of threat beats | beat lab, readout |
| Greedy loss per threat beat | median 0, p90 0.05 to 0.06 | median 0.03 to 0.08, worst 0.25 | beat lab |
| Human loss per threat beat | median 0, p90 0.06 to 0.10, p99 up to 0.56 | median 0.05 to 0.12, p90 at most 0.25, p99 at most 0.40 | beat lab |
| Dents (threats costing the human at least 8 percent of the squad) | 2.1 per run on Meadow from level 4, 0.8 on Frostfell | at least 3 per level from level 4 | readout |
| Gate rows with a curse | 0.98 to 1.00 | 0.35 to 0.55 | `levelDesign.test.ts` |
| Greedy takes the red lane (walks it or flips it) | 0.001 of rows | 0.05 to 0.15 of gate beats | readout |
| Best lane with no price | 0.40 to 0.82 | at most 0.30 | `levelDesign.test.ts` |
| Decision value (priced best less second, share of E) | median 0.08 to 0.18 on gates alone | median 0.05 to 0.25; at most 0.2 of gate beats above 0.5 | beat lab |
| Unguarded multipliers | some | none | `levelDesign.test.ts` |
| First sight to earliest contact | 4.3 s river, 3.1 to 3.5 s after a block wakes, 1.5 s charger | at least 4.5 s for every threat; chargers at least 2 s from trigger | `levelDesign.test.ts` |
| Where greedy's blocks die | median 5 to 7 m; 59 percent within 10 m | median at least 15 m | readout |
| Peak live enemies | mean 142 to 156, worst 300 | at most 180 | beat lab, `balance.test.ts` |
| Survivors and stars | 0.36 to 0.52 of peak | D45's 0.25 to 0.50; star for about a third of the human's clears | `balance.test.ts`, core meta test |

The owner's own play is the final judge: each phase ends with a device build
and a short list of beats to try.

## 6. Phases and team plan

At most five general-purpose agents at once (D56). Rounds 2 and 3 are
integrated first; nothing here starts on top of their uncommitted work.

### Phase 1: every row a choice, every wave a threat (all 40 levels)

Wave one, four agents, one slot kept for the owner's notes:

| Track | Scope | Owns |
|---|---|---|
| SIM-GRAMMAR | Beat types, composer, sizing, curve with losses, fence beats, beat marks, portals, per-enemy wake, curse and plus rates by squad share, the campaign path switched to scripts, a one-beat level builder for the lab and the dev route; unit tests for each | `src/sim/**` except the bot files; `src/data/beat-types.ts`, `level-types.ts`, `types.ts`, `index.ts`; the `enemies`, `gates` and new `portal` blocks of `balance.json` |
| BOTS-LAB | Priced lane value, greedy's read distance and fence side, the human's noisy read, the beat lab, the `DESIGN=1` readout, bot tests on hand-made boards | `src/sim/bot*.ts`, `src/sim/__tests__/harness.ts`, `beatLab.ts`, bot tests, the `bots` block of `balance.json` |
| CONTENT | `beats.json` for the eight Phase 1 beats with four or five tiers each, the 40 scripts in section 3.9 with budgets, `levelDesign.test.ts` | `src/data/beats.json`, the script fields of `levels.json`, `levelDesign.test.ts` |
| RENDER-CORE | Draw and label ranges (side-lane numbers from 45 m), portal marker, wake cue, visibility through the arch at 390x844, the `?beat=` dev route, a hero set of four beats | `src/render/theme.ts`, `enemies.ts`, `streamBodies.ts`, `effects.ts`, `gates.ts` and `gateText.ts` (ranges and side labels), `src/core/devScenes.ts`, `query.ts` |

CONTENT builds against the pinned shapes in 4.2 while the composer lands, and
checks its scripts with the static test.

Wave two, after SIM-GRAMMAR, BOTS-LAB and CONTENT:

| Track | Scope | Owns |
|---|---|---|
| TUNE-MEADOW | Beat lab ratings, `beats.dps`, brute hit points per unit, sizes and `curveTrim` for levels 1 to 20, boss bite and hit points, bands | `balance.json`, `beats.json` numbers, levels 1 to 20 in `levels.json` |
| TUNE-FROST | The same for 21 to 40 on the armed hand, after TUNE-MEADOW's first checkpoint | levels 21 to 40 in `levels.json` |
| TESTS-BANDS | `balance.test.ts` bands and new metrics, `beats.test.ts`, level and wall test updates, goldens, `STAR_SHARE`, economy re-run | `src/sim/__tests__/**` except the bot tests, `harness.ts`, `beatLab.ts` and `levelDesign.test.ts`; `src/core/meta.ts` (the star share) |

The tech lead integrates: all checks, the smoke with two scripted levels and a
`?beat=` shot, the hero set, the hosted build, the simulator and a device
build, the log and the ledger.

Definition of done:

1. All 40 levels are scripts of the eight Phase 1 beats with the budgets in
   section 3.5; `levelDesign.test.ts` is green.
2. The bands in section 5 hold, measured on the priced greedy and the noisy
   human. Endless is untouched and keeps round 2's tests.
3. Every Phase 1 beat sits in its rating band at three sizes in the beat lab.
4. Peak live enemies at most 180 everywhere; busiest-scene frame time no
   worse than before on the desktop proxy; the owner's device report as the
   judge.
5. A player can open `?beat=ambush:3` and feel the beat in ten seconds.
6. Typecheck, lint, tests, smoke, preflight; log entry; ledger lines for the
   grammar, the bots' amendment to D45 and the new bands.

### Phase 2: set pieces and Endless

Four agents: SIM (beats X, S, Y, P, M, a three-charger cross tier for K, the
Endless composer), CONTENT (milestone set pieces replacing W4 and W5, Endless
beat tables), RENDER (the gauntlet's look, set-piece staging, a portal art
pass if the owner wants one), TUNE (campaign bands after the swap, Endless to
round 2's targets).

Definition of done: the milestone levels use X set pieces; Endless composes
beats with the rating schedule in 3.10 and holds round 2's targets; staff
gates come from the staff offer beat; all Phase 1 criteria still hold.

### Phase 3: the owner's loop

Two short rounds on the owner's device notes: re-tier beats, move scripts,
retune. Frame time certified on the phone in the busiest beats. The approved
bands written into the ledger. One or two agents per round.

## 7. Risks

- **The knife edge.** Road losses respond steeply to size (twice the hit
  points, four to six times the loss). Mitigated by tuning per beat in the
  lab, not per level, and by the loss bands per rating.
- **The ceiling moves.** Placing threats on the best line could make greedy
  lose. Greedy prices lanes now and must stay at 100 of 100; a beat it cannot
  clear at its reference size is a beat to fix, not a band to widen.
- **The bots define the difficulty.** A bot that reads an ambush better than a
  person makes the level look fair when it is not. The human's read limits
  (noise, `behindReach`) are the guard, and the owner's play is the judge.
- **Readability on a phone.** A block standing behind an arch may be hard to
  see at 390 px. The render track checks it first; if it fails, the ambush
  gets a silhouette through the panel.
- **Authored roads are fixed.** Forty scripts with a seeded lane shuffle give
  less variety on retry than dice. Retry already plays the same road, and
  Endless is where variety lives.
- **Economy coupling.** Different losses change retries and so coins. The
  campaign simulation is re-run and D46's cadence re-checked.
- **The cap.** Squads that hit 500 early make late multipliers meaningless;
  the curve keeps E under about 350 until the last two beats.
- **Scope.** Phase 1 changes every level at once. It is the only way the
  campaign reads as one game, and the beat lab and bands are the net.
- **Parallel edits.** Rounds 2 and 3 are still in the tree; Phase 1 waits for
  them.

## 8. The owner's answers (2026-09-17)

1. **How hard, and for whom?** Keep the reference player's 70 to 80 percent
   first-try clears on ordinary levels, move most of the losses onto the road
   (the count visibly drops two or three times a level and the boss takes
   less), and make the milestone levels (10, 15, 20, 25, 30, 35, 40) genuinely
   hard.
2. **Authored levels?** Yes: levels 1 to 40 are hand-written beat scripts,
   the same road every time, the seed only shuffling lanes. Endless stays the
   generated mode.
3. **One body, one soldier?** Not asked; the recommended default stands: D29's
   leak rule is kept in Phase 1 with fewer, 30 percent tougher bodies, and
   heavier runners come only if the beat lab says rivers are still soft.
4. **Bests and stars.** Every best and every star already earned is kept; the
   star threshold is lowered to match the new roads (about half the peak);
   the Endless best stays as it is.
5. **All 40 levels at once?** Yes, in Phase 1.
