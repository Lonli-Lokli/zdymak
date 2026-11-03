/**
 * **Is this a shot a store may show?** The checker every capture passes and `zdymak check` runs alone on a folder.
 *
 * A capture tool photographs what the screen shows, and a screen can show many things that are not the app's scene:
 * nothing at all, the app's launch screen, a system dialog ("isn't responding", a crash, a permission prompt, an iOS
 * alert), the on-screen keyboard, the home screen or another app, the real status bar (the wall clock, a battery
 * that is not full, notification icons), or the app in another language than the set's. Each has reached a store
 * listing somewhere, and none of them makes a capture fail on its own.
 *
 * Two witnesses, because each misses things the other sees:
 *  - **The device**, read at capture time (`androidFacts`, `iosFacts`): which window has the focus, whether the input
 *    method is shown, the app's locale, the status bar overrides, whether the app is still running, how far the shot
 *    moved from the launch screen. These are written beside the shot in `.zdymak-check/<name>.json`, so a later
 *    `zdymak check` of the folder still knows them.
 *  - **The picture**, read every time: blankness (validate.mjs) and the text on it (Vision, on macOS), which shows a
 *    dialog's words, a keyboard's rows of letters, a home screen's app labels, the clock and battery in the top strip
 *    and the script the words are written in.
 *
 * Each refusal is `{ rule, reason }`; a rule the checker could not apply (no device facts for a folder of old shots,
 * no text reader off macOS) is a `note`, never a refusal: a false refusal blocks a release on a correct file.
 */
import path from 'node:path';
import { loadImage, createCanvas } from '@napi-rs/canvas';
import { captureBlankness, BLANK_COLOURS, BLANK_DOMINANCE } from './validate.mjs';
import { DEMO_TIME, MOTION_STILL, factRefusals, primary, readFacts } from './checker-device.mjs';
import { readText } from './ocr.mjs';

export { OCR_CONFIDENCE, readText } from './ocr.mjs';

export {
  DEMO_TIME, MOTION_GAP_MS, MOTION_STILL, androidFacts, factRefusals, factsPath, iosFacts, parseAndroidFocus, parseAppLocales, parseIosRunning,
  parseKeyboardShown, readFacts, writeFacts,
} from './checker-device.mjs';

/** The rules, in the order a report lists them. */
export const CHECK_RULES = [
  'unreadable', 'blank', 'launch', 'motion', 'dialog', 'keyboard', 'wrong-app', 'status-bar', 'language', 'letterbox', 'duplicate',
];

// ---------------------------------------------------------------- the picture's words

/** The top strip the status bar lives in, as a share of the picture's height. */
export const STATUS_STRIP = 0.06;
/** A language verdict needs at least this many letters read. */
export const LANGUAGE_MIN_LETTERS = 20;
/** And refuses only when the set's script is under this share of them. */
export const LANGUAGE_SCRIPT_SHARE = 0.3;

