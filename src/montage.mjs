/**
 * LIVE-FOOTAGE reel (montage) — uspamin's ad-video technique, generalized and made source-agnostic.
 *
 * Composite driven video CLIPS (real motion) or IMAGE sequences on a constant brand matte, HARD-CUT on the
 * music beat (a soft dissolve only at a palette shift), with a floating rounded screen + shadow, kinetic
 * caption pill, vignette, and optional ducked music. Unlike the premium/social reels — which Ken-Burns a
 * single static screenshot — this shows REAL motion, so it reads premium.
 *
 * Source-agnostic (mirrors zdymak's two screenshot modes): each segment's `clip` / `image` / `images` can be
 * BROUGHT by the user or CAPTURED by `zdymak capture --record`. The engine treats any moving mp4 or still
 * the same way.
 *
 * Config (a `reel` block; `sceneDur`/`bpm`/`beatsPerCut` set the beat-matched hold):
 *   reel: {
 *     bpm: 120, beatsPerCut: 4,                 // hold = beatsPerCut × 60/bpm seconds per segment
 *     music: { path, volume, fadeIn, fadeOut, offset },
 *     segments: [
 *       { clip: './rec/study.mov',  caption: { title, sub }, palette: 'a' },   // real motion
 *       { images: ['a.png','b.png'], caption: { title, sub }, palette: 'a' },  // multiple photos / page
 *       { image: './shots/welcome.png', caption: { title, sub } },             // one still
 *     ],
 *   }
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createCanvas } from '@napi-rs/canvas';
import { font, hexA, roundRectPath, fillVerticalGradient, radialGlow, wrapLines } from './canvas.mjs';
import { resolvePremiumTheme } from './premium.mjs';

const FF = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || 'ffprobe';

function ff(args) {
  const r = spawnSync(FF, ['-y', '-loglevel', 'error', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.status !== 0) throw new Error(`ffmpeg failed (exit ${r.status})`);
}
function probe(file, entries) {
  const r = spawnSync(FFPROBE, ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', entries, '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' });
  return String(r.stdout || '').trim().split('\n');
}
const isVideo = (p) => /\.(mov|mp4|m4v|webm|mkv)$/i.test(p);

/** Contain-fit (w,h) into the inset box of the frame, preserving the source aspect. */
function fit(srcW, srcH, boxW, boxH) {
  const a = srcH / srcW;
  let w = boxW;
  let h = Math.round(boxW * a);
  if (h > boxH) {
    h = boxH;
    w = Math.round(boxH / a);
  }
  return [w % 2 ? w + 1 : w, h % 2 ? h + 1 : h];
}

/** Vertical layout: reserve a bottom BAND for the caption; the screen floats in the area above it (so the
 *  caption never sits on the app UI). No caption → a thin symmetric matte all round. */
function layout(W, H, hasCaption, inset) {
  const topPad = Math.round(H * 0.06);
  const band = Math.round(H * (hasCaption ? 0.2 : 0.06));
  const availH = H - topPad - band;
  const boxW = Math.round(W * inset);
  return { availTop: topPad, availH, boxW, capCenterY: H - Math.round(band * 0.56) };
}

// ── Canvas furniture (rendered once / per segment, written as PNGs for ffmpeg overlay) ───────────────────
function writePng(canvas, file) {
  fs.writeFileSync(file, canvas.toBuffer('image/png'));
}
function mattePng(W, H, th) {
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  fillVerticalGradient(ctx, W, H, th.bgTop, th.bgBottom);
  radialGlow(ctx, W * 0.5, H * 0.4, W * 0.85, th.glow, th.glowAlpha);
  return c;
}
function vignettePng(W, H, strength) {
  const c = createCanvas(W, H);
  if (strength > 0) {
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.max(W, H) * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${strength})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  return c;
}
/** Opaque grayscale mask (white rounded-rect on black) — its luma becomes the screen's alpha via
 *  `alphamerge`, rounding the corners. Must be OPAQUE (not transparent) so ffmpeg reads a clean luma. */
