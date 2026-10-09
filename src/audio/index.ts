// Public audio API. Everything the game calls lives here; see "Audio API" in docs/TECH.md.
//
//   initAudio()                    unlock on a user gesture (also done automatically on the first pointer/key press)
//   sfx(name, opts?)               one-shot cue (cues.ts), positioned by {x, y, ground|layer, size, vol, pitch}
//   music.setScene(scene)          'title' | 'map' | 'combat' | 'elite' | 'boss' | 'victory' | 'death' | 'silent'
//   music.sting(kind)              'eliteKill' | 'bossPhase2' | 'clear' | 'sectorClear' | 'carnage'
//   setShipThrottle(0..1)          engine drone; derived from ship motion when not set
//   updateAudio(dt, combat, paused) once per frame from the main loop: watches the fight and drives everything adaptive
//   audioSettings / setVolume / getVolume / setMuted   persisted master, music and sfx volumes

import { activeVoices, duck, ensureContext, getSettings, loadBuffer, nowMs, now, onSettingsChange, running, rt, setSettings } from './core';
import { CUES, ALIASES, LEVEL_DB, type CueOpts } from './cues';
import { createAdmission, type AudioSettings } from './mix';
import { MusicEngine, type StingKind } from './music';
import { createDropGate, intensityFrom, type Scene } from './scene';
import { initShip, setEngineOn, setShipThrottle as shipThrottleSet, setHullIntegrity, updateShip, shipThrottle } from './ship';
import { addDestruction, chatter, cutChatter, initAmbience, isChattering, setCombatAmbience, setWind, updateAmbience } from './ambience';

export type { CueOpts } from './cues';
export type { Scene } from './scene';
export type { StingKind } from './music';
export type { AudioSettings } from './mix';

/* ---------------------------------------------------------------- lifecycle */

let engine: MusicEngine | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let desiredScene: Scene = 'silent';
const admission = createAdmission();

/** Every sampled layer the cues use; fetched once after the first gesture (synthesis covers them until then). */
export const SFX_SAMPLES = [
  'boom_mech', 'boom_chunky', 'boom_crunch1', 'boom_crunch2', 'boom_crunch3', 'boom_low1', 'boom_low2', 'boom_far', 'boom_a', 'boom_b', 'boom_c', 'boom_d',
  'cannon', 'lance', 'railburst', 'thruster', 'laser', 'shield', 'hull1', 'hull2', 'hull3', 'bell',
  'ui_relay', 'ui_switch', 'ui_toggle', 'ui_tick', 'ui_confirm', 'ui_error', 'ui_open', 'ui_close',
];

/** Unlock and build everything. Call from a user gesture; cheap to call again. */
export function initAudio() {
  const r = ensureContext();
  if (!r || engine) return;
  try {
    initShip(); initAmbience();
    engine = new MusicEngine(r);
    engine.setScene(desiredScene);
    for (const id of SFX_SAMPLES) loadBuffer(`sfx/${id}.mp3`);
    engine.load().catch(() => {});
    timer = setInterval(() => { try { engine?.tick(); } catch { /* music must never break the game */ } }, 40);
  } catch { /* audio must never break the game */ }
}

if (typeof window !== 'undefined') {
  const unlock = () => initAudio();
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, unlock, { capture: true, passive: true });
}

/* ---------------------------------------------------------------- settings */

/** Kept for existing callers: `audio.on` is false when muted. */
export const audio = { get on() { return !getSettings().muted; } };
export function setMuted(m: boolean) { setSettings({ muted: m }); }
export const isMuted = () => getSettings().muted;
export type VolumeKind = 'master' | 'music' | 'sfx';
export const getVolume = (k: VolumeKind) => getSettings()[k];
export function setVolume(k: VolumeKind, v: number) { setSettings({ [k]: v } as Partial<AudioSettings>); }
/** Settings for the options UI: values 0..1, persisted in localStorage ('gd.audio.v1'), applied at once. */
export const audioSettings = { get: getSettings, set: setSettings, onChange: onSettingsChange };

/* ---------------------------------------------------------------- one-shots */

/** Play a cue by name. Unknown names are ignored; nothing plays before the first user gesture. */
export function sfx(name: string, opts?: CueOpts) {
  try {
    const key = ALIASES[name] ?? name, cue = CUES[key];
    if (!cue || !running()) return;
    if (!admission.admit(key, nowMs(), cue, activeVoices())) return;
    const o = opts ?? {}, trim = LEVEL_DB[key];
    cue.play(trim ? { ...o, vol: (o.vol ?? 1) * Math.pow(10, trim / 20) } : o);
    // the city remembers: ground blasts feed the fires and the alarms
    if (key === 'groundBoom') addDestruction(0.06);
    else if (key === 'collapse') addDestruction(0.2);
    else if (key === 'boom' && (o.ground || o.layer === 'ground')) addDestruction(0.04);
  } catch { /* audio must never break the game */ }
}

/* ---------------------------------------------------------------- music */

export const music = {
  setScene(scene: Scene) { desiredScene = scene; try { engine?.setScene(scene); } catch { /* ignore */ } },
  sting(kind: StingKind) { try { engine?.sting(kind); } catch { /* ignore */ } },
  setIntensity(v: number) { engine?.setIntensity(v); },
  setPaused(p: boolean) { engine?.setPaused(p); },
  /** The beat audible now ({index, phase, bar, beatInBar, bpm}) or null: lock visual pulses to it. */
  beat() { return engine?.beat() ?? null; },
  get scene(): Scene { return engine?.scene ?? desiredScene; },
  snapshot() { return engine?.snapshot() ?? null; },
};

