/**
 * Encode a canvas as a **lossless RGB PNG with no alpha channel** (PNG colour type 2).
 *
 * App Store Connect rejects any screenshot carrying an alpha channel ("Images can't contain alpha channels
 * or transparencies"), and Google Play wants "24-bit PNG (no alpha)" too. @napi-rs/canvas always emits
 * RGBA, so we re-encode from the raw pixels here. Dependency-free (Node `zlib`), lossless (deflate level 9
 * over the exact RGB samples). Every still fills an opaque background, so dropping the (fully-opaque) alpha
 * is a pure flatten with zero visual change.
 */
import zlib from 'node:zlib';

export function rgbPngBuffer(canvas) {
  const w = canvas.width;
  const h = canvas.height;
  const { data } = canvas.getContext('2d').getImageData(0, 0, w, h); // RGBA, row-major, 8-bit

  // PNG scanlines with filter type 0 (none): [0, R,G,B, R,G,B, …] per row.
  const raw = Buffer.allocUnsafe(h * (1 + w * 3));
  let p = 0;
  for (let y = 0; y < h; y++) {
    raw[p++] = 0;
    let src = y * w * 4;
    for (let x = 0; x < w; x++) {
      raw[p++] = data[src];
      raw[p++] = data[src + 1];
      raw[p++] = data[src + 2];
      src += 4;
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  const chunk = (type, body) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([typeBuf, body])) >>> 0, 0);
    return Buffer.concat([len, typeBuf, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2 = truecolour (RGB), no alpha
  // bytes 10–12 (compression, filter, interlace) stay 0

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}
