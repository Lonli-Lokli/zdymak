/**
 * Type definitions for zdymak — store screenshots, App Preview / Play promo videos and reels,
 * composed from your captures.
 *
 * The main reason these exist: a project's `zdymak.config.mjs` is the ONLY project-specific input, and
 * it deserves autocomplete + checking. Wrap it in `defineConfig` (works in plain `.mjs` — no build step,
 * no TypeScript in your project):
 *
 *   import { defineConfig } from 'zdymak';
 *   export default defineConfig({ brand: { … }, scenes: [ … ], targets: ['appstore-preview'] });
 *
 * Or, without the import, via a JSDoc type annotation:
 *
 *   /** @type {import('zdymak').Config} *\/
 *   export default { … };
 */

// ─── Targets ────────────────────────────────────────────────────────────────────────────────────

/** Video targets — produce an `.mp4` (`zdymak video` / `build`). */
export type VideoTargetId =
  | 'appstore-preview'
  | 'appstore-preview-ipad'
  | 'appstore-preview-mac'
  | 'play-promo'
  | 'social-reel'
  | 'premium-reel'
  /**
   * The App Store product page HEADER video (iOS/iPadOS 27+): 3840×1646, 30 or 60 fps, 5–30 s, loops,
   * muted by default. Built by `zdymak reel` (a `reel` entry with this `destination`), never by
   * `video`/`build` — those Ken-Burns screenshots, and refuse it.
   */
  | 'appstore-header-video'
  /**
   * The App Store SEARCH RESULTS video (iOS/iPadOS 27+): any 3:2 from 1920×1280 to 3840×2560 (default
   * 2880×1920 — the ceiling needs H.264 level 6), 30 or 60 fps, 5–30 s, always muted. `zdymak reel` only.
   */
  | 'appstore-search-video';

/** Screenshot / graphic targets — produce still PNGs (`zdymak screenshots` / `build`). */
export type ImageTargetId =
  | 'appstore-iphone-6.9'
  | 'appstore-iphone-6.5'
  | 'appstore-ipad-13'
  /** The SAME App Store slot as `appstore-ipad-13`, turned — capture with `--orientation`. */
  | 'appstore-ipad-13-landscape'
  /**
   * iPhone Duo, OUTER display, 1398×2034. One "iPhone Duo" slot takes all four Duo sizes; optional now,
   * required from April 2027 for apps built with the iOS 27.1 SDK. Framed by `duo`: no Dynamic Island.
   */
  | 'appstore-iphone-duo-outer'
  /** iPhone Duo, outer display turned: 2034×1398. Same slot. */
  | 'appstore-iphone-duo-outer-landscape'
  /** iPhone Duo, INNER display held upright: 2007×2853. Same slot. Framed by `duo-inner`. */
  | 'appstore-iphone-duo-inner'
  /** iPhone Duo, inner display open like a book: 2853×2007. Same slot. */
  | 'appstore-iphone-duo-inner-landscape'
  | 'appstore-watch'
  | 'appstore-mac'
  /**
   * The App Review Screenshot on an IN-APP PURCHASE — a different slot from the listing ones, and
   * an older size table behind it. 1290x2796 and 1320x2868 are both refused there ("The dimensions
   * of one or more screenshots are wrong") even though Apple lists both as valid 6.9" sizes and the
   * listing slots take them; 640x920 is this target's default for that reason.
   */
  | 'appstore-iap-review'
  /** The OPTIONAL 1024x1024 promotional image for an in-app purchase, flattened as Apple asks. */
  | 'appstore-iap-promo'
  | 'play-phone'
  | 'play-tablet'
  /** The SAME two Play tablet slots as `play-tablet`, upright — capture with `--size 1600x2560`. */
  | 'play-tablet-portrait'
  | 'play-wear'
  | 'play-feature-graphic'
  | 'play-icon'
  /** Not a store asset — the 1200×630 og:image / twitter:image a shared LINK previews with. */
  | 'social-card'
  /**
   * App Store product page HEADER image (iOS/iPadOS 27+), 3840×1646 (21:9). A branded graphic built
   * around one hero capture — name it with `hero`, ideally a landscape one — inside Apple's art safe area.
   */
  | 'appstore-header'
  /** App Store SEARCH RESULTS image, any 3:2 from 1920×1280 to 3840×2560 (default the ceiling). */
  | 'appstore-search'
  /** The UNIVERSAL creative asset, 5244×2950 (16:9) PNG: one file for the header AND search results. */
  | 'appstore-universal';

export interface VideoTargetSpec {
  store: string;
  w: number;
  h: number;
  fps: number;
  profile: string;
  level: string;
  minSec: number | null;
  maxSec: number | null;
  style: RenderStyle;
  slot: string;
  /** Sizes the store takes; an explicit `size:` override is held to this list too. */
  accepts?: Array<[number, number]>;
  /** A store that takes a RANGE of sizes at one exact ratio (the App Store search slot). */
  range?: SizeRange;
  /** Frame rates the store takes, when it names them (`[30, 60]`). 29.97 counts as 30. */
  fpsAllowed?: number[];
  /** Built by `zdymak reel` only; `video`/`build` refuse it. */
  reelOnly?: boolean;
  /** An App Store creative asset (iOS/iPadOS 27+ header or search), not an App Preview. */
  creative?: boolean;
  /** How the store plays its sound: `'always'` muted (search), or muted by `'default'` (header). */
  muted?: 'always' | 'default';
}

