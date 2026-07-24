/**
 * zdymak CLI.
 *
 *   zdymak build       [--config <path>] [--out <dir>] [--locale <ids>]  # EVERYTHING: videos + screenshots
 *   zdymak video       [--config <path>] [--target <ids>] [--out <dir>]
 *   zdymak screenshots [--config <path>] [--out <dir>] [--locale <ids>]  # per-device store screenshots
 *   zdymak specs                                          # print the store spec matrix
 *   zdymak capture --platform ios|android --name <screen> [--record] [--out <dir>]
 *   zdymak help
 */
import path from 'node:path';
import fs from 'node:fs';
import { registerFonts } from './fonts.mjs';
import { loadConfig, musicForTarget } from './config.mjs';
import { buildVideo } from './video.mjs';
import { buildReel } from './reel.mjs';
import { buildPremium } from './premium.mjs';
import { buildMontage } from './montage.mjs';
import { buildDeviceScreenshots, localizeScenes, localizeBrand, untranslatedScenes } from './screenshots.mjs';
import { VIDEO_TARGETS, IMAGE_TARGETS, videoTarget } from './specs.mjs';
import { runCapture } from './capture/index.mjs';
import { resolveVideo, paletteAt } from './destinations.mjs';
import { validateVideo, validateImage } from './validate.mjs';

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
function warnAudio({ videoCount, hasMusic, label, silentByDesign }) {
  // Never nag about a Play promo: our own guidance is to keep it silent unless the track is cleared,
  // because a ContentID claim can force ads onto a listing video, which Play forbids.
  if (silentByDesign) return;
  if (videoCount > 0 && !hasMusic) {
    console.warn(`⚠︎ audio: ${label} ${videoCount === 1 ? 'plays' : 'play'} SILENT — no music. Apple recommends a single music score for continuity; set \`music.path\`.`);
  }
  if (videoCount === 0 && hasMusic) {
    console.warn('⚠︎ audio: `music.path` is set but this run builds no video/reel — the audio is ignored (screenshots have no sound).');
  }
}

/**
 * Build one video. `entry` is either the `{ target }` shorthand or the split
 * `{ destination, preset, transitions, effects }` form — DESTINATION decides what's accepted, PRESET
 * decides how it looks, and a `transitions`/`effects` list lets the caller supply its own vocabulary
 * instead of the preset's defaults.
 */
async function buildVideoTarget({ entry, scenes, brand, cfg, outFile, size, theme, flags }) {
  const r = resolveVideo(entry);
  const base = r.destination;
  const useSize = size || r.size;
  const spec = useSize ? { ...base, w: useSize[0], h: useSize[1] } : base;
  const build = r.engine === 'reel' ? buildReel : r.engine === 'premium' ? buildPremium : buildVideo;
  const id = r.id;
  // A caller-supplied palette overrides the per-scene default for scenes that don't name their own.
  if (r.transitions || r.effects) {
    scenes = scenes.map((sc, i) => ({
      ...sc,
      cut: sc.cut ?? paletteAt(r.transitions, i, undefined),
      effect: sc.effect ?? paletteAt(r.effects, i, undefined),
    }));
  }
  const tag = r.preset !== 'full-bleed' ? `, ${r.preset}` : '';
  // Per-target audio: a target may be silenced or given a different bed (e.g. Play/YouTube vs Apple).
  const music = musicForTarget(cfg.music, id);
  const audioTag = music ? ', ♪' : cfg.music ? ', muted' : '';
  process.stdout.write(`  • ${id} (${spec.w}×${spec.h}${tag}${audioTag}) … `);
  const { totalDur, warnings } = await build({
    scenes, spec, brand, outFile,
    sceneDur: cfg.sceneDur, xfade: cfg.xfade, timing: cfg.timing,
    theme: theme ?? cfg.theme, music,
  });
  console.log(`${totalDur.toFixed(1)}s → ${path.relative(process.cwd(), outFile)}`);
  for (const w of warnings) console.warn(`    ⚠︎ ${w}`);
  // Measure the artefact, don't trust the intent: a renderer or encoder bug is caught here.
  validateVideo({ file: outFile, destination: base, size: useSize, force: !!flags?.force });
}

