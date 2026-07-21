/** Programmatic API — use the engine directly without the CLI. */

/**
 * Identity helper for `zdymak.config.mjs` — returns the config unchanged, but lets an editor type-check
 * and autocomplete it from `types/index.d.ts` without the project needing TypeScript:
 *
 *   import { defineConfig } from 'zdymak';
 *   export default defineConfig({ … });
 *
 * @param {import('../types/index.js').Config} config
 * @returns {import('../types/index.js').Config}
 */
export const defineConfig = (config) => config;

export { buildVideo } from './video.mjs';
export { buildReel } from './reel.mjs';
export { buildPremium } from './premium.mjs';
export { buildDeviceScreenshots, localizeScenes, untranslatedScenes, localizeBrand } from './screenshots.mjs';
export { buildFeatureGraphic } from './graphic.mjs';
export { renderStill } from './still.mjs';
export { rgbPngBuffer } from './png.mjs';
export { loadConfig } from './config.mjs';
export { registerFonts } from './fonts.mjs';
export { VIDEO_TARGETS, IMAGE_TARGETS, videoTarget } from './specs.mjs';
export { TRANSITIONS, TRANSITION_IDS, transitionFor } from './transitions.mjs';
export { EFFECTS, EFFECT_IDS, effectFor } from './effects.mjs';
export { run } from './cli.mjs';
