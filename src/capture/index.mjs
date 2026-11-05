/**
 * Capture mode (mode B) — grab store-ready PNGs from a running app instead of hand-managing a folder.
 * Strips the alpha channel (Apple & Play reject transparency) and writes into your `capturesDir`, so the
 * capture → compose (`build`/`screenshots`) chain is one pipeline.
 *
 * FULL WORKFLOW (start app → drive by a handle → snap each screen):
 *   zdymak capture --platform ios --bundle com.x.app --arg -marketingScreen \
 *     --states welcome,today,study,answer --suffix -light \
 *     --build --project App.xcodeproj --scheme App --out marketing/ios/captures
 *   → (optionally) builds first, then boots a sim and installs, then for each state relaunches the app with
 *     `<arg> <state>` and screenshots it. The app just needs a launch-arg "handle" that routes to a
 *     seeded screen (e.g. reads `-marketingScreen <id>` from UserDefaults). Then `zdymak build` composes.
 *   `--configuration <name>` builds that Xcode configuration instead of Debug, any configuration the
 *   scheme defines (for example `--configuration Release`).
 *
 * Simpler modes:
 *   zdymak capture --platform ios|android --name welcome         # single snapshot of the booted device
 *   zdymak capture --platform ios --record --out shots/rec       # screen-record (stop with Ctrl-C)
 *   zdymak capture --platform web --url http://localhost:3000 --states /,/today   # Playwright (see web.mjs)
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { rgbPngBuffer } from '../png.mjs';
import { captureWeb } from './web.mjs';
import { iosBuildArgs } from './xcode.mjs';
import {
  DEMO_TIME, MOTION_GAP_MS, androidFacts, checkSet, checkShot, describeRefusals, iosFacts, motionAllowance, writeFacts,
} from '../checker.mjs';
import {
  displays, enterPosture, iosLaunchReady, launchApp, leavePosture, postureDisplay, postureOf, screenshotArgs, shootDisplay, shootPosture, shotTimes,
} from './fold.mjs';
import { androidPostureOf, enterAndroidPosture, leaveAndroidPosture, pngFromScreencap, shapeMatches, turnAndroid } from './android-fold.mjs';

/** Flatten over black and rewrite as a NO-ALPHA RGB PNG (App Store & Play reject alpha on screenshots). */
async function stripAlpha(file) {
  const img = await loadImage(file);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, img.width, img.height);
  ctx.drawImage(img, 0, 0);
  fs.writeFileSync(file, rgbPngBuffer(c)); // colour-type-2 PNG, no alpha channel
}

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${(r.stderr || r.stdout || '').trim()}`);
  return r.stdout;
}
const out2 = (cmd, args) => (spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout || '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const udidRe = /\(([0-9A-Fa-f-]{36})\)/;

/* ── Capturing in a LANGUAGE other than the device's ───────────────────────────────────────────
 *
 * A store screenshot set is per-locale and the caption is only half of it. `screenshots --locale`
 * paints a translated headline; it cannot touch the picture underneath, so a fully localized app
 * still shipped nineteen locales' worth of shots showing its ENGLISH board with a Japanese or
 * Arabic caption above it. That reads as an app the shopper is not going to get, and nothing
 * downstream flags it because every file is a valid PNG of a real screen.
 *
 * iOS takes the language as LAUNCH ARGUMENTS, so no device state is mutated and nothing has to be
 * put back: the flags ride the relaunch that already happens per state. `AppleLanguages` wants an
 * ARRAY literal, which is why the value is parenthesised — a bare `ja` is quietly ignored and you
 * get the base language back with a green tick and no warning.
 *
 * Android has no launch-arg equivalent. `cmd locale set-app-locales` is the per-app override added
 * in API 33, and unlike the iOS route it is DEVICE STATE: set before the run and cleared after, or
 * the emulator is left speaking Japanese for whatever captures next.
 */
function iosLanguageArgs(flags) {
  if (!flags.language) return [];
  // AppleLocale drives formatting (dates, numerals) rather than strings. Default it from the
  // language so `--language ja` is enough for the common case; `--applelocale ja_JP` overrides for
  // a region-specific set.
  const locale = flags.applelocale || String(flags.language).replace(/-/g, '_');
  return ['-AppleLanguages', `(${flags.language})`, '-AppleLocale', locale];
}

function androidLanguage(flags) {
  if (!flags.language) return { reset() {} };
  const pkg = String(flags.component || '').split('/')[0];
  if (!pkg) throw new Error('--language on android needs --component <pkg/activity> to know which app to set.');
  const set = (tag) =>
    spawnSync('adb', ['shell', 'cmd', 'locale', 'set-app-locales', pkg, '--locales', tag], { encoding: 'utf8' });
  const r = set(flags.language);
  if (r.status !== 0) {
    throw new Error(
      `adb cmd locale set-app-locales failed — needs Android 13 (API 33) or newer: ${(r.stderr || r.stdout || '').trim()}`,
    );
  }
  // The override lands on the next activity create; force-stop so the FIRST state is already
  // translated rather than photographing the previous language once.
  spawnSync('adb', ['shell', 'am', 'force-stop', pkg], { stdio: 'ignore' });
  console.log(`▸ app locale → ${flags.language} on ${pkg}`);
  return {
    reset() {
      set('');
      spawnSync('adb', ['shell', 'am', 'force-stop', pkg], { stdio: 'ignore' });
    },
  };
}

/* ── Rotating an iOS simulator ─────────────────────────────────────────────────────────────────
 *
 * There is no `simctl` command for this. Up to Xcode 26 orientation belonged to the Simulator APP, so
 * the only lever was its Device ▸ Orientation menu, driven here through System Events. Xcode 27
 * replaced that app with Device Hub, which has no such menu, and there `devicectl device orientation set`
 * turns the device (an iPad: measured 2026-10-13, and its screenshot then comes out landscape and
 * upright). Which one is decided by whether the Xcode in use still ships Simulator.app; before that,
 * `open -a Simulator` opened nothing on Xcode 27 and every turned iPad failed as "the Simulator never
 * opened a device window". (Device Hub's own orientation event, which turns the iPhone Duo in
 * fold.mjs, leaves an iPad as it was.)
 *
 * Rotating is only half of it. `simctl io screenshot` returns the RAW FRAMEBUFFER, which ignores
 * rotation entirely: a turned iPad screenshots as a portrait-shaped PNG with the whole interface
 * lying on its side. Correct pixels, valid image, unusable as a store asset — and invisible to any
 * check that does not actually look at it. So the capture is stood back up here rather than left for
 * someone to notice.
 */
const ORIENTATION_MENU = {
  portrait: 'Portrait',
  'portrait-upside-down': 'Portrait Upside Down',
  landscape: 'Landscape Left',
  'landscape-left': 'Landscape Left',
  'landscape-right': 'Landscape Right',
};

/** The same orientations as `devicectl device orientation set` names them. */
const ORIENTATION_DEVICECTL = {
  portrait: 'portrait',
  'portrait-upside-down': 'portraitUpsideDown',
  landscape: 'landscapeLeft',
  'landscape-left': 'landscapeLeft',
  'landscape-right': 'landscapeRight',
};

/** Whether the Xcode in use still has the Simulator app (Xcode 26 and before) rather than Device Hub. */
function hasSimulatorApp() {
  const dev = process.env.DEVELOPER_DIR
    || spawnSync('xcode-select', ['-p'], { encoding: 'utf8' }).stdout?.trim() || '';
  return fs.existsSync(path.join(dev, 'Applications', 'Simulator.app'));
}

/**
 * Wait for the Simulator to have a DEVICE WINDOW, not merely to be running.
 *
 * The menu bar exists the instant the app launches, and Device ▸ Orientation ▸ Landscape Left is
 * clickable while there is still nothing to rotate — so the click reports success and does nothing.
 * That is how this first failed: `open -a Simulator` followed by a one-second delay is plenty for a
 * warm app and nowhere near enough for a cold one, which made the bug look intermittent rather than
 * like a missing wait.
 */
async function awaitSimulatorWindow() {
  spawnSync('open', ['-a', 'Simulator'], { stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {
    const r = spawnSync('osascript', [
      '-e', 'tell application "System Events" to tell process "Simulator" to get name of every window',
    ], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) return;
    await sleep(500);
  }
  throw new Error('the Simulator never opened a device window, so its Device ▸ Orientation menu has nothing to act on.');
}

/**
 * Wait until the screen stops moving.
 *
 * A rotation is a relayout, and on a real interface that takes visibly longer than the turn itself.
 * Screenshotting too early yields a frame caught mid-flight — the list clipped, half the board
 * missing — which is a perfectly valid PNG of a state no player ever sees. Polling for two identical
 * framebuffers is better than any fixed sleep here: it is as fast as the device is, and it does not
 * silently become too short on a slower machine or a heavier screen.
 */
async function settleFrame(udid, outDir, { maxMs = 9000, display = null } = {}) {
  const probe = path.join(outDir, '.settle-probe.png');
  const t0 = Date.now();
  let last = null;
  try {
    while (Date.now() - t0 < maxMs) {
      // A phone that folds has two displays and simctl will not pick one, so the probe names the posture's.
      if (display) shootDisplay(udid, display, probe);
      else sh('xcrun', screenshotArgs(udid, probe));
      const now = fs.readFileSync(probe);
      if (last && last.equals(now)) return;
      last = now;
      await sleep(700);
    }
  } finally {
    fs.rmSync(probe, { force: true });
  }
}

/** A capture's pixels, RGBA. */
async function pixelsOf(file) {
  const img = await loadImage(file);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return { width: img.width, height: img.height, data: ctx.getImageData(0, 0, img.width, img.height).data };
}

/** How far apart two colours must be, in any channel, to count as different (in time and, for detail, in space). */
const STEP = 32;

/** The share of every 4th pixel whose colour moved by more than [STEP] in a channel between `a` and `b`. */
function colourShare(a, b) {
  const pa = a.data;
  const pb = b.data;
  let total = 0;
  let moved = 0;
  for (let y = 0; y < a.height; y += 4) {
    for (let x = 0; x < a.width; x += 4) {
      const i = (y * a.width + x) * 4;
      total++;
      if (Math.abs(pa[i] - pb[i]) > STEP || Math.abs(pa[i + 1] - pb[i + 1]) > STEP || Math.abs(pa[i + 2] - pb[i + 2]) > STEP) moved++;
    }
  }
  return total ? moved / total : 0;
}

/**
 * The share of the screen that differs between two captures: every 4th pixel, counted as different when
 * a channel moved by more than 32. Two shots of one launch screen come out near 0 (a swaying mark is a
 * percent or two); a launch screen against the app's first screen comes out at a large share of it.
 */
export async function screenDifference(fileA, fileB) {
  const [a, b] = await Promise.all([pixelsOf(fileA), pixelsOf(fileB)]);
  if (a.width !== b.width || a.height !== b.height) return 1;
  return colourShare(a, b);
}

/** A screen is cut into square tiles this many to its shorter side to find where it holds detail. */
const DETAIL_TILES = 64;

/**
 * Which tiles of a capture hold detail: a step of more than [STEP] in a channel between a pixel and the one 4 to
 * its right or below, looked for at every 4th pixel. A launch screen is flat ground and one mark, so only the mark's
 * tiles do, and a shift of the whole ground's colour changes none.
 */
function detailTiles(img) {
  const side = Math.max(1, Math.round(Math.min(img.width, img.height) / DETAIL_TILES));
  const across = Math.ceil(img.width / side);
  const tiles = new Uint8Array(across * Math.ceil(img.height / side));
  const p = img.data;
  for (let y = 0; y + 4 < img.height; y += 4) {
    for (let x = 0; x + 4 < img.width; x += 4) {
      const i = (y * img.width + x) * 4;
      const right = i + 16;
      const below = i + img.width * 16;
      for (let c = 0; c < 3; c++) {
        if (Math.abs(p[i + c] - p[right + c]) > STEP || Math.abs(p[i + c] - p[below + c]) > STEP) {
          tiles[Math.floor(y / side) * across + Math.floor(x / side)] = 1;
          break;
        }
      }
    }
  }
  return tiles;
}

/** The share of tiles that hold detail in one capture and not in the other. */
function detailShare(a, b) {
  const ta = detailTiles(a);
  const tb = detailTiles(b);
  let changed = 0;
  for (let k = 0; k < ta.length; k++) if (ta[k] !== tb[k]) changed++;
  return ta.length ? changed / ta.length : 0;
}

/**
 * How far a capture is from a launch frame: the larger of the share whose colour changed ([screenDifference]) and
 * the share of tiles whose detail changed ([detailShare]); both are read against [LAUNCH_LOOK].
 *
 * Colour alone missed a dark result card over a dimmed scene on a tablet (2064×2752): the scrim, the card and the
 * scene under them sit within 32 of the launch screen's dark ground, so only the card's words and buttons count, 3.6%,
 * and the drawn card was refused twice. Lowering the tolerance cannot help: two launch frames of that run differ by
 * 16 to 24 in the ground (0.4% apart at 24 or more, 99.9% at 16). Detail ignores the ground's colour and sees the words.
 *
 * Measured with this function on that run and an earlier one (10 launch frames, 10 shots), tiles of 1/64 of the
 * shorter side (32 px there) and a step over 32: the 36 pairs of launch frames within LAUNCH_LOOK of each other by
 * colour are at most 1.7% apart (a frame taken before its mark drew against one with it), and each of the 100 launch
 * frame and shot pairs is at least 8.3% apart, the lowest being the result card (colour 3.5%). Against a stand-in
 * launch screen (that ground and that mark, under each shot's own status bar) for 65 shots in 13 other sets (phones,
 * foldables, tablets, a 1920×1080 screen), the 4 shots under LAUNCH_LOOK by colour are 5.4 to 8.4% apart by detail
 * (lowest: a result card at 1920×1080), and the mark arriving on bare ground moves at most 3.4% (the mark at 1.5 times
 * its tablet size on a 1080-wide phone, over a third of its width). Only a 1024×600 screen went past 4%, where the
 * mark copied at its tablet pixels spans 43% of the shorter side and arrives at 4.6%: a launch mark that large on a
 * small screen could pass for a scene as it draws in.
 * The larger of the two shares is never under the colour share, so nothing the colour check let through is refused.
 * Two frames each the other's size turned are compared on their middle squares ([middle]); any other two sizes throw.
 */
export async function launchChange(fileA, fileB) {
  const [a, b] = await Promise.all([pixelsOf(fileA), pixelsOf(fileB)]);
  if (a.width === b.width && a.height === b.height) return changeOf(a, b);
  if (a.width === b.height && a.height === b.width) {
    const side = Math.min(a.width, a.height);
    return changeOf(middle(a, side), middle(b, side));
  }
  throw new Error(
    `the launch check cannot compare ${path.basename(fileA)} (${a.width}×${a.height}) with ${path.basename(fileB)} `
    + `(${b.width}×${b.height}): they are neither one size nor one size turned, so the screen changed size between them.`,
  );
}

function changeOf(a, b) {
  const byColour = colourShare(a, b);
  return byColour >= LAUNCH_LOOK ? byColour : Math.max(byColour, detailShare(a, b));
}

/**
 * The square of `side` in the middle of a capture. A turned screen's launch frame is shot as the app starts, before
 * the turn, and its shot after it; where the screenshot follows the device (Xcode 27's turn through devicectl), the
 * two come back upright and each the other's size turned. A launch screen lays its mark out in the middle either way
 * up, so the middle square of each is the same screen, and the status bar along the top is cut off the portrait one.
 * Turning a frame instead would lay its mark on its side.
 */
function middle(img, side) {
  const x0 = (img.width - side) >> 1;
  const y0 = (img.height - side) >> 1;
  const data = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < side; y++) {
    const from = ((y + y0) * img.width + x0) * 4;
    data.set(img.data.subarray(from, from + side * 4), y * side * 4);
  }
  return { width: side, height: side, data };
}

/** Under this share of changed pixels (and of changed detail, [launchChange]), a capture still shows what the screen showed at launch. */
export const LAUNCH_LOOK = 0.04;

/**
 * Wait until the screen no longer looks as it did just after the launch, so a state is never photographed
 * on its launch screen. A fixed `--settle` cannot promise that: the first launch after an install compiles
 * the app's shaders, and on a loaded machine that took longer than an 18 s settle, so one app's store shot
 * went to App Store Connect as a picture of the launch screen (2026-10-13), and a launch screen is not blank,
 * so nothing downstream noticed. `shoot(file)` photographs the screen.
 *
 * The frame just after the launch is not always the launch screen: a scene that draws in under 0.4 s is already
 * on it, and then "unchanged since the launch" is the scene at rest. So `known` holds the launch screens this run
 * has seen give way to a scene ([gaveWay]); a launch frame that looks like none of them, once there is one, is
 * the scene drawn at once and is shot without waiting. A state that never leaves its launch frame is not refused
 * here: [launchDifferences] judges it once the run has shot every state, against every launch screen it learnt.
 * Returns how long the state took to draw after the settle, and whether it was drawn by its first frame.
 */
async function awaitDrawn({ shoot, launchFrame, out, waitMs, known }) {
  const t0 = Date.now();
  shoot(out);
  if (known.length && !(await isLaunchScreen(launchFrame, known))) return { waited: 0, atOnce: true };
  for (;;) {
    if (await launchChange(launchFrame, out) >= LAUNCH_LOOK) return { waited: Date.now() - t0, atOnce: false };
    if (Date.now() - t0 >= waitMs) return { waited: 0, atOnce: false };
    await sleep(1000);
    shoot(out);
  }
}

/** Whether `frame` looks like one of `screens` (under [LAUNCH_LOOK] from it); with none, it may be one, so yes. */
async function isLaunchScreen(frame, screens) {
  for (const s of screens) if (await launchChange(s, frame) < LAUNCH_LOOK) return true;
  return screens.length === 0;
}

/**
 * The launch frames of a run's states whose shot changed from them: the launch screens it saw give way.
 * Each state is `{ state, frame, moved, atOnce }`: its launch frame, the share of its shot that differs from that
 * frame, and whether [awaitDrawn] took the frame for the scene itself (such a frame is never a launch screen).
 */
export function gaveWay(states) {
  return states.filter((s) => !s.atOnce && s.moved >= LAUNCH_LOOK).map((s) => s.frame);
}

/**
 * The launch check of a whole run, made once every state is shot, so the order of the states does not matter.
 * A state whose shot changed from its launch frame is measured against that frame, as before. A state whose shot
 * did not is the launch screen that stayed when its frame looks like a launch screen the run saw give way, or
 * when the run saw none: it throws, naming the state. Otherwise its frame was already the scene, and it is
 * measured against the nearest of those launch screens. Returns each state's `launchDifference` for the checker.
 * Limits: a run in which no state leaves a launch screen learns none, so every unchanged state is refused, as before;
 * and a first state drawn at once that then moves by [LAUNCH_LOOK] is taken for a launch screen that gave way.
 */
export async function launchDifferences(states, waitMs) {
  const known = gaveWay(states);
  const differences = [];
  for (const s of states) {
    if (await isLaunchScreen(s.frame, known)) {
      if (s.moved < LAUNCH_LOOK) {
        throw new Error(
          `${s.state}: after the settle and ${Math.round(waitMs / 1000)} s more the screen still looks as it did at launch `
          + `(${(s.moved * 100).toFixed(1)}% of it changed), so the app has not drawn this state. It is often the first launch `
          + 'after an install compiling its shaders: run the capture again, or raise --ready-wait (seconds).',
        );
      }
      differences.push(s.moved);
    } else {
      let least = 1;
      for (const k of known) least = Math.min(least, await launchChange(k, s.frame));
      differences.push(least);
    }
  }
  return differences;
}

/** Remove the launch frames a run kept in `outDir` for [launchDifferences]. */
function dropLaunchFrames(outDir) {
  for (const f of fs.readdirSync(outDir)) if (f.startsWith('.launch-') && f.endsWith('.png')) fs.rmSync(path.join(outDir, f), { force: true });
}

/**
 * Photograph the screen again [MOTION_GAP_MS] after a shot and return the share of it that changed: the checker's
 * `motion`, refused over the scene's allowance (`--motion`). A shot taken mid-transition, under a toast or while a
 * scroll comes to rest shows here, where the launch check (one look against the launch frame) cannot see it.
 */
async function motionAfter(shoot, out) {
  const again = path.join(path.dirname(out), `.motion-${path.basename(out)}`);
  try {
    await sleep(MOTION_GAP_MS);
    await shoot(again);
    return await screenDifference(out, again);
  } finally {
    fs.rmSync(again, { force: true });
  }
}

async function setSimOrientation(udid, orientation) {
  const item = ORIENTATION_MENU[orientation];
  if (!item) {
    throw new Error(`--orientation must be one of: ${Object.keys(ORIENTATION_MENU).join(', ')} (got "${orientation}").`);
  }
  if (!hasSimulatorApp()) {
    const r = spawnSync('xcrun', ['devicectl', 'device', 'orientation', 'set', '--device', udid, ORIENTATION_DEVICECTL[orientation]],
      { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`devicectl could not turn the simulator to ${orientation}: ${(r.stderr || r.stdout || '').trim()}`);
    return;
  }
  await awaitSimulatorWindow();
  const r = spawnSync('osascript', [
    '-e', 'tell application "Simulator" to activate',
    '-e', 'delay 1',
    '-e', `tell application "System Events" to tell process "Simulator" to click menu item "${item}" `
        + 'of menu 1 of menu item "Orientation" of menu 1 of menu bar item "Device" of menu bar 1',
  ], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(
      `could not reach the Simulator's Device ▸ Orientation ▸ ${item} menu: ${(r.stderr || '').trim()}\n`
      + '  Rotation goes through the Simulator UI because simctl cannot do it, so the terminal running\n'
      + '  zdymak needs System Settings ▸ Privacy & Security ▸ Accessibility.',
    );
  }
}