export const setShipThrottle = shipThrottleSet;
export { setHullIntegrity, chatter, cutChatter };

/* ---------------------------------------------------------------- the per-frame watcher */

/** The parts of the combat state the audio reads (structural, so combat.ts needs no audio imports). */
export interface CombatView {
  active: boolean; mode: string; t: number; kills: number;
  P: { x: number; y: number; hp: number; dv: { maxHp: number; speed: number } } | null;
  enemies: readonly { x: number; y: number; dead: boolean; type: string; layer: string; hp: number }[];
  boss: { phase: number; alive: boolean } | null;
  elite: { dead: boolean; hp: number } | null;
}

const seen = new WeakSet<object>();
const stung = new WeakSet<object>();
const talkers = new Set<CombatView['enemies'][number]>();
const drop = createDropGate();
let last: { x: number; y: number; kills: number; mode: string; bossPhase: number; inFight: boolean; paused: boolean } = { x: 0, y: 0, kills: 0, mode: '', bossPhase: 0, inFight: false, paused: false };
let chatterT = 3;

/** Once per frame. `combat` is the live combat state while a fight is on screen, else null. */
export function updateAudio(dt: number, combat: CombatView | null, paused = false) {
  if (!rt()) return;
  try {
    const fight = !!combat && combat.active && !!combat.P;
    if (fight !== last.inFight) {
      setEngineOn(fight); setCombatAmbience(fight); setWind(fight ? 1 : 0.5);
      if (fight) { drop.reset(); last.kills = combat!.kills; last.bossPhase = combat!.boss?.phase ?? 0; last.mode = combat!.mode; last.x = combat!.P!.x; last.y = combat!.P!.y; talkers.clear(); chatterT = 3; }
      last.inFight = fight;
    }
    if (paused !== last.paused) { last.paused = paused; engine?.setPaused(paused); const r = rt(); if (r) { r.ambDuck.gain.setTargetAtTime(paused ? 0.25 : 1, r.ctx.currentTime, 0.15); r.sfxDuck.gain.setTargetAtTime(paused ? 0.5 : 1, r.ctx.currentTime, 0.15); } }
    let derived: number | null = null;
    if (fight && combat && combat.P && !paused) {
      const P = combat.P;
      // throttle: the ship always makes way (0.3), and opens up as it is steered
      const v = dt > 0 ? Math.hypot(P.x - last.x, P.y - last.y) / dt / Math.max(1, P.dv.speed) : 0;
      derived = 0.3 + 0.7 * Math.min(1, v);
      last.x = P.x; last.y = P.y;
      const hull = P.hp / Math.max(1, P.dv.maxHp);
      setHullIntegrity(hull); engine?.setLowHull(hull < 0.25 && combat.mode === 'play');
      // fight beats
      if (combat.boss && combat.boss.phase !== last.bossPhase) { if (combat.boss.phase === 2) music.sting('bossPhase2'); last.bossPhase = combat.boss.phase; }
      if (combat.elite && !stung.has(combat.elite) && (combat.elite.dead || combat.elite.hp <= 0)) { stung.add(combat.elite); music.sting('eliteKill'); }
      const t = now();
      for (let k = last.kills; k < combat.kills; k++) if (drop.kill(t)) music.sting('carnage');
      last.kills = combat.kills;
      if (combat.mode !== last.mode) {
        if (combat.mode === 'clear') music.sting('clear');
        if (combat.mode === 'bossdown') music.setScene('victory');
        if (combat.mode === 'dying') { music.setScene('death'); duck('amb', 0.2, 0.05, 2.5, 2); }
        last.mode = combat.mode;
      }
      const alive = combat.enemies.filter((e) => !e.dead);
      music.setIntensity(intensityFrom({ enemies: alive.length, killsRecent: drop.recent(t), boss: !!combat.boss?.alive, elite: !!combat.elite && !combat.elite.dead, hullFrac: hull }));
      // newcomers: jets announce themselves with a fly-by
      for (const e of alive) if (!seen.has(e)) { seen.add(e); if (e.type === 'jet' && e.y < 300) sfx('jet', { x: e.x, layer: 'air' }); }
      // enemy radio: someone keys up every few seconds; dying mid-sentence cuts them off
      chatterT -= dt;
      if (chatterT <= 0 && alive.length && combat.mode === 'play') {
        chatterT = 3.5 + Math.random() * 5;
        const e = alive[Math.floor(Math.random() * alive.length)];
        if (e.type !== 'infantry' && e.type !== 'cache' && e.type !== 'wreck' && e.type !== 'canister') { chatter(e, e.x); talkers.add(e); }
      }
      for (const e of talkers) { if (e.dead) { cutChatter(e, e.x); talkers.delete(e); } else if (!isChattering(e)) talkers.delete(e); }
    }
    updateShip(dt, derived);
    updateAmbience(dt, shipThrottle());
  } catch { /* audio must never break the game */ }
}

/** Forget throttle history (the audio lab restarts its clock at 0 for every render). */
export function resetAdmission() { admission.reset(); }

/* ---------------------------------------------------------------- debug */

if (typeof window !== 'undefined') {
  (window as unknown as { __gdAudio: unknown }).__gdAudio = {
    get music() { return engine?.snapshot() ?? null; },
    get voices() { return activeVoices(); },
    get settings() { return getSettings(); },
    get running() { return running(); },
    sfx, setScene: (s: Scene) => music.setScene(s), sting: (k: StingKind) => music.sting(k),
    history: () => engine?.history ?? [],
  };
}

