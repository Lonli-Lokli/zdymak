---
name: zdymak
description: Capture app screenshots AND generate spec-compliant App Store / Google Play preview videos and store screenshots. Use when a user wants an "app preview", "store preview video", "App Store trailer", "Play promo video", store screenshots, a Play feature graphic, localized store assets — or needs the screenshots THEMSELVES taken: zdymak drives iOS simulators (launch-arg handle, can build+install), Android devices over adb (intent extra, SystemUI demo mode for a clean status bar) and any web app via Playwright, then frames/captions/encodes to each store's exact spec. Also for folding phones: it folds and turns the iPhone Duo simulator into all six postures (closed, turned, open, upright, half open like a book or a laptop) and knows what iOS reserves in each and where an app's controls belong, so use it to advise on a Duo layout as well as to shoot its store set.
---

# zdymak

A standalone CLI that turns app screenshots into premium, store-compliant preview videos. Everything
project-specific is one `zdymak.config.mjs`; the engine (spring camera moves, parallax captions,
per-store encode) is shared.

## When to use
The user is building App Store / Google Play listing assets, or asks for an app-preview / store trailer /
promo video, **or store screenshots**. `zdymak video` builds the previews; `zdymak build` *also* renders
**multi-device store screenshots** (iPhone / iPad / Mac / Watch / Android) — style inferred per target,
caption on top, `contain`-fit windows, no-alpha PNG. Dimensions are in `zdymak specs`. Add **`--clean`** to
any build/capture command to wipe the output folder first, so only this run's assets remain (no stale files).
For a premium reel with REAL motion (not a Ken-Burns zoom of a still), use **`zdymak reel`** — it composites
app RECORDINGS/clips (or an image sequence) on the matte with beat-matched hard cuts (the `reel` config block).

**Not zdymak's job → use [vydanne](https://www.npmjs.com/package/vydanne).** zdymak stops at files on
disk. Writing or *uploading* the store listing — localized name/subtitle/description/keywords, screenshot
and preview **upload**, age rating, App Review contact, App Privacy + accessibility labels, IAP text,
export-compliance PDF, and the submission-completeness gate — is vydanne (`npx vydanne preflight`,
`npx vydanne fill`). The handoff is path-based and needs no glue: zdymak's output paths
(`marketing/out/play-feature-graphic.png`, `play-phone-plain/`, `play-tablet7-plain/`,
`play-tablet-plain/`) are the exact paths vydanne uploads from. Neither tool ever submits the app.

## Pick the right preset (do this before writing any config)

The two stores want **opposite** things. Choosing the wrong target is the #1 way to produce assets that
get rejected or quietly under-perform.