/**
 * Turn the device, and PROVE that it turned.
 *
 * A denied automation permission, a Simulator window that never came forward, a menu renamed in some
 * future Xcode — each of those fails by leaving the device exactly where it was, and each then yields
 * a complete set of perfectly valid PORTRAIT screenshots filed as landscape. That is this pipeline's
 * recurring failure shape: an asset wrong in a way nothing downstream can see. So the device is
 * driven to portrait first, then to the target, and the two framebuffers compared. Two orientations
 * of a real screen never match byte for byte.
 */
async function rotateSim(udid, orientation, outDir) {
  if (orientation === 'portrait') { await setSimOrientation(udid, 'portrait'); await settleFrame(udid, outDir); return; }
  const probe = path.join(outDir, '.orientation-probe.png');
  try {
    await setSimOrientation(udid, 'portrait');
    await settleFrame(udid, outDir);
    sh('xcrun', ['simctl', 'io', udid, 'screenshot', probe]);
    const before = fs.readFileSync(probe);
    await setSimOrientation(udid, orientation);
    await settleFrame(udid, outDir);
    sh('xcrun', ['simctl', 'io', udid, 'screenshot', probe]);
    if (before.equals(fs.readFileSync(probe))) {
      throw new Error(
        `the simulator did not turn — still portrait after asking for ${orientation}.\n`
        + '  The usual cause is the APP, not the tooling: iOS refuses an orientation the Info.plist does\n'
        + '  not list, and on iPad the key it reads is UISupportedInterfaceOrientations~ipad.',
      );
    }
  } finally {
    fs.rmSync(probe, { force: true });
  }
}

