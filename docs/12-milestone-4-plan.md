# Milestone 4 plan: walls, progression, familiar, device build

Author: tech lead. Status: approved by product owner on 2026-09-13 ("as
much as we can do in a single milestone"). Supersedes
`11-milestone-4-plan-draft.md`. Immutable.

## Decisions folded in

- All three tracks run in one milestone, in parallel where the code allows.
- Walls are low: the squad cannot cross them, shots fly over them, streams
  ignore them.
- Progression at full scope for a first version: coins, the training yard,
  the workbench with one evolution per staff, a familiar, and the bestiary.
  No monetization; coins only.
- The device track prepares everything on the web side; the product owner
  runs the Xcode steps on the Mac from a written guide.
- Polish: the walking glitch (task P, in progress) and a spike counter.

## Contracts (so the tracks can build in parallel)

### Player state (sim reads it, app owns and saves it)

```
PlayerState {
  coins: number
  upgrades: { damage: number; fireRate: number; startCount: number; gateBonus: number; bossDamage: number }  // levels 0..10
  staffs: Record<WeaponId, { unlocked: boolean; tier: 1 | 2 }>   // ember unlocked at start
  familiar: { unlocked: boolean; tier: 0 | 1 | 2 | 3 }
  bestiary: string[]            // enemy and boss ids seen
  unlockedLevel: number
}
```

- `generateLevel(index, config, seed, player?)` and `new Run(level, balance, player?)`
  apply upgrades as multipliers: damage +8 percent per level, fire rate +6,
  starting squad +1 unit, gate bonus +5 percent on add gates, boss damage
  +10. Costs: `50 × 1.35^level` coins, max level 10. All numbers in
  `src/data/progression.json`.
- `runRewards(state, level, firstClear): { coins }`: survivors × 1, plus
  25 × level on a clear, plus 100 × level on a first clear.
- Staff evolutions (tier 2): Ember burns (30 percent of damage over 2 s),
  Storm chains one more target, Frost shatter damages neighbors within
  1 m for 50 percent. Unlock and tier prices in `progression.json`.
- Familiar: a wisp that hovers beside the squad and fires a homing spark
  at the nearest enemy at its own rate; tiers raise rate and damage.
  `RunState.familiar: FamiliarState | null` with `{ x, z, tier, cooldown }`;
  event `familiarShot { x, z, targetId }`. Unlocked in the Sanctum from
  level 8.
- Bestiary: the app records every `EnemyKind` and the level's `bossId`
  seen during a run; `LevelDef.bossId` is added (today always `demon`).

### Walls (sim defines, render draws)

```
WallDef { boundary: -1 | 1; zStart: number; zEnd: number }   // boundary x = ±1
LevelDef.walls: WallDef[]
```

- While `squad.z` is inside a wall's stretch the squad's x clamp excludes
  the boundary; entering with the center on one side keeps you there. A
  2 m approach zone pushes a straddling squad to the side its center is on.
  Shots and streams are unaffected. Generator: from level 4, one wall
  stretch of 10 to 20 m before some gate rows; on horde rows both
  boundaries may be walled. Bots choose the side before the wall from the
  gates they can see. Balance bands from Milestone 3 hold.
- Render: rune-stone fence pieces along the boundary, thin-instanced, a
  glowing top edge, readable from the camera.

### Levels

- 20 levels. The Milestone 3 curve stretched: peak targets, pressure
  bands and boss numbers continue the same slopes; levels 11 to 20 add
  walls on most gate rows and two-lane hordes.
- The picker gets two pages of ten.

### Academy (app and UI)

- Home screen over the dressed road: coin total top-left; cards for Play
  (level picker), Yard, Workbench, Sanctum, Bestiary. Rooms unlock at
  levels 1, 5, 8, 3 respectively with a short reveal animation. Cinzel.
- Yard: five upgrade rows with level, effect and price; buy with a tap.
- Workbench: three staffs, unlock and evolve; the chosen staff is the
  run's starting weapon (weapon gates still swap mid-run).
- Sanctum: unlock and tier the wisp.
- Bestiary: cards for grunt, brute, demon with a one-line description,
  greyed until seen.
- Result screen: coins count-up with ticks, first-clear badge.
- Save `arcane-rush.save.v2` with migration from v1 (unlockedLevel, muted,
  debug carried over; everything else default).
- Sounds: purchase, unlock, room reveal, coin tick (reused clips, pitched).

### Device build

- `capacitor.config.ts` (app id `com.arcanerush.app` as a placeholder the
  product owner can change), `webDir: dist`, iOS scheme settings for a
  full-screen black background, status bar hidden, splash from the app
  colors, `@capacitor/haptics` on boss stomps, boss kills and level clears
  (guarded so the web build is unaffected), `npm run cap:sync`.
- `docs/DEVICE.md`: the exact Mac steps (Xcode, `npx cap add ios`,
  signing with a personal team, `npx cap open ios`, run on the phone,
  TestFlight later) and what to report back.
- The web build stays the product; the wrapper adds nothing the browser
  build lacks except haptics and the full-screen shell.

### Polish

- Task P: the walking glitch (diagnosis and fix in progress).
- Capture gains a frames-over-20-ms counter per 10 s window; target under
  3 on the product owner's capture.

## Definition of done

1. Walls in the generator from level 4, bots aware, 20 levels, balance
   bands hold, walls readable in frames.
2. Coins, yard, workbench, sanctum and bestiary working end to end from a
   versioned save; the upgrade-affordance test passes (the upgrades a
   level-N clear affords make level N+3 clearable by the greedy bot).
3. The wisp fights beside the squad with its own bolt and a visible tier.
4. Capacitor files, scripts and `docs/DEVICE.md` in the repo; the product
   owner runs the app on the phone from Xcode.
5. Walking glitch gone in a close-camera frame sequence; the capture
   reports frames over 20 ms.
6. All checks, both offline builds under budget (hosted 12 MB, artifact
   16 MB), docs and ledger.

## Team plan

| Phase | Agent | Scope | Depends on |
|---|---|---|---|
| P | polish | Walking glitch diagnosis and fix | running |
| B1 | sim | Walls, 20 levels, PlayerState multipliers, staff evolutions, wisp, rewards, `bossId`, tests | none |
| B3 | app and ui | Save v2, Academy home and rooms, coins, result count-up, bestiary recording, spike counter, sounds | contracts above (B1 lands types) |
| B4 | device | Capacitor config, plugins, scripts, guide | none |
| B2 | render | Wall fences, wisp and spark visuals, evolution effects, Academy backdrop | P, B1 for wall data |
| C | integration | Wire, tune, builds | B |
| D | review | Independent review and fixes | C |

Interim build after B1, B3 and B2 land (before C) so the product owner can
try the Academy and the walls early.
