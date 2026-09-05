/**
 * Destination validation — the check behind the "encoded to spec" claim.
 *
 * Every produced asset is measured against the destination's own rules and REFUSED if it would be
 * rejected: wrong pixel size, an alpha channel where the store forbids one, a duration outside the
 * accepted window, a file over the size cap. `--force` writes it anyway.
 *
 * This runs on the artefact, not on our intent — it re-reads the file (ffprobe for video, the PNG
 * header for stills), so a bug in the renderer or the encoder is caught rather than trusted.
 */
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { loadImage, createCanvas } from '@napi-rs/canvas';

/** Read width/height/duration back out of an encoded video. */
export function probeVideo(file) {
  const r = spawnSync(process.env.FFPROBE || 'ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,codec_name,profile,level',
    '-show_entries', 'format=duration,size',
    '-of', 'json', file,
  ], { encoding: 'utf8' });
  if (r.status !== 0) return null; // ffprobe missing → skip validation rather than fail the build
  try {
    const j = JSON.parse(r.stdout);
    const s = j.streams?.[0] || {};
    return {
      w: s.width, h: s.height, codec: s.codec_name, profile: s.profile, level: s.level,
      duration: Number(j.format?.duration), bytes: Number(j.format?.size),
    };
  } catch {
    return null;
  }
}

/** PNG colour type from the IHDR (byte 25): 2 = RGB, 6 = RGBA. Cheap — reads 26 bytes. */
export function pngInfo(file) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(26);
  fs.readSync(fd, buf, 0, 26, 0);
  fs.closeSync(fd);
  if (buf.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), colourType: buf[25] };
}

const sizeAccepted = (dest, w, h) => {
  if (dest.accepts?.length) return dest.accepts.some(([aw, ah]) => aw === w && ah === h);
  if (dest.w && dest.h) return dest.w === w && dest.h === h;
  return true;
};

/**
 * `subject` names what is wrong with WHAT. It used to be the fixed phrase "violates its
 * destination", which is right for a written asset and wrong for a capture — a capture has no
 * destination, it is an input. The `✗` also left with it: `cli.mjs` prints its own on the way out,
 * so every refusal was announced twice.
 */
function fail(violations, file, force, subject = 'violates its destination') {
  const msg = `${file} ${subject}:\n` + violations.map((v) => `    • ${v}`).join('\n');
  if (force) {
    console.warn('✗ ' + msg + '\n  (--force: written anyway)');
    return;
  }
  throw new Error(msg + '\n  Fix it, or pass --force to proceed regardless.');
}

/** Validate an encoded video against its destination. Throws unless `force`. */
export function validateVideo({ file, destination, size, force }) {
  const info = probeVideo(file);
  if (!info) return;
  const v = [];
  const [w, h] = size || [destination.w, destination.h];
  if (info.w !== w || info.h !== h) v.push(`size ${info.w}×${info.h}, expected ${w}×${h}`);
  // Duration bounds are the rule people actually trip: App Store Connect refuses <15s or >30s outright.
  if (destination.minSec && info.duration < destination.minSec - 0.05) {
    v.push(`duration ${info.duration.toFixed(1)}s is under ${destination.store}'s ${destination.minSec}s minimum`);
  }
  if (destination.maxSec && info.duration > destination.maxSec + 0.05) {
    v.push(`duration ${info.duration.toFixed(1)}s exceeds ${destination.store}'s ${destination.maxSec}s maximum`);
  }
  if (destination.maxBytes && info.bytes > destination.maxBytes) {
    v.push(`${(info.bytes / 1048576).toFixed(0)}MB exceeds the ${(destination.maxBytes / 1048576).toFixed(0)}MB cap`);
  }
  if (v.length) fail(v, file, force);
}

