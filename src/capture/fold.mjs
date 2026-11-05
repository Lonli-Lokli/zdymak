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

/**
 * The simulator's displays, from devicectl: `[{ id, active, primary }]`. A phone that folds has two or more. The
 * outer screen is the one devicectl calls primary (the Duo's 1398×2034 `LCD`, the screen it boots on); the inner is
 * the other (`LCD-1`, 2007×2853). Measured on the iOS 27.1 simulator, 2026-10-13.
 */
export function displays(udid) {
  const out = run('xcrun', ['devicectl', 'device', 'info', 'displays', '--device', udid]).stdout ?? '';
  return parseDisplays(out);
}

/** The display headers of `devicectl device info displays`, such as `▿ 1: LCD (primary) (active):`. */
export function parseDisplays(out) {
  return out.split('\n').map((line) => line.match(/▿ (\d+):/)
    && { id: line.match(/▿ (\d+):/)[1], active: line.includes('(active)'), primary: line.includes('(primary)') })
    .filter(Boolean);
}

/**
 * The display a posture shows: the primary one for the outer screen, the other for the inner. Read from the list,
 * never learned from which one is lit: right after a fold the old screen still reads as lit for seconds, and on a
 * phone at rest the flag flickers (closed and still, one read in six named the inner screen). Learning the outer
 * screen as "the one lit after closing" named the inner screen twice in one night (2026-10-13).
 */
export function postureDisplay(list, posture) {
  const outer = list.find((d) => d.primary)?.id;
  const inner = list.find((d) => !d.primary)?.id;
  if (!outer || !inner) throw new Error(`devicectl names no primary and second screen (${list.map((d) => d.id).join(', ') || 'no displays'}).`);
  return posture.screen === 'outer' ? outer : inner;
}

/** The id of the screen that is on, or null. */
export const activeDisplay = (udid) => displays(udid).find((d) => d.active)?.id ?? null;

/** How long a screenshot of one display may take: with the display of a screen that is off, simctl waits forever. */
export const SHOT_TIMEOUT_MS = 15000;

/**
 * `simctl io screenshot` for one display, or for the only screen when `display` is null. A phone that folds has two
 * displays and simctl refuses to choose ("Cannot choose between 2 displays"), so every shot of a posture, the settle
 * probe's included, names the display.
 */
export function screenshotArgs(udid, file, display = null) {
  return ['simctl', 'io', udid, 'screenshot', ...(display ? [`--display=${display}`] : []), file];
}

/** Every display shot this run took, in milliseconds: the timeout above is read against them when a shot fails. */
export const shotTimes = [];

/** When the posture was entered: a failed shot keeps the simulator's display log from then on. */
let postureSince = null;

