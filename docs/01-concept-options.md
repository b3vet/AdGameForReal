# Concept options: lane-defense auto-shooter

Status: draft for discussion (round 1). Nothing here is final.

---

## 1. What the ad game actually is

The ads are fake, but they all advertise the same imaginary game. Deconstructed:

| Element | What the ads show | Why it works |
|---|---|---|
| Format | Portrait, camera behind and above the squad, road stretches to the horizon | One-thumb play, everything readable at a glance |
| Input | Drag left/right, squad follows the finger (continuous, not lane-snapped) | Zero learning curve |
| Squad | A cluster of small units that auto-fire forward, forever | Player never aims, only positions |
| Squad count | A number floating above the squad | The count is the score, the HP bar, and the progress bar at once |
| Rows of gates | Every few seconds a row of 2 to 3 gates: `x2`, `+5`, `-2`, weapon swap, fire-rate up | Forced choice under time pressure |
| Shootable gates | Shooting a gate raises its number (`+2` becomes `+9` if you keep firing) | Positioning becomes a skill: fire at the gate or at the enemies behind it |
| Enemy blocks | Crowds with an HP number on them; when they reach you, they remove units | DPS vs HP is simple arithmetic the player can feel |
| Bosses | A giant with a large HP number walking toward you | Payoff moment; the whole run was building the number to beat this number |
| The "wrong choice" | The ad picks `-2` instead of `x2` and loses | Viewer feels "I would have done better", which is the download hook |

Real games that come closest (useful references, not clones):

- **Mob Control** (Voodoo): the shootable-gate and multiplier math, best-in-class juice.
- **Count Masters** (Freeplay): crowd growth, finish-line multiplier lanes, boss at the end.
- **Archero / Survivor.io**: in-run upgrade card choice, weapon evolution, meta talents.
- **Top War / Last War**: the merge-to-upgrade meta that the ads' "Build, Merge, Battle" tagline refers to.

The feel to keep: numbers that visibly grow, one meaningful choice every 4 to 6 seconds, a boss whose number you are racing against, and 60 to 90 second runs that end in "one more".

---

## 2. Theme options

Constraint from you: not soldiers vs soldiers.

### A. Arcane Rush (recommended)

- **Your squad**: chibi apprentice wizards with staffs. Squad grows through summoning runes.
- **Enemies**: a monster horde. Goblin swarms, orc bruisers, skeletons, slimes, bat flocks, trolls.
- **Bosses**: ogre, stone golem, dragon (lane-wide breath), lich.
- **Weapons**: staffs, one element each. Ember (fireball, splash), Storm (chain lightning), Frost (slow, then shatter), Arcane (piercing beam), Meteor (charged AoE), Void (black hole that pulls and ragdolls), Nature (vines that root).
- **Gates**: summoning rune `x2`, mana potion `+N`, curse `-N`, staff swap, enchant (fire rate or damage), familiar (a pet that adds DPS).
- **Physics signatures**: frozen enemies shatter into chunks, lightning ragdolls, void lifts and drops, boss stomps shove your squad back, barrels and gates break into debris.
- **Why**: spells are the best possible excuse for fancy effects. Every weapon is a visual showcase. Enemy variety is enormous and readable at a distance. Bosses are iconic and huge. Upgrade fiction is natural (enchant, evolve, familiar). Free CC0 assets exist for exactly this (KayKit, Quaternius). It stands apart from the military look of every ad in this genre.
- **Risk**: fantasy is common. Mitigation is art direction (see section 4) and a strong, silly squad identity (apprentices, not grizzled wizards).

### B. Hive Rush

- **Your squad**: a swarm of bees. Grows at flowers. Weapons: stinger darts, honey blaster (slows), pollen bomb (AoE), thorn launcher.
- **Enemies**: wasps, hornets, spiders, caterpillars, a mantis mini-boss, a hornet queen boss. Lanes are garden rows, a picnic table, a windowsill.
- **Why**: extremely distinct, bright, cozy, family-friendly. Swarm movement (boids) is charming and cheap. Bees need no rig, just a wing flutter and a bob.
- **Risk**: bugs put some players off. Bosses are less epic. "Realistic physics" fits less well with tiny creatures.

