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
  'sourceLocale',
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
    // A LAYOUT scene draws several captures at once and so has no single `image` of its own; its members
    // carry the paths. Each member resolves like a scene would — an explicit `image` against the config
    // file, a bare `id` against this device's captures dir — so a cluster can mix a capture from THIS
    // platform with one shot elsewhere (`../android/captures/today-light.png`), which is the point.
    if (s.layout) {
      if (!Array.isArray(s.layout) || !s.layout.length) throw new Error(`Config error: scene[${i}].layout must be a non-empty array.`);
      const layout = s.layout.map((m, j) => {
        if (!m.image && !m.id) throw new Error(`Config error: scene[${i}].layout[${j}] needs an "id" or an "image".`);
        return { ...m, image: m.image ? path.resolve(baseDir, m.image) : path.join(dir, `${m.id}${suffix}.png`) };
      });
      return { ...s, id: s.id || String(i + 1), layout, image: null, title: s.title || '', sub: s.sub || '' };
    }
    if (!s.image && !s.id) throw new Error(`Config error: scene[${i}] needs an "id" or an "image".`);
    const image = s.image ? path.resolve(baseDir, s.image) : path.join(dir, `${s.id}${suffix}.png`);
    return { ...s, id: s.id || String(i + 1), image, title: s.title || '', sub: s.sub || '' };
  });
}

const asList = (arr) => (arr || []).map((x) => (typeof x === 'string' ? { target: x } : x));

/**
 * The effective music bed for one video target. `music.overrides[targetId]` wins over the base bed:
 *   `false`/`null` → that target renders SILENT (e.g. the Google Play promo, to dodge YouTube Content ID)
 *   `{ path, … }`  → swap in another (license-clear) bed for that target
 * Returns the bed WITHOUT its `overrides` map, so encoders see a plain { path, volume, … }.
 */
export function musicForTarget(music, targetId) {
  if (!music) return undefined;
  const ov = music.overrides?.[targetId];
  const { overrides, ...bed } = music;
  if (ov === undefined) return bed; // no per-target rule → shared bed
  if (!ov) return undefined; // false/null → silent
  return { ...bed, ...ov }; // object → swapped bed
}

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
  // What `{locale}` resolves to on the BASE (source-language) pass, which has no locale of its own.
  const sourceLocale = raw.sourceLocale ?? 'en';

  // Top-level scenes are required UNLESS a `devices` map or a live-footage `reel` supplies the content.
  if (!raw.devices && !raw.reel && (!Array.isArray(raw.scenes) || raw.scenes.length === 0)) {
    throw new Error('Config error: provide `scenes`, a `devices` map, or a `reel` block.');
  }
  const scenes = resolveScenes(raw.scenes, baseDir, screenshotsDir, suffix);

  // Optional music bed shared by every video target — path relative to the config file. `overrides` lets a
  // single target diverge: `false` renders it SILENT, `{ path, … }` swaps in another bed. Used e.g. for the
  // Google Play promo, whose YouTube home can Content-ID-flag a licensed Apple score.
  const resolveBed = (m) => (m?.path ? { ...m, path: path.resolve(baseDir, m.path) } : undefined);
  const music = (() => {
    const bed = resolveBed(raw.music);
    if (bed && raw.music.overrides) {
      bed.overrides = Object.fromEntries(
        Object.entries(raw.music.overrides).map(([t, ov]) => [t, ov && ov.path ? resolveBed(ov) : ov]),
      );
    }
    return bed;
  })();

  // Modular per-device config. An app lists ONLY the devices it ships; each has its own captures dir,
  // optional scene overrides, screenshot targets (+ style) and video targets. Missing captures skip cleanly.
  /*
   * `capturesDir` may carry a `{locale}` token, e.g. './captures/{locale}'.
   *
   * Without it a localized run translates the CAPTION and nothing else, so a fully translated app
   * still ships every locale a picture of its source-language interface. That is worse than an
   * untranslated set: the headline promises a localized app and the screen underneath denies it, and
   * every file is a valid PNG of a real screen, so nothing downstream notices.
   *
   * The token has to be resolved per RENDER rather than at config load, because a scene's image path
   * is bound to its captures dir here, before any locale is known. So each device keeps the raw
   * template and hands back re-resolved scenes on demand. A dir with no token ignores the locale
   * entirely, which is what every existing config does, so this changes nothing until it is used.
   */
  const devices = Object.entries(raw.devices || {}).map(([name, d]) => {
    const template = d.capturesDir ?? null;
    const suf = d.suffix ?? suffix;
    const rawScenes = d.scenes || raw.scenes;
    const dirFor = (locale) => (template
      ? path.resolve(baseDir, template.replaceAll('{locale}', locale ?? sourceLocale))
      : screenshotsDir);
    return {
      name,
      scenes: resolveScenes(rawScenes, baseDir, dirFor(null), suf),
      screenshots: asList(d.screenshots),
      videos: asList(d.videos),
      theme: d.theme,
      /** This device's scenes re-resolved against `locale`'s captures dir. */
      scenesFor: (locale) => resolveScenes(rawScenes, baseDir, dirFor(locale), suf),
      /** Whether this device actually keeps per-locale captures (drives the "no captures" warning). */
      perLocaleCaptures: !!template && template.includes('{locale}'),
    };
  });

  // Live-footage reel: resolve each segment's clip/image(s) + the music bed relative to the config file.
  //
  // `reel` accepts EITHER one entry or an array of them, and is normalised to an array here. An app
  // routinely needs the same footage cut more than one way — an App Preview at 886×1920 with the score
  // and a Play promo at 1080×1920 silent — and those differ in `size`/`music`/`segments`, none of which
  // a flag can override. Before this, the second cut meant a second CONFIG FILE importing the first,
  // which is a lot of ceremony for two fields and leaves two files to keep in step.
  const reel = raw.reel
    ? (Array.isArray(raw.reel) ? raw.reel : [raw.reel]).map((entry) => ({
        ...entry,
        music: entry.music?.path
          ? { ...entry.music, path: path.resolve(baseDir, entry.music.path) }
          : undefined,
        segments: (entry.segments || []).map((s) => ({
          ...s,
          clip: s.clip ? path.resolve(baseDir, s.clip) : undefined,
          image: s.image ? path.resolve(baseDir, s.image) : undefined,
          images: s.images ? s.images.map((p) => path.resolve(baseDir, p)) : undefined,
        })),
      }))
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
