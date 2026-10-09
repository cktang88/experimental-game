import { describe, expect, it } from 'vitest';
import { panFromX, placement, createAdmission, parseSettings, serializeSettings, sliderGain, DEFAULT_SETTINGS, VOICE_CAPS } from '../../src/audio/mix';
import { chatterPlan, makeRng, sirenPitch, SIREN_CYCLE } from '../../src/audio/ambience';
import { CUES, ALIASES } from '../../src/audio/cues';

describe('placement', () => {
  it('pans by field x', () => {
    expect(panFromX(800)).toBeCloseTo(0);
    expect(panFromX(0)).toBeCloseTo(-0.85);
    expect(panFromX(1600)).toBeCloseTo(0.85);
    expect(panFromX(undefined)).toBe(0);
  });
  it('ground sounds are dull, quieter, wetter and late; ship and ui are close', () => {
    const g = placement({ x: 400, y: 450, ground: true }), a = placement({ x: 400, y: 450 }), s = placement({ x: 400, layer: 'ship' }), u = placement();
    expect(g.cutoff).toBeLessThan(3000); expect(g.delay).toBeGreaterThan(0.04); expect(g.wet).toBeGreaterThan(a.wet); expect(g.gain).toBeLessThan(a.gain);
    expect(a.delay).toBe(0); expect(s.cutoff).toBe(20000); expect(Math.abs(s.pan)).toBeLessThan(Math.abs(a.pan));
    expect(u).toEqual({ pan: 0, gain: 1, cutoff: 20000, delay: 0, wet: 0 });
  });
  it('the city further ahead (up the screen) is further away', () => {
    const near = placement({ x: 800, y: 850, ground: true }), far = placement({ x: 800, y: 50, ground: true });
    expect(far.cutoff).toBeLessThan(near.cutoff); expect(far.delay).toBeGreaterThan(near.delay); expect(far.gain).toBeLessThan(near.gain);
  });
});

describe('admission', () => {
  it('enforces the gap', () => {
    const a = createAdmission();
    expect(a.admit('pew', 0, { gap: 50 }, 0)).toBe(true);
    expect(a.admit('pew', 30, { gap: 50 }, 0)).toBe(false);
    expect(a.admit('pew', 51, { gap: 50 }, 0)).toBe(true);
  });
  it('caps bursts within a window', () => {
    const a = createAdmission();
    const r = [0, 10, 20, 30].map((t) => a.admit('boom', t, { burst: 3, window: 100 }, 0));
    expect(r).toEqual([true, true, true, false]);
    expect(a.admit('boom', 120, { burst: 3, window: 100 }, 0)).toBe(true);
  });
  it('drops low-priority cues first when voices run out', () => {
    const a = createAdmission();
    const v = VOICE_CAPS[0] + 1;
    expect(a.admit('chatter', 0, { priority: 0 }, v)).toBe(false);
    expect(a.admit('hit', 0, { priority: 3 }, v)).toBe(true);
  });
});

describe('settings', () => {
  it('round-trips and clamps', () => {
    const s = parseSettings(serializeSettings({ master: 0.5, music: 0.25, sfx: 1, muted: true }));
    expect(s).toEqual({ master: 0.5, music: 0.25, sfx: 1, muted: true });
    expect(parseSettings('{"master":7,"music":-1}').master).toBe(1);
    expect(parseSettings('{"master":7,"music":-1}').music).toBe(0);
  });
  it('falls back to defaults on junk and honours the old mute flag', () => {
    expect(parseSettings('nope')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(null, '1').muted).toBe(true);
  });
  it('slider curve is monotonic, 0 is silent and 1 is unity', () => {
    expect(sliderGain(0)).toBe(0); expect(sliderGain(1)).toBe(1);
    expect(sliderGain(0.5)).toBeGreaterThan(sliderGain(0.4));
  });
});

describe('ambience helpers', () => {
  it('chatter is a few short syllables inside the duration', () => {
    const p = chatterPlan(makeRng(7), { maxDuration: 2 });
    expect(p.syllables.length).toBeGreaterThan(0);
    for (const s of p.syllables) { expect(s.t + s.dur).toBeLessThanOrEqual(2); expect(s.f2).toBeGreaterThan(s.f1); }
  });
  it('the siren winds up, wails and winds down', () => {
    expect(sirenPitch(0)).toBeCloseTo(140);
    expect(sirenPitch(6)).toBeCloseTo(470);
    expect(sirenPitch(SIREN_CYCLE)).toBeCloseTo(140);
    expect(sirenPitch(3)).toBeGreaterThan(sirenPitch(1));
  });
});

describe('cue table', () => {
  it('every cue the game calls exists', () => {
    const called = ['pew', 'spread', 'boom', 'big', 'hit', 'pick', 'rail', 'zap', 'alarm', 'clear', 'ui', 'buy', 'cannon', 'flak', 'flakPop', 'missile', 'bombDrop', 'pd', 'groundBoom', 'collapse', 'shield', 'eshot', 'eMissile', 'railCharge', 'jet'];
    for (const c of called) expect(CUES[c], c).toBeTruthy();
    for (const [k, v] of Object.entries(ALIASES)) expect(CUES[v], k).toBeTruthy();
  });
});
