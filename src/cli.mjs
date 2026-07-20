/**
 * store-preview CLI.
 *
 *   store-preview video   [--config <path>] [--target <ids>] [--out <dir>]
 *   store-preview specs                       # print the store spec matrix
 *   store-preview capture ...                 # capture screenshots from a running app (see capture/)
 *   store-preview help
 */
import path from 'node:path';
import { registerFonts } from './fonts.mjs';
import { loadConfig } from './config.mjs';
import { buildVideo } from './video.mjs';
import { buildReel } from './reel.mjs';
import { VIDEO_TARGETS, IMAGE_TARGETS, videoTarget } from './specs.mjs';
import { runCapture } from './capture/index.mjs';

function parseFlags(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) flags[a.slice(2)] = argv[++i];
    else rest.push(a);
  }
  return { flags, rest };
}

const DEFAULT_CONFIG = 'store-preview.config.mjs';

async function cmdVideo(flags) {
  const configPath = flags.config || DEFAULT_CONFIG;
  const cfg = await loadConfig(configPath);
  registerFonts(cfg.brand.fontPaths);

  const targets = flags.target ? flags.target.split(',').map((s) => s.trim()) : cfg.targets;
  const outDir = flags.out ? path.resolve(flags.out) : cfg.out;

  console.log(`store-preview • ${cfg.scenes.length} scenes → ${targets.join(', ')}`);
  for (const id of targets) {
    const spec = videoTarget(id);
    const outFile = path.join(outDir, `${id}.mp4`);
    const build = spec.style === 'reel' ? buildReel : buildVideo;
    process.stdout.write(`  • ${id} (${spec.w}×${spec.h}${spec.style === 'reel' ? ', framed reel' : ''}) … `);
    const { totalDur, warnings } = await build({
      scenes: cfg.scenes,
      spec,
      brand: cfg.brand,
      outFile,
      sceneDur: cfg.sceneDur,
      xfade: cfg.xfade,
      timing: cfg.timing,
    });
    console.log(`${totalDur.toFixed(1)}s → ${path.relative(process.cwd(), outFile)}`);
    for (const w of warnings) console.warn(`    ⚠︎ ${w}`);
    console.log(`    ↳ ${spec.slot}`);
  }
  console.log('Done.');
}

function cmdSpecs() {
  console.log('\nVIDEO targets (produce an .mp4):');
  for (const [id, s] of Object.entries(VIDEO_TARGETS)) {
    const dur = s.minSec ? `${s.minSec}–${s.maxSec}s` : 'any length';
    console.log(`  ${id.padEnd(20)} ${s.w}×${s.h} @${s.fps}  H.264 ${s.profile}@${s.level}  ${dur}  — ${s.store}`);
  }
  console.log('\nIMAGE targets (dimensions locked; generation is on the roadmap):');
  for (const [id, s] of Object.entries(IMAGE_TARGETS)) {
    const dim = s.accepts ? s.accepts.map((a) => a.join('×')).join(' | ') : `${s.w}×${s.h}`;
    console.log(`  ${id.padEnd(24)} ${dim}${s.alpha === false ? '  (no alpha)' : ''}  — ${s.store}`);
  }
  console.log('');
}

function cmdHelp() {
  console.log(`store-preview — premium App Store & Google Play previews from screenshots

Usage:
  store-preview video   [--config <path>] [--target <ids>] [--out <dir>]
  store-preview specs
  store-preview capture --platform ios|android --name <screen> [--record] [--out <dir>]
  store-preview help

Defaults: --config ${DEFAULT_CONFIG}. Targets & output come from the config unless overridden.
Needs ffmpeg on PATH (or $FFMPEG). See README.md for the config format, SKILL.md for agent use.`);
}

export async function run(argv = process.argv.slice(2)) {
  const [cmd, ...rest0] = argv;
  const { flags, rest } = parseFlags(rest0);
  try {
    switch (cmd) {
      case 'video': await cmdVideo(flags); break;
      case 'specs': cmdSpecs(); break;
      case 'capture': await runCapture(flags, rest); break;
      case 'help': case undefined: case '--help': case '-h': cmdHelp(); break;
      default:
        console.error(`Unknown command "${cmd}".\n`);
        cmdHelp();
        process.exitCode = 1;
    }
  } catch (e) {
    console.error(`\n✗ ${e.message}`);
    process.exitCode = 1;
  }
}
