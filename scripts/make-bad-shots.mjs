// Writes the checker's fixture folders: scripts/fixtures/bad-shots (one shot per refusal, each with the device facts a
// capture would have kept beside it, and expected.json naming the rule each shot must be refused for) and
// scripts/fixtures/good-shots (shots no rule may refuse), and scripts/fixtures/launch (the launch check's frames). The
// pictures are drawn, not captured, so they carry no app.
//   node scripts/make-bad-shots.mjs        (then: npm run check:checker and npm run check:captions)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import { factsPath } from '../src/checker-device.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const BAD = path.join(here, 'fixtures', 'bad-shots');
const GOOD = path.join(here, 'fixtures', 'good-shots');

/** A scene: a two-way gradient (well over the blank rule's colours) and blocks placed by `seed`, so no two match. */
function scene(w, h, seed) {
  const c = createCanvas(w, h);
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      img.data[i] = Math.round((x / w) * 255);
      img.data[i + 1] = Math.round((y / h) * 255);
      img.data[i + 2] = (seed * 37) % 256;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  for (let k = 0; k < 4; k++) {
    const r = (seed * 7 + k * 13) % 17;
    g.fillStyle = `rgb(${(r * 61) % 256}, ${(r * 113 + 40) % 256}, ${(r * 29 + 90) % 256})`;
    g.fillRect(((seed * 53 + k * 97) % (w - 80)), ((seed * 31 + k * 71) % (h - 80)), 70, 70);
  }
  return c;
}

const save = (c, file) => fs.writeFileSync(file, c.toBuffer('image/png'));
/** The facts a capture keeps beside a shot, on one line (a capture writes them indented; the reader takes both). */
const writeFacts = (file, facts) => {
  fs.mkdirSync(path.dirname(factsPath(file)), { recursive: true });
  fs.writeFileSync(factsPath(file), `${JSON.stringify(facts)}\n`);
};

const android = (over = {}) => ({
  platform: 'android', app: 'com.example.app', language: 'en-US', time: '9:41',
  focus: { window: 'com.example.app/com.example.app.Main', app: 'com.example.app' },
  keyboard: false, appLocales: ['en-US'], systemLocale: 'en-US', demoAllowed: true,
  launchDifference: 0.6, launchLook: 0.04, motion: 0, motionAllowed: 0.01, ...over,
});

fs.rmSync(BAD, { recursive: true, force: true });
fs.rmSync(GOOD, { recursive: true, force: true });
fs.mkdirSync(BAD, { recursive: true });
fs.mkdirSync(GOOD, { recursive: true });

const expected = {};
const W = 360;
const H = 480;
let seed = 1;
const bad = (name, rule, facts, canvas = scene(W, H, seed++)) => {
  const file = path.join(BAD, `${name}.png`);
  save(canvas, file);
  writeFacts(file, facts);
  expected[`${name}.png`] = rule ? [rule] : [];
};

fs.writeFileSync(path.join(BAD, 'unreadable.png'), 'this is not a PNG\n');
expected['unreadable.png'] = ['unreadable'];
const flat = createCanvas(W, H);
flat.getContext('2d').fillStyle = '#ffffff';
flat.getContext('2d').fillRect(0, 0, W, H);
bad('blank', 'blank', android(), flat);
bad('launch', 'launch', android({ launchDifference: 0.01 }));
bad('motion', 'motion', android({ motion: 0.12, motionAllowed: 0.01 }));
bad('dialog-not-responding', 'dialog', android({ focus: { window: 'Application Not Responding: com.android.systemui', app: 'com.example.app' } }));
bad('dialog-crash', 'dialog', android({ focus: { window: 'Application Error: com.example.app', app: 'com.example.app' } }));
bad('keyboard', 'keyboard', android({ keyboard: true }));
bad('wrong-app-home', 'wrong-app', android({ focus: { window: 'com.google.android.apps.nexuslauncher/.NexusLauncherActivity', app: 'com.google.android.apps.nexuslauncher' } }));
bad('wrong-app-ios-quit', 'wrong-app', { platform: 'ios', app: 'com.example.app', language: 'en-US', time: '9:41', running: false, statusBar: 'Time: 9:41' });
bad('status-bar-android', 'status-bar', android({ demoAllowed: false }));
bad('status-bar-ios', 'status-bar', { platform: 'ios', app: 'com.example.app', language: 'en-US', time: '9:41', running: true, statusBar: '' });
bad('language', 'language', android({ language: 'fr-FR', appLocales: ['de-DE'] }));

