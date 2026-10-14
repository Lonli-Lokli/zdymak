// The launch-screen guard of the iOS still capture: two shots of one launch screen read as unchanged,
// a swaying mark stays under the line, and the app's first screen is far over it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { LAUNCH_LOOK, screenDifference } from '../src/capture/index.mjs';

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
