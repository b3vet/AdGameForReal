# Milestone 6 plan, approved: a living crowd, and a game that can be lost

Status: approved by the product owner on 2026-09-13 with the answers below
folded in. Draft was document 17. Log is document 19.

## The owner's answers

| Question | Answer | What it means here |
|---|---|---|
| Squeeze through arches? | Yes, and: wizards that cannot get into a walled lane in time are **left out**, fight on their own for a bit, and rejoin the group after the wall ends if still alive. | Stragglers are a mechanic (D44): a slow lane change costs part of the crowd, not a clamp. |
| Enemies shove the crowd? | Yes. | Bodies and blocks push the units they touch before contact resolves. |
| Head 1:1 with the finger? | 1:1. | No ease at the head; the tail whips. |
| Difficulty target? | Softer than one loss in three; some levels are **milestones that cannot be completed without enough upgrades**. | Ordinary levels: human-bot first-attempt clear 70 to 80 percent. Milestone levels 5, 10, 15, 20: under 15 percent with no upgrades, about 60 percent with the upgrades the economy affords by then. |
| Economy target? | Yes, try it. | Upgrade every two runs early, every four by level 10, a loss pays 30 percent. |
| Anything else? | Roadmap after this is good. | Milestones 7 to 9 recorded below (D47). Device work stays parked. |

## Goals

1. Each wizard is an agent in the sim: it seeks its place, keeps its distance,
   slides along fences, funnels through arches, is shoved by enemies, and can
   be cut off from the column by a wall and fight alone until it can rejoin.
2. The head of the column is on the finger; the tail whips.
3. A decent human clears an ordinary level most of the time and cannot clear
   a milestone level without the upgrades the road has paid for.
4. No device work.

## The crowd, in detail

### Agent state (the contract both tracks build against)

Added to `src/sim/types.ts` by Phase A exactly as written, so the render
track can code against it before the sim lands:

```ts
/** Structure-of-arrays, capacity `squad.maxCount`, never compacted: a unit
 *  keeps its index for its whole life so render instances never swap. */
export interface CrowdState {
  capacity: number;
  /** 1 while the unit is alive; 0 frees the index for the next spawn. */
  alive: Uint8Array;
  x: Float64Array;
  z: Float64Array;
  vx: Float64Array;
  vz: Float64Array;
  /** 0 is the main column; n > 0 is straggler group n. */
  group: Uint8Array;
  /** The unit's slot in its group's formation (row-major, front first). */
  slot: Uint16Array;
  /** Bit flags this step: SHOVED 1, ON_FENCE 2, JUST_SPAWNED 4, REJOINING 8. */
  flags: Uint8Array;
}

export interface GroupState {
  id: number;
  count: number;
  /** The leader the group's slots hang from. Group 0's leader is the finger. */
  leaderX: number;
  z: number;
  /** The lane the group is confined to while a wall holds it, else null. */
  lane: Lane | null;
  /** Sim time the confining wall releases the group, else 0. */
  rejoinAt: number;
}

// RunState gains: crowd: CrowdState; groups: GroupState[] (index 0 is the
// main column). `squad.count` stays the total alive across groups and is
// maintained by the sim, so the plaque, gates and balance read as before.
```

### Forces and rules (Phase A)

- Per step, per live agent, in this order: seek its slot (a spring toward
  the slot's position under its group's leader; slots are the existing hex
  layout of that group's count); separation from neighbours within a soft
  radius through a spatial hash rebuilt each step from pooled integer arrays;
  fence contact (a unit whose next position crosses a fence line that holds
  at its z is stopped at the line with its lateral velocity zeroed, then the
  units behind push it along the fence); arch legs as short obstacles at gate
  rows so the column funnels through the opening; enemy shove (a body or
  block overlapping a unit pushes it back and sideways this step; contact
  and the kill resolve after the push, so the crowd visibly bows before it
  loses). Velocities are capped; positions are integrated at the fixed step.
- The main leader follows `targetX` through a stiff spring (about 30 rad/s,
  no acceleration cap, speed cap raised so a full-lane move takes under
  150 ms) and is bounded by the road only. Walls do not clamp the leader.
- Rows follow the row ahead (each slot's target is derived from the leader's
  position a few steps ago per row, kept as a short ring buffer of leader x),
  so a turn travels down the column and the tail whips.
- Firing lanes and contact read the agents' real positions.

### Stragglers (D44)

- When a wall starts to hold (its approach zone begins at the main group's
  z), every live main-group agent whose `x` is on the far side of the fence
  line becomes a straggler: a new group with a leader at the centre of the
  lane it is in, confined to that lane, walking at run speed with the column.
- A straggler group fires like any group, is shoved and contacted like any
  group, and resolves gates it walks through: the first group whose leader
  crosses a gate in the gate's lane resolves it, and `add`, `sub`, `mul` and
  `div` apply to that group's count (spawns join that group at its back;
  losses come from it); `fireRate` and `weapon` gates apply to the squad.
