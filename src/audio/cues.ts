// Every one-shot sound in the game, by name. Each cue layers synthesis (always available, no loading) with real samples
// (body and grit, once loaded). `sfx(name, opts)` in index.ts admits the cue (throttle, burst cap, voice budget by
// priority) and calls its recipe.
//
// Scale is the whole brief: the player is a building-sized warship, so OUR guns have sub-bass and a long tail; enemy
// guns are small, dry and bright; the city is far below (see mix.ts placement: late, dull, wet).

import { duck, makeOut, muffle, noise, sample, tone, now, type Out } from './core';
import type { Layer, Priority } from './mix';

export interface CueOpts {
  /** Field x (0..1600) for stereo pan; omit for centred. */
  x?: number;
  /** Field y (0..900); for ground sounds, further up the screen is further away. */
  y?: number;
  /** Explicit layer; otherwise `ground` picks 'ground', an x picks 'air', nothing picks 'ui'. */
  layer?: Layer;
  ground?: boolean;
  /** Size of the thing (radius in field units) for explosions; 1..60. */
  size?: number;
  /** Level multiplier. */
  vol?: number;
  /** Pitch multiplier. */
  pitch?: number;
}

export interface Cue {
  /** Minimum ms between two plays; burst = max plays per `window` ms. */
  gap?: number; burst?: number; window?: number;
  priority: Priority;
  /** Rough voice count, for the budget. */
  cost: number;
  /** Default layer when the caller gives none. */
  layer?: Layer;
  play(o: CueOpts): void;
}

const S = (id: string) => `sfx/${id}.mp3`;
const I = (id: string) => `inst/${id}.mp3`;
const j = (amt: number) => 1 + (Math.random() * 2 - 1) * amt;
const pickOf = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];
const out = (o: CueOpts, layer: Layer, opts: Parameters<typeof makeOut>[1] = {}): Out | null =>
  makeOut({ x: o.x, y: o.y, layer: o.layer ?? (o.ground ? 'ground' : layer) }, { ...opts, vol: (o.vol ?? 1) * (opts.vol ?? 1), pitch: (o.pitch ?? 1) * (opts.pitch ?? 1) });

/* ---------------------------------------------------------------- building blocks */

/** Sub-bass punch: the thing that makes our guns feel carrier-sized. */
function sub(o: Out | null, f0: number, f1: number, dur: number, vol: number, delay = 0) {
  tone(o, { type: 'sine', f0, f1, dur, vol, delay, attack: 0.004 });
}
/** Metallic shrapnel / debris ticks scattered over `span` seconds. */
function debris(o: Out | null, n: number, span: number, vol: number, lo = 1500, hi = 5000, delay = 0.08) {
  for (let i = 0; i < n; i++) noise(o, { filter: 'bandpass', f0: lo + Math.random() * (hi - lo), q: 4 + Math.random() * 4, dur: 0.02 + Math.random() * 0.04, vol: vol * (0.4 + Math.random() * 0.6), delay: delay + Math.random() * span });
}

