# App Store listing: Arcane Rush

Everything App Store Connect will ask for, written down before it asks, so that
nothing is invented at two in the morning with an upload waiting (Milestone 9,
`docs/25-milestone-9-plan.md` section C).

This is a **draft for the product owner to approve**, not a decision already
taken. Two fields need a human judgement and are marked **[decide]**. Everything
else is either a fact about the build or copy that can be used as it stands.

`docs/DEVICE.md` is the other half: how to get a build onto a phone and into
TestFlight. This file is only what goes *around* the build.

---

## 1. App information

| Field | Value | Note |
|---|---|---|
| Name | `Arcane Rush` | 11 of the 30 characters allowed. Matches `appName` in `capacitor.config.ts` and `CFBundleDisplayName`. |
| Subtitle | `Drag. Fire. Break the horde.` | 28 of 30. Alternates below. |
| Bundle ID | `com.arcanerush.app` | The placeholder in `capacitor.config.ts`. If the owner changes it in Xcode it must change in both places — `docs/DEVICE.md` section 4. |
| SKU | `arcane-rush-ios` | Never shown to anyone; it only has to be unique in the account. |
| Primary language | English (U.S.) | The only language the game has. |
| Copyright | `© 2026 <owner name>` | App Store Connect wants a legal name or company here, not a handle. |
| Primary category | Games → **Action** | The loop is a reflex loop: one thumb, a moving crowd, a lane to pick. |
| Secondary category | Games → **Casual** | Where lane-runners are browsed. The App Store's Games list has no *Arcade* subcategory — that is Google Play's name, and it is what to pick there when Android's turn comes. The alternative here is *Family*, which widens the audience but only makes sense once the age rating in section 4 is settled at 9+. **[decide]** |
| Price | Free | No ads, no IAP — a standing decision (D6), not an oversight. |
| Age rating | see section 4 | |

Subtitle alternates, if the first reads too blunt:

- `A squad of wizards, one road.` (29)
- `One lane. One growing squad.` (28)
- `Grow the squad. Break the line.` (31 — one over, needs a trim)

---

## 2. Description

Under the 4000-character limit (this draft is about 1500), written in the voice
the game already uses on its own cards: short sentences, concrete nouns, no
exclamation marks.

```
Your apprentices fire on their own. Your job is the road.

Drag your thumb and the squad follows it, one lane wide and growing
backwards as it grows. Every gate you walk through is a choice you make
with your thumb: the one that doubles you, or the one that was closer.

Ahead of you the road fills. Skeletons in blocks with a number painted on
them. A charger that waits in its lane and then runs it down. A brute
behind a slab of ice whose number will not move until the shield does. At
the end of every road something bigger is waiting, and it stomps.

FORTY LEVELS, TWO ROADS
The meadow road, and then Frostfell — white, and colder in every sense.
Two bosses, each with its own idea of how to reach you.

THE ACADEMY
Coins come from clears. Spend them in the Yard on the squad, at the
Workbench on the staff — ember, storm or frost, each with three
evolutions that change what the staff does rather than how hard it hits —
and in the Sanctum on a wisp that hunts beside you.

NAME THE HORDE
Every kind you kill goes in the bestiary, and the bestiary pays: hunt a
kind enough times and the Wardrobe opens another tint for the hats, the
capes, the wisp and the staff's glow.

EVERY DAY
Three missions that rotate, and a streak that counts the days you came
back. Both pay in coins. Neither costs anything.

ENDLESS
One road, no end. Seeded, so the run you had is a run you can hand to
somebody else.

Arcane Rush is one player, offline, and finished. There are no adverts,
nothing to buy, no account to make, and nothing about you leaves your
phone.
```

Promotional text (170 characters, editable without a new build — use it for what
is new in a release):

```
Forty levels across two roads, three staffs with three evolutions each, a
bestiary that pays in colour, and an endless run. No ads. Nothing to buy.
```

---

## 3. Keywords

100 characters, comma-separated. Spaces between keywords count against the
limit, so there are none. The app's own name and its category never go in the
field — Apple already indexes both.

```
lane,runner,crowd,squad,wizard,magic,shooter,arcade,casual,offline,gate,boss,rush,horde,defense
```

That is 95 characters. The five spare characters are deliberate: a keyword
nobody searches costs the same as one everybody does, so leave room to swap
`defense` for whatever the first week's data says.

---

## 4. Age rating questionnaire

Apple asks about the *worst* thing in the app, not the average. Answers:

| Question | Answer | Why |
|---|---|---|
| Cartoon or Fantasy Violence | **Frequent/Intense** **[decide]** | The squad fires continuously for the whole run and enemies shatter. There is no blood, no injury and no human target — the enemies are numbered blocks, skeletons and monsters — so *Infrequent/Mild* is arguable and gives a 9+ rating instead of 13+. Answer it once, write the answer here, and never change it without a reason. |
| Realistic Violence | None | Nothing in the game is realistic, including the physics. |
| Prolonged Graphic or Sadistic Realistic Violence | None | |
| Profanity or Crude Humor | None | |
| Mature/Suggestive Themes | None | |
| Horror/Fear Themes | None | A horned demon and a yeti, drawn in the same bright daylight as everything else. |
| Medical/Treatment Information | None | |
| Alcohol, Tobacco, or Drug Use or References | None | |
| Simulated Gambling | None | No loot boxes, no wheels, no randomised purchases. Coins buy a named thing at a named price. |
| Sexual Content or Nudity | None | |
| Contests | None | |
| Unrestricted Web Access | **No** | The web view only ever loads files from the app bundle. There is no browser in the app and no link that leaves it. |
| User-Generated Content | **No** | Nothing is typed, uploaded, shared or shown from another player. |
| Messaging / chat | **No** | |
| In-App Purchases | **No** | D6. |
| Advertising | **None** | D6. |
| Age Assurance / parental gate needed | **No** | Follows from the five answers above. |

Expected outcome: **9+ or 13+**, entirely decided by the first row.

---

## 5. App privacy ("nutrition label")

| Question | Answer |
|---|---|
| Do you or your third-party partners collect data from this app? | **No** |
| Data used to track you | None |
| Data linked to you | None |
| Data not linked to you | None |

The whole basis for that answer, in one paragraph, so it can be defended: the
app makes no network requests. Everything it reads is inside the bundle. The
only thing it writes is one `localStorage` key on the device
(`arcane-rush.save.v3`, `src/core/save.ts`) holding the level reached, coins,
upgrades, the bestiary counters and two switches. There is no analytics SDK, no
advertising SDK, no crash reporter and no account. `PrivacyInfo.xcprivacy` in
the iOS project says the same thing in Apple's own words, and declares the three
required-reason APIs WebKit's own storage needs (see `docs/DEVICE.md` section 9).

Apple still requires a **privacy policy URL** even when the answer is "no data".
A single page saying the paragraph above satisfies it.

---

## 6. Export compliance

| Question | Answer |
|---|---|
| Does your app use encryption? | **No** |
| `ITSAppUsesNonExemptEncryption` | `false`, set in `ios/App/App/Info.plist` |

The app uses no encryption of its own and makes no HTTPS calls, so there is not
even the usual "exempt, standard HTTPS only" case to claim. Because the key is
in the Info.plist, App Store Connect stops asking the question on every upload,
and no French encryption declaration is needed.

---

## 7. Screenshots

### What Apple needs

The app is **iPhone only** (`TARGETED_DEVICE_FAMILY = 1`), so there is one
required size and no iPad set at all:

| Slot | Pixels (portrait) | Required | Device it matches |
|---|---|---|---|
| 6.9" | 1320 × 2868 *or* 1290 × 2796 | **Yes** | iPhone 16 Pro Max / 15 Pro Max |
| 6.5" | 1242 × 2688 *or* 1284 × 2778 | No — Apple scales the 6.9" set down | iPhone 11 Pro Max / XS Max |
| iPad | — | No | not an iPad app |

Up to ten per slot; the first three are what people see without swiping, so they
carry the whole pitch.

### Where the frames come from

The hero set in `artifacts/smoke/hero/` (`npm run smoke`) is **the composition
reference, not the deliverable**: it is captured at 390 × 844 CSS at device
scale 2, so 780 × 1688 pixels — the right shape, less than a third of the
required width. Upscaling it would be visibly soft on a Pro Max. Three ways to
get the real pixels, best first:

1. **On the owner's phone.** Play, hide the debug panel, and press Volume Up +
   Side. If the phone is a Pro Max the file is already exactly 1320 × 2868 and
   needs nothing done to it. This is the honest route and the one to use.
2. **The iOS Simulator**, iPhone 16 Pro Max, Cmd+S. Same pixels, no phone
   needed; the frame rate is not real but a still does not care.
