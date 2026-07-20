/**
 * store-preview config — copy to your project root as `store-preview.config.mjs` and edit.
 * All paths are relative to THIS file. Run:  store-preview video
 */
export default {
  // Brand palette for the caption scrim + text (hex). `fontPaths` is optional — omit to use the system
  // font (San Francisco on macOS, ideal for App Store assets).
  brand: {
    ink: '#0b0b0a', // scrim / letterbox fill
    title: '#F5F5F4', // caption title colour
    sub: '#9ae6b4', // caption subtitle colour
    // fontPaths: ['./assets/MyBrand-Bold.ttf', './assets/MyBrand-Regular.ttf'],

    // Reel-mode branding (only the device-framed `social-reel` target uses these):
    name: 'My App', // wordmark on the cold-open / end-card
    tagline: 'Your one-line promise.', // cold-open sub
    endline: 'The closing line.', // end-card title
    endsub: 'Free to try · Buy once', // end-card sub
    logo: './assets/icon-512.png', // icon for the bookends (optional)
    // reel: { bgTop: '#FAFAF9', bgBottom: '#DCFCE7', glowLight: '#BBF7D0' },  // optional palette overrides
  },

  // Where your screenshots live, and an optional suffix appended to each scene `id`.
  // Here a scene id "welcome" resolves to  ./screenshots/welcome.png
  screenshotsDir: './screenshots',
  suffix: '',

  // The narrative. Each scene = one full-screen screenshot + a terse caption + a camera move.
  // move: pushIn | pushInSlow | pullBack | pullBackSlow | driftUp | driftDown | driftLeft | driftRight | still
  // Omit `move` and the engine auto-varies the motion so nothing repeats back-to-back.
  scenes: [
    { id: 'welcome', title: 'Your one-line hook.', sub: 'The promise, in a few words.', move: 'pushInSlow' },
    { id: 'feature-1', title: 'What it does.', sub: 'Why it matters.', move: 'driftUp' },
    { id: 'feature-2', title: 'The best moment.', sub: 'Show, don’t tell.', move: 'pullBack' },
    { id: 'feature-3', title: 'One more reason.', sub: 'Keep it concrete.', move: 'pushIn' },
    { id: 'offer', title: 'The honest offer.', sub: 'Price / trial, plainly.', move: 'pullBackSlow' },
  ],

  // Which videos to build. `store-preview specs` lists every target.
  //   appstore-preview / play-promo → full-bleed (App Store / Play);  social-reel → device-framed (web/social).
  targets: ['appstore-preview', 'play-promo', 'social-reel'],

  sceneDur: 3.1, // seconds per scene
  xfade: 0.32, //  cross-dissolve seconds
  out: './store-assets', // output dir (created if missing)
};