/** A layered explosion. size 0 (a drone popping) .. 1 (a bomber) .. 2 (elite/boss). */
function explosion(o: Out | null, size: number, ground: boolean) {
  const s = Math.max(0, Math.min(2.2, size)), v = 0.55 + 0.25 * Math.min(1, s);
  // transient crack
  noise(o, { filter: 'highpass', f0: 3200, dur: 0.05, vol: v * 0.35 });
  noise(o, { filter: 'bandpass', f0: 2200 * j(0.15), f1: 400, q: 0.7, dur: 0.18 + 0.1 * s, vol: v * 0.5 });
  // body and sub
  sub(o, 90 * j(0.1), 26, 0.55 + 0.45 * s, v * (0.7 + 0.25 * s));
  noise(o, { filter: 'lowpass', f0: 2600, f1: 70, dur: 0.8 + 0.8 * s, vol: v * 0.75, brown: true });
  // samples: crunchy air kills, deep ground blasts
  if (ground) {
    sample(o, S(pickOf(['boom_low1', 'boom_low2'])), { vol: 0.75 * v, rate: j(0.08) });
    if (s > 0.6) sample(o, S('boom_far'), { vol: 0.7 * v, rate: j(0.06) * 0.9, delay: 0.03 });
  } else if (s < 0.5) {
    sample(o, S(pickOf(['boom_crunch1', 'boom_crunch2', 'boom_crunch3', 'boom_a', 'boom_d'])), { vol: 0.6, rate: j(0.1) * 1.08 });
  } else {
    sample(o, S(pickOf(['boom_mech', 'boom_b', 'boom_c'])), { vol: 0.75 * v, rate: j(0.08) });
    sample(o, S('boom_low2'), { vol: 0.5 * v, rate: j(0.05) });
  }
  if (s >= 1.2) {
    sample(o, S('boom_chunky'), { vol: 0.85, rate: j(0.05) * 0.92 });
    sample(o, S('boom_low1'), { vol: 0.7, rate: 0.8 });
    noise(o, { filter: 'lowpass', f0: 900, f1: 40, dur: 2.6, vol: 0.45, brown: true, delay: 0.15, attack: 0.2 }); // rolling thunder
  }
  debris(o, 3 + Math.round(4 * s), 0.25 + 0.3 * s, 0.09, ground ? 900 : 1600, ground ? 3000 : 5200);
}

/* ---------------------------------------------------------------- the table */

let scrapStreak = 0, scrapAt = -1;

