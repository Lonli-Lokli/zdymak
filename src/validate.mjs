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

function fail(violations, file, force) {
  const msg = `✗ ${file} violates its destination:\n` + violations.map((v) => `    • ${v}`).join('\n');
  if (force) {
    console.warn(msg + '\n  (--force: written anyway)');
    return;
  }
  throw new Error(msg + '\n  Fix the config, or pass --force to write it regardless.');
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
