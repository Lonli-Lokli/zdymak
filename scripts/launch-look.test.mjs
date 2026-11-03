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
import { LAUNCH_LOOK, launchDifferences, screenDifference } from '../src/capture/index.mjs';

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