export const CUES: Record<string, Cue> = {
  /* our weapons ---------------------------------------------------- */
  // bow autocannon ('pulse'): a heavy thump-crack, not a laser pew
  pew: { gap: 55, burst: 6, priority: 2, cost: 4, layer: 'ship', play(o) {
    const c = out(o, 'ship', { vol: 0.55 }), p = j(0.05);
    noise(c, { filter: 'bandpass', f0: 2400 * p, f1: 700, q: 0.9, dur: 0.07, vol: 0.4 });
    tone(c, { type: 'square', f0: 330 * p, f1: 110, dur: 0.06, vol: 0.12 });
    sub(c, 150 * p, 52, 0.16, 0.55);
    noise(c, { filter: 'lowpass', f0: 1200, f1: 160, dur: 0.22, vol: 0.18, brown: true, delay: 0.01 });
  } },
  // spread battery: a ripple of three lighter barrels
  spread: { gap: 70, burst: 5, priority: 2, cost: 6, layer: 'ship', play(o) {
    const c = out(o, 'ship', { vol: 0.5 });
    for (let i = 0; i < 3; i++) { const p = j(0.06); noise(c, { filter: 'bandpass', f0: 2000 * p, f1: 600, q: 0.8, dur: 0.06, vol: 0.3, delay: i * 0.028 }); sub(c, 130 * p, 50, 0.13, 0.35, i * 0.028); }
  } },
  // broadside / artillery: the cannon sample on a sub-bass kick, and a pressure wave that dips the music
  cannon: { gap: 90, burst: 4, priority: 2, cost: 7, layer: 'ship', play(o) {
    const c = out(o, 'ship', { vol: 0.85 }), p = j(0.06);
    sample(c, S('cannon'), { vol: 0.8, rate: p * 0.92 });
    sample(c, S('boom_low2'), { vol: 0.55, rate: p * 0.85 });
    sub(c, 72 * p, 24, 0.7, 0.95);
    noise(c, { filter: 'bandpass', f0: 1800, f1: 250, q: 0.6, dur: 0.25, vol: 0.4 });
    noise(c, { filter: 'lowpass', f0: 700, f1: 60, dur: 1.1, vol: 0.3, brown: true, delay: 0.02 });
    duck('music', 0.78, 0.01, 0.06, 0.4);
  } },
  // flak launcher: a hollow tube thump; the burst comes later (flakPop)
  flak: { gap: 70, burst: 4, priority: 2, cost: 4, layer: 'ship', play(o) {
    const c = out(o, 'ship', { vol: 0.6 }), p = j(0.06);
    sub(c, 190 * p, 70, 0.14, 0.6);
    noise(c, { filter: 'bandpass', f0: 900 * p, f1: 300, q: 1.2, dur: 0.1, vol: 0.35 });
    tone(c, { type: 'triangle', f0: 520 * p, f1: 260, dur: 0.05, vol: 0.08 });
  } },
  flakPop: { gap: 30, burst: 8, priority: 1, cost: 5, layer: 'air', play(o) {
    const c = out(o, 'air', { vol: 0.6 }), p = j(0.1);
    noise(c, { filter: 'highpass', f0: 2500, dur: 0.035, vol: 0.45 });
    noise(c, { filter: 'bandpass', f0: 1300 * p, f1: 500, q: 0.8, dur: 0.16, vol: 0.4 });
    sub(c, 110 * p, 45, 0.18, 0.4);
    debris(c, 4, 0.12, 0.08, 2500, 7000, 0.02);
  } },
  // missile pair: ignition pop and a rising rocket whoosh
  missile: { gap: 90, burst: 4, priority: 2, cost: 5, layer: 'ship', play(o) {
    const c = out(o, 'ship', { vol: 0.6 }), p = j(0.07);
    noise(c, { filter: 'bandpass', f0: 600 * p, f1: 3200, q: 1.1, dur: 0.55, vol: 0.32, attack: 0.03 });
    sample(c, S('thruster'), { vol: 0.5, rate: 1.15 * p, dur: 0.7, release: 0.3 });
    sub(c, 120 * p, 60, 0.12, 0.35);
    noise(c, { filter: 'highpass', f0: 4000, dur: 0.03, vol: 0.2 });
  } },
  // ventral bomb bay: doors clunk, then the falling whistle (the impact is a ground boom from combat)
  bombDrop: { gap: 120, burst: 3, priority: 1, cost: 4, layer: 'ship', play(o) {
    const c = out(o, 'ship', { vol: 0.55 }), p = j(0.05);
    noise(c, { filter: 'bandpass', f0: 700, f1: 400, q: 2, dur: 0.06, vol: 0.3 });
    tone(c, { type: 'triangle', f0: 140 * p, f1: 90, dur: 0.09, vol: 0.25 });
    tone(c, { type: 'sine', f0: 1500 * p, f1: 520 * p, dur: 0.55, vol: 0.05, delay: 0.05, attack: 0.15 });
  } },
  // rail: a hard supersonic crack, a ringing zing and a sub punch
  rail: { gap: 90, burst: 3, priority: 2, cost: 8, layer: 'ship', play(o) {
    const c = out(o, o.layer ?? 'ship', { vol: 0.75 }), p = j(0.04);
    sample(c, S('railburst'), { vol: 0.45, rate: 1.25 * p, dur: 0.6, release: 0.3 });
    noise(c, { filter: 'highpass', f0: 5000, dur: 0.03, vol: 0.5 });
    tone(c, { type: 'sawtooth', f0: 3600 * p, f1: 180, dur: 0.12, vol: 0.12 });
    sub(c, 95, 30, 0.35, 0.7);
    tone(c, { type: 'sine', f0: 2350 * p, f1: 1900, dur: 0.9, vol: 0.05, delay: 0.02, attack: 0.01 });
    noise(c, { filter: 'bandpass', f0: 5200, f1: 1800, q: 1.5, dur: 0.4, vol: 0.12, delay: 0.01 });
  } },
  // rail charge (enemy rail beams warn before they fire): a rising capacitor whine
  railCharge: { gap: 300, priority: 3, cost: 3, layer: 'air', play(o) {
    const c = out(o, 'air', { vol: 0.5 });
    tone(c, { type: 'sawtooth', f0: 180, f1: 1800, dur: 0.85, vol: 0.08, attack: 0.6 });
    tone(c, { type: 'sine', f0: 360, f1: 3600, dur: 0.85, vol: 0.06, attack: 0.6 });
    noise(c, { filter: 'bandpass', f0: 800, f1: 6000, q: 3, dur: 0.85, vol: 0.08, attack: 0.7 });
  } },
  // arc coil: a crackling zap with a mains buzz
  zap: { gap: 70, burst: 5, priority: 1, cost: 5, layer: 'air', play(o) {
    const c = out(o, 'air', { vol: 0.5 }), p = j(0.12);
    tone(c, { type: 'square', f0: 110 * p, f1: 95, dur: 0.14, vol: 0.08 });
    for (let i = 0; i < 4; i++) noise(c, { filter: 'bandpass', f0: 2500 + Math.random() * 4000, q: 3, dur: 0.018, vol: 0.28, delay: i * 0.025 + Math.random() * 0.01 });
    noise(c, { filter: 'highpass', f0: 3000, dur: 0.12, vol: 0.12 });
  } },
  // point defence: a tiny laser tick and a puff
  pd: { gap: 60, burst: 4, priority: 1, cost: 2, layer: 'ship', play(o) {
    const c = out(o, 'ship', { vol: 0.35 });
    sample(c, S('laser'), { vol: 0.3, rate: 1.8 * j(0.08), dur: 0.18, release: 0.08 });
    noise(c, { filter: 'highpass', f0: 3500, dur: 0.05, vol: 0.2, delay: 0.04 });
  } },
  // Overdrive: the Ventral Lance (doomsday cannon sample with a sub roar)
  lance: { gap: 600, priority: 3, cost: 6, layer: 'ship', play(o) {
    const c = out(o, 'ship', { vol: 0.9 });
    sample(c, S('lance'), { vol: 0.8 });
    sub(c, 60, 32, 2.5, 0.8);
    noise(c, { filter: 'lowpass', f0: 400, f1: 80, dur: 3, vol: 0.4, brown: true, attack: 0.1 });
    duck('music', 0.55, 0.05, 1.2, 1.5);
  } },

  /* hits and explosions --------------------------------------------- */
  boom: { gap: 25, burst: 7, priority: 2, cost: 12, layer: 'air', play(o) {
    const ground = o.ground || o.layer === 'ground', size = Math.max(0, ((o.size ?? 12) - 6) / 22);
    explosion(out(o, 'air', { vol: 0.8 }), size, ground);
  } },
  // bombs and shells landing in the city
  groundBoom: { gap: 30, burst: 6, priority: 1, cost: 10, layer: 'ground', play(o) {
    explosion(out({ ...o, ground: true }, 'ground', { vol: 0.95 }), 0.7 + (o.size ?? 0) / 60, true);
  } },
  big: { gap: 120, burst: 3, priority: 3, cost: 18, layer: 'air', play(o) {
    explosion(out(o, 'air', { vol: 1 }), 1.6, !!o.ground);
    duck('music', 0.5, 0.02, 0.5, 1.4);
    muffle(0.35, 0.5);
  } },
  // a building comes down: groan, crumble, dust
  collapse: { gap: 160, burst: 3, priority: 1, cost: 8, layer: 'ground', play(o) {
    const c = out({ ...o, ground: true }, 'ground', { vol: 0.9 }), p = j(0.1);
    tone(c, { type: 'sawtooth', f0: 70 * p, f1: 38, dur: 1.4, vol: 0.12, attack: 0.15 });       // steel frame groan
    noise(c, { filter: 'lowpass', f0: 1400, f1: 120, dur: 2.2, vol: 0.55, brown: true, attack: 0.25 }); // masonry avalanche
    noise(c, { filter: 'bandpass', f0: 600, f1: 200, q: 0.8, dur: 1.6, vol: 0.25, delay: 0.3, attack: 0.3 });
    for (let i = 0; i < 9; i++) noise(c, { filter: 'bandpass', f0: 500 + Math.random() * 2000, q: 2, dur: 0.05 + Math.random() * 0.08, vol: 0.12, delay: 0.2 + Math.random() * 1.6 });
    sub(c, 55, 28, 1.6, 0.4, 0.2);
  } },
  // our hull takes a hit: steel plate ringing, a deep thud through the frame, sparks
  hit: { gap: 80, burst: 3, priority: 3, cost: 7, layer: 'ship', play(o) {
    const c = out(o, 'ship', { vol: 0.8 }), p = j(0.08);
    sample(c, S(pickOf(['hull1', 'hull2', 'hull3'])), { vol: 0.7, rate: 0.7 * p });
    sub(c, 120 * p, 40, 0.3, 0.75);
    noise(c, { filter: 'lowpass', f0: 1500, f1: 200, dur: 0.25, vol: 0.4 });
    debris(c, 4, 0.18, 0.1, 2500, 6500, 0.02);
    tone(c, { type: 'triangle', f0: 410 * p, f1: 395 * p, dur: 0.6, vol: 0.05, delay: 0.01 }); // the plate keeps ringing
    muffle(0.18, 0.25);
  } },
  shield: { gap: 70, burst: 3, priority: 2, cost: 4, layer: 'ship', play(o) {
    const c = out(o, 'ship', { vol: 0.5 });
    sample(c, S('shield'), { vol: 0.55, rate: j(0.08), dur: 0.5, release: 0.2 });
    tone(c, { type: 'sine', f0: 220, f1: 180, dur: 0.3, vol: 0.12 });
  } },
  // enemy small arms and cannons: dry, small, bright (they are not us)
  eshot: { gap: 65, burst: 4, priority: 1, cost: 3, layer: 'air', play(o) {
    const c = out(o, 'air', { vol: 0.32, wet: 0.08 }), p = j(0.1);
    noise(c, { filter: 'bandpass', f0: 1900 * p, f1: 700, q: 1.4, dur: 0.06, vol: 0.5 });
    tone(c, { type: 'square', f0: 620 * p, f1: 200, dur: 0.07, vol: 0.12 });
  } },
  eMissile: { gap: 150, burst: 2, priority: 1, cost: 3, layer: 'air', play(o) {
    const c = out(o, 'air', { vol: 0.35 });
    noise(c, { filter: 'bandpass', f0: 900, f1: 4200, q: 1.4, dur: 0.45, vol: 0.4, attack: 0.04 });
  } },
  // a jet screaming past (call on spawn)
  jet: { gap: 700, priority: 0, cost: 3, layer: 'air', play(o) {
    const c = out(o, 'air', { vol: 0.32 });
    noise(c, { filter: 'bandpass', f0: 1200, f1: 380, q: 1.2, dur: 1.6, vol: 0.4, attack: 0.6 });
    tone(c, { type: 'sawtooth', f0: 880, f1: 430, dur: 1.5, vol: 0.025, attack: 0.6 });
  } },

  /* salvage, warnings, state -------------------------------------------- */
  // scrap whooshing into the hull: each pickup in a stream climbs a semitone (to an octave), then the stream resets
  pick: { gap: 30, burst: 8, priority: 2, cost: 3, layer: 'ship', play(o) {
    const t = now();
    scrapStreak = t - scrapAt < 0.45 ? Math.min(12, scrapStreak + 1) : 0; scrapAt = t;
    const r = Math.pow(2, scrapStreak / 12), c = out(o, 'ship', { vol: 0.42, wet: 0.1 });
    noise(c, { filter: 'bandpass', f0: 900 * r, f1: 3800 * r, q: 2, dur: 0.12, vol: 0.18, attack: 0.05 });
    tone(c, { type: 'sine', f0: 1046 * r, f1: 1046 * r * 1.02, dur: 0.12, vol: 0.12, delay: 0.06 });
    tone(c, { type: 'triangle', f0: 2093 * r, dur: 0.08, vol: 0.04, delay: 0.07 });
  } },
  // ship klaxon over the PA: banner alarms (elite contact, boss arrival, enrage, emergency jump)
  alarm: { gap: 400, priority: 3, cost: 6, play(o) {
    const c = out(o, 'ui', { vol: 0.55, wet: 0.35 });
    for (let i = 0; i < 2; i++) {
      tone(c, { type: 'sawtooth', f0: 466, f1: 466, dur: 0.32, vol: 0.09, delay: i * 0.62, attack: 0.02 });
      tone(c, { type: 'sawtooth', f0: 349, f1: 349, dur: 0.3, vol: 0.09, delay: i * 0.62 + 0.31, attack: 0.02 });
    }
    sample(c, S('bell'), { vol: 0.25, rate: 0.5 });
  } },
  // area clear: two PA chimes and a relay clunk
  clear: { gap: 500, priority: 3, cost: 6, play(o) {
    const c = out(o, 'ui', { vol: 0.5, wet: 0.3 });
    sample(c, S('ui_relay'), { vol: 0.6 });
    for (const [i, f] of [[0, 587.3], [1, 880]] as const) { tone(c, { type: 'sine', f0: f, dur: 1.1, vol: 0.12, delay: 0.08 + i * 0.22 }); tone(c, { type: 'sine', f0: f * 2.01, dur: 0.6, vol: 0.03, delay: 0.08 + i * 0.22 }); }
  } },

  /* the equipment UI ------------------------------------------------------ */
  ui: { gap: 35, priority: 3, cost: 2, play(o) { const c = out({ vol: o.vol }, 'ui', { vol: 0.5, bus: 'raw' }); sample(c, S('ui_relay'), { vol: 0.7 }); tone(c, { type: 'square', f0: 1900, f1: 1400, dur: 0.012, vol: 0.03 }); } },
  uiHover: { gap: 45, priority: 3, cost: 1, play(o) { sample(out({ vol: o.vol }, 'ui', { vol: 0.25, bus: 'raw' }), S('ui_tick'), { vol: 0.6, rate: j(0.04) }); } },
  uiSwitch: { gap: 40, priority: 3, cost: 2, play(o) { const c = out({ vol: o.vol }, 'ui', { vol: 0.5, bus: 'raw' }); sample(c, S('ui_switch'), { vol: 0.8 }); sub(c, 160, 90, 0.05, 0.15); } },
  uiToggle: { gap: 40, priority: 3, cost: 1, play(o) { sample(out({ vol: o.vol }, 'ui', { vol: 0.45, bus: 'raw' }), S('ui_toggle'), { vol: 0.8 }); } },
  uiOpen: { gap: 80, priority: 3, cost: 3, play(o) { const c = out({ vol: o.vol }, 'ui', { vol: 0.4, bus: 'raw' }); sample(c, S('ui_open'), { vol: 0.6, rate: 0.8 }); noise(c, { filter: 'bandpass', f0: 400, f1: 1600, q: 1, dur: 0.18, vol: 0.06, attack: 0.08 }); } },
  uiClose: { gap: 80, priority: 3, cost: 2, play(o) { sample(out({ vol: o.vol }, 'ui', { vol: 0.4, bus: 'raw' }), S('ui_close'), { vol: 0.6, rate: 0.8 }); } },
  uiConfirm: { gap: 120, priority: 3, cost: 3, play(o) { const c = out({ vol: o.vol }, 'ui', { vol: 0.45, bus: 'raw' }); sample(c, S('ui_confirm'), { vol: 0.5, rate: 0.85 }); sample(c, S('ui_relay'), { vol: 0.5, delay: 0.05 }); } },
  uiError: { gap: 150, priority: 3, cost: 3, play(o) { const c = out({ vol: o.vol }, 'ui', { vol: 0.45, bus: 'raw' }); sample(c, S('ui_error'), { vol: 0.6, rate: 0.8 }); tone(c, { type: 'square', f0: 140, dur: 0.16, vol: 0.05 }); } },
  // split-flap counter: a rattle of flaps settling (scrap totals, wreck report)
  uiFlap: { gap: 60, priority: 3, cost: 6, play(o) {
    const c = out({ vol: o.vol }, 'ui', { vol: 0.45, bus: 'raw' }), n = Math.max(3, Math.min(12, Math.round(o.size ?? 6)));
    for (let i = 0; i < n; i++) { const k = i / n; sample(c, S('ui_tick'), { vol: 0.5 + 0.4 * k, rate: (0.85 + Math.random() * 0.3) * (1 - 0.15 * k), delay: i * (0.026 + 0.012 * k) }); }
  } },
  // rubber stamp / heavy latch: purchases, upgrades, relic installed
  buy: { gap: 80, priority: 3, cost: 6, play(o) {
    const c = out({ vol: o.vol }, 'ui', { vol: 0.6, bus: 'raw' });
    sample(c, S('hull3'), { vol: 0.5, rate: 0.55 });
    sub(c, 110, 48, 0.18, 0.5);
    noise(c, { filter: 'lowpass', f0: 900, f1: 200, dur: 0.08, vol: 0.25 });
    sample(c, S('ui_relay'), { vol: 0.6, delay: 0.09 });
    tone(c, { type: 'sine', f0: 1318.5, dur: 0.25, vol: 0.035, delay: 0.1 });
  } },
  uiStamp: { gap: 80, priority: 3, cost: 4, play(o) { const c = out({ vol: o.vol }, 'ui', { vol: 0.6, bus: 'raw' }); sample(c, S('hull3'), { vol: 0.55, rate: 0.5 }); sub(c, 100, 45, 0.2, 0.55); noise(c, { filter: 'lowpass', f0: 700, f1: 150, dur: 0.1, vol: 0.3 }); } },
  // music-adjacent: brass stab with timpani (used by music stings too; available as a plain cue)
  timp: { gap: 200, priority: 3, cost: 2, play(o) { sample(out(o, 'ui', { vol: 0.8, wet: 0.4 }), I('timp-38'), { vol: 1 }); } },
};

