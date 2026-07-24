---
name: zdymak
description: Capture app screenshots AND generate spec-compliant App Store / Google Play preview videos and store screenshots. Use when a user wants an "app preview", "store preview video", "App Store trailer", "Play promo video", store screenshots, a Play feature graphic, localized store assets — or needs the screenshots THEMSELVES taken: zdymak drives iOS simulators (launch-arg handle, can build+install), Android devices over adb (intent extra, SystemUI demo mode for a clean status bar) and any web app via Playwright, then frames/captions/encodes to each store's exact spec.
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
| **App Store** screenshots | `appstore-iphone-6.9` (+`-6.5`), `appstore-ipad-13`, `appstore-mac`, `appstore-watch` | framed (inferred) | Marketing styling is **expected** here: frames, headlines, backgrounds. iPad/Mac/Watch shots are *required* if the app ships there. Pick ONE Watch size and keep it across localizations. |
| **Google Play** screenshots | `play-phone`, `play-tablet`, `play-wear`, `play-feature-graphic` | `bleed` + `caption: false` for the upload | Google forbids device frames, added text and backgrounds on store screenshots (hard requirement for Wear OS). Render a plain set for upload and a styled set for the website — `dir` keeps both. The feature graphic is **required** even without a video. |
| Web-app screenshots | any target, captured with `--platform web` | as above | Playwright driver; states are URL paths. |

Exact dimensions live in `zdymak specs` (printed from the code, so it can't drift). They're checked
against Apple's *Screenshot / App preview specifications* and Google's *Add preview assets* pages.

**Status bars.** An Android Compose capture reserves the status-bar inset but can't contain the system UI,
so the shot has an empty band. `statusBar: 'auto'` (default) detects that band and paints a clean bar
(9:41 · full signal/wifi/battery) — exactly the state Google asks for. Square (watch) captures are skipped.
iOS XCUITest captures already include a real status bar, so nothing is drawn there.

## It can take the screenshots too (don't assume the user must supply them)
`zdymak capture --platform ios|android|web` DRIVES the app through each screen and writes a store-ready
PNG per screen — it is not only a compositor. iOS: boots/creates a sim, optionally `--build` +installs,
relaunches per state via a launch-arg handle, pins the status bar to 9:41. Android: `am start --es <arg>
<state>` over adb with SystemUI demo mode on for a clean bar. Web: Playwright navigates URL paths itself,
no handle needed. Single-shot `--name <screen>` and `--record` also exist. If the user has no screenshots
yet, offer this before asking them to produce some. macOS capture is deliberately out of scope (TCC).
Capture TEARS DOWN what it set up (status-bar override cleared, a sim it booted shut down, a device it
created deleted, Android demo mode switched off) — `--keep` skips that for debugging. A simulator the
user already had booted is never touched.

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
**Play images** JPEG/24-bit PNG, no alpha: phone 1080×1920 (2–8, max 2:1, 320–3840px) · tablet 2560×1440
· Wear 1080×1080 1:1 (required for Wear) · feature graphic 1024×500 (**required**) · icon 512×512 ≤1MB
(alpha OK). Wear OS: interface only (requirement). Phone/tablet: frames recommended against, taglines ≤20% allowed.
**Play video** is a YouTube URL, not a file — render `play-promo`, upload, paste the link. Keep it silent
unless the track is cleared (ContentID → forced ads → Play violation).

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
  (needs `brand.name/tagline/endline/logo`). Web/social/YouTube.
- **Premium** (`premium-reel`) — the **Apple editing-vocabulary** preset: matte + glow + vignette,
  motion-then-freeze spring dolly, **palette-aware cuts**, bottom title pill. This is the default premium
  marketing look; tune via the optional `theme` block (brand-driven defaults apply if omitted). Web/social.
  Like the framed reel, it's **not** an App Preview (the matte/pill make it a marketing asset).

## Guardrails
- Never submit the **device-framed** `social-reel` as an App Preview — Apple rejects device bezels there.
  Use the full-bleed `appstore-preview` for the App Store slot; `social-reel` is web/social/YouTube only.
- Keep any music **commercially licensed**; the engine is silent by default (previews autoplay muted).
- Don't fabricate UI or overstate features in captions — App Review checks the preview matches the app.
