/**
 * The iPhone Duo HALF OPEN, drawn in perspective around a real capture: a frame, like the flat Duo frame in
 * frames.mjs, for the scenes shot with `capture --posture half-laptop` or `half-book`.
 *
 * Why it exists. A half-open phone photographs flat: the simulator hands back the screen's pixels, so in the
 * flat frame a laptop shot looks like any phone held upright and a book shot like any phone open flat, and
 * the store slot loses the one thing the posture is there to show. This draws the same body bent at its
 * fold and seen from in front, so the picture says how the phone is held. The screen is still the capture:
 * each half is the capture's own pixels seen in perspective, and the only thing laid over them is a soft
 * shade where the screen bends (`crease`; 0 leaves it out).
 *
 * How. The body is unfolded into a SHEET measured in capture pixels: the screen is [0, Sw] x [0, Sh] and the
 * body [-B, Sw + B] x [-B, Sh + B], with the flat frame's own bezel and corner (DUO['duo-inner'], taken from
 * the short side). Each half of the sheet is a plane in 3D and a pinhole camera projects it, so each half's
 * picture is a homography of the capture. Every output pixel is mapped back through its inverse and the
 * capture sampled there (bilinear), at 2x and scaled down, with the edges' coverage worked out from the
 * rounded rectangles' distance fields. The half's thickness is drawn as metal edges where they face the
 * camera.
 *
 *   laptop  The fold runs across the middle (v = Sh / 2). The lower half lies flat toward the viewer and the
 *           upper half stands at the hinge angle, 110 degrees by default, as the simulator captures it.
 *   book    The fold runs down the middle (u = Sw / 2) and the two halves stand on the table in a V,
 *           136 degrees by default: gentler than the 110 captured, because at 110 the two screens turn too
 *           far from the camera to read.
 *
 * Ported from the prototype Niva's owner approved on 2026-10-13. It takes the theme it is given and never
 * reads a game's config.
 */
import { createCanvas } from '@napi-rs/canvas';
import { DUO, duoAspect } from './frames.mjs';

/** Supersampling: the device is drawn at this many pixels per output pixel, then scaled down. */
const SS = 2;

/** What a scene's `fold` may name. The capture's own `--posture` names are accepted for the same thing. */
const POSTURE_NAMES = { laptop: 'laptop', 'half-laptop': 'laptop', book: 'book', 'half-book': 'book' };

/**
 * Each posture's defaults. `elev` is the camera's height above the table in degrees, `yaw` its turn about
 * the device (positive from the right), `dist` its distance in short sides of the screen, `hinge` the angle
 * drawn between the halves, and `crease` how dark the bend is at its darkest (0 to 1).
 */
export const FOLD_DEFAULTS = {
  laptop: { hinge: 110, elev: 24, yaw: 0, dist: 3.4, crease: 0.16 },
  book: { hinge: 136, elev: 12, yaw: 0, dist: 3.4, crease: 0.16 },
};

/** The ranges a `fold` option is held to. Outside them the halves start to hide each other's edges. */
const FOLD_RANGES = { hinge: [60, 180], elev: [0, 80], yaw: [-60, 60], dist: [1.5, 20], crease: [0, 1] };

/** How much of the frame's width the device may take, per posture (the prototype's, as approved). */
const FIT_W = { laptop: 0.86, book: 0.84 };

/**
 * A scene's `fold` as the renderer takes it: `'laptop'`, `'book'` (or `'half-laptop'`, `'half-book'`, the
 * `--posture` names), or `{ posture, hinge, elev, yaw, dist, crease }` with any of the options given.
 * Returns null for no fold (undefined, null or false) and throws, naming `where`, for anything else.
 */
