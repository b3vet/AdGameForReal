# Milestone 8 plan, approved: meta and hooks — missions, streaks, bestiary rewards and cosmetics, endless, deeper evolutions

Status: approved by the product owner on 2026-09-14 with the answers below;
the owner keeps playing Version 16 and feedback arrives later. Draft was
document 22. Log is document 24. Still no ads, no IAP, no analytics (D6);
coins stay the only currency (D33).

## The owner's answers

| Question | Answer | What it means here |
|---|---|---|
| Daily streak? | On the device clock. | `src/core` reads the clock (never `src/sim`); a missed calendar day resets. |
| Missions? | Rotating from a pool. | Three active, drawn seeded from `missions.json`, replaced as completed. |
| Cosmetics? | Tints only for now. | Hat and cape tint sets, wisp colour and trail, staff glow; no meshes. |
| Endless? | A separate mode; coin gain must not disturb the level progress. | Available from the start beside the campaign; paid by distance under the campaign's rate, measured (D52). |
| Evolution tiers? | Fine as sketched. | Three tiers per staff, six new mechanics. |
| Level 7? | Elaborated; tech lead's call. | The milestone flag is dropped (D55): it plays as an ordinary-hard level and the first upgrade gate is 10. |
| Feedback? | Still playing; finish and complete the milestone. | Feedback folds into a later pass. |

## Contracts (pinned so the tracks build in parallel)

```ts
// src/data/meta-types.ts (Phase A creates it first thing; exact shapes)
export interface StreakState { days: number; lastDay: string }        // 'YYYY-MM-DD' local
export interface MissionState { id: string; progress: number; done: boolean }
export interface MissionsState { active: MissionState[]; rolled: number } // rolled drives the seeded pool order
export type CosmeticSlot = 'hat' | 'cape' | 'wisp' | 'staffGlow';
export interface CosmeticsState { owned: string[]; selected: Partial<Record<CosmeticSlot, string>> }
export interface EndlessState { bestMetres: number; runs: number }
export type KillKind = 'grunt' | 'brute' | 'charger' | 'shieldBrute' | 'demon' | 'rime';
export interface LevelBest { survivors: number; peak: number }

// src/sim/player.ts (Phase B adds first thing; Phase A's save v3 reads them)
// PlayerState gains: streak: StreakState; missions: MissionsState;
//   kills: Record<KillKind, number>; cosmetics: CosmeticsState;
//   endless: EndlessState; levelBest: Record<string, LevelBest>.
// staffs[id].tier is 0 to 4: 0 locked, 1 unlocked, 2 to 4 the three evolutions.
// PlayerMods gains tiers: Record<WeaponId, 0 | 1 | 2 | 3> (evolution tiers held).
// progression.json staffs: { unlock, evolve: [tier2, tier3, tier4] }.

// Endless (Phase B): src/data/endless.json; generateEndless(seed): LevelDef with
//   endless: true, index 0, no boss, biome alternating every rowsPerBiome rows,
//   dials rising per row; RunState.endless?: { metres } written each step; the
//   run ends on the wipe (status 'lost') or the road's end; runRewards pays
//   min(cap, metres * coinsPerMetre) for an endless run.

// Missions (Phase A): src/data/missions.json pool entries
//   { id, kind, param, reward, text } with kinds clearLevel | finishWith |
//   breakShields | killChargers | noStragglers | bossUnder | mulGates |
//   endlessMetres; progress counted in src/core/missions.ts from sim events
//   and run results, never inside the sim.

// Cosmetics (Phase A data, Phase C render): src/data/cosmetics.json entries
//   { id, slot, name, tint (palette role or multiplier triple), unlockedBy:
//   { kind: KillKind, tier: 1 | 2 | 3 } }; academy.json bestiary entries gain
//   tiers: [{ kills, coins, cosmetic }] (three each).

// Save v3 (Phase A): key 'arcane-rush.save.v3', migration from v2 (and the
//   v1 chain) with every new field defaulted; tests over v1 and v2 fixtures.
```

## Scope

### A. Meta core (core, data)

Save v3 and migration; the streak (advance on a finished run, reset on a
missed day, bonus per day to a cap); missions (seeded draw of three from the
pool, progress from events, reward on completion, replacement at the next
session); kill counters per kind from `enemyKilled` and the boss's death;
level bests; the retry-same-road seed on the session. Data files: missions,
cosmetics, bestiary tiers.

### B. Sim (sim, data)

Endless generator and its run semantics; the six evolution mechanics on the
existing staff paths — Ember: wildfire (a burning body ignites a touching
body once) and meteor (a charged shot every N seconds that lands where the
crowd aims, damages in a radius and shoves); Storm: full chains (no falloff)
and overcharge (every fifth volley arcs to every body in range); Frost:
freeze pulse (a slowed body that dies chills its neighbours) and glacier (a
wall of ice holds a lane's river for T seconds, once per M seconds); tier
gating through `PlayerMods.tiers`; the level 7 flag dropped; tests; goldens
for 1 to 3 and 21 to 23 untouched (tiers default to 0).

### C. Render and UI

Wardrobe room (slots, owned and locked tints, selection), missions board in
the Academy with progress bars, the streak on the title, Endless in the
picker with a best-metres plaque and a metres HUD chip, result-sheet hooks
(mission ticks, next unlock with the purse against it, "same road again",
level best and a star), picker milestone badges, cosmetic tints on the
squad (manifest tint patches), the wisp (colour and trail) and the staff
glow (spell sprite tint), the six evolution effects (wildfire spread, the
meteor and its crater ring, overcharge arcs, the freeze pulse ring, the
glacier wall mesh in the frost roles), audio cues from the existing clips.

### D. Balance and economy

Tier prices as multi-run goals on the curve (the campaign buys them after
the yard rungs, never before level 15); bands on the armed human with and
without tiers so no tier is mandatory below 40; endless curve and pay (a
ten-minute endless run pays less than a repeat clear of the player's best
level; measured); mission rewards and the streak bonus sized so the
campaign's runs-per-purchase bands hold with them on; level 7 re-checked as
ordinary.

## Definition of done

1. Missions rotate and pay; the streak survives a reload and resets on a
   missed day; v1 and v2 saves migrate.
2. Endless runs to a wipe, scores metres, replays by seed, pays under the
   campaign rate; the first ten minutes banded on the human bot.
3. Every kind has three tiers; every cosmetic renders and persists.
4. Six tiers in the sim with tests; bands hold with and without them.
5. Hooks on the result sheet and picker; all checks, smoke (an endless run
   and a Wardrobe shot), hero set, hosted build, log, ledger.

## Team plan

| Phase | Agent | Owns | Depends on |
|---|---|---|---|
| A | meta core | `src/core/**` and its tests, `src/data/meta-types.ts`, `missions.json`, `cosmetics.json`, `academy.json` (bestiary tiers), `src/data/*-types.ts` for those | none |
| B | sim | `src/sim/**` (including `player.ts` state and mods), `src/data/endless.json`, `balance.json` (evolution and endless tuning), `progression.json` (the `evolve` array shape), `levels.json` (level 7), sim tests | none |
| C | render and ui | `src/render/**`, `src/ui/**`, `src/audio/**`, `audio.json`, `index.html` | A, B |
| D | balance and economy | `balance.json`, `levels.json`, `progression.json`, `endless.json`, `missions.json` rewards, sim tests | B |
| E | integration and review | all | C, D |