- When the wall releases (its end plus `walls.gateGap`), the group's agents
  are flagged REJOINING and seek slots at the back of the main column; the
  group dissolves when its last agent is within a slot's spacing of its
  target or dead. A straggler group that reaches the arena joins the fight
  where it stands.
- The greedy bot steers to avoid making stragglers; the human bot makes
  them when it is slow. The count on the plaque is the total.

### Drawing it (Phase B)

- Render draws `crowd.x/z` directly; the per-unit follow lag goes. Lean
  from `vx`, a stumble on SHOVED, a shoulder-bump and dust on ON_FENCE, a
  pop-in on JUST_SPAWNED, a scurry animation on REJOINING.
- The camera follows the finger target laterally (the road moves with the
  finger); depth framing as in document 16.
- Input maps the drag to the leader 1:1; sensitivity re-tuned so a lane is a
  short thumb move.
- Blob shadows sized for the agent spacing; the corpse ring reads agent
  deaths at their real positions.

## Difficulty (Phase C)

- A human-like bot beside the greedy one: reaction delay about 250 ms,
  swipe speed limit, lane choice right about seven times in ten, no
  lookahead past the next row, and it steers the leader like a thumb would.
- Bands on the human bot: ordinary levels first-attempt clear 70 to 80
  percent, survivors 25 to 50 percent of peak, boss 20 to 30 s; milestone
  levels 5, 10, 15 and 20 under 15 percent with no upgrades and about 60
  percent with the expected upgrade set at that level (from Phase D's
  campaign simulation). Greedy stays 100 of 100 everywhere. Levels 1 to 3
  generous (D31).
- Threats that punish a slow hand: `sub` and `div` curses that grow when
  not shot, brute blocks that must be dodged with the whole column, streams
  sized to the human bot's clear rate. Goldens re-captured.

## Economy (Phase D)

- `perSurvivor` down, `perClear` scaled by level, a loss pays about 30
  percent of a clear's coins. Prices follow a target: an upgrade every two
  runs on levels 1 to 5, every four by level 10; evolutions and wisp tiers
  are multi-run goals.
- A campaign simulation drives the human bot through the levels buying
  the cheapest useful upgrade whenever it can, and reports runs per
  purchase and the upgrade set held at each milestone level; that set is
  what Phase C tunes the milestone levels against.

## Definition of done

1. Agents: 500 agents at 60 Hz under 0.5 ms a step in `perf.test.ts`;
   a column driven into a fence jams and spills with no unit through the
   line; a column squeezes through an arch; a stream visibly shoves the
   front; stragglers are cut off, fight and rejoin; determinism test (two
   runs, same seed, identical positions at every step).
2. Feel: the head reaches a full-lane target within 150 ms; the tail
   arrives after it; the hero set has a whip frame. Owner's read: "they
   move on their own".
3. Challenge and economy bands as above, measured; goldens re-captured.
4. All checks, smoke, hero set, hosted build republished, log, ledger.

## Team plan

| Phase | Agent | Scope | Owns | Depends on |
|---|---|---|---|---|
| A | sim agents | CrowdState, groups, forces, leader, chain, stragglers, gates per group, firing and contact from agents, determinism and perf tests | `src/sim/**` except the bot files; `src/data/balance.json` except `bots`; `src/data/types.ts` | none |
| C1 | human bot | The human-like bot and its harness | `src/sim/bots.ts`, `botScore.ts`, `botStand.ts`, `bots.test.ts`; the `bots` block of `balance.json` | none |
| D | economy | Rewards, prices, campaign simulation | `src/data/progression.json`, `src/sim/player.ts`, `src/core/academy.ts`, `src/ui/rooms.ts` prices, `economy.test.ts` | none |
| B | render | Agent drawing, stumble, bump, dust, rejoin, camera on the finger, input mapping, shadows, corpses | `src/render/squad*.ts`, `crowdLook.ts`, `camera.ts`, `cameraLook.ts`, `src/core/input.ts`, `controls.ts`, `stress*.ts` | A |
| C2 | balance | Bands on the human bot, threats, milestone levels, goldens | `src/data/balance.json`, `levels.json`, sim gate and stream tuning code | A, C1, D |
| E | integration and review | Wire, hero set, review, builds | all | B, C2 |

## Roadmap after Milestone 6 (D47)

| Milestone | Theme |
|---|---|
| 7 | Content: a second biome (road, sky, props, palette roles), two new enemy kinds (a charger that shoves through the column, a shielded brute), a second boss, levels 21 to 40. |
| 8 | Meta and hooks: missions, streaks, bestiary rewards, an endless mode, a deeper evolution tree, wisp cosmetics. Still no monetization (D6). |
| 9 | Device and store readiness: Capacitor shell on the phone, icons and splash, haptics on device, TestFlight, performance certified on the owner's phone. |
