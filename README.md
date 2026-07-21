# zdymak

**Premium App Store & Google Play preview videos — from your screenshots, in one command.**

Turn a handful of app screenshots into a cinematic, **spec-compliant** store preview: spring-eased camera
moves, kinetic captions, and an encode that App Store Connect and Google Play accept without a fight. One
small config per project; the engine lives here, shared across all your apps.

<p align="center">
  <img src="docs/demo.gif" alt="zdymak turning three flat app screenshots into a premium reel with motion and captions" width="270"><br>
  <em>Three flat screenshots → this premium reel, from one <code>zdymak.config.mjs</code> — reproduce it with <code>npm run example</code>. (<a href="docs/demo.mp4">full-quality MP4</a>)</em>
</p>

> Why it exists: a plain "Ken-Burns zoom over screenshots" reads as amateur, and hand-encoding to each
> store's exact spec (Apple: 886×1920, H.264 High@4.0, 15–30s, **no device frame**) is fiddly and easy to
> get rejected. This bakes the premium motion and the store rules in.

<br>

## What you get

| | |
|---|---|
| 🎬 **Premium motion** | Per-scene **spring dolly** (push-in / pull-back / drift) that eases and *settles* — not a flat pan. Captions sit **outside** the camera so they stay steady while the screen drifts (parallax), and rise in with a spring. |
| ✅ **Store-compliant** | Full-bleed (no bezel — Apple rejects bezels), exact resolution, H.264 High @ the right level, yuv420p, faststart. |
| 🍎 **App Store + 🤖 Play** | One 886×1920 file fills both iPhone App Preview slots; a 1080×1920 file is ready for a Play/YouTube promo. |
| 🧩 **Two input modes** | **Bring your own** screenshots, *or* **capture** them from a booted simulator / device. |
| ⚙️ **Config-driven** | Everything project-specific is one `zdymak.config.mjs`. The tool is otherwise generic. |

<br>

## Install

```sh
npm i -g zdymak      # global CLI → `zdymak <command>`
# …or per-project:
npm i -D zdymak      # → `npx zdymak <command>`
```

Also needs **Node ≥18** and **ffmpeg** on your `PATH`:

| Platform | Install ffmpeg |
|---|---|
| **macOS** | `brew install ffmpeg` |
| **Linux** — Debian/Ubuntu | `sudo apt install ffmpeg` |
| **Linux** — Fedora | `sudo dnf install ffmpeg` |
| **Windows** | `winget install Gyan.FFmpeg`  ·  or `choco install ffmpeg` / `scoop install ffmpeg` |

zdymak finds ffmpeg on `PATH`, or set `$FFMPEG` to an explicit binary. Video generation is pure Node +
ffmpeg — no platform SDKs. Screenshot **capture** additionally needs that platform's toolchain: **Xcode**
for `--platform ios`, the **Android SDK / `adb`** for `--platform android`.

<br>

## Quickstart

**1. Add a config** to your project root (copy `examples/example.config.mjs` → `zdymak.config.mjs`):

```js
export default {
  brand: { ink: '#0b0b0a', title: '#F5F5F4', sub: '#9ae6b4' },
  screenshotsDir: './screenshots',       // where your PNGs live
  suffix: '',                             // scene id "welcome" → screenshots/welcome.png
  scenes: [
    { id: 'welcome',  title: 'Your hook.',        sub: 'The promise, briefly.', move: 'pushInSlow' },
    { id: 'feature-1', title: 'What it does.',     sub: 'Why it matters.',       move: 'driftUp' },
    { id: 'offer',    title: 'The honest offer.',  sub: 'Price / trial, plainly.', move: 'pullBackSlow' },
  ],
  targets: ['appstore-preview', 'play-promo'],
  out: './store-assets',
};
```

**2. Build:**

```sh
zdymak video
# → store-assets/appstore-preview.mp4   (886×1920, upload to App Store Connect)
# → store-assets/play-promo.mp4         (1080×1920, upload to YouTube, link in Play Console)
```

That's it. `zdymak specs` prints every target and its exact dimensions.

<br>

## The two ways to get screenshots

**Mode A — bring your own** (default). Point `screenshotsDir` at any folder of PNGs — from Xcode, an
XCUITest capture, Android Studio, Figma, anywhere.

