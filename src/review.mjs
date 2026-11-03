/**
 * The review of shots that differ from their reference (compare.mjs): a folder with the old shot, the new one and the
 * difference marked, and one self-contained `index.html` that can be sent to a phone. `zdymak approve` makes an
 * approved source-language shot the reference (an approved translated shot is remembered by its content, so the same
 * picture is not asked about twice); `zdymak reject` records the no.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { LAYOUT_CELL, readApprovals, sha256, writeApprovals } from './compare.mjs';
import { rgbPngBuffer } from './png.mjs';

/** The new shot faded, with what changed painted over it: pixels for a pixel comparison, cells for a layout one. */
function diffCanvas(item) {
  const d = item.diff;
  const { width: w, height: h } = d.shot;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < out.length; i += 4) {
    const grey = 0.3 * d.shot.data[i] + 0.59 * d.shot.data[i + 1] + 0.11 * d.shot.data[i + 2];
    out[i] = out[i + 1] = out[i + 2] = 150 + grey * 0.4; out[i + 3] = 255;
  }
  // The mark is blended over the faded shot, so a shot that changed everywhere still shows what it is.
  const paint = (p, colour) => { for (let k = 0; k < 3; k++) out[p * 4 + k] = 0.35 * out[p * 4 + k] + 0.65 * colour[k]; };
  for (let i = 0; i < out.length; i += 4) for (let k = 0; k < 3; k++) out[i + k] = 0.5 * out[i + k] + 0.5 * d.shot.data[i + k] * 0.6 + 40;
  if (d.changed) {
    for (let p = 0; p < d.changed.length; p++) if (d.changed[p]) paint(p, [214, 0, 120]);
  } else {
    const cell = (c, colour, every) => {
      const cx = (c % d.cols) * LAYOUT_CELL;
      const cy = Math.floor(c / d.cols) * LAYOUT_CELL;
      for (let y = cy; y < Math.min(h, cy + LAYOUT_CELL); y++) {
        for (let x = cx; x < Math.min(w, cx + LAYOUT_CELL); x++) if ((x + y) % every === 0) paint(y * w + x, colour);
      }
    };
    for (const c of d.masked) cell(c, [90, 120, 200], 6);
    for (const c of d.moved) cell(c, [214, 0, 120], 1);
  }
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  img.data.set(out);
  ctx.putImageData(img, 0, 0);
  return canvas;
}

