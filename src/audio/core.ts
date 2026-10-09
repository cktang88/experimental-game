// The audio runtime: one AudioContext, the mix graph, persisted volume settings, synthesis primitives and samples.
//
// Mix graph (after Dead Air's audio.js and Tinwar's createBus):
//
//   cue voices -> [gain(distance) -> lowpass(altitude) -> pan] -> sfxIn -> sfxDuck -> sfxVol ┐
//                                         └-> reverb send -> convolver (generated, dark 2.4 s) ┤
//   ambience (sirens, fires, wind, chatter) -> ambIn -> ambDuck -> ambVol ──────────────────────┤
//                                                                                               v
//                     worldLP (muffle: big hits, death) -> glue compressor (-14 dB, knee 10, 8:1, 2 ms / 160 ms)
//                     -> tanh soft clip -> master ──────────────────────────────────────────────┐
//   music engine -> musicIn -> musicDuck -> musicVol ────────────────────────────────────────────┤
//                                                                                               v
//                    master gain (volume x mute) -> limiter (-1 dB, 20:1) -> soft ceiling (-0.3 dBFS) -> out
//
// Audio must never break the game: every entry point swallows errors and is a no-op until a user gesture unlocks the
// context. An OfflineAudioContext can be attached instead (attachContext) so scripts can render and measure cues.

import { clamp, parseSettings, serializeSettings, sliderGain, placement, SETTINGS_KEY, type AudioSettings, type Place } from './mix';

export interface Runtime {
  ctx: BaseAudioContext;
  master: GainNode; limiter: DynamicsCompressorNode;
  sfxIn: GainNode; sfxDuck: GainNode; sfxVol: GainNode;
  ambIn: GainNode; ambDuck: GainNode; ambVol: GainNode;
  musicIn: GainNode; musicDuck: GainNode; musicVol: GainNode;
  worldLP: BiquadFilterNode; glue: DynamicsCompressorNode;
  reverb: ConvolverNode | null;
  white: AudioBuffer; brown: AudioBuffer;
  offline: boolean;
  /** Set by offline renders: the time cues are scheduled at instead of ctx.currentTime. */
  clock: number | null;
}

let R: Runtime | null = null;
let voices = 0;
let settings: AudioSettings = loadSettings();
const listeners = new Set<(s: AudioSettings) => void>();
const onReady: ((r: Runtime) => void)[] = [];

function storage(): Storage | null { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } }
function loadSettings(): AudioSettings {
  const s = storage();
  try { return parseSettings(s?.getItem(SETTINGS_KEY) ?? null, s?.getItem('gd.mute') ?? null); } catch { return parseSettings(null); }
}

export const rt = () => R;
export const activeVoices = () => voices;
/** Scheduling time: the offline clock when rendering, else the context's current time. */
export const now = () => (R ? (R.clock ?? R.ctx.currentTime) : 0);
/** Milliseconds for throttles: follows the offline clock when rendering. */
export const nowMs = () => (R?.clock != null ? R.clock * 1000 : typeof performance !== 'undefined' ? performance.now() : Date.now());

/* ---------------------------------------------------------------- settings API */

export function getSettings(): AudioSettings { return { ...settings }; }
export function setSettings(patch: Partial<AudioSettings>) {
  settings = { ...settings, ...patch, master: clamp(patch.master ?? settings.master, 0, 1), music: clamp(patch.music ?? settings.music, 0, 1), sfx: clamp(patch.sfx ?? settings.sfx, 0, 1) };
  try { storage()?.setItem(SETTINGS_KEY, serializeSettings(settings)); storage()?.setItem('gd.mute', settings.muted ? '1' : '0'); } catch { /* storage blocked: lasts this tab */ }
  applySettings();
  for (const f of listeners) { try { f(getSettings()); } catch { /* listener error */ } }
}
export function onSettingsChange(f: (s: AudioSettings) => void) { listeners.add(f); return () => listeners.delete(f); }

function applySettings() {
  if (!R) return;
  const t = R.ctx.currentTime;
  R.master.gain.setTargetAtTime(settings.muted ? 0 : sliderGain(settings.master), t, 0.03);
  R.sfxVol.gain.setTargetAtTime(sliderGain(settings.sfx), t, 0.03);
  R.ambVol.gain.setTargetAtTime(sliderGain(settings.sfx) * 0.9, t, 0.03);
  R.musicVol.gain.setTargetAtTime(sliderGain(settings.music), t, 0.03);
}

/* ---------------------------------------------------------------- graph */

