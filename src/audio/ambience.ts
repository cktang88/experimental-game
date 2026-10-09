// The city below and the sky around: high-altitude wind, the city's distant hum, air-raid sirens that rise as the
// dreadnought arrives, fire alarms ringing in the blocks, crackling fires that grow with the destruction, and enemy radio
// chatter (Dead Air's vocoder-ish chatterPlan: syllables, never words) that is cut by a squelch when the speaker dies.
// Everything is synthesized and rides the ambience bus (sfx volume, ducked under big events).

import { makeOut, noise, now, rt, type Runtime } from './core';
import { clamp, panFromX } from './mix';

/* ---------------------------------------------------------------- pure helpers (tested) */

/** Small seeded PRNG (mulberry32). */
export function makeRng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** One radio burst: a run of syllables (two formants and a gate each), never words. */
export function chatterPlan(rng: () => number, { maxDuration = 2.2 } = {}) {
  const pitch = 95 + rng() * 90, count = 3 + Math.floor(rng() * 7), syllables: { t: number; dur: number; f1: number; f2: number; vol: number }[] = [];
  let t = 0.06;
  for (let i = 0; i < count; i++) {
    const dur = 0.05 + rng() * 0.11;
    if (t + dur > maxDuration) break;
    syllables.push({ t, dur, f1: 300 + rng() * 550, f2: 900 + rng() * 1900, vol: 0.55 + rng() * 0.45 });
    t += dur + (rng() < 0.22 ? 0.14 + rng() * 0.18 : 0.02 + rng() * 0.05);
  }
  return { pitch, total: t + 0.05, syllables };
}

/** Air-raid siren pitch over one cycle (seconds -> Hz): wind up, hold the wail, wind down. A real rotor siren. */
export function sirenPitch(t: number, { low = 140, high = 470, up = 5.5, hold = 3, down = 7.5 } = {}) {
  if (t < up) return low + (high - low) * Math.sin((t / up) * Math.PI / 2);
  if (t < up + hold) return high;
  const k = Math.min(1, (t - up - hold) / down);
  return high - (high - low) * (1 - Math.cos(k * Math.PI / 2));
}
export const SIREN_CYCLE = 5.5 + 3 + 7.5;

/* ---------------------------------------------------------------- runtime */

interface Siren { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode; next: number; detune: number }
interface Amb {
  r: Runtime; bus: GainNode;
  wind: GainNode; windBP: BiquadFilterNode;
  city: GainNode;
  sirens: Siren[]; sirenBus: GainNode;
  fire: GainNode; fireLP: BiquadFilterNode;
  rng: () => number;
  chat: Map<unknown, { end: number; out: GainNode; srcs: AudioScheduledSourceNode[]; pan: number; vol: number }>;
}
let A: Amb | null = null;
/** Overall trim of the world bed against music (-18 LUFS) and guns: calm sky about -32 LUFS, a burning city about -24. */
const AMB_LEVEL = 0.5;
let alarm = 0, alarmTarget = 0, heat = 0, crackleT = 0, bellT = 8, inCombat = false, windLevel = 0.6;

