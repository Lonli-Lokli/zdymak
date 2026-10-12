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
    label: 'App Store App Preview (iPhone — one file fills 6.9" / 6.5" / 6.3" / 6.1")',
    w: 886,
    h: 1920,
    fps: 30,
    codec: 'h264',
    profile: 'high',
    level: '4.0', // Apple's wording is "up to High Profile Level 4.0" — a ceiling, not a mandate
    minSec: 15,
    maxSec: 30,
    maxBytes: 500 * 1024 * 1024,
    noFrame: true, // Apple rejects a device bezel in the App Preview slot
    slot: 'App Store Connect → your app → (localization) → App Previews. One 886×1920 file covers the 6.9", 6.5", 6.3" and 6.1" iPhone families. Up to 3 previews per family.',
    // Apple: https://developer.apple.com/help/app-store-connect/reference/app-preview-specifications/
  },
  'appstore-preview-ipad': {
    store: 'App Store',
    label: 'App Store App Preview (iPad 13" / 12.9" / 11" / 10.5")',
    w: 1200,
    h: 1600,
    fps: 30,
    codec: 'h264',
    profile: 'high',
    level: '4.0',
    minSec: 15,
    maxSec: 30,
    maxBytes: 500 * 1024 * 1024,
    noFrame: true,
    slot: 'App Store Connect → App Previews (iPad). NOTE the iPad preview is 1200×1600 — NOT the 2064×2752 of the iPad screenshot slot.',
    // Apple: https://developer.apple.com/help/app-store-connect/reference/app-preview-specifications/
  },
  'appstore-preview-mac': {
    store: 'Mac App Store',
    label: 'App Store App Preview (Mac — landscape only)',
    w: 1920,
    h: 1080,
    fps: 30,
    codec: 'h264',
    profile: 'high',
    level: '4.0',
    minSec: 15,
    maxSec: 30,
    maxBytes: 500 * 1024 * 1024,
    noFrame: true,
    slot: 'App Store Connect → App Previews (Mac). Landscape only, same as Apple TV.',
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
    level: '4.1', // 4.0 would also fit (8160 MBs); 4.1 is the safe, universally-decoded choice for 1080p
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

  /**
   * App Store CREATIVE ASSETS (iOS 27 / iPadOS 27) — the video halves of the header and search slots.
   *
   * Both are `reelOnly`: built by `zdymak reel` from real footage, never by `video`/`build`. Those
   * commands Ken-Burns the device's screenshots, and a portrait phone capture cover-cropped to 21:9
   * keeps a sliver of the middle of the screen — a valid file of nothing. A reel entry names one of
   * these as its `destination` (or is itself named after one) and is then measured against it.
   *
   * Codec: Apple's page states size, frame rate, length and container (.mov/.m4v/.mp4) and nothing
   * else, so this stays on the H.264 High path every other target uses. The level is a FLOOR: the
   * encoder raises it to whatever the frame size and rate actually need (3840×1646 @60 is level 5.2).
   *
   * Audio is never required. Search results play video muted and cannot be unmuted; the product page
   * plays it muted until the visitor unmutes. A bed is legal on the header and pointless on search —
   * which is what `muted` records, so the CLI neither nags about a silent one nor keeps quiet about a
   * track nobody will hear.
   *
   * Apple: https://developer.apple.com/help/app-store-connect/reference/app-information/creative-assets-specifications/
   */
  'appstore-header-video': {
    store: 'App Store',
    label: 'Product page HEADER video (21:9, 3840×1646, 30 or 60 fps, 5–30 s, loops) — iOS/iPadOS 27+',
    w: 3840,
    h: 1646,
    // The one size Apple takes. Listed, not just defaulted, so a reel's own `size:` is held to it too:
    // an explicit override is otherwise taken as meant, which is right for a social reel and wrong here.
    accepts: [[3840, 1646]],
    fps: 30,
    fpsAllowed: [30, 60],
    codec: 'h264',
    profile: 'high',
    level: '5.1',
    minSec: 5,
    maxSec: 30,
    reelOnly: true,
    creative: true,
    muted: 'default', // muted until the visitor unmutes it
    slot: 'App Store Connect → your app → product page header (iOS/iPadOS 27+). Optional. Muted by default (a visitor may unmute), loops continuously, shown above the app icon. Set its poster frame in App Store Connect.',
  },
  /**
   * The search video's DEFAULT is 2880×1920, not the 3840×2560 ceiling, on purpose. Apple accepts any
   * 3:2 size from 1920×1280 to 3840×2560, but 3840×2560 is 38,400 macroblocks and H.264 caps frame
   * size at 36,864 below level 6 — so the ceiling would be a level 6 stream, which a great many
   * hardware decoders refuse and which Apple says nothing about accepting. 2880×1920 is level 5.1 at
   * 30 fps. Pass `size: [3840, 2560]` to the reel to ask for the ceiling anyway; validation allows it.
   */
  'appstore-search-video': {
    store: 'App Store',
    label: 'SEARCH RESULTS video (3:2, 1920×1280 up to 3840×2560; default 2880×1920; 30 or 60 fps, 5–30 s, always muted)',
    w: 2880,
    h: 1920,
    range: { min: [1920, 1280], max: [3840, 2560], ratio: [3, 2] },
    fps: 30,
    fpsAllowed: [30, 60],
    codec: 'h264',
    profile: 'high',
    level: '5.1',
    minSec: 5,
    maxSec: 30,
    reelOnly: true,
    creative: true,
    muted: 'always', // search results cannot be unmuted
    slot: 'App Store Connect → your app → search results asset (iOS/iPadOS 27+). Optional — without one, search shows your In-App Events, previews and screenshots. Always muted, loops.',
  },
};

