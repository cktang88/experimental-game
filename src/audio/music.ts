// The adaptive score. One recorded loop per scene (public/assets/audio/music, cut to whole bars by
// scripts/audio/build-music.mjs), chosen by the scene machine (scene.ts) and changed on the playing track's next bar line
// with an equal-power crossfade. On top of the recordings:
//   - stings (elite kill, boss phase 2, area clear, carnage drop) from orchestral samples, landed on the next beat while
//     the score ducks under them;
//   - an intensity layer: war drums locked to the playing track's beat, swelling with the fight;
//   - death: a tape-stop (rate -> 0.06 over 1.25 s, low-pass -> 180 Hz, Dead Air's music.js) into a low requiem drone;
//   - low hull: the score closes down behind a low-pass; pause: ducked and dulled.
// Adapted from Dead Air's music.js / music-core.js and Tinwar's music.ts (stings on the beat, the streak bass drop).

import { loadBuffer, buffer, now, type Runtime } from './core';
import { TRACK_DATA } from './trackdata';
import {
  createSceneMachine, resolveTrack, nextBoundary, crossfadeSeconds, equalPowerCurve, beatAt, stepIntensity,
  LOAD_ORDER, SCENE_RANK, STING_DUCK, SCENE_TRACK, type Scene, type TrackInfo,
} from './scene';

interface Voice { name: string; track: TrackInfo; src: AudioBufferSourceNode; gain: GainNode; t0: number; fadingOut: boolean; endAt: number; ended: boolean }
export type StingKind = 'eliteKill' | 'bossPhase2' | 'clear' | 'carnage' | 'sectorClear';

const CURVE_N = 64;
const TRACK_GAIN: Record<string, number> = { title: 0.9, map: 0.9, combat: 0.95, elite: 0.95, boss: 0.8, victory: 0.95 };
const INST = (n: string) => `inst/${n}.mp3`;
const NOTE = (from: number, to: number) => Math.pow(2, (to - from) / 12);

export class MusicEngine {
  r: Runtime; ctx: BaseAudioContext;
  out: GainNode; lp: BiquadFilterNode; duckG: GainNode; stingBus: GainNode; drumBus: GainNode; drone: GainNode | null = null;
  voices: Voice[] = [];
  loaded = new Set<string>();
  machine = createSceneMachine();
  pending: { name: string } | null = null;
  dead = false; paused = false; lowHull = false;
  intensity = 0; intensityTarget = 0; drumBeat = -1;
  history: { type: string; at: number; [k: string]: unknown }[] = [];
  lastTick = 0;

  constructor(r: Runtime) {
    this.r = r; this.ctx = r.ctx;
    const g = (v: number, to: AudioNode) => { const n = this.ctx.createGain(); n.gain.value = v; n.connect(to); return n; };
    this.out = g(1, r.musicIn);
    this.lp = this.ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 20000; this.lp.Q.value = 0.5; this.lp.connect(this.out);
    this.duckG = g(1, this.lp);
    this.stingBus = g(0.9, r.musicVol);
    this.drumBus = g(0, this.lp);
    this.lastTick = now();
  }

  private t() { return now(); }
  private log(type: string, extra: Record<string, unknown> = {}) { this.history.push({ type, at: this.t(), ...extra }); if (this.history.length > 120) this.history.shift(); }

  /** Fetch every track (title first), one at a time so a missing file never blocks the rest. Also the sting samples. */
  async load() {
    const inst = ['timp-38', 'timp-43', 'bone-40', 'bone-46', 'tuba-34', 'horn-48', 'choir-48', 'choir-54'];
    for (const name of LOAD_ORDER) {
      const info = TRACK_DATA[name]; if (!info) continue;
      const buf = await loadBuffer(`music/${info.file}`);
      if (buf) { this.loaded.add(name); this.log('loaded', { name }); this.reconcile(); } else this.log('load-failed', { name });
      if (name === 'title') await Promise.all(inst.map((n) => loadBuffer(INST(n))));
    }
  }

  get scene(): Scene { return this.machine.scene; }
  get primary(): Voice | null { for (let i = this.voices.length - 1; i >= 0; i--) if (!this.voices[i].fadingOut) return this.voices[i]; return null; }

  setScene(scene: Scene) {
    const before = this.machine.scene;
    const s = this.machine.request(scene, this.t());
    if (s !== before) this.enter(s, before);
  }

