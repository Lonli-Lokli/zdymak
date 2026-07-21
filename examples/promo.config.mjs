/**
 * zdymak's OWN ad — the demo media embedded in the README / npm page.
 *
 * Dogfood on purpose: every frame is produced by the tool being advertised, from real, unretouched app
 * captures — three iPhone screens in ./screenshots (XCUITest) and six Android ones in
 * ./screenshots/android (Compose instrumentation, Pixel 9 / Android 16). The captions sell zdymak rather
 * than the app the shots came from.
 *
 * The iPhone group has only three of the six scenes; the other three skip cleanly, which is itself the
 * behaviour being demonstrated — a device renders whatever it has captured.
 *
 * The point of shipping BOTH device groups here is that it's the actual claim: one scene list + one
 * caption set, two platforms, each with its own inferred device frame and its own store's encode.
 *
 *   npm run demo    → examples/out/{iphone-social-reel,android-play-promo}.mp4  +  docs/demo.gif
 */
export default {
  brand: {
    ink: '#0b0b0a',
    title: '#F5F5F4',
    sub: '#BBF7D0',
    name: 'zdymak',
    tagline: 'Screenshots captured. Store assets composed.',
    endline: 'One config. Every store.',
    endsub: 'npm i -D zdymak',
  },

  suffix: '', // scene id "welcome" → <capturesDir>/welcome.png

  // Six beats = what the tool actually claims, in order: input → config → motion → frames → slots → spec.
  //
  // Each beat demonstrates a different CATEGORY of transition — movement, physical, wipe,
  // physical, light — so no two cuts read as the same move, because for this package the transitions ARE the
  // product — an ad for a video tool that cuts plainly is arguing against itself. (A real app's store
  // preview should NOT do this; see the restraint note in transitions.mjs.) The screens
  // themselves stay still: a store screen is a composed thing, and parking it mid-scroll turns a full
  // screen into a half-empty one. Motion belongs between the scenes, not inside them.
  scenes: [
    // The first two beats carry the thing the reel used to omit entirely: there are TWO ways in, and the
    // second one (zdymak drives the app and takes the shots) is the part people don't expect from a
    // tool they assume is only a compositor.
    { id: 'welcome', title: 'Bring your own screenshots.', sub: 'Any folder of PNGs — Xcode, Figma, anywhere.' },
    { id: 'today', title: 'Or let zdymak take them.', sub: 'It drives iOS, Android and web, screen by screen.', cut: 'whip-pan' },
    { id: 'study', title: 'Premium transitions.', sub: 'Thirty-two, chosen per scene.', cut: 'flip' },
    { id: 'answer', title: 'Device frames, inferred.', sub: 'iPhone · Android · iPad · Watch.', cut: 'iris-circle' },
    { id: 'progress', title: 'Every store slot.', sub: 'Shots, feature graphic, previews.', cut: 'tearing-paper' },
    { id: 'paywall', title: 'Encoded to spec.', sub: 'App Store + Play accept it as-is.', cut: 'light-leak-wipe' },
  ],

  // Cuts land on the beat: 4 beats at 112bpm ≈ 2.14s per scene.
  timing: { bpm: 112, beatsPerCut: 4 },

  targets: [], // nothing from the top level — each device below renders its own store's video

  devices: {
    // The README hero: device-framed reel with the brand cold-open + end card.
    iphone: {
      capturesDir: './screenshots',
      videos: [{ target: 'social-reel' }],
      screenshots: [{ target: 'appstore-iphone-6.9' }],
    },
    // The same six scenes and captions, framed and encoded for Play instead.
    android: {
      capturesDir: './screenshots/android',
      videos: [
        { target: 'play-promo' },
        // Same reel treatment as the iPhone one, with the ANDROID body — the frame follows the capture.
        { target: 'social-reel', theme: { frame: 'android' } },
      ],
      screenshots: [{ target: 'play-phone' }, { target: 'play-feature-graphic' }],
    },
  },

  theme: {
    bgTop: '#0e1a12',
    bgBottom: '#0b0b0a',
    glowAlpha: 0.16,
    vignette: 0.32,
  },

  sceneDur: 3.0,
  out: './out',
};
