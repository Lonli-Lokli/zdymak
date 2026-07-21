/**
 * Live demo config used by the README's "see it in action" GIF and by `npm run example`.
 * The three screens in ./screenshots/ are REAL Asilak captures; this turns them into the premium reel
 * (Apple editing vocabulary — floating matte, spring-then-freeze dolly, kinetic caption pills).
 */
export default {
  brand: {
    ink: '#0b0b0a',
    title: '#F5F5F4', // light caption title (dark reel matte)
    sub: '#BBF7D0', // green-200 subtitle
    name: 'Asilak',
    tagline: 'Learn anything. Remember it for good.',
    endline: 'Learning that actually sticks.',
    endsub: 'Free to try · Buy once · No subscription',
  },

  screenshotsDir: './screenshots',
  suffix: '', // scene id "welcome" → ./screenshots/welcome.png

  scenes: [
    { id: 'welcome', title: 'Learn anything.', sub: 'Remember it for good.', move: 'pushInSlow' },
    { id: 'study', title: 'Recall, right before you forget.', sub: 'Audio + pronunciation built in.', move: 'pullBack' },
    { id: 'answer', title: 'Images, audio, real examples.', sub: 'Context that makes it stick.', move: 'pushIn' },
  ],

  targets: ['premium-reel'], // the cinematic showcase; `zdymak specs` lists the App Store / Play targets

  theme: {
    bgTop: '#0e1a12', // deep brand-green matte
    bgBottom: '#0b0b0a',
    glowAlpha: 0.16,
    vignette: 0.32,
  },

  sceneDur: 3.0,
  out: './out',
};
