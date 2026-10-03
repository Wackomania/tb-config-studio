'use strict';
// Draws the app icon (three sliders on a blue-green rounded square, an original design) without any library and writes src/ui/favicon.ico
// (16, 32, 48, 64, 256 pixels, PNG inside) and src/ui/icon-256.png. Run once after changing the design: node scripts/make-icons.js
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(w, h, rgba) {
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
// geometry in a 64 x 64 design space
const inRound = (x, y, r) => { const cx = Math.min(Math.max(x, r), 64 - r), cy = Math.min(Math.max(y, r), 64 - r); return (x - cx) ** 2 + (y - cy) ** 2 <= r * r; };
const inCapsule = (x, y, x1, x2, yy, r) => { const cx = Math.min(Math.max(x, x1), x2); return (x - cx) ** 2 + (y - yy) ** 2 <= r * r; };
const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
function sample(x, y) {                                    // -> [r, g, b, a] of one point
  if (!inRound(x, y, 14)) return [0, 0, 0, 0];
  const k = (x + y) / 128;
  let c = [31 + (20 - 31) * k, 111 + (184 - 111) * k, 235 + (166 - 235) * k];
  const white = (a) => { c = c.map((v) => v + (255 - v) * a); };
  if ([20, 32, 44].some((yy) => inCapsule(x, y, 14, 50, yy, 2))) white(0.55);
  if (inCircle(x, y, 40, 20, 6) || inCircle(x, y, 24, 32, 6) || inCircle(x, y, 36, 44, 6)) white(1);
  return [c[0], c[1], c[2], 255];
}
function render(size) {
  const buf = Buffer.alloc(size * size * 4); const ss = 4;
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const s = sample(((px + (sx + 0.5) / ss) / size) * 64, ((py + (sy + 0.5) / ss) / size) * 64);
      r += s[0] * s[3]; g += s[1] * s[3]; b += s[2] * s[3]; a += s[3];
    }
    const o = (py * size + px) * 4; const n = ss * ss;
    if (a > 0) { buf[o] = Math.round(r / a); buf[o + 1] = Math.round(g / a); buf[o + 2] = Math.round(b / a); }
    buf[o + 3] = Math.round(a / n);
  }
  return png(size, size, buf);
}
const sizes = [16, 32, 48, 64, 256];
const imgs = sizes.map((s) => ({ s, data: render(s) }));
const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(imgs.length, 4);
let off = 6 + imgs.length * 16; const dirs = imgs.map(({ s, data }) => { const d = Buffer.alloc(16); d[0] = s === 256 ? 0 : s; d[1] = s === 256 ? 0 : s; d.writeUInt16LE(1, 4); d.writeUInt16LE(32, 6); d.writeUInt32LE(data.length, 8); d.writeUInt32LE(off, 12); off += data.length; return d; });
const ui = path.join(__dirname, '..', 'src', 'ui');
fs.writeFileSync(path.join(ui, 'favicon.ico'), Buffer.concat([head, ...dirs, ...imgs.map((i) => i.data)]));
fs.writeFileSync(path.join(ui, 'icon-256.png'), imgs[imgs.length - 1].data);
console.log('icons written');
