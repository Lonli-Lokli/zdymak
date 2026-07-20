/**
 * Multi-device store-screenshot generator. For each configured device group and each of its screenshot
 * targets, renders one still per scene (in the chosen style, at the target's exact dimensions) and writes a
 * store-safe **no-alpha PNG**. Scenes whose capture is missing for a device are skipped gracefully, so an
 * app configures only the devices it actually ships.
 */
import fs from 'node:fs';
import path from 'node:path';
import { renderStill } from './still.mjs';
import { rgbPngBuffer } from './png.mjs';
import { IMAGE_TARGETS } from './specs.mjs';

/** Resolve a concrete [w,h] for a screenshot target: explicit override → spec w/h → first accepted size. */
export function targetSize(spec, override) {
  if (override) return override;
  if (spec.w && spec.h) return [spec.w, spec.h];
  if (spec.accepts?.length) return spec.accepts[0];
  throw new Error('screenshot target has no resolvable size');
}

/** Build every screenshot for one resolved device group → array of written file paths. */
export async function buildDeviceScreenshots({ device, brand, theme, outDir }) {
  const written = [];
  for (const shot of device.screenshots || []) {
    const spec = IMAGE_TARGETS[shot.target];
    if (!spec) throw new Error(`Unknown image target "${shot.target}" (device: ${device.name})`);
    const [W, H] = targetSize(spec, shot.size);
    const style = shot.style || 'premium';
    const dir = path.join(outDir, shot.target);
    fs.mkdirSync(dir, { recursive: true });

    let n = 0;
    for (const scene of device.scenes) {
      if (!fs.existsSync(scene.image)) continue; // graceful: this device lacks this scene's capture
      n++;
      const still = await renderStill(style, {
        W, H,
        imgPath: scene.image,
        caption: { title: scene.title || '', sub: scene.sub || '' },
        brand,
        theme: shot.theme || theme,
      });
      const file = path.join(dir, `${String(n).padStart(2, '0')}-${scene.id || n}.png`);
      fs.writeFileSync(file, rgbPngBuffer(still));
      written.push({ file, W, H, style });
    }
  }
  return written;
}