/**
 * Stand a raw framebuffer back up.
 *
 * Tests the shape rather than trusting the request: if some future simctl starts applying rotation
 * itself, the capture arrives correct and this does nothing, instead of helpfully laying it on its
 * side.
 */
async function uprightCapture(file, orientation) {
  if (!orientation || orientation === 'portrait') return;
  const img = await loadImage(file);
  const wantsLandscape = orientation.startsWith('landscape');
  if (wantsLandscape === (img.width > img.height)) return; // already the right way up
  const c = createCanvas(img.height, img.width);
  const ctx = c.getContext('2d');
  // Landscape Left leaves the interface's top along the framebuffer's RIGHT edge, Landscape Right
  // along its left; turning each the other way is what brings that edge back to the top.
  if (orientation === 'landscape-right') {
    ctx.translate(c.width, 0);
    ctx.rotate(Math.PI / 2);
  } else {
    ctx.translate(0, c.height);
    ctx.rotate(-Math.PI / 2);
  }
  ctx.drawImage(img, 0, 0);
  fs.writeFileSync(file, rgbPngBuffer(c));
}

/**
 * The UDID of the simulator named exactly `name` on the NEWEST runtime that has one. Installing a runtime gives
 * every model a second device of the same name, and simctl lists runtimes oldest first, so the first match was the
 * older iOS: a capture that should be on iOS 27 quietly ran on 26. Exact, because "iPhone 18 Pro" is a prefix of
 * "iPhone 18 Pro Max".
 */
