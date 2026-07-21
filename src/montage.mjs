/**
 * LIVE-FOOTAGE reel (montage) — uspamin's ad-video technique, generalized and made source-agnostic.
 *
 * Composite driven video CLIPS (real motion) or IMAGE sequences on a clean matte — floating rounded screen
 * + soft shadow, a headline caption above it, and a short cross-DISSOLVE between beats (Apple App-Preview
 * style; `transition:'cut'` for beat-matched hard cuts). The matte defaults to LIGHT (consistent with the
 * light store screenshots), and STILLS get a slow never-freezing push-in (a frozen still reads as dead).
 * Unlike the premium/social reels — which Ken-Burns a single screenshot — this shows real motion + premium
 * framing. Optional ducked music.
 *
 * Source-agnostic (mirrors zdymak's two screenshot modes): each segment's `clip` / `image` / `images` can be
 * BROUGHT by the user or CAPTURED by `zdymak capture --record`.
 *
 * Config (a `reel` block; `sceneDur`/`bpm`/`beatsPerCut` set the beat-matched hold):
 *   reel: {
 *     bpm: 120, beatsPerCut: 4,                    // hold = beatsPerCut × 60/bpm seconds per segment
 *     transition: 'dissolve' | 'cut', xfadeDur: 0.3,
 *     theme: { ... },                              // matte override; defaults LIGHT + caption on top
 *     music: { path, volume, fadeIn, fadeOut, offset },
 *     segments: [
 *       { clip: './rec/study.mov',   caption: { title, sub } },  // real motion (a recording)
 *       { images: ['a.png','b.png'], caption: { title, sub } },  // multiple photos / page
 *       { image: './shots/welcome.png', caption: { title, sub } }, // one still (gets a slow push-in)
 *     ],
 *   }
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createCanvas } from '@napi-rs/canvas';
import { font, hexA, roundRectPath, fillVerticalGradient, radialGlow, wrapLines } from './canvas.mjs';

// The reel matte defaults to LIGHT — consistent with the light store screenshots (a dark matte behind
// light-theme screens reads as inconsistent). Apple's app marketing favours clean, minimal, untextured
// backgrounds; the screen floats via a soft SHADOW, not a heavy vignette. Override any key via `reel.theme`.
const REEL_LIGHT_DEFAULT = {
  bgTop: '#eef2ef', // soft, faintly cool light
  bgBottom: '#ffffff',
  glow: null, // → brand.sub, kept very subtle on light
  glowAlpha: 0.05,
  vignette: 0, // no filter-y vignette on a light matte
  inset: 0.8,
  radius: 0.05,
  shadow: 0.24, // the float cue on light
  frame: 'phone', // iPhone bezel around the screen (like the framed screenshots); false = bare rounded screen
  label: false, // plain caption text, no pill (matches the light screenshots)
  pillFill: null,
  pillOpacity: 0.9,
  labelColor: '#0b0b0a', // near-black headline
  subColor: '#52606d', // muted slate subhead
  captionAnchor: 'top', // headline ON TOP, matching the store screenshots
};
function resolveReelTheme(brand, theme) {
  const th = { ...REEL_LIGHT_DEFAULT, ...(theme || {}) };
  th.glow = th.glow || brand.sub;
  th.pillFill = th.pillFill || brand.ink;
  return th;
}

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

/** Vertical layout: reserve a BAND for the caption (top or bottom); the screen floats in the remaining
 *  area, so the caption never sits on the app UI. No caption → a thin symmetric matte all round. */