function build(r: Runtime): Amb {
  const ctx = r.ctx;
  const g = (v = 0, to?: AudioNode) => { const n = ctx.createGain(); n.gain.value = v; if (to) n.connect(to); return n; };
  const filt = (type: BiquadFilterType, hz: number, q = 0.7, to?: AudioNode) => { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = hz; f.Q.value = q; if (to) f.connect(to); return f; };
  const loopNoise = (brown: boolean, to: AudioNode) => { const s = ctx.createBufferSource(); s.buffer = brown ? r.brown : r.white; s.loop = true; s.connect(to); s.start(0, Math.random() * 2); return s; };
  const bus = g(AMB_LEVEL, r.ambIn);
  // wind at altitude: two band-passed noise layers breathing out of phase
  const wind = g(0, bus), windBP = filt('bandpass', 520, 0.6, wind);
  loopNoise(false, windBP);
  const gust = ctx.createOscillator(); gust.frequency.value = 0.07; const gd = g(250); gust.connect(gd); gd.connect(windBP.frequency); gust.start();
  const whistle = filt('bandpass', 1900, 8, g(0.25, wind)); loopNoise(false, whistle);
  // the city far below: a low hum of traffic and machinery
  const city = g(0, bus), cityLP = filt('lowpass', 260, 0.5, city); loopNoise(true, cityLP);
  // sirens: two rotor sirens far off on either side, through distance filtering; the alarm level and the reverb send
  // both sit after the level control so a silent alarm sends nothing to the reverb
  const sirenBus = g(0, bus), sirenLP = filt('lowpass', 1500, 0.5, sirenBus), sirenHP = filt('highpass', 160, 0.5, sirenLP);
  if (r.reverb) { const send = g(0.9); sirenBus.connect(send); send.connect(r.reverb); }
  const sirens: Siren[] = [-0.75, 0.6].map((pan, i) => {
    const pn = ctx.createStereoPanner(); pn.pan.value = pan; pn.connect(sirenHP);
    const gain = g(0, pn);
    const bp = filt('bandpass', 900, 0.9, gain);
    const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 140; osc.connect(bp);
    const osc2 = ctx.createOscillator(); osc2.type = 'sawtooth'; osc2.frequency.value = 168; const o2 = g(0.6, bp); osc2.connect(o2); // rotor ports a minor third apart
    osc.start(); osc2.start();
    return { osc, osc2, gain, next: 0, detune: i ? 0.94 : 1 };
  });
  // fires: a low roar that grows with destruction (crackle one-shots are added in update)
  const fire = g(0, bus), fireLP = filt('lowpass', 500, 0.5, fire); loopNoise(true, fireLP);
  return { r, bus, wind, windBP, city, sirens, sirenBus, fire, fireLP, rng: makeRng(Date.now() & 0xffff), chat: new Map() };
}

export function initAmbience(force = false) {
  const r = rt(); if (!r || (A && !force)) return;
  if (force) { alarm = 0; alarmTarget = 0; heat = 0; inCombat = false; windLevel = 0.6; }
  A = build(r);
}

/** Combat on/off: sirens start winding up as you arrive; menus keep only the wind. */
export function setCombatAmbience(v: boolean) {
  inCombat = v;
  alarmTarget = v ? 0.55 : 0;
  if (!v) { heat = 0; cutAllChatter(); }
}
/** Wind level 0..1 (title and menus run a lighter wind). */
export function setWind(v: number) { windLevel = clamp(v, 0, 1); }
/** Destruction feeds the fires and the alarm: call on ground explosions and collapses (amount ~0.05..0.5). */
export function addDestruction(amount: number) { heat = clamp(heat + amount, 0, 1); alarmTarget = inCombat ? clamp(alarmTarget + amount * 0.25, 0, 1) : alarmTarget; }