function noiseBuffer(ctx: BaseAudioContext, brown: boolean, seconds = 3) {
  const n = Math.floor(ctx.sampleRate * seconds), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
  let last = 0, seed = brown ? 0x9e3779b9 : 0x85ebca6b;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) / 4294967296) * 2 - 1; };
  for (let i = 0; i < n; i++) { const w = rnd(); if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w; }
  // fade the loop point so looping noise never clicks
  const f = Math.floor(ctx.sampleRate * 0.01); for (let i = 0; i < f; i++) { d[i] *= i / f; d[n - 1 - i] *= i / f; }
  return buf;
}

/** An open-air impulse: early slap off buildings, then a long dark tail, stereo-decorrelated. */
function impulse(ctx: BaseAudioContext, seconds = 2.4) {
  const n = Math.floor(ctx.sampleRate * seconds), buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c); let lp = 0, seed = 1234 + c * 777;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2147483648 - 1; };
    for (let i = 0; i < n; i++) {
      const t = i / n, decay = Math.pow(1 - t, 4.2), k = 0.25 + 0.7 * t; // darker as it decays
      lp += (rnd() - lp) * (1 - k * 0.9);
      d[i] = lp * decay * (i < 200 ? i / 200 : 1) * 0.6;
    }
    // early reflections: building faces at 40..140 ms
    for (const [ms, g] of [[43, 0.5], [71, 0.35], [97, 0.28], [138, 0.2]] as const) { const at = Math.floor((ms + c * 7) * ctx.sampleRate / 1000); for (let j = 0; j < 60 && at + j < n; j++) d[at + j] += (rnd() * g) * (1 - j / 60); }
  }
  return buf;
}

export function buildGraph(ctx: BaseAudioContext, destination: AudioNode, offline = false): Runtime {
  const g = (v = 1) => { const n = ctx.createGain(); n.gain.value = v; return n; };
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.08;
  const master = g(settings.muted ? 0 : sliderGain(settings.master));
  // the compressor-limiter can overshoot on a hard transient (1 ms attack): a last soft ceiling at -0.3 dBFS catches it
  const ceiling = ctx.createWaveShaper(), cc = new Float32Array(4096);
  for (let i = 0; i < cc.length; i++) { const x = (i / (cc.length - 1)) * 2 - 1, a = Math.abs(x), knee = 0.85, top = 0.966; cc[i] = Math.sign(x) * (a <= knee ? a : knee + (top - knee) * Math.tanh((a - knee) / (top - knee))); }
  ceiling.curve = cc; ceiling.oversample = '4x';
  master.connect(limiter); limiter.connect(ceiling); ceiling.connect(destination);

  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -14; glue.knee.value = 10; glue.ratio.value = 8; glue.attack.value = 0.002; glue.release.value = 0.16;
  const clip = ctx.createWaveShaper(), curve = new Float32Array(2048);
  for (let i = 0; i < curve.length; i++) { const x = (i / (curve.length - 1)) * 2 - 1; curve[i] = Math.tanh(x * 1.2) / Math.tanh(1.2); }
  clip.curve = curve; clip.oversample = '2x';
  const worldLP = ctx.createBiquadFilter(); worldLP.type = 'lowpass'; worldLP.frequency.value = 20000; worldLP.Q.value = 0.5;
  // the effects mix sits 2 dB under unity into the glue so a single loud cue peaks near -3 dBFS, not at the limiter
  const sfxTrim = g(0.8);
  worldLP.connect(sfxTrim); sfxTrim.connect(glue); glue.connect(clip); clip.connect(master);

  const sfxIn = g(), sfxDuck = g(), sfxVol = g(sliderGain(settings.sfx));
  sfxIn.connect(sfxDuck); sfxDuck.connect(sfxVol); sfxVol.connect(worldLP);
  const ambIn = g(), ambDuck = g(), ambVol = g(sliderGain(settings.sfx) * 0.9);
  ambIn.connect(ambDuck); ambDuck.connect(ambVol); ambVol.connect(worldLP);
  const musicIn = g(), musicDuck = g(), musicVol = g(sliderGain(settings.music));
  musicIn.connect(musicDuck); musicDuck.connect(musicVol); musicVol.connect(master);

  let reverb: ConvolverNode | null = null;
  try { reverb = ctx.createConvolver(); reverb.buffer = impulse(ctx); const wet = g(0.55); reverb.connect(wet); wet.connect(sfxDuck); } catch { reverb = null; }
  return { ctx, master, limiter, sfxIn, sfxDuck, sfxVol, ambIn, ambDuck, ambVol, musicIn, musicDuck, musicVol, worldLP, glue, reverb, white: noiseBuffer(ctx, false), brown: noiseBuffer(ctx, true), offline, clock: null };
}