function maskPng(w, h, radius) {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  roundRectPath(ctx, 0, 0, w, h, radius);
  ctx.fillStyle = '#fff';
  ctx.fill();
  return c;
}
/** A soft drop-shadow for the floating screen, at its placed rect, on a transparent full frame. */
function shadowPng(W, H, x, y, w, h, radius, alpha) {
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.save();
  ctx.shadowColor = `rgba(0,0,0,${alpha})`;
  ctx.shadowBlur = Math.round(W * 0.045);
  ctx.shadowOffsetY = Math.round(W * 0.012);
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.restore();
  return c;
}
/** Bottom caption pill + subtitle (Apple launch-montage label) on a transparent full frame. */
function captionPng(W, H, caption, th, capCenterY) {
  const c = createCanvas(W, H);
  if (!caption || (!caption.title && !caption.sub)) return c;
  const ctx = c.getContext('2d');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const titleSize = Math.round(Math.min(W, H * 0.9) * 0.05);
  const subSize = Math.round(Math.min(W, H * 0.9) * 0.033);
  const cx = W / 2;
  let y = capCenterY;
  if (caption.title) {
    ctx.font = font(titleSize, 'bold');
    const tw = ctx.measureText(caption.title).width;
    const padX = Math.round(titleSize * 0.7);
    const padY = Math.round(titleSize * 0.42);
    const pillW = tw + padX * 2;
    const pillH = titleSize + padY * 2;
    roundRectPath(ctx, cx - pillW / 2, y - pillH / 2, pillW, pillH, pillH / 2);
    ctx.fillStyle = hexA(th.pillFill, th.pillOpacity);
    ctx.fill();
    ctx.fillStyle = th.labelColor;
    ctx.fillText(caption.title, cx, y + 1);
    y += pillH / 2 + subSize * 1.15;
  }
  if (caption.sub) {
    ctx.font = font(subSize, 'regular');
    ctx.fillStyle = th.subColor;
    for (const ln of wrapLines(ctx, caption.sub, W * 0.82)) {
      ctx.fillText(ln, cx, y);
      y += subSize * 1.3;
    }
  }
  return c;
}

// ── Per-segment composite: one source (clip or still) floating on the matte, captioned ───────────────────
/**
 * Composite ONE source (video clip or still image) onto the matte for `dur` seconds → an intermediate mp4.
 * A video plays its real motion (held on the last frame if shorter than `dur`); a still holds.
 */
function compositeSource({ src, dur, W, H, fps, th, tmp, idx, sub, lay, mattePath, vignettePath, captionPath }) {
  const vid = isVideo(src);
  const [sw, sh] = probe(src, 'stream=width,height').map(Number); // ffprobe reads video + image dims alike
  const [fw, fh] = fit(sw, sh, lay.boxW, lay.availH);
  const x = Math.round((W - fw) / 2);
  const y = Math.round(lay.availTop + (lay.availH - fh) / 2); // float in the area above the caption band
  const radius = Math.round(W * th.radius);

  const tag = `${idx}${sub != null ? `_${sub}` : ''}`;
  const maskP = path.join(tmp, `mask-${tag}.png`);
  const shadowP = path.join(tmp, `shadow-${tag}.png`);
  writePng(maskPng(fw, fh, radius), maskP);
  writePng(shadowPng(W, H, x, y, fw, fh, radius, th.shadow), shadowP);
  const out = path.join(tmp, `seg-${tag}.mp4`);

  // Inputs: 0 matte(loop) · 1 src(clip loop-still/video) · 2 mask(loop) · 3 shadow(loop) · 4 caption(loop) · 5 vignette(loop)
  const srcIn = vid
    ? ['-i', src]
    : ['-loop', '1', '-i', src];
  const args = [
    '-loop', '1', '-i', mattePath,
    ...srcIn,
    '-loop', '1', '-i', maskP,
    '-loop', '1', '-i', shadowP,
    '-loop', '1', '-i', captionPath,
    '-loop', '1', '-i', vignettePath,
    '-filter_complex',
    [
      `[1:v]scale=${fw}:${fh},setsar=1,format=rgba[s]`,
      `[s][2:v]alphamerge[scr]`, //           round the screen's corners
      `[0:v]scale=${W}:${H},setsar=1[bg]`,
      `[bg][3:v]overlay=0:0[b0]`, //          drop shadow under the screen
      // the floating screen (its motion plays here); eof_action=repeat holds the last frame if the clip
      // is shorter than the beat, so a short recording still fills its slot instead of truncating.
      `[b0][scr]overlay=${x}:${y}:eof_action=repeat[b1]`,
      `[b1][4:v]overlay=0:0[b2]`, //          caption pill
      `[b2][5:v]overlay=0:0,` + //            vignette
      `trim=0:${dur.toFixed(3)},setpts=PTS-STARTPTS,fps=${fps},format=yuv420p[v]`,
    ].join(';'),
    '-map', '[v]', '-t', dur.toFixed(3),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', out,
  ];
  ff(args);
  return out;
}

