// The launch-screen guard of the still capture: two shots of one launch screen read as unchanged,
// a swaying mark stays under the line, and the app's first screen is far over it. A run's verdict
// (launchDifferences) tells a scene drawn by its first frame from a launch screen that stayed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { fileURLToPath } from 'node:url';
import { LAUNCH_LOOK, launchChange, launchDifferences, screenDifference } from '../src/capture/index.mjs';

// Written by scripts/make-bad-shots.mjs.
const frames = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'launch');
const launch1 = path.join(frames, 'launch-1.png');
const launch2 = path.join(frames, 'launch-2.png');
const card = path.join(frames, 'drawn-at-once.png');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zdymak-launch-'));
function shot(name, draw) {
  const c = createCanvas(440, 956);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#EDE1CC';
  ctx.fillRect(0, 0, 440, 956);
  draw(ctx);
  const file = path.join(dir, `${name}.png`);
  fs.writeFileSync(file, c.toBuffer('image/png'));
  return file;
}
const mark = (ctx, dx = 0) => {
  ctx.fillStyle = '#16343B';
  ctx.beginPath(); ctx.arc(220, 500, 40, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1A9E8C';
  ctx.fillRect(214 + dx, 420, 12, 40);
};

test('the same launch screen twice has not changed', async () => {
  assert.equal(await screenDifference(shot('a', mark), shot('b', mark)), 0);
});

test('a mark that sways is still the launch screen', async () => {
  const moved = await screenDifference(shot('still', mark), shot('sway', (ctx) => mark(ctx, 9)));
  assert.ok(moved > 0 && moved < LAUNCH_LOOK, `sway changed ${moved}`);
});

test("the app's board is not the launch screen", async () => {
  const board = shot('board', (ctx) => {
    ctx.fillStyle = '#F6EFE3';
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) ctx.fillRect(20 + c * 45, 260 + r * 45, 40, 40);
    ctx.fillStyle = '#16343B';
    ctx.fillRect(20, 700, 400, 60);
  });
  assert.ok(await screenDifference(shot('launch', mark), board) >= LAUNCH_LOOK);
});

test('captures of different sizes are different screens', async () => {
  const wide = path.join(dir, 'wide.png');
  fs.writeFileSync(wide, createCanvas(956, 440).toBuffer('image/png'));
  assert.equal(await screenDifference(shot('tall', mark), wide), 1);
});

test('the fixture pair is one launch screen, and the card is not it', async () => {
  assert.ok(await screenDifference(launch1, launch2) < LAUNCH_LOOK);
  assert.ok(await screenDifference(launch1, card) >= LAUNCH_LOOK);
});

// A run whose last scene is on screen by the frame taken 0.4 s after its launch: its shot is 3% from that frame,
// as a result card's was in all four sets of one tablet capture, and the earlier states left the launch screen.
const drawnAtOnce = (order) => order.map((s) => ({
  home: { state: 'home', frame: launch1, moved: 0.6, atOnce: false },
  levels: { state: 'levels', frame: launch2, moved: 0.5, atOnce: false },
  result: { state: 'result', frame: card, moved: 0.03, atOnce: false },
}[s]));

test('a scene drawn by its first frame is not a launch screen', async () => {
  const d = await launchDifferences(drawnAtOnce(['home', 'levels', 'result']), 30000);
  assert.deepEqual(d.slice(0, 2), [0.6, 0.5]);
  assert.ok(d[2] >= LAUNCH_LOOK, `the card is ${d[2]} from the launch screen`);
});

test('nor when it is the first state of the run', async () => {
  const d = await launchDifferences(drawnAtOnce(['result', 'home', 'levels']), 30000);
  assert.ok(d[0] >= LAUNCH_LOOK);
});

