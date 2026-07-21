export default {
  brand: { ink:'#0b0b0a', title:'#F5F5F4', sub:'#BBF7D0' },
  reel: {
    size: [1080,1920], bpm:120, beatsPerCut:6,
    theme:{ bgTop:'#0e1a12', bgBottom:'#0b0b0a', vignette:0.34, inset:0.84, radius:0.045, shadow:0.5 },
    segments: [
      { images: ['screenshots/welcome.png','screenshots/study.png','screenshots/answer.png'],
        caption:{ title:'Three cards, one page.', sub:'A multi-photo segment.' }, palette:'a' },
    ],
  },
  out: './out-img',
};