function newestSimNamed(name) {
  let runtime = [];
  let best = null;
  for (const line of out2('xcrun', ['simctl', 'list', 'devices', 'available']).split('\n')) {
    const header = line.match(/^-- \S+ ([\d.]+) --/);
    if (header) {
      runtime = header[1].split('.').map(Number);
      continue;
    }
    const udid = line.trim().startsWith(`${name} (`) ? line.match(udidRe)?.[1] : null;
    if (udid && (!best || compareVersions(runtime, best.runtime) > 0)) best = { udid, runtime };
  }
  return best?.udid ?? null;
}

const compareVersions = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
};

/**
 * Find (or create) the iOS simulator a capture runs on, WITHOUT booting it: prefers --udid, then an already-booted
 * sim, then a device matching --device (default iPhone 18 Pro Max), creating one if needed. Returns
 * `{ udid, booted, created }` — the two booleans are the TEARDOWN receipt: they say what this process changes
 * (`booted`: whether it boots the sim, in `startIosSim`), so the cleanup can undo exactly that and leave a
 * simulator the user already had running exactly as they left it.
 *
 * Booting is a separate step so that `--build` runs first: a booted simulator holds ~1.7 GB, and beside a build
 * (Xcode, plus Gradle and Kotlin/Native for a Compose Multiplatform app) it ran an 8 GB Mac out of memory. The
 * build needs only the device's id.
 */
function resolveIosSim(flags) {
  if (flags.udid) {
    const wasBooted = out2('xcrun', ['simctl', 'list', 'devices', 'booted']).includes(flags.udid);
    return { udid: flags.udid, booted: !wasBooted, created: false };
  }
  if (!flags.device) {
    const booted = out2('xcrun', ['simctl', 'list', 'devices', 'booted']).match(udidRe);
    if (booted) return { udid: booted[1], booted: false, created: false }; // the user's own sim — leave it alone
  }
  const name = flags.device || 'iPhone 18 Pro Max';
  let created = false;
  let udid = newestSimNamed(name);
  if (!udid) {
    const devtype = out2('xcrun', ['simctl', 'list', 'devicetypes']).split('\n')
      .find((l) => l.trim().startsWith(`${name} (`))?.match(/(com\.apple[^\s)]+)/)?.[1];
    const runtime = out2('xcrun', ['simctl', 'list', 'runtimes', 'ios']).split('\n').reverse()
      .find((l) => /com\.apple[^\s)]+/.test(l))?.match(/(com\.apple[^\s)]+)/)?.[1];
    if (!devtype || !runtime) throw new Error(`Could not resolve a simulator for "${name}".`);
    udid = sh('xcrun', ['simctl', 'create', 'zdymak-capture', devtype, runtime]).trim();
    created = true;
  }
  return { udid, booted: true, created };
}

/** Boot what `resolveIosSim` found, unless it was already running, and wait until it has booted. */
function startIosSim({ udid, booted }) {
  if (!booted) return;
  spawnSync('xcrun', ['simctl', 'boot', udid], { stdio: 'ignore' });
  spawnSync('xcrun', ['simctl', 'bootstatus', udid, '-b'], { stdio: 'ignore' });
}

/**
 * Undo the setup. A capture run boots a simulator (~1.7GB resident), overrides its status bar and may
 * CREATE a throwaway device — leaving all three behind is how a machine ends up with a pile of booted
 * `zdymak-capture` sims and a permanently faked status bar. Only what this run changed is reverted;
 * `--keep` skips it when you want to inspect the device afterwards.
 */
function teardownIosSim({ udid, booted, created }, flags) {
  if (!udid || flags.keep) {
    if (flags.keep) console.log('  (--keep: simulator left booted)');
    return;
  }
  spawnSync('xcrun', ['simctl', 'status_bar', udid, 'clear'], { stdio: 'ignore' });
  if (!booted) return; // it was already running before us — not ours to shut down
  spawnSync('xcrun', ['simctl', 'shutdown', udid], { stdio: 'ignore' });
  if (created) spawnSync('xcrun', ['simctl', 'delete', udid], { stdio: 'ignore' });
  console.log(`  ↩ tore down the simulator${created ? ' (and deleted the temporary device)' : ''}`);
}

const simctlOk = () => spawnSync('xcrun', ['simctl', 'help'], { stdio: 'ignore' }).status === 0;

/**
 * Run the checker (checker.mjs) on a shot just taken, with what the device says right now kept beside it, and print
 * its refusals as they come. The run refuses them together at its end (`refuseShots`), so one run names every bad shot.
 */
async function checkCaptured(file, facts, flags) {
  writeFacts(file, facts);
  const r = await checkShot(file, { facts, text: flags['no-text'] === undefined });
  for (const x of r.refusals) console.log(`   ✗ ${path.basename(file)}: ${x.rule}: ${x.reason}`);
  return r;
}

/** Throw the checker's refusals (each shot's, and the set's: two scenes the same picture), one line per shot and reason; `--force` keeps the shots and only warns. */
async function refuseShots(results, flags) {
  await checkSet(results);
  const lines = describeRefusals(results);
  if (!lines.length) return;
  const msg = `the checker refused ${results.filter((r) => r.refusals.length).length} shot(s):\n  ${lines.join('\n  ')}`;
  if (flags.force !== undefined) console.warn(`⚠︎ ${msg}\n  (--force: the shots are kept)`);
  else throw new Error(msg);
}

