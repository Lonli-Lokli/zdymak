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

  androidDemo(true, flags); // clean marketing status bar (Google convention)
  const display = androidDisplay(flags);
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
    display.reset();
    androidDemo(false, flags);
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