/** Every size from `min` to `max`, at exactly `ratio` (e.g. 3:2 from 1920×1280 to 3840×2560). */
export interface SizeRange {
  min: [number, number];
  max: [number, number];
  ratio: [number, number];
}

export interface ImageTargetSpec {
  store: string;
  /** Exact width, when the store mandates one size. */
  w?: number;
  /** Exact height, when the store mandates one size. */
  h?: number;
  /** Alternative accepted sizes, when the store takes any of several (e.g. Apple Watch). */
  accepts?: Array<[number, number]>;
  /** Any size in a range at one ratio (the App Store search image); `w`/`h` is then the default. */
  range?: SizeRange;
  alpha: boolean;
  format: 'png';
  /** A single branded banner (the Play feature graphic), not a per-scene shot. */
  graphic?: boolean;
  /** An App Store creative asset (header, search, universal): a graphic laid out around `safe`. */
  creative?: boolean;
  /**
   * The ART SAFE AREA `[x, y, w, h]` in this canvas's pixels, from Apple's own template — where the
   * words and the hero's leading edge go, because the store crops the rest per device and orientation.
   */
  safe?: [number, number, number, number];
  /** A branded SQUARE built from `brand.logo` — the Play icon and Apple's in-app purchase image. */
  icon?: boolean;
  /** Size cap the store enforces, in bytes. */
  maxBytes?: number;
  /**
   * The interface alone — no bezel, no headline, no matte, whatever the target's name suggests.
   *
   * For a slot that is not a shop window. An in-app purchase review screenshot is looked at once,
   * by a reviewer asking where in the app the item appears, and marketing furniture is an answer
   * to a question nobody asked. Sets the default style to `bleed` and drops the caption; a shot
   * can still override the style explicitly.
   */
  plain?: boolean;
  label: string;
}

export declare const VIDEO_TARGETS: Record<VideoTargetId, VideoTargetSpec>;
export declare const IMAGE_TARGETS: Record<ImageTargetId, ImageTargetSpec>;

/** Resolve a video target by id; throws with the list of valid ids. */
export declare function videoTarget(id: VideoTargetId | (string & {})): VideoTargetSpec;

// ─── Config ─────────────────────────────────────────────────────────────────────────────────────

/** Ken-Burns motion applied to a scene. Omit and zdymak rotates through a varied default sequence. */
export type SceneMove =
  | 'pushIn'
  | 'pushInSlow'
  | 'pullBack'
  | 'pullBackSlow'
  | 'driftUp'
  | 'driftDown'
  | 'driftLeft'
  | 'driftRight'
  | 'still';

/**
 * Transition INTO a scene (reel only). The default `cut` is deliberately plain — reaching for a different
 * decorative transition at every boundary is the loudest amateur tell. `auto` is a deterministic rotation
 * that stays mostly plain. See the transition table in the README.
 */
export type CutId = 'cut' | 'dissolve' | 'cinematic-dissolve' | 'match-cut' | 'fade-through-black' | 'dip-to-white' | 'soft-flash' | 'slow-zoom-through' | 'pull-out' | 'soft-zoom-punch' | 'frame-fill' | 'push' | 'push-up' | 'page-slide' | 'warp-slide' | 'whip-pan' | 'polaroid-drop' | 'blur-dissolve' | 'zoom-punch' | 'clean-line-wipe' | 'edge-wipe-soft' | 'iris-circle' | 'iris-split' | 'mirror-split' | 'heart-wipe' | 'flip' | 'spin-3d' | 'page-peel' | 'tearing-paper' | 'light-leak-wipe' | 'glare-sweep' | 'floodlight-sweep' | 'clouds-wipe' | 'glitch-cut' | 'clean-circle-wipe' | 'auto';

/** Per-scene look (reel only — never applied to store screenshots). See the effect table in the README. */
export type EffectId = 'none' | 'bw' | 'sepia' | 'cool' | 'vibrant' | 'soft-faded' | 'warm-film' | 'duotone' | 'vignette' | 'soft-glow' | 'dreamy-haze' | 'bokeh' | 'glare' | 'floodlight' | 'light-leak' | 'film-grain' | 'scanlines' | 'dust-scratches' | 'camera-shake' | 'letterbox' | 'falling-snow' | 'sparkles-fireflies' | 'heart-drift' | 'confetti-drift' | 'clouds-drift';

/** Still-rendering style. Inferred per target (framed device / premium window); override per shot. */
export type RenderStyle = 'framed' | 'premium' | 'bleed' | 'reel';

/**
 * Device bezel drawn around a capture. Inferred from the target; override with `frame`.
 * `laptop`/`chromebook`/`desktop` draw a clamshell and are mainly for layout members; `mac` (and any
 * unknown id) adds no body, since Mac captures already carry their own window chrome. `duo` and
 * `duo-inner` are the iPhone Duo's displays — a plain body at the display's true aspect, with no
 * Dynamic Island, camera or crease, because Apple publishes none. `none` asks for no body by name.
 */
export type FrameId =
  | 'phone' | 'iphone' | 'android' | 'ipad' | 'tablet' | 'watch'
  | 'duo' | 'duo-inner'
  | 'laptop' | 'chromebook' | 'desktop'
  | 'macbook' | 'mac-window' | 'mac' | 'none';

