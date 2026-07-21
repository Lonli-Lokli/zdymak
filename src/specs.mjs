/**
 * Store spec matrix — the single source of truth for every store's asset requirements.
 *
 * VERIFY before each release: store forms change. Sources are cited inline; re-check the Apple and
 * Google help pages when a submission bounces on dimensions.
 */

/** Video targets that produce an actual .mp4 file. */
export const VIDEO_TARGETS = {
  'appstore-preview': {
    store: 'App Store',
    label: 'App Store App Preview (iPhone 6.5" + 6.9")',
    w: 886,
    h: 1920,
    fps: 30,
    codec: 'h264',
    profile: 'high',
    level: '4.0', // Apple requires High @ 4.0 for App Previews
    minSec: 15,
    maxSec: 30,
    slot: 'App Store Connect → your app → (localization) → App Previews. One 886×1920 file fills BOTH the 6.5" and 6.9" slots.',
    // Apple: https://developer.apple.com/help/app-store-connect/reference/app-preview-specifications/
  },
  'play-promo': {
    store: 'Google Play',
    label: 'Google Play promo video (portrait 1080×1920 → upload to YouTube)',
    w: 1080,
    h: 1920,
    fps: 30,
    codec: 'h264',
    profile: 'high',
    level: '4.1', // 1080×1920@30 needs level ≥4.1
    minSec: null,
    maxSec: null,
    slot: 'Play does NOT take a file: upload this to YouTube, then paste the URL in Play Console → Main store listing → Preview video.',
    // Google: https://support.google.com/googleplay/android-developer/answer/9866151
  },
  'social-reel': {
    store: 'Web / Social',
    label: 'Device-framed promo reel (1080×1920) — website, X/IG/TikTok, or YouTube for Play',
    w: 1080,
    h: 1920,
    fps: 30,
    codec: 'h264',
    profile: 'high',
    level: '4.1',
    minSec: null,
    maxSec: null,
    style: 'reel', // ← device bezel + brand background + logo bookends (buildReel, not buildVideo)
    slot: 'For your website, X / Instagram / TikTok, or YouTube (Play listing). NOT the App Store App Preview slot — the device bezel is rejected there.',
  },
  'premium-reel': {
    store: 'Web / Social',
    label: 'Premium Apple-style reel (1080×1920) — matte + vignette + label pills + palette-aware cuts',
    w: 1080,
    h: 1920,
    fps: 30,
    codec: 'h264',
    profile: 'high',
    level: '4.1',
    minSec: null,
    maxSec: null,
    style: 'premium', // ← the Apple editing-vocabulary preset (buildPremium); themeable via `theme`
    slot: 'The "one device, many apps" marketing reel for web/social/YouTube. Full-bleed screens on a brand matte (no bezel) — but the label pill/matte make it a marketing asset, not an App Store App Preview.',
  },
};

/** Screenshot / graphic targets that produce still images (v0.2 — dimensions locked in now). */
export const IMAGE_TARGETS = {
  'appstore-iphone-6.9': { store: 'App Store', w: 1320, h: 2868, alpha: false, format: 'png', label: 'iPhone 6.9" (largest — Apple scales down for smaller iPhones)' },
  'appstore-iphone-6.5': { store: 'App Store', accepts: [[1242, 2688], [1284, 2778]], alpha: false, format: 'png', label: 'iPhone 6.5" (accepts 1242×2688 or 1284×2778)' },
  'appstore-ipad-13': { store: 'App Store', w: 2064, h: 2752, alpha: false, format: 'png', label: 'iPad 13" (largest iPad class)' },
  'appstore-watch': { store: 'App Store', accepts: [[422, 514], [410, 502], [416, 496], [396, 484], [368, 448], [312, 390]], alpha: false, format: 'png', label: 'Apple Watch (any one accepted size; alpha NOT allowed)' },
  'appstore-mac': { store: 'Mac App Store', w: 2880, h: 1800, alpha: false, format: 'png', label: 'Mac (2880×1800, 16:10 landscape — largest required class)' },
  'play-phone': { store: 'Google Play', w: 1080, h: 1920, alpha: false, format: 'png', label: 'Play phone (9:16, min 1080px, no alpha)' },
  'play-tablet': { store: 'Google Play', w: 2560, h: 1440, alpha: false, format: 'png', label: 'Play tablet (16:9, 1080–7680px, no alpha)' },
  'play-wear': { store: 'Google Play', w: 1080, h: 1080, alpha: false, format: 'png', label: 'Play Wear OS (1:1 square, 384–3840px, no alpha)' },
  'play-feature-graphic': { store: 'Google Play', w: 1024, h: 500, alpha: false, format: 'png', graphic: true, label: 'Play feature graphic (1024×500, no alpha) — brand banner, not a per-scene shot' },
  'play-icon': { store: 'Google Play', w: 512, h: 512, alpha: true, format: 'png', label: 'Play app icon (32-bit PNG, alpha OK)' },
};

/** Resolve a video target by id, throwing a helpful error listing valid ids. */
export function videoTarget(id) {
  const t = VIDEO_TARGETS[id];
  if (!t) {
    throw new Error(`Unknown video target "${id}". Valid: ${Object.keys(VIDEO_TARGETS).join(', ')}`);
  }
  return t;
}
