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

/** Map raw scenes → resolved scenes with absolute image paths (`${dir}/${id}${suffix}.png` or explicit). */
function resolveScenes(rawScenes, baseDir, dir, suffix) {
  return (rawScenes || []).map((s, i) => {
    if (!s.image && !s.id) throw new Error(`Config error: scene[${i}] needs an "id" or an "image".`);
    const image = s.image ? path.resolve(baseDir, s.image) : path.join(dir, `${s.id}${suffix}.png`);
    return { id: s.id || String(i + 1), image, title: s.title || '', sub: s.sub || '', move: s.move };
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

  // Top-level scenes are required UNLESS a `devices` map supplies its own per-device scenes.
  if (!raw.devices && (!Array.isArray(raw.scenes) || raw.scenes.length === 0)) {
    throw new Error('Config error: `scenes` must be a non-empty array (or use a `devices` map).');
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

  return {
    brand,
    scenes,
    devices,
    music,
    targets: raw.targets?.length ? raw.targets : ['appstore-preview'],
    sceneDur: raw.sceneDur ?? 3.1,
    xfade: raw.xfade ?? 0.32,
    timing: raw.timing, // reel-mode timeline override { coldOpen, scene, endCard, xfade }
    theme: raw.theme, // premium-technique styling override (matte, vignette, label, cuts) — defaults apply
    out: path.resolve(baseDir, raw.out || 'store-assets'),
    baseDir,
  };
}
