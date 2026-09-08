# Arcane Rush

A portrait lane-defense auto-shooter for mobile. A squad of apprentice wizards
runs forward and fires by itself; you drag left and right to steer. Shootable
gate rows multiply, add to or subtract from your squad, enemy blocks labelled
with their HP walk down the lane to eat units, and a boss with a big number
waits at the end of each level. The web build is the product: Babylon.js 9,
TypeScript, Vite, wrapped with Capacitor for iOS and Android later.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Production build to `dist/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (flat config, zero warnings allowed) |
| `npm run test` | Vitest unit tests (`src/**/*.test.ts`) |
| `npm run smoke` | Builds, serves `dist/`, drives the game in headless Chromium, screenshots to `artifacts/smoke/` |
| `npm run build:artifact` | Single-file HTML to `dist-artifact/arcane-rush.html` for hosted playtest links |

Useful query parameters: `?level=N`, `?bot=greedy|random|worst`, `?seed=N`,
`?debug`, `?scene=render-test`.

## Layout

```
src/sim/      pure game logic, no Babylon imports (ESLint enforces this)
src/data/     JSON tuning and level generation config
src/render/   Babylon scene, camera, meshes, labels, effects
src/core/     app state machine, input, save data, debug handle
src/ui/       HTML/CSS overlays: title, HUD, result
src/main.ts   boot
scripts/      smoke test and single-file artifact build
docs/         plans, decisions, logs
```

## Docs

`docs/` is the project's memory and the rules for it are in
[`docs/README.md`](docs/README.md). Read it before starting work: numbered
documents are immutable, `docs/DECISIONS.md` and the milestone logs are
append-only, and the current milestone plan
([`docs/03-milestone-1-plan.md`](docs/03-milestone-1-plan.md)) defines the
module contracts every part of `src/` is written against.