3. **The hero capture at store size**, if we want them reproducible from a
   command. `VIEWPORT` in `scripts/smoke-browser.mjs` is 390 × 844 at scale 2;
   a store run is 440 × 956 at scale 3. That is a small change to the capture
   and a job for this side, not the owner.

### The set, in order

Captions are the App Store's own overlay text, added in the screenshot, not
part of the frame. Keep them to five or six words.

| # | Frame | Caption |
|---|---|---|
| 1 | `hero-run` | One thumb. The squad follows. |
| 2 | `hero-gate-closeup` | Every gate is a choice. |
| 3 | `hero-boss` | Break the number before it reaches you. |
| 4 | `hero-shield-broken` | Some numbers hide behind a shield. |
| 5 | `hero-frost-run` | Then the road turns to ice. |
| 6 | `hero-academy` | Spend the clears in the Academy. |
| 7 | `hero-wardrobe` | Hunt a kind, earn its colours. |
| 8 | `hero-missions` | Three missions a day, and a streak. |
| 9 | `hero-endless-boundary` | Endless: one road, no end. |

Held back, and why: `hero-title` (a title screen sells nothing in a search
result), `hero-result` (a summary sheet is the end of the fun, not the start),
`hero-meteor`, `hero-whip`, `hero-charger`, `hero-glacier`, `hero-fence-jam`,
`hero-frost-boss`, `hero-frost-gate-closeup`, `hero-yard` — all good frames, all
saying something one of the nine above already says. They are the bench: swap
one in when a caption does not land.

**App Preview video** is optional and skipped for the first submission. If one is
wanted later it is 15–30 s, portrait, at the same 6.9" size, and it may only show
the app itself.

---

## 8. URLs and contact

| Field | Value | Required |
|---|---|---|
| Support URL | `https://<placeholder>/arcane-rush/support` | **Yes.** A page with an email address on it is enough. |
| Privacy Policy URL | `https://<placeholder>/arcane-rush/privacy` | **Yes**, even with nothing collected. Section 5's paragraph is the whole page. |
| Marketing URL | — | Optional, leave empty. |
| Contact (review) | the owner's name, email and phone | Not published; only the review team sees it. |

A GitHub Pages site or a single Notion page serves for both, and the two URLs
must resolve before the build is submitted — a 404 is a rejection.

---

## 9. Notes for App Review

Pasted into "Notes" on the version page. Reviewers reject what surprises them,
so the triple tap is in here on purpose.

```
Arcane Rush is a single-player offline game. There is no account, no login,
no sign-in of any kind, and no demo credentials are needed — the whole game
is available from the first launch.

The app makes no network requests. Everything it displays is bundled in the
app. Progress is stored on the device only.

There are no in-app purchases, no advertising and no analytics.

One thing worth pointing out so it does not look hidden: triple-tapping the
wordmark on the title screen (or the level chip during a run) toggles a
developer panel showing frame rate and draw calls. It is a diagnostic left in
deliberately so our tester can report performance from the device; it changes
nothing about the game and triple-tapping again removes it.

All art, audio and fonts are either our own work or CC0 / SIL Open Font
License material; the full inventory with sources is kept in the project.
```

---

## 10. Submission checklist

Before the first upload:

- [ ] Bundle id decided and identical in `capacitor.config.ts` and Xcode.
- [ ] `npm run cap:preflight` prints PASS and `next: npm run cap:open`.
- [ ] Version and build stamped: `npm run cap:version` (`0.9.0`, build `900`).
- [ ] The owner's real icon and splash dropped in `assets/app/` and
      `npm run cap:assets` run — the placeholders are not a shippable icon.
- [ ] Paid Apple Developer Program membership active.
- [ ] App record created in App Store Connect with the name and bundle id above.
- [ ] Support URL and Privacy Policy URL live and resolving.
- [ ] Age rating questionnaire answered per section 4, with the **[decide]** row
      settled and written back into this file.
- [ ] Secondary category settled (section 1, **[decide]**).
- [ ] App privacy answered "no data collected" (section 5).
- [ ] Nine screenshots at 1320 × 2868, captioned (section 7).
- [ ] Description, subtitle, keywords and promotional text pasted in.
- [ ] Copyright line filled in with a legal name.
- [ ] Review notes pasted in (section 9).
- [ ] Archive uploaded and processed; export compliance not asked (section 6).
- [ ] Build attached to the version, then Submit.

Between submissions, only two of these ever change again: the version and build
number, and whatever the last rejection was about.