async function captureIos(flags) {
  if (!simctlOk()) {
    // Common when xcode-select points at the CommandLineTools (no simctl): fall back to Xcode.app.
    const xc = '/Applications/Xcode.app/Contents/Developer';
    if (!process.env.DEVELOPER_DIR && fs.existsSync(xc)) process.env.DEVELOPER_DIR = xc;
    if (!simctlOk()) {
      throw new Error('xcrun/simctl unavailable — point DEVELOPER_DIR at Xcode (e.g. xcode-select -s /Applications/Xcode.app).');
    }
  }
  const outDir = path.resolve(flags.out || 'shots');
  fs.mkdirSync(outDir, { recursive: true });
  // --clean removes stale capture images first so the folder holds ONLY this run's screenshots; only loose PNG/MOV
  // files are cleared, never subfolders.
  if (flags.clean) {
    let cleared = 0;
    for (const f of fs.readdirSync(outDir)) {
      if (/\.(png|mov)$/i.test(f)) { fs.rmSync(path.join(outDir, f), { force: true }); cleared++; }
    }
    console.log(`🧹 cleaned ${cleared} stale capture(s) in ${path.relative(process.cwd(), outDir) || outDir}`);
  }

  if (flags.record !== undefined && !flags.states) {
    const out = path.join(outDir, `${flags.name || 'recording'}.mov`);
    console.log(`▶︎ Recording the booted iOS simulator → ${out}\n  Interact with the app, then press Ctrl-C to stop.`);
    const proc = spawn('xcrun', ['simctl', 'io', 'booted', 'recordVideo', '--codec=h264', '--force', out], { stdio: 'inherit' });
    await new Promise((res) => proc.on('close', res));
    console.log(`✓ Saved ${out}. Extract frames with: ffmpeg -i ${out} -vf fps=2 ${outDir}/frame-%03d.png`);
    return;
  }

  // FULL WORKFLOW: drive the app through screens by a launch-arg HANDLE, capturing each.
  //   zdymak capture --platform ios --bundle com.x.app --arg -screen --states a,b,c --suffix -light
  //     [--build --project X.xcodeproj --scheme S [--configuration Debug]] [--device "iPhone 18 Pro Max"] [--settle 3]
  if (flags.states) {
    if (!flags.bundle || !flags.arg) {
      throw new Error('state capture needs --bundle <id> and --arg <launch-handle> (e.g. -marketingScreen).');
    }
    const states = flags.states.split(',').map((s) => s.trim()).filter(Boolean);
    const suffix = flags.suffix || '';
    const settle = Number(flags.settle || 4);
    const sim = resolveIosSim(flags); // booted after the build, below
    const udid = sim.udid;
    let started = false;
    // A launch refusal keeps the launch frames, so the shares it judged can be measured from the files afterwards.
    let launchRefused = false;
    const orientation = (flags.orientation || 'portrait').toLowerCase();
    if (!ORIENTATION_MENU[orientation]) {
      throw new Error(`--orientation must be one of: ${Object.keys(ORIENTATION_MENU).join(', ')} (got "${flags.orientation}").`);
    }
    // A folding phone's posture (`fold.mjs`) is set with the hinge and orientation events Device Hub sends, and it
    // carries its own orientation: the Simulator menu turns the window, not the phone, so the two never mix.
    const posture = flags.posture !== undefined ? postureOf(flags.posture, flags.hinge) : null;
    if (posture && flags.orientation) throw new Error('--posture sets the orientation itself; drop --orientation.');
    /** Photograph the screen a still is taken of: the posture's display on a Duo, the screen otherwise. */
    const shoot = (file) => (posture ? shootPosture(udid, posture, file) : sh('xcrun', ['simctl', 'io', udid, 'screenshot', file]));
    // How long past the settle a state may take to leave its launch screen before the capture fails.
    const readyWait = Number(flags['ready-wait'] ?? 30);
    // Each still state's launch frame, kept to the run's end (see launchDifferences).
    const launches = [];
    try {
    let app = '';
    if (flags.build !== undefined) {
      if (!flags.project || !flags.scheme) throw new Error('--build needs --project <.xcodeproj> and --scheme <name>.');
      // ONE Xcode build folder per project: Xcode's own DerivedData, the same one `xcodebuild archive` and Xcode
      // itself use, so a capture reuses their work and leaves no copy behind. It used to be `<out>/.dd`, a fresh
      // 2–6 GB build in every output folder and every worktree; one repo collected 22 of them. --derived-data <dir>
      // still pins a folder for a caller that needs one.
      const { target, dd } = iosBuildArgs(flags, udid);
      console.log(`▶︎ Building ${flags.scheme} for the simulator (this is the slow step)…`);
      sh('xcodebuild', ['build', ...target, ...dd, '-allowProvisioningUpdates']);
      // Where that build put the app, from Xcode rather than from a guess at its folder layout.
      let settings = [];
      try { settings = JSON.parse(out2('xcodebuild', ['-showBuildSettings', '-json', ...target, ...dd])); } catch { /* reported below */ }
      const built = settings.map((t) => t.buildSettings ?? {}).find((b) => b.WRAPPER_EXTENSION === 'app') ?? {};
      app = built.TARGET_BUILD_DIR && built.WRAPPER_NAME ? path.join(built.TARGET_BUILD_DIR, built.WRAPPER_NAME) : '';
      if (!app || !fs.existsSync(app)) throw new Error(`xcodebuild built ${flags.scheme} but reported no .app (looked for ${app || 'TARGET_BUILD_DIR/WRAPPER_NAME'})`);
    }
    // Only now, with the build's memory given back, does the simulator boot.
    startIosSim(sim);
    started = true;
    if (app) {
      console.log(`▶︎ Installing ${path.basename(app)}…`);
      sh('xcrun', ['simctl', 'install', udid, app]);
    }

    // Apple's canonical marketing status bar: 9:41, full signal/wifi, FULL battery but NOT charging
    // (a charging bolt reads as a simulator override; Apple's own shots show an unplugged full battery).
    const pinStatusBar = () =>
      spawnSync('xcrun', ['simctl', 'status_bar', udid, 'override', '--time', '9:41',
        '--batteryState', 'discharging', '--batteryLevel', '100', '--cellularBars', '4', '--wifiBars', '3'], { stdio: 'ignore' });
    pinStatusBar();
    // The display the posture shows, which every screenshot of it names (null: a phone with one screen).
    let on = null;
    if (posture) {
      on = enterPosture(udid, posture);
      console.log(`▸ posture ${posture.name}: hinge ${posture.hinge}°, ${posture.orientation}, the ${posture.screen} screen (display ${on})`);
    }

    // --record turns each screen into a short CLIP (real motion) instead of a still. The app must move
    // during the window: pass the reel handle (default `-marketingReel`) so the harness auto-animates
    // (auto-flip the card, auto-scroll a list, reveal the paywall). The reel engine (`zdymak reel`) then
    // composites these clips on the matte. See SKILL/README "produce mode".
    const recording = flags.record !== undefined;
    const dur = Number(flags.duration || 3);
    const reelArg = flags['reel-arg'] || '-marketingReel';
    const verb = recording ? `Recording ${dur}s clips` : 'Driving';
    const langArgs = iosLanguageArgs(flags);
    if (langArgs.length) console.log(`▸ launching in ${flags.language} (AppleLocale ${langArgs[3]})`);
    console.log(`▶︎ ${verb} for ${states.length} screens via "${flags.arg} <id>" on ${flags.bundle}…`);
    const checked = [];
    const shot = [];
    for (const [i, st] of states.entries()) {
      spawnSync('xcrun', ['simctl', 'terminate', udid, flags.bundle], { stdio: 'ignore' });
      const launch = ['simctl', 'launch', udid, flags.bundle, ...langArgs, flags.arg, st];
      if (recording) launch.push(reelArg, 'YES'); // tell the harness to auto-animate this screen
      // Once more when launchd gave the app no process (seen right after a posture was reached; see launchApp).
      launchApp({
        launch: () => spawnSync('xcrun', launch, { encoding: 'utf8' }),
        ready: () => iosLaunchReady(out2('xcrun', ['simctl', 'spawn', udid, 'launchctl', 'list']), flags.bundle),
        log: (l) => console.log(l),
      });
      // What the screen shows as the app starts: its launch screen. The still below must differ from it.
      const launchFrame = recording ? null : path.join(outDir, `.launch-${st}.png`);
      if (launchFrame) { await sleep(400); shoot(launchFrame); }
      await sleep(settle * 1000);
      // Rotation is asked for AFTER the app is up, never before: iOS resolves an orientation request
      // against whatever is frontmost, so a device turned at the home screen springs back the moment
      // a portrait app launches into it. The expensive PROVEN turn runs once; later states only
      // re-assert, because a relaunch inherits the device's orientation and re-proving it every time
      // would flip the screen back and forth for no information.
      if (orientation !== 'portrait' && !posture) {
        if (i === 0) await rotateSim(udid, orientation, outDir);
        else { await setSimOrientation(udid, orientation); await settleFrame(udid, outDir); }
      }
      // Re-assert RIGHT BEFORE capture: a launch + the settle lets the sim re-sync the battery to the host
      // (a charging bolt creeps back on later screens). Re-pinning per screen keeps every shot clean.
      pinStatusBar();
      if (recording) {
        const out = path.join(outDir, `${st}${suffix}.mov`);
        // A folding phone records the screen that is on; simctl records one display at a time.
        const display = posture ? [`--display=${postureDisplay(displays(udid), posture)}`] : [];
        const rec = spawn('xcrun', ['simctl', 'io', udid, 'recordVideo', '--codec=h264', ...display, '--force', out], { stdio: 'ignore' });
        await sleep(dur * 1000);
        rec.kill('SIGINT'); // simctl finalizes the mp4/mov on SIGINT
        await new Promise((res) => rec.on('close', res));
        console.log(`   ✓ ${st}${suffix}.mov (${dur}s)`);
      } else {
        await sleep(500); // let the pinned bar paint before the screenshot
        const out = path.join(outDir, `${st}${suffix}.png`);
        const drawn = await awaitDrawn({ shoot, launchFrame, out, waitMs: readyWait * 1000, known: gaveWay(launches) });
        if (drawn.atOnce) console.log(`   … ${st} was drawn by its first frame`);
        if (drawn.waited > 0) {
          // It drew only now: let it come to rest, then take the shot again.
          console.log(`   … ${st} drew ${(drawn.waited / 1000).toFixed(1)} s after the settle`);
          await settleFrame(udid, outDir, { display: on });
          pinStatusBar();
          await sleep(500);
          shoot(out);
        }
        launches.push({ state: st, frame: launchFrame, moved: await launchChange(launchFrame, out), atOnce: drawn.atOnce });
        const motion = await motionAfter(shoot, out);
        if (!posture) await uprightCapture(out, orientation);
        await stripAlpha(out);
        console.log(`   ✓ ${st}${suffix}.png`);
        const facts = iosFacts({ udid, bundle: flags.bundle, language: flags.language, time: DEMO_TIME });
        shot.push({ out, facts: { ...facts, state: st, launchLook: LAUNCH_LOOK, motion, motionAllowed: motionAllowance(flags.motion, st) } });
      }
    }
    // How long a display's shots took, so the shot timeout can be read against a run that worked.
    if (posture && shotTimes.length) {
      console.log(`▸ ${shotTimes.length} shots of display ${on}, the slowest ${(Math.max(...shotTimes) / 1000).toFixed(1)} s`);
    }
    // The launch check is the run's, once every state is shot: what the launch screen looks like is learnt from them.
    const differences = await launchDifferences(launches, readyWait * 1000).catch((e) => {
      launchRefused = true;
      throw new Error(`${e.message}\n  The launch frames are kept beside the shots (.launch-<state>.png) to measure against them.`);
    });
    for (const [k, s] of shot.entries()) checked.push(await checkCaptured(s.out, { ...s.facts, launchDifference: differences[k] }, flags));
    await refuseShots(checked, flags);
    console.log(`Done → ${outDir}`);
    } finally {
      // Always: a thrown build/launch error must not strand a booted sim with a faked status bar —
      // nor one lying on its side. A simulator the user already had running is handed back the way
      // they left it, and orientation is part of "the way they left it".
      if (started && orientation !== 'portrait') { try { await setSimOrientation(udid, 'portrait'); } catch { /* teardown */ } }
      if (started && posture) leavePosture(udid);
      teardownIosSim(sim, flags);
      if (!launchRefused) dropLaunchFrames(outDir);
    }
    return; // the workflow is DONE — falling through would try to snap a sim that was just torn down
  }

  // Single snapshot of whatever is on the booted sim.
  const out = path.join(outDir, `${flags.name || 'shot'}.png`);
  const snap = (file) => sh('xcrun', ['simctl', 'io', 'booted', 'screenshot', file]);
  snap(out);
  const motion = await motionAfter(snap, out);
  await stripAlpha(out);
  console.log(`✓ ${out}  (alpha stripped, store-ready)`);
  const facts = iosFacts({ udid: 'booted', bundle: flags.bundle, language: flags.language, time: DEMO_TIME });
  const scene = flags.name || 'shot';
  await refuseShots([await checkCaptured(out, { ...facts, motion, motionAllowed: motionAllowance(flags.motion, scene) }, flags)], flags);
}

