/**
 * The iPhone Duo's postures, set by script on its simulator (Xcode 27.1+).
 *
 * A folding phone is not one screen held two ways but six layouts: closed (the outer screen, iOS's
 * status COLUMN down its right edge), closed and turned, open flat on its side (the inner screen,
 * wide like a book), open upright, and half open like a book or like a laptop, where iOS reserves the
 * fold itself. An app that adapts to each needs a picture of each, and none of them can be reached
 * with simctl: it has no hinge command, `devicectl device orientation set` reports success and
 * changes nothing, and the Simulator's own rotation menu turns the window, not the phone.
 *
 * What does work is the event Xcode's Device Hub sends, posted from inside the simulator by the
 * helper vendored in `vendor/duoctl` (MIT): `hinge <degrees>`, `hinge-sweep <from> <to> <seconds>`,
 * `orientation <value>`. It is compiled here on first use and cached by the hash of its source.
 *
 * Measured on the iOS 27.1 simulator (2026-10-13), and the reasons for every step below:
 *  - The inner screen switches on between 120° and 135° while OPENING, and stays on while CLOSING
 *    down to about 30°. So a half-open posture is reached by opening flat first and folding back, as
 *    a hand does — straight to 110° from closed would leave the outer screen on.
 *  - The orientation is set while the phone is flat, then the fold: the same order Device Hub's own
 *    controls take, and the one that left the app laid out for the posture every time.
 *  - `simctl io screenshot` without `--display` takes the outer screen even while it is off (a black
 *    image), and WITH the display of a screen that is off it waits forever. So the active display is
 *    read from devicectl before every shot, and the shot has a timeout.
 *  - A screenshot comes out the shape the screen is showing (no standing it back up, unlike a turned
 *    iPad), so its shape is the check that the posture took: an app that refuses landscape stays
 *    portrait, and that is refused here rather than filed as a landscape shot.
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = fileURLToPath(new URL('../../vendor/duoctl/duoctl-helper.m', import.meta.url));

/** Half open, by default: past the point where iOS calls it partly open, short of flat. */
export const HALF_OPEN = 110;

/**
 * Each posture: the hinge angle, the device orientation, which screen is on, and the shape a capture
 * of it must have. `wide` is the screen as the user sees it — the open phone held like a book is wide.
 */
export const POSTURES = {
  closed: { hinge: 0, orientation: 'portrait', screen: 'outer', wide: false },
  'closed-turned': { hinge: 0, orientation: 'landscape-left', screen: 'outer', wide: true },
  'closed-turned-right': { hinge: 0, orientation: 'landscape-right', screen: 'outer', wide: true },
  open: { hinge: 180, orientation: 'portrait', screen: 'inner', wide: true },
  'open-upright': { hinge: 180, orientation: 'landscape-left', screen: 'inner', wide: false },
  'half-book': { hinge: HALF_OPEN, orientation: 'portrait', screen: 'inner', wide: true },
  'half-laptop': { hinge: HALF_OPEN, orientation: 'landscape-left', screen: 'inner', wide: false },
};

/** The posture a flag names, with `--hinge` overriding a half-open angle. Throws on an unknown name. */
export function postureOf(name, hinge) {
  const p = POSTURES[String(name).toLowerCase()];
  if (!p) throw new Error(`--posture must be one of: ${Object.keys(POSTURES).join(', ')} (got "${name}").`);
  if (hinge === undefined || p.hinge === 0 || p.hinge === 180) return { name: String(name).toLowerCase(), ...p };
  const angle = Number(hinge);
  // Below about 30° the inner screen goes off, and above 135° iOS reads it as flat.
  if (!(angle >= 35 && angle <= 130)) throw new Error(`--hinge must be between 35 and 130 degrees for a half-open posture (got ${hinge}).`);
  return { name: String(name).toLowerCase(), ...p, hinge: angle };
}

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** The compiled helper, built on first use for the simulator and ad-hoc signed. */
export function helperPath() {
  const source = fs.readFileSync(SOURCE);
  const hash = crypto.createHash('sha256').update(source).digest('hex').slice(0, 12);
  const dir = path.join(os.homedir(), 'Library', 'Caches', 'zdymak');
  const bin = path.join(dir, `duoctl-helper-${hash}`);
  if (fs.existsSync(bin)) return bin;
  fs.mkdirSync(dir, { recursive: true });
  const cc = run('xcrun', ['-sdk', 'iphonesimulator', 'clang', '-fobjc-arc', '-O2', '-arch', 'arm64',
    '-mios-simulator-version-min=17.0', '-framework', 'Foundation', '-framework', 'IOKit', SOURCE, '-o', bin]);
  if (cc.status !== 0) throw new Error(`could not compile the Duo helper for the simulator (needs Xcode 27.1+):\n${cc.stderr}`);
  const sign = run('codesign', ['-f', '-s', '-', bin]);
  if (sign.status !== 0) throw new Error(`could not sign the Duo helper: ${sign.stderr}`);
  return bin;
}

