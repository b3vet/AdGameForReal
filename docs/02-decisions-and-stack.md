# Round 2: decisions, the meta question, and the web stack

Supersedes the open questions in `01-concept-options.md`.

---

## 1. Decisions locked

| Topic | Decision |
|---|---|
| Theme | **Arcane Rush**: apprentice wizards vs a monster horde |
| Starting point | A **web build treated as the product**, not a throwaway. We diverge to Unity only if the web build hits a wall we cannot fix. |
| Platforms | iOS first, Android second, both via Capacitor |
| Assets | Strictly free (CC0). AI-generated models later if useful. No Blender unless unavoidable. |
| Monetization | None. No ads, no IAP, no ad SDKs in the codebase until further notice. |
| Meta layer | See section 2 |

---

## 2. Question 6 explained: pure runner vs runner + academy

Both models share the same core: you play levels, levels give coins, coins buy permanent upgrades. The difference is whether the game has a **place** the player comes back to, or only a **list** of things to do.

### Pure runner

- Home screen is a "Play level 37" button, an upgrade list (damage, fire rate, starting squad, and so on), and maybe a weapon picker.
- Progress is the level number and the upgrade counters.
- This is how Count Masters and Mob Control work.
- Pros: cheapest to build, fastest to tune, the core loop gets all the attention.
- Cons: nothing grows except numbers in a list. After a few days the player has "done" the game unless levels keep surprising them.

### Runner + light academy

- The home screen is the **Academy**: a small 3D scene (a tower, a courtyard, a library) that visibly grows as you progress.
- Each room maps to a system we need anyway, so it costs UI and art rather than new mechanics:

| Room | Unlocks at | What it does |
|---|---|---|
| Training yard | start | Coin upgrades (damage, fire rate, starting squad, gate bonus) |
| Workbench | level 5 | Weapon cards merge here to evolve staffs (tier 1 to 5, each tier changes the model and adds a behavior) |
| Aviary | level 10 | Familiar collection; pick one to bring on runs |
| Library | level 15 | Bestiary: every enemy and boss you have met, with rewards for completing sets |
| Potion lab | level 20 | Offline coin income; collect when you come back |
| Observatory | level 30 | Biome map and event levels |

- Apprentices you have unlocked wander the courtyard. Your familiar follows you around. The place feels alive.
- Pros: a second progression axis, a "my base grew" feeling, a natural home for collections, and a reason to open the app that is not "play one more level".
- Cons: roughly 30 percent more work, one more scene to art, and a risk of over-scoping into base-building. The heavy version of this (Last War, Top War: timers, alliances, resource buildings) is not what I am proposing.

### Recommendation

Build the pure runner first, because it is the core and it is what we tune. But structure the save data and the home screen from day one so the Academy slots in later without a rewrite: rooms are just panels that read and write the same player state. We decide after the runner is fun whether the Academy is the next step. With no monetization the Academy's only job is retention and delight, which is what you asked for, so I expect we will build it.

---

## 3. Web stack

### Why 3D, and why not Phaser or Godot

- **Phaser** is 2D. We would need sprite sheets for every unit, every angle, every animation, and we lose ragdolls, shatter, and the free 3D asset packs. The 3D-ish look you want comes cheapest from actual 3D.
- **Godot's web export** is its weakest platform, especially in Safari and WKWebView. Using Godot means native builds, which is fine but it is no longer a web game we wrap and ship. It stays on the list as a fallback next to Unity.

### Babylon.js vs Three.js

| | Babylon.js 9 | Three.js r185 |
|---|---|---|
| What it is | A full engine | A rendering library; you assemble the rest |
| Hundreds of animated units | Built in: vertex animation baker plus thin instances, per-instance animation state | Custom baker and custom shader, both written by us |
| Physics | Havok (WASM, free) as a built-in plugin, plus a Ragdoll class that builds bodies from a skeleton | Rapier, with joints and ragdolls wired by hand |
| Glow, bloom, post effects | Built in | Separate postprocessing library |
| Particles | CPU and GPU particle systems built in | Third-party or custom |
| glTF with skeletons and animation groups | Built in | Built in |
| Audio | Built in | Howler or raw WebAudio |
| Bundle | Larger (engine ~1.5 MB gzipped after tree shaking, Havok ~2 MB) | Smaller |
| Ecosystem | Smaller, but an active forum and Microsoft-backed | The largest |
| WebGPU | Mature, with WebGL fallback | Mature |

