/**
 * The checker's first witness, the device (see checker.mjs): what it says at the moment of a shot, kept beside the shot,
 * and the refusals those facts carry. The parsers are pure, so they are tested on recorded dumps.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseWmSize } from './capture/android-fold.mjs';

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

// ---------------------------------------------------------------- the device's screen

/**
 * The kinds of screen a shot is taken on, as the letterbox check needs them: `phone`, where the system never draws an
 * app in a smaller box (an iPhone, the outer screen of a folding phone, an Android phone), and `large`, where it does
 * for an app that does not resize (an iPad, an Android tablet, a Chromebook or desktop window, a fold's inner screen).
 */
export const SCREENS = ['phone', 'large'];

/**
 * An Android screen is large from this smallest width, in dp: the line from which Android 16 lays out every app at
 * the window's size, over its orientation, aspect ratio and resizability restrictions ("form factors with smallest
 * width >= 600dp", developer.android.com/guide/practices/device-compatibility-mode, read 2026-11-08), and the
 * `sw600dp` resource qualifier for a tablet.
 */
export const LARGE_SCREEN_DP = 600;

/**
 * A phone's short side is under this many dp: Android's window size classes put a phone held sideways at Compact
 * height, under 480dp (developer.android.com/develop/ui/compose/layouts/adaptive/use-window-size-classes). A box
 * between bars at least this wide is wider than any phone, so it is a column the layout chose, not a phone-sized app.
 */
export const PHONE_SHORT_DP = 480;

/**
 * Pixels a dp in a shot, from its facts: the density recorded at capture (Android's `wm density`, 160 a dp), else the
 * smallest width the facts kept, against the shot's own short side. Null where neither is known (iOS, old facts).
 */
export function pxPerDpOf(facts, { width, height }) {
  if (facts?.density > 0) return facts.density / 160;
  if (facts?.smallestWidthDp > 0) return Math.min(width, height) / facts.smallestWidthDp;
  return null;
}

/** `wm density` → the density in use: the override when there is one, else the physical one. */
export function parseWmDensity(out) {
  const s = String(out);
  const m = /Override density:\s*(\d+)/.exec(s) || /Physical density:\s*(\d+)/.exec(s);
  return m ? Number(m[1]) : null;
}

/** An Android screen's kind from `wm size` and `wm density`: `{ smallestWidthDp, screen }`, the kind null when either is unread. */
export function androidScreen(size, density) {
  if (!size || !density) return { smallestWidthDp: null, screen: null };
  const smallestWidthDp = Math.round((Math.min(size.w, size.h) * 160) / density);
  return { smallestWidthDp, screen: smallestWidthDp >= LARGE_SCREEN_DP ? 'large' : 'phone' };
}

/**
 * The simulator's device type from `simctl list devices -j`, as `com.apple.CoreSimulator.SimDeviceType.<model>`, or
 * null. `udid` may be `booted`, the first device booted.
 */
export function parseIosDeviceType(json, udid) {
  let list;
  try { list = JSON.parse(json); } catch { return null; }
  const all = Object.values(list?.devices || {}).flat();
  const d = all.find((x) => (udid === 'booted' ? x.state === 'Booted' : x.udid === udid));
  return d?.deviceTypeIdentifier || null;
}

/**
 * An iOS screen's kind from its device type and, on a folding iPhone, the screen its posture shows (fold.mjs). iOS
 * draws an iPhone-only app in an iPhone-sized box on an iPad, and never draws one smaller on an iPhone; a folding
 * iPhone's inner screen is tablet-sized, so it keeps the check. Null for a type that is neither.
 */
export function iosScreen(type, posture) {
  const model = String(type || '').split('.').pop();
  if (/^iPad/.test(model)) return 'large';
  if (/^iPhone/.test(model)) return posture?.screen === 'inner' ? 'large' : 'phone';
  return null;
}

/**
 * The status bar's inset in pixels from the top, from the insets sources `dumpsys window` prints for each display
 * (`InsetsSource id=… type=statusBars frame=[0,0][1080,63]` from Android 14, `type=ITYPE_STATUS_BAR` on 12 and 13):
 * the deepest bar that starts at the top, or null when none is printed.
 */
export function parseStatusInset(dump) {
  let inset = null;
  for (const m of String(dump).matchAll(/InsetsSource\b[^\n]*?\btype=(?:statusBars|ITYPE_STATUS_BAR)\s+frame=\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/g)) {
    const [top, bottom] = [Number(m[2]), Number(m[4])];
    if (top === 0 && bottom > 0 && Number(m[3]) > Number(m[1])) inset = Math.max(inset ?? 0, bottom);
  }
  return inset;
}

