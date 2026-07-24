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
    console.log(`▶︎ ${verb} for ${states.length} screens via "${flags.arg} <id>" on ${flags.bundle}…`);
    for (const st of states) {
      spawnSync('xcrun', ['simctl', 'terminate', udid, flags.bundle], { stdio: 'ignore' });
      const launch = ['simctl', 'launch', udid, flags.bundle, flags.arg, st];
      if (recording) launch.push(reelArg, 'YES'); // tell the harness to auto-animate this screen
      sh('xcrun', launch);
      await sleep(settle * 1000);
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
        await stripAlpha(out);
        console.log(`   ✓ ${st}${suffix}.png`);
      }
    }
    console.log(`Done → ${outDir}`);
    } finally {
      // Always: a thrown build/launch error must not strand a booted sim with a faked status bar.
      teardownIosSim(sim, flags);
    }
  }

  // Single snapshot of whatever is on the booted sim.
  const out = path.join(outDir, `${flags.name || 'shot'}.png`);
  sh('xcrun', ['simctl', 'io', 'booted', 'screenshot', out]);
  await stripAlpha(out);
  console.log(`✓ ${out}  (alpha stripped, store-ready)`);
}

/** Toggle Android SystemUI Demo Mode → a clean, Play-native status bar (Google's own convention):
 *  pinned clock, full battery UNPLUGGED (no charging), full signal/wifi, notifications hidden. */
function androidDemo(on, flags) {
  const b = (...args) => spawnSync('adb', ['shell', 'am', 'broadcast', '-a', 'com.android.systemui.demo', ...args], { stdio: 'ignore' });
  if (!on) return void b('-e', 'command', 'exit');
  spawnSync('adb', ['shell', 'settings', 'put', 'global', 'sysui_demo_allowed', '1'], { stdio: 'ignore' });
  b('-e', 'command', 'enter');
  b('-e', 'command', 'clock', '-e', 'hhmm', (flags.time || '09:41').replace(':', ''));
  b('-e', 'command', 'battery', '-e', 'level', '100', '-e', 'plugged', 'false'); // full, NOT charging
  b('-e', 'command', 'network', '-e', 'wifi', 'show', '-e', 'level', '4');
  b('-e', 'command', 'network', '-e', 'mobile', 'show', '-e', 'datatype', 'none', '-e', 'level', '4');
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

  const grab = async (file) => {
    const b = spawnSync('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 });
    if (b.status !== 0) throw new Error(`adb screencap failed: ${b.stderr}`);
    fs.writeFileSync(file, b.stdout);
    await stripAlpha(file);
  };

  androidDemo(true, flags); // clean marketing status bar (Google convention)
  try {
    // Full workflow: drive the app through screens via an intent-extra HANDLE (--component + --arg).
    if (flags.states) {
      if (!flags.component || !flags.arg) {
        throw new Error('android state capture needs --component <pkg/activity> and --arg <extra-key>.');
      }
      const states = flags.states.split(',').map((s) => s.trim()).filter(Boolean);
      const suffix = flags.suffix || '';
      const settle = Number(flags.settle || 4);
      console.log(`▶︎ Driving ${states.length} screens via "--es ${flags.arg} <id>" on ${flags.component}…`);
      for (const st of states) {
        sh('adb', ['shell', 'am', 'start', '-n', flags.component, '--es', flags.arg, st]);
        await sleep(settle * 1000);
        const out = path.join(outDir, `${st}${suffix}.png`);
        await grab(out);
        console.log(`   ✓ ${st}${suffix}.png`);
      }
      console.log(`Done → ${outDir}`);
    } else {
      const out = path.join(outDir, `${flags.name || 'shot'}.png`);
      await grab(out);
      console.log(`✓ ${out}  (alpha stripped, store-ready)`);
    }
  } finally {
    androidDemo(false, flags);
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