export interface Brand {
  /** Near-black base colour. */
  ink?: string;
  /** Headline colour. */
  title?: string;
  /** Subhead colour. */
  sub?: string;
  /** Custom TTF/OTF files to register, relative to the config file. */
  fontPaths?: string[];
  /** App name — cold-open + end-card of the device-framed `social-reel`. */
  name?: string;
  /** One-line positioning, used on the reel cold-open and the Play feature graphic. */
  tagline?: string;
  /** End-card headline. */
  endline?: string;
  /** End-card subhead (e.g. the honest offer). */
  endsub?: string;
  /** Logo path (relative to the config file) for the reel + feature graphic. */
  logo?: string | null;
  /**
   * Feature graphic: shifts the whole left-hand block — lockup, tagline, endline — down by this
   * many pixels, keeping its internal spacing. The default layout hangs the block from the top,
   * which strands a short tagline in the upper corner with the bottom third empty. Default 0.
   */
  textOffsetY?: number;
  /**
   * Gap between the icon and the wordmark, as a fraction of the icon's size. Applies to the feature
   * graphic and to the reel's cold-open and end-card, so one value keeps the lockup consistent
   * across both. Defaults to 0.32 on the reel, and to a flat 26px on the feature graphic.
   */
  lockupGap?: number;
  /**
   * Feature graphic: images fanned out like a hand of cards — each rotated a little further from
   * the middle, overlapped, and drop-shadowed. Paths relative to the config file; ones that do not
   * exist are skipped rather than failing the build.
   */
  fan?: string[];
  /** Radians of rotation between neighbouring [fan] images. Default 0.17. */
  fanSpread?: number;
  /** Centre of the [fan], in pixels. Default: 55% across, 92% down. */
  fanX?: number;
  fanY?: number;
  /** Height of each [fan] image in pixels; width follows its aspect ratio. Default 300. */
  fanHeight?: number;
}

/**
 * Matte + caption styling. `theme` styles VIDEOS; `stillTheme` styles SCREENSHOTS (falling back to
 * `theme`); a per-shot / per-device `theme` overrides both for that item.
 */
/**
 * How a capture gets its status bar: `'auto'` (a bar across the top, only into an empty band found there),
 * `true` (forced), `false` (none), or `'column'` (the closed iPhone Duo's column down the right edge).
 */
export type StatusBarMode = 'auto' | 'column' | boolean;

export interface Theme {
  /** Matte gradient, top colour. */
  bgTop?: string;
  /** Matte gradient, bottom colour. */
  bgBottom?: string;
  /** Radial glow colour behind the device. */
  glow?: string;
  /** Glow strength, 0–1. */
  glowAlpha?: number;
  /** Corner darkening, 0–1. Use 0 on a light matte. */
  vignette?: number;
  /** Padding between the device and the frame edge, in px. */
  inset?: number;
  /** Draw the headline in a dark pill (`true`) or as plain text (`false`). */
  label?: boolean;
  /** Headline colour. */
  labelColor?: string;
  /** Subhead colour. */
  subColor?: string;
  /** Persistent social handle drawn at the top (e.g. `'@yourapp'`). */
  handle?: string;
  /** Caption position. Screenshots default to `'top'`. */
  captionAnchor?: 'top' | 'bottom';
  /** How the capture fills its area — `'contain'` shows a whole window, `'cover'` crops. */
  fit?: 'contain' | 'cover';
  /** Multiplier on the headline size. */
  headlineScale?: number;
  /** Device bezel to draw; overrides the target's inferred frame. */
  frame?: FrameId;
  /** Let the capture bleed to the frame edge (no matte margin). */
  bleed?: boolean;
  /** Rotate the device about its own centre, in degrees. Default `0` (upright). */
  tilt?: number;
  /** Multiplier on the device width. Above `1` the body runs off the frame edge. Default `1`. */
  deviceScale?: number;
  /** Device centre as a fraction of frame height. Default follows `captionAnchor`. */
  deviceY?: number;
  /**
   * Paint a clean status bar (time · signal · wifi · full battery) into the empty status-bar band some
   * captures carry — an Android Compose capture reserves the inset but can't contain the system UI.
   * `'auto'` (default) draws it only when such a band is detected; `true` forces it; `false` skips.
   *
   * `'column'` is the closed iPhone Duo instead (iOS 27.1): no bar across the top, but a column 84 pt wide
   * down the RIGHT edge, with the clock and one round Wi-Fi/battery/signal glyph stacked at its top. Drawn
   * only into a flat band at the right edge that is wide enough to hold them, over the top 160 pt; sized
   * from the capture's width as the Duo's 466 pt; portrait captures only. Never the default — opt in per
   * shot on the closed Duo's target.
   */
  statusBar?: StatusBarMode;
  /** Clock shown in that status bar. Defaults to `'9:41'`. */
  statusBarTime?: string;
  /**
   * Draw cell-signal bars. Inferred by device class — on for phones, off for tablets (ours are Wi-Fi
   * models) and landscape captures. Set it explicitly for a cellular tablet.
   */
  statusBarCellular?: boolean;
  /** Cover-fit anchor when the capture is taller than the slot. `'top'` crops from the bottom only. */
  anchor?: 'center' | 'top';
}

/**
 * One device in a LAYOUT scene's cluster. Position and size are FRACTIONS of the output canvas, never
 * pixels, so a single layout renders correctly into every slot it is pointed at — a portrait App Store
 * 6.9" shot and a landscape Play large-screen shot from the same few lines.
 */
