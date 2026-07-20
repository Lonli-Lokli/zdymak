/**
 * Config loading + normalization. A project's `store-preview.config.mjs` (or .json) is the ONLY
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

const DEFAULT_BRAND = { ink: '#0b0b0a', title: '#F5F5F4', sub: '#BBF7D0', fontPaths: [] };

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

  const screenshotsDir = raw.screenshotsDir ? path.resolve(baseDir, raw.screenshotsDir) : baseDir;
  const suffix = raw.suffix ?? '';

  if (!Array.isArray(raw.scenes) || raw.scenes.length === 0) {
    throw new Error('Config error: `scenes` must be a non-empty array.');
  }
  const scenes = raw.scenes.map((s, i) => {
    const image = s.image
      ? path.resolve(baseDir, s.image)
      : path.join(screenshotsDir, `${s.id}${suffix}.png`);
    if (!s.image && !s.id) {
      throw new Error(`Config error: scene[${i}] needs an "id" or an "image".`);
    }
    return { image, title: s.title || '', sub: s.sub || '', move: s.move };
  });

  return {
    brand,
    scenes,
    targets: raw.targets?.length ? raw.targets : ['appstore-preview'],
    sceneDur: raw.sceneDur ?? 3.1,
    xfade: raw.xfade ?? 0.32,
    out: path.resolve(baseDir, raw.out || 'store-assets'),
    baseDir,
  };
}
