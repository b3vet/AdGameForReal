# Milestone 4 plan, draft v1: walls, progression, and a device build

Author: tech lead. Status: DRAFT awaiting product owner answers. The final
plan will be `12-milestone-4-plan.md`.

## Where we are

The loop is fun, the look is right, and the phone runs it at 60 fps. What
the game lacks now is a reason to come back and more ways to be challenged:
every run starts from the same squad, nothing carries over, and the road
has one trick. Milestone 4 adds depth in three tracks that can run in
parallel, plus the polish the last playtest asked for.

## Track 1: walls and level variety (product owner request)

- **Lane walls.** A wall segment sits on a lane boundary (x = −1 or +1)
  for a stretch of road. The squad cannot cross it; a squad straddling the
  boundary when the wall begins is pushed to the side its center is on.
  Walls commit you to a lane before you can see what is behind the next
  gate row, which is the difficulty. Projectiles fly over them (low walls),
  streams ignore them.
- Generator: from level 4, some gate rows are preceded by a wall stretch
  of 10 to 20 m on one or both boundaries; hordes behind walls become the
  hard version of a row. Bots plan around walls (greedy picks the lane
  before the wall from what it can see). Balance bands hold.
- Render: rune-stone fence pieces on the boundary, thin-instanced, with a
  glowing top edge, readable from the camera.
- Level count 10 → 20 with the same curve stretched, so walls have room to
  appear; the level picker grows a second page.

## Track 2: progression (the retention layer, D7 from the concept)

The Academy stays light and offline, no monetization. Coins only.

- **Coins** earned per run: survivors plus a clear bonus, shown on the
  result screen with a count-up.
- **Training yard**: permanent upgrades bought with coins, each with a
  visible level and a rising price: damage, fire rate, starting squad,
  gate bonus, boss damage. The sim reads them as multipliers from a
  `PlayerState` the app passes into `generateLevel` and `Run`.
- **Workbench**: staff unlocks and one evolution tier each (Ember 2 burns,
  Storm 2 chains once more, Frost 2 shatters into shards that damage
  neighbors), bought with coins, chosen before a run.
- **Home screen** becomes the Academy: the dressed road stays as the
  backdrop, with three cards (Play, Yard, Workbench) and the coin total.
  Rooms unlock at levels 1, 3 and 6 with a short reveal.
- Save schema versioned (`arcane-rush.save.v2`) with migration from v1.
- Balance: the per-level bands are defined for a player with no upgrades;
  upgrades let a player push past the level they are stuck on. A test
  asserts that with the upgrades a level-N clear affords, level N+3 becomes
  clearable by the greedy bot.

## Track 3: device build (needs the product owner's Mac)

- Capacitor config, `npm run cap:sync`, and a written step list for
  `npx cap open ios`, signing, and running on the phone. The web build is
  unchanged; the wrapper gives a full-screen app with the status bar hidden,
  haptics on boss stomps and kills (Capacitor Haptics plugin), and a home
  icon.
- What only the device build can answer: touch latency versus Safari,
  thermal over a long session, and whether 120 Hz is worth enabling.

## Polish and spikes

- Walking animation glitch near the camera at run start: fix in progress
  as a post-close task; the candidates are frame stepping of the 30 fps
  bake when the units are large on screen, the instant idle-to-run switch,
  and the speed jitter wrapping a body's time offset.
- Remaining long frames (minimum 31 fps): add a frames-over-20-ms counter
  to the capture and find the source; suspects are audio decode on first
  play of a clip, the capture's own string building, and the ragdoll
  spawn burst on a horde.
- Deferred from Milestone 3: the grunt pool ceiling, aim assist filing
  bodies in three lanes, the crowd-width question.

## Definition of done (draft)

1. Walls in the generator from level 4, bots aware, balance bands hold,
   20 levels, walls readable in frames.
2. Coins, yard, workbench and the Academy home working end to end with a
   versioned save; the upgrade-affordance test passes.
3. Capacitor project files and instructions in the repo; product owner
   runs the app on the phone from Xcode.
4. Walking glitch gone in a close-camera frame sequence; frames over 20 ms
   per 10 s under 3 on the product owner's capture.
5. All checks, both offline builds under budget, docs and ledger.

## Team plan (draft)

| Phase | Agent | Scope | Depends on |
|---|---|---|---|
| P | polish | Walk glitch diagnosis and fix; spike counter in the capture | none (started) |
| B1 | sim | Walls, 20 levels, `PlayerState` multipliers, staff evolutions, tests | none |
| B2 | render | Wall meshes, Academy backdrop tweaks, evolution effects | B1 for wall data |
| B3 | app and ui | Coins, yard, workbench, Academy home, save v2, result count-up | B1 for PlayerState |
| B4 | device | Capacitor config, plugins, step list | none |
| C | integration | Wire, tune, builds, product owner device run | B |
| D | review | Independent review and fixes | C |

## Questions for the product owner

1. Order: all three tracks in one milestone as drafted, or progression
   first and walls plus the device build after? My recommendation is all
   three in parallel; they touch different code.
2. Walls: low walls that projectiles fly over (my recommendation), or full
   walls that also block shots into the walled lane?
3. Progression: coins only with the five yard upgrades and one evolution
   per staff as the first cut, or do you want familiars and the bestiary
   in this milestone too? My recommendation is the first cut now.
4. Device build: do you want to run the Xcode steps yourself with my
   written guide, or defer the device track?
