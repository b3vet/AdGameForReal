# Running Arcane Rush on your iPhone

Written for the product owner. Everything below happens on the Mac, in order.

Nothing here changes the game: the device build is the same web build (decision
D34) wrapped by Capacitor so it runs as an app — full screen, no browser
chrome, no status bar, with haptics. The Xcode half is done once. After that,
putting a new version on the phone is one command and a Cmd+R.

Unlike earlier versions of this guide, **the iOS project is already in the
repository** (D57). There is nothing to generate, no orientation to tick, no
plist to edit. Clone, install, run three commands, sign, play.

---

## 0. What you need before you start

| Thing | Notes |
|---|---|
| A Mac | Any Mac running a current macOS. |
| Xcode | Free from the Mac App Store (~10 GB, slow). Open it once after installing, accept the licence, and let it install its extra components. |
| Command line tools | `xcode-select --install` in Terminal. Usually already done if Xcode was installed first. |
| Node 22 | `node -v` should say `v22.x`. Anything older will install different packages than the lock file expects. |
| An Apple ID | The free one you already have is enough to run the game on your own phone. A paid Apple Developer Program membership ($99/year) is only needed for TestFlight — section 7. |
| An iPhone | iOS 16.2 or newer for the full look (the UI kit mixes colours with `color-mix`, which Safari added in 16.2; on iOS 15 to 16.1 the game plays with plain fallback colours). Plus its cable. |

**You do not need CocoaPods.** Capacitor 8 builds the iOS project with Swift
Package Manager, and Xcode resolves the packages itself the first time it opens
the project. The thing you open is `ios/App/App.xcodeproj`, and
`npm run cap:open` opens it for you.

---

## 1. First time: from a fresh clone to Xcode

Four commands, and one thing that is not a command.

```bash
git clone <the repository url>
cd AdGameForReal
npm ci
```

`npm ci` installs exactly what the lock file says, which is what everything
below is tested against. (`npm install` also works but may drift.) It takes a
few minutes the first time.

**Then drop your art.** The repository ships placeholders so that it builds an
app before you have done anything, but they are placeholders. Replace two files:

```
assets/app/icon.png      1024 x 1024, square, opaque — iOS rounds the corners itself
assets/app/splash.png    2732 x 2732, subject inside the middle 40%
```

`docs/ART.md` has the exact sizes, the safe zones, and the prompts to paste into
your image generator. Nothing else in `assets/app/` has to change.

Then:

```bash
npm run cap:assets     # cuts your two files into every icon and splash size iOS wants
npm run cap:sync       # builds the game and copies it into the iOS project
npm run cap:open       # opens Xcode
```

If you want to know whether you are ready before you start, this says so and
prints the one command you are due next:

```bash
npm run cap:preflight
```

It checks the art and its pixel sizes, the config, the project, the Info.plist
keys, the privacy manifest, the version stamp, the plugins and whether the
built game is current — everything about the device build that can be checked
without Xcode. It ends with a line reading `next: <command>`. Run that.

---

## 2. First time: sign and run

Xcode is now open on the **App** project. Once, ever:

1. In the left sidebar click the blue **App** project at the top, then the
   **App** target, then the **Signing & Capabilities** tab.
2. Tick **Automatically manage signing**.
3. **Team**: pick your Apple ID. If the list is empty, choose *Add an
   Account…*, sign in, and then pick the team that appears — it is called
   "Your Name (Personal Team)".
4. If Xcode says the bundle identifier is unavailable, see section 4 before
   changing it: it lives in two files and both have to agree.
5. Plug the phone in, unlock it, and tap **Trust** on the phone if asked.
6. At the top of the Xcode window, next to the App scheme, open the destination
   dropdown and pick your iPhone — **not** a simulator. The simulator has no GPU
   worth measuring and no haptics.
7. Press **Run** (the play button, or Cmd+R).

There is deliberately no step here about orientation, the status bar or the
display name. All three are in the project already (section 9).

The first run ends with the app installed but refused by the phone:

> Untrusted Developer

On the phone: **Settings → General → VPN & Device Management → Developer App →
your Apple ID → Trust**. Then press Run in Xcode again, or just tap the app's
icon.

With a free Apple ID the app stops launching after **seven days**. Pressing Run
in Xcode again gives you another seven. A paid account makes it a year.

---

## 3. Every time after that

```bash
git pull
npm ci                 # only when the pull changed package-lock.json; harmless otherwise
npm run cap:sync       # build + copy + stamp the version
```