/** Old names kept working for existing callers. */
export const ALIASES: Record<string, string> = { boomGround: 'groundBoom', explosion: 'boom', broadside: 'cannon', arc: 'zap', bomb: 'bombDrop', scrap: 'pick', klaxon: 'alarm' };

/**
 * Mix trims in dB, set from offline renders (scripts/audio/render-cues.mjs, loudest 400 ms RMS of each cue alone):
 * Overdrive and deaths loudest (about -9 dB), broadsides and kills next (-12..-15), our hull hit and rails (-15..-20),
 * rapid fire and salvage under that (-22..-26), enemy fire small (-30), UI quiet and dry (-20..-36). Single-cue peaks
 * stay at or under about -3 dBFS.
 */
export const LEVEL_DB: Record<string, number> = {
  cannon: -3, rail: -2, lance: -3.5, boom: -2.5, groundBoom: -4.5, big: -1.5, collapse: -4, hit: -2, shield: -4,
  zap: 9, pd: 3, bombDrop: 5, railCharge: 6, pick: 9, alarm: 8, clear: 2, flakPop: 1, missile: -1,
  eshot: 9, eMissile: 7, jet: 2,
  ui: 5, uiHover: 4, uiToggle: -3.5, uiOpen: -6, uiClose: -6, uiConfirm: -4, uiError: 1.5, uiFlap: -3, buy: -2, uiStamp: -2.7, uiSwitch: -0.5,
};
