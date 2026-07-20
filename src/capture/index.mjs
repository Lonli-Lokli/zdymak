/**
 * Capture mode (mode B) — for devs who'd rather grab frames from a running app than hand-manage a
 * screenshots folder. Project-agnostic on purpose: it does NOT build your app (that's your toolchain).
 * It snapshots or screen-records whatever is on the BOOTED simulator / connected device, strips the
 * alpha channel (Apple & Play reject transparency on screenshots), and writes store-ready PNGs you then
 * reference from your config's `scenes`.
 *
 *   zdymak capture --platform ios      --name welcome            # snap the booted iOS simulator
 *   zdymak capture --platform android  --name welcome            # snap the connected device/emulator
 *   zdymak capture --platform ios      --record --out shots/rec  # screen-record (stop with Ctrl-C)
 *
 * The two-mode contract: capture writes PNGs; the video engine consumes PNGs. So capture output drops
 * straight into `screenshotsDir`, and mode A (bring-your-own-screenshots) and mode B share one pipeline.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';

/** Flatten alpha over black and rewrite as an opaque PNG (App Store & Play reject alpha on screenshots). */
async function stripAlpha(file) {
  const img = await loadImage(file);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, img.width, img.height);
  ctx.drawImage(img, 0, 0);
  fs.writeFileSync(file, c.toBuffer('image/png'));
}

function sh(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${(r.stderr || r.stdout || '').trim()}`);
  return r.stdout;
}

async function captureIos(flags) {
  if (spawnSync('xcrun', ['simctl', 'help'], { stdio: 'ignore' }).status !== 0) {
    throw new Error('xcrun/simctl not found — install Xcode command-line tools.');
  }
  const outDir = path.resolve(flags.out || 'shots');
  fs.mkdirSync(outDir, { recursive: true });

  if (flags.record !== undefined) {
    const out = path.join(outDir, `${flags.name || 'recording'}.mov`);
    console.log(`▶︎ Recording the booted iOS simulator → ${out}\n  Interact with the app, then press Ctrl-C to stop.`);
    const proc = spawn('xcrun', ['simctl', 'io', 'booted', 'recordVideo', '--codec=h264', '--force', out], { stdio: 'inherit' });
    await new Promise((res) => proc.on('close', res));
    console.log(`✓ Saved ${out}. Extract frames with: ffmpeg -i ${out} -vf fps=2 ${outDir}/frame-%03d.png`);
    return;
  }

  const out = path.join(outDir, `${flags.name || 'shot'}.png`);
  sh('xcrun', ['simctl', 'io', 'booted', 'screenshot', out]);
  await stripAlpha(out);
  console.log(`✓ ${out}  (alpha stripped, store-ready)`);
}

async function captureAndroid(flags) {
  if (spawnSync('adb', ['version'], { stdio: 'ignore' }).status !== 0) {
    throw new Error('adb not found — install Android platform-tools and connect a device/emulator.');
  }
  const outDir = path.resolve(flags.out || 'shots');
  fs.mkdirSync(outDir, { recursive: true });

  if (flags.record !== undefined) {
    const remote = '/sdcard/zdymak-rec.mp4';
    const out = path.join(outDir, `${flags.name || 'recording'}.mp4`);
    console.log(`▶︎ Recording the device → ${out}\n  Interact with the app, then press Ctrl-C to stop.`);
    const proc = spawn('adb', ['shell', 'screenrecord', remote], { stdio: 'inherit' });
    await new Promise((res) => proc.on('SIGINT', res).on('close', res));
    sh('adb', ['pull', remote, out]);
    console.log(`✓ Saved ${out}. Extract frames with: ffmpeg -i ${out} -vf fps=2 ${outDir}/frame-%03d.png`);
    return;
  }

  const name = flags.name || 'shot';
  const out = path.join(outDir, `${name}.png`);
  const buf = spawnSync('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 });
  if (buf.status !== 0) throw new Error(`adb screencap failed: ${buf.stderr}`);
  fs.writeFileSync(out, buf.stdout);
  await stripAlpha(out);
  console.log(`✓ ${out}  (alpha stripped, store-ready)`);
}

export async function runCapture(flags) {
  const platform = flags.platform;
  if (platform === 'ios') return captureIos(flags);
  if (platform === 'android') return captureAndroid(flags);
  throw new Error('capture needs --platform ios|android. Boot a simulator/emulator (or connect a device) first, navigate to the screen, then run capture --name <screen>.');
}
