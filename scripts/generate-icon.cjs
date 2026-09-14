/* Generates build/icon.ico for HR PRO Jordan — pure Node, no image deps.
 * Design: deep-navy rounded square + three "report rows" bars (white/amber). */
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');

const W = 256, H = 256;
// --- palette ---
const bg = [22, 50, 79];        // #16324F deep navy
const bar = [245, 248, 250];    // #F5F8FA near-white
const accent = [240, 180, 41];  // #F0B429 amber

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
// signed distance to rounded rect centered at (cx,cy) with half-sizes (hw,hh), radius r
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r), qy = Math.abs(py - cy) - (hh - r);
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
  return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(qx, qy), 0) - r;
}
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

const px = Buffer.alloc(W * H * 4);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const cx = x + 0.5, cy = y + 0.5;
    // anti-aliased rounded-square background (radius 52, 6px soft edge)
    const d = sdRoundRect(cx, cy, W / 2, H / 2, W / 2 - 2, H / 2 - 2, 52);
    let alpha = clamp(0.5 - d, 0, 1); // 1 inside, 0 outside, AA on border
    let col = bg;
    // subtle darker bottom band for depth (lower 22%)
    if (cy > H * 0.78) col = mix(bg, [14, 34, 56], clamp((cy - H * 0.78) / (H * 0.22), 0, 1) * 0.9);
    // three report rows: (y-center, halfheight, x-start, width, color)
    const rows = [
      [86, 11, 64, 128, bar],
      [124, 11, 64, 96, accent],
      [162, 11, 64, 64, bar],
    ];
    for (const [ry, rh, rx0, rw, rc] of rows) {
      // rounded-end bars: distance to capsule
      const rx1 = rx0 + rw;
      const dx = clamp(cx, rx0 + rh, rx1 - rh) - cx;
      const dy = cy - ry;
      const dist = Math.sqrt(dx * dx + dy * dy) - rh;
      const t = clamp(0.5 - dist, 0, 1);
      if (t > 0) col = mix(col, rc, t);
    }
    const i = (y * W + x) * 4;
    px[i] = Math.round(col[0]); px[i + 1] = Math.round(col[1]); px[i + 2] = Math.round(col[2]); px[i + 3] = Math.round(alpha * 255);
  }
}

// --- PNG encode (RGBA, 8-bit) ---
const CRC_TABLE = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; } return t; })();
function crc32(buf) { let c = -1; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) { raw[y * (W * 4 + 1)] = 0; px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4); }
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

// --- ICO wrapper (256px PNG-embedded; width/height byte 0 means 256) ---
const entry = Buffer.alloc(16);
entry[0] = 0; entry[1] = 0;           // 256 x 256
entry[2] = 0; entry[3] = 0;           // colors, reserved
entry.writeUInt16LE(1, 4);            // planes
entry.writeUInt16LE(32, 6);           // bpp
entry.writeUInt32LE(png.length, 8);   // data size
entry.writeUInt32LE(22, 12);          // offset (6 header + 16 entry)
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
const ico = Buffer.concat([header, entry, png]);

const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);
console.log('icon.ico written:', ico.length, 'bytes');