/** `log show --start` takes local time as `YYYY-MM-DD HH:MM:SS`. */
export function logStart(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

/**
 * Why a display shot failed, in the facts that tell a screen that went off from a simulator that was slow: what
 * devicectl read just after the shot (the display still on means simctl, not the screen), how long the run's earlier
 * shots of a display took, and the host's load. zdymak used to say "that screen is off" on every timeout, which no
 * read had shown (one store run, 2026-11-05: devicectl read the outer screen on three times in a row, then the shot
 * of it timed out).
 */
export function shotFailure({ display, timedOut, stderr, after, times, load, logFile }) {
  const slowest = times.length ? `${(Math.max(...times) / 1000).toFixed(1)} s` : 'no earlier shot';
  const stillOn = after.length > 0 && after.every((d) => d === display);
  return `simctl could not photograph display ${display}${timedOut ? ` within ${SHOT_TIMEOUT_MS / 1000} s` : ''}: ${(stderr || '').trim()}\n`
    + `  devicectl read after it: ${after.join(', ') || 'nothing'} (${stillOn ? 'that screen was still on, so simctl was slow, not the screen off' : 'that screen was not on'})\n`
    + `  the ${times.length} display shot(s) before it took up to ${slowest}; the host's load average was ${load}`
    + (logFile ? `\n  the simulator's display log since the posture: ${logFile}` : '');
}

/**
 * One screenshot of one display, timed, with a timeout: with the display of a screen that is off simctl waits forever.
 * A failure reads the display again and keeps the simulator's backlight and display log beside the shot, so a run
 * says which it was (see shotFailure).
 */
export function shootDisplay(udid, display, file) {
  const t0 = Date.now();
  const r = run('xcrun', screenshotArgs(udid, file, display), { timeout: SHOT_TIMEOUT_MS });
  if (r.status === 0 && fs.existsSync(file)) { shotTimes.push(Date.now() - t0); return; }
  // Three reads a second apart, as awaitDisplay counts a screen on.
  const after = [];
  for (let i = 0; i < 3; i++) { after.push(activeDisplay(udid) ?? 'none'); pause(1000); }
  let logFile = null;
  if (postureSince) {
    // backboardd owns the displays and their backlight, SpringBoard asks it to blank one; bounded by the longest wait
    // this file allows a busy simulator (READS.first, one read a second).
    const log = run('xcrun', ['simctl', 'spawn', udid, 'log', 'show', '--style', 'compact', '--start', logStart(postureSince),
      '--predicate', 'process == "backboardd" OR process == "SpringBoard"'], { timeout: READS.first * 1000, maxBuffer: 256 * 1024 * 1024 });
    if (log.stdout) {
      logFile = path.join(path.dirname(file), '.shot-failed.log');
      fs.writeFileSync(logFile, log.stdout);
    }
  }
  throw new Error(shotFailure({
    display, timedOut: Boolean(r.signal), stderr: r.stderr, after, times: shotTimes, load: os.loadavg().map((n) => n.toFixed(1)).join(' '), logFile,
  }));
}

/** How many reads each wait makes: the first, just after a boot, the longest; before a shot, the shortest. */
export const READS = { first: 60, fold: 20, shot: 10 };

/**
 * Wait until display `id` is the one that is on, three reads in a row a second apart (a fold hands the picture from
 * one screen to the other over a second or more, longer on a simulator just booted, and a lone read can flicker).
 * Returns every read it made when it never got there, for the error; null when it did. Just after a boot devicectl
 * can go 20 s without three agreeing reads (the Duo's half-laptop, 2026-10-13), so the first wait is longer.
 *
 * The budget is a number of READS, not of seconds: a read of devicectl can itself take many seconds on a simulator
 * busy just after its boot, and a clock budget then ran out after one or two reads of the right screen and failed a
 * posture that had taken (one store run, 2026-11-05, read "1, 1", "3" and "1"). `read` and `wait` are the devicectl
 * read and the pause, passed in so the counting can be tested without a simulator.
 */
export function awaitDisplay(read, id, reads = READS.fold, wait = pause) {
  const seen = [];
  let streak = 0;
  while (seen.length < reads) {
    const now = read();
    seen.push(now ?? 'none');
    streak = now === id ? streak + 1 : 0;
    if (streak >= 3) return null;
    wait(1000);
  }
  return seen;
}

/** Send the helper one command inside the simulator. */
function helper(udid, bin, ...args) {
  const r = run('xcrun', ['simctl', 'spawn', udid, bin, ...args]);
  if (r.status !== 0) throw new Error(`the Duo helper refused "${args.join(' ')}": ${(r.stderr || r.stdout || '').trim()}`);
}

/**
 * The fold itself, with the simulator passed in (`send` a helper command, `read` the screen that is on, `wait` a
 * pause) so its order and its one retry can be tested without one. Closes the phone and waits for the outer screen,
 * then opens flat and folds back for the inner one (see the file comment). When the wanted screen does not come on,
 * it folds the phone again ONCE from closed: a fold sent to a simulator just booted can be lost (one store run,
 * 2026-11-05: half open like a book, the inner screen never lit in twenty reads). Before that re-fold the wanted
 * screen gets one more wait of the same length, without a fold, since the simulator can be that late to show one. A
 * second miss refuses, naming the reads of both tries, and says so when it was the closing for the retry that failed.
 */
export function fold(posture, { outer, want, send, read, wait = pause, log = () => {} }) {
  const refuse = (screen, id, reads) => new Error(`${posture.name} wants the ${screen} screen (display ${id}) on, and `
    + `devicectl never read it three times in a row (it read ${reads.join(', ')}).`);
  let missed = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    send('hinge', '0');
    const closed = awaitDisplay(read, outer, attempt === 1 ? READS.first : READS.fold, wait);
    if (closed && missed) {
      throw new Error(`${posture.name} wants the ${posture.screen} screen (display ${want}) on, and devicectl never read `
        + `it three times in a row (it read ${missed.join(', ')}); folding it closed again, the outer screen (display `
        + `${outer}) never came on either (it read ${closed.join(', ')}).`);
    }
    if (closed) throw refuse('outer', outer, closed);
    if (posture.screen === 'outer') {
      send('orientation', posture.orientation);
      wait(2000);
    } else {
      send('hinge-sweep', '0', '180', '0.6');
      wait(2000);
      send('orientation', posture.orientation);
      wait(2000);
      if (posture.hinge !== 180) {
        send('hinge-sweep', '180', String(posture.hinge), '0.8');
        wait(3000);
      }
    }
    let reads = awaitDisplay(read, want, READS.fold, wait);
    if (!reads) return want;
    // A screen that has not come on gets one more wait of the same length before the phone is folded again: the
    // simulator can show a fold twenty reads late, and a re-fold sent then closed the phone while the inner screen
    // was still coming on, so the closing read the inner screen and the posture was refused for the outer one (one
    // store run, 2026-11-05: open "1 ×20 | again: 1, 1, 3, 3, …", half-book "1 ×19, 3 | again: 3, 3, 3, …").
    const late = awaitDisplay(read, want, READS.fold, wait);
    if (!late) {
      log(`  ${posture.name}: the ${posture.screen} screen (display ${want}) came on late (devicectl read ${reads.join(', ')})`);
      return want;
    }
    reads = [...reads, ...late];
    if (missed) throw refuse(posture.screen, want, [...missed, '| again:', ...reads]);
    missed = reads;
    log(`  ${posture.name}: the ${posture.screen} screen (display ${want}) did not come on (devicectl read ${reads.join(', ')}); folding once more from closed`);
  }
  return want; // not reached
}