| The user wants… | Target | Style | Non-obvious rule |
|---|---|---|---|
| An App Store preview video | `appstore-preview` | full-bleed | **15–30 s** or Apple rejects it. **No device frame.** Apple expects footage from inside the app — captions are overlay, so keep them minimal (or use a captions-free real-footage cut). |
| A Play listing video | `play-promo` | full-bleed | Play takes a **YouTube URL**, not a file. Keep it **silent** unless the music is cleared — a ContentID claim can force ads on, which Play forbids on listing videos. |
| A marketing/social reel | `social-reel` | device-framed | Set `theme.frame: 'android'` for Android captures — the default body is an iPhone, and an Android UI in an iPhone shell misrepresents the app. Never submit this as an App Preview. |
| A cinematic showcase | `premium-reel` | premium matte | Override `size` for landscape (Mac: `[2880, 1800]`). |
| **App Store** screenshots | `appstore-iphone-6.9` (+`-6.5`), `appstore-ipad-13` (+`-landscape`), `appstore-mac`, `appstore-watch` | framed (inferred) | Marketing styling is **expected** here: frames, headlines, backgrounds. iPad/Mac/Watch shots are *required* if the app ships there. Pick ONE Watch size and keep it across localizations. |
| **Google Play** screenshots | `play-phone`, `play-tablet` (+`-portrait`), `play-wear`, `play-feature-graphic` | `bleed` + `caption: false` for the upload | Google forbids device frames, added text and backgrounds on store screenshots (hard requirement for Wear OS). Render a plain set for upload and a styled set for the website — `dir` keeps both. The feature graphic is **required** even without a video. |
| An **in-app purchase** review screenshot | `appstore-iap-review` | interface only (automatic) | Its own slot with its own OLDER size table — the listing sizes are refused. Defaults to 640×920; never pass a listing target's `size:` here. `appstore-iap-promo` is the optional 1024×1024 companion. |
| **iPhone Duo** screenshots | `appstore-iphone-duo-outer` / `-inner` (+`-landscape` of each) | framed by `duo` / `duo-inner` (inferred) | ONE "iPhone Duo" slot of ten takes all four sizes (1398×2034, 2007×2853, and both turned). Optional now, **required from April 2027** for apps built with the iOS 27.1 SDK. Shoot every posture on the Duo simulator (Xcode 27.1+) with `capture --posture`, and read **Folding phones** below before advising on the layout. The frame keeps the display's true shape and draws NO island or camera; a simulator capture carries iOS's own camera cutout and status, which is the device's and stays. A half-open capture can stand half open in 3D with the scene's `fold: 'laptop'` or `'book'` (see **Folding phones**). |
| The App Store **product page header / search image** (iOS 27+) | `appstore-header` (3840×1646), `appstore-search` (3:2, 1920×1280–3840×2560), or `appstore-universal` (5244×2950, both) | branded graphic | Like the feature graphic: lockup, tagline, fan, ONE hero — laid out around Apple's art safe area (from its own template). Give it a **landscape** hero with `hero: '<scene id>'`; a phone in a 21:9 strip is the wrong picture. Optional assets. |
| The App Store **header / search video** (iOS 27+) | a `reel` entry with `destination: 'appstore-header-video'` / `'appstore-search-video'` | live footage | `zdymak reel` only — `video`/`build` refuse these. 5–30 s, 30 or 60 fps, loops, muted (search: always). Landscape footage with `theme: { bleed: true }`. A 3840-wide encode is heavy: build it alone. |
| Web-app screenshots | any target, captured with `--platform web` | as above | Playwright driver; states are URL paths. |