/** Read an Android device at the moment of a shot. `pkg` is the app the shot is of, `posture` a foldable's name for it, when one was set. */
export function androidFacts({ pkg, language, time, posture }) {
  const windows = adb('dumpsys', 'window');
  const focus = parseAndroidFocus(windows);
  const density = parseWmDensity(adb('wm', 'density'));
  const locales = pkg ? parseAppLocales(adb('cmd', 'locale', 'get-app-locales', pkg)) : [];
  return {
    platform: 'android',
    posture: posture || null,
    ...androidScreen(parseWmSize(adb('wm', 'size')), density),
    density,
    app: pkg || null,
    language: language || null,
    time: time || DEMO_TIME,
    focus,
    statusInset: parseStatusInset(windows),
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

/**
 * The time the status bar is overridden to, from `simctl status_bar <udid> list`: a line such as `Time: 9:41` or a
 * field such as `time=9:41` (the listing's form differs by Xcode version), or null when the listing names none.
 */
export function parseIosStatusTime(list) {
  const m = /(?:^|[\s,;{])time\s*[:=]\s*["']?(\d{1,2}:\d{2})\b/im.exec(String(list || ''));
  return m ? m[1] : null;
}

/** How much of the status bar listing the facts keep: the whole of a real one, with room to spare. */
export const STATUS_BAR_KEPT = 2000;

/** The status bar listing as the facts keep it: as printed, cut at [STATUS_BAR_KEPT]; null when the command failed. */
export function iosStatusBarOf(result) {
  return result?.status === 0 ? String(result.stdout || '').slice(0, STATUS_BAR_KEPT) : null;
}

/** The same clock, a leading zero aside: `09:41` is `9:41`. */
const sameClock = (a, b) => {
  const [ah, am] = String(a).split(':').map(Number);
  const [bh, bm] = String(b).split(':').map(Number);
  return ah === bh && am === bm;
};

/** Read an iOS simulator at the moment of a shot. `posture` is a folding iPhone's (fold.mjs), when one was set. */
export function iosFacts({ udid, bundle, language, time, posture }) {
  const run = (args) => spawnSync('xcrun', ['simctl', ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const list = run(['spawn', udid, 'launchctl', 'list']);
  const bar = run(['status_bar', udid, 'list']);
  const device = parseIosDeviceType(run(['list', 'devices', '-j']).stdout, udid);
  return {
    platform: 'ios',
    device,
    posture: posture?.name || null,
    screen: iosScreen(device, posture),
    app: bundle || null,
    language: language || null,
    time: time || DEMO_TIME,
    running: bundle && list.status === 0 ? parseIosRunning(list.stdout, bundle) : null,
    statusBar: iosStatusBarOf(bar),
  };
}

/** The language codes Java's Locale kept for three languages, which some Android versions still report. */
const LEGACY_LANGUAGES = { iw: 'he', in: 'id', ji: 'yi' };

/** A language tag's language, lower case, its legacy code read as today's (`iw-IL` is `he`). */
export const primary = (tag) => {
  const p = String(tag || '').split(/[-_]/)[0].toLowerCase();
  return LEGACY_LANGUAGES[p] || p;
};

/**
 * A scene with no allowance of its own may change this share of the screen between its shot and a second shot taken
 * [MOTION_GAP_MS] later; more, and the shot was taken while the screen was still changing (a transition, a toast, a
 * scroll coming to rest). A scene that moves by design (a clock, a falling piece) is given its own allowance
 * (`--motion <state>=<share>`).
 *
 * Measured on a real 80-shot store run on iOS and Android, 2026-11-10 (16 store targets, phones, folds, flips,
 * tablets, a Chromebook window, iPads, 5 scenes each, every scene still by design): 79 shots measured 0 and the
 * highest 0.0000028, one sampled pixel of a folding iPhone's half-open home screen. The run had no moving scene; the
 * motion fixture states 0.12 and the still fixtures 0.004. Kept at 0.01, thousands of times over the still scenes and
 * twelve times under the moving fixture, a margin chosen by judgement so that a change over a hundredth of the
 * screen in that second is refused, and equal to the duplicate rule's threshold (`DUPLICATE_LOOK`): a scene this
 * still is the same picture a second later.
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
    const want = f.time || DEMO_TIME;
    const time = typeof f.statusBar === 'string' ? parseIosStatusTime(f.statusBar) : null;
    // A listing in a form the parser does not know still passes when it shows the pinned time: no false refusal.
    if (typeof f.statusBar === 'string' && (time ? !sameClock(time, want) : !f.statusBar.includes(want))) {
      out.push({ rule: 'status-bar', reason: `the device: the status bar is not overridden to ${want}${time ? ` (it is to ${time})` : ''}, so it shows the real clock and battery` });
    }
  }
  return out;
}