/**
 * Put the phone in a posture: closed for the outer screen, or flat first and then folded back for a
 * half-open one (see the file comment). Returns the display that is on, and refuses if the screen
 * that should be on is not.
 */
export function enterPosture(udid, posture) {
  const bin = helperPath();
  const list = displays(udid);
  if (list.length < 2) throw new Error('--posture needs a phone that folds (the iPhone Duo simulator, Xcode 27.1+); this simulator has one screen.');
  postureSince = new Date();
  return fold(posture, {
    outer: postureDisplay(list, { screen: 'outer' }),
    want: postureDisplay(list, posture),
    send: (...args) => helper(udid, bin, ...args),
    read: () => activeDisplay(udid),
    log: (line) => console.log(line),
  });
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
  const display = postureDisplay(displays(udid), posture);
  const reads = awaitDisplay(() => activeDisplay(udid), display, READS.shot);
  if (reads) throw new Error(`the ${posture.screen} screen (display ${display}) is not on to photograph (devicectl read ${reads.join(', ')}).`);
  shootDisplay(udid, display, file);
  const { w, h } = pngSize(file);
  if ((w > h) !== posture.wide) {
    throw new Error(
      `${path.basename(file)} is ${w}×${h}, but ${posture.name} is ${posture.wide ? 'wide' : 'tall'}: the app did not turn.\n`
      + '  An iPhone app turns only when its Info.plist lists the landscape orientations and it allows them on a\n'
      + '  phone that folds (supportedInterfaceOrientations, or UIRequiresFullScreen off).',
    );
  }
}

// ---------------------------------------------------------------- launching on a simulator

/** What `simctl launch` says when launchd gave the app no process: ESRCH, "No such process". */
export const NO_PROCESS = /No such process/;

/**
 * Whether a simulator is ready to launch `bundle` again, from `simctl spawn <udid> launchctl list` ("PID Status
 * Label"): the app's own job holds no process (the one just terminated has gone), and SpringBoard's, when listed, does.
 */
export function iosLaunchReady(list, bundle) {
  const lines = String(list || '').split('\n');
  if (!lines.some((l) => l.trim())) return false;
  const app = lines.find((l) => l.includes(`UIKitApplication:${bundle}[`));
  if (app && /^\s*\d+\s/.test(app)) return false;
  const board = lines.find((l) => /\scom\.apple\.SpringBoard\s*$/.test(l));
  return !board || /^\s*\d+\s/.test(board);
}

/**
 * Launch an app, and once more when launchd gave it no process. One store run (2026-11-05) had `simctl launch` fail
 * with "No such process" right after a posture was reached, on the first state. The second launch waits for the
 * simulator to read ready (iosLaunchReady) the way a posture's display is waited for: three agreeing reads a second
 * apart, within READS.fold reads, the budget measured after a fold. `launch` runs simctl and returns its result;
 * `ready` reads launchctl; both are passed in so the retry is tested without a simulator.
 */
export function launchApp({ launch, ready, log = () => {}, wait = pause }) {
  const said = (r) => (r.stderr || r.stdout || '').trim();
  const first = launch();
  if (first.status === 0) return { retried: false };
  if (!NO_PROCESS.test(said(first))) throw new Error(`simctl launch failed: ${said(first)}`);
  const reads = awaitDisplay(() => (ready() ? 'ready' : 'busy'), 'ready', READS.fold, wait);
  log(`  the launch got no process; ${reads ? `the simulator never read ready (${reads.join(', ')})` : 'the simulator read ready'}, launching once more`);
  const second = launch();
  if (second.status !== 0) throw new Error(`simctl launch failed twice, the second time after ${reads ? `${reads.length} reads that never read ready` : 'the simulator read ready'}: ${said(second)}`);
  return { retried: true, reads };
}
