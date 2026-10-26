// Genera los iconos PNG de la PWA (512, 192 y maskable) sin dependencias externas.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'public');
mkdirSync(outDir, { recursive: true });

// ---------- utilidades matemáticas ----------
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

function roundedRectSDF(px, py, cx, cy, hw, hh, r) {
  const dx = Math.abs(px - cx) - (hw - r);
  const dy = Math.abs(py - cy) - (hh - r);
  const ax = Math.max(dx, 0);
  const ay = Math.max(dy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(dx, dy), 0) - r;
}

function segDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const c1 = vx * wx + vy * wy;
  const c2 = vx * vx + vy * vy;
  const t = clamp(c1 / c2, 0, 1);
  const dx = px - (ax + t * vx);
  const dy = py - (ay + t * vy);
  return Math.hypot(dx, dy);
}

// ---------- codificador PNG mínimo ----------
let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- dibujo ----------
function makeIcon(size, { rounded, maskable }) {
  const rgba = Buffer.alloc(size * size * 4);
  const aa = 1.2; // ancho de antialias en px
  const half = size / 2;
  const radius = rounded ? size * 0.22 : 0;
  const pad = rounded ? 0 : 0;

  // puntos del check (coordenadas normalizadas)
  const pts = [
    [0.27, 0.52],
    [0.445, 0.685],
    [0.74, 0.315]
  ];
  const th = size * 0.085;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;

      // fondo: gradiente diagonal violeta -> cian
      const t = (px + py) / (2 * (size - 1));
      let r = Math.round(lerp(124, 6, t));
      let g = Math.round(lerp(58, 182, t));
      let b = Math.round(lerp(237, 212, t));

      // recorte de esquinas (si procede)
      let bgAlpha = 1;
      if (rounded) {
        const d = roundedRectSDF(px, py, half, half, half - pad, half - pad, radius);
        bgAlpha = smoothstep(0.5, -0.5, d);
        if (bgAlpha <= 0) continue;
      }

      // check blanco
      const d1 = segDist(px, py, pts[0][0] * size, pts[0][1] * size, pts[1][0] * size, pts[1][1] * size);
      const d2 = segDist(px, py, pts[1][0] * size, pts[1][1] * size, pts[2][0] * size, pts[2][1] * size);
      const dc = Math.min(d1, d2);
      const ck = smoothstep(th / 2 + aa, th / 2 - aa, dc);

      // compone blanco sobre fondo
      r = Math.round(lerp(r, 255, ck));
      g = Math.round(lerp(g, 255, ck));
      b = Math.round(lerp(b, 255, ck));
      const a = Math.round(255 * bgAlpha);

      const i = (y * size + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = a;
    }
  }

  return encodePNG(size, size, rgba);
}

const files = [
  { name: 'icon-512.png', size: 512, rounded: true, maskable: false },
  { name: 'icon-192.png', size: 192, rounded: true, maskable: false },
  { name: 'icon-maskable-512.png', size: 512, rounded: false, maskable: true }
];

for (const f of files) {
  const png = makeIcon(f.size, f);
  writeFileSync(join(outDir, f.name), png);
  console.log('✔', f.name, `(${png.length} bytes)`);
}
