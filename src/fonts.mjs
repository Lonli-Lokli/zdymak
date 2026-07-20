/**
 * Font registration for the canvas renderer. Everything renders under one family name — "Brand" — so the
 * engine never branches on which file won. Resolution order:
 *   1. explicit paths the project passes in (`brand.fontPaths` — e.g. your own Inter/brand TTFs)
 *   2. the host system font: San Francisco on macOS (the Apple system face — ideal for store assets),
 *      Segoe UI on Windows, DejaVu Sans on Linux.
 * No font is bundled, so there is nothing to license or ship; macOS (where you build App Store assets)
 * always resolves to SF.
 */
import { GlobalFonts } from '@napi-rs/canvas';
import fs from 'node:fs';

const SYSTEM_CANDIDATES = [
  '/System/Library/Fonts/SFNS.ttf', // macOS — San Francisco (variable, all weights)
  '/System/Library/Fonts/SFNSDisplay.ttf',
  'C:/Windows/Fonts/segoeui.ttf', // Windows — Segoe UI
  'C:/Windows/Fonts/segoeuib.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', // Linux
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
];

/**
 * Register the "Brand" family. `fontPaths` (optional) are tried first, in order.
 * Returns true if at least one face registered (else the canvas default is used, with a warning).
 */
export function registerFonts(fontPaths = []) {
  let any = false;
  for (const p of [...fontPaths, ...SYSTEM_CANDIDATES]) {
    if (p && fs.existsSync(p)) {
      try {
        GlobalFonts.registerFromPath(p, 'Brand');
        any = true;
      } catch {
        /* skip unreadable */
      }
    }
  }
  if (!any) {
    console.warn('[zdymak] No brand/system font found — captions use the canvas default. Pass brand.fontPaths to fix.');
  }
  return any;
}
