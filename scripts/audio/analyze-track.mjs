#!/usr/bin/env node
// Tempo-grid analysis for cutting music loops on bar lines without listening:
//   node scripts/audio/analyze-track.mjs <file> <bpm> [beatsPerBar=4] [fixed]
// The tempo search is a comb over onset strength. Electronic tracks show a needle-sharp peak at the true tempo (check it
// with a few candidate values); pass `fixed` to keep the given tempo and only find the phase and downbeat.
// Refines the tempo within +-1.5 %, finds the beat phase (first beat time) and which beat of the bar is the downbeat
// (the beat with the strongest low-band onsets), then prints one row per bar: start time and loudness, so a section
// with the wanted energy can be picked and cut to whole bars by build-music.mjs.
import path from 'node:path';
import { decode, onsetEnvelope, SR } from './lib.mjs';

export function analyze(file, bpm, bpb = 4, { fixed = false } = {}) {
  const chs = decode(file, 2);
  const env = onsetEnvelope(chs);
  const fps = SR / 441;
  const score = (b, phase) => {
    const step = (60 / b) * fps; let s = 0, n = 0;
    for (let t = phase; t < env.length - 1; t += step) { const i = Math.floor(t), f = t - i; s += env[i] * (1 - f) + env[i + 1] * f; n++; }
    return s / Math.max(1, n);
  };
  let best = { bpm, phase: 0, s: -1 };
  for (let k = fixed ? 0 : -30; k <= (fixed ? 0 : 30); k++) {
    const b = bpm * (1 + k * 0.0005), step = (60 / b) * fps;
    for (let p = 0; p < step; p += 0.25) { const s = score(b, p); if (s > best.s) best = { bpm: b, phase: p, s }; }
  }
  // Long-lag autocorrelation of the onset envelope (8 bars) pins the tempo far more precisely than the comb alone:
  // a 0.3 % error drifts half a beat over a 24-bar loop.
  const ac = (lag) => { const i0 = Math.floor(lag), f = lag - i0; let s = 0; for (let i = 0; i + i0 + 1 < env.length; i++) s += env[i] * (env[i + i0] * (1 - f) + env[i + i0 + 1] * f); return s; };
  const lag0 = 8 * bpb * (60 / best.bpm) * fps;
  let bestLag = lag0, bestAc = -1;
  for (let l = lag0 * 0.985; l <= lag0 * 1.015; l += 0.05) { const s = ac(l); if (s > bestAc) { bestAc = s; bestLag = l; } }
  const acBpm = (8 * bpb * 60 * fps) / bestLag;
  const stated = bpm;
  // prefer the stated tempo when the autocorrelation agrees within 0.05 %
  best.bpm = fixed || Math.abs(acBpm / stated - 1) < 0.0005 ? stated : acBpm;
  let bp = { p: 0, s: -1 }; const st = (60 / best.bpm) * fps;
  for (let p = 0; p < st; p += 0.25) { const s = score(best.bpm, p); if (s > bp.s) bp = { p, s }; }
  best.phase = bp.p;
  const beat = 60 / best.bpm, phase0 = best.phase / fps;
  // downbeat: which of the bpb beat slots carries the most low-band onset energy across the track
  const slot = new Float64Array(bpb);
  for (let k = 0, t = phase0; t * fps < env.length - 1; k++, t += beat) slot[k % bpb] += env[Math.round(t * fps)] || 0;
  let down = 0; for (let i = 1; i < bpb; i++) if (slot[i] > slot[down]) down = i;
  const first = phase0 + down * beat;
  const bar = beat * bpb, bars = [];
  const mono = chs[0];
  for (let t = first; (t + bar) * SR <= mono.length; t += bar) {
    let s = 0; const a = Math.floor(t * SR), b = Math.floor((t + bar) * SR);
    for (let i = a; i < b; i++) s += (chs[0][i] ** 2 + chs[1][i] ** 2) / 2;
    bars.push({ t, db: 10 * Math.log10(s / (b - a) + 1e-12) });
  }
  return { bpm: best.bpm, beat, firstDownbeat: first, barSeconds: bar, bars, slot: [...slot], duration: mono.length / SR };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const [file, bpmS, bpbS, fixedS] = process.argv.slice(2);
  const r = analyze(file, Number(bpmS), Number(bpbS || 4), { fixed: fixedS === 'fixed' });
  console.log(`${path.basename(file)}: bpm ${r.bpm.toFixed(3)}  bar ${r.barSeconds.toFixed(3)}s  first downbeat ${r.firstDownbeat.toFixed(3)}s  slots ${r.slot.map((v) => v.toFixed(0)).join('/')}  duration ${r.duration.toFixed(1)}s`);
  r.bars.forEach((b, i) => console.log(`bar ${String(i).padStart(3)} @ ${b.t.toFixed(2).padStart(7)}s  ${b.db.toFixed(1).padStart(6)} dB  ${'#'.repeat(Math.max(0, Math.round((b.db + 40) / 1.2)))}`));
}