/** Validate a written still against its destination. Throws unless `force`. */
export function validateImage({ file, destination, size, force }) {
  const info = pngInfo(file);
  if (!info) return;
  const v = [];
  const [w, h] = size || [destination.w, destination.h];
  if (size || destination.w) {
    if (info.w !== w || info.h !== h) v.push(`size ${info.w}×${info.h}, expected ${w}×${h}`);
  } else if (!sizeAccepted(destination, info.w, info.h)) {
    v.push(`size ${info.w}×${info.h} is not one of the accepted sizes`);
  }
  // Alpha is the classic rejection: "Images can't contain alpha channels or transparencies."
  const hasAlpha = info.colourType === 6 || info.colourType === 4;
  if (hasAlpha && !destination.alpha) v.push('has an alpha channel; this destination forbids transparency');
  if (destination.maxBytes && fs.statSync(file).size > destination.maxBytes) {
    v.push(`over the ${(destination.maxBytes / 1024).toFixed(0)}KB cap`);
  }
  if (v.length) fail(v, file, force);
}

/**
 * **Is there a screen in this capture?** — measured on the INPUT, before anything is composed.
 *
 * Palon shipped a blank screenshot: a device frame containing pure white and an iOS status bar,
 * uploaded to a version that reached App Store review. Everything downstream was faithful — a
 * capture tool photographs what the app draws and cannot know what it should have drawn, the
 * compositor framed it, the uploader uploaded it. Nothing looked at the pixels.
 *
 * ### Why the CAPTURE and not the composed still
 *
 * The obvious place is [validateImage], next to the size and alpha rules, and it was tried there
 * first. It does not work, and the reason is worth keeping. A composed still is a device frame on a
 * background with a caption band, so any measurement of it depends on the composition: a wide crop
 * catches the background gradient — zdymak's own inset demo layout scored 204 on a frame whose
 * screen was pure white — and a tight crop catches only screen, where a genuinely sparse
 * screenshot is indistinguishable from an empty one. Measured across the portfolio there is no crop
 * at which every blank scores below every real screen; the quietest real one landed on 9, exactly
 * where the blanks were.
 *
 * A capture has no frame, no background and no caption. It is the app's screen and nothing else, so
 * it needs no crop and no assumption about layout, and the separation is unambiguous: blanks
 * measured 1 and 199 distinct colours at 100% and 98.7% single-colour, while real screens measured
 * 781 to 4727 at 78% down to 9%.
 *
 * ### Two signals, because either alone has a false positive
 *
 * A legitimately minimal screen can be low on colours; a legitimately flat one (a loading state, a
 * solid-brand splash) can be dominated by a single colour. A screen that is BOTH is one that drew
 * nothing. Requiring both is what lets the thresholds sit close to the failure without risking a
 * refusal of real art — and a false "blank" would be worse than the gap this closes, because it
 * would block a release on a correct file.
 */
export async function captureBlankness(file) {
  let img;
  try {
    img = await loadImage(file);
  } catch {
    return null; // unreadable here is not a verdict
  }
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, img.width, img.height).data;
  const counts = new Map();
  let total = 0;
  // Every 2nd pixel. Sampling matters: at every 4th, the quietest genuine screen in the portfolio
  // lost two thirds of its distinct colours while the blank stayed at 1.
  for (let y = 0; y < img.height; y += 2) {
    for (let x = 0; x < img.width; x += 2) {
      const i = (y * img.width + x) * 4;
      const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      counts.set(key, (counts.get(key) || 0) + 1);
      total++;
    }
  }
  let top = 0;
  for (const c of counts.values()) if (c > top) top = c;
  return { colours: counts.size, dominant: top / total };
}

/** Under this many distinct colours AND over [BLANK_DOMINANCE] of one colour: nothing was drawn. */
export const BLANK_COLOURS = 400;
export const BLANK_DOMINANCE = 0.95;

/**
 * Refuse a capture that is a picture of an empty screen. Throws unless `force`, like every other
 * rule here — `--force` is the same escape hatch, because there is no reason this one should be
 * harder to override than a size violation.
 */
export async function validateCapture({ file, force }) {
  const m = await captureBlankness(file);
  if (!m) return;
  if (m.colours < BLANK_COLOURS && m.dominant > BLANK_DOMINANCE) {
    fail([
      `is BLANK — ${m.colours} distinct colours and ${(m.dominant * 100).toFixed(1)}% of the ` +
      'screen a single colour, so the app drew nothing. Re-capture; composing this produces a ' +
      'device frame around an empty screen, which is what reaches the store',
    ], file, force, 'is not a usable capture');
  }
}
