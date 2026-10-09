// Adaptive score: pure logic (no Web Audio, no DOM), unit-tested in tests/unit/audio-scene.test.ts.
//
// The game asks for a SCENE (title, map, combat, elite, boss, victory, death). The scene machine debounces requests and
// decides which TRACK should play; the music engine (music.ts) then crossfades to it on the playing track's next bar line.
// Every loop file holds a whole number of bars starting on a downbeat (scripts/audio/build-music.mjs), so the playback
// position divided by the beat length is the musical beat.

export type Scene = 'silent' | 'title' | 'map' | 'combat' | 'elite' | 'boss' | 'victory' | 'death';
export const SCENES: readonly Scene[] = ['silent', 'title', 'map', 'combat', 'elite', 'boss', 'victory', 'death'];

export interface TrackInfo { file: string; loop: boolean; bpm: number; beatsPerBar: number; bars: number; duration: number }

/** Which track each scene wants. `null` means no track (silence, or the death tape-stop). */
export const SCENE_TRACK: Record<Scene, string | null> = {
  silent: null, title: 'title', map: 'map', combat: 'combat', elite: 'elite', boss: 'boss', victory: 'victory', death: null,
};

/** Threat ordering: escalations are never debounced, calm-downs are. */
export const SCENE_RANK: Record<Scene, number> = { silent: 0, title: 0, map: 1, combat: 2, elite: 3, boss: 4, victory: 5, death: 6 };

/** When a scene's own track is not loaded (yet, or failed), the nearest sensible stand-in, in order. */
export const FALLBACKS: Record<string, string[]> = {
  title: ['map'], map: ['title'], combat: ['elite', 'boss', 'map'], elite: ['combat', 'boss'], boss: ['elite', 'combat'], victory: [],
};

/** One-shot tracks hand over to this scene when they end. */
export const AFTER_ONE_SHOT: Record<string, Scene> = { victory: 'map' };

/** The track to actually play for a scene: its own if loaded, else the first loaded fallback, else null. */
export function resolveTrack(scene: Scene, loaded: ReadonlySet<string>): string | null {
  const own = SCENE_TRACK[scene];
  if (!own) return null;
  if (loaded.has(own)) return own;
  for (const alt of FALLBACKS[own] ?? []) if (loaded.has(alt)) return alt;
  return null;
}

/** Load order: what the title needs first, then the run's screens in the order a player meets them. */
export const LOAD_ORDER = ['title', 'map', 'combat', 'elite', 'boss', 'victory'];

export const MIN_DWELL = 2.5;

/**
 * Debounced scene choice. Escalations (higher rank), death, victory and title land at once. A calm-down (boss -> map,
 * combat -> map) waits until the current scene has played at least `minDwell` seconds, so quickly clicking through
 * screens never makes the score stutter. `update(now)` returns the scene to play.
 */
export function createSceneMachine({ minDwell = MIN_DWELL } = {}) {
  let current: Scene = 'silent', since = -Infinity, wanted: Scene = 'silent';
  const immediate = (s: Scene) => s === 'death' || s === 'victory' || s === 'title' || s === 'silent';
  return {
    request(scene: Scene, now: number): Scene {
      wanted = scene;
      return this.update(now);
    },
    update(now: number): Scene {
      if (wanted === current) return current;
      // the victory fanfare plays out before the map theme returns; anything else (a new fight, death, title) cuts in
      if (current === 'victory' && wanted === AFTER_ONE_SHOT.victory) return current;
      const up = SCENE_RANK[wanted] > SCENE_RANK[current] || current === 'death' || current === 'victory';
      if (immediate(wanted) || up || now - since >= minDwell) { current = wanted; since = now; }
      return current;
    },
    /** A one-shot track ended: move on (victory -> map) unless something else was asked for meanwhile. */
    oneShotEnded(track: string, now: number): Scene {
      const next = AFTER_ONE_SHOT[track];
      if (next && (wanted === current || wanted === next)) { wanted = next; current = next; since = now; }
      return current;
    },
    get scene() { return current; },
    get wanted() { return wanted; },
  };
}
export type SceneMachine = ReturnType<typeof createSceneMachine>;

/* ---------------------------------------------------------------- the clock */

/** Advance a playback position (seconds of audio) by dt real seconds at a tape rate. Loops wrap; one-shots clamp. */
export function advancePosition(p: { pos: number; loops: number }, dt: number, rate: number, duration: number, loop: boolean) {
  let pos = p.pos + Math.max(0, dt) * Math.max(0, rate), loops = p.loops;
  if (duration <= 0) return { pos: 0, loops: 0, ended: true };
  if (loop) { while (pos >= duration) { pos -= duration; loops++; } return { pos, loops, ended: false }; }
  return pos >= duration ? { pos: duration, loops, ended: true } : { pos, loops, ended: false };
}

