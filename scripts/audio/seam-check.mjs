#!/usr/bin/env node
// Loop-seam check without ears: `node scripts/audio/seam-check.mjs <loop.mp3> <out.png> [seconds=3]`
// Renders the last N seconds of the loop followed by its first N seconds (what the player hears at the wrap) as a
// waveform + spectrogram picture, and prints the level step and sample jump across the seam.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { decode, encode, SR } from './lib.mjs';

const [file, out, secS] = process.argv.slice(2);
const sec = Number(secS || 3);
const chs = decode(file, 2);
const n = chs[0].length, k = Math.floor(sec * SR);
const joined = chs.map((c) => { const o = new Float32Array(2 * k); o.set(c.subarray(n - k), 0); o.set(c.subarray(0, k), k); return o; });
const rmsDb = (c, a, b) => { let s = 0; for (let i = a; i < b; i++) s += c[i] * c[i]; return 10 * Math.log10(s / (b - a) + 1e-12); };
const w = Math.floor(0.25 * SR);
console.log(`${path.basename(file)}: ${(n / SR).toFixed(3)} s, level before seam ${rmsDb(joined[0], k - w, k).toFixed(1)} dB, after ${rmsDb(joined[0], k, k + w).toFixed(1)} dB, sample jump ${Math.abs(joined[0][k] - joined[0][k - 1]).toFixed(4)}`);
if (out) {
  const tmp = out.replace(/\.png$/, '.wav');
  encode(joined, tmp);
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', tmp, '-filter_complex', '[0]asplit[a][b];[a]showwavespic=s=1200x200:colors=white[w];[b]showspectrumpic=s=1200x300:legend=0:scale=log[s];[w][s]vstack', '-frames:v', '1', out]);
}
