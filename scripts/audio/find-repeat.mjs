#!/usr/bin/env node
// Finds where a recording repeats itself, for a loop that wraps on the music's own repetition:
//   node scripts/audio/find-repeat.mjs <file> <startSec> <minLenSec> <maxLenSec> [windowSec=6]
// Compares the loudness envelope (5 ms frames) of <window> seconds after the start with every later point, and prints
// the best matches. A produced track that reuses a section scores > 0.9: looping [start, start+len) is then seamless,
// because what follows start+len is what follows start.
import path from 'node:path';
import { decode, SR } from './lib.mjs';

const HOP = Number(process.env.HOP || 220);
export function envFrames(mono, hop = HOP) {
  const out = new Float32Array(Math.floor(mono.length / hop));
  for (let f = 0; f < out.length; f++) { let s = 0; for (let i = f * hop; i < (f + 1) * hop; i++) s += mono[i] * mono[i]; out[f] = Math.sqrt(s / hop); }
  return out;
}
function corrAt(env, a, b, n) {
  let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += env[a + i]; mb += env[b + i]; } ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { const x = env[a + i] - ma, y = env[b + i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  return sab / Math.sqrt(saa * sbb + 1e-12);
}
export function findRepeats(chs, startSec, minLen, maxLen, windowSec = 6) {
  const mono = chs[0].map((v, i) => (v + chs[1][i]) / 2);
  const env = envFrames(mono);
  const fps = SR / HOP, a = Math.round(startSec * fps), n = Math.round(windowSec * fps);
  const res = [];
  for (let b = a + Math.round(minLen * fps); b <= a + Math.round(maxLen * fps) && b + n < env.length; b++) res.push({ len: (b - a) / fps, c: corrAt(env, a, b, n) });
  // local maxima only
  const peaks = res.filter((r, i) => i > 0 && i < res.length - 1 && r.c >= res[i - 1].c && r.c >= res[i + 1].c);
  return peaks.sort((x, y) => y.c - x.c);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const [file, s, mn, mx, w] = process.argv.slice(2);
  const chs = decode(file, 2);
  for (const p of findRepeats(chs, Number(s), Number(mn), Number(mx), Number(w || 6)).slice(0, 8)) console.log(`len ${p.len.toFixed(3)} s  corr ${p.c.toFixed(3)}`);
}