then Run (Cmd+R) in Xcode. If Xcode is closed, `npm run cap:open` first.

`npx cap add ios` is never run again — the project is in the repository.

Two things `cap:sync` does that matter:

- It is what installs the native side of a plugin, so a pull that adds one
  needs nothing else from you.
- It stamps the version and build number from `package.json` into the Xcode
  project, so the number in the App Store and the number in the repository can
  never disagree. (`npm run cap:version` on its own does just that part.)

---

## 4. If you change the bundle identifier

The app id is in **two** places and they must say the same thing:

- `appId` in `capacitor.config.ts` — the placeholder is `com.arcanerush.app`
- **Bundle Identifier** in Xcode's Signing & Capabilities

Change `capacitor.config.ts` first, then run `npm run cap:sync`, which writes it
into the Xcode project for you. If you change it only in Xcode, the next
`cap sync` quietly writes the config's id back over yours and Xcode asks you to
sign all over again. `npm run cap:preflight` fails loudly if the two ever drift.

Changing the id after the app is installed makes a **new app** on the phone, not
an update — a second icon, and a fresh save. Pick one and keep it.

---

## 5. What to send back

Play three or four levels, then send us the report and the six answers.

### The report (do this first)

Triple-tap the wordmark on the title screen, or the level chip during a run, to
show the debug panel in the bottom-left corner. It has three buttons:

- **Capture 10s** — records ten seconds of frame numbers into a short summary.
  Press it during a busy fight, not on a menu.
- **Copy report** — puts the whole device report on the clipboard: the phone and
  iOS version, the screen size and pixel ratio, what the GPU calls itself, the
  quality rung the game settled on, the last capture's numbers, the last run's
  summary, and where your save has got to. **Paste it at the top of the message
  you send us**, above anything you write. It is the one thing that makes every
  other answer comparable between builds.
- **Show report** — prints the same text into the panel, for when the clipboard
  refuses to cooperate. Photograph it and send the photo.

The report contains no identifier of any kind. It is the phone, the GPU, the
numbers and your progress — nothing about you (D6).

Best order: play a level, press **Capture 10s** during the heaviest fight, let
it finish, then press **Copy report** on the result sheet. The capture is in the
report.

### Then, in your own words

1. **Touch feel.** Does the squad track your thumb, or lag behind it? Does a
   drag that starts on a button still steer? Anything heavier or stickier than
   playing the link in Safari.
2. **Haptics.** You should feel a light tick as you pass a gate row, a firmer
   one when a shielded brute's shield goes, when a charger sets off and on each
   boss stomp, a heavy one on a meteor crater, on the Rime Fiend starting its
   charge and when a boss dies, a success buzz when you win a level or when a
   mission or a bestiary tier pays out, and a warning buzz on a wipe. **Nothing
   at all during ordinary shooting.** Tell us if it is too much, too little, or
   in the wrong place.
3. **Thermals, after ten minutes of continuous play.** Is the phone hot to hold?
   Did the frame rate fall, and did the `quality` rung climb (which means the
   game noticed and stepped itself down)? Roughly how much battery did ten
   minutes cost? Press **Copy report** again at the end of the ten minutes and
   send that one too — the two together are the story.
4. **Launch.** How long from tapping the icon to the Academy, and how the
   colour behaves on the way. The launch storyboard, the native background, the
   splash art and the page under the canvas are all one colour, `#8fc6f2`, so
   launch should be one flat daylight blue until the road appears on it. Any
   colour change at all before the game draws — a step to a paler or deeper
   blue, a white or black frame — is a bug: tell us what colour and at what
   moment. (The exception is a phone in **dark mode**, which paints one pale
   frame before the dark splash; that one is known.)
5. **Pause and resume.** Switch away mid-run — swipe to the home screen, or pull
   down Notification Centre — wait a few seconds, and come back. The run should
   be exactly where you left it, not further on, and the sound should come back
   with it.
6. **Safe areas.** On a notched phone: does anything sit under the notch or
   under the home-indicator bar? Buttons, the coin chip, the level chip, the
   result sheet's buttons.

### If you want the scripted performance run

There is a 30-second scripted capture on level 20 that plays itself and shows
the report at the end. It needs a query string, which an app has no address bar
for, so it is a Web Inspector job (section 6): with the app running and the
inspector attached, type this in the console and press return.

```js
location.search = '?perf'
```

It reloads, plays itself, and leaves the report on screen. Press **Copy report**
when it stops.

---

## 6. When something is wrong