### C. Scrap Squad

- **Your squad**: toy-sized robots. Grows at assembly gates. Weapons: laser, buzzsaw, magnet (pulls enemies in), EMP, rocket.
- **Enemies**: junkyard machines, drones, rogue vacuum bots, a compactor boss, a giant mech.
- **Why**: rigid-body destruction is the best-looking physics you can get on mobile: parts fly off, bolts scatter, no blood. Mechanical animation needs no skin weights, only hierarchies.
- **Risk**: robots vs robots reads a bit like soldiers vs soldiers. Less emotional charm.

### D. Hatchling Horde

- **Your squad**: baby dragons. Gates hatch more eggs. Weapons are breath types: fire, ice, lightning, poison, void. Upgrades are evolution (hatchling to wyrmling to drake), visible growth of the units themselves.
- **Enemies**: an invading siege army. Knights, orcs, catapults, siege towers, war elephants, a giant boss.
- **Why**: the most memorable identity of the four. Evolution as the upgrade path is a strong retention hook.
- **Risk**: dragons need winged quadruped rigs; free assets are scarce. Highest art cost.

### Considered and dropped

- **Zombies vs survivors**: the most saturated theme in mobile, and it pushes toward gore.
- **Space fleet vs alien swarm**: ships lose the "crowd of little guys" charm that makes the count feel personal.
- **Pirates vs sea monsters**: hard to stage on a lane; water physics is expensive.

### Comparison

| Criterion | A. Arcane | B. Hive | C. Scrap | D. Hatchling |
|---|---|---|---|---|
| Distinct from ad look | Good | Best | Weak | Best |
| Weapon and effect variety | Best | Good | Good | Good |
| Boss potential | Best | Fair | Good | Good |
| Physics fun | Good | Fair | Best | Good |
| Free asset availability | Best | Fair | Good | Poor |
| Animation cost | Medium | Low | Low | High |
| Family-friendly | Yes | Yes | Yes | Yes |

**Recommendation: A (Arcane Rush).** It scores highest on the things you asked for (fancy animations, weapon variety, upgrade paths) and lowest on production risk. B is the runner-up if you want something nobody else has.

---

## 3. Core loop

### Run structure

- One level is 60 to 90 seconds: 10 to 14 gate rows, a mini-boss around row 6, a boss at the end.
- Three lanes wide, free horizontal drag. Gates and enemy blocks occupy lanes; the squad can straddle two lanes.
- The squad count is the only resource in a run. Enemies that touch the squad remove units. Zero units ends the run.
- Level end: survivors × finish multiplier lane (`x2`, `x3`, `x5` lanes at the end, further lanes are better but guarded).
- Every 5th level is a boss level (longer boss, phases). Every 10th level changes biome (forest road, crypt, volcano bridge, sky bridge).

### Gates

| Gate | Effect | Notes |
|---|---|---|
| Rune `xN` | Multiplies squad | Rare, always paired with something worse |
| Potion `+N` | Adds units | Shootable: each hit adds to N |
| Curse `-N` | Removes units | Shootable: hits reduce the penalty toward 0, then flip it positive |
| Staff | Swaps weapon for the rest of the run | Shows the weapon icon and a preview shot |
| Enchant | Fire rate or damage up, stacking | Shootable to raise the bonus |
| Familiar | A pet joins (owl, cat, dragonling) with its own attack | Persistent within the run |
| Locked chest | Opens if you shoot it enough before reaching it | Reward is random, the risk is the enemies you ignored |

The core skill: the row behind a gate is visible, so the choice is "grow the number" or "clear the threat" and the player has 3 to 5 seconds to commit.

### Enemies (Arcane Rush)