/** The beat being heard: monotonic whole-beat index, phase 0..1, bar index and beat within the bar. */
export function beatAt(p: { pos: number; loops: number }, t: TrackInfo) {
  const beatLen = 60 / t.bpm, perLoop = t.bars * t.beatsPerBar;
  const beats = p.pos / beatLen + (t.loop ? p.loops * perLoop : 0), index = Math.floor(beats + 1e-9);
  return { index, phase: Math.max(0, beats - index), bar: Math.floor(index / t.beatsPerBar), beatInBar: ((index % t.beatsPerBar) + t.beatsPerBar) % t.beatsPerBar, bpm: t.bpm };
}

/**
 * Real seconds until the next bar line of a track at `pos`. If the bar line is further than maxWait away, fall back to the
 * next beat so a change is never sluggish (a 7/4 bar at 155 bpm is 2.7 s). Always at least minWait away, so the change
 * can be scheduled ahead on the audio clock.
 */
export function nextBoundary({ pos, bpm, beatsPerBar = 4, rate = 1, maxWait = 2.4, minWait = 0.06 }: { pos: number; bpm: number; beatsPerBar?: number; rate?: number; maxWait?: number; minWait?: number }) {
  const beatLen = 60 / bpm, r = Math.max(0.05, rate), beats = pos / beatLen;
  const toBar = (beatsPerBar - (beats % beatsPerBar)) % beatsPerBar, toBeat = (1 - (beats % 1)) % 1;
  let wait = (toBar * beatLen) / r, kind: 'bar' | 'beat' = 'bar';
  if (wait < minWait) wait += (beatsPerBar * beatLen) / r;
  if (wait > maxWait) { kind = 'beat'; wait = (toBeat * beatLen) / r; if (wait < minWait) wait += beatLen / r; }
  return { wait, kind };
}

/** Crossfade length for a change into a track: about two beats of the incoming tempo, 0.6..2.4 s. */
export const crossfadeSeconds = (bpm: number, up: boolean) => Math.max(0.6, Math.min(2.4, ((60 / bpm) * (up ? 2 : 4))));

/** Equal-power crossfade gains at progress k (0..1): [outgoing, incoming]; their squares always sum to 1. */
export function equalPower(k: number): [number, number] {
  const x = Math.max(0, Math.min(1, k));
  return [Math.cos((x * Math.PI) / 2), Math.sin((x * Math.PI) / 2)];
}
/** Sampled equal-power curves for AudioParam.setValueCurveAtTime. */
export function equalPowerCurve(n: number, rising: boolean, scale = 1): Float32Array {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = equalPower(i / (n - 1))[rising ? 1 : 0] * scale;
  return c;
}

/* ---------------------------------------------------------------- intensity and stings */

/** Combat intensity 0..1 from what is on screen: enemies alive, recent kills, boss/elite presence and hull damage. */
export function intensityFrom({ enemies = 0, killsRecent = 0, boss = false, elite = false, hullFrac = 1 }: { enemies?: number; killsRecent?: number; boss?: boolean; elite?: boolean; hullFrac?: number }) {
  const v = 0.12 + Math.min(1, enemies / 14) * 0.45 + Math.min(1, killsRecent / 10) * 0.35 + (boss || elite ? 0.25 : 0) + (hullFrac < 0.35 ? 0.15 : 0);
  return Math.max(0, Math.min(1, v));
}

/** Smooth toward a target: rises quickly (0.6 s), falls slowly (4 s), so the drums don't flicker between waves. */
export function stepIntensity(cur: number, target: number, dt: number) {
  const tau = target > cur ? 0.6 : 4;
  return cur + (target - cur) * (1 - Math.exp(-Math.max(0, dt) / tau));
}

/**
 * Carnage drop (tinwar's bass drop on a streak): at most once per `cooldown` seconds, when `threshold` kills land within
 * `window` seconds. Returns true on the frame the drop should fire.
 */
export function createDropGate({ threshold = 8, window = 3, cooldown = 20 } = {}) {
  const kills: number[] = []; let last = -Infinity;
  return {
    kill(now: number): boolean {
      kills.push(now);
      while (kills.length && now - kills[0] > window) kills.shift();
      if (kills.length >= threshold && now - last >= cooldown) { last = now; kills.length = 0; return true; }
      return false;
    },
    recent(now: number) { while (kills.length && now - kills[0] > window) kills.shift(); return kills.length; },
    reset() { kills.length = 0; last = -Infinity; },
  };
}

/** Music duck under a sting: level, attack and release seconds. Big stings duck deeper. */
export const STING_DUCK = { level: 0.45, attack: 0.04, hold: 0.6, release: 0.9 };
