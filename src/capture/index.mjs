/**
 * Capture mode (mode B) — grab store-ready PNGs from a running app instead of hand-managing a folder.
 * Strips the alpha channel (Apple & Play reject transparency) and writes into your `capturesDir`, so the
 * capture → compose (`build`/`screenshots`) chain is one pipeline.
 *
 * FULL WORKFLOW (start app → drive by a handle → snap each screen):
 *   zdymak capture --platform ios --bundle com.x.app --arg -marketingScreen \
 *     --states welcome,today,study,answer --suffix -light \
 *     --build --project App.xcodeproj --scheme App --out marketing/ios/captures
 *   → boots a sim, (optionally builds+installs), then for each state relaunches the app with
 *     `<arg> <state>` and screenshots it. The app just needs a launch-arg "handle" that routes to a
 *     seeded screen (e.g. reads `-marketingScreen <id>` from UserDefaults). Then `zdymak build` composes.
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

function sh(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
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
 * There is no `simctl` command for this. Orientation belongs to the Simulator APP, not to the device
 * service, so the only lever Apple exposes is the Device ▸ Orientation menu — which is why this
 * drives a GUI menu, an approach that would be indefensible in a capture pipeline if any other
 * existed.
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
async function settleFrame(udid, outDir, maxMs = 9000) {
  const probe = path.join(outDir, '.settle-probe.png');
  const t0 = Date.now();
  let last = null;
  try {
    while (Date.now() - t0 < maxMs) {
      sh('xcrun', ['simctl', 'io', udid, 'screenshot', probe]);
      const now = fs.readFileSync(probe);
      if (last && last.equals(now)) return;
      last = now;
      await sleep(700);
    }
  } finally {
    fs.rmSync(probe, { force: true });
  }
}

async function setSimOrientation(orientation) {
  const item = ORIENTATION_MENU[orientation];
  if (!item) {
    throw new Error(`--orientation must be one of: ${Object.keys(ORIENTATION_MENU).join(', ')} (got "${orientation}").`);
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
  if (orientation === 'portrait') { await setSimOrientation('portrait'); await settleFrame(udid, outDir); return; }
  const probe = path.join(outDir, '.orientation-probe.png');
  try {
    await setSimOrientation('portrait');
    await settleFrame(udid, outDir);
    sh('xcrun', ['simctl', 'io', udid, 'screenshot', probe]);
    const before = fs.readFileSync(probe);
    await setSimOrientation(orientation);
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

/** Boot (or reuse/create) an iOS simulator → UDID. Prefers --udid, then an already-booted sim, then a
 *  device matching --device (default iPhone 16 Pro Max), creating one if needed. */
/**
 * Boot (or reuse/create) a simulator. Returns `{ udid, booted, created }` — the two booleans are the
 * TEARDOWN receipt: they say what this process changed, so the cleanup can undo exactly that and leave a
 * simulator the user already had running exactly as they left it.
 */