export interface LayoutMember {
  /** Capture id — resolves to `<capturesDir>/<id><suffix>.png`. Required unless `image` is given. */
  id?: string;
  /**
   * Explicit image path (relative to the config file). Use this to pull a capture from ANOTHER
   * platform's directory — how one cluster shows a phone, a tablet and a laptop together.
   */
  image?: string;
  /** Device body to draw it in. Default `'phone'`. */
  frame?: FrameId;
  /** Centre X as a fraction of canvas width (0–1). Default `0.5`. */
  x?: number;
  /** Centre Y as a fraction of canvas height (0–1). Default `0.55`. */
  y?: number;
  /** SCREEN width as a fraction of canvas width (the body draws slightly wider). Default `0.3`. */
  w?: number;
  /** Rotation in degrees about the member's own centre. Default `0`. */
  tilt?: number;
  /** Per-member status-bar override; falls back to the shot's theme. */
  statusBar?: StatusBarMode;
}

/** How the iPhone Duo stands half open: the inner display bent like a laptop (tall) or a book (wide). */
export type FoldPosture = 'laptop' | 'book' | 'half-laptop' | 'half-book';

/**
 * A half-open Duo drawn in 3D around a real capture. Every option has a default per posture, so
 * `{ posture: 'laptop' }` and the bare string `'laptop'` are the same.
 */
export interface Fold {
  posture: FoldPosture;
  /** The angle between the two halves, in degrees, 60 to 180. Default laptop `110`, book `136`. */
  hinge?: number;
  /** How far above the device the camera stands, in degrees, 0 to 80. Default laptop `24`, book `12`. */
  elev?: number;
  /** The camera's turn around the device, in degrees, -60 to 60 (positive looks from the right). Default `0`. */
  yaw?: number;
  /** The camera's distance in multiples of the capture's short side, 1.5 to 20. Default `3.4`. */
  dist?: number;
  /** How dark the soft shade along the fold is, 0 to 1; `0` leaves the screen exactly the capture. Default `0.16`. */
  crease?: number;
}

export interface Scene {
  /** Capture id — resolves to `<capturesDir>/<id><suffix>.png`. Required unless `image` is given. */
  id?: string;
  /** Explicit image path (relative to the config file), instead of `id`. */
  image?: string;
  /**
   * Compose SEVERAL captures into this one shot — the "works on every device" page — instead of framing
   * a single capture. Members draw in array order: the first is furthest back, the last sits in front.
   * A member whose capture is missing is skipped and reported; the rest still render.
   *
   * Replaces `id`/`image` on the scene that carries it. Screenshots only.
   */
  layout?: LayoutMember[];
  /**
   * Draw this scene's Duo half open, in 3D, instead of the flat inner-display frame: `'laptop'` for a
   * tall capture shot with `--posture half-laptop`, `'book'` for a wide one shot with `--posture
   * half-book`, or a `Fold` to move the hinge or the camera. Only the framed style on the inner-display
   * targets (`appstore-iphone-duo-inner`, `-landscape`) draws it; a plain or bleed shot of the scene shows
   * the capture as always, and a reel or video stays flat. The screen is the capture's own pixels.
   */
  fold?: 'laptop' | 'book' | 'half-laptop' | 'half-book' | Fold;
  /** Headline. */
  title?: string;
  /** Subhead. */
  sub?: string;
  /**
   * Take the caption of the top-level scene with this id: its `title` and `sub`, and every locale's
   * translation of them. For a device's own scene that shows the same moment under another id (a Duo
   * posture's `closed-fresh` showing `fresh`), so the caption is written once. A `title` or `sub` on
   * this scene still wins over the borrowed one.
   */
  captionOf?: string;
  /** Ken-Burns motion for video targets. */
  move?: SceneMove;
  /** Reel only — how the video cuts INTO this scene. Defaults to a hard `cut`. */
  cut?: CutId;
  /** Reel only — the per-scene look (colour grade and/or overlay). */
  effect?: EffectId;
  /**
   * Reel only — give THIS scene the one earned camera move: an overdamped spring push-in on the device,
   * with the caption pinned. Use it on at most one scene; motion on every beat is the tell it isn't.
   */
  push?: boolean;
}

/**
 * One locale's captions: scene id → the headline/subhead to draw. The reserved `$brand` key localizes
 * the wordmark copy used by the feature graphic (colours and logo stay global).
 */
export type SceneCaption = { title?: string; sub?: string };

/** The localizable wordmark copy, under a caption table's reserved `$brand` key. */
export type BrandCaptions = Pick<Brand, 'name' | 'tagline' | 'endline' | 'endsub'>;

export type CaptionTable = { $brand?: BrandCaptions } & {
  [sceneId: string]: SceneCaption | BrandCaptions | undefined;
};

export interface Music {
  /** Audio file, relative to the config file. */
  path: string;
  /** Seconds to skip into the track. */
  offset?: number;
  fadeIn?: number;
  fadeOut?: number;
  /** 0–1. */
  volume?: number;
}

