// Synthesize a ~10s phone-style double-ring WAV for the new-order notification channel.
// Run: node scripts/gen-sound.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sr = 44100;
const dur = 10;
const n = sr * dur;
const buf = Buffer.alloc(44 + n * 2);

// WAV header (mono, 16-bit PCM)
buf.write('RIFF', 0);
buf.writeUInt32LE(36 + n * 2, 4);
buf.write('WAVE', 8);
buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20); // PCM
buf.writeUInt16LE(1, 22); // mono
buf.writeUInt32LE(sr, 24);
buf.writeUInt32LE(sr * 2, 28);
buf.writeUInt16LE(2, 32);
buf.writeUInt16LE(16, 34);
buf.write('data', 36);
buf.writeUInt32LE(n * 2, 40);

// Double-ring every 2s: on 0–0.4s, gap, on 0.6–1.0s, silence 1.0–2.0s. Tones 440+480Hz (ringback).
const isOn = (t) => {
  const c = t % 2.0;
  return c < 0.4 || (c >= 0.6 && c < 1.0);
};
for (let i = 0; i < n; i++) {
  const t = i / sr;
  let s = 0;
  if (isOn(t)) {
    const env = Math.min(1, Math.min(t % 2.0, 0.6 - (t % 2.0), 0.05) / 0.02); // tiny attack/decay
    s = (Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 480 * t)) * 0.22 * Math.max(0.2, env);
  }
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), 44 + i * 2);
}

mkdirSync(`${ROOT}/admin-app/assets/sounds`, { recursive: true });
writeFileSync(`${ROOT}/admin-app/assets/sounds/order_ring.wav`, buf);
console.log('wrote admin-app/assets/sounds/order_ring.wav', 44 + n * 2, 'bytes');
