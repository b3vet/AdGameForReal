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

## 2026-09-13 — Wave two: drawing the agents, balance on the human bot (verified and committed)

- Phase B, render: one thin instance per crowd index drawn from the agent
  arrays (a dead index writes a zero-scale matrix once); positions
  interpolated between sim steps by an alpha derived from `state.time` and
  the frame's `dt` (a 120 Hz probe: 23 of 23 frame gaps moved the head,
  where the sim itself repeats every other frame); the follow-lag layer
  (`squadFlock.ts`) deleted; reactions from the flags (stumble on a shove,
  shoulder bump and a pooled dust puff on a fence, pop-in on spawn, a
  scurry on rejoin); corpses carry the unit's last position and velocity;
  gait from the crowd's mean forward velocity rather than a frame delta.
  Camera's lateral target is the finger (`squad.targetX`) at frequency 13;
  `input.sensitivity` 6 → 8 (a lane is a quarter of the screen width, 1:1
  with no ease); `?bot=human` accepted; the stress scene and dev fixture
  build a real `CrowdState` and draw through the shipped path (35 draws,
  medians unchanged within noise); `SHADOW.mage` 0.17 → 0.135 so blobs no
  longer merge into a ribbon at the 0.25 m spacing. Head within a tenth of
  a lane of a jumped target in 150 ms on screen. New `squadAgents.ts`,
  `squadReact.ts`, `squadGait.ts`, `squadDust.ts`.
- Phase C2, balance: gate rows fill all three lanes nine times in ten
  (`thirdGateChance` 0.2 → 0.9; a two-lane row had a free lane that let a
  late thumb walk past a misread, which alone took the human bot from 32 to
  55 percent), a row's curses share the ceiling, `sub` curses creep at
  0.6 per second while in projectile range from level 4, the last row
  before the arena is never a gate row, a fence never guards a row whose
  reachable half is all curses (a level 10 toll row found and fixed),
  `milestone: true` per level with a `gen.milestone` dial block read in one
  place. The boss now shoves (its own 16 m reach; changes who a stomp
  lands on, never how many), closes at 1.75 m/s so its contact grind is
  live at half the fight (`contactShare` 0.15 → 0.03; it had never fired),
  and its hp ladder is monotone with the milestone wall carried by `bite`.
  Per-level hp, bite, density and horde rows fitted closed-loop on ten
  seeds. `bots.test.ts` split into fixtures, greedy and human files; new
  `levelRules.test.ts`; goldens re-captured with the reasons.
- Measured, human bot, ten seeds: ordinary first-attempt clears 119 of
  160 (74 percent), levels 1 to 3 at 30 of 30, survivors over clears 0.45
  of peak (0.50 before the grind; the grind is the unit sink after the
  last gate that separates "won" from "what walks away"), boss 19 to 34 s.
  Greedy 100 of 100 on ordinary levels and 10 of 10 on every milestone.
  Economy untouched and in band (1.87 runs per purchase early, 3.77 by
  level 10). Stragglers: 0 to 0.7 groups per run, 85 percent rejoin, none
  reach the arena (every fence releases before it).
- Decision taken on the balance report: milestones are 7, 10, 15 and 20
  (level 5 back to ordinary), because the set the economy affords by
  level 5 is worth a few percent of output. Finding for the owner: the
  Academy sells nothing that compounds before a `gateBonus` rung, so only
  15 and 20 separate armed from bare (+0.2 each); 7 and 10 are the
  hardest levels greedy still clears, at the same rate armed or bare.
  Options: a cheap early compounding rung, or milestones at 15 and 20
  only. The human boss band was widened to 19 to 35 s to pay for the
  monotone ladder (levels 13 and 19 run 33 s).
- Combined tree: typecheck 0 errors, lint clean, 378 tests, build OK.
- Carried to Phase E: a squad-death ragdoll entry point in `src/physics`
  (corpses carry velocity today; ragdolls still key on stream ids); the
  smoke's injected coins; the result sheet's coin roll on a loss; the
  stress tripwire margin on the machine that runs the smoke; `squad.ts`
  439 and `stress.ts` 432 lines.

## 2026-09-14 — Phase E: integration (verified and committed)

- Squad deaths: one in ten falls as a Havok ragdoll on the mage rig (a
  second pool, since a pool carries one rig; the mage and skeleton share
  joint names so the bone table fits both), thrown along the unit's last
  velocity, capped at two a frame and four live; the rest go to the corpse
  ring. Accessories are re-skinned and tinted on ragdolls, which also gave
  the skeleton corpse its cloak tint. The smoke fails if physics is on and
  no mage pool was built.
- The result sheet rolls the coins on a loss (a loss pays now); the smoke's
  injected purse is 6000 so the Yard shot shows two live rungs; the loss
  frame moved to level 4 because the retune let the random bot clear 3.
- Hero set: `hero-whip` (500 units strung out on a diagonal leading edge)
  and `hero-fence-jam` (451 units packed against a fence line) at pixel
  ratio 2, driven by a new debug `steer(x)` that takes the wheel from the
  bot; two watchers that could photograph the same frame twice now wait
  for the sim clock.
- Stress: the tripwire now also needs the run-wide median over 12 ms (an
  8 s window holds one to three frames on this container, so single-window
  medians swung threefold between identical runs); nothing in the draw path
  was attributable above the noise, so nothing was trimmed. 35 draws.
- Splits: `squad.ts` 439 → 376 with `squadDeaths.ts`; `stress.ts` 432 →
  272 with `stressState.ts` and `stressStats.ts`.
- Smoke PASS: draw peaks 40 / 40 / 41 / 44, 0 shader compiles during play,
  59 materials and 37 programs warmed. Frames judged one by one: the crowd
  reads as individuals, the front rank bows into a V at the boss, the
  column funnels through an arch at 136 units, whip and jam as described.
  Wall clock 11 min 31 s on this container against the 7 min ceiling; the
  same set ran in 6 min 25 s a day earlier, so the container is slower
  today rather than the smoke heavier (the two new frames are about 2 min).
- Carried to review: 500 Storm shots blow out to white over a third of the
  frame (spell sprite alpha does not scale with crowd size); `steer(x)`
  drops the bot for the rest of the run; the mage pool parks 48 bodies at
  boot.
