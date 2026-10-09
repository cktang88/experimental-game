import { describe, expect, it } from 'vitest';
import {
  createSceneMachine, resolveTrack, nextBoundary, equalPower, equalPowerCurve, crossfadeSeconds, advancePosition, beatAt,
  intensityFrom, stepIntensity, createDropGate, SCENE_TRACK, SCENES, MIN_DWELL, type TrackInfo,
} from '../../src/audio/scene';
import { TRACK_DATA } from '../../src/audio/trackdata';

describe('scene machine', () => {
  it('escalates at once and debounces calm-downs', () => {
    const m = createSceneMachine();
    expect(m.request('map', 0)).toBe('map');
    expect(m.request('combat', 1)).toBe('combat');
    expect(m.request('boss', 1.1)).toBe('boss');
    // boss -> map within the dwell is held back...
    expect(m.request('map', 2)).toBe('boss');
    expect(m.update(1.1 + MIN_DWELL - 0.01)).toBe('boss');
    // ...and lands once the dwell has passed
    expect(m.update(1.1 + MIN_DWELL)).toBe('map');
  });

  it('death, title and victory are never delayed', () => {
    const m = createSceneMachine();
    m.request('combat', 0);
    expect(m.request('death', 0.1)).toBe('death');
    expect(m.request('title', 0.2)).toBe('title');
    m.request('boss', 0.3);
    expect(m.request('victory', 0.31)).toBe('victory');
  });

  it('a fight right after the title starts at once (title has no dwell)', () => {
    const m = createSceneMachine();
    m.request('title', 0);
    expect(m.request('map', 0.1)).toBe('map');
  });

  it('lets the victory fanfare play out, then hands over to the map', () => {
    const m = createSceneMachine();
    m.request('boss', 0); m.request('victory', 10);
    expect(m.request('map', 12)).toBe('victory');
    expect(m.update(100)).toBe('victory');
    expect(m.oneShotEnded('victory', 29)).toBe('map');
  });

  it('a new fight cuts the fanfare short', () => {
    const m = createSceneMachine();
    m.request('victory', 0);
    expect(m.request('combat', 3)).toBe('combat');
  });

  it('after the fanfare ends with nothing else asked, goes to the map', () => {
    const m = createSceneMachine();
    m.request('victory', 0);
    expect(m.oneShotEnded('victory', 19)).toBe('map');
  });

  it('leaves death for the title or a new run immediately', () => {
    const m = createSceneMachine();
    m.request('death', 0);
    expect(m.request('map', 0.5)).toBe('map');
  });
});

describe('tracks', () => {
  it('every scene with a track has track data, and loops are whole bars', () => {
    for (const s of SCENES) {
      const t = SCENE_TRACK[s];
      if (!t) continue;
      const d = TRACK_DATA[t];
      expect(d, t).toBeTruthy();
      if (d.loop) {
        const beats = (d.duration * d.bpm) / 60;
        expect(Math.abs(beats - d.bars * d.beatsPerBar), t).toBeLessThan(0.01);
      }
    }
  });

  it('falls back to a loaded stand-in, or silence', () => {
    expect(resolveTrack('boss', new Set(['boss']))).toBe('boss');
    expect(resolveTrack('boss', new Set(['combat']))).toBe('combat');
    expect(resolveTrack('combat', new Set(['map']))).toBe('map');
    expect(resolveTrack('title', new Set())).toBeNull();
    expect(resolveTrack('death', new Set(['title']))).toBeNull();
  });
});

describe('clock', () => {
  const t: TrackInfo = { file: 'x', loop: true, bpm: 120, beatsPerBar: 4, bars: 4, duration: 8 };

  it('waits for the next bar line', () => {
    expect(nextBoundary({ pos: 0.5, bpm: 120 }).wait).toBeCloseTo(1.5);
    expect(nextBoundary({ pos: 1.9, bpm: 120 }).wait).toBeCloseTo(0.1);
  });
  it('never schedules closer than minWait', () => {
    const nb = nextBoundary({ pos: 1.99, bpm: 120, minWait: 0.06 });
    expect(nb.wait).toBeGreaterThanOrEqual(0.06);
    expect(nb.wait).toBeCloseTo(2.01);
  });
  it('falls back to the next beat when a bar is too far (7/4 boss)', () => {
    const nb = nextBoundary({ pos: 0.1, bpm: 155, beatsPerBar: 7, maxWait: 1.6 });
    expect(nb.kind).toBe('beat');
    expect(nb.wait).toBeCloseTo(60 / 155 - 0.1, 3);
  });
  it('wraps loops and clamps one-shots', () => {
    expect(advancePosition({ pos: 7.5, loops: 0 }, 1, 1, 8, true)).toEqual({ pos: 0.5, loops: 1, ended: false });
    expect(advancePosition({ pos: 7.5, loops: 0 }, 1, 1, 8, false)).toEqual({ pos: 8, loops: 0, ended: true });
  });
  it('reads the beat', () => {
    const b = beatAt({ pos: 2.75, loops: 1 }, t);
    expect(b.index).toBe(16 + 5);
    expect(b.beatInBar).toBe(1);
    expect(b.phase).toBeCloseTo(0.5);
  });
});

describe('crossfades', () => {
  it('equal power keeps the summed power constant', () => {
    for (let k = 0; k <= 1; k += 0.1) { const [a, b] = equalPower(k); expect(a * a + b * b).toBeCloseTo(1); }
    const up = equalPowerCurve(16, true), down = equalPowerCurve(16, false);
    expect(up[0]).toBeCloseTo(0); expect(up[15]).toBeCloseTo(1); expect(down[0]).toBeCloseTo(1); expect(down[15]).toBeCloseTo(0);
  });
  it('crossfade length follows the tempo within bounds', () => {
    expect(crossfadeSeconds(120, true)).toBeCloseTo(1);
    expect(crossfadeSeconds(60, false)).toBe(2.4);
    expect(crossfadeSeconds(400, true)).toBe(0.6);
  });
});

describe('intensity and the carnage drop', () => {
  it('intensity grows with the fight and stays in 0..1', () => {
    const calm = intensityFrom({ enemies: 1 }), busy = intensityFrom({ enemies: 20, killsRecent: 12, boss: true, hullFrac: 0.2 });
    expect(calm).toBeLessThan(0.3); expect(busy).toBe(1);
  });
  it('rises fast and falls slowly', () => {
    expect(stepIntensity(0, 1, 0.6)).toBeGreaterThan(0.6);
    expect(stepIntensity(1, 0, 0.6)).toBeGreaterThan(0.8);
  });
  it('drops once for a streak, then cools down for 20 s', () => {
    const g = createDropGate({ threshold: 4, window: 3, cooldown: 20 });
    expect([0, 0.5, 1, 1.5].map((t) => g.kill(t))).toEqual([false, false, false, true]);
    expect([2, 2.2, 2.4, 2.6].map((t) => g.kill(t)).some(Boolean)).toBe(false);
    expect([22, 22.1, 22.2, 22.3].map((t) => g.kill(t))).toEqual([false, false, false, true]);
  });
  it('slow kills never trigger it', () => {
    const g = createDropGate({ threshold: 4, window: 3 });
    expect([0, 2, 4, 6, 8, 10].map((t) => g.kill(t)).some(Boolean)).toBe(false);
  });
});