async function cmdVideo(flags) {
  const { cfg, outDir } = await open(flags);
  const targets = flags.target ? flags.target.split(',').map((s) => s.trim()) : cfg.targets;
  console.log(`zdymak video • ${cfg.scenes.length} scenes → ${targets.map((t) => resolveVideo(t).id).join(', ')}`);
  for (const id of targets) {
    await buildVideoTarget({ entry: id, scenes: cfg.scenes, brand: cfg.brand, cfg, outFile: path.join(outDir, `${resolveVideo(id).id}.mp4`) });
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

/**
 * Which locales to render, from `captions` + an optional `--locale de,fr` filter. An unknown locale is an
 * error, not a silent no-op — a typo'd locale would otherwise look like a successful run that shipped
 * nothing.
 */
function localesFor(cfg, flags) {
  const configured = Object.keys(cfg.captions || {});
  if (!flags.locale) return configured;
  const wanted = String(flags.locale).split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = wanted.filter((l) => !configured.includes(l));
  if (unknown.length) {
    throw new Error(
      `--locale: no captions configured for ${unknown.join(', ')}. ` +
        (configured.length ? `Configured: ${configured.join(', ')}.` : 'The config has no `captions` block.'),
    );
  }
  return wanted;
}

/**
 * Per-locale screenshot sets → `<out>/<locale>/<target>/…`, leaving the base (source-language) set where
 * it already is. Screenshots only: stores take localized stills far more often than localized previews,
 * and re-encoding every video per locale costs minutes each.
 */
async function buildLocalizedScreenshots({ cfg, outDir, flags }) {
  for (const locale of localesFor(cfg, flags)) {
    const table = cfg.captions[locale];
    console.log(`zdymak • ${locale} screenshots`);
    const fellBack = new Set();
    for (const device of cfg.devices) {
      if (!device.screenshots.length) continue;
      untranslatedScenes(device.scenes, table).forEach((id) => fellBack.add(id));
      const written = await buildDeviceScreenshots({
        device: { ...device, scenes: localizeScenes(device.scenes, table) },
        brand: localizeBrand(cfg.brand, table),
        theme: device.theme ?? cfg.stillTheme ?? cfg.theme,
        outDir: path.join(outDir, locale),
        force: !!flags.force,
      });
      console.log(`  • ${device.name}: ${written.length}${written.length ? '' : ' — no captures found, skipped'}`);
    }
    if (fellBack.size) {
      console.log(`    ↳ ${fellBack.size} scene(s) kept the base caption (no ${locale} translation): ${[...fellBack].join(', ')}`);
    }
  }
}

async function cmdScreenshots(flags) {
  const { cfg, outDir } = await open(flags);
  if (!cfg.devices.length) {
    console.warn('No `devices` in the config — nothing to screenshot. (See README: devices map.)');
    return;
  }
  console.log(`zdymak screenshots • ${cfg.devices.length} device group(s)`);
  for (const device of cfg.devices) {
    const written = await buildDeviceScreenshots({ device, brand: cfg.brand, theme: device.theme ?? cfg.stillTheme ?? cfg.theme, outDir, force: !!flags.force });
    console.log(`  • ${device.name}: ${written.length} shot(s)${written[0] ? ` (${written[0].W}×${written[0].H}…)` : ' — no captures found, skipped'}`);
  }
  await buildLocalizedScreenshots({ cfg, outDir, flags });
  warnAudio({ videoCount: 0, hasMusic: !!cfg.music, label: 'screenshots' });
  console.log('Done.');
}

async function cmdBuild(flags) {
  const { cfg, outDir } = await open(flags);
  // 1) shared (phone) video targets from the top-level scenes
  if (cfg.targets.length && cfg.scenes.length) {
    console.log('zdymak build • videos');
    for (const id of cfg.targets) {
      await buildVideoTarget({ entry: id, scenes: cfg.scenes, brand: cfg.brand, cfg, outFile: path.join(outDir, `${resolveVideo(id).id}.mp4`), flags });
    }
  }
  // 2) per-device videos + screenshots
  let deviceVideos = 0;
  for (const device of cfg.devices) {
    // A device the app doesn't ship (or hasn't captured yet) skips cleanly — same contract as its
    // screenshots. Without this, one uncaptured device aborts the whole build for every other one.
    const captured = device.scenes.filter((s) => fs.existsSync(s.image));
    if (device.videos.length) {
      if (!captured.length) {
        console.log(`  • ${device.name} videos: skipped — no captures found`);
      } else {
        console.log(`zdymak build • ${device.name} videos`);
        for (const v of device.videos) {
          const vid = resolveVideo(v);
          await buildVideoTarget({ entry: v, scenes: captured, brand: cfg.brand, cfg, size: v.size, theme: v.theme ?? device.theme, outFile: path.join(outDir, `${device.name}-${vid.id}.mp4`), flags });
          deviceVideos++;
        }
      }
    }
    if (device.screenshots.length) {
      const written = await buildDeviceScreenshots({ device, brand: cfg.brand, theme: device.theme ?? cfg.stillTheme ?? cfg.theme, outDir, force: !!flags.force });
      console.log(`  • ${device.name} screenshots: ${written.length}${written.length ? '' : ' — no captures found, skipped'}`);
    }
  }
  // 3) localized screenshot sets (base set already written above)
  await buildLocalizedScreenshots({ cfg, outDir, flags });

  const videoCount = (cfg.targets.length && cfg.scenes.length ? cfg.targets.length : 0) + deviceVideos;
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
  zdymak build       [--config <path>] [--out <dir>] [--clean] [--locale <ids>] [--force]  # everything
  zdymak video       [--config <path>] [--target <ids>] [--out <dir>] [--clean]
  zdymak reel        [--config <path>] [--out <dir>] [--clean]   # LIVE-FOOTAGE montage from clips/images
  zdymak screenshots [--config <path>] [--out <dir>] [--clean] [--locale <ids>]
  zdymak specs
  zdymak capture  --platform ios --bundle <id> --arg <handle> --states <a,b,c> [--suffix -light]
                  [--build --project <.xcodeproj> --scheme <name>] [--device <sim>] [--out <dir>] [--clean] [--keep]
                  # full workflow: start the app, drive each screen by a launch handle, snap store-ready PNGs
  zdymak capture  --platform android --record --component <pkg/act> --arg <extra> --states <a,b,c>
                  [--size 1080x1920] [--density 400] [--duration 60] [--trim <s>] [--hold 1.5]
                  [--fps 30] [--bitrate 20000000] [--keep-raw] [--out <dir>]
                  # LIVE FOOTAGE per state: warm-relaunches the app, records, auto-trims the launch
                  # head and holds the final frame. --size relayouts the app to the video spec so
                  # nothing is cropped. Feed the clips to "zdymak reel", or ship one directly.
  zdymak capture  --platform ios|android --name <screen>          # single snapshot of the booted device
                  # android bar: clock from --time, signal shown internet-validated (no "!" badge),
                  # wifi hidden by default (API 34 emulators draw it twice) — --wifi shows it anyway
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
