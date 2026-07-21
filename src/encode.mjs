/**
 * Shared H.264 encoder — one place every video builder (bleed / reel / premium) pipes raw RGBA frames to.
 * Handles the store-safe encode (High profile at the target level, yuv420p, faststart) and the optional
 * MUSIC bed with the same knobs across all styles: offset into the track, fade-in / fade-out, volume.
 *
 * music = { path, offset=0, fadeIn=0.6, fadeOut=0.8, volume=1 }  (all optional except path)
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

/** Start the ffmpeg process reading rawvideo from stdin. Returns { proc, done, hasAudio }. */
/**
 * Smallest H.264 level that fits this frame size + rate (macroblocks and MB/s per Annex A), floored at
 * the target's own level so we never *under*-declare what a store asked for.
 */
function h264Level(W, H, fps, floor) {
  const mbs = Math.ceil(W / 16) * Math.ceil(H / 16);
  const rate = mbs * fps;
  const TABLE = [
    ['3.0', 1620, 40500], ['3.1', 3600, 108000], ['3.2', 5120, 216000],
    ['4.0', 8192, 245760], ['4.1', 8192, 245760], ['4.2', 8704, 522240],
    ['5.0', 22080, 589824], ['5.1', 36864, 983040], ['5.2', 36864, 2073600],
    ['6.0', 139264, 4177920],
  ];
  const fit = TABLE.find(([, maxMbs, maxRate]) => mbs <= maxMbs && rate <= maxRate);
  const chosen = fit ? fit[0] : '6.2';
  return Number(chosen) > Number(floor || 0) ? chosen : floor;
}

export function spawnEncoder({ W, H, fps, spec, outFile, music, totalDur }) {
  const hasAudio = !!(music && music.path && fs.existsSync(music.path));
  const args = [
    '-y', '-loglevel', 'error',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(fps), '-i', '-',
  ];

  if (hasAudio) {
    const offset = Number(music.offset) || 0;
    if (offset > 0) args.push('-ss', String(offset)); // seek INTO the track before it's used as input
    args.push('-i', music.path);
    const vol = music.volume ?? 1;
    const fi = music.fadeIn ?? 0.6;
    const fo = music.fadeOut ?? 0.8;
    const outStart = Math.max(0, totalDur - fo).toFixed(2);
    args.push('-af', `volume=${vol},afade=t=in:st=0:d=${fi},afade=t=out:st=${outStart}:d=${fo}`, '-shortest');
  }

  // LEVEL must follow the ACTUAL frame size, not the target's default. A device `size` override (e.g. the
  // Mac reel at 2880×1800) exceeds the base target's level, and libx264 will still stamp the requested
  // level_idc into the SPS — a stream that says it's Level 4.1 while carrying 20k macroblocks. Players
  // mostly cope; strict validators and hardware decoders need not. Recompute, and never go below the spec.
  const level = h264Level(W, H, fps, spec.level);
  args.push(
    '-c:v', 'libx264', '-profile:v', spec.profile, '-level:v', level,
    // CRF 15, not 17: the stores re-encode whatever you upload, so the master needs headroom — flat UI
    // gradients are exactly where banding appears after that second pass.
    '-pix_fmt', 'yuv420p', '-crf', '15', '-maxrate', '12M', '-bufsize', '12M',
    '-preset', 'slow', '-r', String(fps), '-movflags', '+faststart',
    // Apple's App Preview spec: stereo AAC at 256 kbps. `-ac 2` guards a mono source.
    ...(hasAudio ? ['-c:a', 'aac', '-b:a', '256k', '-ac', '2'] : ['-an']),
    outFile,
  );

  const proc = spawn(process.env.FFMPEG || 'ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => {
    proc.on('close', (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exited ${code}`))));
    proc.on('error', (e) => rej(new Error(`ffmpeg failed to start (${e.message}). Is ffmpeg on PATH or $FFMPEG set?`)));
  });
  return { proc, done, hasAudio };
}