// A phone-shaped app (9:19.5) drawn in the middle of a 4:3 landscape tablet, black bars either side.
const lb = createCanvas(480, 360);
lb.getContext('2d').fillStyle = '#000000';
lb.getContext('2d').fillRect(0, 0, 480, 360);
lb.getContext('2d').drawImage(scene(166, 360, seed++), 157, 0);
bad('letterbox-tablet', 'letterbox', android(), lb);
// A phone on its side in a portrait tablet: grey bars above and below, the status strip drawn across the top one.
const lt = createCanvas(360, 480);
const ltg = lt.getContext('2d');
ltg.fillStyle = '#303030';
ltg.fillRect(0, 0, 360, 480);
ltg.drawImage(scene(360, 166, seed++), 0, 157);
ltg.fillStyle = '#101010';
ltg.fillRect(0, 0, 360, 20);
ltg.fillStyle = '#e0e0e0';
ltg.fillRect(8, 6, 30, 8);
bad('letterbox-sideways', 'letterbox', android(), lt);

// Two scenes of one set that are the same picture: the first is fine, the second is refused.
const twin = scene(W, H, seed++);
bad('duplicate-1', null, android(), twin);
bad('duplicate-2', 'duplicate', android(), twin);

fs.writeFileSync(path.join(BAD, 'expected.json'), `${JSON.stringify(expected, null, 2)}\n`);

// Shots no rule may refuse: two scenes of one set, a full-width tablet layout, and a tablet layout that keeps a
// readable width on a plain ground (its column is wider than a phone, so it is not a letterbox).
const ok = (name, canvas) => {
  const file = path.join(GOOD, `${name}.png`);
  save(canvas, file);
  writeFacts(file, android({ motion: 0.004 }));
};
ok('scene-1', scene(W, H, 101));
ok('scene-2', scene(W, H, 102));
ok('tablet-full', scene(480, 360, 103));
const col = createCanvas(480, 360);
col.getContext('2d').fillStyle = '#f4f1ea';
col.getContext('2d').fillRect(0, 0, 480, 360);
col.getContext('2d').drawImage(scene(280, 360, 104), 100, 0);
ok('tablet-readable-width', col);
// The launch check's frames (scripts/launch-look.test.mjs), at a 13-inch tablet's size: one launch screen twice, its
// mark moved between the two as a launch animation moves it, and a result card a scene can show by its first frame.
const LAUNCH = path.join(here, 'fixtures', 'launch');
fs.mkdirSync(LAUNCH, { recursive: true });
const [LW, LH] = [2064, 2752];
const launchScreen = (dy) => {
  const c = createCanvas(LW, LH);
  const g = c.getContext('2d');
  g.fillStyle = '#EDE1CC';
  g.fillRect(0, 0, LW, LH);
  g.fillStyle = '#16343B';
  g.beginPath(); g.arc(LW / 2, LH / 2, 180, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#1A9E8C';
  g.fillRect(LW / 2 - 30, LH / 2 - 420 + dy, 60, 180);
  return c;
};
save(launchScreen(0), path.join(LAUNCH, 'launch-1.png'));
save(launchScreen(40), path.join(LAUNCH, 'launch-2.png'));
const card = createCanvas(LW, LH);
const cg = card.getContext('2d');
cg.fillStyle = '#EDE1CC';
cg.fillRect(0, 0, LW, LH);
cg.fillStyle = '#F6EFE3';
cg.fillRect(232, 520, 1600, 1700);
cg.fillStyle = '#16343B';
cg.fillRect(332, 640, 1400, 160);
for (let r = 0; r < 4; r++) cg.fillRect(332, 920 + r * 260, 900 - r * 150, 90);
cg.fillStyle = '#1A9E8C';
cg.fillRect(332, 1960, 1400, 160);
save(card, path.join(LAUNCH, 'drawn-at-once.png'));
console.log(`wrote ${Object.keys(expected).length} bad shots to ${path.relative(process.cwd(), BAD)} and 4 good to ${path.relative(process.cwd(), GOOD)}`);
