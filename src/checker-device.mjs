/**
 * The checker's first witness, the device (see checker.mjs): what it says at the moment of a shot, kept beside the shot,
 * and the refusals those facts carry. The parsers are pure, so they are tested on recorded dumps.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** The status bar time zdymak pins on both platforms (Apple's 9:41). */
export const DEMO_TIME = '9:41';

// ---------------------------------------------------------------- the device's facts, beside the shot

/** Where the device's facts for a shot are kept: a hidden folder beside it, which `check` and uploads never walk. */
export function factsPath(shot) {
  return path.join(path.dirname(shot), '.zdymak-check', `${path.basename(shot, path.extname(shot))}.json`);
}

export function writeFacts(shot, facts) {
  const file = factsPath(shot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(facts, null, 2)}\n`);
}

export function readFacts(shot) {
  try {
    return JSON.parse(fs.readFileSync(factsPath(shot), 'utf8'));
  } catch {
    return null;
  }
}

const adb = (...args) => spawnSync('adb', ['shell', ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).stdout || '';

/**
 * What has the focus on an Android device, from `dumpsys window`: `{ window, app }`, the focused window's title
 * (`com.x/com.x.Main`, `Application Not Responding: com.android.systemui`, `NotificationShade`) and the package of
 * the focused activity. Either is null when the dump does not name it.
 */
export function parseAndroidFocus(dump) {
  const w = /mCurrentFocus=Window\{\S+ \S+ ([^}]+)\}/.exec(dump);
  const a = /mFocusedApp=\S*ActivityRecord\{\S+ \S+ ([\w.]+)\//.exec(dump);
  return { window: w ? w[1].trim() : null, app: a ? a[1] : null };
}

/** Whether `dumpsys input_method` says the on-screen keyboard is up. */
export function parseKeyboardShown(dump) {
  return /\b(mInputShown|mIsInputViewShown|isInputViewShown|inputShown)=true\b/.test(dump);
}

/** The app's own locales from `cmd locale get-app-locales <pkg>` ("Locales for p for user 0 are [fr-FR]"), or []. */
export function parseAppLocales(out) {
  const m = /are \[([^\]]*)\]/.exec(out);
  return m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
}

/**
 * The compatibility UI Android's window manager shell draws over a letterboxed app: the letterbox education dialog
 * ("See and do more"), the restart dialog ("Restart for a better view?"), the reachability hints, the aspect-ratio and
 * restart buttons. None of it is a window: each is a windowless view (`CompatUIWindowManagerAbstract`, a
 * `WindowlessWindowManager` that is never focusable), so `dumpsys window` keeps naming the app as the focus while the
 * dialog covers it. Its surface is a layer named after the class that draws it plus "Leash" (`getParentSurface`), and
 * `release()` removes it, so `dumpsys SurfaceFlinger --list` names one exactly while it is up. Source: AOSP
 * frameworks/base libs/WindowManager/Shell/src/com/android/wm/shell/compatui/CompatUIWindowManagerAbstract.java.
 * Returns the names found, such as `LetterboxEduWindowManager`; [] when there are none.
 */
export function parseAndroidOverlays(layers) {
  const names = [...String(layers || '').matchAll(/\b((?:LetterboxEdu|RestartDialog|ReachabilityEdu|UserAspectRatioSettings|CompatUI)WindowManager)Leash\b/g)]
    .map((m) => m[1]);
  return [...new Set(names)];
}

/** What each compatibility overlay is, for a refusal a reader understands. */
const OVERLAY_NAMES = {
  LetterboxEduWindowManager: 'the letterbox education dialog ("See and do more")',
  RestartDialogWindowManager: 'the restart dialog ("Restart for a better view?")',
  ReachabilityEduWindowManager: 'the reachability hints ("double-tap to move the app")',
  UserAspectRatioSettingsWindowManager: 'the aspect-ratio settings button',
  CompatUIWindowManager: 'the size compatibility restart button',
};

/** Read an Android device at the moment of a shot. `pkg` is the app the shot is of. */
export function androidFacts({ pkg, language, time }) {
  const focus = parseAndroidFocus(adb('dumpsys', 'window'));
  const locales = pkg ? parseAppLocales(adb('cmd', 'locale', 'get-app-locales', pkg)) : [];
  return {
    platform: 'android',
    app: pkg || null,
    language: language || null,
    time: time || DEMO_TIME,
    focus,
    overlays: parseAndroidOverlays(adb('dumpsys', 'SurfaceFlinger', '--list')),
    keyboard: parseKeyboardShown(adb('dumpsys', 'input_method')),
    appLocales: locales,
    systemLocale: adb('getprop', 'persist.sys.locale').trim() || adb('getprop', 'ro.product.locale').trim() || null,
    demoAllowed: adb('settings', 'get', 'global', 'sysui_demo_allowed').trim() === '1',
  };
}

/** Whether `simctl spawn <udid> launchctl list` shows the app running (a pid, not "-"). null when it says nothing. */
export function parseIosRunning(list, bundle) {
  const line = list.split('\n').find((l) => l.includes(`UIKitApplication:${bundle}[`));
  if (!line) return list.trim() ? false : null;
  return /^\s*\d+\s/.test(line);
}

/** Read an iOS simulator at the moment of a shot. */
export function iosFacts({ udid, bundle, language, time }) {
  const run = (args) => spawnSync('xcrun', ['simctl', ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const list = run(['spawn', udid, 'launchctl', 'list']);
  const bar = run(['status_bar', udid, 'list']);
  return {
    platform: 'ios',
    app: bundle || null,
    language: language || null,
    time: time || DEMO_TIME,
    running: bundle && list.status === 0 ? parseIosRunning(list.stdout, bundle) : null,
    statusBar: bar.status === 0 ? bar.stdout : null,
  };
}

export const primary = (tag) => String(tag || '').split(/[-_]/)[0].toLowerCase();

/**
 * A scene with no allowance of its own may change this share of the screen between its shot and a second shot taken
 * [MOTION_GAP_MS] later; more, and the shot was taken while the screen was still changing (a transition, a toast, a
 * scroll coming to rest). A scene that moves by design (a clock, a falling piece) is given its own allowance
 * (`--motion <state>=<share>`). The checker's own threshold, to be tuned on real store sets.
 */
export const MOTION_STILL = 0.01;
/** How long after the shot the second shot is taken. */
export const MOTION_GAP_MS = 1000;

/** The refusals the device's facts carry. Pure, so a folder check re-reads them from the sidecar. */
export function factRefusals(f) {
  const out = [];
  if (!f) return out;
  if (typeof f.motion === 'number' && f.motion > (f.motionAllowed ?? MOTION_STILL)) {
    const allowed = f.motionAllowed ?? MOTION_STILL;
    out.push({
      rule: 'motion',
      reason: `the device: ${(f.motion * 100).toFixed(1)}% of the screen changed in the ${MOTION_GAP_MS / 1000} s after the shot, `
        + `over the ${(allowed * 100).toFixed(1)}% this scene allows, so the screen was still changing`,
    });
  }
  if (typeof f.launchDifference === 'number' && f.launchDifference < f.launchLook) {
    out.push({
      rule: 'launch',
      reason: `the device: only ${(f.launchDifference * 100).toFixed(1)}% of the screen changed since the launch screen, so this is the launch screen, not the scene`,
    });
  }
  if (f.platform === 'android') {
    const win = f.focus?.window || '';
    const anr = /^Application Not Responding: (.+)$/.exec(win);
    const err = /^Application Error: (.+)$/.exec(win);
    if (anr) out.push({ rule: 'dialog', reason: `the device: ${anr[1] === 'com.android.systemui' ? '"System UI isn\'t responding"' : `"${anr[1]} isn't responding"`} has the focus` });
    else if (err) out.push({ rule: 'dialog', reason: `the device: a crash dialog for ${err[1]} has the focus` });
    else if (/permissioncontroller/.test(win)) out.push({ rule: 'dialog', reason: `the device: a permission prompt has the focus (${win})` });
    else if (/^(NotificationShade|StatusBar)$/.test(win)) out.push({ rule: 'dialog', reason: `the device: the ${win} is pulled down over the app` });
    else {
      const pkg = win.includes('/') ? win.split('/')[0] : f.focus?.app;
      if (f.app && pkg && pkg !== f.app) {
        out.push({
          rule: 'wrong-app',
          reason: /launcher/i.test(pkg) ? `the device: the home screen is in front (${pkg}), not ${f.app}` : `the device: ${pkg} is in front, not ${f.app}`,
        });
      }
    }
    // Over the app whatever has the focus: Android's compatibility UI never takes it (see parseAndroidOverlays).
    for (const o of f.overlays || []) {
      out.push({ rule: 'dialog', reason: `the device: Android's ${OVERLAY_NAMES[o] || o} is drawn over the app (${o}Leash)` });
    }
    if (f.keyboard) out.push({ rule: 'keyboard', reason: 'the device: the input method says the on-screen keyboard is shown' });
    if (f.demoAllowed === false) out.push({ rule: 'status-bar', reason: 'the device: SystemUI demo mode is not allowed, so the status bar is the real one' });
    if (f.language) {
      const app = f.appLocales?.[0];
      const now = app || f.systemLocale;
      if (now && primary(now) !== primary(f.language)) {
        out.push({ rule: 'language', reason: `the device: the ${app ? 'app' : 'device'} is in ${now}, the set is ${f.language}` });
      }
    }
  }
  if (f.platform === 'ios') {
    if (f.app && f.running === false) {
      out.push({ rule: 'wrong-app', reason: `the device: ${f.app} is not running (it crashed or quit), so the home screen or another app is in front` });
    }
    if (typeof f.statusBar === 'string' && !f.statusBar.includes(f.time || DEMO_TIME)) {
      out.push({ rule: 'status-bar', reason: `the device: the status bar is not overridden to ${f.time || DEMO_TIME}, so it shows the real clock and battery` });
    }
  }
  return out;
}

