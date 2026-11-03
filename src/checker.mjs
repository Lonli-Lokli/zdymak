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
import { captureBlankness, BLANK_COLOURS, BLANK_DOMINANCE } from './validate.mjs';
import { DEMO_TIME, factRefusals, primary, readFacts } from './checker-device.mjs';
import { readText } from './ocr.mjs';

export { OCR_CONFIDENCE, readText } from './ocr.mjs';

export {
  DEMO_TIME, androidFacts, factRefusals, factsPath, iosFacts, parseAndroidFocus, parseAppLocales, parseIosRunning,
  parseKeyboardShown, readFacts, writeFacts,
} from './checker-device.mjs';

/** The rules, in the order a report lists them. */
export const CHECK_RULES = ['unreadable', 'blank', 'launch', 'dialog', 'keyboard', 'wrong-app', 'status-bar', 'language'];

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
