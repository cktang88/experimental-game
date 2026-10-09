// Public audio API. Everything the game calls lives here; see "Audio API" in docs/TECH.md.
//
//   initAudio()                    unlock on a user gesture (also done automatically on the first pointer/key press)
//   sfx(name, opts?)               one-shot cue (cues.ts), positioned by {x, y, ground|layer, size, vol, pitch}
//   music.setScene(scene)          'title' | 'map' | 'combat' | 'elite' | 'boss' | 'victory' | 'death' | 'silent'
//   music.sting(kind)              'eliteKill' | 'bossPhase2' | 'clear' | 'sectorClear' | 'carnage'
//   setShipThrottle(0..1)          engine drone; derived from ship motion when not set
//   updateAudio(dt, combat, paused) once per frame from the main loop: watches the fight and drives everything adaptive
//   audioSettings / setVolume / getVolume / setMuted   persisted master, music and sfx volumes

import { activeVoices, duck, muffle, setSlowFx, ensureContext, getSettings, loadBuffer, nowMs, now, onSettingsChange, running, rt, setSettings } from './core';
import { CUES, ALIASES, LEVEL_DB, type CueOpts } from './cues';
import { EN } from '../data/enemies';
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
    if (volleyMuted(key, opts?.layer)) return;
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

/** One sim event (combat.ts GameEvent), read structurally. */
export interface AudioEvent { id: number; type: string; x: number; y: number; side?: number; n?: number; kind?: string }

/** The parts of the combat state the audio reads (structural, so combat.ts needs no audio types). */
export interface CombatView {
  active: boolean; mode: string; t: number; kills: number;
  P: { x: number; y: number; hp: number; dv: { maxHp: number; speed: number } } | null;
  enemies: readonly { x: number; y: number; dead: boolean; type: string; layer: string; hp: number }[];
  boss: { phase: number; alive: boolean } | null;
  elite: { dead: boolean; hp: number } | null;
  events?: readonly AudioEvent[]; eventId?: number;
  overdrive?: { active: boolean; kind: string; dur: number };
  slowFx?: number;
  stop?: { left: number; since: number; total: number };
}

const seen = new WeakSet<object>();
const talkers = new Set<CombatView['enemies'][number]>();
const drop = createDropGate();
const last = { x: 0, y: 0, kills: 0, mode: '', bossPhase: 0, inFight: false, paused: false, eventId: 0, stopTotal: 0, slowFx: 0 };
let chatterT = 3;
/** Ship-layer gun cues are folded into a broadside's own sound while its ripple plays. */
let volleyUntil = -1;
const VOLLEY_MUTED = new Set(['pew', 'spread', 'cannon', 'flak', 'mortar']);
export const volleyMuted = (name: string, layer?: string) => VOLLEY_MUTED.has(name) && layer === 'ship' && now() < volleyUntil;

/** Enemy type -> explosion size and layer, from the enemy table. */
function killSound(e: AudioEvent) {
  const d = EN[e.kind as keyof typeof EN];
  const ground = d?.layer === 'ground', r = d?.r ?? 12;
  if (e.kind === 'infantry') { sfx('eshot', { x: e.x, y: e.y, ground: true, vol: 0.6 }); return; }
  sfx('boom', { x: e.x, y: e.y, ground, size: r * (r > 15 ? 1.3 : 1) });
}

function handleEvent(e: AudioEvent, od: CombatView['overdrive']) {
  switch (e.type) {
    case 'broadside': {
      const rounds = Number(e.kind) || (e.n ?? 1) * 2;
      sfx('broadside', { x: e.x, y: e.y, size: rounds, vol: Math.min(1.25, 0.8 + 0.1 * (e.n ?? 1)) });
      volleyUntil = now() + rounds * 0.035 + 0.15;
      break;
    }
    case 'kill': killSound(e); break;
    case 'eliteKill': sfx('big', { x: e.x, y: e.y }); music.sting('eliteKill'); break;
    case 'bossDown': sfx('bossDown', { x: e.x, y: e.y }); break;
    case 'structure': sfx('collapse', { x: e.x, y: e.y }); break;
    case 'carnageTier': sfx('carnageTier', { size: e.n }); if ((e.n ?? 0) >= 3) music.sting('carnage'); break;
    case 'overdrive': sfx(`od_${e.kind ?? 'lance'}`, { x: e.x, layer: 'ship', size: od?.dur }); break;
    case 'overdriveReady': sfx('odReady'); break;
    case 'overdriveEnd': sfx('odEnd', { x: e.x, layer: 'ship' }); break;
    case 'playerHit': if ((e.n ?? 0) > 25) { muffle(0.4, 0.5); duck('music', 0.6, 0.01, 0.2, 0.6); } break;
  }
}

/** Once per frame. `combat` is the live combat state while a fight is on screen, else null. */
export function updateAudio(dt: number, combat: CombatView | null, paused = false) {
  if (!rt()) return;
  try {
    const fight = !!combat && combat.active && !!combat.P;
    if (fight !== last.inFight) {
      setEngineOn(fight); setCombatAmbience(fight); setWind(fight ? 1 : 0.5);
      if (fight) {
        const c = combat!;
        drop.reset(); last.kills = c.kills; last.bossPhase = c.boss?.phase ?? 0; last.mode = c.mode; last.x = c.P!.x; last.y = c.P!.y;
        last.eventId = c.eventId ?? 0; talkers.clear(); chatterT = 3;
      }
      if (!fight) setSlowFx(0);
      last.inFight = fight;
    }
    if (paused !== last.paused) { last.paused = paused; engine?.setPaused(paused); const r = rt(); if (r) { r.ambDuck.gain.setTargetAtTime(paused ? 0.25 : 1, r.ctx.currentTime, 0.15); r.sfxDuck.gain.setTargetAtTime(paused ? 0.5 : 1, r.ctx.currentTime, 0.15); } }
    let derived: number | null = null;
    if (fight && combat && combat.P && !paused) {
      const P = combat.P, t = now();
      // throttle: the ship always makes way (0.3), and opens up as it is steered
      const v = dt > 0 ? Math.hypot(P.x - last.x, P.y - last.y) / dt / Math.max(1, P.dv.speed) : 0;
      derived = 0.3 + 0.7 * Math.min(1, v);
      last.x = P.x; last.y = P.y;
      const hull = P.hp / Math.max(1, P.dv.maxHp);
      setHullIntegrity(hull); engine?.setLowHull(hull < 0.25 && combat.mode === 'play');
      // the sim's event queue: volleys, kills, structures, Overdrive, carnage tiers (ids are monotonic, nothing is lost
      // when the sim steps several times per frame)
      if (combat.events && combat.eventId !== undefined) {
        if (combat.eventId < last.eventId) last.eventId = 0;
        for (const e of combat.events) if (e.id > last.eventId) handleEvent(e, combat.overdrive);
        last.eventId = combat.eventId;
      }
      // slow-mo: the world sinks behind a low-pass; a heavy hitstop lands as a breath of silence before the blast
      const sf = combat.slowFx ?? 0;
      if (Math.abs(sf - last.slowFx) > 0.01) { setSlowFx(sf); last.slowFx = sf; }
      const st = combat.stop;
      if (st && st.left > 0 && st.total >= 0.09 && st.total !== last.stopTotal) duck('sfx', 0.55, 0.005, st.total, 0.25);
      last.stopTotal = st && st.left > 0 ? st.total : 0;
      if (combat.boss && combat.boss.phase !== last.bossPhase) { if (combat.boss.phase === 2) music.sting('bossPhase2'); last.bossPhase = combat.boss.phase; }
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

