---
name: zdymak
description: Generate premium, spec-compliant App Store & Google Play preview VIDEOS from a project's screenshots. Use when a user wants an "app preview", "store preview video", "App Store trailer", "Play promo video", or is preparing store-listing assets. Produces the exact resolution/codec each store requires (App Store 886×1920 H.264 High@4.0, 15–30s, no bezel; Play 1080×1920 for YouTube) with cinematic spring motion + kinetic captions — not a flat Ken-Burns slideshow.
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