Exact dimensions live in `zdymak specs` (printed from the code, so it can't drift). They're checked
against Apple's *Screenshot / App preview specifications* and Google's *Add preview assets* pages.

**Status bars.** An Android Compose capture reserves the status-bar inset but can't contain the system UI,
so the shot has an empty band. `statusBar: 'auto'` (default) detects that band and paints a clean bar
(9:41 · full signal/wifi/battery) — exactly the state Google asks for. Square (watch) captures are skipped.
iOS XCUITest and simulator captures already include a real status bar, so nothing is drawn there (`statusBar: false`).
The closed iPhone Duo has a status COLUMN down the right edge instead of a bar: on a HEADLESS capture
`statusBar: 'column'` draws it (opt-in per shot).

## It can take the screenshots too (don't assume the user must supply them)
`zdymak capture --platform ios|android|web` DRIVES the app through each screen and writes a store-ready
PNG per screen — it is not only a compositor. iOS: boots/creates a sim, optionally `--build` +installs (`--configuration <name>`, default Debug; any configuration the scheme defines, e.g. `--configuration Release`),
relaunches per state via a launch-arg handle, pins the status bar to 9:41, and with `--posture` folds and turns
an iPhone Duo simulator first (see **Folding phones**). Android: `am start --es <arg>
<state>` over adb with SystemUI demo mode on for a clean bar. Web: Playwright navigates URL paths itself,
no handle needed. Single-shot `--name <screen>` and `--record` also exist. If the user has no screenshots
yet, offer this before asking them to produce some. macOS capture is deliberately out of scope (TCC).
Capture TEARS DOWN what it set up (status-bar override cleared, a sim it booted shut down, a device it
created deleted, Android demo mode switched off, display override reset) — `--keep` skips that for
debugging. A simulator the user already had booted is never touched.

**Live footage, not Ken Burns.** `--record` with `--states` records a CLIP per state instead of a still —
on both iOS and Android. This is what you want when the app animates itself (an autoplay demo, an
auto-scroll): the store video then shows the real thing moving, not a dolly over a screenshot. Android
adds three fixes you would otherwise rediscover the hard way:
- **`--size 1080x1920`** relayouts the app to the video spec. Phones are taller than the spec (a Pixel is
  1080×2400); cropping down to 1920 instead cuts off whatever is at the bottom — usually the buttons.
- **Auto head-trim.** A driven recording opens on the launcher plus a blank starting window. The head is
  detected as the first sustained brightness step and cut; `--trim <s>` overrides when that misreads
  (an app that paints darker than the launcher).
- **`--hold`** (default 1.5s) clones the last frame back on, because `screenrecord` STOPS as soon as the
  screen goes static — so a clip ending on a settled screen is otherwise cut off mid-beat.
The app must actually move during the window: drive it with a state handle that autoplays. Feed the clips
to `zdymak reel`, or ship a `--size`-matched clip straight to the store slot.

## Prerequisites (check first)
- `ffmpeg` on PATH (`brew install ffmpeg`) — the encode needs it.
- Node ≥18.
- The tool itself: run via `zdymak …` if linked, else `node <path-to>/zdymak/bin/zdymak.mjs …`.

## Workflow

1. **Confirm the store spec** the user wants: `zdymak specs` lists every target with exact
   dimensions. App Store App Previews must be **15–30s** and have **no device frame**; the engine already
   enforces both.

2. **Get screenshots** — two modes:
   - **Bring-your-own:** point `screenshotsDir` at existing PNGs (Xcode/XCUITest/Android/Figma).
   - **Capture:** boot a simulator/emulator, navigate to each screen, then
     `zdymak capture --platform ios|android --name <screen> --out ./screenshots`. It strips alpha
     (stores reject it). It does NOT build the app — you drive navigation.

3. **Author the config** (`zdymak.config.mjs` at project root). Keep captions **terse** (a preview
   autoplays muted in search results — it must read in ~2.5s per scene). Order the scenes as a narrative:
   hook → what it does → the best moment → the honest offer. Pick `move` per scene for variety, or omit to
   auto-vary. Example:
   ```js
   export default {
     brand: { ink: '#0b0b0a', title: '#F5F5F4', sub: '#9ae6b4' },
     screenshotsDir: './screenshots', suffix: '',
     scenes: [
       { id: 'welcome', title: 'One-line hook.', sub: 'The promise.', move: 'pushInSlow' },
       { id: 'best',    title: 'The best moment.', sub: 'Show, don’t tell.', move: 'pullBack' },
       { id: 'offer',   title: 'The honest offer.', sub: 'Price / trial.', move: 'pullBackSlow' },
     ],
     targets: ['appstore-preview', 'play-promo'],
     out: './store-assets',
   };
   ```

4. **Build:** `zdymak video`. Then **verify** with ffprobe before telling the user it's ready:
   ```sh
   ffprobe -v error -select_streams v:0 \
     -show_entries stream=width,height,codec_name,profile,level,pix_fmt -show_entries format=duration \
     -of default=noprint_wrappers=1 store-assets/appstore-preview.mp4
   ```
   Confirm width/height/profile/level match the target and duration is in range. Heed any `⚠︎` duration
   warning the CLI prints (adjust `sceneDur` or scene count).

5. **Tell the user where it goes:**
   - App Store → App Store Connect → App Previews (one 886×1920 file fills the 6.5" **and** 6.9" slots).
   - Play → upload the 1080×1920 file to **YouTube**, paste the link in Play Console → Preview video.

## Capturing the screenshots
`zdymak capture --platform ios|android|web`. For **web**, states are URL paths and the tool drives itself:
`--platform web --url http://localhost:3000 --states /,/today --suffix -light`, plus `--device "iPhone 15 Pro"`
for mobile-web, `--theme dark`, `--locale`, `--wait <selector>`, `--full-page`. Playwright is an optional
dep (`npm i -D playwright && npx playwright install chromium`). Shots are deterministic — animations are
zeroed and fonts/images awaited — so re-runs only differ where the UI did.

### Capturing in the shipping language
`--language <tag>` captures the app itself in that language; `screenshots --locale` only translates the
caption painted on top. Shipping the second without the first gives every locale a translated headline
over a source-language screen, which is a picture of an app the shopper will not receive — and nothing
downstream flags it, because every file is a valid PNG of a real screen.

- **iOS:** launch arguments (`-AppleLanguages (ja) -AppleLocale ja_JP`), so no device state changes and
  nothing needs restoring. The parentheses are load-bearing: `AppleLanguages` is an array, and a bare
  tag is ignored silently — you get the base language, a green tick, and no warning.
  `--applelocale` overrides the formatting locale (default: the tag with `-` as `_`).
- **Android:** `cmd locale set-app-locales` (per-app override, **API 33+**), force-stopped so state one
  is already translated and cleared in a `finally`. This one IS device state — a run killed mid-way
  leaves the emulator in that language.
- Capture one directory per language, then let `capturesDir: './captures/{locale}'` pick the right one
  per render. `sourceLocale` (default `'en'`) is what `{locale}` means on the base pass. A dir with no
  token ignores the locale, so existing configs are unaffected; a missing per-locale dir reports
  `NO <locale> CAPTURES` with the path, rather than the generic "skipped".

### Both orientations of a tablet
Both stores show two orientations **in one slot**, so an app whose tablet layout genuinely changes on
rotation should ship both — and one that merely stretches should not bother. Capture each into its own
directory, give each its own `devices` entry, and pair them with `appstore-ipad-13-landscape` /
`play-tablet-portrait`. No new device drawing is involved: the frames take their body from the capture's
aspect.

- **iOS:** `--orientation landscape-left|landscape-right|portrait-upside-down`. It drives the Simulator's
  Device ▸ Orientation menu, because `simctl` has no rotation command — so the terminal needs
  **Accessibility** permission. simctl's screenshots also ignore rotation (a turned iPad arrives
  portrait-shaped with the UI on its side); zdymak stands them back up. It **fails** rather than warns if
  the device did not turn, since the alternative is a full set of good portrait shots filed as landscape.
  The usual cause is the app: iOS refuses an orientation the plist omits, and iPad reads
  `UISupportedInterfaceOrientations~ipad`.
