/**
 * zdymak CLI.
 *
 *   zdymak build       [--config <path>] [--out <dir>]   # EVERYTHING in the config: videos + screenshots
 *   zdymak video       [--config <path>] [--target <ids>] [--out <dir>]
 *   zdymak screenshots [--config <path>] [--out <dir>]   # per-device store screenshots
 *   zdymak specs                                          # print the store spec matrix
 *   zdymak capture --platform ios|android --name <screen> [--record] [--out <dir>]
 *   zdymak help
 */
import path from 'node:path';
import fs from 'node:fs';
import { registerFonts } from './fonts.mjs';
import { loadConfig } from './config.mjs';
import { buildVideo } from './video.mjs';
import { buildReel } from './reel.mjs';
import { buildPremium } from './premium.mjs';
import { buildMontage } from './montage.mjs';
import { buildDeviceScreenshots } from './screenshots.mjs';
import { VIDEO_TARGETS, IMAGE_TARGETS, videoTarget } from './specs.mjs';
import { runCapture } from './capture/index.mjs';

function parseFlags(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const next = argv[i + 1];
      // Boolean flag when followed by nothing or another --flag (e.g. `--build --project …`); else it
      // takes the next token as its value. Single-dash values like `-marketingScreen` ARE values.
      if (next === undefined || next.startsWith('--')) flags[a.slice(2)] = true;
      else flags[a.slice(2)] = argv[++i];
    } else {
      rest.push(a);
    }
  }
  return { flags, rest };
}

const DEFAULT_CONFIG = 'zdymak.config.mjs';

async function open(flags) {
  const cfg = await loadConfig(flags.config || DEFAULT_CONFIG);
  registerFonts(cfg.brand.fontPaths);
  const outDir = flags.out ? path.resolve(flags.out) : cfg.out;
  // --clean wipes the output folder first, so a run can't leave stale assets from a removed target/scene
  // behind (every screenshot/video in the folder is then freshly produced by THIS run).
  if (flags.clean && fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
    console.log(`🧹 cleaned ${path.relative(process.cwd(), outDir) || outDir}`);
  }
  return { cfg, outDir };
}

/** Warn when the audio expectation and the config disagree: a video/reel that should carry a music score
 *  has none (Apple recommends a single score for continuity), or `music` is set where nothing consumes it. */
function warnAudio({ videoCount, hasMusic, label }) {
  if (videoCount > 0 && !hasMusic) {
    console.warn(`⚠︎ audio: ${label} ${videoCount === 1 ? 'plays' : 'play'} SILENT — no music. Apple recommends a single music score for continuity; set \`music.path\`.`);
  }
  if (videoCount === 0 && hasMusic) {
    console.warn('⚠︎ audio: `music.path` is set but this run builds no video/reel — the audio is ignored (screenshots have no sound).');
  }
}

/** Build one video target (optionally at an overridden device size / scene set / theme). */
async function buildVideoTarget({ id, scenes, brand, cfg, outFile, size, theme }) {
  const base = videoTarget(id);
  const spec = size ? { ...base, w: size[0], h: size[1] } : base;
  const build = spec.style === 'reel' ? buildReel : spec.style === 'premium' ? buildPremium : buildVideo;
  const tag = spec.style ? `, ${spec.style}` : '';
  process.stdout.write(`  • ${id} (${spec.w}×${spec.h}${tag}${cfg.music ? ', ♪' : ''}) … `);
  const { totalDur, warnings } = await build({
    scenes, spec, brand, outFile,
    sceneDur: cfg.sceneDur, xfade: cfg.xfade, timing: cfg.timing,
    theme: theme ?? cfg.theme, music: cfg.music,
  });
  console.log(`${totalDur.toFixed(1)}s → ${path.relative(process.cwd(), outFile)}`);
  for (const w of warnings) console.warn(`    ⚠︎ ${w}`);
}

async function cmdVideo(flags) {
  const { cfg, outDir } = await open(flags);
  const targets = flags.target ? flags.target.split(',').map((s) => s.trim()) : cfg.targets;
  console.log(`zdymak video • ${cfg.scenes.length} scenes → ${targets.join(', ')}`);
  for (const id of targets) {
    await buildVideoTarget({ id, scenes: cfg.scenes, brand: cfg.brand, cfg, outFile: path.join(outDir, `${id}.mp4`) });
  }
  warnAudio({ videoCount: targets.length, hasMusic: !!cfg.music, label: 'videos' });
  console.log('Done.');
}

async function cmdReel(flags) {
  const { cfg, outDir } = await open(flags);
  const reel = cfg.reel;
  if (!reel?.segments?.length) {
    console.warn('No `reel.segments` in the config — nothing to build. (See README: live-footage reel.)');
    return;
  }
  const [w, h] = reel.size || [1080, 1920];
  const spec = { w, h, fps: reel.fps || 30, profile: reel.profile || 'high', level: reel.level || '4.1' };
  const outFile = path.join(outDir, `${flags.name || 'reel'}.mp4`);
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`zdymak reel • ${reel.segments.length} segment(s) → ${w}×${h}${reel.music ? ', ♪' : ''}`);
  const { totalDur } = await buildMontage({
    segments: reel.segments, brand: cfg.brand, theme: reel.theme, spec, // reel theme (light default), NOT cfg.theme
    music: reel.music, sceneDur: reel.sceneDur, bpm: reel.bpm, beatsPerCut: reel.beatsPerCut,
    transition: reel.transition, xfadeDur: reel.xfadeDur, outFile,
  });
  console.log(`  ✓ ${totalDur.toFixed(1)}s → ${path.relative(process.cwd(), outFile)}`);
  warnAudio({ videoCount: 1, hasMusic: !!reel.music, label: 'the reel' });
  console.log('Done.');
}