export interface ScreenshotSpec {
  target: ImageTargetId | (string & {});
  /** Output subfolder; defaults to the target id. Lets one target render twice (e.g. styled + plain). */
  dir?: string;
  /** `false` renders the app interface alone — no headline/subhead. Required styling for Play uploads. */
  caption?: false;
  /** Exact output size, when a slot accepts several. */
  size?: [number, number];
  /** Override the inferred style (e.g. `'bleed'` for a raw full-frame Watch shot). */
  style?: RenderStyle;
  /**
   * Override the inferred device bezel. On the App Store creative graphics it frames the HERO: unset,
   * a landscape hero is the bare screen and a portrait one gets the iPhone frame.
   */
  frame?: FrameId;
  /** Per-shot matte override. */
  theme?: Theme;
  /**
   * Branded graphics only (`play-feature-graphic`, `social-card`, `appstore-header`, `appstore-search`,
   * `appstore-universal`): the capture to build it around — a scene id of this device, or a path
   * relative to the config file. Named and missing is an error, never a fallback. Unset: the first
   * capture, or for the App Store creative graphics the first LANDSCAPE one.
   */
  hero?: string;
  /**
   * App Store creative graphics only: `false` leaves the `brand.fan` cards out; a list of image paths
   * deals those cards instead (a header that shows a whole hand while the feature graphic keeps three).
   */
  fan?: false | string[];
  /**
   * App Store creative graphics only: where the cards go. `'margin'` (default) stands them outside the
   * safe area, beside the words; `'below'` centres the words and hero as one group over a hand rising
   * from the bottom edge, every card inside the iPhone's crop and cut by the bottom edge only.
   */
  hand?: 'margin' | 'below';
  /**
   * App Store creative graphics only: `[x, y, w, h]` of the hero capture, in its pixels, to use instead
   * of the whole capture — the table alone, without the app's header and controls around it.
   */
  heroCrop?: [number, number, number, number];
  /** App Store creative graphics only: stand it on a picture instead of the matte. */
  ground?: CreativeGround;
  /**
   * App Store creative graphics only: draw the hero bare, its edges fading into the ground over this share of
   * its size on each side (0.08 is a good start), and let it stand the canvas's full height.
   */
  heroFeather?: number;
  /** App Store creative graphics only: the icon, faces and colours of the name and tagline. */
  lockup?: CreativeLockup;
}

/** App Store creative graphics: a picture as the ground in place of the matte gradient. */
export interface CreativeGround {
  /** The picture, cover-filled (the app's own room or scene art, say). */
  image: string;
  /** Which band of it shows: 0 its top, 1 its bottom. Default 0.5. */
  anchor?: number;
  /** Blur, as a fraction of the canvas width, so it reads as depth behind the hero. Default 0.007. */
  blur?: number;
  /** A colour laid over the whole ground: pick it so the strip is a mid tone on a white and a black page. */
  tint?: string;
  /** A colour under the words, fading out before the hero, so the lockup reads over a busy ground. */
  scrim?: string;
}

/** App Store creative graphics: how the name and tagline are set. */
export interface CreativeLockup {
  /** `false` leaves the icon out of the lockup (the store prints it under the header anyway). */
  logo?: false;
  /** A font file for the name: the app's own wordmark face. */
  nameFont?: string;
  /** The name's size against the default (1). Without the icon, the name can take its room: 1.5, say. */
  nameScale?: number;
  /** A font file for the tagline. */
  taglineFont?: string;
  /** The name's and the tagline's colour, and the tagline's second sentence's, in place of the brand's. */
  title?: string;
  sub?: string;
}

/** How an asset is rendered — independent of where it's going. */
export type PresetId = 'full-bleed' | 'framed' | 'premium';

export interface VideoSpec {
  /**
   * Where it's going. DESTINATION decides only what the store accepts — pixel size, codec, duration
   * bounds, file cap. Use this with `preset` for the split form.
   */
  destination?: VideoTargetId | (string & {});
  /**
   * How it looks. `full-bleed` (no bezel — required for App Previews), `framed` (device + brand
   * bookends), `premium` (floating on the matte). Defaults to whatever the destination implies.
   */
  preset?: PresetId;
  /**
   * Bring your own vocabulary: scenes that don't name a `cut` cycle through this list instead of the
   * preset's default. Same for `effects`.
   */
  transitions?: CutId[];
  effects?: EffectId[];
  /** Shorthand for `{ destination, preset }` — every existing config keeps working. */
  target?: VideoTargetId | (string & {});
  /** Exact output size — e.g. a landscape Mac reel at `[2880, 1800]`. */
  size?: [number, number];
  theme?: Theme;
}

/**
 * One device class. An app configures ONLY the devices it ships; a device whose captures are missing
 * skips cleanly (screenshots AND videos), so a partial capture still composes what it has.
 */
export interface DeviceGroup {
  /**
   * Where this device's captures live, relative to the config file. Defaults to `screenshotsDir`.
   *
   * May contain a `{locale}` token (e.g. `'./captures/{locale}'`), resolved per render locale so a
   * localized run frames that language's captures instead of re-captioning the source language. On
   * the base pass the token resolves to `sourceLocale`.
   */
  capturesDir?: string;
  /** Filename suffix for this device (e.g. `'-light'`). Defaults to the top-level `suffix`. */
  suffix?: string;
  /** Scene override for this device. Defaults to the shared top-level `scenes`. */
  scenes?: Scene[];
  /** Store screenshot slots to render. A bare string is shorthand for `{ target }`. */
  screenshots?: Array<ScreenshotSpec | ImageTargetId | (string & {})>;
  /** Video targets rendered from THIS device's captures. A bare string is shorthand for `{ target }`. */
  videos?: Array<VideoSpec | VideoTargetId | (string & {})>;
  /** Matte override for everything in this group. */
  theme?: Theme;
}

/** One beat of a live-footage reel: a recording, a still, or an image sequence. */
export interface ReelSegment {
  /** A video recording (real motion), relative to the config file. */
  clip?: string;
  /** A single still — gets a slow push-in. */
  image?: string;
  /** An image sequence shown in order. */
  images?: string[];
  caption?: { title?: string; sub?: string };
  /** This segment's length in seconds, overriding the reel's `sceneDur` — a short title card, a long round. */
  dur?: number;
  /** Seconds into `clip` to start from, so one long take can supply several beats. */
  from?: number;
  /** Playback rate for `clip` (2 = twice as fast): the footage is re-timed, not the app hurried. */
  speed?: number;
}