/** Toggle Android SystemUI Demo Mode → a clean, Play-native status bar (Google's own convention):
 *  pinned clock, full battery UNPLUGGED (no charging), full signal, notifications hidden.
 *
 *  Two non-obvious details, both learned the hard way from shipped-looking assets:
 *  - `fully true` marks the connection INTERNET-VALIDATED. Without it SystemUI badges every
 *    signal icon with a "!" (connected, no internet) — which reads as a broken phone on a
 *    store screenshot, and is easy to miss until you zoom in.
 *  - `wifi show` populates BOTH the legacy and the modern wifi slot on API 34 emulators, so the
 *    bar renders TWO wifi icons. Until that is per-image detectable, wifi stays hidden and the
 *    mobile bars carry the "connected" read: one signal icon, no duplicate. Pass `--wifi` to
 *    show it anyway (fine on a real device, where the duplicate does not happen). */
function androidDemo(on, flags) {
  const b = (...args) => spawnSync('adb', ['shell', 'am', 'broadcast', '-a', 'com.android.systemui.demo', ...args], { stdio: 'ignore' });
  if (!on) return void b('-e', 'command', 'exit');
  spawnSync('adb', ['shell', 'settings', 'put', 'global', 'sysui_demo_allowed', '1'], { stdio: 'ignore' });
  b('-e', 'command', 'exit'); // drop stale slots from an earlier run before re-entering
  b('-e', 'command', 'enter');
  b('-e', 'command', 'clock', '-e', 'hhmm', (flags.time || '09:41').replace(':', ''));
  b('-e', 'command', 'battery', '-e', 'level', '100', '-e', 'plugged', 'false'); // full, NOT charging
  const wifi = flags.wifi !== undefined ? 'show' : 'hide';
  b('-e', 'command', 'network', '-e', 'wifi', wifi, '-e', 'level', '4', '-e', 'fully', 'true');
  b('-e', 'command', 'network', '-e', 'mobile', 'show', '-e', 'datatype', 'none', '-e', 'level', '4', '-e', 'fully', 'true');
  b('-e', 'command', 'notifications', '-e', 'visible', 'false');
}

/**
 * Android's compatibility UI off: the window manager shell draws a letterbox education dialog ("See and do more"),
 * reachability hints and an aspect-ratio button over an app it letterboxes, the first time it does. On a large screen
 * that can be any app at one of its sizes, and the dialog is not a window (see checker-device.mjs
 * parseAndroidOverlays), so nothing short of turning it off keeps it out of a shot. Each flag is its own call:
 * `wm set-letterbox-style` reads its options in one loop and stops at the first one a release does not know.
 * Source: AOSP frameworks/base services/core/java/com/android/server/wm/WindowManagerShellCommand.java
 * (runSetLetterboxStyle; its help: "--isEducationEnabled … Whether education is allowed for letterboxed fullscreen
 * apps", "--isHorizontalReachabilityEnabled", "--isVerticalReachabilityEnabled",
 * "--isUserAppAspectRatioSettingsEnabled"). The values live in the window manager's memory (AppCompatConfiguration),
 * so a reboot, or `adb shell wm reset-letterbox-style`, gives them back; like demo mode's permission, they are left
 * set after the run, because a caller may launch the app again between captures. A release without the command
 * (before Android 12) refuses it, and that is ignored: it has no such UI either.
 */
function androidQuietCompat() {
  for (const option of ['--isEducationEnabled', '--isHorizontalReachabilityEnabled', '--isVerticalReachabilityEnabled', '--isUserAppAspectRatioSettingsEnabled']) {
    spawnSync('adb', ['shell', 'wm', 'set-letterbox-style', option, 'false'], { stdio: 'ignore' });
  }
}

