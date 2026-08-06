/**
 * Multi-device store-screenshot generator. For each configured device group and each of its screenshot
 * targets, renders one still per scene (in the chosen style, at the target's exact dimensions) and writes a
 * store-safe **no-alpha PNG**. Scenes whose capture is missing for a device are skipped gracefully, so an
 * app configures only the devices it actually ships.
 */
import fs from 'node:fs';
import path from 'node:path';
import { renderStill } from './still.mjs';
import { loadLayoutMembers } from './layout.mjs';
import { rgbPngBuffer } from './png.mjs';
import { IMAGE_TARGETS } from './specs.mjs';
import { inferFrame } from './frames.mjs';
import { buildFeatureGraphic, buildAppIcon } from './graphic.mjs';
import { validateImage } from './validate.mjs';

/**
 * Apply a locale's caption table to a scene list. A scene the locale doesn't translate keeps its base
 * caption — a store shot with the source-language headline beats a missing slot — and the caller reports
 * the fallbacks rather than hiding them.
 */
export function localizeScenes(scenes, table) {
  if (!table) return scenes;
  return scenes.map((s) => {
    const t = table[s.id];
    return t ? { ...s, title: t.title ?? s.title, sub: t.sub ?? s.sub } : s;
  });
}

/** Scene ids in `scenes` that this locale's table doesn't translate (used for the fallback report). */
export function untranslatedScenes(scenes, table) {
  if (!table) return [];
  return scenes.filter((s) => !table[s.id]).map((s) => s.id);
}

/**
 * Localized brand lines for the feature graphic, from the reserved `$brand` key of a caption table
 * (`{ "$brand": { "tagline": "…" } }`). Only the wordmark copy is localizable — colours/logo are global.
 */
export function localizeBrand(brand, table) {
  const b = table?.$brand;
  if (!b) return brand;
  const { name, tagline, endline, endsub } = b;
  return {
    ...brand,
    ...(name !== undefined && { name }),
    ...(tagline !== undefined && { tagline }),
    ...(endline !== undefined && { endline }),
    ...(endsub !== undefined && { endsub }),
  };
}

/** Resolve a concrete [w,h] for a screenshot target: explicit override → spec w/h → first accepted size. */
export function targetSize(spec, override) {
  if (override) return override;
  if (spec.w && spec.h) return [spec.w, spec.h];
  if (spec.accepts?.length) return spec.accepts[0];
  throw new Error('screenshot target has no resolvable size');
}

/** Build every screenshot for one resolved device group → array of written file paths. */
export async function buildDeviceScreenshots({ device, brand, theme, outDir, force }) {
  const written = [];
  for (const shot of device.screenshots || []) {
    const spec = IMAGE_TARGETS[shot.target];
    if (!spec) throw new Error(`Unknown image target "${shot.target}" (device: ${device.name})`);
    const [W, H] = targetSize(spec, shot.size);
    const frame = shot.frame || inferFrame(shot.target); // device bezel for the `framed` style
    // Infer the style from the target: a framed device (phone/tablet/watch) → 'framed'; a frameless
    // target (Mac/desktop) → 'premium' (window on the matte). Overridable per shot (e.g. Watch → 'bleed').
    const style = shot.style || (frame ? 'framed' : 'premium');

    // The app icon is a branded square built from brand.logo — and the only target that keeps alpha.
    if (spec.icon) {
      const outFile = path.join(outDir, `${shot.target}.png`);
      await buildAppIcon({ W, H, brand, theme: shot.theme || theme, outFile });
      validateImage({ file: outFile, destination: spec, size: [W, H], force });
      written.push({ file: outFile, W, H, style: 'icon' });
      continue;
    }

    // Feature graphic (Play banner) is a single branded image, not a per-scene shot.
    if (spec.graphic) {
      // `s.image` is null on a LAYOUT scene (its captures live on its members), and passing null to
      // existsSync is a deprecation warning today and a throw in a future Node. A cluster is also the
      // wrong thing to crop a feature graphic from, so skip those scenes outright.
      const hero = device.scenes.find((s) => s.image && fs.existsSync(s.image));
      if (!hero) continue;
      const outFile = path.join(outDir, `${shot.target}.png`);
      await buildFeatureGraphic({ W, H, brand, theme: shot.theme || theme, heroPath: hero.image, outFile, frame: frame || 'android' });
      validateImage({ file: outFile, destination: spec, size: [W, H], force });
      written.push({ file: outFile, W, H, style: 'graphic' });
      continue;
    }

    // `dir` lets two shots of the SAME target coexist — e.g. a styled `play-phone/` for the website and a
    // plain `play-phone-plain/` for the Play upload, which would otherwise overwrite each other.
    const dir = path.join(outDir, shot.dir || shot.target);

    let n = 0;
    for (const scene of device.scenes) {
      // A LAYOUT scene composes several captures into one shot (the device-cluster page) instead of
      // framing a single one, so it resolves its own members and skips the single-capture existence
      // check below. It survives partial capture: absent members drop out, the rest still render, and
      // the drops are reported rather than silently thinning the cluster.
      let members;
      if (scene.layout) {
        const loaded = await loadLayoutMembers(scene.layout, {
          W, H, theme: shot.theme || theme, exists: (p) => fs.existsSync(p),
        });
        if (!loaded.members.length) continue; // nothing captured yet — skip the scene, like any other
        if (loaded.missing.length) {
          console.log(`    layout "${scene.id || n + 1}": ${loaded.missing.length} member(s) missing, rendered without them — ${loaded.missing.join(', ')}`);
        }
        members = loaded.members;
      } else if (!fs.existsSync(scene.image)) {
        continue; // graceful: this device lacks this scene's capture
      }
      if (!n) fs.mkdirSync(dir, { recursive: true }); // only once we have something to put in it
      n++;
      const still = await renderStill(style, {
        W, H,
        // `caption: false` renders the app interface alone — what Google Play asks for on store
        // screenshots ("no additional text, graphics, or backgrounds that are not part of the interface").
        caption: shot.caption === false ? { title: '', sub: '' } : { title: scene.title || '', sub: scene.sub || '' },
        imgPath: scene.image,
        brand,
        theme: shot.theme || theme,
        frame,
        members,
      });
      const file = path.join(dir, `${String(n).padStart(2, '0')}-${scene.id || n}.png`);
      fs.writeFileSync(file, rgbPngBuffer(still));
      validateImage({ file, destination: spec, size: [W, H], force });
      written.push({ file, W, H, style });
    }
  }
  return written;
}
