/**
 * DESTINATIONS vs PRESETS — the separation this tool needed.
 *
 * A store *destination* answers "will this be accepted?" — pixel size, codec profile/level, duration
 * bounds, alpha, file size. It has nothing to say about how the asset looks.
 *
 * A *preset* answers "how does it look?" — full-bleed, device-framed, or the premium matte treatment —
 * and carries our opinionated defaults for motion. It has nothing to say about what a store accepts.
 *
 * They were previously welded together in one `target` id, so "the premium look at Play dimensions" or
 * "App Store validation with my own transitions" were unsayable. Now:
 *
 *   videos: [{ destination: 'appstore-preview', preset: 'premium', transitions: ['blur-dissolve'] }]
 *   videos: [{ target: 'appstore-preview' }]   // shorthand — resolves to the pair above's defaults
 *
 * `target` remains a first-class shorthand: every existing config keeps working unchanged.
 */
import { VIDEO_TARGETS, IMAGE_TARGETS } from './specs.mjs';

/** How an asset is rendered. Independent of where it's going. */
export const PRESETS = {
  'full-bleed': {
    label: 'Full-bleed — the screen fills the frame, no bezel (required for App Previews)',
    engine: 'video',
  },
  framed: {
    label: 'Device-framed — bezel + brand wash + logo bookends (marketing reels)',
    engine: 'reel',
  },
  premium: {
    label: 'Premium — the screen floats on a brand matte, Apple editing vocabulary',
    engine: 'premium',
  },
};

/** The preset each legacy target implied, so `target:` keeps behaving exactly as before. */
const TARGET_PRESET = {
  'appstore-preview': 'full-bleed',
  'appstore-preview-ipad': 'full-bleed',
  'appstore-preview-mac': 'full-bleed',
  'play-promo': 'full-bleed',
  'social-reel': 'framed',
  'premium-reel': 'premium',
};

/**
 * Normalize a video entry into `{ destination, preset, size, theme, transitions, effects }`.
 * Accepts the shorthand (`{ target }`) or the split form (`{ destination, preset }`).
 */
export function resolveVideo(entry) {
  const e = typeof entry === 'string' ? { target: entry } : entry || {};
  const destId = e.destination || e.target;
  if (!destId) {
    throw new Error("A video entry needs `destination` (or the `target` shorthand). See `zdymak specs`.");
  }
  const destination = VIDEO_TARGETS[destId];
  if (!destination) {
    throw new Error(`Unknown video destination "${destId}". Valid: ${Object.keys(VIDEO_TARGETS).join(', ')}`);
  }
  const presetId = e.preset || TARGET_PRESET[destId] || 'full-bleed';
  if (!PRESETS[presetId]) {
    throw new Error(`Unknown preset "${presetId}". Valid: ${Object.keys(PRESETS).join(', ')}`);
  }
  // A destination may forbid a preset: Apple rejects a device bezel in the App Preview slot, so the
  // combination is refused here rather than at review.
  if (destination.noFrame && presetId === 'framed') {
    throw new Error(
      `"${destId}" cannot use the "framed" preset — ${destination.store} rejects a device bezel in that ` +
      'slot. Use "full-bleed" (or "premium") there, and keep the framed reel for your site and ads.',
    );
  }
  return {
    id: destId,
    destination,
    preset: presetId,
    engine: PRESETS[presetId].engine,
    size: e.size,
    theme: e.theme,
    transitions: e.transitions,
    effects: e.effects,
  };
}

/** Normalize a screenshot entry the same way (images have no preset beyond their render `style`). */
export function resolveImage(entry) {
  const e = typeof entry === 'string' ? { target: entry } : entry || {};
  const destId = e.destination || e.target;
  const destination = IMAGE_TARGETS[destId];
  if (!destination) {
    throw new Error(`Unknown image destination "${destId}". Valid: ${Object.keys(IMAGE_TARGETS).join(', ')}`);
  }
  return { ...e, target: destId, destination };
}

/**
 * A user-supplied transition/effect palette. When a video carries `transitions: [...]`, scenes that
 * don't name their own `cut` cycle through that list — the "bring your own vocabulary" path, as opposed
 * to a preset's built-in choices. Deterministic by index so re-renders match.
 */
export function paletteAt(list, index, fallback) {
  if (!Array.isArray(list) || !list.length) return fallback;
  return list[index % list.length];
}
