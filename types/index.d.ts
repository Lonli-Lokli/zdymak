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
  | 'premium-reel';

/** Screenshot / graphic targets — produce still PNGs (`zdymak screenshots` / `build`). */
export type ImageTargetId =
  | 'appstore-iphone-6.9'
  | 'appstore-iphone-6.5'
  | 'appstore-ipad-13'
  | 'appstore-watch'
  | 'appstore-mac'
  | 'play-phone'
  | 'play-tablet'
  | 'play-wear'
  | 'play-feature-graphic'
  | 'play-icon';

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
}

export interface ImageTargetSpec {
  store: string;
  /** Exact width, when the store mandates one size. */
  w?: number;
  /** Exact height, when the store mandates one size. */
  h?: number;
  /** Alternative accepted sizes, when the store takes any of several (e.g. Apple Watch). */
  accepts?: Array<[number, number]>;
  alpha: boolean;
  format: 'png';
  /** A single branded banner (the Play feature graphic), not a per-scene shot. */
  graphic?: boolean;
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

/** Device bezel drawn around a capture. Inferred from the target; override with `frame`. */
export type FrameId = 'phone' | 'iphone' | 'android' | 'ipad' | 'tablet' | 'watch' | 'mac';

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
}

/**
 * Matte + caption styling. `theme` styles VIDEOS; `stillTheme` styles SCREENSHOTS (falling back to
 * `theme`); a per-shot / per-device `theme` overrides both for that item.
 */
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
  /**
   * Paint a clean status bar (time · signal · wifi · full battery) into the empty status-bar band some
   * captures carry — an Android Compose capture reserves the inset but can't contain the system UI.
   * `'auto'` (default) draws it only when such a band is detected; `true` forces it; `false` skips.
   */
  statusBar?: 'auto' | boolean;
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

export interface Scene {
  /** Capture id — resolves to `<capturesDir>/<id><suffix>.png`. Required unless `image` is given. */
  id?: string;
  /** Explicit image path (relative to the config file), instead of `id`. */
  image?: string;
  /** Headline. */
  title?: string;
  /** Subhead. */
  sub?: string;
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
  /** Override the inferred device bezel. */
  frame?: FrameId;
  /** Per-shot matte override. */
  theme?: Theme;
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
  /** Where this device's captures live, relative to the config file. Defaults to `screenshotsDir`. */
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
}

/**
 * Live-footage reel (real motion, not Ken Burns) — built by `zdymak reel`, independent of `targets`.
 */
export interface ReelConfig {
  size?: [number, number];
  fps?: number;
  profile?: string;
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
  /** Live-footage reel, built by `zdymak reel`. */
  reel?: ReelConfig;
  /** Output directory. Defaults to `store-assets`. */
  out?: string;
}

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
  reel?: ReelConfig;
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

/** Encode a canvas as a store-safe **no-alpha** PNG. */
export declare function rgbPngBuffer(canvas: unknown): Buffer;

/** Register custom TTF/OTF files so text renders identically everywhere. */
export declare function registerFonts(fontPaths?: string[]): void;

/** Run the CLI programmatically. */
export declare function run(argv?: string[]): Promise<void>;