export function updateAmbience(dt: number, throttle = 0) {
  if (!A) return;
  const ctx = A.r.ctx, t = ctx.currentTime, tc = 0.3;
  alarm += (alarmTarget - alarm) * (1 - Math.exp(-dt / (alarmTarget > alarm ? 6 : 1.5)));
  heat *= Math.exp(-dt / 25);
  A.wind.gain.setTargetAtTime(windLevel * (0.05 + 0.05 * throttle), t, tc);
  A.city.gain.setTargetAtTime(inCombat ? 0.03 : 0.012, t, 1);
  A.sirenBus.gain.setTargetAtTime(alarm * 0.12, t, tc);
  A.fire.gain.setTargetAtTime(heat * 0.07, t, tc);
  A.fireLP.frequency.setTargetAtTime(300 + 500 * heat, t, tc);
  // siren cycles, scheduled a cycle ahead on the audio clock
  for (const s of A.sirens) {
    if (alarm < 0.02) { s.next = 0; s.gain.gain.setTargetAtTime(0, t, 0.5); continue; }
    if (s.next <= t + 0.5) {
      const start = Math.max(t + 0.05, s.next || t + 0.05 + A.rng() * 3);
      const steps = 24, cyc = SIREN_CYCLE;
      s.osc.frequency.cancelScheduledValues(start); s.osc2.frequency.cancelScheduledValues(start);
      for (let i = 0; i <= steps; i++) { const k = (i / steps) * cyc, f = sirenPitch(k) * s.detune; s.osc.frequency.linearRampToValueAtTime(f, start + k); s.osc2.frequency.linearRampToValueAtTime(f * 1.2, start + k); }
      s.gain.gain.cancelScheduledValues(start); s.gain.gain.setValueAtTime(s.gain.gain.value, start);
      s.gain.gain.linearRampToValueAtTime(1, start + 3); s.gain.gain.setValueAtTime(1, start + cyc - 4); s.gain.gain.linearRampToValueAtTime(0.25, start + cyc);
      s.next = start + cyc + A.rng() * 1.5;
    }
  }
  if (!inCombat) return;
  // crackling fires: Poisson pops, denser with heat
  crackleT -= dt;
  while (crackleT <= 0 && heat > 0.03) { crackleT += 0.03 + 0.3 * (1 - heat) * A.rng(); crackle(); }
  if (crackleT < -1) crackleT = 0;
  // fire alarm bells ringing in the blocks
  bellT -= dt;
  if (bellT <= 0) { bellT = 9 + A.rng() * 12 - 6 * alarm; if (alarm > 0.25) bell(); }
  // expire chatter
  for (const [id, c] of A.chat) if (c.end < t) A.chat.delete(id);
}

function crackle() {
  if (!A) return;
  const o = makeOut({ x: A.rng() * 1600, y: 200 + A.rng() * 600, layer: 'ground' }, { bus: 'amb', vol: 0.5 + heat });
  noise(o, { filter: 'bandpass', f0: 1800 + A.rng() * 4500, q: 2 + A.rng() * 4, dur: 0.012 + A.rng() * 0.025, vol: 0.1 + A.rng() * 0.15 });
}
function bell() {
  if (!A) return;
  const o = makeOut({ x: A.rng() * 1600, y: 100 + A.rng() * 300, layer: 'ground' }, { bus: 'amb', vol: 0.35, wet: 0.8 });
  if (!o) return;
  // an electric fire bell: three inharmonic partials struck by the clapper 13..18 times a second
  const ctx = A.r.ctx, dur = 1.5 + A.rng() * 2, rate = 13 + A.rng() * 5, t0 = o.t, base = 1050 + A.rng() * 300;
  const strike = ctx.createGain(); strike.gain.value = 0; strike.connect(o.input);
  for (let k = 0; k < dur * rate; k++) { const a = t0 + k / rate; strike.gain.setValueAtTime(0.05, a); strike.gain.exponentialRampToValueAtTime(0.004, a + 0.9 / rate); }
  strike.gain.setValueAtTime(0, t0 + dur + 0.1);
  for (const [m, v] of [[1, 1], [2.76, 0.4], [5.4, 0.2]] as const) {
    const osc = ctx.createOscillator(); osc.frequency.value = base * m; const og = ctx.createGain(); og.gain.value = v;
    osc.connect(og); og.connect(strike); osc.start(t0); osc.stop(t0 + dur + 0.2);
  }
}

/* ---------------------------------------------------------------- radio chatter */