/**
 * Live-footage reel (real motion, not Ken Burns) — built by `zdymak reel`, independent of `targets`.
 */
export interface ReelConfig {
  /**
   * Output basename — `<out>/<name>.mp4`, and what `zdymak reel --only <name>` selects. Defaults to
   * `reel` for a lone entry, `reel-1`/`reel-2`/… when several are declared without names.
   */
  name?: string;
  /**
   * The store slot this reel is for, and is measured against after the encode — size (or range),
   * duration window, frame rate. Also inferred when `name` is itself a video target id. The
   * destination fills in `size`/`fps`/`profile`/`level` left unset; the App Store creative ones also
   * default `theme.frame` to `false`. `--force` writes a reel that fails anyway.
   */
  destination?: VideoTargetId | (string & {});
  size?: [number, number];
  fps?: number;
  profile?: string;
  /** H.264 level — a floor: the encoder raises it to what the frame size and rate need. */
  level?: string;
  /** Seconds per beat. Overrides the `bpm`/`beatsPerCut` calculation. */
  sceneDur?: number;
  /** Music tempo, used with `beatsPerCut` to derive the cut rhythm. */
  bpm?: number;
  /** Beats held per segment. */
  beatsPerCut?: number;
  /** `'cut'` for beat-matched hard cuts; omit for the default dissolve. */
  transition?: 'cut' | 'dissolve';
  /** Dissolve length in seconds. */
  xfadeDur?: number;
  /** Matte override. Defaults to the LIGHT bed with the caption on top. */
  theme?: Theme;
  music?: Music;
  segments: ReelSegment[];
}

/** Reel-mode timeline override for the device-framed `social-reel` target. */
export interface Timing {
  coldOpen?: number;
  /** Seconds per scene. Ignored when `bpm` is set. */
  scene?: number;
  endCard?: number;
  xfade?: number;
  /** Music tempo — cuts land on the beat: hold = `beatsPerCut × 60 / bpm`. */
  bpm?: number;
  /** Beats held per scene (default 4). */
  beatsPerCut?: number;
}

/**
 * A project's `zdymak.config.mjs`. Every path is resolved relative to the config file.
 *
 * Provide `scenes`, a `devices` map, or a `reel` block — at least one must supply content.
 */
export interface Config {
  brand?: Brand;
  /** Default captures dir for the top-level `scenes`. Defaults to the config file's own directory. */
  screenshotsDir?: string;
  /** What a `{locale}` token in `capturesDir` resolves to on the base pass. Defaults to `'en'`. */
  sourceLocale?: string;
  /** Appended to `scene.id` to form the filename: `<id><suffix>.png`. */
  suffix?: string;
  /** The shared scene list — used by the top-level `targets` and by any device without its own. */
  scenes?: Scene[];
  /** Video targets rendered from the top-level `scenes`. Defaults to `['appstore-preview']`. */
  targets?: Array<VideoTargetId | (string & {})>;
  /** Seconds per scene in a video. */
  sceneDur?: number;
  /** Cross-fade length between scenes, in seconds. */
  xfade?: number;
  /** Timeline override for the device-framed reel style. */
  timing?: Timing;
  /** Matte + caption styling for VIDEOS. */
  theme?: Theme;
  /** Matte + caption styling for SCREENSHOTS; falls back to `theme`. */
  stillTheme?: Theme;
  /** Music bed shared by every video target. Silent when omitted. */
  music?: Music;
  /** Per-device screenshots + videos, keyed by a name of your choosing (`iphone`, `android`, …). */
  devices?: Record<string, DeviceGroup>;
  /**
   * Localized screenshot sets, keyed by store locale. Each value is either a JSON file path or an
   * inline table of `sceneId → { title, sub }`. A locale renders to `<out>/<locale>/<target>/…`;
   * scenes it doesn't translate keep their base caption (reported, never silent).
   */
  captions?: Record<string, string | CaptionTable>;
  /**
   * Live-footage reel(s), built by `zdymak reel`.
   *
   * An ARRAY cuts the same footage several ways from one config — e.g. an App Preview at 886×1920
   * with the score and a Play promo at 1080×1920 silent. `size`, `music` and `segments` cannot be
   * overridden by a flag, so multiple cuts need multiple entries; give each a `name`.
   */
  reel?: ReelConfig | ReelConfig[];
  /** Output directory. Defaults to `store-assets`. */
  out?: string;
  /**
   * The app's own logic around every command, in the order given (the first is outermost). Each entry is a function
   * `(ctx, next)` or an object `{ name, commands, run }` that limits it. Code before `await next()` may refuse with
   * `ctx.fail(reason)`; code after it can inspect what the command made. Wraps build, video, reel, screenshots, capture
   * and check. See the README, "Middleware".
   */
  middleware?: Middleware[];
}

/** What a middleware entry is handed. `config` is the raw config as the file exports it, or null when there is none. */
export interface MiddlewareContext {
  tool: 'zdymak';
  version: string;
  /** The command: `build`, `video`, `reel`, `screenshots`, `capture` or `check`. */
  command: string;
  /** The parsed `--flags`. */
  flags: Record<string, string | boolean>;
  /** The positional arguments after the command (the files given to `check`, say). */
  args: string[];
  /** Everything after the command name, unparsed. */
  argv: string[];
  config: Config | null;
  configPath: string;
  /** Where the command writes: `--out`, else `shots` for `capture`, else the config's `out`; null for `check`. */
  outDir: string | null;
  /** `Date.now()` when the command was about to start. */
  startedAt: number;
  /** Files under `outDir` (default `.png`, `.mp4`, `.mov`) written during this run, sorted. */
  changedFiles(exts?: string[]): string[];
  cwd: string;
  env: Record<string, string | undefined>;
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  /** Refuse: stops the command, prints the reason and exits 1. */
  fail(reason: string): never;
}

