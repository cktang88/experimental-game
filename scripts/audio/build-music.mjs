#!/usr/bin/env node
// Builds the score: cuts each source recording into a whole-bar loop, makes the loop seamless, loudness-normalises it and
// encodes a small MP3 into public/assets/audio/music/. Also writes src/audio/trackdata.ts (tempo grid for the game).
//
//   node scripts/audio/build-music.mjs <sourceDir>
//
// Sources (download them into <sourceDir>; licences and attribution in CREDITS.md):
//   Lightless_Dawn.mp3, Industrial_Cinematic.mp3, The_Complex.mp3, Mechanolith.mp3, Volatile_Reaction.mp3  (Kevin MacLeod, CC BY 4.0)
//     https://incompetech.com/music/royalty-free/mp3-royaltyfree/<Title with %20>.mp3
//   Five_Armies.mp3 (Kevin MacLeod, CC BY 4.0)
//
// How a loop is cut without listening:
//   1. analyze-track.mjs finds the tempo grid (tempo, first downbeat) from onset autocorrelation.
//   2. The loop starts on a chosen bar line and is N bars long at the measured tempo (comb peak; see analyze-track.mjs),
//      then nudged by at most 6 ms so the low band just after the loop end lines up with the loop start.
//   3. The tail that follows the loop end is equal-power crossfaded into the head, so the wrap is the music's own continuation.
//   4. Integrated loudness is normalised to TARGET_LUFS and peaks are soft-limited below -1 dBFS.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { decode, encode, loudness, dbToGain, scale, softLimit, fade, SR, peak } from './lib.mjs';
import { analyze } from './analyze-track.mjs';

export const TARGET_LUFS = -18;
const KBPS = 112;

// id: game track id. start: loop start (s). bars x bpb beats at bpm is the loop length; each loop length below is where
// the recording repeats itself (find-repeat.mjs: envelope correlation 0.5..0.85), so the wrap continues the music.
// startBar instead of start: bar index from analyze-track output. oneShot: play once (no loop).
export const SPECS = [
  { id: 'title', src: 'Lightless_Dawn.mp3', bpm: 91, bpb: 4, start: 5.29, bars: 19, kbps: 112, title: 'Lightless Dawn', author: 'Kevin MacLeod' },
  { id: 'map', src: 'Industrial_Cinematic.mp3', bpm: 110, bpb: 4, start: 17.48, bars: 16, kbps: 112, title: 'Industrial Cinematic', author: 'Kevin MacLeod' },
  { id: 'combat', src: 'The_Complex.mp3', bpm: 104, bpb: 4, start: 111.95, bars: 32, kbps: 112, title: 'The Complex', author: 'Kevin MacLeod' },
  { id: 'elite', src: 'Mechanolith.mp3', bpm: 141, bpb: 4, start: 9.53, bars: 14, kbps: 128, title: 'Mechanolith', author: 'Kevin MacLeod' },
  { id: 'boss', src: 'Volatile_Reaction.mp3', bpm: 155, bpb: 7, start: 29.6, bars: 38, kbps: 96, title: 'Volatile Reaction', author: 'Kevin MacLeod' },
  { id: 'victory', src: 'Five_Armies.mp3', oneShot: true, fromEnd: 19, fadeOut: 2.5, kbps: 112, title: 'Five Armies', author: 'Kevin MacLeod' },
];

