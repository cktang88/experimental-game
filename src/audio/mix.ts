// Mix decisions as pure functions (unit-tested): where a sound sits in the stereo field, how far away it is, whether it
// may play at all (throttle, voice budget, priority), and the persisted volume settings.

import { FIELD_W } from '../game/field';

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/* ---------------------------------------------------------------- placement */

/**
 * Where a sound comes from:
 * - 'ship': our own guns and hull. Close, full bandwidth, narrow stereo (the ship is huge and under the listener).
 * - 'air': aircraft and flak at our altitude. Close, full bandwidth, panned by field x.
 * - 'ground': the city far below. Dull (low-passed), quieter, wetter, and a few tens of ms late: the sound has a long
 *   way to climb. Things further up the screen (ahead of the ship) are a little further away still.
 * - 'ui': the bridge's own equipment. Centred, dry, never coloured.
 */
export type Layer = 'ship' | 'air' | 'ground' | 'ui';
export interface Place { x?: number; y?: number; layer?: Layer; ground?: boolean }
export interface Placement { pan: number; gain: number; cutoff: number; delay: number; wet: number }

/** Field x (0..FIELD_W) -> stereo pan, scaled by `width` (0..1). */
export function panFromX(x: number | undefined, width = 0.85): number {
  if (x === undefined || !Number.isFinite(x)) return 0;
  return clamp(((x / FIELD_W) * 2 - 1) * width, -1, 1);
}

export function placement(p: Place = {}): Placement {
  const layer: Layer = p.layer ?? (p.ground ? 'ground' : p.x === undefined ? 'ui' : 'air');
  switch (layer) {
    case 'ui': return { pan: 0, gain: 1, cutoff: 20000, delay: 0, wet: 0 };
    case 'ship': return { pan: panFromX(p.x, 0.45), gain: 1, cutoff: 20000, delay: 0, wet: 0.12 };
    case 'air': return { pan: panFromX(p.x, 0.85), gain: 0.9, cutoff: 16000, delay: 0, wet: 0.18 };
    case 'ground': {
      // 0 at the bottom of the field (under the ship's stern) to 1 at the top (far ahead)
      const ahead = p.y === undefined ? 0.5 : clamp(1 - p.y / 900, 0, 1);
      return { pan: panFromX(p.x, 0.7), gain: 0.78 - 0.18 * ahead, cutoff: 2600 * Math.pow(0.45, ahead), delay: 0.045 + 0.06 * ahead, wet: 0.42 + 0.2 * ahead };
    }
  }
}

/* ---------------------------------------------------------------- admission */

/** 0 ambience/chatter, 1 enemy fire and small stuff, 2 our weapons and kills, 3 alarms, hull hits, UI, boss events. */
export type Priority = 0 | 1 | 2 | 3;
/** Voices (oscillators and buffer sources) allowed before a cue of each priority is dropped. Dead Air ran 48 total. */
export const VOICE_CAPS: Record<Priority, number> = { 0: 30, 1: 44, 2: 60, 3: 80 };

/**
 * Per-cue admission: a minimum gap between plays of the same cue and a burst cap (no more than `burst` plays within
 * `window` ms), then the voice budget for the cue's priority. Pure, time is passed in.
 */
export function createAdmission() {
  const last = new Map<string, number>();
  const bursts = new Map<string, number[]>();
  return {
    admit(name: string, now: number, { gap = 0, burst = 0, window = 250, cost = 1, priority = 1 as Priority }, voices: number): boolean {
      if (gap > 0 && now - (last.get(name) ?? -Infinity) < gap) return false;
      if (burst > 0) {
        const b = bursts.get(name) ?? [];
        while (b.length && now - b[0] > window) b.shift();
        if (b.length >= burst) return false;
        b.push(now); bursts.set(name, b);
      }
      if (voices + cost > VOICE_CAPS[priority]) return false;
      last.set(name, now);
      return true;
    },
    reset() { last.clear(); bursts.clear(); },
  };
}

/* ---------------------------------------------------------------- settings */

export interface AudioSettings { master: number; music: number; sfx: number; muted: boolean }
export const SETTINGS_KEY = 'gd.audio.v1';
export const DEFAULT_SETTINGS: AudioSettings = { master: 0.8, music: 0.7, sfx: 0.9, muted: false };

const unit = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, 0, 1) : d);
export function parseSettings(raw: string | null, legacyMute: string | null = null): AudioSettings {
  const base = { ...DEFAULT_SETTINGS, muted: legacyMute === '1' };
  if (!raw) return base;
  try {
    const s = JSON.parse(raw);
    return { master: unit(s.master, base.master), music: unit(s.music, base.music), sfx: unit(s.sfx, base.sfx), muted: typeof s.muted === 'boolean' ? s.muted : base.muted };
  } catch { return base; }
}
export const serializeSettings = (s: AudioSettings) => JSON.stringify({ master: s.master, music: s.music, sfx: s.sfx, muted: s.muted });

/** Slider (0..1) -> gain. A perceptual curve so the middle of a slider sounds like half as loud, not a whisper. */
export const sliderGain = (v: number) => (v <= 0 ? 0 : Math.pow(clamp(v, 0, 1), 1.7));