### Decision: Babylon.js

The three hardest things in this game are a big animated crowd, ragdolls, and glowing spells. Babylon has all three built in and tested on mobile. With Three.js I would write and maintain that plumbing myself. Since the web build is meant to be the product, fewer moving parts wins. Bundle size does not matter inside an app.

### Full stack

| Layer | Choice | Version today |
|---|---|---|
| Engine | `@babylonjs/core`, `@babylonjs/loaders` | 9.25 |
| Physics | `@babylonjs/havok` | 1.3 |
| Language | TypeScript | 7.0 |
| Build | Vite | 8.2 |
| Shell | Capacitor (`@capacitor/core`, `@capacitor/ios`, `@capacitor/android`) | 8.5 |
| UI | HTML and CSS overlay (menus, HUD, result screen); Babylon only draws the world | |
| Save data | JSON in Capacitor Preferences (falls back to localStorage in the browser) | |
| Tests | Vitest for game logic (squad math, gate rules, level generation), Playwright screenshots for rendering | |
| Assets | KayKit Adventurers (Mage), KayKit Character Animations, KayKit Skeletons, KayKit Dungeon, Quaternius Ultimate Monsters, Kenney particles and UI, Kenney and Freesound audio | all CC0 |

### Architecture sketch

```
src/
  core/      engine boot, game loop, input (pointer drag), pooling, events
  sim/       pure TypeScript game logic with no Babylon imports:
             squad, gates, enemies, weapons, boss, level generator, economy
  render/    crowd renderer (VAT + thin instances), effects, ragdoll pool,
             camera rig, biome scenery
  ui/        HTML overlays: HUD, gate previews, result screen, home, upgrades
  data/      JSON: levels, gate tables, enemy stats, weapons, upgrade costs
assets/      glTF models, baked animation textures, audio, fonts
```

`sim/` is deliberately engine-free. Everything that would move to Unity if we ever ported is either data in `data/` or logic in `sim/`, and it is unit-tested without a browser.

### Asset pipeline without Blender

- KayKit ships glTF. Babylon loads it directly with skeletons and animations.
- The KayKit animation pack uses the same rig as the characters, so no retargeting.
- Staffs attach to the hand bone at runtime; recolors are material swaps at runtime.
- Animation textures are baked at build time by a Node script running Babylon's NullEngine, so the app never bakes on the phone.
- AI-generated models (Meshy, Tripo, and similar) export glTF and drop into the same path.
- Blender becomes necessary only if a model needs re-rigging or heavy mesh surgery. We avoid assets that need it.

### iOS notes

- Building for iOS needs a Mac with Xcode and, for TestFlight, an Apple Developer account. Neither is needed until we ship; the browser build runs on your iPhone from a link.
- WKWebView supports WebGL2 everywhere and WebGPU from iOS 26. We ship WebGL2 with WebGPU as an opt-in.
- Performance guardrails from day one: pixel-ratio cap, hardware scaling on low-end devices, capped ragdoll and particle counts, everything pooled.

---

## 4. Milestone 1: greybox playable

Goal: the loop is fun with boxes before any real art.

- Portrait road, three lanes, drag to move the squad
- Squad of capsules that auto-fire forward
- Gate rows every few seconds: `xN`, `+N`, `-N`, fire-rate up; shooting a gate changes its number
- Enemy blocks with HP numbers that remove units on contact
- One boss with an HP number and a stomp
- Result screen with survivors, retry, next level
- Ten generated levels with a difficulty curve, all from `data/`
- Delivered as a link you open on your phone; screenshots checked here in headless Chromium

Milestone 2 swaps in the KayKit mage and skeletons, adds three staffs, and starts the juice pass.

---

## 5. Remaining questions

1. Working title: keep "Arcane Rush", or something else?
2. Do you have a Mac with Xcode? Not needed yet, but it decides how we do the first device build.
3. Shall I start Milestone 1 now?