const MAX_CHATTERS = 2;
/** An enemy keys its radio: a garbled burst panned to it. `id` is any object or string (the enemy). */
export function chatter(id: unknown, x?: number, vol = 0.09) {
  if (!A || A.chat.has(id) || A.chat.size >= MAX_CHATTERS) return;
  const ctx = A.r.ctx, plan = chatterPlan(A.rng), t0 = now() + 0.03, pan = panFromX(x, 0.7);
  const outN = ctx.createGain(); outN.gain.value = vol;
  const pn = ctx.createStereoPanner(); pn.pan.value = pan; outN.connect(pn); pn.connect(A.bus);
  const crush = ctx.createWaveShaper(), curve = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const x2 = i / 127.5 - 1; curve[i] = Math.round(x2 * 5) / 5 * 0.6 + x2 * 0.4; }
  crush.curve = curve;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 480;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
  crush.connect(hp); hp.connect(lp); lp.connect(outN);
  const gate = ctx.createGain(); gate.gain.value = 0; gate.connect(crush);
  const carrier = ctx.createOscillator(); carrier.type = 'sawtooth'; carrier.frequency.value = plan.pitch;
  const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = 7;
  const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.Q.value = 9;
  const sum = ctx.createGain(); sum.gain.value = 5; sum.connect(gate);
  carrier.connect(f1); carrier.connect(f2); f1.connect(sum);
  const f2g = ctx.createGain(); f2g.gain.value = 0.7; f2.connect(f2g); f2g.connect(sum);
  const breath = ctx.createBufferSource(); breath.buffer = A.r.white; breath.loop = true;
  const bf = ctx.createBiquadFilter(); bf.type = 'bandpass'; bf.frequency.value = 1700; bf.Q.value = 1.5; breath.connect(bf);
  const bg = ctx.createGain(); bg.gain.value = 0.25; bf.connect(bg); bg.connect(sum);
  for (const s of plan.syllables) {
    const a = t0 + s.t;
    gate.gain.setValueAtTime(0, a); gate.gain.linearRampToValueAtTime(s.vol, a + 0.008); gate.gain.setValueAtTime(s.vol, a + s.dur - 0.012); gate.gain.linearRampToValueAtTime(0, a + s.dur);
    f1.frequency.setValueAtTime(s.f1, a); f2.frequency.setValueAtTime(s.f2, a);
    carrier.frequency.setValueAtTime(plan.pitch * (0.85 + A.rng() * 0.35), a);
  }
  const end = t0 + plan.total;
  carrier.start(t0); carrier.stop(end + 0.3); breath.start(t0, A.rng() * 2); breath.stop(end + 0.3);
  squelch(t0 - 0.02, 0.04, vol * 0.5, x); // key-up click
  squelch(end, 0.07, vol * 0.7, x);       // key-down squelch
  A.chat.set(id, { end, out: outN, srcs: [carrier, breath], pan, vol });
}

/** The speaker died mid-sentence: cut the transmission with a burst of static. */
export function cutChatter(id: unknown, x?: number) {
  if (!A) return;
  const c = A.chat.get(id); if (!c) return;
  const t = now();
  c.out.gain.cancelScheduledValues(t); c.out.gain.setTargetAtTime(0, t, 0.004);
  for (const s of c.srcs) { try { s.stop(t + 0.05); } catch { /* already stopped */ } }
  squelch(t + 0.005, 0.11, Math.min(0.3, c.vol * 1.8), x, true);
  A.chat.delete(id);
}
export function isChattering(id: unknown) { return !!A?.chat.has(id); }
function cutAllChatter() { if (A) for (const id of [...A.chat.keys()]) cutChatter(id); }

function squelch(t: number, dur: number, vol: number, x?: number, chop = false) {
  const o = makeOut({ x, layer: x === undefined ? 'ui' : 'air' }, { bus: 'amb', vol: 1, wet: 0.05 });
  if (!o) return;
  o.t = t;
  noise(o, { filter: 'bandpass', f0: 2400, q: 0.9, dur, vol });
  if (chop) for (let k = 0; k < 6; k++) noise(o, { filter: 'highpass', f0: 3000, dur: 0.012, vol: vol * 0.8, delay: k * 0.018 });
}