/** The simulator's displays, from devicectl: `[{ id, active }]`. A phone that folds has two or more. */
export function displays(udid) {
  const out = run('xcrun', ['devicectl', 'device', 'info', 'displays', '--device', udid]).stdout ?? '';
  return out.split('\n').map((line) => line.match(/▿ (\d+):/) && { id: line.match(/▿ (\d+):/)[1], active: line.includes('(active)') })
    .filter(Boolean);
}

/** The id of the screen that is on, or null. */
export const activeDisplay = (udid) => displays(udid).find((d) => d.active)?.id ?? null;

/**
 * The display that is on once the screens stop changing: two reads a second apart that agree. A fold
 * hands the picture from one screen to the other over a second or more, and on a simulator just booted
 * longer, so a single read straight after the hinge moves can name the screen that is going off.
 */
function settledDisplay(udid, maxMs = 12000) {
  const t0 = Date.now();
  let last = activeDisplay(udid);
  while (Date.now() - t0 < maxMs) {
    pause(1000);
    const now = activeDisplay(udid);
    if (now && now === last) return now;
    last = now;
  }
  return last;
}

/** Send the helper one command inside the simulator. */
function helper(udid, bin, ...args) {
  const r = run('xcrun', ['simctl', 'spawn', udid, bin, ...args]);
  if (r.status !== 0) throw new Error(`the Duo helper refused "${args.join(' ')}": ${(r.stderr || r.stdout || '').trim()}`);
}

/**
 * Put the phone in a posture: closed for the outer screen, or flat first and then folded back for a
 * half-open one (see the file comment). Returns the display that is on, and refuses if the screen
 * that should be on is not — the outer display's id is learned by closing the phone once.
 */
export function enterPosture(udid, posture) {
  const bin = helperPath();
  if (displays(udid).length < 2) throw new Error('--posture needs a phone that folds (the iPhone Duo simulator, Xcode 27.1+); this simulator has one screen.');
  helper(udid, bin, 'hinge', '0');
  const outer = settledDisplay(udid);
  if (posture.screen === 'outer') {
    helper(udid, bin, 'orientation', posture.orientation);
    pause(2000);
  } else {
    helper(udid, bin, 'hinge-sweep', '0', '180', '0.6');
    pause(2000);
    helper(udid, bin, 'orientation', posture.orientation);
    pause(2000);
    if (posture.hinge !== 180) {
      helper(udid, bin, 'hinge-sweep', '180', String(posture.hinge), '0.8');
      pause(3000);
    }
  }
  const on = settledDisplay(udid);
  if (!on) throw new Error(`no screen is on after setting ${posture.name} — devicectl reports no active display.`);
  if ((posture.screen === 'inner') === (on === outer)) {
    throw new Error(`${posture.name} wants the ${posture.screen} screen on, but display ${on} is the one that is.`);
  }
  return on;
}

/** Hand the simulator back closed and upright, the way it boots. Never throws: this is teardown. */
export function leavePosture(udid) {
  try {
    const bin = helperPath();
    run('xcrun', ['simctl', 'spawn', udid, bin, 'hinge', '0']);
    run('xcrun', ['simctl', 'spawn', udid, bin, 'orientation', 'portrait']);
  } catch { /* teardown */ }
}

/** Width and height of a PNG, from its header. */
function pngSize(file) {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

/**
 * Screenshot the screen that is on, and refuse a shot whose shape says the posture did not take —
 * usually the app: an iPhone app turns only if its Info.plist lists the landscape orientations AND
 * it answers `supportedInterfaceOrientations` with them on a phone that folds.
 */
export function shootPosture(udid, posture, file) {
  const display = activeDisplay(udid);
  if (!display) throw new Error('no screen is on to photograph.');
  const r = run('xcrun', ['simctl', 'io', udid, 'screenshot', `--display=${display}`, file], { timeout: 15000 });
  if (r.status !== 0 || !fs.existsSync(file)) {
    throw new Error(`simctl could not photograph display ${display}${r.signal ? ' (it timed out: that screen is off)' : ''}: ${(r.stderr || '').trim()}`);
  }
  const { w, h } = pngSize(file);
  if ((w > h) !== posture.wide) {
    throw new Error(
      `${path.basename(file)} is ${w}×${h}, but ${posture.name} is ${posture.wide ? 'wide' : 'tall'}: the app did not turn.\n`
      + '  An iPhone app turns only when its Info.plist lists the landscape orientations and it allows them on a\n'
      + '  phone that folds (supportedInterfaceOrientations, or UIRequiresFullScreen off).',
    );
  }
}
