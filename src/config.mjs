/**
 * Config loading + normalization. A project's `zdymak.config.mjs` (or .json) is the ONLY
 * project-specific input; everything else lives in this reusable package.
 *
 * Shape (all paths are relative to the config file):
 *   export default {
 *     brand: { ink, title, sub, fontPaths? },   // hex colours; fontPaths optional custom TTFs
 *     screenshotsDir: 'marketing/ios/captures', // where the PNGs live
 *     suffix: '-light',                          // appended to scene.id → `${id}${suffix}.png`
 *     scenes: [{ id | image, title, sub, move }],// move: pushIn|pushInSlow|pullBack|driftUp|driftLeft|…
 *     targets: ['appstore-preview', 'play-promo'],
 *     sceneDur: 3.1, xfade: 0.32,
 *     out: 'store-assets',
 *   }
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_BRAND = {
  ink: '#0b0b0a', title: '#F5F5F4', sub: '#BBF7D0', fontPaths: [],
  // Reel-mode fields (device-framed marketing reel) — optional; only used by the `social-reel` target.
  name: 'App', tagline: '', endline: '', endsub: '', logo: null, reel: {},
};

/** Every top-level config field an app author can set. The doc-sync guard (`scripts/check-docs.mjs`)
 *  asserts each appears in README.md/SKILL.md, so adding a field forces a doc line. Keep in sync with the
 *  `raw.*` reads below. */
export const CONFIG_KEYS = [
  'brand', 'screenshotsDir', 'suffix', 'scenes', 'targets', 'sceneDur', 'xfade',
  'timing', 'theme', 'stillTheme', 'music', 'devices', 'captions', 'reel', 'out',
];

/**
 * Per-locale caption tables: `captions: { de: './captions/de.json' | { sceneId: { title, sub } } }`.
 * A JSON path is read here so a bad path fails at config load, not halfway through a render. The
 * reserved `$brand` key carries the localized wordmark lines used by the feature graphic.
 */
function loadCaptions(rawCaptions, baseDir) {
  const out = {};
  for (const [locale, value] of Object.entries(rawCaptions)) {
    let table = value;
    if (typeof value === 'string') {
      const file = path.resolve(baseDir, value);
      if (!fs.existsSync(file)) {
        throw new Error(`Config error: captions["${locale}"] → file not found: ${file}`);
      }
      try {
        table = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (e) {
        throw new Error(`Config error: captions["${locale}"] → ${file} is not valid JSON (${e.message})`);
      }
    }
    if (!table || typeof table !== 'object' || Array.isArray(table)) {
      throw new Error(`Config error: captions["${locale}"] must be a JSON path or an object of sceneId → { title, sub }.`);
    }
    out[locale] = table;
  }
  return out;
}

/**
 * Map raw scenes → resolved scenes with absolute image paths (`${dir}/${id}${suffix}.png` or explicit).
 *
 * SPREAD the source scene rather than picking known keys: this used to whitelist
 * `{id, image, title, sub, move}`, which silently swallowed every per-scene knob added since
 * (`cut`, `effect`, `push`, `scroll`) — the config looked right, no error was raised, and the renderer
 * just never saw them. Anything a scene carries now reaches the engine untouched.
 */
function resolveScenes(rawScenes, baseDir, dir, suffix) {
  return (rawScenes || []).map((s, i) => {
    if (!s.image && !s.id) throw new Error(`Config error: scene[${i}] needs an "id" or an "image".`);
    const image = s.image ? path.resolve(baseDir, s.image) : path.join(dir, `${s.id}${suffix}.png`);
    return { ...s, id: s.id || String(i + 1), image, title: s.title || '', sub: s.sub || '' };
  });
}

const asList = (arr) => (arr || []).map((x) => (typeof x === 'string' ? { target: x } : x));

export async function loadConfig(configPath) {
  const abs = path.resolve(configPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`Config not found: ${abs}\nCreate one (see the README) or pass --config <path>.`);
  }
  const baseDir = path.dirname(abs);

  let raw;
  if (abs.endsWith('.json')) {
    raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } else {
    const mod = await import(pathToFileURL(abs).href);
    raw = mod.default ?? mod.config ?? mod;
  }

  const brand = { ...DEFAULT_BRAND, ...(raw.brand || {}) };
  brand.fontPaths = (brand.fontPaths || []).map((p) => path.resolve(baseDir, p));
  if (brand.logo) brand.logo = path.resolve(baseDir, brand.logo); // reel-mode logo (cold-open / end-card)

  const screenshotsDir = raw.screenshotsDir ? path.resolve(baseDir, raw.screenshotsDir) : baseDir;
  const suffix = raw.suffix ?? '';

  // Top-level scenes are required UNLESS a `devices` map or a live-footage `reel` supplies the content.
  if (!raw.devices && !raw.reel && (!Array.isArray(raw.scenes) || raw.scenes.length === 0)) {
    throw new Error('Config error: provide `scenes`, a `devices` map, or a `reel` block.');
  }
  const scenes = resolveScenes(raw.scenes, baseDir, screenshotsDir, suffix);

  // Optional music bed shared by every video target — path is relative to the config file.
  const music = raw.music?.path ? { ...raw.music, path: path.resolve(baseDir, raw.music.path) } : undefined;

  // Modular per-device config. An app lists ONLY the devices it ships; each has its own captures dir,
  // optional scene overrides, screenshot targets (+ style) and video targets. Missing captures skip cleanly.
  const devices = Object.entries(raw.devices || {}).map(([name, d]) => {
    const dir = d.capturesDir ? path.resolve(baseDir, d.capturesDir) : screenshotsDir;
    const suf = d.suffix ?? suffix;
    return {
      name,
      scenes: resolveScenes(d.scenes || raw.scenes, baseDir, dir, suf),
      screenshots: asList(d.screenshots),
      videos: asList(d.videos),
      theme: d.theme,
    };
  });

  // Live-footage reel: resolve each segment's clip/image(s) + the music bed relative to the config file.
  const reel = raw.reel
    ? {
        ...raw.reel,
        music: raw.reel.music?.path
          ? { ...raw.reel.music, path: path.resolve(baseDir, raw.reel.music.path) }
          : undefined,
        segments: (raw.reel.segments || []).map((s) => ({
          ...s,
          clip: s.clip ? path.resolve(baseDir, s.clip) : undefined,
          image: s.image ? path.resolve(baseDir, s.image) : undefined,
          images: s.images ? s.images.map((p) => path.resolve(baseDir, p)) : undefined,
        })),
      }
    : undefined;

  return {
    brand,
    reel,
    scenes,
    devices,
    captions: raw.captions ? loadCaptions(raw.captions, baseDir) : undefined,
    music,
    // `?? ` not `?.length ?` — an explicit `targets: []` means "no top-level videos" (a devices-only
    // config renders each device's own), whereas omitting the key entirely still gets the sane default.
    targets: raw.targets ?? ['appstore-preview'],
    sceneDur: raw.sceneDur ?? 3.1,
    xfade: raw.xfade ?? 0.32,
    timing: raw.timing, // reel-mode timeline override { coldOpen, scene, endCard, xfade }
    theme: raw.theme, // premium-technique styling override for VIDEOS (matte, vignette, label, cuts)
    stillTheme: raw.stillTheme, // screenshot-only matte override; falls back to `theme` when unset
    out: path.resolve(baseDir, raw.out || 'store-assets'),
    baseDir,
  };
}