**Mode B — capture from a running app.** Boot a simulator/emulator (or connect a device), navigate to a
screen, and snap it. The tool strips the alpha channel (stores reject transparency) and writes a
store-ready PNG straight into your screenshots folder:

```sh
zdymak capture --platform ios      --name welcome --out ./screenshots
zdymak capture --platform android  --name welcome --out ./screenshots
zdymak capture --platform ios      --record       --out ./screenshots   # screen-record; Ctrl-C to stop
```

It does **not** build your app — that's your toolchain. It captures whatever's on screen, so you drive the
navigation.

<br>

## Config reference

| Key | Meaning |
|---|---|
| `brand.ink` / `.title` / `.sub` | Hex colours for the caption scrim + title + subtitle. |
| `brand.fontPaths` | Optional custom TTFs (else: system font — San Francisco on macOS). |
| `brand.name` / `.tagline` / `.endline` / `.endsub` / `.logo` | **Reel target only** — wordmark, cold-open tagline, end-card lines, and the icon PNG for the device-framed `social-reel` bookends. |
| `brand.reel` | **Reel target only** — optional palette overrides (`bgTop`, `bgBottom`, `glowLight`, `matteTop`, `matteBottom`, `glowDark`, `titleColor`, `subColor`, `bookendTitle`, `bookendSub`). |
| `screenshotsDir` + `suffix` | Resolve `scene.id` → `${screenshotsDir}/${id}${suffix}.png`. |
| `scenes[]` | `{ id \| image, title, sub, move }`. `image` overrides the id lookup. |
| `scenes[].move` | `pushIn` · `pushInSlow` · `pullBack` · `pullBackSlow` · `driftUp` · `driftDown` · `driftLeft` · `driftRight` · `still`. Omit to auto-vary. |
| `targets[]` | Which videos to build from the top-level scenes (`zdymak specs` lists them). |
| `sceneDur` / `xfade` | Seconds per scene / cross-dissolve. Tune total length to the store's 15–30s window. |
| `theme` | **Video** matte styling — the premium-technique block (see **Theme options** below). Brand-driven defaults. |
| `stillTheme` | **Screenshot** matte styling — same option shape as `theme`; falls back to `theme` when unset. |
| `timing` | Reel-mode timeline override `{ coldOpen, scene, endCard, xfade }` for the `social-reel` bookends. |
| `music` | Optional bed for **every** video: `{ path, offset, fadeIn, fadeOut, volume }` (silent if omitted). |
| `devices` | Per-device **screenshots + reels** (see below). Configure only the devices you ship. |
| `reel` | **Live-footage reel** — composite driven video `clip`s / `images` on a clean light matte, cross-dissolves (see **Live-footage reel** below). |
| `out` | Output directory. |

### Theme options (`theme` / `stillTheme`)

Both accept the same block; every key is optional with a brand-driven default. **Screenshots assume the
premium store-shot shape by default** — `captionAnchor: 'top'`, and `fit: 'contain'` for frameless windows —
so a typical `stillTheme` only sets colours. Override any key per shot.

| Key | Default | Meaning |
|---|---|---|
| `bgTop` / `bgBottom` | brand | Matte gradient top / bottom colour. |
| `glow` / `glowAlpha` | brand.sub / `0.16` | Soft radial brand-glow colour + strength. |
| `vignette` | `0.3` | 0..1 edge darkening (use `0` on a light matte). |
| `inset` | `0.955` | Fraction of the frame the screen fills (lower floats it with a wider matte border). |
| `label` | `true` | Show the caption on a pill; `false` = plain text, no pill. |
| `labelColor` / `subColor` | brand.title / brand.sub | Caption title + subtitle colour. |
| `handle` | — | Optional persistent top handle text (e.g. `@yourapp`). |
| `captionAnchor` | `bottom` (video) · `top` (stills) | Caption above (`top`) or below (`bottom`) the device. |
| `fit` | `cover` · `contain` (frameless stills) | `cover` fills + crops; `contain` shows the **whole** capture (e.g. a Mac window) with matte margins. |
| `headlineScale` | `0.062` | Caption headline size as a fraction of the frame's short edge — bump it for bigger, bolder headlines. |
| `frame` | `phone` (reel) | Device frame around a reel screen: `'phone'` iPhone bezel, or `false` for a bare rounded screen. |
| `bleed` | `false` | Reel only: the source **fills the whole frame** (no matte / frame / shadow) — a compliant full-bleed App Store App Preview. |

