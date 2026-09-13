# Milestone 6 log (append-only)

## 2026-09-13 — Kickoff

- Product owner answered the six draft questions (document 18): squeeze
  through arches plus stragglers who fight alone and rejoin; enemies shove;
  head 1:1; softer difficulty with milestone levels that need upgrades; the
  economy curve as proposed; roadmap accepted. Instruction: document
  everything, then do not stop until the milestone is complete.
- Tech lead pinned the agent-state contract in the plan so the render track
  can build against it before the sim lands, and launched wave one in
  parallel: A (sim agents), C1 (human bot), D (economy). Wave two (B render,
  C2 balance) follows A; E integrates.

## 2026-09-13 — Wave one: sim agents, human bot, economy (verified and committed)

- Phase A, crowd agents: `CrowdState` and `GroupState` as pinned in the
  plan (optional on `RunState` because two render-side fixtures build a
  state by hand). Eight new sim files: state and free list, forces in three
  passes (advance: seek, separation, shove, caps; press: body projection;
  confine: fences and arch legs), obstacles gathered once a step from the
  crowd's box, an integer spatial hash with a counting sort, the leader and
  its pooled trail ring, stragglers, and per-group row crossings that claim
  gates. `steering.ts` is gone; the head is a 30 rad/s spring with a 24 m/s
  cap (inside the target lane in 50 ms, on its centre by 0.6 s) bounded by
  the road only; rows read the leader 0.45 steps per row behind, so the
  tail of a 500 column settles 0.57 s after the head. Every count change
  goes through the crowd (gates per group spawn at the back or kill off the
  tail; leaks, blocks and stomps kill the nearest units); how many die is
  still the leader-and-half-width rule, so the shove changes where, not how
  many. 500 agents cost 0.24 ms a step, 0.47 ms with 300 bodies and a fence
  jam. Determinism, jam, funnel, shove, straggler and gap-closing tests;
  goldens re-captured. Deviations: the cut fires once, when a wall starts
  to hold; constraints run after the shove so no unit is ever pushed
  through a fence; the boss does not shove yet; a heavily leaked column's
  front can sit up to 1.7 m behind the anchor while tail units walk into
  freed slots.
- Phase C1, the human bot: `createBot('human')` with a 250 ms reaction
  ring, a 6 m/s thumb, lane accuracy 0.7 rolled once per row (the miss
  takes the second-best lane), and a 3 m wall reach so late crossings make
  stragglers. Greedy now arrives a full keep-off inside its lane before a
  wall's approach zone and commits once per fence: 0 of 102 stretches
  straddled (was 29), still 100 of 100. Shared lane arithmetic moved to
  `botLanes.ts`; `bots.ts` 321 → 185. Provisional human-bot numbers before
  the retune: 22 of 50 first-attempt clears on levels 1 to 10, and an
  ablation showing lane accuracy is the whole of the difficulty today.
- Phase D, economy: rewards from clears (`perSurvivor` 1 → 0.1, `perClear`
  and `firstClear` 140 × level^0.3, a loss pays 0.3 × road fraction of a
  repeat clear), prices re-derived (`baseCost` 50 → 900, `costGrowth` 1.35
  → 1.6, staffs 400/450, evolutions 3800 to 4500, wisp 3800/4800/5600).
  A campaign simulation (`campaign.ts`, human and greedy bots, retries with
  a re-rolled level) measures 2.07 runs per purchase on levels 1 to 5 and
  4.28 by 6 to 10 for the human bot; the upgrade set held at level 5 is one
  start-count rung plus Storm, at 10 four first rungs plus both staffs, at
  20 mostly second rungs. Finding: the rise from two to four runs cannot
  come from prices alone while a bot never loses (five tracks priced per
  track), so level pay is sub-linear and the rise comes from losses; a
  linear pay would need a global price ladder, which is a Yard redesign.
  Yard rung 10 now costs 62k, so `maxLevel` 10 is decorative.
- Combined tree: typecheck 0 errors, lint clean, 363 tests, build OK.
- Carried to Phase E: `?bot=human` in `query.ts`; smoke scripts inject
  2400 coins (raise to about 6000 for the Yard shot); the result sheet
  skips the coin roll on a loss, which now pays; `dev-fixture.ts` and
  `stress.ts` should use `createCrowdState`; the boss shove is two lines
  in the obstacle gatherer; `bots.test.ts` is 534 lines; `campaign.ts`
  mirrors the purchase rules in `src/core/player.ts`.