export type MiddlewareFunction = (ctx: MiddlewareContext, next: () => Promise<unknown>) => unknown;

export interface MiddlewareObject {
  /** Shown in messages; defaults to the function's own name. */
  name?: string;
  /** Run only for these commands. */
  commands?: string | string[];
  run: MiddlewareFunction;
}

export type Middleware = MiddlewareFunction | MiddlewareObject;

/** Thrown by `ctx.fail`. The CLI prints it as a refusal and exits 1. */
export declare class MiddlewareRefusal extends Error {
  middleware: string;
  reason: string;
}

export declare function normalizeMiddleware(list: unknown, tool?: string): Array<{ name: string; commands: string[] | null; stores: string[] | null; run: MiddlewareFunction }>;
export declare function runMiddleware<T>(list: unknown, ctx: Record<string, unknown> & { tool: string; command: string }, final: () => Promise<T>): Promise<T>;

/**
 * How empty is this capture? `colours` is the distinct colour count (sampled every second pixel) and `dominant` the share
 * of the most common colour. null when the file cannot be decoded. The same measurement `zdymak check` applies.
 */
export declare function captureBlankness(file: string): Promise<{ colours: number; dominant: number } | null>;
/** A capture under this many distinct colours AND over `BLANK_DOMINANCE` of one colour drew nothing. */
export declare const BLANK_COLOURS: number;
export declare const BLANK_DOMINANCE: number;


/**
 * Identity helper — returns the config unchanged, but gives editors the type in a plain `.mjs` file.
 */
export declare function defineConfig(config: Config): Config;

// ─── Resolved config (what `loadConfig` returns) ────────────────────────────────────────────────

export interface ResolvedScene {
  id: string;
  /** Absolute path. */
  image: string;
  title: string;
  sub: string;
  move?: SceneMove;
  /** As written in the config; checked at load. */
  fold?: Scene['fold'];
}

export interface ResolvedDevice {
  /** The key this group had in the `devices` map. */
  name: string;
  scenes: ResolvedScene[];
  screenshots: ScreenshotSpec[];
  videos: VideoSpec[];
  theme?: Theme;
}

export interface ResolvedConfig {
  brand: Required<Pick<Brand, 'ink' | 'title' | 'sub'>> & Brand & { fontPaths: string[] };
  /** Always an ARRAY after `loadConfig`, even when the config declared a single entry. */
  reel?: ReelConfig[];
  scenes: ResolvedScene[];
  devices: ResolvedDevice[];
  /** Caption tables with every JSON path already read. */
  captions?: Record<string, CaptionTable>;
  music?: Music;
  targets: Array<VideoTargetId | (string & {})>;
  sceneDur: number;
  xfade: number;
  timing?: Timing;
  theme?: Theme;
  stillTheme?: Theme;
  /** Absolute output directory. */
  out: string;
  /** Absolute directory of the config file — the root every relative path resolved against. */
  baseDir: string;
}

/** Load + normalize a `zdymak.config.mjs` / `.json`, resolving every path against the config file. */
export declare function loadConfig(configPath: string): Promise<ResolvedConfig>;

// ─── Programmatic API ───────────────────────────────────────────────────────────────────────────

/** Encoder spec for a video build. */
export interface EncodeSpec {
  w: number;
  h: number;
  fps?: number;
  profile?: string;
  level?: string;
  store?: string;
  minSec?: number | null;
  maxSec?: number | null;
}

export interface VideoResult {
  outFile: string;
  totalDur: number;
  frames: number;
  warnings: string[];
}

/** Full-bleed Ken-Burns video (App Preview / Play promo). */
export declare function buildVideo(opts: {
  scenes: ResolvedScene[];
  spec: EncodeSpec;
  brand: Brand;
  outFile: string;
  sceneDur?: number;
  xfade?: number;
  music?: Music;
}): Promise<VideoResult>;

/** Device-framed marketing reel (cold-open + scenes + end-card). */
export declare function buildReel(opts: {
  scenes: ResolvedScene[];
  spec: EncodeSpec;
  brand: Brand;
  outFile: string;
  timing?: Timing;
  music?: Music;
}): Promise<VideoResult>;

/** Premium style — full-bleed screens on a brand matte with Apple-style editing. */
export declare function buildPremium(opts: {
  scenes: ResolvedScene[];
  spec: EncodeSpec;
  brand: Brand;
  theme?: Theme;
  outFile: string;
  sceneDur?: number;
  music?: Music;
}): Promise<VideoResult>;

export interface WrittenScreenshot {
  file: string;
  W: number;
  H: number;
  style: RenderStyle | 'graphic';
}

/** Render every screenshot for one resolved device group. */
export declare function buildDeviceScreenshots(opts: {
  device: ResolvedDevice;
  brand: Brand;
  theme?: Theme;
  outDir: string;
}): Promise<WrittenScreenshot[]>;

/** The 1024×500 Play feature graphic — a brand banner, not a per-scene shot. */
export declare function buildFeatureGraphic(opts: {
  W?: number;
  H?: number;
  brand: Brand;
  theme?: Theme;
  /** Capture framed as the tilted hero device. */
  heroPath?: string;
  outFile: string;
  frame?: FrameId;
}): Promise<void>;

