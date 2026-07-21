#!/usr/bin/env node
/**
 * Build the README / npm demo media — zdymak advertising itself with its own output.
 *
 * Renders `examples/promo.config.mjs` (the device-framed `social-reel`: brand cold-open → three beats →
 * end card) and converts it to a looping GIF, because npm renders images but not video.
 *
 *   npm run demo     → examples/out/{iphone-social-reel,android-play-promo}.mp4  +  docs/demo.gif
 *
 * GIF settings are a deliberate trade: 300px wide @ 12fps with a 128-colour diff palette keeps it under
 * ~3 MB (npm and GitHub both serve it inline without a fight) while the motion still reads. The .mp4 is
 * kept alongside for anywhere that can play video.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The hero sample: six real Android screens in the Android body, ~16s. The iPhone reel (three real
// captures) and the Play promo are rendered alongside as secondary samples.
const src = path.join(root, 'examples/out/android-social-reel.mp4');
const mp4 = path.join(root, 'docs/demo.mp4');
const gif = path.join(root, 'docs/demo.gif');
const WIDTH = 300;
const FPS = 12;
const COLORS = 128;
// The GIF is a taster (npm can't play video): the cold-open + first beats. The full reel is the .mp4.
const GIF_SECONDS = 10;

const run = (cmd, args, label) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`✗ ${label} failed (${cmd} exited ${r.status ?? 'null'}).`);
    process.exit(1);
  }
};

console.log('▶︎ Rendering the promo reels (iPhone + Android, from real captures)…');
run(process.execPath, ['bin/zdymak.mjs', 'build', '--clean', '--config', 'examples/promo.config.mjs'], 'demo render');
if (!fs.existsSync(src)) {
  console.error(`✗ expected ${path.relative(root, src)} — did the target change in promo.config.mjs?`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(mp4), { recursive: true });
fs.copyFileSync(src, mp4); // GitHub renders <video> from the repo; npm renders only the GIF

console.log(`▶︎ Encoding ${path.relative(root, gif)} (${WIDTH}px, ${FPS}fps, ${COLORS} colours, first ${GIF_SECONDS}s)…`);
fs.mkdirSync(path.dirname(gif), { recursive: true });
run(process.env.FFMPEG || 'ffmpeg', [
  '-v', 'error', '-y', '-t', String(GIF_SECONDS), '-i', src,
  '-vf', `fps=${FPS},scale=${WIDTH}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${COLORS}:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`,
  '-loop', '0', gif,
], 'gif encode');

const mb = (fs.statSync(gif).size / 1048576).toFixed(2);
console.log(`✓ ${path.relative(root, mp4)} — ${(fs.statSync(mp4).size / 1048576).toFixed(2)} MB`);
console.log(`✓ ${path.relative(root, gif)} — ${mb} MB`);
// Demo media is git-ignored (see .gitignore) so routine renders don't churn binaries into history.
if (Number(mb) > 5) console.warn('⚠︎ over 5 MB — drop WIDTH/FPS before committing it for a release.');
console.log('  Committing them for a release: git add -f docs/demo.gif docs/demo.mp4');
