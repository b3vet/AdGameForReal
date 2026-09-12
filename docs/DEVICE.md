# Running Arcane Rush on your iPhone

Written for the product owner. Everything below happens on the Mac, in order.
Nothing in this guide changes the game: the device build is the same web build
(decision D34), wrapped by Capacitor so it runs as an app with haptics, no
status bar and no browser chrome.

You do the Xcode half once. After that, shipping a new version to the phone is
two commands.

---

## 0. What you need before you start

| Thing | Notes |
|---|---|
| A Mac | Any Mac that runs a current macOS. |
| Xcode | Free from the Mac App Store (~10 GB, slow download). Open it once after installing, accept the licence, and let it install its extra components. |
| Command line tools | `xcode-select --install` in Terminal. If Xcode was installed first, this is usually already done. |
| Node 22 | Same as the repo uses (`node -v` should say v22.x). |
| An Apple ID | The free one you already have is enough to run the game on your own phone. A paid Apple Developer account ($99/year) is only needed for TestFlight — see the end. |
| An iPhone | iOS 15 or newer, plus its cable. |

**You do not need CocoaPods.** Capacitor 8 creates the iOS project with Swift
Package Manager by default, and Xcode resolves the packages itself the first
time it opens the project. (If you ever need the old CocoaPods layout instead,
it is `npx cap add ios --packagemanager cocoapods`, it needs `brew install
cocoapods`, and then the thing you open is `ios/App/App.xcworkspace` rather than
`ios/App/App.xcodeproj`. You should not need this.)

---

## 1. First time: create the iOS project

In Terminal, in the repo:

```bash
npm install          # picks up the Capacitor packages
npm run build        # the web build the app will ship
npm run cap:preflight   # optional: checks the build and the config, prints these steps
npx cap add ios      # ONCE, EVER. Creates the ios/ folder.
```

`npx cap add ios` prints a lot and ends with `sync finished`. It creates `ios/`,
which is **part of the repo** — commit it (`git add ios && git commit`). It
carries the Xcode project, the app icons and your signing settings, and we do
not want to regenerate it every time. Build products inside it (`ios/App/build`,
`ios/App/Pods`, `DerivedData`) are already ignored.

If it fails, read the last line: almost always a missing Xcode or command line
tools, both of which section 0 fixes.

---

## 2. First time: sign and run

```bash
npm run cap:sync     # builds the web app and copies it into ios/
npm run cap:open     # opens the project in Xcode
```

In Xcode:

1. In the left sidebar click the blue **App** project at the top, then the
   **App** target, then the **Signing & Capabilities** tab.
2. Tick **Automatically manage signing**.
3. **Team**: pick your Apple ID. If the list is empty, choose *Add an
   Account…*, sign in with your Apple ID, and then pick the team that appears
   (it is called "Your Name (Personal Team)").
4. If Xcode complains that the bundle identifier is unavailable, change
   **Bundle Identifier** to something unique — e.g. `com.yourname.arcanerush`.
   **The app id lives in two places and both have to say the same thing**:
   Xcode's *Bundle Identifier* field here, and `appId` in `capacitor.config.ts`
   (the placeholder is `com.arcanerush.app`). Change both, then run
   `npm run cap:sync` again. If they disagree, `cap sync` quietly writes the
   config's id back over the project's and Xcode asks you to sign all over
   again.
5. **General > Deployment Info > iPhone Orientation**: leave **Portrait** ticked
   and untick the landscape boxes. The game is portrait only.
6. Plug the phone in, unlock it, and tap **Trust** on the phone if asked.
7. At the top of the Xcode window, next to the App scheme, open the destination
   dropdown and pick your iPhone (not a simulator — the simulator has no GPU
   worth measuring and no haptics).
8. Press **Run** (the play button, or Cmd+R).

The first run ends with the app installed but refused by the phone:

> Untrusted Developer

On the phone: **Settings > General > VPN & Device Management > Developer App >
your Apple ID > Trust**. Then press Run in Xcode again (or just tap the app's
icon).

With a free Apple ID the app stops launching after **seven days**. Pressing Run
in Xcode again gives you another seven. A paid account makes this a year.

---

## 3. Every time after that

You only ever repeat this:

```bash
npm run cap:sync     # build + copy into the iOS project
npm run cap:open     # only if Xcode is not already open
```

then Run (Cmd+R) in Xcode. `npx cap add ios` is never run again.

If you pulled a commit that adds or removes a Capacitor plugin, `cap:sync`
handles that too — it is what installs the native side of a plugin.

---

## 4. What to report back

Play three or four levels, then send us:

1. **Frame rate.** Triple-tap the wordmark on the title screen (or the level
   chip during a run) to toggle the debug panel. Report the `fps` line, the
   `quality` rung (0 means nothing has been degraded; it only ever goes up), the
   `draws` line, and — this is the one that matters most — the `>20ms N/10s`
   count (frames that took longer than 20 ms in the last ten seconds), read
   during a busy fight. The `Capture 10s` button records a window of the same
   numbers. A photo of the panel is a perfect report.