function layout(W, H, hasCaption, inset, top) {
  const capBand = Math.round(H * (hasCaption ? 0.2 : 0.06));
  const otherPad = Math.round(H * 0.06);
  const availTop = top ? capBand : otherPad;
  const availH = H - capBand - otherPad;
  const boxW = Math.round(W * inset);
  const capCenterY = top ? Math.round(H * 0.09) : H - Math.round(capBand * 0.56);
  return { availTop, availH, boxW, capCenterY };
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
/** iPhone frame BACK plate: drop shadow + black unibody at the body rect (its screen area is then covered
 *  by the clip). Proportions mirror `frames.mjs` drawPhoneFrame so the reel matches the framed screenshots. */
function frameBackPng(W, H, bx, by, bw, bh, bodyRadius, screenW) {
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = Math.round(screenW * 0.09);
  ctx.shadowOffsetY = Math.round(screenW * 0.035);
  roundRectPath(ctx, bx, by, bw, bh, bodyRadius);
  ctx.fillStyle = '#0b0b0a';
  ctx.fill();
  ctx.restore();
  return c;
}
/** iPhone Dynamic Island, drawn OVER the clip (front plate). */
function frameFrontPng(W, H, sx, sy, screenW, bezel) {
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  const iw = Math.round(screenW * 0.3);
  const ih = Math.round(screenW * 0.085);
  roundRectPath(ctx, Math.round(sx + (screenW - iw) / 2), Math.round(sy + bezel * 1.1), iw, ih, ih / 2);
  ctx.fillStyle = '#050505';
  ctx.fill();
  return c;
}
/** A fully transparent full frame — the front plate when there's no device frame (keeps input indices stable). */
function transparentPng(W, H) {
  return createCanvas(W, H);
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
  if (caption.title && th.label) {
    // pill treatment (dark bed) — only when `label` is on; on a light matte it'd be dark-on-dark
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
  } else if (caption.title) {
    // plain bold headline (matches the light store screenshots)
    ctx.font = font(titleSize, 'bold');
    ctx.fillStyle = th.labelColor;
    ctx.fillText(caption.title, cx, y);
    y += titleSize * 0.62 + subSize * 1.15;
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
  const framed = th.frame && th.frame !== 'none' && th.frame !== false;

  // Geometry. Framed: fit the SCREEN so the phone BODY (screen + 2×bezel ≈ 6.4%) still fits the box.
  const [fw, fh] = framed
    ? fit(sw, sh, Math.round(lay.boxW / 1.064), Math.round(lay.availH / 1.064))
    : fit(sw, sh, lay.boxW, lay.availH);
  const bezel = framed ? Math.round(fw * 0.032) : 0;
  const bodyW = fw + bezel * 2;
  const bodyH = fh + bezel * 2;
  const bodyX = Math.round((W - bodyW) / 2);
  const bodyY = Math.round(lay.availTop + (lay.availH - bodyH) / 2);
  const sx = bodyX + bezel; // the screen (clip) top-left
  const sy = bodyY + bezel;
  const screenRadius = framed ? Math.round(fw * 0.135) : Math.round(W * th.radius);

  const tag = `${idx}${sub != null ? `_${sub}` : ''}`;
  const maskP = path.join(tmp, `mask-${tag}.png`);
  const backP = path.join(tmp, `back-${tag}.png`); // shadow + phone body (framed) OR a plain drop shadow
  const frontP = path.join(tmp, `front-${tag}.png`); // Dynamic Island (framed) OR transparent
  writePng(maskPng(fw, fh, screenRadius), maskP);
  if (framed) {
    writePng(frameBackPng(W, H, bodyX, bodyY, bodyW, bodyH, Math.round(fw * 0.155), fw), backP);
    writePng(frameFrontPng(W, H, sx, sy, fw, bezel), frontP);
  } else {
    writePng(shadowPng(W, H, sx, sy, fw, fh, screenRadius, th.shadow), backP);
    writePng(transparentPng(W, H), frontP);
  }
  const out = path.join(tmp, `seg-${tag}.mp4`);

  // A video plays its own motion; a STILL gets a slow, never-freezing push-in (a frozen still reads as
  // dead — the Ken-Burns trap Apple avoids by keeping the camera always subtly moving).
  const frames = Math.ceil(dur * fps) + 4;
  const screenFilter = vid
    ? `[1:v]scale=${fw}:${fh},setsar=1,format=rgba[s]`
    : `[1:v]scale=${Math.round(fw * 1.14)}:${Math.round(fh * 1.14)},zoompan=z='min(zoom+0.0008,1.12)':`
      + `d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${fw}x${fh}:fps=${fps},setsar=1,format=rgba[s]`;

  // Inputs: 0 matte · 1 src · 2 mask · 3 back(shadow+body) · 4 front(island) · 5 caption · 6 vignette
  const srcIn = vid ? ['-i', src] : ['-loop', '1', '-i', src];
  const args = [
    '-loop', '1', '-i', mattePath,
    ...srcIn,
    '-loop', '1', '-i', maskP,
    '-loop', '1', '-i', backP,
    '-loop', '1', '-i', frontP,
    '-loop', '1', '-i', captionPath,
    '-loop', '1', '-i', vignettePath,
    '-filter_complex',
    [
      screenFilter,
      `[s][2:v]alphamerge[scr]`, //           round the screen's corners to the phone-screen radius
      `[0:v]scale=${W}:${H},setsar=1[bg]`,
      `[bg][3:v]overlay=0:0[b0]`, //          shadow + phone body (framed) / plain shadow
      // the floating screen plays here; eof_action=repeat holds the last frame if the clip is shorter
      `[b0][scr]overlay=${sx}:${sy}:eof_action=repeat[b1]`,
      `[b1][4:v]overlay=0:0[b2]`, //          Dynamic Island over the screen (transparent if unframed)
      `[b2][5:v]overlay=0:0[b3]`, //          caption
      `[b3][6:v]overlay=0:0,` + //            vignette
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
export async function buildMontage({ segments, brand, theme, spec, music, sceneDur, bpm, beatsPerCut, transition, xfadeDur, outFile }) {
  const th = resolveReelTheme(brand, theme);
  const W = spec.w;
  const H = spec.h;
  const fps = spec.fps || 30;
  const hold = sceneDur || (bpm ? (beatsPerCut || 4) * 60 / bpm : 3.0);
  // Dissolve by default (Apple App-Preview style — restrained, never a jarring hard cut); `transition:'cut'`
  // gives beat-matched hard cuts. `tail` extends each segment so the xfade always has overlap material.
  const D = transition === 'cut' ? 0 : (xfadeDur ?? 0.3);
  const tail = D > 0 ? D + 0.2 : 0;

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
      const lay = layout(W, H, hasCap, th.inset, th.captionAnchor === 'top');
      const captionPath = path.join(tmp, `cap-${i}.png`);
      writePng(captionPng(W, H, seg.caption, th, lay.capCenterY), captionPath);
      const sources = seg.images || (seg.clip ? [seg.clip] : seg.image ? [seg.image] : []);
      if (!sources.length) throw new Error(`reel segment[${i}] needs a clip, image, or images`);
      const per = hold / sources.length;
      const subs = sources.map((src, j) => compositeSource({
        // the LAST sub of the segment carries the dissolve tail so the segment has xfade overlap material
        src, dur: per + (j === sources.length - 1 ? tail : 0), W, H, fps, th, tmp,
        idx: i, sub: sources.length > 1 ? j : null, lay, mattePath, vignettePath, captionPath,
      }));
      segClips.push({ file: concatClips(subs, tmp, i), palette: seg.palette ?? null });
    });

    // 2) assemble. NORMALIZE every segment first (fps / timebase / format / SAR) so VFR `recordVideo`
    //    clips and image stills mix cleanly. All-hard-cut reels CONCAT end-to-end (robust — no fragile
    //    near-zero-margin xfade offsets); a palette change uses an xfade dissolve on those boundaries.
    const inputs = [];
    segClips.forEach((s) => inputs.push('-i', s.file));

    let filter = '';
    segClips.forEach((_, i) => {
      filter += `[${i}:v]fps=${fps},format=yuv420p,setsar=1,settb=AVTB,setpts=PTS-STARTPTS[n${i}];`;
    });

    let totalDur;
    if (segClips.length === 1) {
      filter += '[n0]copy[vout];';
      totalDur = hold;
    } else if (D === 0) {
      // transition:'cut' → robust end-to-end concat (beat-matched hard cuts)
      filter += `${segClips.map((_, i) => `[n${i}]`).join('')}concat=n=${segClips.length}:v=1[vout];`;
      totalDur = segClips.length * hold;
    } else {
      // dissolve → xfade chain; each shows solo for `hold`, then a D-second cross-dissolve into the next
      let cur = 'n0';
      let offset = 0;
      for (let i = 1; i < segClips.length; i++) {
        offset += hold;
        const out = i === segClips.length - 1 ? 'vout' : `x${i}`;
        filter += `[${cur}][n${i}]xfade=transition=fade:duration=${D.toFixed(3)}:offset=${offset.toFixed(3)}[${out}];`;
        cur = out;
      }
      totalDur = segClips.length * hold + tail;
    }

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
