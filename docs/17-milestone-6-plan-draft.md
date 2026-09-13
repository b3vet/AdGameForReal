# Milestone 6 plan, draft v1: a living crowd, and a game that can be lost

Status: draft, awaiting the product owner's answers to the questions at the
end. The approved plan will be document 18. Written after the owner's read of
the lane-column build (Version 14).

## The feedback, and what the code is doing

| Owner said | What is actually happening |
|---|---|
| The wizards do not feel like they move on their own, each one | They do not. Every drawn unit is a *slot* in a rigid hex grid that the sim lays out per count; the render moves each unit toward its slot through a one-pole lag by depth. Nothing a unit does depends on any other unit: no pushing, no gaps closing, no stumble. |
| They do not interact with each other or the environment, the walls especially | Walls act on one number, the squad's anchor `x` (`clampToWalls` in `steering.ts`). The whole column stops against a fence as one block. Enemies are contacted at the front row only. Arch legs, kerbs, corpses and bodies are pictures. |
| Movement is not responsive, especially with a big horde | Three lags stack. The anchor is a critically damped spring (12 rad/s) under an acceleration cap of 40 m/s² and a speed cap of 8 m/s, so a full swipe takes about 0.75 s and the first 0.2 s is spent reaching speed. Each drawn unit lags its slot again (38 ms at the front, 125 ms at the tail). The camera lags the crowd through its own spring, so on screen the crowd appears to move after the finger *and* the road appears to move after the crowd. With 500 units the eye reads the column's centroid, which trails by the tail's lag, and the front rank is 32 px tall so the head's early motion is not what the eye sees. |
| Levels are way too easy; money is easy | The bands are measured with a *greedy* bot that reacts in one sim step with perfect lane choice, and the bands are set so that bot keeps 56 to 76 percent of its peak and never loses. A human is slower and worse and still clears, which means the road is not threatening anyone. Economy: level 5 cleared first time with 300 survivors pays 300 + 125 + 500 = 925 coins; an upgrade's tenth level costs about 740; two runs buy several upgrades. Survivor coins reward exactly the easy runs. |

## Goals

1. Each wizard is an agent. The crowd is a physical thing: it jams against a
   fence and spills along it, squeezes through an arch, gets shoved by
   enemies, closes gaps, and its motion is what the player sees, not a grid.
2. The head of the column goes where the finger goes, now. The tail whips.
3. A decent human loses a fresh level about one time in three from level 4
   and clears it on the retry. Money buys an upgrade every couple of runs
   early and every four or so by level 10.
4. No Capacitor work this milestone (owner is holding device testing).

## Scope

### A. Crowd agents (sim)

- Every unit is an agent with position and velocity in the sim, deterministic
  at the fixed step, pooled, a spatial hash for neighbours (500 agents at
  about ten neighbours each is a few thousand pair tests per step, well inside
  budget; measured in `perf.test.ts`).
- Forces, in this order: seek the slot behind the leader (the slot grid stays
  as the *intent*, so counts, gates and the plaque are unchanged); separation
  from neighbours (soft radius, so units overlap under pressure and spring
  apart after); fence contact per unit (a unit slides along a wall and is
  pushed off it by the ones behind, so a column driven into a fence jams and
  spills forward along it rather than stopping as a block); arch legs as
  obstacles (the column funnels through the opening); enemy shove (a stream
  body or block pushes the units it touches back and sideways before contact
  resolves).
- The leader follows the finger with a stiff spring (about 30 rad/s, speed
  cap raised, acceleration cap removed) and the walls no longer clamp it; the
  agents' fence contact is what stops the crowd, and the leader is bounded
  only by the road. Rows follow the row ahead rather than the leader directly
  (a chain), which is what makes the tail whip and a turn travel.
- Firing lanes come from the agents' real `x`. Contact uses the agents'
  real positions, front or flank. Everything stays deterministic and tested.

### B. Drawing agents (render and input)