async function cmdScreenshots(flags) {
  const { cfg, outDir } = await open(flags);
  if (!cfg.devices.length) {
    console.warn('No `devices` in the config — nothing to screenshot. (See README: devices map.)');
    return;
  }
  console.log(`zdymak screenshots • ${cfg.devices.length} device group(s)`);
  for (const device of cfg.devices) {
    const written = await buildDeviceScreenshots({ device, brand: cfg.brand, theme: device.theme ?? cfg.stillTheme ?? cfg.theme, outDir });
    console.log(`  • ${device.name}: ${written.length} shot(s)${written[0] ? ` (${written[0].W}×${written[0].H}…)` : ' — no captures found, skipped'}`);
  }
  warnAudio({ videoCount: 0, hasMusic: !!cfg.music, label: 'screenshots' });
  console.log('Done.');
}

async function cmdBuild(flags) {
  const { cfg, outDir } = await open(flags);
  // 1) shared (phone) video targets from the top-level scenes
  if (cfg.targets.length && cfg.scenes.length) {
    console.log('zdymak build • videos');
    for (const id of cfg.targets) {
      await buildVideoTarget({ id, scenes: cfg.scenes, brand: cfg.brand, cfg, outFile: path.join(outDir, `${id}.mp4`) });
    }
  }
  // 2) per-device videos + screenshots
  for (const device of cfg.devices) {
    if (device.videos.length) {
      console.log(`zdymak build • ${device.name} videos`);
      for (const v of device.videos) {
        await buildVideoTarget({ id: v.target, scenes: device.scenes, brand: cfg.brand, cfg, size: v.size, theme: device.theme, outFile: path.join(outDir, `${device.name}-${v.target}.mp4`) });
      }
    }
    if (device.screenshots.length) {
      const written = await buildDeviceScreenshots({ device, brand: cfg.brand, theme: device.theme ?? cfg.stillTheme ?? cfg.theme, outDir });
      console.log(`  • ${device.name} screenshots: ${written.length}${written.length ? '' : ' — no captures found, skipped'}`);
    }
  }
  const videoCount = (cfg.targets.length && cfg.scenes.length ? cfg.targets.length : 0)
    + cfg.devices.reduce((a, d) => a + d.videos.length, 0);
  warnAudio({ videoCount, hasMusic: !!cfg.music, label: 'videos' });
  console.log('Done.');
}

function cmdSpecs() {
  console.log('\nVIDEO targets (produce an .mp4):');
  for (const [id, s] of Object.entries(VIDEO_TARGETS)) {
    const dur = s.minSec ? `${s.minSec}–${s.maxSec}s` : 'any length';
    console.log(`  ${id.padEnd(20)} ${s.w}×${s.h} @${s.fps}  H.264 ${s.profile}@${s.level}  ${dur}  — ${s.store}`);
  }
  console.log('\nIMAGE targets (store screenshots — `zdymak screenshots` / `build`):');
  for (const [id, s] of Object.entries(IMAGE_TARGETS)) {
    const dim = s.accepts ? s.accepts.map((a) => a.join('×')).join(' | ') : `${s.w}×${s.h}`;
    console.log(`  ${id.padEnd(24)} ${dim}${s.alpha === false ? '  (no alpha)' : ''}  — ${s.store}`);
  }
  console.log('');
}

function cmdHelp() {
  console.log(`zdymak — premium App Store, Google Play & social videos + screenshots, from your captures

Usage:
  zdymak build       [--config <path>] [--out <dir>] [--clean]   # everything: videos + per-device screenshots
  zdymak video       [--config <path>] [--target <ids>] [--out <dir>] [--clean]
  zdymak reel        [--config <path>] [--out <dir>] [--clean]   # LIVE-FOOTAGE montage from clips/images
  zdymak screenshots [--config <path>] [--out <dir>] [--clean]
  zdymak specs
  zdymak capture  --platform ios --bundle <id> --arg <handle> --states <a,b,c> [--suffix -light]
                  [--build --project <.xcodeproj> --scheme <name>] [--device <sim>] [--out <dir>] [--clean]
                  # full workflow: start the app, drive each screen by a launch handle, snap store-ready PNGs
  zdymak capture  --platform ios|android --name <screen>          # single snapshot of the booted device
  zdymak help

Defaults: --config ${DEFAULT_CONFIG}. Needs ffmpeg on PATH (or $FFMPEG).
--clean: wipe the output folder first (capture clears stale PNGs but keeps the .dd build cache) — so the
folder ends up holding ONLY this run's assets, never a stale screenshot from a removed target/scene.
README.md documents the config (brand, scenes, targets, theme, music, devices); SKILL.md is for agents.`);
}

export async function run(argv = process.argv.slice(2)) {
  const [cmd, ...rest0] = argv;
  const { flags, rest } = parseFlags(rest0);
  try {
    switch (cmd) {
      case 'build': await cmdBuild(flags); break;
      case 'video': await cmdVideo(flags); break;
      case 'reel': await cmdReel(flags); break;
      case 'screenshots': await cmdScreenshots(flags); break;
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
