// Compliant App Store App Preview: REAL footage, full-bleed, NO frame, dissolves, no captions.
export default {
  brand: { ink:'#0b0b0a', title:'#F5F5F4', sub:'#BBF7D0' },
  reel: {
    size: [886, 1920], level: '4.0',      // App Store iPhone App Preview spec (portrait 19.5:9)
    sceneDur: 2.6, transition: 'dissolve',
    theme: { bleed: true, frame: false },  // real footage fills the frame, no device frame/matte
    segments: [ { clip:'./clips/welcome.mov' }, { clip:'./clips/study.mov' }, { clip:'./clips/answer.mov' } ],
  },
  out: './out',
};