function bootIosSim(flags) {
  if (flags.udid) {
    const wasBooted = out2('xcrun', ['simctl', 'list', 'devices', 'booted']).includes(flags.udid);
    spawnSync('xcrun', ['simctl', 'boot', flags.udid], { stdio: 'ignore' });
    spawnSync('xcrun', ['simctl', 'bootstatus', flags.udid, '-b'], { stdio: 'ignore' });
    return { udid: flags.udid, booted: !wasBooted, created: false };
  }
  if (!flags.device) {
    const booted = out2('xcrun', ['simctl', 'list', 'devices', 'booted']).match(udidRe);
    if (booted) return { udid: booted[1], booted: false, created: false }; // the user's own sim — leave it alone
  }
  const name = flags.device || 'iPhone 16 Pro Max';
  let created = false;
  let udid = out2('xcrun', ['simctl', 'list', 'devices', 'available'])
    .split('\n').find((l) => l.includes(name) && udidRe.test(l))?.match(udidRe)?.[1];
  if (!udid) {
    const devtype = out2('xcrun', ['simctl', 'list', 'devicetypes']).split('\n')
      .find((l) => l.includes(name))?.match(/(com\.apple[^\s)]+)/)?.[1];
    const runtime = out2('xcrun', ['simctl', 'list', 'runtimes', 'ios']).split('\n').reverse()
      .find((l) => /com\.apple[^\s)]+/.test(l))?.match(/(com\.apple[^\s)]+)/)?.[1];
    if (!devtype || !runtime) throw new Error(`Could not resolve a simulator for "${name}".`);
    udid = sh('xcrun', ['simctl', 'create', 'zdymak-capture', devtype, runtime]).trim();
    created = true;
  }
  spawnSync('xcrun', ['simctl', 'boot', udid], { stdio: 'ignore' });
  spawnSync('xcrun', ['simctl', 'bootstatus', udid, '-b'], { stdio: 'ignore' });
  return { udid, booted: true, created };
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
  // --clean removes stale capture images first so the folder holds ONLY this run's screenshots. Keeps the
  // `.dd` build cache (and any subdirs) so a rebuild stays incremental — only loose PNG/MOV files are cleared.
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
  //     [--build --project X.xcodeproj --scheme S] [--device "iPhone 16 Pro Max"] [--settle 3]
  if (flags.states) {
    if (!flags.bundle || !flags.arg) {
      throw new Error('state capture needs --bundle <id> and --arg <launch-handle> (e.g. -marketingScreen).');
    }
    const states = flags.states.split(',').map((s) => s.trim()).filter(Boolean);
    const suffix = flags.suffix || '';
    const settle = Number(flags.settle || 4);
    const sim = bootIosSim(flags);
    const udid = sim.udid;
    const orientation = (flags.orientation || 'portrait').toLowerCase();
    if (!ORIENTATION_MENU[orientation]) {
      throw new Error(`--orientation must be one of: ${Object.keys(ORIENTATION_MENU).join(', ')} (got "${flags.orientation}").`);
    }
    try {
    if (flags.build !== undefined) {
      if (!flags.project || !flags.scheme) throw new Error('--build needs --project <.xcodeproj> and --scheme <name>.');
      const dd = path.join(outDir, '.dd');
      console.log(`▶︎ Building ${flags.scheme} for the simulator (this is the slow step)…`);
      sh('xcodebuild', ['build', '-project', flags.project, '-scheme', flags.scheme, '-configuration', 'Debug',
        '-destination', `id=${udid}`, '-derivedDataPath', dd, '-allowProvisioningUpdates']);
      const app = out2('bash', ['-lc', `ls -dt "${dd}"/Build/Products/Debug-iphonesimulator/*.app 2>/dev/null | head -1`]).trim();
      if (!app) throw new Error(`No .app under ${dd}/Build/Products/Debug-iphonesimulator`);
      console.log(`▶︎ Installing ${path.basename(app)}…`);
      sh('xcrun', ['simctl', 'install', udid, app]);
    }

    // Apple's canonical marketing status bar: 9:41, full signal/wifi, FULL battery but NOT charging
    // (a charging bolt reads as a simulator override; Apple's own shots show an unplugged full battery).
    const pinStatusBar = () =>
      spawnSync('xcrun', ['simctl', 'status_bar', udid, 'override', '--time', '9:41',
        '--batteryState', 'discharging', '--batteryLevel', '100', '--cellularBars', '4', '--wifiBars', '3'], { stdio: 'ignore' });
    pinStatusBar();

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
    for (const [i, st] of states.entries()) {
      spawnSync('xcrun', ['simctl', 'terminate', udid, flags.bundle], { stdio: 'ignore' });
      const launch = ['simctl', 'launch', udid, flags.bundle, ...langArgs, flags.arg, st];
      if (recording) launch.push(reelArg, 'YES'); // tell the harness to auto-animate this screen
      sh('xcrun', launch);
      await sleep(settle * 1000);
      // Rotation is asked for AFTER the app is up, never before: iOS resolves an orientation request
      // against whatever is frontmost, so a device turned at the home screen springs back the moment
      // a portrait app launches into it. The expensive PROVEN turn runs once; later states only
      // re-assert, because a relaunch inherits the device's orientation and re-proving it every time
      // would flip the screen back and forth for no information.
      if (orientation !== 'portrait') {
        if (i === 0) await rotateSim(udid, orientation, outDir);
        else { await setSimOrientation(orientation); await settleFrame(udid, outDir); }
      }
      // Re-assert RIGHT BEFORE capture: a launch + the settle lets the sim re-sync the battery to the host
      // (a charging bolt creeps back on later screens). Re-pinning per screen keeps every shot clean.
      pinStatusBar();
      if (recording) {
        const out = path.join(outDir, `${st}${suffix}.mov`);
        const rec = spawn('xcrun', ['simctl', 'io', udid, 'recordVideo', '--codec=h264', '--force', out], { stdio: 'ignore' });
        await sleep(dur * 1000);
        rec.kill('SIGINT'); // simctl finalizes the mp4/mov on SIGINT
        await new Promise((res) => rec.on('close', res));
        console.log(`   ✓ ${st}${suffix}.mov (${dur}s)`);
      } else {
        await sleep(500); // let the pinned bar paint before the screenshot
        const out = path.join(outDir, `${st}${suffix}.png`);
        sh('xcrun', ['simctl', 'io', udid, 'screenshot', out]);
        await uprightCapture(out, orientation);
        await stripAlpha(out);
        console.log(`   ✓ ${st}${suffix}.png`);
      }
    }
    console.log(`Done → ${outDir}`);
    } finally {
      // Always: a thrown build/launch error must not strand a booted sim with a faked status bar —
      // nor one lying on its side. A simulator the user already had running is handed back the way
      // they left it, and orientation is part of "the way they left it".
      if (orientation !== 'portrait') { try { await setSimOrientation('portrait'); } catch { /* teardown */ } }
      teardownIosSim(sim, flags);
    }
    return; // the workflow is DONE — falling through would try to snap a sim that was just torn down
  }

  // Single snapshot of whatever is on the booted sim.
  const out = path.join(outDir, `${flags.name || 'shot'}.png`);
  sh('xcrun', ['simctl', 'io', 'booted', 'screenshot', out]);
  await stripAlpha(out);
  console.log(`✓ ${out}  (alpha stripped, store-ready)`);
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

