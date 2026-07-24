/**
 * Live-footage reel demo. Each segment points at a short RECORDING (real motion) — here the stand-in
 * clips under ./clips — composited on the brand matte, hard-cut on the beat. `zdymak reel --config …`.
 * (Swap `clip:` for real `zdymak capture --record` output, or `images: [...]` for a multi-photo page.)
 */
export default {
  brand: { ink: '#0b0b0a', title: '#F5F5F4', sub: '#BBF7D0', name: 'Your App' },

  reel: {
    size: [1080, 1920],
    bpm: 120,
    beatsPerCut: 4, // 4 × 60/120 = 2.0 s on-screen per segment
    theme: {
      bgTop: '#0e1a12',
      bgBottom: '#0b0b0a',
      glowAlpha: 0.16,
      vignette: 0.34,
      inset: 0.84, // float the screen with a visible matte (not near-full-bleed)
      radius: 0.045,
      shadow: 0.5,
    },
    // music: { path: './assets/bed.mp3', volume: 0.9, fadeIn: 0.6, fadeOut: 0.8, offset: 0 },
    segments: [
      { clip: './clips/welcome.mov', caption: { title: 'Learn anything.', sub: 'Remember it for good.' }, palette: 'a' },
      { clip: './clips/study.mov', caption: { title: 'Recall, right before you forget.', sub: 'Audio + pronunciation built in.' }, palette: 'a' },
      { clip: './clips/answer.mov', caption: { title: 'Images, audio, real examples.', sub: 'Context that makes it stick.' }, palette: 'a' },
    ],
  },

  out: './out',
};