async function preview(file, maxWidth = 720) {
  const img = await loadImage(file);
  const scale = Math.min(1, maxWidth / img.width);
  const c = createCanvas(Math.round(img.width * scale), Math.round(img.height * scale));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return `data:image/jpeg;base64,${(await c.encode('jpeg', 80)).toString('base64')}`;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * Write the review folder for the items that need the owner: each item's old shot, new shot and difference as PNGs,
 * `review.json`, and `index.html`, one self-contained page (previews inline) to read on a phone. Its buttons gather
 * the answers into the `zdymak approve` and `zdymak reject` lines to paste back. Returns the page's path.
 */
export async function writeReview(items, dir, { refs }) {
  const pending = items.filter((i) => i.review);
  fs.mkdirSync(dir, { recursive: true });
  const cards = [];
  for (const it of pending) {
    const files = { new: `${it.id}.new.png` };
    fs.copyFileSync(it.file, path.join(dir, files.new));
    if (fs.existsSync(it.reference)) { files.old = `${it.id}.old.png`; fs.copyFileSync(it.reference, path.join(dir, files.old)); }
    if (it.diff) { files.diff = `${it.id}.diff.png`; fs.writeFileSync(path.join(dir, files.diff), rgbPngBuffer(diffCanvas(it))); }
    it.files = files;
    const pics = [['Approved', files.old], ['New', files.new], ['Difference', files.diff]].filter(([, f]) => f);
    const figs = await Promise.all(pics.map(async ([label, f]) => `<figure><img src="${await preview(path.join(dir, f))}" alt="${label} shot of ${esc(it.scene)}"><figcaption>${label}</figcaption></figure>`));
    cards.push(`<section data-id="${esc(it.id)}"><h2>${esc(it.target)} · ${esc(it.language)} · ${esc(it.scene)}</h2><p>${esc(it.reason)}</p>`
      + `<div class="pics">${figs.join('')}</div><div class="act"><button data-v="approve">Approve</button><button data-v="reject">Reject</button></div></section>`);
  }
  const record = pending.map(({ diff, ...rest }) => rest);
  fs.writeFileSync(path.join(dir, 'review.json'), `${JSON.stringify({ references: path.resolve(refs), items: record }, null, 2)}\n`);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Screenshots to review</title><style>
:root{color-scheme:light dark;font:16px/1.5 system-ui,sans-serif}body{margin:0 auto;max-width:72rem;padding:1rem}
section{border-top:1px solid #8888;padding:1rem 0}.pics{display:flex;gap:.75rem;overflow-x:auto}figure{margin:0;flex:0 0 min(80vw,22rem)}
img{width:100%;height:auto;border:1px solid #8886}figcaption{font-weight:600}.act{display:flex;gap:1rem;margin-top:.75rem}
button{font:inherit;min-height:44px;min-width:44px;padding:.5rem 1.25rem;border-radius:.5rem;border:2px solid currentColor;background:none;color:inherit}
button[aria-pressed=true]{background:#0b6e4f;color:#fff;border-color:#0b6e4f}button[data-v=reject][aria-pressed=true]{background:#a4133c;border-color:#a4133c}
pre{white-space:pre-wrap;word-break:break-all;padding:.75rem;border:1px solid #8886}</style></head><body>
<h1>Screenshots to review</h1><p>${pending.length} shot(s) differ from the approved reference or have none yet. Approve or reject each, then send the lines at the end.</p>
${cards.join('\n')}
<h2>Your answers</h2><pre id="out" aria-live="polite">No answers yet.</pre><button id="copy">Copy</button>
<script>
const dir=${JSON.stringify(path.resolve(dir))};const ans={};
for(const s of document.querySelectorAll('section'))for(const b of s.querySelectorAll('button'))b.setAttribute('aria-pressed','false'),b.onclick=()=>{ans[s.dataset.id]=b.dataset.v;for(const o of s.querySelectorAll('button'))o.setAttribute('aria-pressed',String(o===b));show();};
function show(){const by=v=>Object.keys(ans).filter(k=>ans[k]===v);const l=[];for(const v of['approve','reject'])if(by(v).length)l.push('zdymak '+v+' '+JSON.stringify(dir)+' '+by(v).join(' '));document.getElementById('out').textContent=l.join('\\n')||'No answers yet.';}
document.getElementById('copy').onclick=()=>navigator.clipboard&&navigator.clipboard.writeText(document.getElementById('out').textContent);
</script></body></html>
`;
  const page = path.join(dir, 'index.html');
  fs.writeFileSync(page, html);
  return page;
}

/**
 * Answer review items: `approve` makes a source-language shot its scene's reference and remembers a translated shot
 * by its content; `reject` changes no reference. Both are written to the review's `decisions.json`. `ids` empty with
 * `all` answers every item. Returns the items answered.
 */
export function decide(dir, ids, verdict, { all = false, now = new Date() } = {}) {
  if (!['approve', 'reject'].includes(verdict)) throw new Error(`decide: ${verdict} is neither approve nor reject`);
  const review = JSON.parse(fs.readFileSync(path.join(dir, 'review.json'), 'utf8'));
  const chosen = all ? review.items : ids.map((id) => review.items.find((i) => i.id === id) || (() => { throw new Error(`${verdict}: no item ${id} in ${dir}`); })());
  const refs = review.references;
  const approvals = readApprovals(refs);
  approvals.references ??= {};
  approvals.accepted ??= {};
  const decisionsFile = path.join(dir, 'decisions.json');
  const decisions = fs.existsSync(decisionsFile) ? JSON.parse(fs.readFileSync(decisionsFile, 'utf8')) : {};
  const when = now.toISOString();
  for (const it of chosen) {
    const shot = path.join(dir, it.files.new);
    if (verdict === 'approve') {
      const sum = sha256(shot);
      if (it.source) {
        fs.mkdirSync(path.dirname(it.reference), { recursive: true });
        fs.copyFileSync(shot, it.reference);
        approvals.references[`${it.target}/${it.scene}`] = { sha256: sum, approved: when, from: it.file };
      } else {
        approvals.accepted[sum] = { target: it.target, scene: it.scene, language: it.language, approved: when };
      }
    }
    decisions[it.id] = { verdict, when };
  }
  if (verdict === 'approve') writeApprovals(refs, approvals);
  fs.writeFileSync(decisionsFile, `${JSON.stringify(decisions, null, 2)}\n`);
  return chosen;
}