test('a launch screen that stayed is refused, wherever it is in the run', async () => {
  for (const first of [true, false]) {
    const stayed = { state: 'daily', frame: launch2, moved: 0.01, atOnce: false };
    const left = { state: 'home', frame: launch1, moved: 0.6, atOnce: false };
    await assert.rejects(launchDifferences(first ? [stayed, left] : [left, stayed], 30000), /daily: .*still looks as it did at launch \(1\.0%/);
  }
});

test('a frame taken for the scene is refused once the run learns it is the launch screen', async () => {
  const early = { state: 'home', frame: launch2, moved: 0.01, atOnce: true };
  await assert.rejects(launchDifferences([early, { state: 'levels', frame: launch1, moved: 0.6, atOnce: false }], 30000), /home: /);
});

test('with no launch screen seen to give way, a shot that never changed is refused', async () => {
  await assert.rejects(launchDifferences([{ state: 'result', frame: card, moved: 0.03, atOnce: false }], 30000), /result: /);
});

// A dark result card over the dimmed scene, on a tablet: the scrim, the card and the scene under it all sit within 32
// of the launch screen's dark ground in every channel, so only the card's words, its rim and its button differ by
// colour, about 3% of the screen, under LAUNCH_LOOK. Measured so on a real tablet capture, it was refused twice
// though the card was fully drawn. The launch screens of one run differ by 16 to 24 in their ground, which is why the
// colour tolerance cannot simply come down.
const W = 1032;
const H = 1376;
const GROUND = [3, 24, 11];
const rgb = ([r, g, b], k = 0) => `rgb(${r + k},${g + k},${b + k})`;
function frame(name, draw, w = W, h = H) {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  draw(ctx);
  const file = path.join(dir, `${name}.png`);
  fs.writeFileSync(file, c.toBuffer('image/png'));
  return file;
}
/**
 * A launch screen: flat ground (lifted by `lift` in every channel) and a small ring of dots in the middle; `turned`
 * draws it on the screen turned on its side, and `bar` puts a status bar's time and battery along its top.
 */
const launchScreen = (name, { lift = 0, withMark = true, turned = false, bar = false } = {}) => {
  const [w, h] = turned ? [H, W] : [W, H];
  return frame(name, (ctx) => {
    ctx.fillStyle = rgb(GROUND, lift);
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#E8F4EC';
    if (bar) {
      for (let g = 0; g < 5; g++) ctx.fillRect(40 + g * 12, 14, 7, 16);
      ctx.fillRect(w - 90, 16, 50, 12);
    }
    if (!withMark) return;
    for (let a = 0; a < 24; a++) {
      ctx.beginPath();
      ctx.arc(w / 2 + 60 * Math.cos(a * Math.PI / 12), h / 2 + 42 * Math.sin(a * Math.PI / 12), 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }, w, h);
};
/** The scene under a dark scrim (faint vines), and a dark card holding light words, a rim and one light button. */
const dimmedCard = (name, { turned = false } = {}) => {
  const [sw, sh] = turned ? [H, W] : [W, H];
  return frame(name, (ctx) => {
    ctx.fillStyle = rgb(GROUND, 6);
    ctx.fillRect(0, 0, sw, sh);
    let seed = 7;
    const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    ctx.lineWidth = 3;
    for (let v = 0; v < 400; v++) {
      ctx.strokeStyle = rgb(GROUND, 8 + Math.floor(next() * 14));
      ctx.beginPath();
      ctx.moveTo(next() * sw, next() * sh);
      ctx.lineTo(next() * sw, next() * sh);
      ctx.stroke();
    }
    const w = 560;
    const h = 560;
    const x = (sw - w) / 2;
    const y = (sh - h - 56) / 2;
    ctx.fillStyle = rgb(GROUND, 14);
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#3E8A5A';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = '#DDEFE2';
    for (let line = 0; line < 9; line++) {
      for (let g = 0; g < 36; g++) if ((g * 7 + line) % 6) ctx.fillRect(x + 40 + g * 13, y + 50 + line * 40, 3, 16);
    }
    ctx.fillStyle = '#8FE6A8';
    ctx.fillRect(x + 40, y + 440, w - 80, 36);
  }, sw, sh);
};

test('a dark result card over the dimmed scene is not the launch screen, though few of its pixels changed colour', async () => {
  const launch = launchScreen('dark-launch');
  const card = dimmedCard('dark-card');
  const byColour = await screenDifference(launch, card);
  assert.ok(byColour > 0.02 && byColour < LAUNCH_LOOK, `by colour the card is ${byColour} from the launch screen`);
  const change = await launchChange(launch, card);
  assert.ok(change >= LAUNCH_LOOK, `the card is ${change} from the launch screen`);
  const d = await launchDifferences([
    { state: 'home', frame: launchScreen('dark-launch-home', { lift: 20 }), moved: 0.6, atOnce: false },
    { state: 'result', frame: launch, moved: change, atOnce: false },
  ], 30000);
  assert.ok(d[1] >= LAUNCH_LOOK);
});

test('two launch frames whose ground differs by 20 are one launch screen', async () => {
  const change = await launchChange(launchScreen('dark-a'), launchScreen('dark-b', { lift: 20 }));
  assert.ok(change < LAUNCH_LOOK, `the two launch frames are ${change} apart`);
});

test('a launch frame taken before its mark drew is still the launch screen', async () => {
  const change = await launchChange(launchScreen('dark-bare', { withMark: false }), launchScreen('dark-marked', { lift: 20 }));
  assert.ok(change < LAUNCH_LOOK, `the mark's arrival is ${change}`);
});

test('a dark launch screen that stayed is refused', async () => {
  const launch = launchScreen('dark-stayed-launch');
  const moved = await launchChange(launch, launchScreen('dark-stayed-shot'));
  const home = { state: 'home', frame: launchScreen('dark-home-launch', { lift: 20 }), moved: 0.6, atOnce: false };
  await assert.rejects(launchDifferences([home, { state: 'result', frame: launch, moved, atOnce: false }], 30000), /result: .*still looks as it did at launch/);
});

// A turned tablet: the launch frame is shot as the app starts, before the screen is turned, and the shot after it, so
// the two come back one the other's size turned. Read as different sizes, every such shot was 1 from its launch frame,
// and a launch screen that stayed passed. Both are upright, the mark in the middle of each.
test('a launch screen that stayed on a turned screen is still the launch screen', async () => {
  const launch = launchScreen('turned-stayed-launch', { bar: true });
  const moved = await launchChange(launch, launchScreen('turned-stayed-shot', { lift: 20, turned: true, bar: true }));
  assert.ok(moved < LAUNCH_LOOK, `the launch screen turned is ${moved} from its launch frame`);
  const home = { state: 'home', frame: launchScreen('turned-home-launch', { lift: 20 }), moved: 0.6, atOnce: false };
  await assert.rejects(launchDifferences([home, { state: 'result', frame: launch, moved, atOnce: false }], 30000), /result: .*still looks as it did at launch/);
});

test('a scene drawn on a turned screen is not the launch frame shot before the turn', async () => {
  const launch = launchScreen('turned-launch', { bar: true });
  const change = await launchChange(launch, dimmedCard('turned-card', { turned: true }));
  assert.ok(change >= LAUNCH_LOOK, `the turned card is ${change} from the launch frame`);
});

test('a launch frame and a shot neither one size nor one size turned are refused, not read as changed', async () => {
  const other = frame('other-size', (ctx) => { ctx.fillStyle = rgb(GROUND); ctx.fillRect(0, 0, 800, 600); }, 800, 600);
  await assert.rejects(launchChange(launchScreen('sized-launch'), other), /1032×1376.*800×600/);
});