/** Create the live context (call from a user gesture). Safe to call often. */
export function ensureContext(): Runtime | null {
  if (R) { if (!R.offline && (R.ctx as AudioContext).state === 'suspended') (R.ctx as AudioContext).resume().catch(() => {}); return R; }
  try {
    const AC: typeof AudioContext | undefined = typeof window !== 'undefined' ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined;
    if (!AC) return null;
    const ctx = new AC({ latencyHint: 'interactive' });
    R = buildGraph(ctx, ctx.destination);
    ctx.resume().catch(() => {});
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => {
      if (!R || R.offline) return;
      const c = R.ctx as AudioContext;
      if (document.hidden) { R.master.gain.setTargetAtTime(0, c.currentTime, 0.05); setTimeout(() => { if (document.hidden) c.suspend().catch(() => {}); }, 250); }
      else { c.resume().catch(() => {}); applySettings(); }
    });
    for (const f of onReady.splice(0)) { try { f(R); } catch { /* ignore */ } }
    return R;
  } catch { R = null; return null; }
}

/** Attach an (offline) context instead of the live one: scripts render cues through the exact same graph. */
export function attachContext(ctx: BaseAudioContext): Runtime {
  const keep = settings;
  settings = { master: 1, music: 1, sfx: 1, muted: false };
  const r = buildGraph(ctx, ctx.destination, true);
  settings = keep;
  return r;
}

/** Swap in another runtime (the audio lab renders offline without disturbing the live one). Returns the previous one. */
export function swapRuntime(next: Runtime | null): Runtime | null { const prev = R; R = next; return prev; }

/** Run `f` once the runtime exists (now, or after the first gesture). */
export function whenReady(f: (r: Runtime) => void) { if (R) f(R); else onReady.push(f); }

export const running = () => !!R && (R.offline || (R.ctx as AudioContext).state === 'running');

/* ---------------------------------------------------------------- voices and outputs */

export interface Out { input: AudioNode; t: number; pitch: number }

/**
 * A positioned output for one cue: distance gain -> altitude low-pass -> pan -> bus, plus a reverb send.
 * `delay` (seconds) pushes the whole cue later (sound climbing up from the city).
 */
export function makeOut(place: Place = {}, { vol = 1, wet, bus = 'sfx', pitch = 1, extraDelay = 0 }: { vol?: number; wet?: number; bus?: 'sfx' | 'amb' | 'raw'; pitch?: number; extraDelay?: number } = {}): Out | null {
  if (!R) return null;
  const ctx = R.ctx, p = placement(place);
  const input = ctx.createGain(); input.gain.value = p.gain * vol;
  let node: AudioNode = input;
  if (p.cutoff < 15000) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = p.cutoff; f.Q.value = 0.6; node.connect(f); node = f; }
  if (p.pan !== 0 && ctx.createStereoPanner) { const pn = ctx.createStereoPanner(); pn.pan.value = p.pan; node.connect(pn); node = pn; }
  node.connect(bus === 'amb' ? R.ambIn : bus === 'raw' ? R.worldLP : R.sfxIn);
  const w = wet ?? p.wet;
  if (w > 0 && R.reverb && bus !== 'raw') { const s = ctx.createGain(); s.gain.value = w; node.connect(s); s.connect(R.reverb); }
  // free the chain when the cue is long finished (sources disconnect themselves; this drops the shared nodes)
  return { input, t: now() + p.delay + extraDelay, pitch };
}

function track(src: AudioScheduledSourceNode, tail: AudioNode) {
  voices++;
  src.onended = () => { voices = Math.max(0, voices - 1); try { tail.disconnect(); } catch { /* gone */ } };
}

function env(ctx: BaseAudioContext, t: number, vol: number, attack: number, dur: number) {
  const e = ctx.createGain(), peak = Math.max(0.0002, vol);
  e.gain.value = 0.0001; e.gain.setValueAtTime(0.0001, t); e.gain.linearRampToValueAtTime(peak, t + attack);
  e.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(attack + 0.01, dur));
  return e;
}

export interface ToneOpts { type?: OscillatorType; f0: number; f1?: number; dur: number; vol: number; delay?: number; attack?: number; detune?: number }
/** An enveloped oscillator sweep (Dead Air's tone()). */
export function tone(out: Out | null, o: ToneOpts) {
  if (!R || !out) return;
  const ctx = R.ctx, t = out.t + (o.delay ?? 0), osc = ctx.createOscillator(), e = env(ctx, t, o.vol, o.attack ?? 0.003, o.dur);
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.f0 * out.pitch, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, (o.f1 ?? o.f0) * out.pitch), t + o.dur);
  if (o.detune) osc.detune.value = o.detune;
  osc.connect(e); e.connect(out.input); track(osc, e);
  osc.start(t); osc.stop(t + o.dur + 0.03);
}

