# zdymak

**Premium App Store & Google Play preview videos — from your screenshots, in one command.**

Turn a handful of app screenshots into a cinematic, **spec-compliant** store preview: spring-eased camera
moves, kinetic captions, and an encode that App Store Connect and Google Play accept without a fight. One
small config per project; the engine lives here, shared across all your apps.

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

Needs **Node ≥18** and **ffmpeg** on your `PATH` (`brew install ffmpeg`).

```sh
# from a checkout (until published to npm):
npm i --prefix /path/to/zdymak
npm link --prefix /path/to/zdymak        # gives you the `zdymak` command
# …or just call it directly:
node /path/to/zdymak/bin/zdymak.mjs <command>
```

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
| `targets[]` | Which videos to build (`zdymak specs` lists them). |
| `sceneDur` / `xfade` | Seconds per scene / cross-dissolve. Tune total length to the store's 15–30s window. |
| `out` | Output directory. |

<br>

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

- [x] Premium video engine (spring motion, parallax captions), App Store + Play targets, two input modes.
- [ ] **Image targets** — framed & plain store screenshots (dimensions already locked in `specs`), Play
      feature graphic, watch/iPad sets.
- [ ] Optional licensed music bed + J-cut.
- [ ] Per-locale caption sets (drive captions from a localized strings file).

See **SKILL.md** if you drive this with Claude Code.

MIT.