function envelope(mono, a, n, hop = 441) {
  const out = new Float32Array(Math.floor(n / hop));
  for (let f = 0; f < out.length; f++) { let s = 0; const o = a + f * hop; for (let i = 0; i < hop; i++) { const v = mono[o + i] || 0; s += v * v; } out[f] = Math.sqrt(s / hop); }
  return out;
}
function corr(x, y) {
  let mx = 0, my = 0; for (let i = 0; i < x.length; i++) { mx += x[i]; my += y[i]; } mx /= x.length; my /= y.length;
  let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < x.length; i++) { const a = x[i] - mx, b = y[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
  return sxy / Math.sqrt(sxx * syy + 1e-12);
}

/** Refine the loop length (samples) so the audio after the end continues like the start. */
export function refineLoop(chs, start, len0) {
  const mono = chs[0].map((v, i) => (v + chs[1][i]) / 2);
  const win = Math.floor(SR * 4);
  const head = envelope(mono, start, win, 220);
  // the tempo is fixed (measured), so the length only moves by waveform alignment below; the envelope correlation is
  // reported as a sanity number (different phrases at start and end score low even when the grid is exact)
  const best = { len: len0, c: start + len0 + win < mono.length ? corr(head, envelope(mono, start + len0, win, 220)) : 0 };
  // waveform alignment within +-6 ms on the low band
  const lp = new Float32Array(mono.length); let y = 0; const a = Math.exp(-2 * Math.PI * 300 / SR);
  for (let i = 0; i < mono.length; i++) { y = a * y + (1 - a) * mono[i]; lp[i] = y; }
  const w = Math.floor(SR * 0.25), h = lp.subarray(start, start + w);
  let fine = { len: best.len, c: -2 };
  for (let d = -265; d <= 265; d++) {
    const L = best.len + d; if (start + L + w >= lp.length) continue;
    const c = corr(h, lp.subarray(start + L, start + L + w));
    if (c > fine.c) fine = { len: L, c };
  }
  return { len: fine.len, envCorr: best.c, waveCorr: fine.c };
}

/** Seamless loop: equal-power crossfade of the post-loop tail into the head. */
export function makeLoop(chs, start, len, xfS = 0.12) {
  const xf = Math.floor(SR * xfS);
  return chs.map((ch) => {
    const out = ch.slice(start, start + len);
    for (let i = 0; i < xf; i++) {
      const k = i / xf, fin = Math.sin((k * Math.PI) / 2), fout = Math.cos((k * Math.PI) / 2);
      out[i] = ch[start + i] * fin + (ch[start + len + i] || 0) * fout;
    }
    return out;
  });
}

function normalize(chs) {
  const before = loudness(chs);
  scale(chs, dbToGain(TARGET_LUFS - before.lufs));
  softLimit(chs, dbToGain(-1.2));
  return { before, after: loudness(chs) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const srcDir = process.argv[2];
  if (!srcDir) { console.error('usage: node scripts/audio/build-music.mjs <sourceDir> [id...]'); process.exit(1); }
  const only = process.argv.slice(3);
  const root = path.resolve(import.meta.dirname, '../..');
  const outDir = path.join(root, 'public/assets/audio/music');
  mkdirSync(outDir, { recursive: true });
  const meta = {};
  for (const s of SPECS) {
    if (only.length && !only.includes(s.id)) continue;
    const file = path.join(srcDir, s.src);
    const chs = decode(file, 2);
    let out, info;
    if (s.oneShot) {
      const total = chs[0].length / SR;
      const from = s.fromEnd ? total - s.fromEnd : s.from, to = s.fromEnd ? total : Math.min(total, s.to);
      out = chs.map((c) => c.slice(Math.floor(from * SR), Math.floor(to * SR)));
      fade(out, Math.floor(0.01 * SR), Math.floor(s.fadeOut * SR));
      info = { loop: false, duration: out[0].length / SR };
    } else {
      const g = s.start === undefined ? analyze(file, s.bpm, s.bpb, { fixed: true }) : null;
      const barSeconds = (60 / s.bpm) * s.bpb;
      const start = Math.round((g ? g.firstDownbeat + s.startBar * barSeconds : s.start) * SR);
      const len0 = Math.round(s.bars * barSeconds * SR);
      const r = refineLoop(chs, start, len0);
      out = makeLoop(chs, start, r.len);
      const bpm = (s.bars * s.bpb * 60) / (r.len / SR);
      info = { loop: true, bpm: +bpm.toFixed(4), beatsPerBar: s.bpb, bars: s.bars, duration: +(r.len / SR).toFixed(5), seam: { env: +r.envCorr.toFixed(3), wave: +r.waveCorr.toFixed(3) } };
    }
    const n = normalize(out);
    const dest = path.join(outDir, `${s.id}.mp3`);
    encode(out, dest, { kbps: s.kbps ?? KBPS });
    meta[s.id] = { file: `${s.id}.mp3`, ...info, lufs: +n.after.lufs.toFixed(1), peak: +peak(out).toFixed(3) };
    console.log(s.id, JSON.stringify(meta[s.id]), `(source ${n.before.lufs} LUFS)`);
  }
  if (!only.length) {
    const ts = `// Generated by scripts/audio/build-music.mjs. Tempo grid of each music file in public/assets/audio/music/.\n` +
      `// Loops hold a whole number of bars from a downbeat, so position / beat length is the musical beat.\n` +
      `import type { TrackInfo } from './scene';\n\nexport const TRACK_DATA: Record<string, TrackInfo> = ${JSON.stringify(Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, { file: v.file, loop: v.loop, bpm: v.bpm ?? 120, beatsPerBar: v.beatsPerBar ?? 4, bars: v.bars ?? 0, duration: v.duration }])), null, 2)};\n`;
    writeFileSync(path.join(root, 'src/audio/trackdata.ts'), ts);
  }
}
