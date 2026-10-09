// The dreadnought's own voice: a deep engine drone that swells with throttle, the hull's groans, and a damaged-engine
// sputter as the hull fails. It runs on the ambience bus so it sits under the guns and is ducked with the world.
//
// Layers (all looping, started once, levels automated):
//   sub      two sines a fifth apart (36 / 54 Hz) breathing on a slow LFO: the mass of the thing
//   rumble   a low-passed ocean-wind recording (deep_rumble), opens with throttle: air moving past a carrier-sized hull
//   engine   a big spaceship engine loop, pitched down; rate and brightness follow throttle
//   turbine  a faint band-passed sawtooth whine that climbs with throttle: machinery, thousands of crew at work
//   roar     band-passed brown noise: thrust wash at full throttle

import { loadBuffer, buffer, makeOut, noise, now, rt, tone, type Runtime } from './core';
import { clamp } from './mix';

interface Ship {
  out: GainNode;
  sub: GainNode; subLP: BiquadFilterNode;
  rumble: GainNode; rumbleLP: BiquadFilterNode; rumbleSrc: AudioBufferSourceNode | null;
  engine: GainNode; engineLP: BiquadFilterNode; engineSrc: AudioBufferSourceNode | null;
  turbine: GainNode; turbineOsc: OscillatorNode; turbineBP: BiquadFilterNode;
  roar: GainNode; roarBP: BiquadFilterNode;
}

let ship: Ship | null = null;
/** Overall trim: about -27 LUFS at idle, -22 at full ahead, so the drone is felt under the music rather than heard over it. */
const ENGINE_LEVEL = 0.08;
let throttle = 0, target = 0, explicitAt = -Infinity, on = false, hull = 1, creakT = 6, sputterT = 2;

function build(r: Runtime): Ship {
  const ctx = r.ctx, g = (v = 0, to?: AudioNode) => { const n = ctx.createGain(); n.gain.value = v; if (to) n.connect(to); return n; };
  const filt = (type: BiquadFilterType, hz: number, q = 0.7, to?: AudioNode) => { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = hz; f.Q.value = q; if (to) f.connect(to); return f; };
  const out = g(0, r.ambIn);
  // sub
  const sub = g(0.0, out), subLP = filt('lowpass', 120, 0.7, sub);
  for (const [hz, v] of [[36, 1], [54, 0.45], [72, 0.15]] as const) { const o = ctx.createOscillator(); o.frequency.value = hz; const og = g(v, subLP); o.connect(og); o.start(); }
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.13; const depth = g(0.15); lfo.connect(depth); depth.connect(sub.gain); lfo.start();
  // rumble / engine (samples, attached when loaded)
  const rumble = g(0, out), rumbleLP = filt('lowpass', 220, 0.6, rumble);
  const engine = g(0, out), engineLP = filt('lowpass', 900, 0.6, engine);
  // turbine whine
  const turbine = g(0, out), turbineBP = filt('bandpass', 700, 6, turbine);
  const turbineOsc = ctx.createOscillator(); turbineOsc.type = 'sawtooth'; turbineOsc.frequency.value = 140; turbineOsc.connect(turbineBP); turbineOsc.start();
  // thrust roar
  const roar = g(0, out), roarBP = filt('bandpass', 380, 0.8, roar);
  const rs = ctx.createBufferSource(); rs.buffer = r.brown; rs.loop = true; rs.connect(roarBP); rs.start(0, Math.random() * 2);
  return { out, sub, subLP, rumble, rumbleLP, rumbleSrc: null, engine, engineLP, engineSrc: null, turbine, turbineOsc, turbineBP, roar, roarBP };
}

function attachLoops() {
  const r = rt(); if (!r || !ship) return;
  const loop = (path: string, to: AudioNode, rate: number) => { const b = buffer(path); if (!b) return null; const s = r.ctx.createBufferSource(); s.buffer = b; s.loop = true; s.playbackRate.value = rate; s.connect(to); s.start(0, Math.random() * b.duration); return s; };
  if (!ship.rumbleSrc) ship.rumbleSrc = loop('sfx/rumble.mp3', ship.rumbleLP, 1);
  if (!ship.engineSrc) ship.engineSrc = loop('sfx/engine.mp3', ship.engineLP, 0.6);
}

export function initShip(force = false) {
  const r = rt(); if (!r || (ship && !force)) return;
  if (force) { throttle = 0; target = 0; explicitAt = -Infinity; on = false; hull = 1; }
  ship = build(r);
  Promise.all([loadBuffer('sfx/rumble.mp3'), loadBuffer('sfx/engine.mp3')]).then(attachLoops).catch(() => {});
}