| What you see | What it is |
|---|---|
| White or black screen, no game | The web build was not copied. `npm run cap:sync`, then Run again. |
| The old version of the game | The same: `cap:sync` before every Run. |
| The splash sits there | The game failed to boot; the splash gives up after 8 seconds on its own. Use the Web Inspector below to read the error. |
| A colour flash before the game — white, black, or a different blue | The native shell colour and the page background have drifted apart. `npm run cap:preflight` says so in one line, and it is one constant either side. Tell us; it is not yours to fix. |
| "Untrusted Developer" | Section 2, the step after Run. |
| "The app could not be launched" after a week | Free-account expiry. Press Run in Xcode again. |
| Signing errors in red | Signing & Capabilities: team not set, or a bundle id someone else already used. Section 4. |
| Status bar visible over the game | Tell us. It is off in the Info.plist *and* hidden again at boot, so both failed. |
| The app rotates to landscape | Tell us. Same: locked in the Info.plist and again at boot. |
| `npm ci` fails on a package | Check `node -v` is 22.x. |
| Xcode: "Missing package product CapacitorApp" | Xcode has not fetched the Swift packages yet. **File → Packages → Resolve Package Versions**, then build again. |
| Xcode build error mentioning `capacitor.config.json` or `public` | Those are generated, not committed. `npm run cap:sync` creates them. |
| The screen goes black or flat-grey for a moment mid-run, then the scene comes back | A **WebGL context loss**. iOS throws the graphics context away under memory pressure and when the app has been in the background a while; the renderer notices and rebuilds. This is handled, and the run is meant to survive it. |
| ...and the run does **not** survive it | That is the bug. Tell us what you were doing, whether you had just come back from the background, whether the textures came back wrong (flat colours, black models), and whether the HUD still responded. |
| Everything is flat and untextured after a resume | The same thing, half-recovered. Worth a photo. |

**Web Inspector** — the console, for anything strange. On the phone: *Settings →
Apps → Safari → Advanced → Web Inspector* on. On the Mac: Safari → Settings →
Advanced → "Show features for web developers", then **Develop → [your iPhone] →
App**. You get the full console of the running game, including the scripted run
in section 5.

---

## 7. Later: TestFlight

Only when other people should be playing it, and only with a paid **Apple
Developer Program** membership. `docs/STORE.md` holds the listing — name,
description, keywords, age rating, privacy answers, screenshots — so that none
of it is invented on the night. The mechanics:

1. Join the Apple Developer Program with the same Apple ID.
2. In App Store Connect, create an app record with the bundle id from section 4
   and the name from `docs/STORE.md`.
3. Make sure the version is what you want to ship: it comes from
   `package.json` (`0.9.0` → build `900`). Bump it there, run
   `npm run cap:sync`, and both numbers follow. A second upload of the *same*
   version needs a higher build number: `npm run cap:version -- --build 901`.
4. In Xcode: set the team to the paid team, pick **Any iOS Device** as the
   destination, then **Product → Archive**.
5. In the Organizer window that opens: **Distribute App → TestFlight & App
   Store**, and let Xcode upload.
6. Export compliance is not asked — the Info.plist already answers it
   (`ITSAppUsesNonExemptEncryption` false). The privacy answers are already in
   the app's privacy manifest, and `docs/STORE.md` section 5 has the same
   answers for the App Store Connect form.
7. **Internal testers** (up to 100, on your own account) get the build as soon
   as it finishes processing, with no review.
8. **External testers** (up to 10,000, by link or email) need a short
   **Beta App Review** on the first build of each version — usually a day.
   For that Apple wants a beta description, a contact email, and the review
   notes from `docs/STORE.md` section 9. Later builds of the same version go
   out without another review.

A TestFlight build expires after 90 days.

---

## 8. Later: Android

The Android project is in the repository too (`android/`), generated the same
way and carrying the same portrait lock, version stamp and adaptive icon. It is
not the platform being tested — iOS first (D4) — and nobody has built it on a
device yet, so treat it as ready rather than proven.

When it is wanted: install Android Studio, then

```bash
npm run cap:sync:android
npm run cap:open:android
```

and Run. `npm run cap:assets` already generated its launcher icons and splash
screens from the same two files as iOS.

One known wrinkle: from Android 16 the status bar's background and overlay
settings are no longer under an app's control, so the shell there looks slightly
different from iOS however it is configured.

---

## 9. What the wrapper actually contains

Reference. Nothing here needs doing.

### Commands

