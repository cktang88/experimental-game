// Audio lab (dev only, open /src/audio/lab.html on the dev server): renders cues, music and ambience through the real mix graph into an
// OfflineAudioContext, so scripts/audio/render-cues.mjs can measure peaks and loudness and save WAVs without ears.
// The offline render is stepped with ctx.suspend() every 40 ms so the music scheduler and the watchers tick exactly as
// they do live.

import { attachContext, swapRuntime, loadBuffer, type Runtime } from './core';
import { sfx, SFX_SAMPLES, resetAdmission, type CueOpts } from './index';
import { MusicEngine, type StingKind } from './music';
import { TRACK_DATA } from './trackdata';
import type { Scene } from './scene';
import { initShip, setEngineOn, setShipThrottle, updateShip, setHullIntegrity } from './ship';
import { initAmbience, setCombatAmbience, updateAmbience, addDestruction, chatter, cutChatter } from './ambience';

export type LabEvent =
  | { t: number; cue: string; opts?: CueOpts }
  | { t: number; scene: Scene }
  | { t: number; sting: StingKind }
  | { t: number; engine: boolean; throttle?: number; hull?: number }
  | { t: number; ambience: boolean; destruction?: number }
  | { t: number; chatter: string; x?: number; cut?: boolean }
  | { t: number; intensity: number };

export interface LabResult { seconds: number; peakDb: number; rmsDb: number; maxShortRmsDb: number; clipped: number; wav?: string }

const STEP = 0.04;

function stats(buf: AudioBuffer) {
  let peak = 0, sum = 0, clipped = 0, maxShort = 0;
  const n = buf.length, win = Math.floor(buf.sampleRate * 0.4);
  const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  let wsum = 0;
  for (let i = 0; i < n; i++) {
    let e = 0;
    for (const d of chans) { const v = d[i], a = Math.abs(v); if (a > peak) peak = a; if (a >= 0.999) clipped++; e += v * v; }
    e /= chans.length; sum += e; wsum += e;
    if (i >= win) { let o = 0; for (const d of chans) o += d[i - win] * d[i - win]; wsum -= o / chans.length; }
    if (i >= win && wsum / win > maxShort) maxShort = wsum / win;
  }
  const db = (x: number) => +(20 * Math.log10(Math.max(1e-9, x))).toFixed(2);
  return { peakDb: db(peak), rmsDb: db(Math.sqrt(sum / n)), maxShortRmsDb: db(Math.sqrt(maxShort)), clipped };
}

function wav(buf: AudioBuffer): string {
  const ch = buf.numberOfChannels, n = buf.length, bytes = 44 + n * ch * 2, dv = new DataView(new ArrayBuffer(bytes));
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); dv.setUint32(4, bytes - 8, true); w(8, 'WAVE'); w(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true);
  dv.setUint32(24, buf.sampleRate, true); dv.setUint32(28, buf.sampleRate * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, n * ch * 2, true);
  const d = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44; for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const v = Math.max(-1, Math.min(1, d[c][i])); dv.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2; }
  let bin = ''; const u = new Uint8Array(dv.buffer); for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function render(events: LabEvent[], seconds: number, { withWav = false, sampleRate = 44100 } = {}): Promise<LabResult> {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  const r: Runtime = attachContext(ctx);
  const prev = swapRuntime(r);
  try {
    await Promise.all([
      ...SFX_SAMPLES.map((id) => loadBuffer(`sfx/${id}.mp3`)), loadBuffer('sfx/rumble.mp3'), loadBuffer('sfx/engine.mp3'),
      ...Object.values(TRACK_DATA).map((t) => loadBuffer(`music/${t.file}`)),
      ...['timp-38', 'timp-43', 'bone-40', 'bone-46', 'tuba-34', 'horn-48', 'choir-48', 'choir-54'].map((n) => loadBuffer(`inst/${n}.mp3`)),
    ]);
    const engine = new MusicEngine(r);
    for (const name of Object.keys(TRACK_DATA)) engine.loaded.add(name);
    initShip(true); initAmbience(true); resetAdmission();
    let world = false;
    const queue = [...events].sort((a, b) => a.t - b.t);
    for (let k = 0; k * STEP < seconds - STEP; k++) {
      const t = k * STEP;
      ctx.suspend(t).then(() => {
        r.clock = t;
        while (queue.length && queue[0].t <= t + 1e-9) {
          const e = queue.shift()!;
          if ('cue' in e) sfx(e.cue, e.opts);
          else if ('scene' in e) engine.setScene(e.scene);
          else if ('sting' in e) engine.sting(e.sting);
          else if ('engine' in e) { setEngineOn(e.engine); if (e.throttle !== undefined) setShipThrottle(e.throttle); if (e.hull !== undefined) setHullIntegrity(e.hull); }
          else if ('ambience' in e) { world = true; setCombatAmbience(e.ambience); if (e.destruction) addDestruction(e.destruction); }
          else if ('chatter' in e) { if (e.cut) cutChatter(e.chatter, e.x); else chatter(e.chatter, e.x); }
          else if ('intensity' in e) engine.setIntensity(e.intensity);
        }
        engine.tick(); updateShip(STEP, null); if (world) updateAmbience(STEP, 0.5);
        r.clock = null;
        ctx.resume();
      });
    }
    const buf = await ctx.startRendering();
    return { seconds, ...stats(buf), wav: withWav ? wav(buf) : undefined };
  } finally {
    swapRuntime(prev);
  }
}

(window as unknown as { __gdAudioLab: unknown }).__gdAudioLab = { render };
