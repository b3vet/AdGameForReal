# Docs: the project's memory

Rules:

1. Numbered documents (`01-...`, `02-...`) are **immutable once committed**.
   A correction or a change of mind is a new document, not an edit.
2. `DECISIONS.md` is an **append-only ledger**: one line per decision, with the
   document that explains it. Never rewrite a line; add a superseding line.
3. Milestone logs (`NN-milestone-N-log.md`) are **append-only**: each entry is
   dated and describes what happened, what was verified, and what was learned.
4. Anyone (human or agent) starting work reads, in order: `README.md`,
   `DECISIONS.md`, the current milestone plan, the current milestone log.

Index:

| Doc | What it is |
|---|---|
| `01-concept-options.md` | Round 1: deconstruction of the ad game, four themes, core loop, tech options |
| `02-decisions-and-stack.md` | Round 2: locked decisions, meta layer explained, Babylon.js chosen |
| `03-milestone-1-plan.md` | Milestone 1 spec: greybox playable, module contracts, team plan |
| `04-milestone-1-log.md` | Milestone 1 process log (append-only) |
| `05-milestone-2-plan-draft.md` | Milestone 2 draft plan v1, awaiting playtest feedback; final plan will be 06 |
| `06-milestone-2-plan.md` | Milestone 2 plan, approved: characters, physics, weapons, audio, biome, difficulty retune |
| `07-milestone-2-log.md` | Milestone 2 process log (append-only) |
| `08-milestone-3-plan-draft.md` | Milestone 3 draft plan v1: bright casual look, magical projectiles, enemy streams, gate spacing, fonts, performance; awaiting answers |
| `09-milestone-3-plan.md` | Milestone 3 plan, approved: bright casual look, magical projectiles, enemy streams, 18 m rows, Cinzel, performance |
| `10-milestone-3-log.md` | Milestone 3 process log (append-only) |
| `11-milestone-4-plan-draft.md` | Milestone 4 draft plan v1: lane walls and 20 levels, coin progression with the Academy, Capacitor device build, polish; awaiting answers |
| `12-milestone-4-plan.md` | Milestone 4 plan, approved: lane walls and 20 levels, coin progression with the Academy and a wisp familiar, Capacitor device build, polish |
| `13-milestone-4-log.md` | Milestone 4 process log (append-only) |
| `14-milestone-5-plan.md` | Milestone 5 plan, approved: studio-quality look and feel, palette, formation and movement, rendering quality, gates, road, game UI |
| `15-milestone-5-log.md` | Milestone 5 process log (append-only) |
| `16-lane-column-formation.md` | Correction after Milestone 5: the crowd fills one lane and grows backward as a column (supersedes the formation half of D37) |
| `17-milestone-6-plan-draft.md` | Milestone 6 draft plan v1: crowd agents, responsive head, a game that can be lost, economy; awaiting answers |
| `18-milestone-6-plan.md` | Milestone 6 plan, approved: crowd agents and stragglers, head on the finger, human-bot difficulty with milestone levels, clear-based economy; roadmap for 7 to 9 |
| `19-milestone-6-log.md` | Milestone 6 process log (append-only) |
| `20-milestone-7-plan.md` | Milestone 7 plan, approved: Frostfell biome, charger and shielded brute, the Rime Fiend, levels 21 to 40 |
| `21-milestone-7-log.md` | Milestone 7 process log (append-only) |
| `22-milestone-8-plan-draft.md` | Milestone 8 draft plan v1: missions, streaks, bestiary rewards and cosmetics, endless, deeper evolutions; awaiting the owner's play and answers |
| `23-milestone-8-plan.md` | Milestone 8 plan, approved: streak on the device clock, rotating missions, tint cosmetics from bestiary tiers, Endless as a separate mode, three evolution tiers per staff |
| `24-milestone-8-log.md` | Milestone 8 process log (append-only) |
| `25-milestone-9-plan.md` | Milestone 9 plan, approved: device and store readiness — art pipeline with placeholders and prompts, native shell polish, committed projects and guides, device report |
| `26-milestone-9-log.md` | Milestone 9 process log (append-only) |
| `DEVICE.md` | Clone-to-phone guide for the owner's Mac: install, art, assets, sync, Xcode, signing, what to report, TestFlight, Android |
| `ART.md` | App icon and splash: files, sizes, safe zones, the regenerate command, and the prompts for the owner's image generator |
| `STORE.md` | App Store metadata draft and submission checklist |
| `ASSETS.md` | Asset inventory: every file in `assets/` with source, licence, and use (maintained by the asset pipeline) |
| `DECISIONS.md` | Decision ledger (append-only) |
