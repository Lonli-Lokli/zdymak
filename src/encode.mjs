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

  args.push(
    '-c:v', 'libx264', '-profile:v', spec.profile, '-level:v', spec.level,
    '-pix_fmt', 'yuv420p', '-crf', '17', '-maxrate', '12M', '-bufsize', '12M',
    '-preset', 'slow', '-r', String(fps), '-movflags', '+faststart',
    ...(hasAudio ? ['-c:a', 'aac', '-b:a', '192k'] : ['-an']),
    outFile,
  );

  const proc = spawn(process.env.FFMPEG || 'ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => {
    proc.on('close', (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exited ${code}`))));
    proc.on('error', (e) => rej(new Error(`ffmpeg failed to start (${e.message}). Is ffmpeg on PATH or $FFMPEG set?`)));
  });
  return { proc, done, hasAudio };
}