<br>

## Screenshots & multiple devices

Videos are only half the set. `zdymak build` also renders **store screenshots** for each device you
configure, at each store's exact dimensions, as **no-alpha PNGs** (App Store & Play reject alpha). Each
device points at its own captures; scenes with no matching capture are **skipped cleanly**, so an app lists
only the devices it actually ships. **The style is inferred from the target**, so a device is usually just
its captures + target(s):

```js
devices: {
  iphone: { capturesDir: './shots/iphone', suffix: '', screenshots: [{ target: 'appstore-iphone-6.9' }] },
  ipad:   { capturesDir: './shots/ipad',   suffix: '', screenshots: [{ target: 'appstore-ipad-13' }] },
  mac:    { capturesDir: './shots/mac',     suffix: '', screenshots: [{ target: 'appstore-mac' }] },        // window on the matte
  watch:  { capturesDir: './shots/watch',   suffix: '',
            scenes: [{ id: '01-study' }, { id: '02-answer' }],   // per-device scene override (raw, no caption)
            screenshots: [{ target: 'appstore-watch', style: 'bleed', size: [422, 514] }] }, // override: raw fill
  android:{ capturesDir: './shots/android', suffix: '', screenshots: [
            { target: 'play-phone' }, { target: 'play-tablet' },
            { target: 'play-feature-graphic' } ] },              // the 1024×500 Play banner (not per-scene)
  // a device may also carry `videos: [{ target: 'premium-reel', size: [2064, 2752] }]` at its own dimensions
},
```

**Inferred style** (override per shot with `style`): a **framed** device — iPhone (Dynamic Island), Android
(punch-hole), iPad/tablet, Watch ring — for phone/tablet/watch targets; a **premium** window-on-the-matte for
Mac/desktop (its capture is already a window, so `fit: 'contain'` shows the whole thing). Screenshots put the
**caption on top** by default. Override any of it via `stillTheme` / a per-shot `theme`, or `style: 'bleed'`
for a raw full-frame shot (Watch). **`play-feature-graphic`** is special: one 1024×500 brand banner (logo +
tagline + a tilted hero device), not a per-scene screenshot.

Commands:

```sh
zdymak build          # EVERYTHING: top-level videos + every device's screenshots (+ device videos)
zdymak screenshots    # just the per-device screenshots
zdymak video          # just the top-level video targets
zdymak reel           # LIVE-FOOTAGE montage (real motion) from the `reel` block — see below
zdymak build --clean  # wipe the output folder first, so ONLY this run's assets remain (no stale files)
```

**`--clean`** (on `build` / `screenshots` / `video` / `capture`) empties the target folder before writing,
so a removed target or renamed scene can't leave a stale screenshot behind — every file is produced by this
run. On `capture` it clears only stale PNG/MOV captures and keeps the `.dd` build cache (rebuilds stay
incremental).

`zdymak specs` lists every image target and its exact dimensions. A device that only ships iPhone simply
omits the others — that's the "use only part of it" contract.

<br>

## Live-footage reel — real motion, not Ken Burns

The video *targets* above animate a **static screenshot** (a subtle dolly) — inherently Ken Burns. For a
genuinely premium reel, feed **real motion**: `zdymak reel` composites short **recordings** of your app (or
an image sequence) on a clean matte, floats each with a rounded frame + soft shadow, puts the headline **on
top**, and **cross-dissolves** between beats — the restrained, Apple-App-Preview language. The matte defaults
to **light** (consistent with the store screenshots) and stills get a slow, never-freezing push-in.
Source-agnostic, like the two screenshot modes: each segment's footage can be **brought by you** or
**captured** by `zdymak capture --record`.

```js
reel: {
  size: [1080, 1920], bpm: 120, beatsPerCut: 4,   // hold = beatsPerCut × 60/bpm seconds per segment
  transition: 'dissolve',                          // default; 'cut' for beat-matched hard cuts
  music: { path: './bed.mp3', volume: 0.9, fadeIn: 0.6, fadeOut: 0.8 }, // optional, faded
  // theme: { bgTop: '#0e1a12', bgBottom: '#0b0b0a', label: true },     // override to a DARK bed if you want
  segments: [
    { clip: './rec/study.mov',   caption: { title: 'Recall it.', sub: 'Right before you forget.' } },
    { images: ['a.png', 'b.png'], caption: { title: 'Many cards.', sub: 'One page.' } }, // multi-photo page
  ],
}
```