export function resolveFold(fold, where = 'scene') {
  if (fold === undefined || fold === null || fold === false) return null;
  const raw = typeof fold === 'string' ? { posture: fold } : fold;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${where}: fold must be 'laptop', 'book' or { posture, hinge, elev, yaw, dist, crease }.`);
  }
  const posture = POSTURE_NAMES[String(raw.posture ?? '').toLowerCase()];
  if (!posture) {
    throw new Error(`${where}: fold posture must be 'laptop' or 'book' (or 'half-laptop', 'half-book'), not ${JSON.stringify(raw.posture)}.`);
  }
  const out = { posture, ...FOLD_DEFAULTS[posture] };
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'posture') continue;
    const range = FOLD_RANGES[key];
    if (!range) throw new Error(`${where}: fold has no option "${key}" (it takes posture, ${Object.keys(FOLD_RANGES).join(', ')}).`);
    const n = Number(value);
    if (value === null || value === '' || !Number.isFinite(n) || n < range[0] || n > range[1]) {
      throw new Error(`${where}: fold.${key} must be a number from ${range[0]} to ${range[1]}, not ${JSON.stringify(value)}.`);
    }
    out[key] = n;
  }
  return out;
}

// ─── Vectors ────────────────────────────────────────────────────────────────────────────────────

const v3 = (x, y, z) => [x, y, z];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => mul(a, 1 / Math.hypot(...a));
const rad = (deg) => (deg * Math.PI) / 180;

// ─── The sheet and its halves ───────────────────────────────────────────────────────────────────

/**
 * The body's outline on the sheet, as points around its rounded rectangle (clockwise with u to the right
 * and v down), each with the outward normal of the edge it starts.
 *
 * The straight sides are cut into SHORT pieces, and that matters: each piece becomes one metal edge with
 * its own gradient, and one long piece per side let its shade drift along its length, which showed as a
 * stripe. An even number of pieces per side puts the fold, at a side's middle, on a point, so no piece
 * straddles the two halves.
 */
function outline({ Sw, Sh, B, RB, short }) {
  const step = short * 0.003;
  const x0 = -B;
  const y0 = -B;
  const x1 = Sw + B;
  const y1 = Sh + B;
  const pts = [];
  const arc = (cx, cy, a0, a1) => {
    const n = Math.max(6, Math.ceil((Math.abs(a1 - a0) * RB) / step));
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push([cx + RB * Math.cos(a), cy + RB * Math.sin(a), [Math.cos(a), Math.sin(a)]]);
    }
  };
  const line = (ax, ay, bx, by, nrm) => {
    const n = 2 * Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (step * 8)));
    for (let i = 0; i < n; i++) pts.push([ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n, nrm]);
  };
  line(x0 + RB, y0, x1 - RB, y0, [0, -1]);
  arc(x1 - RB, y0 + RB, -Math.PI / 2, 0);
  line(x1, y0 + RB, x1, y1 - RB, [1, 0]);
  arc(x1 - RB, y1 - RB, 0, Math.PI / 2);
  line(x1 - RB, y1, x0 + RB, y1, [0, 1]);
  arc(x0 + RB, y1 - RB, Math.PI / 2, Math.PI);
  line(x0, y1 - RB, x0, y0 + RB, [-1, 0]);
  arc(x0 + RB, y0 + RB, Math.PI, Math.PI * 1.5);
  return pts;
}

/**
 * The folded body and the camera, before it is placed on the frame. Every length is in capture pixels.
 *
 * Each half maps a sheet point (u, v) to 3D as O + (u - u0) U + (v - v0) V, its screen facing N; `inside`
 * says which sheet points are that half's, and `keep` is the same with a sliver of overlap at the fold, so
 * the two faces meet without a gap. The camera looks at `target` from `elev` degrees above the table.
 */
export function foldGeometry(Sw, Sh, fold) {
  const short = Math.min(Sw, Sh);
  const B = Math.round(short * DUO['duo-inner'].bezel);
  const R = Math.round(short * DUO['duo-inner'].radius);
  const sheet = {
    Sw, Sh, short, B, R, RB: R + B,
    T: Math.round(short * 0.036), // one half's thickness: about 5.5 mm on the 111 mm short side
    RIM: Math.round(short * 0.006), // the polished band at the body's very edge
  };
  const hinge = rad(fold.hinge);
  const lap = short * 0.001;
  let halves;
  let foldAxis;
  let F;
  let target;
  if (fold.posture === 'laptop') {
    foldAxis = 'v';
    F = Sh / 2;
    const d = v3(0, Math.sin(hinge), Math.cos(hinge)); // up the standing half, away from the hinge
    const hingeAt = v3(-Sw / 2, sheet.T, 0);
    halves = [
      // Lying flat, toward the viewer: what is touched.
      { name: 'base', O: hingeAt, u0: 0, v0: F, U: v3(1, 0, 0), V: v3(0, 0, 1), N: v3(0, 1, 0),
        inside: (u, v) => v >= F, keep: (u, v) => v >= F - lap },
      // Standing: what is looked at.
      { name: 'lid', O: hingeAt, u0: 0, v0: F, U: v3(1, 0, 0), V: mul(d, -1), N: v3(0, -Math.cos(hinge), Math.sin(hinge)),
        inside: (u, v) => v <= F, keep: (u, v) => v <= F + lap },
    ];
    target = v3(0, Sh * 0.16, Sh * 0.16);
  } else {
    foldAxis = 'u';
    F = Sw / 2;
    const beta = (Math.PI - hinge) / 2; // each half's turn from facing the camera square on
    const foot = Sh + B; // the bottom edge stands on the table
    halves = [
      { name: 'left', O: v3(0, 0, 0), u0: F, v0: foot, U: v3(Math.cos(beta), 0, -Math.sin(beta)), V: v3(0, -1, 0), N: v3(Math.sin(beta), 0, Math.cos(beta)),
        inside: (u) => u <= F, keep: (u) => u <= F + lap },
      { name: 'right', O: v3(0, 0, 0), u0: F, v0: foot, U: v3(Math.cos(beta), 0, Math.sin(beta)), V: v3(0, -1, 0), N: v3(-Math.sin(beta), 0, Math.cos(beta)),
        inside: (u) => u >= F, keep: (u) => u >= F - lap },
    ];
    target = v3(0, Sh * 0.48, F * Math.sin(beta) * 0.4);
  }
  const elev = rad(fold.elev);
  const yaw = rad(fold.yaw);
  const cam = add(target, mul(v3(Math.sin(yaw) * Math.cos(elev), Math.sin(elev), Math.cos(yaw) * Math.cos(elev)), fold.dist * short));
  const fwd = norm(sub(target, cam));
  const right = norm(cross(fwd, v3(0, 1, 0)));
  const up = cross(right, fwd);
  return { ...sheet, posture: fold.posture, fold, halves, foldAxis, F, outline: outline(sheet), cam, fwd, right, up };
}

/** A sheet point on a half, in 3D. */
export const pointOn = (h, u, v) => add(h.O, add(mul(h.U, u - h.u0), mul(h.V, v - h.v0)));

/** A 3D point on the camera's image plane at unit distance (x right, y down). */
function projN(g, p) {
  const q = sub(p, g.cam);
  const z = dot(q, g.fwd);
  return [dot(q, g.right) / z, -dot(q, g.up) / z];
}

/**
 * Scale and centre the projected device into a box: the device, its walls included, as large as fits in
 * `boxW` x `boxH`, centred on (cx, cy). Returns the scale and offset that take the unit image plane to
 * pixels, and the device's bounds in those pixels.
 */
export function fitFold(g, { cx, cy, boxW, boxH }) {
  const pts = [];
  for (const h of g.halves) {
    for (const [u, v] of g.outline) {
      if (!h.inside(u, v)) continue;
      const p = pointOn(h, u, v);
      pts.push(projN(g, p), projN(g, sub(p, mul(h.N, g.T))));
    }
  }
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const s = Math.min(boxW / (maxX - minX), boxH / (maxY - minY));
  const tx = cx - (s * (minX + maxX)) / 2;
  const ty = cy - (s * (minY + maxY)) / 2;
  return { s, tx, ty, bounds: { x0: s * minX + tx, y0: s * minY + ty, x1: s * maxX + tx, y1: s * maxY + ty } };
}

/** A 3D point in the pixels of a fit. */
function projectWith(g, fit, p) {
  const n = projN(g, p);
  return [fit.s * n[0] + fit.tx, fit.s * n[1] + fit.ty];
}

/**
 * The 3x3 homography (row-major) taking a half's sheet point (u, v, 1) to its pixel (x w, y w, w) under a
 * fit: the plane's map into 3D, the camera and the fit's scale and offset, composed.
 */
export function foldHomography(g, fit, h) {
  const { s, tx, ty } = fit;
  const A = sub(sub(sub(h.O, mul(h.U, h.u0)), mul(h.V, h.v0)), g.cam);
  const fU = dot(g.fwd, h.U);
  const fV = dot(g.fwd, h.V);
  const fA = dot(g.fwd, A);
  return [
    s * dot(g.right, h.U) + tx * fU, s * dot(g.right, h.V) + tx * fV, s * dot(g.right, A) + tx * fA,
    -s * dot(g.up, h.U) + ty * fU, -s * dot(g.up, h.V) + ty * fV, -s * dot(g.up, A) + ty * fA,
    fU, fV, fA,
  ];
}

function inverse3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const Bm = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * Bm + c * C;
  return [A, -(b * i - c * h), b * f - c * e, Bm, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((x) => x / det);
}

/** Signed distance from (u, v) to a rounded rectangle: negative inside. */
function sdRoundRect(u, v, x0, y0, x1, y1, r) {
  const qx = Math.abs(u - (x0 + x1) / 2) - ((x1 - x0) / 2 - r);
  const qy = Math.abs(v - (y0 + y1) / 2) - ((y1 - y0) / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/**
 * The capture as the sheet's screen: the inner display's own shape, as the flat frame keeps it. A capture
 * of that shape is copied pixel for pixel; one of another shape is cut to it from the middle (the flat
 * frame cover-fits it the same way, and `buildDeviceScreenshots` warns).
 */
function screenPixels(img, landscape) {
  const want = duoAspect('duo-inner', landscape);
  let Sw = img.width;
  let Sh = Math.round(img.width * want);
  if (Sh > img.height) {
    Sh = img.height;
    Sw = Math.round(img.height / want);
  }
  const c = createCanvas(Sw, Sh);
  const g = c.getContext('2d');
  g.drawImage(img, Math.round((img.width - Sw) / 2), Math.round((img.height - Sh) / 2), Sw, Sh, 0, 0, Sw, Sh);
  return { Sw, Sh, data: g.getImageData(0, 0, Sw, Sh).data };
}

/**
 * Where a half-open Duo goes and how big, from what the flat Duo frame would have been given: the box is
 * as tall as the flat body (so the device keeps to the band below the caption that every framed shot
 * keeps to) and `maxW` times the posture's share of it wide, centred on (cx, cy).
 */
export function foldBox(img, cx, cy, screenW, fold, maxW) {
  const landscape = img.width > img.height;
  const screenH = screenW * duoAspect('duo-inner', landscape);
  const bezel = Math.round(Math.min(screenW, screenH) * DUO['duo-inner'].bezel);
  return { cx, cy, boxW: maxW * FIT_W[fold.posture], boxH: screenH + bezel * 2 };
}

// ─── Drawing ────────────────────────────────────────────────────────────────────────────────────

const LIGHT = norm(v3(-0.35, 0.8, 0.55)); // from above, in front and a little to the left
const BEZEL = [11, 11, 10]; // the flat frame's #0b0b0a
const RIM_OUT = [214, 217, 221];
const RIM_IN = [96, 99, 104];

/** Brushed metal at light level k (0 dark to 1 bright). */
function metal(k) {
  const lo = [58, 61, 66];
  const hi = [208, 211, 215];
  return lo.map((c, i) => Math.round(c + (hi[i] - c) * Math.max(0, Math.min(1, k))));
}

function pathOf(ctx, points) {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

/**
 * Behind the book, a soft column of shade on the ground, darkest behind the fold, which sets the bent
 * outline off the ground. Uniform from top to bottom, so it reads as light and not as an object.
 *
 * (The prototype meant this as a pool under the foot. Its height was scaled by the projection's scale by
 * mistake, about 600,000 pixels tall, and it came out as this column, which is the picture the owner
 * approved; it is drawn here as what it is. The prototype's two contact shadows were offset by the same
 * mistake and drew nothing at all, so there are none here: a shadow under either posture would be a new
 * look, not this one.)
 */
function paintBookShade(ctx, g, fit) {
  const [l, r] = g.halves;
  const { Sw, Sh, B, T, F } = g;
  const foot = [
    pointOn(l, -B, Sh + B), pointOn(l, F, Sh + B), pointOn(r, Sw + B, Sh + B),
    sub(pointOn(r, Sw + B, Sh + B), mul(r.N, T)), sub(pointOn(l, F, Sh + B), mul(l.N, T * 1.4)), sub(pointOn(l, -B, Sh + B), mul(l.N, T)),
  ].map((p) => projectWith(g, fit, p));
  const xs = foot.map((p) => p[0]);
  const gx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const rx = (Math.max(...xs) - Math.min(...xs)) * 0.54;
  const shade = ctx.createLinearGradient(gx - rx, 0, gx + rx, 0);
  shade.addColorStop(0, 'rgba(0,0,0,0)');
  shade.addColorStop(0.2, 'rgba(0,0,0,0.25)');
  shade.addColorStop(0.5, 'rgba(0,0,0,0.55)');
  shade.addColorStop(0.8, 'rgba(0,0,0,0.25)');
  shade.addColorStop(1, 'rgba(0,0,0,0)');
  const tall = ctx.canvas.height;
  ctx.save();
  ctx.fillStyle = shade;
  ctx.fillRect(gx - rx, -tall, rx * 2, tall * 3);
  ctx.restore();
}

/** The halves' edges, from the screen face to the back, wherever they face the camera: brushed metal. */
function paintWalls(ctx, g, fit) {
  const P = (p) => projectWith(g, fit, p);
  for (const h of g.halves) {
    for (let i = 0; i + 1 < g.outline.length; i++) {
      const [ua, va, na] = g.outline[i];
      const [ub, vb] = g.outline[i + 1];
      if (!h.inside(ua, va) || !h.inside(ub, vb)) continue;
      const a = pointOn(h, ua, va);
      const b = pointOn(h, ub, vb);
      const n3 = norm(add(mul(h.U, na[0]), mul(h.V, na[1])));
      if (dot(n3, sub(g.cam, mul(add(a, b), 0.5))) <= 0) continue; // facing away
      const a2 = sub(a, mul(h.N, g.T));
      const b2 = sub(b, mul(h.N, g.T));
      const k = 0.22 + 0.78 * Math.max(0, dot(n3, LIGHT));
      // The gradient runs square to THIS piece's top edge, from that edge to its bottom one, so every piece
      // starts its shade on the line it shares with the face and its neighbours agree. An axis through the
      // piece's middle tilts with the perspective, differently for each piece, and the shade then steps
      // from piece to piece: a stripe along the edge.
      const pa = P(a);
      const pb = P(b);
      const pa2 = P(a2);
      const pb2 = P(b2);
      const el = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) || 1;
      const px = -(pb[1] - pa[1]) / el;
      const py = (pb[0] - pa[0]) / el;
      const depth = (pa2[0] - pa[0]) * px + (pa2[1] - pa[1]) * py;
      const grad = ctx.createLinearGradient(pa[0], pa[1], pa[0] + px * depth, pa[1] + py * depth);
      // A polished chamfer along the top, then the brushed side darkening toward the table.
      grad.addColorStop(0, `rgb(${metal(k + 0.45)})`);
      grad.addColorStop(0.12, `rgb(${metal(k + 0.18)})`);
      grad.addColorStop(0.3, `rgb(${metal(k)})`);
      grad.addColorStop(1, `rgb(${metal(k - 0.28)})`);
      ctx.fillStyle = grad;
      // Each piece reaches a pixel and a half into its neighbours, so no seam between two pieces lets the
      // ground through (their antialiased edges would otherwise meet at half cover each).
      const grow = (p, q) => {
        const dx = q[0] - p[0];
        const dy = q[1] - p[1];
        const l = Math.hypot(dx, dy) || 1;
        return [[p[0] - (dx / l) * 1.5, p[1] - (dy / l) * 1.5], [q[0] + (dx / l) * 1.5, q[1] + (dy / l) * 1.5]];
      };
      const [ga, gb] = grow(pa, pb);
      const [ga2, gb2] = grow(pa2, pb2);
      pathOf(ctx, [ga, gb, gb2, ga2]);
      ctx.fill();
    }
  }
}

/**
 * The faces, pixel by pixel: the screen (the capture through each half's homography), the bezel, and the
 * rim, each with its coverage, blended over what the walls left on the layer.
 */
function paintFaces(layer, g, fit, src) {
  const W = layer.width;
  const H = layer.height;
  const lctx = layer.getContext('2d');
  const frame = lctx.getImageData(0, 0, W, H);
  const out = frame.data;
  const { Sw, Sh, B, R, RB, RIM, F } = g;
  const crease = g.fold.crease;
  const sigma = g.short * 0.013;
  const sample = (u, v, rgb) => {
    const x = Math.min(Math.max(u - 0.5, 0), Sw - 1.001);
    const y = Math.min(Math.max(v - 0.5, 0), Sh - 1.001);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const i00 = (y0 * Sw + x0) * 4;
    const i10 = i00 + 4;
    const i01 = i00 + Sw * 4;
    const i11 = i01 + 4;
    for (let c = 0; c < 3; c++) {
      const top = src[i00 + c] + (src[i10 + c] - src[i00 + c]) * fx;
      const bot = src[i01 + c] + (src[i11 + c] - src[i01 + c]) * fx;
      rgb[c] = top + (bot - top) * fy;
    }
  };
  const rgb = [0, 0, 0];
  for (const h of g.halves) {
    const Hi = inverse3(foldHomography(g, fit, h));
    // The half's box on the layer.
    const box = g.outline.filter(([u, v]) => h.inside(u, v)).map(([u, v]) => projectWith(g, fit, pointOn(h, u, v)));
    const foldEnds = g.foldAxis === 'v' ? [[-B, F], [Sw + B, F]] : [[F, -B], [F, Sh + B]];
    for (const [u, v] of foldEnds) box.push(projectWith(g, fit, pointOn(h, u, v)));
    const bx0 = Math.max(0, Math.floor(Math.min(...box.map((p) => p[0])) - 2));
    const bx1 = Math.min(W - 1, Math.ceil(Math.max(...box.map((p) => p[0])) + 2));
    const by0 = Math.max(0, Math.floor(Math.min(...box.map((p) => p[1])) - 2));
    const by1 = Math.min(H - 1, Math.ceil(Math.max(...box.map((p) => p[1])) + 2));
    for (let y = by0; y <= by1; y++) {
      for (let x = bx0; x <= bx1; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const w = Hi[6] * px + Hi[7] * py + Hi[8];
        if (w <= 0) continue;
        const u = (Hi[0] * px + Hi[1] * py + Hi[2]) / w;
        const v = (Hi[3] * px + Hi[4] * py + Hi[5]) / w;
        if (!h.keep(u, v)) continue;
        const sdB = sdRoundRect(u, v, -B, -B, Sw + B, Sh + B, RB);
        // One pixel's size on the sheet here, for the edges' coverage.
        const w2 = w + Hi[6];
        const du = (Hi[0] * (px + 1) + Hi[1] * py + Hi[2]) / w2 - u;
        const dv = (Hi[3] * (px + 1) + Hi[4] * py + Hi[5]) / w2 - v;
        const w3 = w + Hi[7];
        const du2 = (Hi[0] * px + Hi[1] * (py + 1) + Hi[2]) / w3 - u;
        const dv2 = (Hi[3] * px + Hi[4] * (py + 1) + Hi[5]) / w3 - v;
        const pxs = Math.max(Math.hypot(du, dv), Math.hypot(du2, dv2), 1e-3);
        const covB = Math.min(1, Math.max(0, 0.5 - sdB / pxs));
        if (covB <= 0) continue;
        const covS = Math.min(1, Math.max(0, 0.5 - sdRoundRect(u, v, 0, 0, Sw, Sh, R) / pxs));
        let r0 = BEZEL[0];
        let g0 = BEZEL[1];
        let b0 = BEZEL[2];
        if (covS > 0) {
          sample(u, v, rgb);
          // The bend: a soft shade where the screen folds.
          const df = (g.foldAxis === 'v' ? v : u) - F;
          const shade = 1 - crease * Math.exp(-(df * df) / (2 * sigma * sigma));
          r0 += (rgb[0] * shade - r0) * covS;
          g0 += (rgb[1] * shade - g0) * covS;
          b0 += (rgb[2] * shade - b0) * covS;
        }
        // The rim: a polished band at the body's very edge, bright outside, dark toward the bezel.
        if (sdB > -RIM - pxs) {
          const t = Math.min(1, Math.max(0, (sdB + RIM) / RIM));
          const k = Math.min(1, Math.max(0, (sdB + RIM + pxs * 0.5) / pxs));
          r0 += (RIM_IN[0] + (RIM_OUT[0] - RIM_IN[0]) * t - r0) * k;
          g0 += (RIM_IN[1] + (RIM_OUT[1] - RIM_IN[1]) * t - g0) * k;
          b0 += (RIM_IN[2] + (RIM_OUT[2] - RIM_IN[2]) * t - b0) * k;
        }
        // Over what is there already (a wall, or nothing), with straight alpha, as ImageData keeps it.
        const o = (y * W + x) * 4;
        const a0 = out[o + 3] / 255;
        const a = covB + a0 * (1 - covB);
        const keep0 = a0 * (1 - covB);
        out[o] = (r0 * covB + out[o] * keep0) / a;
        out[o + 1] = (g0 * covB + out[o + 1] * keep0) / a;
        out[o + 2] = (b0 * covB + out[o + 2] * keep0) / a;
        out[o + 3] = a * 255;
      }
    }
  }
  lctx.putImageData(frame, 0, 0);
}

/**
 * Draw the half-open inner display around `img`, called like a frame drawer: (ctx, img, cx, cy, screenW)
 * says where the flat Duo frame would have put its body, `opts.fold` is a scene's fold (`resolveFold`;
 * without one the capture's shape picks the posture), and `opts.maxW` the width the device may take (the
 * frame's width). `opts.box` ({ cx, cy, boxW, boxH }) places it in a box of the caller's own instead. The
 * capture must have the posture's shape: tall for the laptop, wide for the book.
 *
 * Returns the device's bounds on the frame and `project(half, u, v, depth)`, which takes a sheet point on a
 * half (u, v in the screen's pixels; 0 deep is the screen's face, `sheet.thickness` its back) to where it
 * was drawn, for a caller or a test that needs to find it.
 */
export function drawFoldedDuo(ctx, img, cx, cy, screenW, opts = {}) {
  const landscape = img.width > img.height;
  const fold = resolveFold(opts.fold) ?? resolveFold(landscape ? 'book' : 'laptop');
  if (landscape !== (fold.posture === 'book')) {
    throw new Error(
      `fold: '${fold.posture}' needs a ${fold.posture === 'book' ? 'wide' : 'tall'} capture of the inner display ` +
      `(${fold.posture === 'book' ? '2853x2007, half open like a book' : '2007x2853, half open like a laptop'}); this one is ${img.width}x${img.height}.`,
    );
  }
  const src = screenPixels(img, landscape);
  const g = foldGeometry(src.Sw, src.Sh, fold);
  const fit = fitFold(g, opts.box ?? foldBox(img, cx, cy, screenW, fold, opts.maxW ?? ctx.canvas.width));

  if (fold.posture === 'book') paintBookShade(ctx, g, fit);

  // The device is drawn on its own layer at SS times the frame's pixels, then scaled down onto the frame.
  // The layer starts on a whole pixel, so its grid lines up with the frame's.
  const pad = 4;
  const lx = Math.floor(fit.bounds.x0) - pad;
  const ly = Math.floor(fit.bounds.y0) - pad;
  const lw = Math.ceil(fit.bounds.x1) + pad - lx;
  const lh = Math.ceil(fit.bounds.y1) + pad - ly;
  const fit2 = { s: fit.s * SS, tx: (fit.tx - lx) * SS, ty: (fit.ty - ly) * SS };
  const layer = createCanvas(lw * SS, lh * SS);
  paintWalls(layer.getContext('2d'), g, fit2);
  paintFaces(layer, g, fit2, src.data);

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(layer, lx, ly, lw, lh);
  ctx.restore();

  const byName = Object.fromEntries(g.halves.map((h) => [h.name, h]));
  return {
    bodyY: fit.bounds.y0,
    bodyH: fit.bounds.y1 - fit.bounds.y0,
    bounds: fit.bounds,
    halves: g.halves.map((h) => h.name),
    sheet: { w: src.Sw, h: src.Sh, fold: g.F, axis: g.foldAxis, bezel: g.B, corner: g.RB, thickness: g.T },
    project: (half, u, v, depth = 0) => {
      const h = byName[half];
      return projectWith(g, fit, sub(pointOn(h, u, v), mul(h.N, depth)));
    },
  };
}