async function captureAndroid(flags) {
  if (spawnSync('adb', ['version'], { stdio: 'ignore' }).status !== 0) {
    throw new Error('adb not found — install Android platform-tools and connect a device/emulator.');
  }
  const outDir = path.resolve(flags.out || 'shots');
  fs.mkdirSync(outDir, { recursive: true });
  // --clean removes stale capture images first so the folder holds ONLY this run's screenshots; only loose PNG/MOV
  // files are cleared, never subfolders.
  if (flags.clean) {
    let cleared = 0;
    for (const f of fs.readdirSync(outDir)) {
      if (/\.(png|mov)$/i.test(f)) { fs.rmSync(path.join(outDir, f), { force: true }); cleared++; }
    }
    console.log(`🧹 cleaned ${cleared} stale capture(s) in ${path.relative(process.cwd(), outDir) || outDir}`);
  }

  // Free-form: record whatever the operator does, until Ctrl-C. No states to drive, so none of the
  // trim/hold post-processing below applies — you get the raw capture.
  if (flags.record !== undefined && !flags.states) {
    const remote = '/sdcard/zdymak-rec.mp4';
    const out = path.join(outDir, `${flags.name || 'recording'}.mp4`);
    console.log(`▶︎ Recording the device → ${out}\n  Interact with the app, then press Ctrl-C to stop.`);
    const proc = spawn('adb', ['shell', 'screenrecord', remote], { stdio: 'inherit' });
    await new Promise((res) => proc.on('SIGINT', res).on('close', res));
    sh('adb', ['pull', remote, out]);
    console.log(`✓ Saved ${out}. Extract frames with: ffmpeg -i ${out} -vf fps=2 ${outDir}/frame-%03d.png`);
    return;
  }

  const shoot = (file) => {
    const b = spawnSync('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 });
    if (b.status !== 0) throw new Error(`adb screencap failed: ${b.stderr}`);
    const { png, note } = pngFromScreencap(b.stdout);
    if (note && !shoot.noted) { shoot.noted = true; console.log(`   (screencap: ${note.split('\n')[0].slice(0, 120)})`); }
    fs.writeFileSync(file, png);
  };
  const grab = async (file) => {
    shoot(file);
    await stripAlpha(file);
  };
  const pkg = flags.package || (flags.component ? String(flags.component).split('/')[0] : null);
  const time = flags.time || DEMO_TIME;
  const facts = () => androidFacts({ pkg, language: flags.language, time });

  // The display override goes on FIRST, demo mode second — and even that is not enough on its own.
  //
  // `wm size` / `wm density` restart SystemUI, and a SystemUI restart DROPS demo mode. Entering demo
  // first and relayouting second pins 09:41 onto a status bar that is about to be thrown away, so the
  // capture ships with the wall clock on it. Doing it in this order narrows the window but does not
  // close it: the restart is asynchronous, so a demo broadcast sent immediately after `wm size` can
  // still land on the SystemUI that is on its way out. `recordAndroidStates` therefore RE-PINS the bar
  // right before the recorder rolls, which is the assertion that actually holds.
  //
  // It fails silently in the worst way: every adb broadcast returns success, the run is green, and the
  // only tell is the time in the corner of a finished asset. `--size`/`--density` is exactly the store
  // VIDEO path (Play wants 1080x1920), which is why this hit the promo and never the screenshots.
  // A foldable's posture first (it can change the screen: a closed book fold shows its outer one), then the turn,
  // read against the screen the posture left on, then the display override. Torn down in reverse.
  const posture = flags.posture !== undefined ? androidPostureOf(flags.posture, flags.hinge) : null;
  const orientation = flags.orientation !== undefined ? String(flags.orientation).toLowerCase() : null;
  if (orientation && flags.size) throw new Error('--orientation turns the screen and --size sets its shape; use one.');
  const folded = posture ? enterAndroidPosture(posture) : null;
  if (posture) console.log(`▸ posture ${posture.name}: hinge ${posture.hinge}°, the device reports ${posture.state}`);
  let turned = null;
  try { turned = orientation ? turnAndroid(orientation) : null; } catch (e) { leaveAndroidPosture(folded); throw e; }
  if (turned) { console.log(`▸ ${orientation}: user rotation ${turned.rotation}`); await sleep(1500); }
  /** A shot whose shape is not the orientation asked for is refused: the app or the device did not turn. */
  const checkShape = (file) => {
    if (!orientation) return;
    const head = fs.readFileSync(file).subarray(16, 24);
    const w = head.readUInt32BE(0);
    const h = head.readUInt32BE(4);
    if (!shapeMatches(orientation, w, h)) {
      throw new Error(`${path.basename(file)} is ${w}×${h}, but ${orientation} was asked for: the screen did not turn.`);
    }
  };
  const display = androidDisplay(flags);
  androidDemo(true, flags); // clean marketing status bar (Google convention)
  androidQuietCompat(); // no letterbox education dialog over the app
  const language = androidLanguage(flags); // per-app locale override; reset in the finally below
  try {
    // Full workflow: drive the app through screens via an intent-extra HANDLE (--component + --arg).
    if (flags.states) {
      if (!flags.component || !flags.arg) {
        throw new Error('android state capture needs --component <pkg/activity> and --arg <extra-key>.');
      }
      const states = flags.states.split(',').map((s) => s.trim()).filter(Boolean);
      const suffix = flags.suffix || '';
      const settle = Number(flags.settle || 4);
      if (flags.record !== undefined) {
        await recordAndroidStates(states, suffix, outDir, flags);
      } else {
        console.log(`▶︎ Driving ${states.length} screens via "--es ${flags.arg} <id>" on ${flags.component}…`);
        const readyWait = Number(flags['ready-wait'] ?? 30);
        const checked = [];
        const launches = [];
        const shot = [];
        for (const st of states) {
          // A cold start per state, as iOS terminates and relaunches: the state's extra is read where the app
          // starts, and the frame just after the start is what "still the launch screen" is measured against.
          spawnSync('adb', ['shell', 'am', 'force-stop', pkg], { stdio: 'ignore' });
          sh('adb', ['shell', 'am', 'start', '-n', flags.component, '--es', flags.arg, st]);
          const launchFrame = path.join(outDir, `.launch-${st}.png`);
          await sleep(400);
          shoot(launchFrame);
          await sleep(settle * 1000);
          const out = path.join(outDir, `${st}${suffix}.png`);
          const drawn = await awaitDrawn({ shoot, launchFrame, out, waitMs: readyWait * 1000, known: gaveWay(launches) });
          if (drawn.atOnce) console.log(`   … ${st} was drawn by its first frame`);
          if (drawn.waited > 0) {
            console.log(`   … ${st} drew ${(drawn.waited / 1000).toFixed(1)} s after the settle`);
            await sleep(2000);
            shoot(out);
          }
          launches.push({ state: st, frame: launchFrame, moved: await launchChange(launchFrame, out), atOnce: drawn.atOnce });
          const motion = await motionAfter(shoot, out);
          await stripAlpha(out);
          checkShape(out);
          console.log(`   ✓ ${st}${suffix}.png`);
          shot.push({ out, facts: { ...facts(), state: st, launchLook: LAUNCH_LOOK, motion, motionAllowed: motionAllowance(flags.motion, st) } });
        }
        const differences = await launchDifferences(launches, readyWait * 1000);
        for (const [k, s] of shot.entries()) checked.push(await checkCaptured(s.out, { ...s.facts, launchDifference: differences[k] }, flags));
        await refuseShots(checked, flags);
      }
      console.log(`Done → ${outDir}`);
    } else {
      // The demo broadcasts above land ASYNCHRONOUSLY, and androidDemo re-enters demo mode from scratch (exit,
      // enter, then the slots), so a screencap taken at once can catch SystemUI mid-redraw. Niva's Play phone set,
      // one `--name` shot per state, came out with the network icon as the live "3G", white on a light bar, or
      // missing, shot to shot (2026-10-12). Give the bar a moment, as the state loop's settle already does.
      await sleep(Number(flags['bar-settle'] ?? 1500));
      const out = path.join(outDir, `${flags.name || 'shot'}.png`);
      await grab(out);
      const motion = await motionAfter(grab, out);
      checkShape(out);
      console.log(`✓ ${out}  (alpha stripped, store-ready)`);
      const scene = flags.name || 'shot';
      await refuseShots([await checkCaptured(out, { ...facts(), motion, motionAllowed: motionAllowance(flags.motion, scene) }, flags)], flags);
    }
  } finally {
    dropLaunchFrames(outDir);
    // Teardown in reverse: leave demo mode while the override is still on, THEN restore the display.
    // Resetting size first restarts SystemUI and takes demo mode with it, so the `exit` broadcast
    // lands on a bar that never entered — harmless today, but it leaves the emulator's demo state
    // decided by a race rather than by this function.
    language.reset();
    androidDemo(false, flags);
    display.reset();
    turned?.reset();
    leaveAndroidPosture(folded);
  }
}

/**
 * Optional display override, e.g. `--size 1080x1920 --density 400`.
 *
 * WHY this matters for video: a phone panel is usually TALLER than the store's video spec (a Pixel is
 * 1080×2400; `play-promo` wants 1080×1920). Overriding the display makes the app RELAYOUT to the target
 * aspect, so `screenrecord` emits the exact spec with nothing cropped. Cropping a 2400-tall capture down
 * to 1920 instead silently guillotines whatever sits at the bottom of the screen — usually the primary
 * buttons. Always reset, or the device is left in a wrong-sized state after the run.
 */
function androidDisplay(flags) {
  const wm = (...args) => spawnSync('adb', ['shell', 'wm', ...args], { stdio: 'ignore' });
  let changed = false;
  if (flags.size) {
    if (!/^\d+x\d+$/.test(flags.size)) throw new Error(`--size must look like 1080x1920 (got "${flags.size}")`);
    wm('size', flags.size);
    changed = true;
  }
  if (flags.density) { wm('density', String(flags.density)); changed = true; }
  if (changed) console.log(`▶︎ Display override ${flags.size || '(size unchanged)'} @ ${flags.density || 'default'}dpi`);
  return {
    reset() {
      if (!changed || flags.keep !== undefined) return;
      wm('size', 'reset');
      wm('density', 'reset');
    },
  };
}

/** Mean luma per sample via ffmpeg signalstats — the cheapest reliable "what is on screen" signal. */
function lumaSeries(file, fps = 4) {
  const r = spawnSync(process.env.FFMPEG || 'ffmpeg',
    ['-v', 'error', '-i', file, '-vf', `fps=${fps},scale=64:-1,signalstats,metadata=print:file=-`, '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = [];
  for (const line of (r.stdout || '').split('\n')) {
    const m = line.match(/lavfi\.signalstats\.YAVG=([\d.]+)/);
    if (m) out.push({ t: out.length / fps, y: Number(m[1]) });
  }
  return out;
}

/**
 * Where the app's content actually appears, in seconds.
 *
 * A driven recording always opens on junk: the launcher, then the app's blank window while it starts.
 * Content arrives as a sustained BRIGHTNESS STEP — so take the first sample that jumps well clear of the
 * darkest frame so far and then holds steady. Heuristic by nature: an app that paints DARKER than the
 * launcher defeats it, which is what `--trim <seconds>` is for. Returns 0 when nothing convincing is found
 * (better to ship a slightly long clip than to cut into the app).
 */
function detectContentStart(series, maxHead = 12) {
  const win = series.filter((s) => s.t <= maxHead);
  if (win.length < 6) return 0;
  let floor = win[0].y;
  for (let i = 1; i < win.length - 3; i++) {
    floor = Math.min(floor, win[i].y);
    const step = win[i].y >= floor * 1.25 && win[i].y - floor > 8;
    if (!step) continue;
    const steady = [1, 2, 3].every((k) => Math.abs(win[i + k].y - win[i].y) <= win[i].y * 0.08);
    if (steady) return Math.max(0, win[i].t - 0.15); // a hair early, to catch the fade-in
  }
  return 0;
}

/**
 * Record each driven state to its own clip.
 *
 * Three things here are not obvious, and each one silently ruins a take:
 *  - WARM RELAUNCH. A cold start burns 5-6s of blank window into the clip. So the app is started once to
 *    warm the process, then re-entered with `--activity-multiple-task` — a plain re-`am start` is
 *    delivered to the existing instance via onNewIntent and would NOT re-run the state.
 *  - THE RECORDER STOPS ON IDLE. `screenrecord` stops emitting once the screen goes static, so a clip that
 *    ends on a settled screen is cut off right there. `--hold` clones that final frame back in — faithful,
 *    since the app genuinely sits on it.
 *  - THE HEAD IS JUNK. See detectContentStart; `--trim` overrides it.
 */
async function recordAndroidStates(states, suffix, outDir, flags) {
  const limit = Math.min(180, Number(flags.duration || 60)); // screenrecord caps at 180s
  const hold = Number(flags.hold ?? 1.5);
  const fps = Number(flags.fps || 30);
  const warm = Number(flags.settle || 4);
  const ff = process.env.FFMPEG || 'ffmpeg';
  console.log(`▶︎ Recording ${states.length} screen(s) via "--es ${flags.arg} <id>" on ${flags.component}…`);

  for (const st of states) {
    const remote = `/sdcard/zdymak-${st}.mp4`;
    const raw = path.join(outDir, `${st}${suffix}.raw.mp4`);
    const out = path.join(outDir, `${st}${suffix}.mp4`);
    spawnSync('adb', ['shell', 'rm', '-f', remote], { stdio: 'ignore' });

    // Warm the process so the recorded take is not a cold start.
    spawnSync('adb', ['shell', 'am', 'force-stop', flags.component.split('/')[0]], { stdio: 'ignore' });
    sh('adb', ['shell', 'am', 'start', '-n', flags.component, '--es', flags.arg, st]);
    await sleep(warm * 1000);

    // Re-pin the marketing bar immediately before the take, the way the iOS path does. Demo mode is
    // entered once at the top of captureAndroid, but a `--size`/`--density` override restarts SystemUI
    // and takes demo mode with it — asynchronously, so it can outlive the broadcast that set it. By
    // the time the recorder rolls the bar may be back to the wall clock, and nothing downstream can
    // tell: the video is valid, the run is green, and the only symptom is the time in the corner.
    // Four broadcasts here make the pin independent of the restart's timing.
    androidDemo(true, flags);
    await sleep(400); // let the re-pinned bar repaint before the first recorded frame

    const rec = spawn('adb', ['shell', 'screenrecord', '--bit-rate', String(flags.bitrate || 20000000),
      '--time-limit', String(limit), remote], { stdio: 'ignore' });
    await sleep(1000);
    sh('adb', ['shell', 'am', 'start', '-n', flags.component, '--activity-multiple-task', '--es', flags.arg, st]);
    await new Promise((res) => rec.on('close', res)); // ends at --time-limit or when the screen idles
    sh('adb', ['pull', remote, raw]);
    spawnSync('adb', ['shell', 'rm', '-f', remote], { stdio: 'ignore' });

    const trim = flags.trim !== undefined ? Number(flags.trim) : detectContentStart(lumaSeries(raw));
    const chain = [`fps=${fps}`, 'format=yuv420p'];
    if (hold > 0) chain.push(`tpad=stop_mode=clone:stop_duration=${hold}`);
    const args = ['-v', 'error', '-y'];
    if (trim > 0) args.push('-ss', String(trim.toFixed(2)));
    args.push('-i', raw, '-an', '-vf', chain.join(','),
      '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.0', '-preset', 'slow', '-crf', '18',
      '-movflags', '+faststart', out);
    const enc = spawnSync(ff, args, { encoding: 'utf8' });
    if (enc.status !== 0) throw new Error(`ffmpeg failed on ${st}: ${(enc.stderr || '').trim()}`);
    if (flags['keep-raw'] === undefined) fs.rmSync(raw, { force: true });
    console.log(`   ✓ ${st}${suffix}.mp4  (head trimmed ${trim.toFixed(2)}s, held ${hold}s)`);
  }
}

/**
 * Platform dispatch. NOTE — there is intentionally NO `--platform macos` capture:
 *
 * macOS has no `simctl io screenshot` / `adb screencap` equivalent for snapshotting a *driven* app.
 * Reading a specific native window's pixels requires a macOS TCC permission grant — either **Screen
 * Recording** (for the `screencapture` CLI, which otherwise returns black frames) or **Accessibility**
 * (to drive the UI + use XCUITest's own screenshot). Neither is a clean one-command capture like the
 * mobile SDKs give us.
 *
 * The robust, TCC-correct way to capture a Mac app's marketing screens is an **XCUITest** run on the
 * native-macOS build that drives the same launch-arg handle (`-marketingScreen <id>`) and saves each
 * screen as an **XCTAttachment** — the sandboxed Mac test-runner can't write PNGs into your repo — then
 * exports them from the `.xcresult`. That lives project-side (a `Scripts/capture-mac.sh` in your own
 * repo, which owns the one-time Accessibility grant + signing). zdymak still **composes** the Mac
 * screenshots/reels from those captures (premium/bleed at 2880×1800, etc.).
 *
 * Folding that xcodebuild-test + xcresult-export flow into zdymak would just wrap an app-specific test
 * with no real gain; a `screencapture` path would need a *second* TCC grant and is fragile. So Mac
 * capture is deliberately left to the project's XCUITest script; zdymak captures iOS/Android/web (clean
 * CLI) and composes every platform.
 */
export async function runCapture(flags) {
  const platform = flags.platform;
  if (platform === 'ios') return captureIos(flags);
  if (platform === 'android') return captureAndroid(flags);
  if (platform === 'web') return captureWeb(flags, { stripAlpha, sleep });
  if (platform === 'macos' || platform === 'mac') {
    throw new Error('macOS capture is intentionally out of scope (see the note above runCapture): use an XCUITest capture (e.g. Scripts/capture-mac.sh) that drives the launch-arg handle + exports .xcresult attachments, then `zdymak build` composes the Mac assets.');
  }
  throw new Error('capture needs --platform ios|android|web. For ios/android boot a simulator/emulator (or connect a device) first, then run a single --name <screen> or the full-workflow form (--bundle --arg --states); for web pass --url (+ --states).');
}