const DIALOG_WORDS = [
  [/isn[’'`]?t responding/i, 'an "isn\'t responding" dialog'],
  [/keeps stopping|has stopped/i, 'a crash dialog'],
  [/\bclose app\b/i, 'a crash or not-responding dialog ("Close app")'],
  [/while using the app|only this time/i, 'a permission prompt'],
  [/don[’'`]?t allow/i, 'a permission prompt or an iOS alert ("Don\'t Allow")'],
  [/would like to/i, 'an iOS alert ("Would Like to")'],
  [/app not to track/i, 'the tracking prompt'],
];

/** Keyboard rows, spaces dropped and lower-cased: QWERTY, AZERTY, QWERTZ and the Russian and Ukrainian ЙЦУКЕН. */
const KEY_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', 'azertyuiop', 'qwertzuiop', 'qsdfghjklm', 'йцукенгшщз', 'фывапролдж', 'ячсмитьбю'];

/** App labels every stock home screen carries; three or more on one picture is a home screen or a launcher. */
const HOME_LABELS = ['settings', 'photos', 'camera', 'calendar', 'clock', 'maps', 'safari', 'app store', 'messages', 'mail',
  'notes', 'reminders', 'weather', 'chrome', 'gmail', 'play store', 'youtube', 'files', 'contacts', 'phone'];

const SCRIPTS = {
  Cyrillic: ['ru', 'uk', 'be', 'bg', 'sr', 'mk', 'kk', 'ky', 'mn', 'tg'],
  Arabic: ['ar', 'fa', 'ur'],
  Devanagari: ['hi', 'mr', 'ne'],
  Japanese: ['ja'],
  Han: ['zh'],
  Hangul: ['ko'],
  Greek: ['el'],
  Hebrew: ['he', 'iw'],
  Thai: ['th'],
};
const SCRIPT_RE = {
  Latin: /\p{Script=Latin}/u,
  Cyrillic: /\p{Script=Cyrillic}/u,
  Arabic: /\p{Script=Arabic}/u,
  Devanagari: /\p{Script=Devanagari}/u,
  Japanese: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u,
  Han: /\p{Script=Han}/u,
  Hangul: /\p{Script=Hangul}/u,
  Greek: /\p{Script=Greek}/u,
  Hebrew: /\p{Script=Hebrew}/u,
  Thai: /\p{Script=Thai}/u,
};
/** The scripts Vision reads; a set in another one gets no picture verdict on its language. */
const READABLE_SCRIPTS = new Set(['Latin', 'Cyrillic', 'Arabic', 'Japanese', 'Han', 'Hangul', 'Thai']);

/** The script a language is written in. */
export function scriptOf(language) {
  const p = primary(language);
  for (const [script, langs] of Object.entries(SCRIPTS)) if (langs.includes(p)) return script;
  return 'Latin';
}

/** English words no other Latin-script language uses as often; three different ones on a non-English set is English. */
const ENGLISH_WORDS = new Set(['the', 'and', 'your', 'you', 'with', 'tap', 'of', 'to', 'is', 'for', 'new', 'settings']);

/**
 * The refusals the picture's words carry. `lines` is readText's result; `language` the set's; `time` the pinned clock.
 * Pure, so the bad fixtures can be tested without a text reader.
 */
export function textRefusals(lines, { language, time = DEMO_TIME } = {}) {
  const out = [];
  for (const [re, what] of DIALOG_WORDS) {
    const hit = lines.find((l) => re.test(l.text));
    if (hit) { out.push({ rule: 'dialog', reason: `the picture: ${what}, reading "${hit.text}"` }); break; }
  }
  const lower = lines.filter((l) => l.y > 0.45).map((l) => l.text.replace(/\s+/g, '').toLowerCase());
  const row = KEY_ROWS.find((r) => lower.some((t) => t.includes(r.slice(0, 7))));
  if (row) out.push({ rule: 'keyboard', reason: `the picture: a keyboard row ("${row}") in the lower half` });
  const labels = HOME_LABELS.filter((h) => lines.some((l) => l.text.trim().toLowerCase() === h));
  if (labels.length >= 3) out.push({ rule: 'wrong-app', reason: `the picture: home screen app labels (${labels.join(', ')})` });

  const strip = lines.filter((l) => l.y + l.h / 2 < STATUS_STRIP);
  const [wantH, wantM] = time.split(':').map(Number);
  for (const l of strip) {
    const clock = /\b(\d{1,2})[:.](\d{2})\b/.exec(l.text);
    if (clock && (Number(clock[1]) !== wantH || Number(clock[2]) !== wantM)) {
      out.push({ rule: 'status-bar', reason: `the picture: the status bar clock reads ${clock[0]}, not the pinned ${time}` });
      break;
    }
    const battery = /\b(\d{1,3})\s?%/.exec(l.text);
    if (battery && Number(battery[1]) !== 100) {
      out.push({ rule: 'status-bar', reason: `the picture: the status bar battery reads ${battery[0]}, not a full one` });
      break;
    }
  }

  if (language) {
    const want = scriptOf(language);
    const body = lines.filter((l) => l.y + l.h / 2 >= STATUS_STRIP).map((l) => l.text).join(' ');
    const counts = {};
    let letters = 0;
    for (const ch of body) {
      if (!/\p{L}/u.test(ch)) continue;
      letters++;
      for (const [s, re] of Object.entries(SCRIPT_RE)) if (re.test(ch)) counts[s] = (counts[s] || 0) + 1;
    }
    if (READABLE_SCRIPTS.has(want) && letters >= LANGUAGE_MIN_LETTERS && (counts[want] || 0) / letters < LANGUAGE_SCRIPT_SHARE) {
      const [top] = Object.entries(counts).filter(([s]) => s !== want).sort((a, b) => b[1] - a[1]);
      out.push({ rule: 'language', reason: `the picture: the words are in ${top ? top[0] : 'another'} script, the set (${language}) is ${want}` });
    } else if (want === 'Latin' && primary(language) !== 'en') {
      const words = new Set((body.toLowerCase().match(/\p{L}+/gu) || []).filter((w) => ENGLISH_WORDS.has(w)));
      if (words.size >= 3) out.push({ rule: 'language', reason: `the picture: English words (${[...words].join(', ')}) on a ${language} set` });
    }
  }
  return out;
}

// ---------------------------------------------------------------- the picture's pixels

/** Each letterbox bar is at least this share of the side it stands on. */
export const LETTERBOX_BAR = 0.05;
/** The box between the bars is phone-shaped: its long side at least this many times its short side ... */
export const LETTERBOX_BOX = 1.6;
/** ... in a shot that is not itself that shape (a tablet, a Chromebook window, a phone turned the other way). */
export const LETTERBOX_SHOT = 1.5;
/** How far a bar's pixels may stray from its colour, per channel (compression, dithering). */
const BAR_TOLERANCE = 8;

const near = (d, i, c) => Math.abs(d[i] - c[0]) <= BAR_TOLERANCE && Math.abs(d[i + 1] - c[1]) <= BAR_TOLERANCE && Math.abs(d[i + 2] - c[2]) <= BAR_TOLERANCE;

/**
 * The bars a phone-sized app leaves when the system draws it inside a larger screen or window (Android's letterbox,
 * an iPhone-only app on an iPad): `{ sides, bars: [a, b], box }` or null. Pure, on RGBA pixels. A bar is a run of
 * whole columns (or rows) of one colour from the edge; the status and navigation strips (top and bottom
 * [STATUS_STRIP]) are left out, since the system draws them across the bars. Both bars must be wide, of one colour,
 * and leave a phone-shaped box in a shot that is not phone-shaped: a tablet layout that keeps a readable width
 * on a plain ground is wider than that, and a phone's own shot never qualifies.
 */
export function letterboxOf({ data, width: w, height: h }) {
  const strip = Math.ceil(h * STATUS_STRIP);
  const colour = (x, y) => { const i = (y * w + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  const column = (x, c) => { for (let y = strip; y < h - strip; y += 2) if (!near(data, (y * w + x) * 4, c)) return false; return true; };
  const row = (y, c) => { for (let x = 0; x < w; x += 2) if (!near(data, (y * w + x) * 4, c)) return false; return true; };
  const run = (from, step, end, fits, at) => {
    const c = at(from);
    let n = 0;
    for (let i = from; i !== end && fits(i, c); i += step) n++;
    return { n, c };
  };
  const same = (a, b) => a.every((v, k) => Math.abs(v - b[k]) <= BAR_TOLERANCE);
  // Bars on the left and right: a phone held upright inside a wider screen.
  const l = run(0, 1, w, column, (x) => colour(x, strip));
  const r = run(w - 1, -1, -1, column, (x) => colour(x, strip));
  if (l.n >= w * LETTERBOX_BAR && r.n >= w * LETTERBOX_BAR && same(l.c, r.c) && l.n + r.n < w) {
    const box = w - l.n - r.n;
    if (h / box >= LETTERBOX_BOX && h / w < LETTERBOX_SHOT) return { sides: 'left and right', bars: [l.n, r.n], box: [box, h], colour: l.c };
  }
  // Bars above and below: a phone on its side inside a taller screen. The strips count as part of the bars.
  const t = run(strip, 1, h, row, (y) => colour(0, y));
  const b = run(h - 1 - strip, -1, -1, row, (y) => colour(0, y));
  const top = t.n ? t.n + strip : 0;
  const bottom = b.n ? b.n + strip : 0;
  if (top >= h * LETTERBOX_BAR && bottom >= h * LETTERBOX_BAR && same(t.c, b.c) && top + bottom < h) {
    const box = h - top - bottom;
    if (w / box >= LETTERBOX_BOX && w / h < LETTERBOX_SHOT) return { sides: 'top and bottom', bars: [top, bottom], box: [w, box], colour: t.c };
  }
  return null;
}

/** A shot's RGBA pixels, or null when it cannot be decoded. */
export async function pixelsOf(file) {
  let img;
  try { img = await loadImage(file); } catch { return null; }
  const ctx = createCanvas(img.width, img.height).getContext('2d');
  ctx.drawImage(img, 0, 0);
  return { width: img.width, height: img.height, data: ctx.getImageData(0, 0, img.width, img.height).data };
}

/** Under this share of changed pixels (sampled as the launch check does), two scenes are the same picture. */
export const DUPLICATE_LOOK = 0.005;

/** Every 4th pixel's colour, the sample two shots are compared on. */
function sampleOf({ data, width: w, height: h }) {
  const out = [];
  for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x += 4) { const i = (y * w + x) * 4; out.push(data[i], data[i + 1], data[i + 2]); }
  return Uint8Array.from(out);
}

/** The share of sampled pixels that differ by more than 32 on any channel, as the launch check measures. */
export function sampleDifference(a, b) {
  let moved = 0;
  for (let i = 0; i < a.length; i += 3) {
    if (Math.abs(a[i] - b[i]) > 32 || Math.abs(a[i + 1] - b[i + 1]) > 32 || Math.abs(a[i + 2] - b[i + 2]) > 32) moved++;
  }
  return a.length ? moved / (a.length / 3) : 0;
}

/**
 * The checks across a set: two scenes of one set that are the same picture. A set is the shots of one folder at one
 * size (one device, one language, one posture); the later of two refuses, naming the earlier. Adds the refusals to
 * `results` (checkShot's) in place and returns them.
 */
export async function checkSet(results) {
  const sets = new Map();
  for (const r of results) {
    if (r.unreadable) continue;
    const px = await pixelsOf(r.file);
    if (!px) continue;
    const key = `${path.dirname(r.file)}|${px.width}x${px.height}`;
    const sample = sampleOf(px);
    const seen = sets.get(key) || [];
    const twin = seen.find((s) => sampleDifference(s.sample, sample) < DUPLICATE_LOOK);
    if (twin) {
      const d = sampleDifference(twin.sample, sample);
      r.refusals.push({ rule: 'duplicate', reason: `the same picture as ${path.basename(twin.file)} (${(d * 100).toFixed(2)}% differs): two scenes of one set must show different things` });
    } else seen.push({ file: r.file, sample });
    sets.set(key, seen);
  }
  return results;
}

/**
 * A scene's motion allowance from `--motion`: one share for every scene ("0.05"), or per scene
 * ("clock=0.2,board=0.05", a bare share among them the default). Scenes not named keep [MOTION_STILL].
 */
export function motionAllowance(spec, state) {
  if (spec === undefined || spec === null || spec === true || spec === '') return MOTION_STILL;
  let fallback = MOTION_STILL;
  for (const part of String(spec).split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = /^(?:([^=]+)=)?([\d.]+)$/.exec(part);
    const n = m ? Number(m[2]) : NaN;
    if (!m || !(n >= 0 && n <= 1)) throw new Error(`--motion: "${part}" is not a share from 0 to 1, or <state>=<share>`);
    if (!m[1]) fallback = n;
    else if (m[1].trim() === state) return n;
  }
  return fallback;
}

// ---------------------------------------------------------------- one shot, a folder

/**
 * Check one shot: `{ file, refusals: [{ rule, reason }], notes: [] }`. `facts` defaults to the sidecar beside it;
 * `language`/`time` default to the facts' own.
 */
export async function checkShot(file, { facts, language, time, text = true } = {}) {
  const refusals = [];
  const notes = [];
  const m = await captureBlankness(file);
  if (!m) return { file, refusals: [{ rule: 'unreadable', reason: 'not a PNG this tool can decode' }], notes, unreadable: true };
  const blank = m.colours < BLANK_COLOURS && m.dominant > BLANK_DOMINANCE;
  if (blank) {
    refusals.push({ rule: 'blank', reason: `${m.colours} distinct colours, ${(m.dominant * 100).toFixed(1)}% one colour: the app drew nothing` });
  }
  const px = await pixelsOf(file);
  const lb = px && letterboxOf(px);
  if (lb) {
    refusals.push({
      rule: 'letterbox',
      reason: `bars ${lb.bars.join(' and ')} px wide on the ${lb.sides}, the app drawn in a ${lb.box.join('x')} phone-shaped box: the app was letterboxed, not laid out for this screen`,
    });
  }
  const f = facts === undefined ? readFacts(file) : facts;
  if (f) refusals.push(...factRefusals(f));
  else notes.push('no device facts beside it (captured before the checker, or by hand): the device was not asked');
  const lang = language ?? f?.language ?? null;
  if (text) {
    const lines = readText(file, lang);
    if (lines.error) notes.push(`the picture's words were not read: ${lines.error}`);
    else {
      const seen = new Set(refusals.map((r) => r.rule));
      // The device's word on a rule comes first; the picture adds the rules the device did not refuse.
      for (const r of textRefusals(lines, { language: lang, time: time ?? f?.time ?? DEMO_TIME })) if (!seen.has(r.rule)) refusals.push(r);
    }
  }
  if (!lang) notes.push('no language for the set (pass --language): the language was not checked');
  refusals.sort((a, b) => CHECK_RULES.indexOf(a.rule) - CHECK_RULES.indexOf(b.rule));
  return { file, refusals, notes, colours: m.colours, dominant: m.dominant, blank };
}

/** One line per refusal, naming the shot: what `capture` throws and `check` prints. */
export function describeRefusals(results, cwd = process.cwd()) {
  return results.flatMap((r) => r.refusals.map((x) => `${path.relative(cwd, r.file) || r.file}: ${x.rule}: ${x.reason}`));
}