  private enter(s: Scene, prev: Scene) {
    this.log('scene', { from: prev, to: s });
    if (s === 'death') { this.death(); return; }
    if (this.dead) this.revive();
    if (s === 'silent') { for (const v of this.voices) if (!v.fadingOut) this.fadeOut(v, this.t(), 1.2); this.pending = null; return; }
    if (SCENE_RANK[s] < 2) this.intensityTarget = 0;
    this.reconcile();
  }

  private target(): string | null { return resolveTrack(this.machine.scene, this.loaded); }

  private reconcile() {
    if (this.dead) return;
    const target = this.target(), cur = this.primary;
    if (!target) { this.pending = null; return; }
    if (cur && cur.name === target) { this.pending = null; return; }
    if (!cur) { this.pending = null; this.startVoice(target, this.t() + 0.05, 1.4); return; }
    this.pending = { name: target };
  }

  private startVoice(name: string, t: number, xf: number): Voice | null {
    const track = TRACK_DATA[name], buf = buffer(`music/${track?.file}`);
    if (!track || !buf) return null;
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = track.loop;
    if (track.loop && Math.abs(buf.duration - track.duration) > 0.002) { src.loopStart = 0; src.loopEnd = Math.min(buf.duration, track.duration); }
    const gain = this.ctx.createGain(), level = TRACK_GAIN[name] ?? 1;
    gain.gain.value = 0; gain.gain.setValueAtTime(0, t);
    try { gain.gain.setValueCurveAtTime(equalPowerCurve(CURVE_N, true, level), t, xf); } catch { gain.gain.linearRampToValueAtTime(level, t + xf); }
    src.connect(gain); gain.connect(this.duckG); src.start(t);
    const v: Voice = { name, track, src, gain, t0: t, fadingOut: false, endAt: Infinity, ended: false };
    if (!track.loop) src.onended = () => { v.ended = true; };
    this.voices.push(v); this.drumBeat = -1;
    this.log('start', { name, when: t, xf });
    return v;
  }

  private fadeOut(v: Voice, t: number, xf: number) {
    v.fadingOut = true; v.endAt = t + xf + 0.05;
    const level = TRACK_GAIN[v.name] ?? 1;
    v.gain.gain.cancelScheduledValues(t);
    try { v.gain.gain.setValueCurveAtTime(equalPowerCurve(CURVE_N, false, level), t, xf); } catch { v.gain.gain.linearRampToValueAtTime(0, t + xf); }
    try { v.src.stop(v.endAt); } catch { /* already stopped */ }
  }

  /** Seconds of audio played by a voice at time t (wrapped for loops). */
  pos(v: Voice, t = this.t()) { const p = Math.max(0, t - v.t0); return v.track.loop ? p % v.track.duration : Math.min(p, v.track.duration); }

