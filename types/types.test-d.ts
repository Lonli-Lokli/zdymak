/**
 * Type tests — compiled by `npm run check:types` (tsc --noEmit), never shipped as runtime code.
 * These are the shapes a real project writes, so a breaking change to the public types fails the build.
 */
import {
  defineConfig,
  loadConfig,
  buildDeviceScreenshots,
  IMAGE_TARGETS,
  videoTarget,
  type Config,
  type ResolvedConfig,
  type ImageTargetId,
} from 'zdymak';

// A realistic multi-device config.
const config: Config = defineConfig({
  brand: {
    ink: '#0b0b0a',
    title: '#F5F5F4',
    sub: '#BBF7D0',
    name: 'Your App',
    tagline: 'Your tagline goes here.',
    logo: './icon-512.png',
  },
  screenshotsDir: './captures',
  suffix: '-light',
  scenes: [
    { id: 'welcome', title: 'Learn anything.', sub: 'Remember it for good.', move: 'pushInSlow' },
    { id: 'study', title: 'Recall, right before you forget.', move: 'pullBack' },
    { image: './captures/custom.png', title: 'Explicit path instead of an id.' },
  ],
  targets: ['appstore-preview', 'social-reel'],
  sceneDur: 3.1,
  xfade: 0.32,
  stillTheme: { bgTop: '#e7f7ee', bgBottom: '#ffffff', vignette: 0, label: false, captionAnchor: 'top' },
  music: { path: './bed.mp3', volume: 0.9, fadeIn: 0.6 },
  devices: {
    iphone: {
      capturesDir: './captures',
      screenshots: [{ target: 'appstore-iphone-6.9' }, { target: 'appstore-iphone-6.5', size: [1284, 2778] }],
    },
    watch: {
      scenes: [{ id: '01-study' }],
      screenshots: [{ target: 'appstore-watch', style: 'bleed', size: [422, 514] }],
    },
    android: {
      capturesDir: './android/captures',
      screenshots: [{ target: 'play-phone' }, { target: 'play-feature-graphic' }],
      videos: [{ target: 'play-promo' }],
    },
    mac: {
      screenshots: ['appstore-mac'], // bare-string shorthand
      videos: [{ target: 'premium-reel', size: [2880, 1800] }],
    },
  },
  reel: {
    size: [1080, 1920],
    bpm: 112,
    beatsPerCut: 4,
    segments: [
      { image: './captures/welcome-light.png', caption: { title: 'Learn anything.' } },
      { clip: './clips/study.mov', caption: { title: 'Recall.', sub: 'Right before you forget.' } },
      { images: ['./a.png', './b.png'] },
    ],
  },
  captions: {
    de: './captions/de.json',                                  // a JSON file per locale
    fr: {                                                       // …or inline
      welcome: { title: 'Apprenez n’importe quoi.', sub: 'Retenez-le pour de bon.' },
      study: { title: 'Rappelez-vous, juste avant d’oublier.' }, // `sub` may be omitted
      $brand: { tagline: 'Apprenez n’importe quoi.' },           // localized feature-graphic copy
    },
  },
  out: './out',
});

// A config may be reel-only, or devices-only — every field is optional.
defineConfig({ reel: { segments: [{ image: './a.png' }] } });
defineConfig({ devices: { phone: { screenshots: ['play-phone'] } } });

// @ts-expect-error — `move` is a closed union, not any string.
defineConfig({ scenes: [{ id: 'a', move: 'zoomBananas' }] });

// @ts-expect-error — `captionAnchor` only takes 'top' | 'bottom'.
defineConfig({ stillTheme: { captionAnchor: 'middle' } });

// @ts-expect-error — `music.path` is required once `music` is given.
defineConfig({ scenes: [{ id: 'a' }], music: { volume: 0.5 } });

// @ts-expect-error — a reel needs its segments.
defineConfig({ reel: { bpm: 112 } });

// @ts-expect-error — a caption entry is { title?, sub? }, not a bare string.
defineConfig({ scenes: [{ id: 'a' }], captions: { de: { a: 'Hallo' } } });

async function programmatic(): Promise<void> {
  const resolved: ResolvedConfig = await loadConfig('./zdymak.config.mjs');
  const [device] = resolved.devices;
  const written = await buildDeviceScreenshots({
    device,
    brand: resolved.brand,
    theme: resolved.stillTheme ?? resolved.theme,
    outDir: resolved.out,
  });
  written.forEach((w) => console.log(w.file, w.W, w.H, w.style));

  const id: ImageTargetId = 'play-wear';
  console.log(IMAGE_TARGETS[id].label, videoTarget('appstore-preview').w);

  // Resolved scenes always carry an absolute image path + a concrete id.
  console.log(resolved.scenes[0].image.length, resolved.scenes[0].id, config.out);
}

void programmatic;
