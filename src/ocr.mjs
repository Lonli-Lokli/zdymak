/** The words in a picture, read with Apple's Vision (ocr.swift) on macOS: the checker's second witness (checker.mjs). */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let ocrBinary; // { bin } or { error }, once per process

/** Compile ocr.swift once per version into the temporary folder; `{ error }` where it cannot be. */
function ocrTool() {
  if (ocrBinary) return ocrBinary;
  if (process.env.ZDYMAK_NO_OCR) return (ocrBinary = { error: 'reading text is turned off (ZDYMAK_NO_OCR)' });
  if (process.platform !== 'darwin') return (ocrBinary = { error: 'reading text from a picture needs macOS (Vision)' });
  const src = new URL('./ocr.swift', import.meta.url);
  const text = fs.readFileSync(src);
  const bin = path.join(os.tmpdir(), `zdymak-ocr-${crypto.createHash('sha256').update(text).digest('hex').slice(0, 12)}`);
  if (!fs.existsSync(bin)) {
    const tmp = `${bin}.${process.pid}`;
    const r = spawnSync('xcrun', ['swiftc', '-O', src.pathname, '-o', tmp], { encoding: 'utf8' });
    if (r.status !== 0) return (ocrBinary = { error: `the text reader did not compile: ${(r.stderr || r.error?.message || '').trim().split('\n')[0]}` });
    fs.renameSync(tmp, bin);
  }
  return (ocrBinary = { bin });
}

/**
 * The text in a picture as `[{ text, conf, x, y, w, h }]` (fractions, origin top left), or `{ error }` when it cannot
 * be read here. `language` steers the reader toward the set's script; English is always read too.
 */
export function readText(file, language) {
  const tool = ocrTool();
  if (tool.error) return { error: tool.error };
  const langs = [language, 'en-US'].filter(Boolean).join(',');
  const r = spawnSync(tool.bin, [file, langs], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) return { error: `the text reader failed: ${(r.stderr || '').trim()}` };
  try {
    return JSON.parse(r.stdout).filter((l) => l.conf >= OCR_CONFIDENCE);
  } catch {
    return { error: 'the text reader printed no JSON' };
  }
}

/** Lines the reader is less sure of than this are not read at all. */
export const OCR_CONFIDENCE = 0.5;