- **`clip`** = a recording (real motion). **`image`** / **`images`** = one still or a sequence shown within
  the segment (a "multiple photos per page" beat). **`transition`** = `dissolve` (default) or `cut`. The screen
  sits in an **iPhone frame** by default (`theme.frame`: `'phone'` | `false` for a bare rounded screen). Matte
  colours / `inset` / `radius` / `shadow` / caption anchor default to a clean **light** look; override via the
  reel `theme`. Run `zdymak reel` → `<out>/reel.mp4`.
- **Compliant App Store App Preview** — Apple's in-store slot wants *real footage, full-bleed, no device
  frame*. Point the reel at recordings (not stills) with `theme: { bleed: true }`, `size: [886, 1920]`,
  `level: '4.0'`, and no captions. (The framed light reel above is the marketing/social asset, not the slot.)

## Where each file goes

- **App Store** — `appstore-preview.mp4` → App Store Connect → your app → *(localization)* → **App
  Previews**. One 886×1920 file fills **both** the 6.5" and 6.9" slots. Optional at launch; screenshots
  alone are a valid submission.
- **Google Play** — Play takes a **YouTube URL**, not a file. Upload `play-promo.mp4` to YouTube, then
  paste the link in Play Console → Main store listing → **Preview video**.
- **Web / social** — `social-reel.mp4` (**device-framed**: iPhone bezel + logo bookends) or
  `premium-reel.mp4` (**premium**: matte + vignette + label pills). For your website, X / Instagram /
  TikTok, or YouTube. **Never** put either in the App Store App Preview slot — the bezel/label make them
  marketing assets, not App Previews; that's what the full-bleed `appstore-preview` is for.

> **Three styles, one config.** Every target reads the same `scenes`; the style is fixed per target:
> - **full-bleed** (`appstore-preview`, `play-promo`) — the screen fills the frame; required for App Previews.
> - **device-framed** (`social-reel`) — an iPhone bezel + brand background + logo cold-open/end-card.
> - **premium** (`premium-reel`) — the **Apple editing-vocabulary** preset: every screen floats on a brand
>   matte with a soft glow + vignette, a motion-then-freeze spring dolly, **palette-aware cuts** (hard cut
>   within a palette, dissolve only at a shift), and a bottom title **pill**. Tune it with the optional
>   `theme` block (matte colours, `vignette`, `inset`, `handle`, cut timings) — brand-driven defaults apply
>   if you omit it.

<br>

## Programmatic use

```js
import { buildVideo, loadConfig, registerFonts, videoTarget } from 'zdymak';

const cfg = await loadConfig('zdymak.config.mjs');
registerFonts(cfg.brand.fontPaths);
await buildVideo({ scenes: cfg.scenes, spec: videoTarget('appstore-preview'), brand: cfg.brand, outFile: 'out.mp4' });
```

<br>

## Troubleshooting

- **`ffmpeg failed to start`** — install it (`brew install ffmpeg`) or set `$FFMPEG`.
- **Captions look like a fallback font** — pass `brand.fontPaths` to your own TTF; on Linux install a
  system sans (DejaVu).
- **Duration warning** — the tool warns if a video falls outside a store's min/max; adjust `sceneDur` or
  the number of scenes.
- **`Truncating packet …` line** — harmless ffmpeg notice from the raw-frame pipe; the output is correct.

<br>

## Roadmap

- [x] Video engine — three styles (full-bleed, device-framed, premium), App Store + Play + social targets.
- [x] **Multi-device screenshots** — iPhone / iPad / Mac / Watch, no-alpha PNG, modular `devices` config.
- [x] **Device-framed stills** — inferred per target (iPhone/iPad/Android/Watch bezel, Mac window), caption
      on top, `contain`-fit windows; all overridable via `stillTheme` / per-shot `theme`.
- [x] **Music bed** — `{ path, offset, fadeIn, fadeOut, volume }` across every video.
- [x] Automated publishing — npm trusted publishing (OIDC), see `RELEASING.md`.
- [ ] Capture: **Playwright (web)** driver (adb / iOS-sim snapshot already ship).
- [ ] Play feature graphic (1024×500) + per-locale caption sets.

See **SKILL.md** if you drive this with Claude Code.

MIT.