  /* -------------------------------------------------- death: tape stop into the requiem */
  private death() {
    if (this.dead) return;
    this.dead = true; this.pending = null; this.intensityTarget = 0;
    const n = this.t();
    for (const v of this.voices) {
      v.fadingOut = true; v.endAt = n + 1.7;
      v.src.playbackRate.cancelScheduledValues(n); v.src.playbackRate.setValueAtTime(1, n); v.src.playbackRate.exponentialRampToValueAtTime(0.06, n + 1.25);
      v.gain.gain.cancelScheduledValues(n); v.gain.gain.setValueAtTime(v.gain.gain.value, n); v.gain.gain.linearRampToValueAtTime(0, n + 1.3);
      try { v.src.stop(n + 1.7); } catch { /* ok */ }
    }
    this.lp.frequency.cancelScheduledValues(n); this.lp.frequency.setValueAtTime(this.lp.frequency.value, n); this.lp.frequency.setTargetAtTime(180, n, 0.4);
    this.drumBus.gain.setTargetAtTime(0, n, 0.1);
    this.requiem(n + 1.4);
    this.log('death');
  }
  /** A low, slow drone for the wreck report: detuned saws in a dark filter, a choir note far below. */
  private requiem(t: number) {
    const ctx = this.ctx, out = ctx.createGain(); out.gain.value = 0; out.connect(this.stingBus);
    out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(0.32, t + 4);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 0.8; lp.connect(out);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05; const ld = ctx.createGain(); ld.gain.value = 160; lfo.connect(ld); ld.connect(lp.frequency); lfo.start(t);
    this.droneSrcs = [lfo];
    for (const [hz, det] of [[36.7, -7], [36.7, 6], [55, 3], [73.4, -4]] as const) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz; o.detune.value = det; const og = ctx.createGain(); og.gain.value = 0.12; o.connect(og); og.connect(lp); o.start(t); this.droneSrcs.push(o); }
    const choir = buffer(INST('choir-48'));
    if (choir) { const s = ctx.createBufferSource(); s.buffer = choir; s.playbackRate.value = NOTE(48, 38); s.loop = true; s.loopStart = 0.6; s.loopEnd = 2.4; const sg = ctx.createGain(); sg.gain.value = 0.35; s.connect(sg); sg.connect(out); s.start(t + 1); this.droneSrcs.push(s); }
    this.drone = out;
  }
  droneSrcs: AudioScheduledSourceNode[] = [];
  private revive() {
    this.dead = false; const n = this.t();
    this.lp.frequency.cancelScheduledValues(n); this.lp.frequency.setValueAtTime(this.lp.frequency.value, n); this.lp.frequency.setTargetAtTime(this.lowHull ? 1600 : 20000, n, 0.2);
    if (this.drone) {
      const d = this.drone; d.gain.cancelScheduledValues(n); d.gain.setValueAtTime(d.gain.value, n); d.gain.linearRampToValueAtTime(0, n + 1.5);
      for (const s of this.droneSrcs) { try { s.stop(n + 1.6); } catch { /* not started */ } }
      this.droneSrcs = []; this.drone = null;
    }
    this.voices = this.voices.filter((v) => !v.fadingOut || v.endAt > n);
    this.log('revive');
  }

  /* -------------------------------------------------- state from the game */
  setIntensity(v: number) { this.intensityTarget = Math.max(0, Math.min(1, v)); }
  setPaused(p: boolean) {
    if (this.paused === p) return; this.paused = p;
    const n = this.t();
    this.out.gain.setTargetAtTime(p ? 0.4 : 1, n, 0.12);
    if (!this.dead) this.lp.frequency.setTargetAtTime(p ? 900 : this.lowHull ? 1600 : 20000, n, 0.15);
  }
  setLowHull(v: boolean) {
    if (this.lowHull === v) return; this.lowHull = v;
    if (!this.dead && !this.paused) this.lp.frequency.setTargetAtTime(v ? 1600 : 20000, this.t(), 0.6);
  }

  /* -------------------------------------------------- scheduler */
  /** Advance to the audio clock's now: fire due crossfades, hand over ended one-shots, schedule drums. */
  tick() {
    const n = this.t(), dt = Math.min(0.5, Math.max(0, n - this.lastTick)); this.lastTick = n;
    const lookahead = 0.15 + Math.min(0.4, dt * 1.5);
    for (const v of this.voices) {
      if (!v.track.loop && !v.ended && !v.fadingOut && n >= v.t0 + v.track.duration) v.ended = true;
      if (v.ended && !v.fadingOut) {
        v.fadingOut = true; v.endAt = n; this.log('ended', { name: v.name });
        const before = this.machine.scene, s = this.machine.oneShotEnded(v.name, n);
        if (s !== before) this.enter(s, before);
      }
    }
    if (!this.dead) this.runPending(n, lookahead);
    this.voices = this.voices.filter((v) => { if (v.endAt <= n) { try { v.gain.disconnect(); } catch { /* ok */ } return false; } return true; });
    // a scene request held back by the debounce is applied once its dwell has passed
    const before = this.machine.scene, s = this.machine.update(n);
    if (s !== before) this.enter(s, before);
    this.intensity = stepIntensity(this.intensity, this.intensityTarget, dt);
    this.drums(n, lookahead);
  }

  private runPending(n: number, lookahead: number) {
    const p = this.pending, cur = this.primary;
    if (!p) return;
    if (!cur) { this.pending = null; this.reconcile(); return; }
    const next = TRACK_DATA[p.name];
    const up = (SCENE_RANK[sceneOf(p.name)] ?? 0) > (SCENE_RANK[sceneOf(cur.name)] ?? 0);
    // escalations must not lag: a bar line further than 1.6 s falls back to the next beat; calm-downs may wait 4 s
    const maxWait = p.name === 'victory' ? 0.6 : up ? 1.6 : 4;
    const nb = cur.t0 > n ? { wait: cur.t0 - n + 0.06, kind: 'bar' as const } : nextBoundary({ pos: this.pos(cur, n), bpm: cur.track.bpm, beatsPerBar: cur.track.beatsPerBar, maxWait });
    if (nb.wait > lookahead) return;
    const t = n + nb.wait, xf = p.name === 'victory' ? 0.5 : crossfadeSeconds(next.bpm, up);
    this.pending = null;
    if (!this.startVoice(p.name, t, xf)) return;
    this.fadeOut(cur, t, xf);
    this.log('transition', { from: cur.name, to: p.name, when: t, kind: nb.kind, xf, beatInBar: beatAt({ pos: this.pos(cur, t), loops: 0 }, cur.track).beatInBar });
  }

  /** War drums on the playing track's beat; louder and busier with intensity. Only in fights. */
  private drums(n: number, lookahead: number) {
    const cur = this.primary, fight = SCENE_RANK[this.machine.scene] >= 2 && this.machine.scene !== 'victory' && this.machine.scene !== 'death';
    const level = fight && !this.dead && !this.paused ? Math.max(0, (this.intensity - 0.35) / 0.65) : 0;
    this.drumBus.gain.setTargetAtTime(level * 0.55, n, 0.3);
    if (!cur || !cur.track.loop || level <= 0.01 || n < cur.t0) return;
    const beatLen = 60 / cur.track.bpm, bpb = cur.track.beatsPerBar;
    const first = Math.ceil((n - cur.t0) / beatLen - 1e-6);
    if (this.drumBeat < first) this.drumBeat = first;
    while (cur.t0 + this.drumBeat * beatLen < n + lookahead) {
      const k = this.drumBeat, at = cur.t0 + k * beatLen, inBar = k % bpb;
      const strong = inBar === 0, mid = bpb === 4 ? inBar === 2 : inBar === 4;
      if (strong || (mid && level > 0.25)) this.drumHit(at, strong ? 1 : 0.7);
      if (level > 0.7 && inBar === bpb - 1) this.drumHit(at + beatLen / 2, 0.45);
      this.drumBeat++;
    }
  }
  private drumHit(t: number, v: number) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(92, t); o.frequency.exponentialRampToValueAtTime(41, t + 0.35);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.5 * v, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(g); g.connect(this.drumBus); o.start(t); o.stop(t + 0.65);
    const s = ctx.createBufferSource(); s.buffer = this.r.brown; const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700; const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t); ng.gain.linearRampToValueAtTime(0.35 * v, t + 0.004); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    s.connect(f); f.connect(ng); ng.connect(this.drumBus); s.start(t, Math.random() * 2); s.stop(t + 0.2);
    const timp = buffer(INST('timp-38'));
    if (timp && v >= 1) { const ts = ctx.createBufferSource(); ts.buffer = timp; const tg = ctx.createGain(); tg.gain.value = 0.35; ts.connect(tg); tg.connect(this.drumBus); ts.start(t); ts.stop(t + 1.2); }
  }

  /** The beat audible now ({index, phase, bar, beatInBar, bpm}) or null when silent. */
  beat() { const v = this.primary; if (!v || this.dead || this.t() < v.t0) return null; return beatAt({ pos: this.pos(v), loops: Math.floor(Math.max(0, this.t() - v.t0) / v.track.duration) }, v.track); }

  /* -------------------------------------------------- stings */
  /** Land a sting on the next beat (at most 0.45 s away) with the score ducking under it. */
  sting(kind: StingKind) {
    if (this.dead) return;
    const cur = this.primary; let t = this.t() + 0.03;
    if (cur && this.t() > cur.t0) { const nb = nextBoundary({ pos: this.pos(cur), bpm: cur.track.bpm, beatsPerBar: 1, maxWait: 0.45, minWait: 0.03 }); t = this.t() + Math.min(0.45, nb.wait); }
    const big = kind === 'eliteKill' || kind === 'bossPhase2' || kind === 'carnage';
    const d = this.duckG.gain, lvl = big ? STING_DUCK.level * 0.8 : STING_DUCK.level;
    d.cancelScheduledValues(t - 0.06); d.setValueAtTime(d.value, t - 0.06); d.linearRampToValueAtTime(lvl, t - 0.06 + STING_DUCK.attack);
    d.setValueAtTime(lvl, t + STING_DUCK.hold * (big ? 1.6 : 1)); d.setTargetAtTime(1, t + STING_DUCK.hold * (big ? 1.6 : 1), STING_DUCK.release / 3);
    const play = (name: string, at: number, rate: number, vol: number, dur?: number) => {
      const b = buffer(INST(name)); if (!b) return;
      const s = this.ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = rate; const g = this.ctx.createGain(); g.gain.value = vol;
      if (dur) { g.gain.setValueAtTime(vol, at + dur - 0.3); g.gain.linearRampToValueAtTime(0, at + dur); }
      s.connect(g); g.connect(this.stingBus); s.start(at); s.stop(at + (dur ?? b.duration / rate) + 0.05);
    };
    const sub = (at: number, f0: number, f1: number, dur: number, vol: number) => {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(f1, at + dur);
      g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(vol, at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      o.connect(g); g.connect(this.stingBus); o.start(at); o.stop(at + dur + 0.05);
    };
    const rise = (at: number, dur: number, vol: number) => {
      const s = this.ctx.createBufferSource(); s.buffer = this.r.white; s.loop = true; const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
      f.frequency.setValueAtTime(300, at); f.frequency.exponentialRampToValueAtTime(5000, at + dur);
      const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(vol, at + dur); g.gain.linearRampToValueAtTime(0.0001, at + dur + 0.05);
      s.connect(f); f.connect(g); g.connect(this.stingBus); s.start(at, Math.random()); s.stop(at + dur + 0.1);
    };
    // D power chords: D2 timpani, low brass on D/A, horns and choir an octave up. Key-neutral enough to sit on any score.
    switch (kind) {
      case 'eliteKill':
        rise(t - 0.35, 0.33, 0.08);
        play('timp-38', t, 1, 0.9); play('tuba-34', t, NOTE(34, 38), 0.7, 1.6); play('bone-40', t, NOTE(40, 45), 0.55, 1.6);
        play('horn-48', t + 0.02, NOTE(48, 50), 0.5, 2.0); play('horn-48', t + 0.02, NOTE(48, 57), 0.4, 2.0); play('choir-54', t + 0.05, NOTE(54, 62), 0.35, 2.4);
        sub(t, 73.4, 36.7, 1.2, 0.5);
        break;
      case 'bossPhase2':
        for (let i = 0; i < 10; i++) play('timp-43', t - 0.9 + 0.9 * Math.pow(i / 10, 0.6), NOTE(43, 38), 0.2 + 0.06 * i); // timpani roll into the hit
        play('timp-38', t, 1, 1); play('tuba-34', t, NOTE(34, 38), 0.8, 2.2); play('tuba-34', t, NOTE(34, 39), 0.55, 2.2); // a minor second: wrongness
        play('bone-46', t, NOTE(46, 50), 0.5, 2.2); play('bone-46', t, NOTE(46, 51), 0.4, 2.2); play('choir-48', t + 0.1, NOTE(48, 50), 0.4, 2.6);
        sub(t, 55, 27.5, 2, 0.6);
        break;
      case 'clear':
        play('timp-38', t, 1, 0.6); play('horn-48', t + 0.03, NOTE(48, 50), 0.45, 1.6); play('horn-48', t + 0.03, NOTE(48, 57), 0.35, 1.6);
        break;
      case 'sectorClear':
        play('timp-38', t, 1, 0.8); play('timp-43', t + 0.3, NOTE(43, 45), 0.6);
        play('horn-48', t, NOTE(48, 50), 0.5, 2.6); play('horn-48', t, NOTE(48, 57), 0.45, 2.6); play('choir-54', t, NOTE(54, 62), 0.4, 3); play('choir-54', t, NOTE(54, 66), 0.3, 3);
        break;
      case 'carnage':
        rise(t - 0.45, 0.43, 0.12);
        sub(t, 58, 28, 1.6, 0.85); play('timp-38', t, NOTE(38, 33), 1); play('tuba-34', t, NOTE(34, 26), 0.8, 1.4);
        break;
    }
    this.log('sting', { kind, when: t });
  }

  snapshot() {
    return { scene: this.machine.scene, wanted: this.machine.wanted, primary: this.primary?.name ?? null, pending: this.pending?.name ?? null, dead: this.dead, paused: this.paused, intensity: +this.intensity.toFixed(3), loaded: [...this.loaded], voices: this.voices.map((v) => ({ name: v.name, pos: +this.pos(v).toFixed(3), fadingOut: v.fadingOut })) };
  }
}

/** Which scene a track belongs to (for escalation ranking). */
function sceneOf(track: string): Scene {
  for (const [s, t] of Object.entries(SCENE_TRACK)) if (t === track) return s as Scene;
  return 'map';
}
