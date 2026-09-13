# Lane-column formation (correction to Milestone 5 Phase B)

Status: approved by the product owner on 2026-09-13 ("Let's fix this first
and then I will start testing"). Supersedes the formation half of D37.

## What was misread

The Milestone 4 feedback said the horde "needs to be more linear
line-filling rather than being circular". Milestone 5 Phase B read that as a
*horizontal* line: staggered rows across the whole road, 4.4 m wide and 7 m
deep at 500 units. The product owner meant a *vertical* line: the crowd fills
a single lane and grows backward as a column, the way the ad crowds do — which
is the only shape that makes sense once walls separate the lanes, because a
crowd one lane wide is a crowd that is *in* a lane.

## Design

- The crowd is one lane wide. Its band is the lane width less a small inset
  each side (`formation.laneInset`, new), never the road; under a wall the
  band is the same lane, held off the fence by `walls.margin` plus the
  outermost unit's own offset, so no unit stands through a fence and the
  column still fills the lane rather than squeezing to 1.2 m.
- Rows stay hex-packed and the count grows the column backward. Spacing still
  falls with the square root of the count so the front ranks read as
  individuals at a handful and as a packed mass at hundreds; the floor is
  tuned so 500 units stand about 12 to 14 m deep, not 20.
- The lateral clamp follows: with a lane-wide crowd the centre can reach the
  side lanes' centres (±2 m), so a side gate is reachable with the whole
  crowd inside its lane, and the spring holds the centre at the lane's
  centre under a wall.
- Fire concentrates: every unit's shot lane comes out of its formation slot,
  so a one-lane crowd hits one gate and one lane of enemies. That is the ad
  mechanic (you choose a lane), and it reverses the reason Phase B cut
  `dpsTrim` 0.38 → 0.26 and `weaponWorth` 0.8 → 0.5, so the bands are
  re-measured and those numbers re-tuned against D20's targets rather than
  carried over.
- Camera: the depth pull-back is capped low so the rig frames the *front* of
  the column at a readable size and the tail runs off the bottom of the
  frame; the count on the plaque says the rest. The pull-back caps are
  re-derived from the new depth curve, not kept at 8.4 m.
- Unit motion: the per-row follow lag extends over more rows so a turn
  ripples down the column like a snake rather than the front ten rows
  turning and the rest sliding as a block; the leash still covers turbo.

## Definition of done

1. Sim: the crowd's half width never exceeds half a lane (less the inset) on
   the open road or under a wall; depth at 500 is in the 12 to 14 m band;
   side-lane gates are reachable; no unit through a fence; bands and the
   greedy bot pass at the re-tuned numbers; goldens re-captured with the
   reason; formation, walls and bots tests updated.
2. Render: at 500 units the front rank is no smaller on screen than 70% of
   its size at 50; the column's front 6 m are in frame; the stress scene
   still frames its crowd; the hero set is re-shot.
3. All checks and the smoke; hosted build republished; log entry and ledger.

## Team plan

| Track | Agent | Scope | Owns |
|---|---|---|---|
| S | sim | Lane band, wall keep-off, clamp, spacing floor, balance re-measure, tests, goldens | `src/sim/**`, `src/data/balance.json`, `src/data/types.ts` if a key is added |
| R | render | Camera pull-back caps and framing, flock lag over the column, stress scene framing | `src/render/squad.ts`, `squadFlock.ts`, `crowdLook.ts`, `camera.ts`, `cameraLook.ts`, `src/core/stress.ts`, `stressBodies.ts` |

The two tracks meet at the sim's formation API (`formationOffsets`,
`formationDepth`, `halfWidth`), which does not change shape. The tech lead
integrates, runs the smoke, reviews the hero set, commits and republishes.
