// Generates app icons for both apps: a flower whose heart is a fruit (white on a green
// gradient). The admin build gets an extra gear badge. Run: node scripts/gen-icons.mjs
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = 1024;
const GREEN_DARK = '#2E7D32';
const GREEN_LITE = '#66BB6A';
const FRUIT = '#FB8C00';

// --- gear glyph (admin only) ---------------------------------------------------
function gearPolygon(cx, cy, rOut, rIn, teeth) {
  let d = '';
  const steps = teeth * 2;
  for (let k = 0; k < steps; k++) {
    const ang = (Math.PI * k) / teeth - Math.PI / 2;
    const r = k % 2 === 0 ? rOut : rIn;
    const x = (cx + r * Math.cos(ang)).toFixed(1);
    const y = (cy + r * Math.sin(ang)).toFixed(1);
    d += (k === 0 ? 'M' : 'L') + x + ',' + y;
  }
  return d + 'Z';
}
function circleSubpath(cx, cy, r) {
  return `M${cx - r},${cy} a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 ${-2 * r},0 Z`;
}

// --- the combined mark: a flower AND a distinct fruit, centered at the origin --
function flower(cx, cy, mono) {
  const petal = '#ffffff';
  const center = mono ? '#ffffff' : '#FFC107'; // yellow heart so the flower reads as a flower
  let s = `<g transform="translate(${cx},${cy})">`;
  for (let i = 0; i < 8; i++) {
    s += `<g transform="rotate(${i * 45})"><ellipse cx="0" cy="-116" rx="38" ry="76" fill="${petal}"/></g>`;
  }
  s += `<circle cx="0" cy="0" r="62" fill="${center}"/>`;
  if (!mono) s += `<circle cx="-16" cy="-16" r="13" fill="#ffffff" opacity="0.6"/>`;
  return s + `</g>`;
}

function fruit(cx, cy, mono) {
  const body = mono ? '#ffffff' : FRUIT; // orange fruit
  const leaf = mono ? '#ffffff' : '#66BB6A';
  let s = `<g transform="translate(${cx},${cy})">`;
  s += `<path d="M4,-108 q60,-58 134,-42 q-14,78 -96,60 z" fill="${leaf}"/>`; // leaf peeking from top
  s += `<circle cx="0" cy="0" r="132" fill="${body}"/>`;
  if (!mono) s += `<circle cx="-48" cy="-48" r="30" fill="#ffffff" opacity="0.85"/>`;
  return s + `</g>`;
}

function emblem({ mono, admin }) {
  let s = '';
  s += flower(-98, -104, mono); // flower upper-left
  s += fruit(72, 80, mono); //    fruit lower-right, overlapping
  if (admin) {
    const gx = 184, gy = 188;
    if (mono) {
      s += `<path d="${gearPolygon(gx, gy, 84, 58, 9)} ${circleSubpath(gx, gy, 30)}" fill="#ffffff" fill-rule="evenodd"/>`;
    } else {
      s += `<circle cx="${gx}" cy="${gy}" r="92" fill="#ffffff"/>`;
      s += `<path d="${gearPolygon(gx, gy, 72, 50, 9)}" fill="${GREEN_DARK}"/>`;
      s += `<circle cx="${gx}" cy="${gy}" r="26" fill="#ffffff"/>`;
    }
  }
  return s;
}

function gradientDefs() {
  return `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${GREEN_DARK}"/><stop offset="1" stop-color="${GREEN_LITE}"/>
  </linearGradient></defs>`;
}

const svg = (inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">${inner}</svg>`;

// Full icon: gradient background + mark.
const iconSVG = (admin) =>
  svg(`${gradientDefs()}<rect width="${SIZE}" height="${SIZE}" rx="200" fill="url(#bg)"/>
    <g transform="translate(512,512) scale(0.95)">${emblem({ mono: false, admin })}</g>`);

// Adaptive foreground / splash: mark only, transparent, inside the safe zone.
const foregroundSVG = (admin) =>
  svg(`<g transform="translate(512,512) scale(0.82)">${emblem({ mono: false, admin })}</g>`);

// Adaptive background: the gradient alone.
const backgroundSVG = () =>
  svg(`${gradientDefs()}<rect width="${SIZE}" height="${SIZE}" fill="url(#bg)"/>`);

// Monochrome (Android 13 themed icons): white silhouette, transparent.
const monochromeSVG = (admin) =>
  svg(`<g transform="translate(512,512) scale(0.82)">${emblem({ mono: true, admin })}</g>`);

async function png(svgStr, outPath, size = SIZE) {
  mkdirSync(dirname(outPath), { recursive: true });
  await sharp(Buffer.from(svgStr)).resize(size, size).png().toFile(outPath);
  console.log('  ✓', outPath.replace(ROOT + '/', ''));
}

for (const [app, admin] of [['admin-app', true], ['buyer-app', false]]) {
  const dir = `${ROOT}/${app}/assets/images`;
  console.log(`\n${app} (${admin ? 'with gear badge' : 'base mark'}):`);
  await png(iconSVG(admin), `${dir}/icon.png`);
  await png(foregroundSVG(admin), `${dir}/android-icon-foreground.png`);
  await png(backgroundSVG(), `${dir}/android-icon-background.png`);
  await png(monochromeSVG(admin), `${dir}/android-icon-monochrome.png`);
  await png(foregroundSVG(admin), `${dir}/splash-icon.png`);
  await png(iconSVG(admin), `${dir}/favicon.png`, 48);
}
console.log('\nDone.');