- The render draws agent positions directly; the per-unit follow lag goes
  (the agents already move individually). Lean comes from agent velocity,
  a stumble from a shove, a shoulder-bump on a fence, dust at a jam.
- The camera follows the *finger target* laterally, not the crowd, so the
  road moves with the finger and the crowd's response reads against it.
- Input: the drag maps to the leader 1:1 (sensitivity re-tuned); no ease.
- Blob shadows sized for the agent spacing; corpses left where agents fall.

### C. A game that can be lost (sim balance)

- A human-like bot next to the greedy one: reaction delay (about 250 ms),
  a swipe speed limit, a lane choice that is right about seven times in ten,
  and no lookahead past the next row. The bands are set on *this* bot:
  first-attempt clear about 65 percent from level 4, survivors 20 to 45
  percent, boss fights 20 to 30 s that are lost about as often as the road
  is. Levels 1 to 3 stay generous (D31).
- Threats that punish a slow hand: curses that grow when not shot (`sub`
  and `mul` on the enemy side), brute blocks that must be dodged with the
  whole column, streams sized to the human bot's clear rate not the greedy
  one's. Each retune is measured, and the greedy bot must still win 100 of
  100 so the levels remain fair.

### D. Economy

- Rewards move from survivors to clears: `perSurvivor` down, `perClear`
  scaled by level difficulty, a lost run pays a fraction (about 30 percent)
  so a loss is not a wasted minute. Prices follow a target curve: an
  upgrade every two runs on levels 1 to 5, every four by level 10, the
  staff evolutions and wisp tiers as multi-run goals. Measured as "runs per
  purchase" by simulating a human-bot campaign through the Academy.

## Definition of done

1. Agents: 500 agents at 60 Hz under 0.5 ms a step in `perf.test.ts`; a
   column driven into a fence jams and spills with no unit through the line;
   a column squeezes through an arch; a stream shoves the front; determinism
   test (two runs, same seed, identical positions at every step).
2. Feel: the head reaches a full-lane target within 150 ms of the finger;
   the tail arrives after it; a swipe at 500 units reads as a whip in the
   hero set. The owner's read: "they move on their own".
3. Challenge: human-bot first-attempt clear 55 to 75 percent from level 4,
   greedy 100 of 100, survivors and boss bands as above, goldens re-captured.
4. Economy: runs per purchase within the target curve on a simulated campaign.
5. All checks, smoke, hero set, hosted build, docs, ledger.

## Team plan

| Phase | Agent | Scope | Depends on |
|---|---|---|---|
| A | sim agents | Agent model, spatial hash, forces, leader, firing and contact from agents, determinism and perf tests | none |
| C | sim balance | Human bot, bands, threats, goldens | none for the bot; the retune waits on A |
| D | economy | Rewards, prices, campaign simulation | none |
| B | render | Agent drawing, stumble and bump, camera on the finger, input mapping, shadows | A's state shape (agreed up front) |
| E | integration and review | Wire, hero set, review, builds | all |

## Questions for the product owner

1. Should the crowd squeeze through an arch (the column narrows to the
   opening and widens after, as the ad crowds do) or walk through the legs
   as it does now? I recommend squeeze.
2. Should enemies physically shove the crowd (units knocked back, a stumble,
   the column bowing under a block) before they kill? I recommend yes; it is
   most of "interacting with the environment".
3. Responsiveness: head follows the finger 1:1 with no ease, tail whips? Or
   keep a little ease at the head? I recommend 1:1.
4. Difficulty target: losing a fresh level about one time in three from
   level 4 and clearing on the retry. Harder or softer than that?
5. Economy target: an upgrade every two runs early, every four by level 10,
   a lost run pays 30 percent. Agree?
6. Anything else for this milestone? Kept deliberately to feel, challenge
   and money; content (a second biome, new enemies, more levels) and meta
   hooks (missions, streaks) are the milestones after.