/** Concat several already-composited sub-clips (used for an `images` segment) into one segment clip. */
function concatClips(clips, tmp, idx) {
  if (clips.length === 1) return clips[0];
  const listFile = path.join(tmp, `list-${idx}.txt`);
  fs.writeFileSync(listFile, clips.map((c) => `file '${c}'`).join('\n'));
  const out = path.join(tmp, `seg-${idx}-joined.mp4`);
  ff(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', out]);
  return out;
}

/**
 * Build one live-footage reel. `segments[]` each carry a `clip` | `image` | `images` source + `caption` +
 * optional `palette`. Hard cuts between same-palette neighbours, a short dissolve at a palette change.
 */
export async function buildMontage({ segments, brand, theme, spec, music, sceneDur, bpm, beatsPerCut, outFile }) {
  const th = resolvePremiumTheme(brand, theme);
  const W = spec.w;
  const H = spec.h;
  const fps = spec.fps || 30;
  const hold = sceneDur || (bpm ? (beatsPerCut || 4) * 60 / bpm : 3.0);
  const HARD = Math.max(1 / fps, 0.04); // ~1 frame = a hard cut, done through xfade for one linear chain
  const SOFT = 0.24; //                    a real dissolve, only at a palette shift

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zdymak-montage-'));
  try {
    const mattePath = path.join(tmp, 'matte.png');
    const vignettePath = path.join(tmp, 'vignette.png');
    writePng(mattePng(W, H, th), mattePath);
    writePng(vignettePng(W, H, th.vignette), vignettePath);

    // 1) composite every segment (a clip, one image, or an image sequence) → an intermediate clip.
    const segClips = [];
    segments.forEach((seg, i) => {
      const hasCap = !!(seg.caption && (seg.caption.title || seg.caption.sub));
      const lay = layout(W, H, hasCap, th.inset);
      const captionPath = path.join(tmp, `cap-${i}.png`);
      writePng(captionPng(W, H, seg.caption, th, lay.capCenterY), captionPath);
      const sources = seg.images || (seg.clip ? [seg.clip] : seg.image ? [seg.image] : []);
      if (!sources.length) throw new Error(`reel segment[${i}] needs a clip, image, or images`);
      const per = hold / sources.length;
      const subs = sources.map((src, j) => compositeSource({
        src, dur: per, W, H, fps, th, tmp,
        idx: i, sub: sources.length > 1 ? j : null, lay, mattePath, vignettePath, captionPath,
      }));
      segClips.push({ file: concatClips(subs, tmp, i), palette: seg.palette ?? null });
    });

    // 2) xfade chain — hard cut by default, soft dissolve only where the palette changes.
    const inputs = [];
    segClips.forEach((s) => inputs.push('-i', s.file));
    let filter = '';
    let cur = '0:v';
    let offset = 0;
    for (let i = 1; i < segClips.length; i++) {
      const dur = (segClips[i - 1].palette && segClips[i].palette && segClips[i - 1].palette !== segClips[i].palette)
        ? SOFT : HARD;
      offset += hold - dur;
      const out = i === segClips.length - 1 ? 'vout' : `x${i}`;
      filter += `[${cur}][${i}:v]xfade=transition=fade:duration=${dur.toFixed(3)}:offset=${offset.toFixed(3)}[${out}];`;
      cur = out;
    }
    if (segClips.length === 1) filter = '[0:v]copy[vout];';
    const totalDur = hold + (segClips.length - 1) * hold - segClips.slice(1).reduce((a, _, i) => {
      const dur = (segClips[i].palette && segClips[i + 1].palette && segClips[i].palette !== segClips[i + 1].palette) ? SOFT : HARD;
      return a + dur;
    }, 0);

    // 3) optional music bed (trim/loop to length, fade, volume).
    const audioArgs = [];
    let map = ['-map', '[vout]'];
    if (music?.path) {
      inputs.push('-stream_loop', '-1', '-i', music.path);
      const ai = segClips.length;
      const fadeOut = music.fadeOut ?? 0.6;
      const a = [
        `[${ai}:a]atrim=${(music.offset || 0).toFixed(3)}:${(( music.offset || 0) + totalDur).toFixed(3)},asetpts=PTS-STARTPTS`,
        `volume=${music.volume ?? 0.9}`,
        `afade=t=in:st=0:d=${(music.fadeIn ?? 0.6)}`,
        `afade=t=out:st=${Math.max(0, totalDur - fadeOut).toFixed(3)}:d=${fadeOut}[aout]`,
      ].join(',');
      filter += a;
      map = ['-map', '[vout]', '-map', '[aout]'];
      audioArgs.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
    }

    ff([
      ...inputs,
      '-filter_complex', filter.replace(/;$/, ''),
      ...map,
      '-c:v', 'libx264', '-profile:v', spec.profile || 'high', '-level:v', spec.level || '4.0',
      '-pix_fmt', 'yuv420p', '-crf', '17', '-preset', 'slow', '-r', String(fps), '-movflags', '+faststart',
      ...audioArgs,
      outFile,
    ]);
    return { outFile, totalDur, warnings: [] };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
