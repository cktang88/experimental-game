// Tiny synthesized sound effects. Starts only after a user gesture.
let ctx: AudioContext | null = null;
let noiseBuf: AudioBuffer | null = null;
export const audio = { on: localStorage.getItem('gd.mute') !== '1' };

export function initAudio() {
  if (ctx) return;
  try {
    ctx = new AudioContext();
    const len = ctx.sampleRate;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  } catch { ctx = null; }
}
export function setMuted(m: boolean) { audio.on = !m; try { localStorage.setItem('gd.mute', m ? '1' : '0'); } catch { /* storage blocked */ } }

function tone(f: number, dur: number, type: OscillatorType, vol: number, slide = 0) {
  if (!ctx || !audio.on) return;
  const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f * slide), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + dur);
}
function noise(dur: number, vol: number, freq = 900) {
  if (!ctx || !audio.on || !noiseBuf) return;
  const t = ctx.currentTime, s = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
  s.buffer = noiseBuf; f.type = 'lowpass'; f.frequency.value = freq;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(ctx.destination); s.start(t); s.stop(t + dur);
}
const last: Record<string, number> = {};
const GAP: Record<string, number> = { pew: 70, hit: 80, boom: 45, pick: 35, rail: 90, zap: 80 };
export function sfx(n: string) {
  const now = performance.now();
  if (last[n] && now - last[n] < (GAP[n] || 0)) return;
  last[n] = now;
  switch (n) {
    case 'pew': tone(920, 0.05, 'square', 0.012, 0.5); break;
    case 'boom': noise(0.3, 0.12, 700); break;
    case 'big': noise(1.2, 0.35, 500); tone(80, 1, 'sawtooth', 0.08, 0.3); break;
    case 'hit': tone(150, 0.14, 'sawtooth', 0.07, 0.5); break;
    case 'pick': tone(1300, 0.05, 'sine', 0.025, 1.4); break;
    case 'rail': tone(300, 0.25, 'sawtooth', 0.05, 4); break;
    case 'zap': noise(0.08, 0.05, 4000); break;
    case 'alarm': tone(440, 0.25, 'square', 0.05, 1); setTimeout(() => tone(330, 0.3, 'square', 0.05, 1), 260); break;
    case 'clear': tone(520, 0.12, 'triangle', 0.06, 1); setTimeout(() => tone(780, 0.2, 'triangle', 0.06, 1), 120); break;
    case 'ui': tone(660, 0.05, 'triangle', 0.03, 1.2); break;
    case 'buy': tone(880, 0.07, 'triangle', 0.04, 1.5); setTimeout(() => tone(1320, 0.08, 'triangle', 0.035, 1), 70); break;
  }
}
