# Playtest round 2: the owner's notes from the device

Status: requested by the product owner on 2026-09-16 while playing the
build from document 27 on their iPhone 17 Pro Max ("Let's address these
issues while I keep playing. I will share more feedbacks as I see them.").
More notes will follow; each later round gets its own document. Log entries
go in document 26. Still no ads, no IAP, no analytics (D6).

## The owner's notes, as given

1. "Same road again" and "Again" on the result sheet do the same thing.
2. A pressed button gets shorter and the whole UI moves with it.
3. Play in the level picker is not striking enough; a new player goes to
   Endless first.
4. Endless is far too easy: bosses at set points, harder enemy batches.
5. Better on the phone but still under 60 fps on average; the smooth casual
   look must hold all the time.
6. "Ascend" at the end of a level is confusing; call it Continue.
7. A gate row can be collected twice; only one gate per row.
8. The result sheet is cramped and scrolls, with space unused at the top: no
   scrolling. No "Purse" line; a small coin display in a fixed top corner
   that stays on the other screens too.
9. No next-thing-to-buy row on the result sheet.
10. No visible scroll bars anywhere.
11. The Bonuses section on the result sheet stays.
12. The streak button on the home is rounded inside a square frame; every
    other element is sharp-cornered, so it should be too.

## Decisions taken here on the owner's behalf

The owner may change any of them.

- Result sheet: one replay button. On a campaign level it is Retry; on an
  Endless run, where the two did differ (same seed or a fresh one), the
  labels say which: "Same road" and "New road". Continue is the primary
  button after a clear; Home replaces Academy, as on the pause menu.
- The coin chip is the Academy's existing one, moved to a fixed spot (top
  left, under the safe area) on every screen that is not a run: the home,
  the picker, every room and the result sheet. It is not on the run HUD,
  where the level chip has that corner. On the result sheet it counts up
  with the coins, as the purse line did.
- The picker leads with Play: the largest, brightest control, directly
  under the level grid. Endless moves below it as a quieter card, and is
  locked until the player reaches level 3, like the Bestiary and the
  Wardrobe ("Reach level 3"). A save already past level 3 is unaffected.
- Sharp corners everywhere, not only on the streak button: every pill and
  badge (range tabs, "First clear", "New best", bonus rows) becomes a
  rectangle. Round icon buttons (sound, pause) stay round.
- One gate per row for the whole run: the first gate any group takes claims
  the row, and the rest of that row goes dark for every group, stragglers
  included. This supersedes the per-group half of D44.
- Endless gets bosses at fixed distances, the two bosses alternating with
  rising HP, and enemy batches that keep climbing; tuned on the bots so a
  good human-like player dies somewhere between the second and fourth boss
  and the greedy bot does not walk forever. Pay stays by distance (D52).
- Performance target: 60 fps average and a p95 frame under 20 ms on the
  owner's phone in the busiest fights, without a visible drop in the look.

## Team plan (four agents, one slot kept for the owner's next notes; D56)

- UI-1, result sheet and coin chip: notes 1, 6, 8, 9, 11.
- UI-2, feel and picker: notes 2, 3, 10, 12.
- SIM, rules then Endless: note 7 first, then note 4 on top of it.
- PERF: note 5.

Agents build to their own directories; only the tech lead writes `dist/`
and `ios/`, runs the full smoke and the simulator, and commits.

## Definition of done

1. The result sheet fits a 390×844 and a 440×956 screen with no scrolling,
   with one replay button, Continue and Home, and the Bonuses section.
2. The coin chip sits in the same place on every non-run screen.
3. No button changes size when pressed; nothing on screen moves around it.
4. No scroll bar is visible anywhere; nothing rounded but the round icon
   buttons.
5. A first-time player's eye lands on Play; Endless is locked until level 3.
6. A gate row applies once per run, with a test for the straggler case.
7. Endless has bosses and a measured difficulty curve; the campaign's
   bands (D45, D55) still hold with the new gate rule.
8. Frame time measured before and after on the busiest scenes, with the
   owner's device report as the judge once it arrives.
9. Typecheck, lint, tests, smoke and preflight pass; the simulator shows
   the new screens.
