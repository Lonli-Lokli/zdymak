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
import { inferFrame, duoAspect } from './frames.mjs';
import { buildFeatureGraphic, buildCreativeGraphic, buildAppIcon } from './graphic.mjs';
import { validateImage, validateCapture, pngInfo } from './validate.mjs';
import { resolveFold } from './fold3d.mjs';

/**
 * The capture a branded graphic is built around.
 *
 * `shot.hero` names it: a scene id of this device (so a localized run takes that locale's capture), or
 * a path (resolved against the config file at load). A hero that is named and missing is an ERROR, not
 * a fallback — falling back to the first capture is how a portrait phone ends up in a 21:9 header with
 * a green tick, which is exactly the picture the name was given to prevent.
 *
 * With no `hero`, the first scene that has a capture, as it always was — except that a LANDSCAPE canvas
 * built around a hero (`preferLandscape`) takes the first landscape capture when there is one.
 */
export function pickHero(scenes, shot, { preferLandscape = false } = {}) {
  if (shot.hero) {
    const scene = scenes.find((s) => s.id === shot.hero);
    const file = scene ? scene.image : shot.hero;
    if (!file || !fs.existsSync(file)) {
      throw new Error(
        `${shot.target}: hero "${shot.hero}" — ` +
        (scene ? `scene "${shot.hero}" has no capture at ${scene.image}` : 'no scene has that id, and no file has that path'),
      );
    }
    return file;
  }
  // `s.image` is null on a LAYOUT scene (its captures live on its members), and a cluster is the wrong
  // thing to build a banner around, so those are passed over.
  const captured = scenes.filter((s) => s.image && fs.existsSync(s.image)).map((s) => s.image);
  if (preferLandscape) {
    const wide = captured.find((f) => {
      const info = pngInfo(f);
      return info && info.w > info.h;
    });
    if (wide) return wide;
  }
  return captured[0] ?? null;
}

/**
 * The Duo frame keeps its display's shape and cover-fits the capture into it (frames.mjs), so a capture
 * of another shape is CROPPED — quietly, and plausibly, since the result is still a good-looking device.
 * Say so, once per capture, naming the shape the slot wanted. A warning and not a refusal: until a Duo
 * simulator is to hand, a close-enough capture cropped a little is a legitimate draft.
 */
function warnDuoShape(shot, frame, scene) {
  const info = pngInfo(scene.image);
  if (!info) return;
  const want = duoAspect(frame, info.w > info.h);
  const have = info.h / info.w;
  if (Math.abs(have - want) / want <= 0.02) return;
  const display = frame === 'duo' ? 'outer' : 'inner';
  console.warn(
    `    ⚠︎ ${shot.target}: ${path.basename(scene.image)} is ${info.w}×${info.h}, not the shape of the Duo's ${display} ` +
    `display — cropped to fit. Capture on an iPhone Duo simulator (Xcode 27.1+) for a picture of the real screen.`,
  );
}

/**
 * A scene's `fold` for this shot, checked against what will draw it, or null. Only the Duo's inner display
 * folds, and a capture shot half open has the posture's shape: tall like a laptop, wide like a book. A
 * mismatch is an ERROR naming the scene, because the picture it would make is of a posture the phone was
 * not in.
 */
function foldFor(shot, frame, scene) {
  const fold = resolveFold(scene.fold, `${shot.target}: scene "${scene.id}"`);
  if (!fold) return null;
  if (frame !== 'duo-inner') {
    throw new Error(
      `${shot.target}: scene "${scene.id}" is half open (fold: '${fold.posture}'), which only the Duo's inner display ` +
      `frame draws (appstore-iphone-duo-inner and -landscape), not ${JSON.stringify(frame)}.`,
    );
  }
  const info = pngInfo(scene.image);
  if (info && (info.w > info.h) !== (fold.posture === 'book')) {
    throw new Error(
      `${shot.target}: scene "${scene.id}" says fold: '${fold.posture}', but ${path.basename(scene.image)} is ${info.w}×${info.h}. ` +
      `Half open like a laptop the inner display is tall (2007×2853, --posture half-laptop); like a book it is wide (2853×2007, --posture half-book).`,
    );
  }
  return fold;
}

/** A target's art safe area, scaled to the canvas actually being drawn (a `size:` override on search). */
function safeFor(spec, W, H) {
  const [x, y, w, h] = spec.safe;
  const kx = W / spec.w;
  const ky = H / spec.h;
  return [Math.round(x * kx), Math.round(y * ky), Math.round(w * kx), Math.round(h * ky)];
}

/**
 * Apply a locale's caption table to a scene list. A scene the locale doesn't translate keeps its base
 * caption — a store shot with the source-language headline beats a missing slot — and the caller reports
 * the fallbacks rather than hiding them.
 */
export function localizeScenes(scenes, table) {
  if (!table) return scenes;
  return scenes.map((s) => {
    const t = table[s.captionOf ?? s.id];
    return t ? { ...s, title: t.title ?? s.title, sub: t.sub ?? s.sub } : s;
  });
}

