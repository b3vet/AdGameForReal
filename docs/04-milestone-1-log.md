# Milestone 1 log (append-only)

## 2026-09-08 — Kickoff

- Product owner approved Milestone 1 and set the process: the tech lead
  session orchestrates, general-purpose Opus subagents implement, the tech
  lead verifies and commits. Product owner has a Mac for later device builds;
  browser testing comes first. Working title stays Arcane Rush.
- Product owner asked that every decision and the process itself be recorded
  in the repo docs as immutable memory. `docs/README.md` sets the rules,
  `docs/DECISIONS.md` is the ledger, this file is the M1 process log.
- Tech lead wrote `03-milestone-1-plan.md` with the world model, module
  contracts, data schema, team plan, and definition of done.
- Environment facts checked: Node 22, Playwright 1.56.1 with Chromium 1194
  preinstalled, npm and GitHub reachable, Babylon 9.25 is the latest on npm,
  `vite-plugin-singlefile` 2.3.3 supports Vite 8.

## 2026-09-08 — Phase A: scaffold (verified and committed)

- Scaffold agent delivered the skeleton. Tech lead re-ran all six commands
  in the session environment: typecheck, lint, 18 unit tests, build, smoke,
  artifact build all pass. Smoke frame `t6.png` inspected: a lit orange box on
  a grey road under a blue sky, rendered headless through SwiftShader WebGL2.
- Deviations accepted: TypeScript 5.9 instead of 7 (typescript-eslint peer
  range), ESLint 10 flat config with `@eslint/js` and `globals`, `lint` runs
  with `--max-warnings 0`, a dependency-free PNG decoder in `scripts/png.mjs`
  for the smoke blank-frame check.
- Facts for later phases: the debug handle is
  `window.__arcane = { ready, app, run(), state() }` and `ready` flips after
  `renderer.init()` while still on the title screen; smoke clicks
  `#play-button`; the sim lint guard rejects any `@babylonjs` import in
  `src/sim`; Babylon runs at device pixel ratio 1 by default; the single-file
  artifact is 1.4 MB.
- Next: B1 (sim), B2 (render), B3 (app) launched in parallel with strict path
  ownership.
