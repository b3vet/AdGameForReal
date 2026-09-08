# Arcane Rush

A portrait lane-defense auto-shooter for mobile: a squad of apprentice wizards
auto-fires forward, the player drags left or right, gate rows change the squad
count, enemy blocks with HP numbers walk at you, a boss with a big number waits
at the end. Web build (Babylon.js) is the product; wrapped with Capacitor for
iOS and Android later.

## Roles and process

- The human is product owner. The tech lead (orchestrating Claude session) plans,
  assigns work to subagents, verifies, and commits. Subagents implement.
- **Subagents do not commit or push.** Leave changes in the working tree and
  report what you did, what you verified, and what is left.
- Everything is documented in `docs/`. Read `docs/README.md` for the rules.
  Read the current milestone plan before touching code.

## Stack

- Babylon.js 9 (`@babylonjs/core`, `@babylonjs/gui`), TypeScript strict, Vite,
  Vitest, Playwright 1.56.1 (pinned: the browser at `/opt/pw-browsers` is 1194).
- No physics engine yet (Havok arrives in Milestone 2).
- No ads, no IAP, no analytics SDKs. Do not add any.

## Commands

```
npm run dev          # vite dev server
npm run build        # production build to dist/
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run test         # vitest run
npm run smoke        # build, then Playwright opens the game headless, screenshots to artifacts/smoke/
npm run build:artifact  # single-file HTML to dist-artifact/arcane-rush.html (for hosted playtest links)
```

## Layout and ownership

```
src/sim/      pure game logic, NO Babylon imports (eslint enforces), unit-tested
src/data/     JSON tuning and level generation config
src/render/   Babylon scene, camera, meshes, labels, effects
src/core/     app state machine, input, save data, debug handle
src/ui/       HTML/CSS overlays: title, HUD, result
src/main.ts   boot
scripts/      build-artifact, smoke test
docs/         plans, decisions, logs (see docs/README.md)
```

## Conventions

- TypeScript strict, no `any`, no non-null assertions without a comment.
- `src/sim` is deterministic: fixed timestep, seeded RNG, no Date, no Math.random.
- Everything that moves every frame is pooled. No per-frame allocations in hot loops.
- All tuning numbers live in `src/data/*.json`, never inline in code.
- Render reads sim state; it never mutates it. Sim never knows about render.
- Keep files under ~400 lines; split by responsibility.
- Comments explain why, not what.
