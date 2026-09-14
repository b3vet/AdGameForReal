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
| D17 | 2026-09-08 | Hosted playtest links use `npm run build:hosted`: only the game code is inlined and Babylon core and GUI load from jsdelivr as UMD globals. The fully inlined build stays for standalone files. Supersedes D16. | 04 (post-close) |
| D18 | 2026-09-08 | Milestone 2 approved. Physics (Havok) is presentation-only: it consumes sim events and never feeds back into the sim. | 06 |
| D19 | 2026-09-08 | Gate shoot-to-grow is a rate per second scaled by the fraction of squad fire hitting the gate, capped per gate, replacing +1 per hit. | 06 |
| D20 | 2026-09-08 | Difficulty targets: a good player ends with 35 to 65 percent of peak; boss fights last 20 to 30 s; curses start small enough to be shot down. | 06 |
| D21 | 2026-09-08 | Tone is epic and heavy: sound, palette, camera shake, boss weight, UI copy. Staffs are Ember, Storm, Frost. | 06 |
| D22 | 2026-09-08 | Single-file builds inline every asset and the Havok WASM as data because the page host blocks runtime fetches; dev and production builds load assets by URL. | 06 |
| D23 | 2026-09-08 | One VAT bake per rig drives every accessory (staffs are skinned to the hand bone and merged), since a VAT is bone matrices, not mesh data. Props come from KayKit Halloween Bits; the biome-1 boss is the Quaternius Demon. | 07 (Phase A), ASSETS.md |
| D24 | 2026-09-08 | Peak targets re-derived for rate-based growth: 105 at level 1 to 400 at level 10 (supersedes the numbers in D14). Pre-boss road runs 29 to 46 s; row counts won over the 30 to 45 s band. | 07 (Phase B1) |
| D25 | 2026-09-08 | Single-file builds inline assets and the Havok WASM through a Vite plugin at build time; the hosted variant loads Babylon core, GUI and loaders from jsdelivr. | 07 (Phase C) |
| D26 | 2026-09-08 | Staff gates are placed after level layout into a lane the row can spare, never at the cost of a curse; Storm is at single-target damage parity so a staff is a choice, not a strict upgrade. | 07 (Phase C) |
| D27 | 2026-09-08 | The degrade ladder is owned by the app (`src/core/quality.ts`), six rungs, never steps up; physics and render only expose setters. | 07 (Phase C) |
| D28 | 2026-09-11 | Art direction is bright and casual: daylight palette, soft toon ramp, no outlines. Epic stays in boss weight and sound. Supersedes the dark half of D21. | 09 |
| D29 | 2026-09-11 | Enemies on the road are individual units in streams (hundreds per lane, one soldier lost per touching enemy); brute blocks remain. Stream density is tuned so a good player barely clears each wave (pressure bands). | 09 |
| D30 | 2026-09-11 | Font: Cinzel for display and numbers, Nunito for body, embedded in builds; number labels move from the GUI texture to a digit atlas. | 09 |
| D31 | 2026-09-11 | Gate rows return to 18 m with streams between them; levels 1 to 3 are generous, Milestone 2 targets apply from level 6. | 09 |
| D32 | 2026-09-13 | Lane walls are low: the squad cannot cross a walled boundary, shots and streams are unaffected. From level 4; 20 levels. | 12 |
| D33 | 2026-09-13 | Progression is coins only: a training yard (five upgrades), a workbench (staff unlocks and one evolution each), a Sanctum (wisp familiar), a bestiary; versioned save v2. | 12 |
| D34 | 2026-09-13 | The device build is a Capacitor wrapper around the unchanged web build with haptics and a full-screen shell; the product owner runs the Xcode steps from `docs/DEVICE.md`. | 12 |
| D35 | 2026-09-13 | Upgrades apply as multipliers in the sim through an optional PlayerState; balance bands are defined for a player with no upgrades. | 12 |
| D36 | 2026-09-15 | `src/data/palette.json` is the single source of color for render and UI; code references roles, never hex. | 14 |
| D37 | 2026-09-15 | The formation fills the available road width in staggered lines and narrows under walls; lateral motion is a damped spring; drawn units follow their slots with per-row lag. | 14 |
| D38 | 2026-09-15 | Rung 0 renders at native device pixel ratio up to 3 without multisampling; fog 120 to 260 m; tone mapping in materials; blob shadows. | 14 |
| D39 | 2026-09-15 | Game UI from Kenney Fantasy UI Borders, UI Pack and Game Icons (CC0); gates are dungeon-piece arches with rune plaques. | 14 |
| D40 | 2026-09-13 | Tone mapping is KHR PBR Neutral at exposure 1.185, chosen by measured palette fidelity (rms 11 of 255 against ACES's 17); the swatch harness in `scripts/swatch-check.mjs` is the test for any future change. | 15 (Phase E) |
| D41 | 2026-09-13 | The full look needs iOS 16.2 or newer (`color-mix` in the UI kit); iOS 15 to 16.1 plays with opaque fallback tokens. The device guide states 16.2. | 15 (Phase F), DEVICE.md |
| D42 | 2026-09-13 | The crowd is one lane wide and grows backward as a column; the camera frames its front and the tail runs off the frame. Supersedes the formation half of D37 (the spring and the per-row lag stand). | 16 |
| D43 | 2026-09-13 | Every unit is an agent in the sim (structure-of-arrays, never compacted, deterministic at the fixed step): seek, separation, fence contact, arch funnel, enemy shove. Walls stop units, not the leader; the leader is on the finger 1:1 and rows chain behind it. | 18 |
| D44 | 2026-09-13 | Stragglers: units on the wrong side of a fence when a wall starts to hold are cut off as their own group, fight alone in their lane, resolve the gates they walk through, and rejoin at the back when the wall releases. | 18 |
| D45 | 2026-09-13 | Difficulty bands are measured on a human-like bot (reaction delay, swipe limit, imperfect lane choice); ordinary levels clear 70 to 80 percent first try, milestone levels 5, 10, 15, 20 need the upgrades the economy affords by then. Greedy still wins everywhere. Supersedes the greedy-bot half of D20. | 18 |
| D46 | 2026-09-13 | Economy: rewards come from clears, a loss pays about 30 percent, prices follow a runs-per-purchase curve (two runs early, four by level 10) verified by a simulated campaign. | 18 |
| D47 | 2026-09-13 | Roadmap: Milestone 7 content (biome 2, new enemies, second boss, levels 21 to 40), Milestone 8 meta and hooks, Milestone 9 device and store readiness. Device testing parked until near-final. | 18 |
| D48 | 2026-09-13 | Milestone levels are 7, 10, 15 and 20 (level 5 is ordinary): the upgrade set the economy affords by level 5 cannot gate a level. The boss closes to contact within its fight so the crowd thins after the last gate. Supersedes the level list in D45. | 19 (wave two) |
| D49 | 2026-09-14 | Biome 2 is Frostfell: palette overrides by role, snow and ice textures, tinted props; new kinds charger and shielded brute; boss 2 is the Rime Fiend with a lane charge; levels 21 to 40 with milestones 25, 30, 35, 40. | 20 |
| D50 | 2026-09-14 | The Yard's first gate-bonus rung is cheap so a milestone level can be gated by an upgrade the economy affords (closes the Milestone 6 finding on levels 7 and 10). | 20 |