| Enemy | Role |
|---|---|
| Goblin swarm | Many, fast, one HP each. Fireball and lightning food. |
| Orc bruiser | Tanky, slow, removes 3 units on contact. Beam and frost target. |
| Skeleton | Reassembles once after dying unless shattered while frozen. |
| Slime | Splits into two smaller slimes on death. Punishes splash weapons. |
| Bat flock | Flies over ground effects, arrives fast. Chain lightning counter. |
| Troll (mini-boss) | Throws boulders that must be dodged by moving lanes. |
| Ogre / Golem / Dragon / Lich (bosses) | HP number, phases, a lane-wide attack you must dodge. |

### Squad math (starting point)

```
squad DPS       = units × weapon damage × fire rate × enchant multiplier
gate value      = base + hits × hitBonus (capped)
contact damage  = enemy.contactKills units per touch
level HP budget = base × 1.12^level  (enemy HP scales, squad must keep up via meta)
```

### In-run choices

- Gate choices are the in-run upgrade system. No pause-menu card picks; that keeps the runner tempo.
- Optional after the mini-boss: a 3-card choice (Archero style) as a mid-run breather. Decide after prototyping.

### Meta progression (between runs)

- **Coins** (soft): permanent stat upgrades with visible level counters: damage, fire rate, starting squad, gate bonus, boss damage, crit.
- **Weapon cards**: from chests. Duplicates merge to evolve a staff (tier 1 to 5, each tier changes the look and adds a behavior, e.g. fireball gains a burn trail at tier 3).
- **Familiars**: collection with rarities, one equipped per run.
- **Academy**: a small build-up screen where each level unlocks a room (library, potion lab, aviary) that grants a passive. This is the "base" that makes the game feel like it grows.
- **Bestiary**: every enemy and boss seen is logged. Collection completion gives gems.

### Retention hooks

- Runs chain instantly; the next level button is the biggest thing on the result screen.
- Result screen: survivors count up with a rising tone, then a reward wheel, then an ad-for-x2 offer.
- Revive once per run (ad or gems) with a fresh squad of 10.
- Daily quests, login streak, a free chest timer (4 hours), offline coin income from the academy.
- Boss levels drop guaranteed weapon cards.
- Limited events: a weekend biome with unique enemies and a cosmetic reward.

### Juice checklist (this is where "lots of fancy animations" lives)

- Staff recoil, muzzle flare, spell trails, impact decals, damage number pops.
- Hit flash and squash on every enemy hit; hit-stop for 2 to 3 frames on kills.
- Ragdoll deaths pooled and capped; beyond the cap, baked death animations.
- Gate pass: glass shatter, unit clones pop in with a scale bounce, number bumps.
- Camera: subtle shake on boss hits, dolly-back as the squad grows, slow-mo and zoom on boss kill.
- Confetti and a fanfare on level clear; result numbers roll up.
- Squad idle: units bob, chatter, wave staffs between rows.

---

## 4. Visual direction

- **Look**: stylized low-poly with flat-shaded colors, soft shadows, bloom on spells, chibi proportions (big heads, short legs). This reads as "3D-ish realistic" at phone size and is the look Synty and KayKit assets already have.
- **Palette**: warm road and stone, cool horde (greens, purples), your squad in one saturated signature color (blue and gold) so the count is always readable.
- **Lighting**: one directional light, baked ambient, vignette, light fog toward the horizon.
- **Camera**: portrait, behind and above, 55 to 60 degree FOV, pulls back as the squad grows.
- **UI**: chunky rounded type (Lilita One or Luckiest Guy from Google Fonts), numbers always outlined, all interactive elements bottom-third of the screen.

### Asset sources

