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
| `ASSETS.md` | Asset inventory: every file in `assets/` with source, licence, and use (maintained by the asset pipeline) |
| `DECISIONS.md` | Decision ledger (append-only) |