/** A rectangle in canvas pixels. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where an App Store creative graphic puts things: the words, the hero (its outer box) and the fan. */
export interface CreativeLayout {
  safe: Rect;
  text: Rect;
  hero: Rect;
  /**
   * The point the fan's cards stand on (below the bottom edge) and their height; for a hand below,
   * also its whole width with rotation (`span`), how far apart the cards stand in card widths (`step`),
   * how far each turns (`spread`, radians) and how much each drops per place from the middle (`arc`).
   */
  fan: { cx: number; cy: number; h: number; span?: number; step?: number; spread?: number; arc?: number };
}

/**
 * The layout of an App Store creative graphic, as pure geometry: the words inside the safe area, the
 * hero starting inside it and running out to the right, the fan in a margin outside it.
 */
export declare function creativeLayout(opts: {
  W: number;
  H: number;
  /** The art safe area `[x, y, w, h]` in this canvas's pixels. */
  safe: [number, number, number, number];
  /** The hero SCREEN's height / width. */
  heroAspect: number;
  /** Leave room for a device body around the hero. */
  framed?: boolean;
  /** Where the cards go: beside the words (default) or centred along the bottom. */
  hand?: 'margin' | 'below';
  /** How many cards the hand holds, and one card's width / height: what a hand below is sized from. */
  cards?: number;
  cardAspect?: number;
  /** A feathered hero, which may stand the canvas's full height. */
  heroFill?: boolean;
}): CreativeLayout;

/** An App Store creative graphic (header, search, universal) → a no-alpha PNG at `outFile`. */
export declare function buildCreativeGraphic(opts: {
  W: number;
  H: number;
  safe: [number, number, number, number];
  brand: Brand;
  theme?: Theme;
  heroPath?: string;
  outFile: string;
  /** The hero's frame; `'none'` for the bare screen. Unset: by the hero's shape. */
  frame?: FrameId;
  /** `false` leaves the cards out; a list of paths deals those instead of `brand.fan`. */
  fan?: boolean | string[];
  /** Where the cards go — see `ScreenshotSpec.hand`. */
  hand?: 'margin' | 'below';
  /** `[x, y, w, h]` of the hero capture to use, in its pixels. */
  heroCrop?: [number, number, number, number];
  /** A picture as the ground — see `ScreenshotSpec.ground`. */
  ground?: CreativeGround;
  /** Fade the hero's edges into the ground — see `ScreenshotSpec.heroFeather`. */
  heroFeather?: number;
  /** The lockup's icon, faces and colours — see `ScreenshotSpec.lockup`. */
  lockup?: CreativeLockup;
}): Promise<{ outFile: string; W: number; H: number; layout: CreativeLayout }>;

/** Render one still at an exact size. Returns a canvas (see `rgbPngBuffer` to encode it). */
export declare function renderStill(
  style: RenderStyle,
  opts: {
    W: number;
    H: number;
    imgPath: string;
    caption?: { title?: string; sub?: string };
    brand: Brand;
    theme?: Theme;
    frame?: FrameId | null;
    /** The framed style with `frame: 'duo-inner'` only: draw the Duo half open, as `Scene.fold`. */
    fold?: Scene['fold'] | null;
  },
): Promise<unknown>;

/** A transition: `paint` composites two painted layers at progress `p` (0→1). */
export interface Transition {
  dur: number;
  label: string;
  paint(ctx: unknown, prev: unknown, next: unknown, p: number, size: { W: number; H: number }): void;
}

/** A look: a CSS filter on the capture, an overlay over the finished frame, or both. */
export interface Effect {
  label: string;
  filter?: string;
  overlay?(ctx: unknown, o: { W: number; H: number; t: number; p: number }): void;
}

/** The transition registry — add an entry to add a cut; nothing else changes. */
export declare const TRANSITIONS: Record<string, Transition>;
export declare const TRANSITION_IDS: string[];
/** Resolve a cut id; `auto` picks from a deterministic rotation by scene index. */
export declare function transitionFor(id?: CutId, index?: number): Transition;

/** The effect registry. */
export declare const EFFECTS: Record<string, Effect>;
export declare const EFFECT_IDS: string[];
export declare function effectFor(id?: EffectId): Effect;

/** Apply a locale's caption table to a scene list; untranslated scenes keep their base caption. */
export declare function localizeScenes(scenes: ResolvedScene[], table?: CaptionTable): ResolvedScene[];

/** Scene ids the given locale doesn't translate — what a run reports as having fallen back. */
export declare function untranslatedScenes(scenes: ResolvedScene[], table?: CaptionTable): string[];

/** Apply a caption table's reserved `$brand` block to the brand copy. */
export declare function localizeBrand(brand: Brand, table?: CaptionTable): Brand;

/**
 * Encode a canvas as a store-safe **no-alpha** PNG.
 *
 * Returns `Uint8Array`, which `Buffer` extends — so this stays assignable wherever a Buffer was
 * expected, and it no longer drags the `Buffer` global into a consumer's type-check. Naming `Buffer`
 * here meant anyone type-checking a project that depends on zdymak without `@types/node` installed got
 * `TS2580: Cannot find name 'Buffer'` reported from inside node_modules. zdymak's own `check:types`
 * never saw it, because @types/node is in its devDependencies.
 */
export declare function rgbPngBuffer(canvas: unknown): Uint8Array;

/** Register custom TTF/OTF files so text renders identically everywhere. */
export declare function registerFonts(fontPaths?: string[]): void;

/** Run the CLI programmatically. */
export declare function run(argv?: string[]): Promise<void>;
