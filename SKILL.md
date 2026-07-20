---
name: store-preview
description: Generate premium, spec-compliant App Store & Google Play preview VIDEOS from a project's screenshots. Use when a user wants an "app preview", "store preview video", "App Store trailer", "Play promo video", or is preparing store-listing assets. Produces the exact resolution/codec each store requires (App Store 886×1920 H.264 High@4.0, 15–30s, no bezel; Play 1080×1920 for YouTube) with cinematic spring motion + kinetic captions — not a flat Ken-Burns slideshow.
---

# store-preview

A standalone CLI that turns app screenshots into premium, store-compliant preview videos. Everything
project-specific is one `store-preview.config.mjs`; the engine (spring camera moves, parallax captions,
per-store encode) is shared.

## When to use
The user is building App Store / Google Play listing assets, or asks for an app-preview / store trailer /
promo video. If they only need still screenshots resized to store dimensions, note that image targets are
on the roadmap (dimensions are in `store-preview specs`) and the video flow is what's built.

## Prerequisites (check first)
- `ffmpeg` on PATH (`brew install ffmpeg`) — the encode needs it.
- Node ≥18.
- The tool itself: run via `store-preview …` if linked, else `node <path-to>/store-preview/bin/store-preview.mjs …`.

## Workflow

1. **Confirm the store spec** the user wants: `store-preview specs` lists every target with exact
   dimensions. App Store App Previews must be **15–30s** and have **no device frame**; the engine already
   enforces both.

2. **Get screenshots** — two modes:
   - **Bring-your-own:** point `screenshotsDir` at existing PNGs (Xcode/XCUITest/Android/Figma).
   - **Capture:** boot a simulator/emulator, navigate to each screen, then
     `store-preview capture --platform ios|android --name <screen> --out ./screenshots`. It strips alpha
     (stores reject it). It does NOT build the app — you drive navigation.

3. **Author the config** (`store-preview.config.mjs` at project root). Keep captions **terse** (a preview
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

4. **Build:** `store-preview video`. Then **verify** with ffprobe before telling the user it's ready:
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

## Guardrails
- Never add a **device bezel/frame** to an App Preview — Apple rejects it (that's why the engine is
  full-bleed). Framed marketing reels are a *different* asset (web/socials), not the App Preview slot.
- Keep any music **commercially licensed**; the engine is silent by default (previews autoplay muted).
- Don't fabricate UI or overstate features in captions — App Review checks the preview matches the app.