- **Android:** no flag — use `--size 1600x2560`, which relayouts the app to a real upright tablet
  (800×1280dp at density 320). Rotating the 16:9 figure instead gives 405×720dp, a large phone.
- **Filenames collide.** Both orientations land in one store slot, and both targets emit `01-….png`, so
  rename one set on the way to the upload directory or the second silently overwrites the first — the copy
  succeeds and the listing is simply half as long. It also fixes ORDER, which stores read from the
  filename: one set whole, then the other, rather than alternating shapes.

## Play wants PLAIN screenshots (Apple wants styled)
Google's asset guidance forbids device frames, added text and backgrounds on Play screenshots (a hard
requirement for Wear OS), while Apple expects marketing styling. Render both from one target with `dir`:
`{ target: 'play-phone', dir: 'play-phone-plain', style: 'bleed', caption: false, theme: { anchor: 'top' } }`
for the upload, plus a plain `{ target: 'play-phone' }` for the website. Google *does* want a tidy status
bar (no carrier/notifications, full battery/wifi/signal) — `statusBar: 'auto'` (the default) paints one into
the empty band an Android Compose capture leaves behind; `statusBarTime` sets the clock.

## Destination vs preset (and validation)
`destination` = what a store accepts (size/codec/duration/alpha/cap). `preset` = how it looks
(`full-bleed` | `framed` | `premium`). They're independent: `{ destination: 'play-promo', preset:
'premium' }` is valid, and `{ destination, preset, transitions: [...], effects: [...] }` lets the user
supply their own vocabulary (scenes without a `cut` cycle the list). `{ target: 'x' }` remains shorthand.
A destination can REFUSE a preset — `appstore-preview` + `framed` throws, because Apple rejects bezels
there. Every written asset is re-measured against its destination and REFUSED on violation (`--force`
downgrades to a warning), so never claim an asset is spec-compliant without running the build.

## Hard store requirements (verified July 2026 — re-check before a release)
**App Store screenshots** 1–10 per device type, JPEG/PNG, no alpha: iPhone 6.9" 1320×2868 · iPhone 6.5"
1284×2778 · iPad 13" 2064×2752 (required for iPad apps) · Mac 2880×1800 · Watch 422×514 (pick one size,
use it in every locale).
**App Previews** 15–30s or it's rejected · ≤500MB · ≤30fps · H.264 High ≤4.0 · up to 3 per family · NO
device frame. iPhone 886×1920 (`appstore-preview`) · **iPad 1200×1600** (`appstore-preview-ipad`) · Mac
1920×1080 landscape (`appstore-preview-mac`). The iPad preview is NOT the iPad screenshot size — that
mismatch is a routine rejection.
**In-app purchase images** are a SEPARATE pair of slots, on the purchase and not on the listing:
`appstore-iap-review` (**required** to submit an IAP) and `appstore-iap-promo` (1024×1024, flattened RGB,
optional — only to promote the purchase on the product page; win-back offers are subscriptions-only).
**The review screenshot is validated against an older table than the listing slots**: 1290×2796 and
1320×2868 are refused there with "The dimensions of one or more screenshots are wrong" while the listing
slots take them happily, so it defaults to **640×920** and never borrows a `size:` from a listing target.
It is review-only and never shown to a customer, so it renders the interface alone — no frame, no
caption, no matte.
**Play images** JPEG/24-bit PNG, no alpha: phone 1080×1920 (2–8, max 2:1, 320–3840px) · tablet 2560×1440
· Wear 1080×1080 1:1 (required for Wear) · feature graphic 1024×500 (**required**) · icon 512×512 ≤1MB
(alpha OK). Wear OS: interface only (requirement). Phone/tablet: frames recommended against, taglines ≤20% allowed.
**Play video** is a YouTube URL, not a file — render `play-promo`, upload, paste the link. Keep it silent
unless the track is cleared (ContentID → forced ads → Play violation).
**iPhone Duo** (checked 12 Oct 2026) outer 1398×2034 / 2034×1398, inner 2007×2853 / 2853×2007, one slot.
Optional now; required from April 2027 for apps built with the iOS 27.1 SDK.
**App Store creative assets** (iOS/iPadOS 27+, optional, checked 12 Oct 2026), no alpha: header image
3840×1646 JPEG/PNG · search image 3:2 from 1920×1280 to 3840×2560 JPEG/PNG · universal 5244×2950 PNG only
(one file for both) · header video 3840×1646 and search video 3:2 (same range), 30 or 60 fps, 5–30 s,
.mov/.m4v/.mp4, loop, muted (search always). No pricing, URLs, ©, unearned awards, Apple recognitions, or
other platforms' logos. Apple's help publishes no safe area; its Sketch template does (header 1646×661
centred, search 2168×1030 centred, universal 1402×962 centred across and 334 px above centre), and the
`appstore-header`/`-search`/`-universal` graphics keep the words inside it. Tell the user to check
App Store Connect's Preview before submitting.

## App Store creative graphics and videos (iOS 27)
Treat them like the feature graphic, not like screenshots: one image per target, built from the brand
(`brand.logo` + `name` lockup, `tagline`, `fan`) and ONE hero capture. Before writing the config:
- **Find a landscape capture** (a Play tablet set, an iPad landscape set) and name it with `hero:
  '<scene id>'` on the shot. Without `hero` the first landscape capture is used; a named hero that is
  missing is an error. Landscape heroes are drawn as the bare screen; `frame: '<id>'` asks for a body.
- `brand.endsub` is NOT drawn (Apple rules out pricing; "Free" reads as pricing), and the feature
  graphic's pixel knobs (`fanX`/`fanY`/`fanHeight`, `textOffsetY`) do not apply. `fan: false` drops the cards.
- Two of the same target need `dir` or they overwrite each other.
- Videos are `reel` entries with `destination: 'appstore-header-video' | 'appstore-search-video'` (the
  destination fills size/fps/level and sets `theme.frame: false`); use landscape clips and `theme: { bleed:
  true }`. They are measured after the encode (size, 5–30 s, 30/60 fps) and refused on a violation.
  Search plays muted always — don't spend a music bed there.

### What the first real listing taught (Vinto, 2026-10-12) — apply it to every game
The first header made from defaults was rejected by its owner, for reasons that hold for any game:
- **Use `hand: 'below'`** with the game's own art as `fan: [paths]` (five cards, pieces, tiles): words
  and hero as one centred group, the hand centred along the bottom, cut by the bottom edge only. The
  default margin hand sits outside the safe area and lost a card to the canvas's side.
- **Crop the hero to the play area** with `heroCrop: [x, y, w, h]` (the board without the app's header
  and controls). On an iPhone the whole 21:9 strip is about 393 points wide, so anything small in the
  hero is unreadable; the board and the hand are what carry.
- **Give the header its own ground** with `theme: { matteTop, matteBottom }` on the shot. It shows above
  BOTH a white and a black App Store page and Apple takes one image for both, so: a mid tone, never near
  white or near black, and never the hero's own colour (a green board on a green ground disappears).
  Mock it on a light and a dark page before building; Vinto chose a walnut ground for a green felt.
- **One idea, centred.** Apple: "Focus on a single, clear idea", focal point in the centre. The iPhone
  crop keeps the full height and loses about 8% each side; check it in App Store Connect's Preview.
- **Search image** (3:2): the same shot options give the same composition reflowed; show gameplay.
- **A game with its own world can stand the header in it** (Hronka, 2026-10-12): a flat matte read as
  any app's, and its owner chose the game's own night room. `ground: { image, anchor, tint, scrim }` puts the app's
  scene art behind everything, blurred, tinted to a mid tone, with a scrim under the words; `heroFeather: 0.08`
  fades a board cut from a scene into that ground at full height instead of boxing it; `lockup: { logo: false,
  nameFont, nameScale, taglineFont, title, sub }` drops the icon (the store prints icon and name just below, and
  both together read as the name twice) and sets the words in the app's own faces.

### Screenshots that the island or a status column will cover (also from Vinto)
- **Headless captures have no status bar.** Reserve the device's strips in the capture (iPhone 6.9":
  59 points top, 34 bottom) as a flat band of the app's own edge colour, and set `theme: { statusBar:
  'auto' }` on those shots: the frame's Dynamic Island then sits in the band and zdymak draws a clean
  9:41 there. Without it the island lands on the app's top-right controls.
- **The closed iPhone Duo has no top status bar.** iOS 27.1 stands the status bar and camera in a column
  down the RIGHT edge: 84 of 466 points, the app gets 382. Shoot it on the simulator (`--posture closed`)
  and the column is iOS's own (`statusBar: false`). Only a HEADLESS capture needs `theme: { statusBar:
  'column' }`: reserve the column as a flat band of the app's edge colour and zdymak draws the clock and
  status glyph at its top, never the camera. Not 'auto' (it would read the app's flat top rows as a band).
- **One Duo set holds ten** across all six postures and four targets: see **Folding phones** below.
- **Pin what the capture shows**: the theme (an app that follows the system renders dark on a Mac in
  dark mode) and the version string on any screen that prints one, to the release the shots go out with.

## Folding phones: the iPhone Duo's postures, what goes where, and how to shoot them

Learned shipping Vinto's Duo layout and its store set (2026-10-13, iOS 27.1 simulator). Use it to advise
on a folding layout as much as to capture one: the store slot shows every posture, so each one has to
look designed.

**Six postures, each its own layout.** Window sizes in points; what iOS reserves is what the app must
lay itself out around (the README's `--posture` section has the exact rectangles):

| Posture (`--posture`) | Window | iOS reserves | Store target |
|---|---|---|---|
| `closed` | 466×678 | a **status column** down the right edge, 84 pt: the clock and status block at its top (84×170), the camera inside it | `…-duo-outer` |
| `closed-turned` / `-right` | 678×466 | the column follows the camera: turned left it runs down the LEFT with the block at the top; turned right, down the right with the block at the FOOT | `…-duo-outer-landscape` |
| `open` (held like a book) | 951×669 | only a corner at the top right (84×120) | `…-duo-inner-landscape` |
| `open-upright` | 669×951 | a strip across the top, its clock corner at the right (134×82) | `…-duo-inner` |
| `half-book` | 951×669 | the fold: a 40 pt **division** down the middle | `…-duo-inner-landscape` |
| `half-laptop` | 669×951 | the fold: a 40 pt division across the middle | `…-duo-inner` |

**What goes where.** These are the rules Vinto's owner set after Apple's own Duo presentation; offer
them as the starting point for any app, and ask before departing from them:
- **Closed, the status column is the app's controls column**, not dead space beside the clock. Top
  buttons go to the top of it, under the clock, in the order they had: Leave (exit) top-most, then
  help, settings, a status counter, a mode switch. Its **foot is for what is used most** — easiest for
  the thumb on a folded phone: the turn's choices as pill buttons (a drawn icon and one word; the word
  must be inside the button's spoken name, WCAG 2.5.3), the most frequent lowest. Pickers and any set
  that does not fit stay whole in the main panel; nothing goes under the camera.
- **Closed and turned**: the same column on the camera's side. iPhones normally stay upright; a
  foldable model should turn (the app allows landscape by model or once a hinge is reported).
- **Open flat**: the content takes the full height and the secondary panel becomes one narrow stack
  beside it — card, then its description, then history — with no empty band.
- **Open upright**: the header can sit in iOS's top strip, left of the clock corner.
- **Half open like a book**: the content on one page, the controls on the other; **nothing on the
  crease**.
- **Half open like a laptop**: what you look at stands on the upper half; what you touch (your own
  hand, the piles, the choices) lies flat on the lower half, like a keyboard.
- **Folding and unfolding animate**, the way Apple's apps do: the layout reshapes and its pieces glide
  from where they were (clip a board's background, not the moving pieces, or they vanish mid-glide).

**The app's side, for an iOS 27.1 SDK build.** `GeometryProxy.reservedRegions(kind: .occlusion)` (the
column, corner, camera) and `(kind: .division)` (the fold) in SwiftUI, `UIView.reservedRegions(kind:)` in
UIKit, and `onHingeChange` (`DeviceHingeContext`: status and angle) for the hinge. A Compose
Multiplatform app passes them from Swift into shared code (Vinto: `ContentView.swift` →
`ReservedBridge.kt`). Turning needs the landscape orientations in the iPhone Info.plist AND
`supportedInterfaceOrientations` allowing them on a phone that folds.

**Shooting the set** (`--posture`, README). Ten pictures in one slot across four targets; a set that
tells the story Vinto's did: closed (the main screen, the tutorial, home), closed and turned, open flat
(the main screen and two features), half open like a book, open upright, half open like a laptop.
- Capture each posture into its own folder with `--posture`; give each a `devices` entry with scenes
  that name their capture by `image`, ids WITHOUT numbers (zdymak numbers each target's files itself),
  and `theme: { statusBar: false }` — iOS's own 9:41 status is in the capture.
- Merge the four folders with vydanne's `bridge.apple.iphoneduo.dirs`, listed in the order the store
  should show them.
- **Look at every shot before building.** A scene the app stages by playing (a game's later moments)
  can take minutes on a Debug simulator build: Vinto's plan scene was still on its splash at 60 s and
  ready at 150 s. A splash is a valid PNG, a fraction of the real screen's size, and passes every check.
- **A still freezes motion.** Text that scrolls as a marquee in a narrow column reads as cut off, and a
  strip that fades at its edge reads as broken; leave such a screen out or change the layout.
- **A half-open phone photographs flat**: the crease is not in the picture, only the app's split around
  it. So the half-open shots are where the frame does the work: give those scenes `fold: 'laptop'`
  (the `half-laptop` capture, on `…-duo-inner`) or `fold: 'book'` (the `half-book` capture, on
  `…-duo-inner-landscape`), and the framed shot stands the Duo half open in 3D around the capture.
  The screen stays the capture's own pixels; zdymak draws only the body and the light where the screen
  bends (`crease`, `0` for none). Defaults: laptop hinge 110 and camera 24 degrees up, book hinge 136
  and 12 degrees up; `{ posture, hinge, elev, yaw, dist, crease }` moves any of them (README, `fold`).
  Raise `elev` when the laptop's base, the half the player touches, should show more. Look at each shot:
  the open-flat and upright shots stay flat, so the set reads as one phone in different hands.

## Store cut vs social-ad cut (per-scene `cut` / `effect`)
`social-reel` supports **34 transitions** and **25 effects**, chosen per scene:
`{ id: 'study', cut: 'flip', effect: 'warm-film', push: true }`.

- **Store preview → stay plain.** Default `cut` (a one-frame hard cut) carries the rhythm; spend a
  `dissolve` only where the meaning changes; use at most ONE `push: true` camera move in the whole reel.
  Reaching for a different decorative transition at every boundary is the #1 amateur tell.
- **Social ad → open it up.** Anything in the tables is fair game; `auto` gives a deterministic rotation
  that stays mostly plain without art direction.
- **Effects are reel-only.** Never grade a store screenshot — Google requires Play shots to show the
  interface unaltered.
- **Beat-match the cuts** with `timing: { bpm, beatsPerCut }` (hold = beatsPerCut × 60 / bpm).

Full tables (id → duration → what it reads as) are in the README under *Transitions & effects*; the ids are
also the `CutId` / `EffectId` unions in `types/index.d.ts`, so an editor will autocomplete them.

## Localized store listings
If the app ships more than one store locale, add a `captions` block — `{ de: './captions/de.json' }` or an
inline `{ sceneId: { title, sub } }` table — and run `zdymak screenshots` (or `--locale de,fr`). Each locale
renders to `<out>/<locale>/<target>/`; untranslated scenes keep the base caption and are reported. The
reserved `$brand` key localizes the feature graphic's wordmark copy. Screenshots only — videos aren't
re-encoded per locale.

## Tuning for quality
- **Captions overlap busy UI?** Lower them (they sit at ~0.75·height) or pick screenshots with calmer
  lower thirds.
- **Feels flat?** Ensure adjacent scenes use *different* moves; the spring dolly is what makes it premium.
- **Too long/short?** Total = `scenes × sceneDur − (scenes−1) × xfade`. App Store wants 15–30s.

## Three styles (fixed per target; all read the same `scenes`)
- **Full-bleed** (`appstore-preview`, `play-promo`) — screen fills the frame; required for App Previews.
- **Device-framed** (`social-reel`) — iPhone bezel + brand background + logo cold-open/end-card
  (needs `brand.name/tagline/endline/logo`). Web/social/YouTube. `brand.lockupGap` tunes the
  icon-to-wordmark gap here and on the feature graphic at once.

The **feature graphic** takes `brand.fan` — a list of images fanned out like a hand of cards, each
rotated further from the middle, overlapped and drop-shadowed — for a game selling a deck rather
than a screen (`fanSpread`, `fanX`, `fanY`, `fanHeight` place it). `brand.textOffsetY` shifts the
whole left-hand block down together when a short tagline would otherwise strand it in the top
corner.
- **Premium** (`premium-reel`) — the **Apple editing-vocabulary** preset: matte + glow + vignette,
  motion-then-freeze spring dolly, **palette-aware cuts**, bottom title pill. This is the default premium
  marketing look; tune via the optional `theme` block (brand-driven defaults apply if omitted). Web/social.
  Like the framed reel, it's **not** an App Preview (the matte/pill make it a marketing asset).

## One shot, several devices (`layout`)
A scene with a `layout` array composes SEVERAL captures into one screenshot — the "works on every device"
cluster — instead of framing one. Each member has its own `image`/`id`, its own `frame`
(`phone`/`android`/`ipad`/`tablet`/`watch`/`laptop`/`chromebook`/`mac`), and a placement given as
FRACTIONS of the canvas: `x`, `y` (centre) and `w` (screen width). Array order is depth, first furthest
back. The cluster is measured and auto-scaled to fill the band under the caption, so ONE layout serves a
portrait App Store slot and a landscape Play slot without re-authoring; `theme.clusterFit: false` opts
out. A member with no capture is skipped and reported, so it is safe to configure before every platform
has been shot.

Reach for this when the user wants a multi-device / "works everywhere" page. Do **not** hand-build such a
composite as a pre-rendered PNG and feed it in as a normal scene — it will be drawn INSIDE whatever frame
the target infers, i.e. a cluster of devices inside a phone bezel.

## Middleware and `check` — the app's own rules, and a pixel check anyone can call

`zdymak check <png|dir>…` tells you whether each capture has a screen in it (the blank-capture measurement `build` already
applies to its input): exit 1 on a blank or unreadable file, `--json` for machines. Use it instead of re-implementing the
measurement in a CI job or a release gate.

The config key `middleware` takes `(ctx, next)` functions or `{ name, commands, run }` objects, first entry outermost, around
build, video, reel, screenshots, capture and check. Before `await next()` an entry may refuse with `ctx.fail(reason)`; after it
it can inspect what the run made via `ctx.changedFiles()` and `ctx.outDir`. The config is passed raw, so a config that cannot
render yet can still carry a check. The same key exists in vydanne. Full example: README, "Middleware".

## Guardrails
- Never submit the **device-framed** `social-reel` as an App Preview — Apple rejects device bezels there.
  Use the full-bleed `appstore-preview` for the App Store slot; `social-reel` is web/social/YouTube only.
- A `layout` cluster is a composed graphic: fine for the App Store and your own site, **wrong for a Play
  listing** (Google asks for interface-only shots). Never put one platform's hardware in another store's
  listing — an Apple device cluster inside a Play listing advertises a competitor.
- Keep any music **commercially licensed**; the engine is silent by default (previews autoplay muted).
- Don't fabricate UI or overstate features in captions — App Review checks the preview matches the app.
- Don't draw iPhone Duo hardware (an island, a camera dot, a crease) — Apple has published none of it,
  and a picture of a device that does not look like that is a claim the listing cannot back. The camera
  cutout and status iOS itself draws into a simulator capture are the device's own; leave them. The
  `fold` frame bends the same plain body at the hinge, which is the posture the capture was taken in,
  not hardware; its fold shade is light on the screen, and `crease: 0` removes it.
- Never draw onto the screen to make a half-open shot read better. `fold` is the frame around a real
  capture: if the picture needs a different screen, capture it again.
- An App Store creative asset must not show another platform: a landscape hero from an Android capture
  is fine only if it shows the app alone (no Android status or navigation bar) and is drawn frameless
  or in an Apple frame — never in the `android` body.