| Command | What it does |
|---|---|
| `npm run cap:preflight` | Every check that does not need Xcode, then the one command you are due next. |
| `npm run cap:assets` | Cuts `assets/app/*` into the iOS and Android icon and splash catalogues. Run after changing the art, never otherwise. |
| `npm run cap:version` | Stamps `package.json`'s version and a derived build number into both native projects. `cap:sync` runs it. |
| `npm run cap:sync` | `npm run build`, then the stamp, then `npx cap sync ios`. The one command before every Run. |
| `npm run cap:open` | Opens `ios/App/App.xcodeproj` in Xcode. |
| `npm run cap:sync:android`, `npm run cap:open:android` | The same two for Android. |

### Files

| File | What it does |
|---|---|
| `capacitor.config.ts` | App id, app name, the `dist/` folder to ship, the full-screen WebView settings, and the splash, background and status bar settings. Every field is commented; the shell colour is the constant `APP_BACKGROUND`. |
| `ios/` | The Xcode project, committed (D57). Yours to open and sign; not yours to hand-edit. |
| `android/` | The Gradle project, committed, same deal. |
| `assets/app/` | The two files you replace, plus the Android adaptive-icon layers. `docs/ART.md`. |
| `src/device/platform.ts` | Answers "are we in the app, and is it iOS". Everything else asks it first, which is why the browser builds never call anything native. |
| `src/device/shell.ts` | Hides the status bar, locks the orientation, holds the launch splash until the game's first frame (and drops it after 8 s regardless), and keeps the screen awake during play. |
| `src/device/lifecycle.ts` | Pause on background, resume on foreground, and a save flushed on the way out. |
| `src/device/haptics.ts` | The taps listed in section 5, throttled as a group, and inert in a browser. |
| `src/core/report.ts` | The text behind **Copy report**. |
| `scripts/cap-preflight.mjs` | `npm run cap:preflight`, with `cap-native.mjs` (the checks that read the two projects) and `cap-facts.mjs` (the paths and the PNG and plist readers) behind it. |
| `scripts/cap-version.mjs` | `npm run cap:version`. |
| `scripts/probe-safe-area.mjs` | `npm run device:probe:safe-area` — builds, then walks every screen at 390x844 with a 47 px notch and a 34 px home indicator simulated, and fails if anything readable or pressable is inside either band. Nothing you need to run; it is how section 6's answer is checked here. |
| `scripts/probe-context-loss.mjs` | `npm run device:probe:context-loss` — builds, then takes the WebGL context away mid-run and gives it back, and fails unless the run survives and the next frame is drawn. The iOS behaviour section 5 asks about, reproduced on this side. |

### The iOS settings that are already set

These are the reason section 2 has no checklist of Xcode toggles in it. They
live in `ios/App/App/Info.plist` and the Xcode project, and
`npm run cap:preflight` checks every row below — a plist or privacy-manifest key
that has drifted fails it outright, a device-family change warns.

| Setting | Value | Why |
|---|---|---|
| `CFBundleDisplayName` | `Arcane Rush` | The name under the icon. |
| `UISupportedInterfaceOrientations` | Portrait only | The road, the camera and every HUD plaque are built for one orientation. |
| `UIRequiresFullScreen` | true | No Split View or Stage Manager window handing the game an aspect ratio it has never seen. |
| `UIStatusBarHidden` | true | The bar is gone from the first frame, not from whenever the plugin call lands — it sits exactly where the level chip and the squad count are. |
| `UIViewControllerBasedStatusBarAppearance` | true | `@capacitor/status-bar` does nothing at all without it. |
| `ITSAppUsesNonExemptEncryption` | false | Export compliance, answered once here instead of on every upload. |
| `UIRequiredDeviceCapabilities` | `arm64` | The Capacitor template still asks for 32-bit `armv7`. |
| `CFBundleShortVersionString` / `CFBundleVersion` | `$(MARKETING_VERSION)` / `$(CURRENT_PROJECT_VERSION)` | Both stamped from `package.json` by `cap:version`; no literal numbers anywhere. |
| `TARGETED_DEVICE_FAMILY` | `1` | iPhone only. It also means the App Store never asks for iPad screenshots. |
| `PrivacyInfo.xcprivacy` | no tracking, no collected data | Plus the three required-reason APIs WebKit's own storage uses: app-scoped user defaults (`CA92.1`), file timestamps inside the app container (`C617.1`), and the free-space check before a write (`E174.1`). Capacitor's frameworks declare none, so this file is where they live. |

The Android project carries the equivalents: `android:screenOrientation="portrait"`,
`versionCode` / `versionName` from the same stamp, and the adaptive icon
`cap:assets` generates.