export interface NoiseOpts { filter?: BiquadFilterType; f0: number; f1?: number; q?: number; dur: number; vol: number; delay?: number; attack?: number; brown?: boolean; rate?: number }
/** Enveloped filtered noise with a filter sweep (Dead Air's noise()). */
export function noise(out: Out | null, o: NoiseOpts) {
  if (!R || !out) return;
  const ctx = R.ctx, t = out.t + (o.delay ?? 0), src = ctx.createBufferSource(), bq = ctx.createBiquadFilter(), e = env(ctx, t, o.vol, o.attack ?? 0.002, o.dur);
  src.buffer = o.brown ? R.brown : R.white; src.loop = true; src.playbackRate.value = (o.rate ?? 1) * out.pitch;
  bq.type = o.filter ?? 'lowpass'; bq.Q.value = o.q ?? 0.7;
  bq.frequency.setValueAtTime(o.f0, t); bq.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1 ?? o.f0), t + o.dur);
  src.connect(bq); bq.connect(e); e.connect(out.input); track(src, e);
  src.start(t, Math.random() * 2); src.stop(t + o.dur + 0.05);
}

/* ---------------------------------------------------------------- samples */

const buffers = new Map<string, AudioBuffer>();
const pending = new Map<string, Promise<AudioBuffer | null>>();
const assetBase = () => { try { return (import.meta.env?.BASE_URL ?? '/') + 'assets/audio/'; } catch { return '/assets/audio/'; } };
export type Fetcher = (path: string) => Promise<ArrayBuffer>;
let fetcher: Fetcher = async (p) => { const r = await fetch(assetBase() + p); if (!r.ok) throw new Error(`${r.status} ${p}`); return r.arrayBuffer(); };
export function setFetcher(f: Fetcher) { fetcher = f; }

/** Fetch + decode one file under public/assets/audio/ (e.g. 'sfx/cannon.mp3'). Cached; null on failure. */
export function loadBuffer(path: string): Promise<AudioBuffer | null> {
  const hit = buffers.get(path); if (hit) return Promise.resolve(hit);
  const p = pending.get(path); if (p) return p;
  if (!R) return Promise.resolve(null);
  const ctx = R.ctx;
  const job = fetcher(path).then((b) => ctx.decodeAudioData(b)).then((buf) => { buffers.set(path, buf); return buf; }).catch(() => null);
  pending.set(path, job);
  return job;
}
export const buffer = (path: string) => buffers.get(path) ?? null;

export interface SampleOpts { rate?: number; vol?: number; delay?: number; offset?: number; dur?: number; attack?: number; release?: number; loop?: boolean }
/** Play a decoded sample through an Out. Silently skipped if it has not loaded yet (synthesis carries the cue). */
export function sample(out: Out | null, path: string, o: SampleOpts = {}): AudioBufferSourceNode | null {
  const buf = buffers.get(path);
  if (!R || !out || !buf) return null;
  const ctx = R.ctx, t = out.t + (o.delay ?? 0), src = ctx.createBufferSource(), e = ctx.createGain();
  src.buffer = buf; src.playbackRate.value = (o.rate ?? 1) * out.pitch; src.loop = !!o.loop;
  const vol = o.vol ?? 1, dur = o.dur ?? (buf.duration - (o.offset ?? 0)) / ((o.rate ?? 1) * out.pitch);
  e.gain.value = 0;
  e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(vol, t + (o.attack ?? 0.002));
  if (o.dur !== undefined || o.release) { e.gain.setValueAtTime(vol, t + Math.max(0.003, dur - (o.release ?? 0.05))); e.gain.linearRampToValueAtTime(0, t + dur); }
  src.connect(e); e.connect(out.input); track(src, e);
  src.start(t, o.offset ?? 0); if (!o.loop || o.dur !== undefined) src.stop(t + dur + 0.02);
  return src;
}

/** Short duck of one bus (big events): drops to `level`, holds, then recovers. */
export function duck(which: 'music' | 'sfx' | 'amb', level: number, attack = 0.03, hold = 0.25, release = 0.8) {
  if (!R) return;
  const p = (which === 'music' ? R.musicDuck : which === 'amb' ? R.ambDuck : R.sfxDuck).gain, t = now();
  p.cancelScheduledValues(t); p.setValueAtTime(p.value, t);
  p.linearRampToValueAtTime(level, t + attack); p.setValueAtTime(level, t + attack + hold); p.setTargetAtTime(1, t + attack + hold, release / 3);
}

/** Muffle everything but music (shell shock on a heavy hit, death). 1 = open, 0 = fully dull. */
export function muffle(amount: number, seconds = 0.6) {
  if (!R) return;
  const t = now(), f = R.worldLP.frequency, hz = 20000 * Math.pow(500 / 20000, clamp(amount, 0, 1));
  f.cancelScheduledValues(t); f.setValueAtTime(f.value, t); f.exponentialRampToValueAtTime(hz, t + 0.03);
  if (seconds > 0) f.setTargetAtTime(20000, t + seconds, seconds / 2);
}