/** Scene ids in `scenes` that this locale's table doesn't translate (used for the fallback report). */
export function untranslatedScenes(scenes, table) {
  if (!table) return [];
  return scenes.filter((s) => !table[s.captionOf ?? s.id]).map((s) => s.captionOf ?? s.id);
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

/**
 * A shot's theme, merged over the config's rather than replacing it.
 *
 * This was `shot.theme || theme`, and the `||` was the bug: an entry saying `theme: { anchor:
 * 'top' }` meant "and anchor at the top", and got "and forget the palette, the vignette and the
 * status-bar setting" — every key the config had set fell back to `DEFAULT_THEME`.
 *
 * It surfaced as **two status bars**. A config had `statusBar: false` because its captures
 * already carry the device's own; the two Play entries that also set `anchor` lost it, fell back
 * to `'auto'`, and had a second clock and battery painted above the real one. The styled entries
 * beside them had no `theme` of their own and came out right, which is what made it look like a
 * Play-specific fault rather than a merge.
 */
function shotTheme(theme, shot) {
  return shot.theme ? { ...theme, ...shot.theme } : theme;
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
    //
    // A `plain` destination is neither: the interface alone, because the slot is not a shop window.
    // An in-app purchase review screenshot is looked at once by a reviewer asking "where is this in
    // the app", and a bezel or a headline is an answer to a question nobody asked. Still overridable
    // per shot, but the default has to be right — `inferFrame` finds no device in the target's name
    // and would otherwise fall through to `premium`, putting the app on a marketing matte.
    const style = shot.style || (spec.plain ? 'bleed' : frame ? 'framed' : 'premium');
    const captioned = shot.caption !== false && !spec.plain;

    // The app icon is a branded square built from brand.logo. Play's keeps alpha; Apple's in-app
    // purchase promotional image must be flattened, which is what `alpha` decides.
    if (spec.icon) {
      const outFile = path.join(outDir, `${shot.target}.png`);
      await buildAppIcon({ W, H, brand, theme: shotTheme(theme, shot), outFile, flatten: !spec.alpha });
      validateImage({ file: outFile, destination: spec, size: [W, H], force });
      written.push({ file: outFile, W, H, style: 'icon' });
      continue;
    }

    // A branded graphic — the Play feature graphic, the social card, the App Store header and search
    // images — is a single image built around one hero capture, not a per-scene shot.
    if (spec.graphic) {
      const heroPath = pickHero(device.scenes, shot, { preferLandscape: !!spec.creative });
      if (!heroPath) continue;
      // `<out>/<target>.png`, as it always was — or inside `dir` when the shot names one, so two of the
      // same target (a 3840×2560 search image and a 1920×1280 one) do not overwrite each other.
      const outFile = path.join(outDir, shot.dir || '', `${shot.target}.png`);
      if (spec.creative) {
        await buildCreativeGraphic({
          W, H, safe: safeFor(spec, W, H), brand, theme: shotTheme(theme, shot), heroPath, outFile,
          frame: shot.frame, fan: shot.fan, hand: shot.hand, heroCrop: shot.heroCrop,
          ground: shot.ground, heroFeather: shot.heroFeather, lockup: shot.lockup,
        });
      } else {
        await buildFeatureGraphic({ W, H, brand, theme: shotTheme(theme, shot), heroPath, outFile, frame: frame || 'android' });
      }
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
          W, H, theme: shotTheme(theme, shot), exists: (p) => fs.existsSync(p),
        });
        if (!loaded.members.length) continue; // nothing captured yet — skip the scene, like any other
        if (loaded.missing.length) {
          console.log(`    layout "${scene.id || n + 1}": ${loaded.missing.length} member(s) missing, rendered without them — ${loaded.missing.join(', ')}`);
        }
        members = loaded.members;
      } else if (!fs.existsSync(scene.image)) {
        continue; // graceful: this device lacks this scene's capture
      } else {
        // The capture exists — but is there a screen in it? Checked HERE, on the input, because a
        // composed still cannot be measured reliably (see validateCapture). Failing before the
        // compose also means the error names the capture to redo rather than the output to discard.
        await validateCapture({ file: scene.image, force });
        if (style === 'framed' && (frame === 'duo' || frame === 'duo-inner')) warnDuoShape(shot, frame, scene);
      }
      // Half open (`fold`), the framed Duo is drawn in perspective; every other scene keeps the flat frame.
      const fold = style === 'framed' && !members ? foldFor(shot, frame, scene) : null;
      if (!n) fs.mkdirSync(dir, { recursive: true }); // only once we have something to put in it
      n++;
      const still = await renderStill(style, {
        W, H,
        // `caption: false` renders the app interface alone — what Google Play asks for on store
        // screenshots ("no additional text, graphics, or backgrounds that are not part of the interface").
        caption: captioned ? { title: scene.title || '', sub: scene.sub || '' } : { title: '', sub: '' },
        imgPath: scene.image,
        brand,
        theme: shotTheme(theme, shot),
        frame,
        members,
        fold,
      });
      const file = path.join(dir, `${String(n).padStart(2, '0')}-${scene.id || n}.png`);
      fs.writeFileSync(file, rgbPngBuffer(still));
      validateImage({ file, destination: spec, size: [W, H], force });
      written.push({ file, W, H, style });
    }
  }
  return written;
}
