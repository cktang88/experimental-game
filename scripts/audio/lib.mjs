// Shared helpers for the audio build scripts: decode with ffmpeg to float PCM, process in JS, encode back.
import { spawnSync } from 'node:child_process';

export const SR = 44100;

/** Decode any file to interleaved float32 PCM at 44.1 kHz with `channels` channels. Returns per-channel arrays. */
export function decode(file, channels = 2, sr = SR) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-i', file, '-f', 'f32le', '-acodec', 'pcm_f32le', '-ac', String(channels), '-ar', String(sr), '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`ffmpeg decode failed for ${file}: ${r.stderr}`);
  const all = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.byteLength / 4);
  const n = all.length / channels;
  const out = Array.from({ length: channels }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < channels; c++) out[c][i] = all[i * channels + c];
  return out;
}

/** Encode per-channel float PCM. fmt: 'mp3' (libmp3lame CBR kbps) or 'wav'. */
export function encode(chs, file, { kbps = 112, sr = SR, extra = [] } = {}) {
  const n = chs[0].length, c = chs.length, inter = new Float32Array(n * c);
  for (let i = 0; i < n; i++) for (let k = 0; k < c; k++) inter[i * c + k] = chs[k][i];
  const codec = file.endsWith('.wav') ? ['-c:a', 'pcm_s16le'] : file.endsWith('.ogg') ? ['-c:a', 'libvorbis', '-b:a', `${kbps}k`] : ['-c:a', 'libmp3lame', '-b:a', `${kbps}k`];
  const r = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'f32le', '-ar', String(sr), '-ac', String(c), '-i', '-', ...extra, ...codec, '-map_metadata', '-1', file], { input: Buffer.from(inter.buffer) });
  if (r.status !== 0) throw new Error(`ffmpeg encode failed for ${file}: ${r.stderr}`);
}

/** Integrated loudness (LUFS) and true peak (dBTP) of per-channel PCM, measured by ffmpeg's ebur128. */
export function loudness(chs, sr = SR) {
  const n = chs[0].length, c = chs.length, inter = new Float32Array(n * c);
  for (let i = 0; i < n; i++) for (let k = 0; k < c; k++) inter[i * c + k] = chs[k][i];
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-f', 'f32le', '-ar', String(sr), '-ac', String(c), '-i', '-', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { input: Buffer.from(inter.buffer), encoding: 'utf8', maxBuffer: 1 << 28 });
  const s = r.stderr.slice(r.stderr.lastIndexOf('Summary:'));
  const lufs = Number((s.match(/I:\s+(-?[\d.]+|-inf) LUFS/) || [])[1]);
  const tp = Number((s.match(/Peak:\s+(-?[\d.]+|-inf) dBFS/) || [])[1]);
  return { lufs, truePeak: tp };
}

export const dbToGain = (db) => Math.pow(10, db / 20);
export const gainToDb = (g) => 20 * Math.log10(Math.max(1e-9, g));
export function peak(chs) { let p = 0; for (const ch of chs) for (let i = 0; i < ch.length; i++) { const a = Math.abs(ch[i]); if (a > p) p = a; } return p; }
export function rms(chs) { let s = 0, n = 0; for (const ch of chs) { for (let i = 0; i < ch.length; i++) s += ch[i] * ch[i]; n += ch.length; } return Math.sqrt(s / Math.max(1, n)); }
export function scale(chs, g) { for (const ch of chs) for (let i = 0; i < ch.length; i++) ch[i] *= g; return chs; }
export function slice(chs, a, b) { return chs.map((ch) => ch.slice(Math.max(0, a), Math.min(ch.length, b))); }

/** Soft-knee limiter to keep sample peaks under `ceil` (linear) without audible pumping: tanh above the knee. */
export function softLimit(chs, ceil = 0.89) {
  const knee = ceil * 0.8;
  for (const ch of chs) for (let i = 0; i < ch.length; i++) {
    const x = ch[i], a = Math.abs(x);
    if (a > knee) ch[i] = Math.sign(x) * (knee + (ceil - knee) * Math.tanh((a - knee) / (ceil - knee)));
  }
  return chs;
}

/** Index of the first sample louder than `thresholdDb` (for trimming lead silence). */
export function firstAbove(chs, thresholdDb = -50) {
  const t = dbToGain(thresholdDb);
  for (let i = 0; i < chs[0].length; i++) for (const ch of chs) if (Math.abs(ch[i]) > t) return i;
  return 0;
}
export function lastAbove(chs, thresholdDb = -60) {
  const t = dbToGain(thresholdDb);
  for (let i = chs[0].length - 1; i >= 0; i--) for (const ch of chs) if (Math.abs(ch[i]) > t) return i;
  return chs[0].length - 1;
}

/** Linear fades in/out (samples). */
export function fade(chs, inS, outS) {
  for (const ch of chs) {
    const n = ch.length;
    for (let i = 0; i < Math.min(inS, n); i++) ch[i] *= i / inS;
    for (let i = 0; i < Math.min(outS, n); i++) ch[n - 1 - i] *= i / outS;
  }
  return chs;
}

/** Onset-strength envelope (100 frames/s) from low+mid band energy rises; used to find tempo phase and downbeats. */
export function onsetEnvelope(chs, sr = SR, hop = 441) {
  const mono = chs.length === 1 ? chs[0] : chs[0].map((v, i) => (v + chs[1][i]) / 2);
  // one-pole lowpass to emphasise kick/bass drums, plus broadband energy
  const low = new Float32Array(mono.length); let y = 0; const a = Math.exp(-2 * Math.PI * 180 / sr);
  for (let i = 0; i < mono.length; i++) { y = a * y + (1 - a) * mono[i]; low[i] = y; }
  const frames = Math.floor(mono.length / hop), env = new Float32Array(frames);
  let prevL = 0, prevB = 0;
  for (let f = 0; f < frames; f++) {
    let el = 0, eb = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) { el += low[i] * low[i]; eb += mono[i] * mono[i]; }
    el = Math.log1p(el * 1000); eb = Math.log1p(eb * 100);
    env[f] = Math.max(0, el - prevL) * 2 + Math.max(0, eb - prevB);
    prevL = el; prevB = eb;
  }
  return env;
}
