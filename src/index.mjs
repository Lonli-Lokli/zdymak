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
export { buildFeatureGraphic, buildCreativeGraphic, creativeLayout } from './graphic.mjs';
export { renderStill } from './still.mjs';
export { rgbPngBuffer } from './png.mjs';
export { loadConfig } from './config.mjs';
export { registerFonts } from './fonts.mjs';
export { VIDEO_TARGETS, IMAGE_TARGETS, videoTarget } from './specs.mjs';
export { TRANSITIONS, TRANSITION_IDS, transitionFor } from './transitions.mjs';
export { EFFECTS, EFFECT_IDS, effectFor } from './effects.mjs';
export { run } from './cli.mjs';
export { captureBlankness, validateCapture, BLANK_COLOURS, BLANK_DOMINANCE } from './validate.mjs';
export {
  CHECK_RULES, DEMO_TIME, DUPLICATE_LOOK, LETTERBOX_BAR, LETTERBOX_BOX, LETTERBOX_SHOT, MOTION_STILL, checkSet, checkShot,
  describeRefusals, factRefusals, letterboxOf, motionAllowance, textRefusals, readText, readFacts,
} from './checker.mjs';
export { MiddlewareRefusal, normalizeMiddleware, runMiddleware } from './middleware.mjs';
export {
  APPROVALS_FILE, LAYOUT_CELL, LAYOUT_TOLERANCE, RTL_LANGUAGES, compareShots, isRtl, layoutAgainst, layoutDifference,
  mirrored, mirroredBoxes, pixelDifference, pixelsAgainst, readApprovals, thresholdsOf, recordPasses, isCleared, sha256,
} from './compare.mjs';
export { decide, writeReview } from './review.mjs';
export { measurePairs } from './noise.mjs';