async function captureAndroid(flags) {
  if (spawnSync('adb', ['version'], { stdio: 'ignore' }).status !== 0) {
    throw new Error('adb not found — install Android platform-tools and connect a device/emulator.');
  }
  const outDir = path.resolve(flags.out || 'shots');
  fs.mkdirSync(outDir, { recursive: true });
  // --clean removes stale capture images first so the folder holds ONLY this run's screenshots. Keeps the
  // `.dd` build cache (and any subdirs) so a rebuild stays incremental — only loose PNG/MOV files are cleared.
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

  const grab = async (file) => {
    const b = spawnSync('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 });
    if (b.status !== 0) throw new Error(`adb screencap failed: ${b.stderr}`);
    fs.writeFileSync(file, b.stdout);
    await stripAlpha(file);
  };

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
  const display = androidDisplay(flags);
  androidDemo(true, flags); // clean marketing status bar (Google convention)
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
        for (const st of states) {
          sh('adb', ['shell', 'am', 'start', '-n', flags.component, '--es', flags.arg, st]);
          await sleep(settle * 1000);
          const out = path.join(outDir, `${st}${suffix}.png`);
          await grab(out);
          console.log(`   ✓ ${st}${suffix}.png`);
        }
      }
      console.log(`Done → ${outDir}`);
    } else {
      const out = path.join(outDir, `${flags.name || 'shot'}.png`);
      await grab(out);
      console.log(`✓ ${out}  (alpha stripped, store-ready)`);
    }
  } finally {
    // Teardown in reverse: leave demo mode while the override is still on, THEN restore the display.
    // Resetting size first restarts SystemUI and takes demo mode with it, so the `exit` broadcast
    // lands on a bar that never entered — harmless today, but it leaves the emulator's demo state
    // decided by a race rather than by this function.
    language.reset();
    androidDemo(false, flags);
    display.reset();
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
