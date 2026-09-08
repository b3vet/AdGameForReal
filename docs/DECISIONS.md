# Decision ledger (append-only)

| # | Date | Decision | Where explained |
|---|---|---|---|
| D1 | 2026-09-08 | Genre: portrait lane-defense auto-shooter cloned from the fake ads (shootable gates, HP-number enemy blocks, boss with a number) | 01 |
| D2 | 2026-09-08 | Theme: Arcane Rush, apprentice wizards vs monster horde. Working title only. | 01, 02 |
| D3 | 2026-09-08 | The web build is the product, not a prototype. Unity or Godot only if the web build hits a wall. | 02 |
| D4 | 2026-09-08 | Platforms: iOS first, then Android, both via Capacitor. Browser testing comes first. | 02 |
| D5 | 2026-09-08 | Assets: strictly free (CC0). AI-generated models later if useful. Avoid Blender. | 02 |
| D6 | 2026-09-08 | No ads, no IAP, no monetization code until further notice. | 02 |
| D7 | 2026-09-08 | Meta layer: build the pure runner first; design save data and home screen so the Academy slots in later. | 02 |
| D8 | 2026-09-08 | Engine: Babylon.js 9 with Havok physics (physics deferred to Milestone 2). TypeScript, Vite, Capacitor. | 02 |
| D9 | 2026-09-08 | Process: the tech lead session orchestrates; general-purpose Opus subagents implement; the tech lead verifies and commits. | 03 |
| D10 | 2026-09-08 | Docs are immutable memory: numbered docs never edited, ledger and logs append-only. | docs/README.md |
| D11 | 2026-09-08 | Playtest delivery: single-file HTML build published as a hosted artifact link, plus the normal Vite build for local runs. | 03 |
| D12 | 2026-09-08 | Milestone 1 has no physics engine; everything is kinematic. Havok and ragdolls start in Milestone 2. | 03 |
| D13 | 2026-09-08 | `?turbo=N` runs the sim faster than real time for automated playthroughs; the smoke test uses turbo 8 and is strict by default. | 04 (Phase C) |
| D14 | 2026-09-08 | Each level has an explicit `peakTarget` for squad size (60 → 450) that drives gate values and the add-gate cap; the 500 cap is a ceiling, not a goal. | 04 (Phase C, D) |
| D15 | 2026-09-08 | The squad's x clamp tapers by formation half-width with a floor of ±1 m so the crowd never overhangs the road. | 04 (Phase D) |
| D16 | 2026-09-08 | Playtest delivery is the standalone HTML file until hosting is resolved; the hosted artifact route is blocked by a service-side misclassification of the bundle (supersedes the hosted half of D11). | 04 (Phase D) |
