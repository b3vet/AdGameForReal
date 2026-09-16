# Playtest round 3: the charge that does not hurt, the picker, and level design

Status: requested by the product owner on 2026-09-16, while round 2
(document 28) was still being integrated ("While the first wave is being
handled, let's go with the 2nd wave of feedback by me ... Let's work on these
in parallel, too."). Log entries go in document 26. Still no ads, no IAP, no
analytics (D6).

## The owner's notes, as given

1. "Rime fiend's run animation is not hurting my wizards at all, it is just
   running on to my guys and not damaging at all, its bizarre and should have
   dealt damage with those runs."
2. "We need to seriously think about level design and hardness, the gates,
   multiplier count per level, the decreasing gates, the lanes that fixes the
   horde's path should have be hurtful sometimes and it should make me think on
   which path to choose, the enemies are always way too close to us but they are
   always too weak, it is never a challenge, it should have been. Their spawn
   points and run start points are random at the moment, but we could increase
   the quality of the gameplay if we actually consider the gates they spawn
   behind or front, etc. I want you to utilize the game-expert agent to get a
   plan on how to implement such improvements regarding the level design and
   gameplay. This should be a big improvement to the game."
3. "The level selector should always auto select the latest unlocked level,
   sometimes it gets stuck on the previous level when I go back to main menu
   instead of continueing in the end run screen."

## What happens with each

- Note 1 is a defect. The Rime Fiend's lane charge (D49) already has a kill
  count in `src/sim/boss.ts` and `src/sim/bossCharge.ts`; what the owner sees
  is a charge that visibly runs into the column and kills nobody. Wanted: the
  cause, and a charge whose damage matches what it is seen to do, with the
  owner's words as the test (a charge that reaches the column hurts it).
  Decided here: a charge that runs through the squad's lane kills the units it
  passes through, up to a cap in data, and the player can still dodge it by
  leaving the lane before it arrives (D49's point was a charge to dodge).
- Note 3 is a defect. Decided here: the picker opens on the highest unlocked
  level every time it opens, whichever way the player reached it; tapping a
  chip still selects that level for the next Play.
- Note 2 is a redesign. The game-expert agent writes a draft plan grounded in
  the code and in bot measurements: document 30, a draft. The owner approves
  it before anything is built; it is not implemented from this document.

## Team plan (inside D56)

Round 2's PERF agent is still running. Beside it:

- FIX-CHARGE: note 1 (`src/sim`, and the renderer only if the look and the
  rule disagree).
- FIX-PICKER: note 3 (`src/ui/picker.ts`, `src/core`).
- DESIGN (game-expert): note 2, the draft plan, document 30. Writes no game
  code.

Round 2's work is uncommitted and in the same tree; these agents build on it.
The tech lead integrates rounds 2 and 3's fixes together, runs the checks, the
smoke and the simulator, and commits.

## Definition of done

1. A Rime Fiend charge that reaches the squad's lane kills units, visibly and
   in a sim test; a squad that left the lane in time is untouched.
2. The picker opens on the highest unlocked level after a clear left by Home,
   by Continue, by Retry, and after a loss.
3. Document 30 exists as a draft for the owner with measurements, a design,
   phases inside D56, and the questions only the owner can answer.