/** Screenshot / graphic targets that produce still images (v0.2 — dimensions locked in now). */
export const IMAGE_TARGETS = {
  'appstore-iphone-6.9': { store: 'App Store', w: 1320, h: 2868, accepts: [[1320, 2868], [1290, 2796], [1260, 2736]], alpha: false, format: 'png', label: 'iPhone 6.9" (largest — Apple scales down for smaller iPhones; also accepts 1290×2796 and 1260×2736)' },
  'appstore-iphone-6.5': { store: 'App Store', accepts: [[1242, 2688], [1284, 2778]], alpha: false, format: 'png', label: 'iPhone 6.5" (accepts 1242×2688 or 1284×2778)' },

  /**
   * The App Review Screenshot on an IN-APP PURCHASE — a different slot, with a different table.
   *
   * It looks like a listing screenshot and is not one. App Store Connect's help says only that it
   * must "meet any of the screenshot specifications your app supports", which reads as though the
   * targets above would do — and they do not. **1290×2796 and 1320×2868 are both refused**, with
   * "The dimensions of one or more screenshots are wrong", and both are sizes Apple's own
   * screenshot specification lists for the 6.9" class and which the LISTING slots take without
   * complaint. The purchase form is older than the listing form and validates against an older
   * subset, so the newest display classes are exactly the ones it has never heard of.
   *
   * That is why this is its own target rather than a `size:` on a listing one. A store spec that
   * differs by slot is precisely what this table exists to carry, and borrowing the neighbouring
   * slot's sizes is how the wrong one gets chosen while looking documented.
   *
   * 640×920 leads: it is a real screenshot specification (Apple's 3.5" class), it is the size
   * Apple's in-app purchase documentation asked for when this slot was built, and it is what
   * people report being accepted after working down from the modern sizes. The rest are
   * long-lived iPhone and iPad sizes that predate the failures — an app whose screen is nothing
   * like 0.7:1 can pick one closer to its own shape.
   *
   * The image is never shown to a customer; it exists so a reviewer can see the item being
   * offered. So it wants no bezel, no headline and no matte, which is what [plain] says.
   */
  'appstore-iap-review': { store: 'App Store', w: 640, h: 920, accepts: [[640, 920], [1242, 2208], [1284, 2778], [1242, 2688], [750, 1334], [640, 1136], [640, 960], [1024, 768], [2048, 1536]], alpha: false, format: 'png', plain: true, label: 'In-app purchase REVIEW screenshot (640×920 — review-only, never shown on the App Store; the purchase form refuses the newest listing sizes)' },
  'appstore-ipad-13': { store: 'App Store', w: 2064, h: 2752, alpha: false, format: 'png', label: 'iPad 13" (largest iPad class)' },
  // THE SAME SLOT, TURNED — not a second one. Both stores accept either orientation for a tablet
  // display type and will show both in one set, so an app whose tablet layout genuinely CHANGES on
  // rotation has somewhere to prove it, and one that merely stretches should not bother.
  //
  // Neither needs a new device drawing. `drawIpadFrame` and `drawAndroidPhoneFrame` derive the body
  // height from the capture's own aspect, so a landscape screen already yields a landscape body;
  // and `inferFrame` still routes these correctly, because it tests `^play` before `ipad|tablet`.
  // What was actually missing was the ability to CAPTURE a rotated device — see
  // `capture --orientation`, which had to be built, because `simctl` has no rotation command and
  // hands back a framebuffer that ignores rotation even after the device has turned.
  'appstore-ipad-13-landscape': { store: 'App Store', w: 2752, h: 2064, alpha: false, format: 'png', label: 'iPad 13" LANDSCAPE (same App Store slot as appstore-ipad-13, rotated)' },
  /**
   * iPhone Duo — Apple's book-style foldable: ONE display type in App Store Connect ("iPhone Duo";
   * reported as `APP_IPHONE_DUO` in the API, which Apple has not documented), accepting four sizes.
   * Closed, it is a phone with an outer display; opened like a book, the inner display is roughly two
   * outer displays side by side, so its natural open orientation is LANDSCAPE, with the fold running
   * down the middle.
   *
   * Four targets rather than one with `accepts`, following `appstore-ipad-13-landscape`: each size is
   * a different picture (a different screen, or the same one turned), so each wants its own captures
   * and its own output folder. They all upload into the SAME slot, up to ten between them — and they
   * all write `01-….png`, so rename one set on the way to the upload folder (see the iPad note).
   *
   * Optional today. Apple: "Starting in April 2027, screenshots will be required for any app using the
   * iOS 27.1 SDK or later." The sizes are @3x of ≈466×678 pt (outer) and ≈669×951 pt (inner).
   * Apple: https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/
   *
   * Their frame is `duo` / `duo-inner` (inferred from the id): a plain rounded body with NO Dynamic
   * Island, NO camera and NO crease, because Apple publishes none of those — see `frames.mjs`.
   */
  'appstore-iphone-duo-outer': { store: 'App Store', w: 1398, h: 2034, alpha: false, format: 'png', label: 'iPhone Duo OUTER display (1398×2034) — optional now; required from April 2027 for apps built with the iOS 27.1 SDK' },
  'appstore-iphone-duo-outer-landscape': { store: 'App Store', w: 2034, h: 1398, alpha: false, format: 'png', label: 'iPhone Duo OUTER display LANDSCAPE (2034×1398, same iPhone Duo slot, turned)' },
  'appstore-iphone-duo-inner': { store: 'App Store', w: 2007, h: 2853, alpha: false, format: 'png', label: 'iPhone Duo INNER display, held upright (2007×2853, same iPhone Duo slot)' },
  'appstore-iphone-duo-inner-landscape': { store: 'App Store', w: 2853, h: 2007, alpha: false, format: 'png', label: 'iPhone Duo INNER display LANDSCAPE (2853×2007 — open like a book, the fold runs down the middle; same iPhone Duo slot)' },
  'appstore-watch': { store: 'App Store', accepts: [[422, 514], [410, 502], [416, 496], [396, 484], [368, 448], [312, 390]], alpha: false, format: 'png', label: 'Apple Watch (any one accepted size; alpha NOT allowed)' },
  'appstore-mac': { store: 'Mac App Store', w: 2880, h: 1800, alpha: false, format: 'png', label: 'Mac (2880×1800, 16:10 landscape — largest required class)' },
  'play-phone': { store: 'Google Play', w: 1080, h: 1920, alpha: false, format: 'png', label: 'Play phone (9:16; store minimum is 320px per side, 1080+ for promotion eligibility; max 2:1; no alpha)' },
  'play-tablet': { store: 'Google Play', w: 2560, h: 1440, alpha: false, format: 'png', label: 'Play tablet (16:9, 1080–7680px, no alpha)' },
  'play-tablet-portrait': { store: 'Google Play', w: 1600, h: 2560, alpha: false, format: 'png', label: 'Play tablet PORTRAIT (same Play slots as play-tablet, rotated; 1080–7680px, no alpha)' },
  'play-wear': { store: 'Google Play', w: 1080, h: 1080, alpha: false, format: 'png', label: 'Play Wear OS (1:1 square, 384–3840px, no alpha)' },
  'play-feature-graphic': { store: 'Google Play', w: 1024, h: 500, alpha: false, format: 'png', graphic: true, label: 'Play feature graphic (1024×500, no alpha) — brand banner, not a per-scene shot' },
  'play-icon': { store: 'Google Play', w: 512, h: 512, alpha: true, format: 'png', graphic: true, icon: true, maxBytes: 1024 * 1024, label: 'Play app icon (512×512, 32-bit PNG — the one asset where alpha is allowed; ≤1MB). Built from brand.logo.' },

  /**
   * The OTHER in-app purchase image, and the optional one.
   *
   * Required only to promote the purchase on the app's own product page, or for win-back offers on
   * an auto-renewable subscription — so an app that does neither leaves the slot empty and submits
   * fine. Apple's requirements are exact, and unusually specific about the two things a canvas
   * gets wrong by default: 1024×1024, 72 dpi, RGB, **flattened**, and **no rounded corners**.
   *
   * Built from `brand.logo` like the Play icon, and `alpha: false` is the difference that matters:
   * the icon target keeps transparency because Play masks it to its own shape, and this one must
   * not, because Apple asks for it flattened.
   */
  'appstore-iap-promo': { store: 'App Store', w: 1024, h: 1024, alpha: false, format: 'png', graphic: true, icon: true, label: 'In-app purchase PROMOTIONAL image (1024×1024, flattened RGB, no rounded corners) — optional, and only if the purchase is promoted on the product page' },
  // Not a store asset — the picture every LINK to the game shows. Same branded banner the Play
  // feature graphic uses, at the aspect the social platforms crop to, so a game gets one from the
  // pipeline it already runs instead of someone exporting a one-off by hand and letting it go stale.
  //
  // 1200×630 is the size to build once: it is Open Graph's recommendation, it satisfies Twitter's
  // `summary_large_image` (min 300×157, ≤5MB, ~1.91:1), and Slack/Discord/iMessage all read the same
  // og: tags. Anything squarer gets centre-cropped by somebody.
  'social-card': { store: 'Open Graph / Twitter card', w: 1200, h: 630, alpha: false, format: 'png', graphic: true, label: 'Social preview (1200×630, no alpha) — the og:image / twitter:image a shared link shows' },

  /**
   * App Store CREATIVE ASSETS (iOS 27 / iPadOS 27) — the product page header and the search results
   * image. Optional, separate from screenshots, and a different kind of picture: Apple calls them
   * "rich images … distinct from the in-use functionality requirement in app previews and screenshots".
   * So they are branded graphics (`graphic` + `creative`), built from the same brand system as the Play
   * feature graphic — lockup, tagline, the `fan`, one hero capture — and not one shot per scene.
   *
   * `safe` is the ART SAFE AREA, in pixels of this canvas, and it is Apple's own: read from the
   * "Art Safe Area" rectangles in Apple's Sketch template (creative_assets-templates.sketch, from
   * developer.apple.com/app-store/asset-best-practices). Apple publishes no safe area in its help
   * pages — only "be sure your focal point artwork is within the center" — because one file is cropped
   * differently on iPhone and iPad and in each orientation. The template is the one place the numbers
   * exist, so they are carried here rather than guessed: the composer keeps the lockup and tagline
   * wholly inside the rectangle and the hero mostly inside it, and lets only decoration run outside.
   *
   * The rectangles are small, and that is the template's statement, not an error here: the header's
   * is the centre 1646×661 (43% × 40%) — exactly as wide as the canvas is tall, which fits a square
   * centre crop, though Apple does not say so; the universal asset's sits ABOVE centre (Apple draws it
   * 334 px high). Re-read the template if Apple revises it.
   *
   * The header and universal list their one size in `accepts`, so a `size:` override is held to it (an
   * override is otherwise taken as meant). Formats: the header and search accept .jpeg/.jpg/.png; the
   * universal is PNG only. zdymak always writes a no-alpha PNG, which every one of them takes. Apple
   * states no file-size cap for these.
   * Apple: https://developer.apple.com/help/app-store-connect/reference/app-information/creative-assets-specifications/
   */
  'appstore-header': { store: 'App Store', w: 3840, h: 1646, accepts: [[3840, 1646]], alpha: false, format: 'png', graphic: true, creative: true, safe: [1097, 493, 1646, 661], label: 'Product page HEADER image (21:9, 3840×1646, no alpha) — iOS/iPadOS 27+, optional; shown above the app icon' },
  // The search card takes any exact 3:2 from 1920×1280 to 3840×2560. The ceiling is the default: an
  // image has no codec level to cap it (the video target's default is lower for that reason), and the
  // largest accepted size leaves the store the most to scale from. `size:` picks any other 3:2.
  'appstore-search': { store: 'App Store', w: 3840, h: 2560, range: { min: [1920, 1280], max: [3840, 2560], ratio: [3, 2] }, alpha: false, format: 'png', graphic: true, creative: true, safe: [836, 765, 2168, 1030], label: 'SEARCH RESULTS image (3:2 — any size from 1920×1280 to 3840×2560; default 3840×2560; no alpha) — iOS/iPadOS 27+, optional' },
  // One file for BOTH placements ("Use header asset in search results" is offered only for this one).
  // Apple's template puts its safe area above centre, so the composition sits high on the canvas.
  'appstore-universal': { store: 'App Store', w: 5244, h: 2950, accepts: [[5244, 2950]], alpha: false, format: 'png', graphic: true, creative: true, safe: [1921, 660, 1402, 962], label: 'UNIVERSAL creative asset (16:9, 5244×2950 PNG, no alpha) — one file for the product page header AND search results' },
};

/** Resolve a video target by id, throwing a helpful error listing valid ids. */
export function videoTarget(id) {
  const t = VIDEO_TARGETS[id];
  if (!t) {
    throw new Error(`Unknown video target "${id}". Valid: ${Object.keys(VIDEO_TARGETS).join(', ')}`);
  }
  return t;
}