/** Engine on (combat) or off (menus). Fades over a couple of seconds: a carrier does not switch off. */
export function setEngineOn(v: boolean) {
  on = v;
  if (!ship) return;
  const t = now();
  ship.out.gain.cancelScheduledValues(t); ship.out.gain.setValueAtTime(ship.out.gain.value, t);
  ship.out.gain.setTargetAtTime(v ? ENGINE_LEVEL : 0, t, v ? 0.9 : 0.6);
}

/** 0 (holding position) .. 1 (full ahead). Called by the game or derived from ship motion by updateShip. */
export function setShipThrottle(v: number) { target = clamp(Number.isFinite(v) ? v : 0, 0, 1); explicitAt = now(); }
/** Hull integrity 0..1: under 0.45 the engine coughs and the drone sags. */
export function setHullIntegrity(v: number) { hull = clamp(v, 0, 1); }
export const shipThrottle = () => throttle;

/** Per frame. `derived` is a throttle estimate from ship motion, used unless setShipThrottle was called recently. */
export function updateShip(dt: number, derived: number | null) {
  if (!ship) return;
  const r = rt(); if (!r) return;
  if (derived !== null && now() - explicitAt > 0.5) target = clamp(derived, 0, 1);
  // mass: throttle rises over ~0.8 s and falls over ~1.6 s
  const tau = target > throttle ? 0.8 : 1.6;
  throttle += (target - throttle) * (1 - Math.exp(-Math.max(0, dt) / tau));
  const t = r.ctx.currentTime, k = throttle, sag = hull < 0.45 ? (0.45 - hull) / 0.45 : 0, tc = 0.12;
  ship.sub.gain.setTargetAtTime(0.24 + 0.32 * k, t, tc);
  ship.subLP.frequency.setTargetAtTime(90 + 80 * k, t, tc);
  ship.rumble.gain.setTargetAtTime(0.22 + 0.55 * k, t, tc);
  ship.rumbleLP.frequency.setTargetAtTime(200 + 520 * k, t, tc);
  ship.engine.gain.setTargetAtTime(0.06 + 0.26 * k, t, tc);
  ship.engineLP.frequency.setTargetAtTime(700 + 1700 * k, t, tc);
  ship.engineSrc?.playbackRate.setTargetAtTime((0.55 + 0.22 * k) * (1 - 0.08 * sag), t, tc);
  ship.turbine.gain.setTargetAtTime(0.006 + 0.012 * k, t, tc);
  ship.turbineOsc.frequency.setTargetAtTime((120 + 70 * k) * (1 - 0.1 * sag), t, tc);
  ship.turbineBP.frequency.setTargetAtTime(600 + 500 * k, t, tc);
  ship.roar.gain.setTargetAtTime(0.02 + 0.2 * k * k, t, tc);
  ship.roarBP.frequency.setTargetAtTime(300 + 350 * k, t, tc);
  if (!ship.rumbleSrc || !ship.engineSrc) attachLoops();
  if (!on) return;
  // the frame groans now and then (more when damaged); a failing engine coughs
  creakT -= dt;
  if (creakT <= 0) { creakT = 7 + Math.random() * 9 - 4 * sag; creak(); }
  if (sag > 0) { sputterT -= dt; if (sputterT <= 0) { sputterT = 0.6 + Math.random() * 2.2 * (1 - sag); sputter(sag); } }
}

function creak() {
  const o = makeOut({ layer: 'ship', x: 800 }, { bus: 'amb', vol: 0.5, wet: 0.5 }), f = 48 + Math.random() * 30;
  tone(o, { type: 'sawtooth', f0: f, f1: f * (0.85 + Math.random() * 0.3), dur: 1.4, vol: 0.05, attack: 0.5 });
  noise(o, { filter: 'bandpass', f0: 300 + Math.random() * 300, f1: 200 + Math.random() * 200, q: 9, dur: 1.2, vol: 0.12, attack: 0.4 });
}
function sputter(sag: number) {
  const o = makeOut({ layer: 'ship', x: 800 }, { bus: 'amb', vol: 0.4 + 0.4 * sag });
  for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) noise(o, { filter: 'lowpass', f0: 600, f1: 120, dur: 0.06, vol: 0.3, delay: i * (0.05 + Math.random() * 0.05), brown: true });
}