2. **Touch feel.** Does the squad track your thumb, or lag behind it? Does a
   drag that starts on a button still steer? Anything that feels heavy or
   sticky compared to playing the link in Safari.
3. **Haptics.** You should feel exactly three things: a medium bump on each boss
   stomp, a heavy one when the boss dies, and a short success buzz when you win
   a level. Nothing during ordinary shooting. Tell us if it is too much, too
   little, or in the wrong place.
4. **Thermals, after ten minutes of continuous play.** Is the phone hot to hold?
   Did the frame rate fall, and did the `quality` rung climb (which means the
   game noticed and stepped itself down)? Roughly how much battery did ten
   minutes cost?
5. **Launch.** How long from tapping the icon to the Academy, and whether the
   colour flashes on the way. It should not: the launch splash, the native
   background and the page all paint the same daylight sky, `#bfe4f5`
   (`APP_BACKGROUND` in `capacitor.config.ts`, the `html, body` rule in
   `src/ui/styles.css`), so the only thing that appears is the scene fading up
   over it. A flash of any other colour — the old dark indigo especially —
   means the two have drifted apart, and it is one constant either side.
6. **The phone.** Model and iOS version, so the numbers mean something.

---

## 5. When something is wrong

| What you see | What it is |
|---|---|
| White or black screen, no game | The web build was not copied. Run `npm run cap:sync` and Run again. |
| The old version of the game | Same: `cap:sync` before every Run. |
| The splash sits there | The game failed to boot; the splash gives up after 8 seconds by itself. Use the Web Inspector (below) to read the error. |
| A dark flash before the game | `APP_BACKGROUND` in `capacitor.config.ts` and the `html, body` background in `src/ui/styles.css` have drifted apart. Both are `#bfe4f5`; make them agree and `npm run cap:sync`. |
| "Untrusted Developer" | Section 2, step after Run. |
| "The app could not be launched" after a week | Free-account expiry: press Run in Xcode again. |
| Signing errors in red | Signing & Capabilities: team not set, or a bundle id someone else already used. Change the bundle id (section 2, step 4). |
| Status bar visible over the game | Tell us — `src/device/shell.ts` hides it at boot and that call failed. |

**Web Inspector** (the console, for anything weird): on the phone, *Settings >
Apps > Safari > Advanced > Web Inspector* on. On the Mac, Safari > Settings >
Advanced > "Show features for web developers", then **Develop > [your iPhone] >
App**. You get the full console and network panel of the running game.

---

## 6. Later: TestFlight

Only when we want other people playing it, and only with a paid **Apple
Developer Program** membership ($99/year). The outline, so it is not a surprise:

1. Join the Apple Developer Program with the same Apple ID.
2. In App Store Connect, create an app record with our bundle id
   (`com.arcanerush.app`, or whatever you chose) and a name.
3. In Xcode, set the team to the paid team, pick **Any iOS Device** as the
   destination, and **Product > Archive**.
4. In the Organizer window that opens: **Distribute App > TestFlight & App
   Store**, and let Xcode upload it.
5. Answer the export-compliance question (the game uses no encryption beyond
   standard HTTPS) and the privacy questions (we collect nothing: no ads, no
   IAP, no analytics — that is a standing decision, D6).
6. Add testers in App Store Connect. They install TestFlight and get the build.

Before that we owe the app a real icon and launch image; that is a job for us,
not for you.

---

## 7. Later: Android

Not installed yet, on purpose: iOS first (D4). When we want it, we add
`@capacitor/android`, run `npx cap add android` once, and you install Android
Studio. The same `cap:sync` flow applies. One known wrinkle for later: on
Android 16 the status bar's background colour and overlay settings are no longer
under an app's control, so the shell there will look slightly different.

---

## 8. What the wrapper actually contains

For reference, nothing here needs doing:

| File | What it does |
|---|---|
| `capacitor.config.ts` | App id (the one that must match Xcode's Bundle Identifier), app name, the `dist/` folder to ship, the full-screen WebView settings, and the splash, background and status bar settings — the shell colour is `#bfe4f5`, the same daylight sky `src/ui/styles.css` paints. Every field is commented. |
| `src/device/platform.ts` | Answers "are we in the app, and is it iOS". Everything else asks it first, which is why the browser builds never call anything native. |
| `src/device/shell.ts` | Hides the status bar, holds the splash until the game's first frame (and drops it after 8 s regardless), and keeps the screen awake during play. |
| `src/device/haptics.ts` | Boss stomp, boss death, level won. Throttled, and inert in a browser. |
| `src/device/simTap.ts` | How haptics get told about those three events without touching the game loop. |
| `scripts/cap-preflight.mjs` | `npm run cap:preflight`: checks the web build exists and the config parses, then prints the steps above. |

The iOS folder itself (`ios/`) is generated by `npx cap add ios` and then
committed; it is Xcode's project, not ours to hand-edit, apart from the signing
and orientation settings in section 2.
