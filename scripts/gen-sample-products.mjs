// Generates a sample Excel of 500 products (fruits + flowers) for load-testing the
// superuser Import/Export screen. Each row has a small base64 PNG image (so image loading
// is exercised) and most have a random 1–5 rating (seeds a review per product on import).
//
//   node scripts/gen-sample-products.mjs
//
// Output: scripts/sample-products-500.xlsx  (import it from Dashboard → Import / Export)
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import zlib from 'zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
// Resolve xlsx from the admin app's node_modules (that's where it's installed).
const require = createRequire(join(ROOT, 'admin-app', 'package.json'));
const XLSX = require('xlsx');

// --- tiny PNG encoder (solid colour) -------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
/** A size×size solid-colour RGB PNG, returned as base64 (no data: prefix). */
function solidPng(size, [r, g, b]) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  // 10,11,12 = compression/filter/interlace = 0
  const row = Buffer.alloc(1 + size * 3);
  for (let x = 0; x < size; x++) {
    row[1 + x * 3] = r;
    row[1 + x * 3 + 1] = g;
    row[1 + x * 3 + 2] = b;
  }
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const idat = zlib.deflateSync(raw);
  const png = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
  return png.toString('base64');
}
function hslToRgb(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

// --- product data --------------------------------------------------------------------
const FRUITS = ['Apple', 'Banana', 'Mango', 'Orange', 'Grapes', 'Pineapple', 'Watermelon', 'Papaya', 'Guava', 'Pomegranate', 'Strawberry', 'Kiwi', 'Pear', 'Plum', 'Peach', 'Cherry', 'Lychee', 'Fig', 'Jackfruit', 'Custard Apple', 'Sapota', 'Muskmelon', 'Dragon Fruit', 'Coconut'];
const FLOWERS = ['Rose', 'Jasmine', 'Marigold', 'Lotus', 'Lily', 'Tulip', 'Sunflower', 'Orchid', 'Hibiscus', 'Chrysanthemum', 'Daisy', 'Carnation', 'Lavender', 'Daffodil', 'Gerbera', 'Tuberose', 'Gardenia', 'Ixora', 'Crossandra', 'Champak', 'Oleander', 'Jasmine Garland', 'Rose Garland', 'Marigold Garland'];
const GRADES = ['Premium', 'Regular', 'Farm Fresh', 'Organic', 'Local', 'Imported', 'Grade A', 'Economy'];

const rnd = (min, max) => min + Math.random() * (max - min);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

const TOTAL = 500;
const rows = [];
for (let i = 0; i < TOTAL; i++) {
  const isFruit = i % 2 === 0;
  const base = isFruit ? FRUITS[i % FRUITS.length] : FLOWERS[i % FLOWERS.length];
  const name = `${pick(GRADES)} ${base} #${i + 1}`;
  const category = isFruit ? 'Fruits' : 'Flowers';
  const price = Math.round(rnd(isFruit ? 30 : 15, isFruit ? 300 : 500));
  const hasDiscount = Math.random() < 0.3;
  const unit = isFruit ? pick(['kg', 'kg', 'piece', 'g']) : pick(['piece', 'piece', 'g']);
  const perishable = true;
  const trackStock = Math.random() < 0.85;
  const onDemand = !isFruit && base.includes('Garland');
  const hasExpiry = Math.random() < 0.5;
  const color = hslToRgb(Math.round((i / TOTAL) * 360), 0.6, 0.55);
  const hasRating = Math.random() < 0.8;

  const d = new Date();
  d.setDate(d.getDate() + Math.round(rnd(1, 7)));
  const expiresAt = hasExpiry ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';

  rows.push({
    id: '',
    name,
    description: `Fresh ${base.toLowerCase()} — sample row ${i + 1} for load testing.`,
    category,
    price,
    discountPrice: hasDiscount ? Math.round(price * rnd(0.7, 0.95)) : '',
    unit,
    active: 'TRUE',
    featured: Math.random() < 0.08 ? 'TRUE' : 'FALSE',
    perishable: perishable ? 'TRUE' : 'FALSE',
    trackStock: trackStock ? 'TRUE' : 'FALSE',
    stock: trackStock ? Math.round(rnd(0, 200)) : '',
    fixedQty: Math.random() < 0.2 ? 'TRUE' : 'FALSE',
    onDemand: onDemand ? 'TRUE' : 'FALSE',
    prepTimeValue: onDemand ? Math.round(rnd(1, 6)) : '',
    prepTimeUnit: onDemand ? 'hours' : '',
    expiresAt,
    barcodes: '',
    imageId: '',
    imageBase64: solidPng(24, color),
    rating: hasRating ? Math.round(rnd(3, 5)) : '',
  });
}

const ws = XLSX.utils.json_to_sheet(rows);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Products');
const out = join(__dirname, 'sample-products-500.xlsx');
XLSX.writeFile(wb, out);
console.log(`Wrote ${rows.length} products → ${out}`);