| Source | License | Use |
|---|---|---|
| KayKit (Adventurers, Skeletons, Dungeon, Halloween) | CC0 | Squad, enemies, props. Rigged and animated. |
| Quaternius (Ultimate Monsters, RPG Characters) | CC0 | More enemies and bosses |
| Kenney (particle packs, UI, audio) | CC0 | VFX sprites, UI, SFX |
| Mixamo | Free | Extra animations for humanoid rigs |
| Synty POLYGON packs | Paid, ~30 to 70 USD each | Upgrade path if we want more polish |
| Freesound / Kenney audio | CC0 | SFX |

---

## 5. Tech stack

| | Unity 6 (URP, C#) | Godot 4.4 (GDScript or C#) | Three.js + Rapier (web) |
|---|---|---|---|
| Genre fit | The genre standard. Every reference game is Unity. | Good, less proven for this genre on mobile | Fine for prototyping, feasible for shipping via Capacitor |
| Crowds (hundreds of units) | GPU instancing plus baked animation textures; Jobs and Burst | MultiMesh plus a vertex-animation shader (we write it) | InstancedMesh plus animation textures |
| Physics | PhysX, ragdolls are standard | Jolt built in | Rapier (WASM), fast |
| Effects | Shader Graph, VFX Graph, Feel or DOTween for juice | Particles and shaders, glow in the Mobile renderer | postprocessing library, custom shaders |
| Ads and IAP | Mature: LevelPlay or AppLovin MAX, Unity IAP, Firebase | Community plugins (AdMob, Play Billing, iOS IAP); no first-class mediation | Capacitor plugins (AdMob community, RevenueCat official) |
| Build size | ~40 to 60 MB | ~25 to 40 MB | ~10 to 20 MB |
| Cost | Free under 200k USD/yr revenue | Free, open source | Free |
| Can Claude build and run it in this environment? | No. I write code and scenes; you press play. | Yes, headless runs and tests | Yes, and screenshots via Chromium, and playable links on your phone |

### Recommendation

1. **Prototype now in Three.js + Rapier** (web). I can build, run, screenshot, and hand you a link you play on your phone within the same day. We use it to nail the theme, gate pacing, squad math, and juice. It also becomes the HTML5 playable ad later, which is the ad format this genre lives on.
2. **Ship in Unity 6 with URP** once the prototype proves the loop. Best ad mediation, best asset ecosystem, best crowd-rendering tooling. Data (levels, gate tables, enemy stats, tuning) moves over as JSON and is engine-agnostic from day one.
3. **Alternative if you want me to own the whole pipeline end to end**: Godot 4.4. I can compile, test, and export it here. The trade is weaker ad mediation and more shader work for crowds.
4. **Alternative if the prototype already looks good enough**: keep the web stack and wrap with Capacitor. Skips the port. Ceiling is lower on effects and thermal budget.

### Performance budget (mid-range Android, 60 fps)

- Up to ~150 visible squad units and ~200 enemies via instancing.
- Up to ~30 live ragdolls, pooled; the rest die with baked animations.
- Particles capped per weapon; effects scale down automatically on low-end devices.

---

## 6. Open questions for you

1. Theme: A as recommended, or B, C, D, or a twist on one of them?
2. Your own toolset: any Unity or C# experience? Godot? Web? Blender?
3. Platform order: Android first, iOS first, both?
4. Art budget: strictly free CC0, or open to buying a few Synty packs?
5. Monetization: ad-driven casual (rewarded ads and interstitials) or IAP-leaning with a bigger meta?
6. Session model: pure level runner, or runner plus a light academy meta as proposed?

---

## 7. Proposed roadmap

1. Lock theme and stack (this discussion).
2. Game design document: gate tables, enemy stats, first 20 levels, meta economy v1.
3. Greybox prototype: lane, drag, auto-fire, gates with hit-to-grow, enemy blocks, one boss, result screen.
4. Juice pass: hit flash, ragdolls, shatter, camera, numbers, sound.
5. Art pass: real assets, biome 1, UI.
6. Meta: coins, upgrades, chests, weapon evolution, academy.
7. Retention and monetization: dailies, wheel, ads, IAP.
8. Store build, analytics, soft launch.
