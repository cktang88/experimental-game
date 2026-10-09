// The shmup itself: one combat encounter on a 480x800 field.
import { clamp, rnd, pick, has, angDiff } from '../util/rng';
import {
  WEAPONS, derive, wCd, wDmg, type Build, type Derived, type Part, type Mods, ghostToBuild,
} from '../data/parts';
import { EN, type EnemyType, type Encounter } from '../data/enemies';
import { hasFlag } from '../data/relics';
import { V, boomFx, spark, muzzle, addFx, updateFx, resetFx } from './vfx';
import { sfx } from './audio';
import type { Ghost } from './ghosts';

import { FIELD_W, FIELD_H } from './field';
export const W = FIELD_W, H = FIELD_H;

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Ent { [k: string]: any; x: number; y: number; r: number; dead: boolean }
export interface Enemy extends Ent { type: EnemyType; layer: 'air' | 'ground'; hp: number; maxHp: number; t: number; cd: number; flash: number; ang: number }
export interface Player {
  x: number; y: number; build: Build; dv: Derived; hp: number; shield: number; cds: Record<number, number>;
  lastHit: number; flash: number; tx: number | null; ty: number | null; droneCd: number[];
}
export interface Boss extends Ent {
  ghost: Ghost; build: Build; dv: Derived; s: number; homeY: number; halfW: number; layer: 'both'; isBoss: true; alive: boolean;
  hp: number; maxHp: number; shield: number; shieldMax: number; shieldHitT: number; regen: number; tractor: number; droneEvery: number; droneT: number;
  speedMul: number; fireMul: number; cdMul: number; t: number; phase: number; flash: number; entered: boolean;
  weps: { part: Part; ox: number; oy: number; cd: number }[];
}
export type { Decor } from './worldgen';
import type { Decor } from './worldgen';
export interface Pickup { x: number; y: number; vx: number; vy: number; val: number; t: number; kind: 'scrap' | 'repair'; dead?: boolean }
export interface Beam { x1: number; y1: number; x2: number; y2: number; col: string; life: number; max: number; w: number; zig?: boolean }

export interface CombatSetup {
  enc: Encounter; level: number; sector: number; build: Build; hp: number; relics: string[]; mods: Mods;
  ghost?: Ghost; cheatDeathAvailable: boolean;
}
export type CombatMode = 'play' | 'clear' | 'bossdown' | 'dying' | 'done';

export const S = {
  active: false, mode: 'play' as CombatMode, outcome: null as null | 'win' | 'dead',
  enc: null as Encounter | null, level: 1, sector: 1, relics: [] as string[],
  t: 0, time: 0, scroll: 62, scrollY: 0, budget: 0, spawnCd: 0, endT: 0, chain: 0, escortT: 0, salvageT: 0, salvageLeft: 0, slow: 0,
  banner: null as null | { text: string; sub: string; t: number; max: number; col: string },
  P: null as Player | null, boss: null as Boss | null, elite: null as Enemy | null,
  enemies: [] as Enemy[], pb: [] as Ent[], eb: [] as Ent[], pickups: [] as Pickup[], beams: [] as Beam[], decor: [] as Decor[], clouds: [] as { x: number; y: number; w: number; h: number }[],
  god: false, scrap: 0, kills: 0, score: 0, firstHitUsed: false, cheatDeath: false, cheatDeathUsed: false, theme: 0,
};
export const keys: Record<string, boolean> = {};
/** Weapon uid -> S.t of its last shot (player and boss). Read by the ship renderer for recoil. */
export const fireLog = new Map<number, number>();

const hpMult = () => 1 + 0.3 * (S.level - 1);
const bspd = () => Math.min(320, 165 * (1 + 0.035 * (S.level - 1)));
const edmg = () => 6 * (1 + 0.14 * (S.level - 1));
const aimAng = (x: number, y: number) => Math.atan2(S.P!.y - y, S.P!.x - x);
export const setBanner = (text: string, sub: string, t: number, col = '#f2a541') => { S.banner = { text, sub, t, max: t, col }; };

/* ---------------- setup ---------------- */
export function startCombat(c: CombatSetup) {
  resetFx();
  const dv = derive(c.build, c.mods);
  Object.assign(S, {
    active: true, mode: 'play', outcome: null, enc: c.enc, level: c.level, sector: c.sector, relics: c.relics,
    t: 0, time: 0, budget: 2, spawnCd: 1.2, endT: 0, chain: 0, escortT: 8, slow: 0,
    salvageLeft: c.enc.salvage, salvageT: 3, banner: null, boss: null, elite: null,
    enemies: [], pb: [], eb: [], pickups: [], beams: [], scrap: 0, kills: 0, score: 0,
    firstHitUsed: false, cheatDeath: c.cheatDeathAvailable && hasFlag(c.relics, 'cheat_death'), cheatDeathUsed: false,
    theme: (c.sector - 1) % 5,
  });
  S.P = { x: W / 2, y: H - 150, build: c.build, dv, hp: Math.min(c.hp, dv.maxHp), shield: dv.shieldMax, cds: {}, lastHit: 9, flash: 0, tx: null, ty: null, droneCd: [0, 0, 0] };
  seedDecor();
  if (c.enc.kind === 'boss' && c.ghost) {
    spawnBoss(c.ghost);
    const g = c.ghost;
    setBanner(g.ai ? 'DEFENSE CORE' : 'GHOST DREADNOUGHT', g.ai ? g.name : `${g.name} · fell in sector ${g.sector}`, 3.2, '#ff5a4e');
    sfx('alarm');
  } else if (c.enc.kind === 'elite') {
    setBanner('ELITE CONTACT', c.enc.name, 2.6, '#ff5a4e'); sfx('alarm');
    setTimeout(() => { if (S.active && S.mode === 'play') spawnElite(c.enc.elite!); }, 2200);
  } else {
    setBanner(c.enc.name.toUpperCase(), `Sector ${c.sector}`, 2.2);
  }
}

/* ---------------- world ---------------- */
// World generation (city, roads, clouds) lives in ./worldgen; re-exported for existing callers.
export { seedDecor, updateBg } from './worldgen';
import { seedDecor, updateBg, worldBlast } from './worldgen';

/* ---------------- spawning ---------------- */
function spawnEnemy(type: EnemyType, x: number, y: number, o: Record<string, any> = {}): Enemy {
  const d = EN[type];
  const hp = d.salvage ? d.hp : d.hp * hpMult() * (d.elite ? 0.7 + 0.3 * S.sector : 1);
  const e: Enemy = { type, layer: d.layer, x, y, r: d.r, hp, maxHp: hp, t: 0, cd: rnd(0.8, 2.2), flash: 0, dead: false, ang: Math.PI / 2, ...o };
  S.enemies.push(e); return e;
}
function director(dt: number) {
  const enc = S.enc!;
  if (S.time > enc.duration && enc.kind === 'fight') return;
  S.budget += dt * (1.5 + 0.32 * (S.level - 1)) * enc.rate;
  S.spawnCd -= dt; if (S.spawnCd > 0) return;
  const opts = (Object.keys(enc.weights) as EnemyType[]).filter((k) => (EN[k].min || 1) <= S.level + 1 && EN[k].cost <= S.budget);
  if (!opts.length) return;
  let total = 0; for (const k of opts) total += enc.weights[k]!;
  let r = Math.random() * total, k = opts[0];
  for (const o of opts) { r -= enc.weights[o]!; if (r <= 0) { k = o; break; } }
  S.budget -= EN[k].cost; spawnGroup(k);
  S.spawnCd = rnd(0.3, 1.0) / (1 + 0.05 * S.level);
}
function spawnSalvage(dt: number) {
  if (S.salvageLeft <= 0) return;
  S.salvageT -= dt; if (S.salvageT > 0) return;
  S.salvageLeft--; S.salvageT = rnd(5, 9);
  const r = Math.random();
  if (r < 0.45) spawnEnemy('cache', rnd(40, W - 40), -24);
  else if (r < 0.7) spawnEnemy('wreck', rnd(50, W - 50), -30, { ang: rnd(0, 6.28) });
  else spawnEnemy('canister', rnd(60, W - 60), -20, { baseX: 0, phase: rnd(0, 6) });
}
function spawnGroup(k: EnemyType) {
  const P = S.P!, x = rnd(40, W - 40);
  switch (k) {
    case 'heli': spawnEnemy('heli', x, -20, { hoverY: rnd(110, 300), dir: pick([-1, 1]) }); break;
    case 'jet': { const n = S.level >= 3 && Math.random() < 0.5 ? 3 : 1; for (let i = 0; i < n; i++) spawnEnemy('jet', clamp(x + (i - 1) * 34, 20, W - 20), -20 - Math.abs(i - 1) * 26, { vx: (P.x - x) * 0.15 }); break; }
    case 'drone': { const bx = rnd(90, W - 90); for (let i = 0; i < 6; i++) spawnEnemy('drone', bx, -20 - i * 26, { baseX: bx, phase: i * 0.5 }); break; }
    case 'gunship': spawnEnemy('gunship', rnd(80, W - 80), -30, { hoverY: rnd(110, 180) }); break;
    case 'bomber': { const s = pick([-1, 1]); spawnEnemy('bomber', s < 0 ? W + 40 : -40, rnd(80, 200), { vx: -s * 55 }); break; }
    case 'tank': spawnEnemy('tank', x, -20, { vx: pick([-1, 1]) * rnd(14, 30) }); break;
    case 'infantry': for (let i = 0; i < 5; i++) spawnEnemy('infantry', clamp(x + rnd(-28, 28), 10, W - 10), -20 + rnd(-20, 20)); break;
    default: spawnEnemy(k, x, -24);
  }
}
function spawnElite(type: EnemyType) {
  const e = type === 'crawler' ? spawnEnemy('crawler', W / 2, -60, { holdY: 210 }) : spawnEnemy(type, W / 2, -60, { hoverY: type === 'carrier' ? 150 : 170, dir: 1 });
  e.cd2 = 3; e.cd3 = 4.5; e.phase2 = false;
  S.elite = e;
}

/* ---------------- boss ---------------- */
const BOSS_CD: Record<string, number> = { pulse: 1.3, spread: 2.3, flak: 2.7, missile: 3.4, bomb: 2.9, artillery: 3.2, rail: 4.6, tesla: 2.4, pd: 0.45 };
function spawnBoss(g: Ghost) {
  const sec = S.sector, build = ghostToBuild(g.sections), dv = derive(build);
  const s = Math.min(1.9, 560 / dv.len, 760 / dv.width);
  const maxHp = (500 + dv.maxHp * 2.2) * (0.8 + 0.35 * sec) * S.P!.dv.mods.bossHpMul;
  const u = dv.u, shield = u.shield * 40 * (0.8 + 0.35 * sec);
  S.boss = {
    ghost: g, build, dv, s, x: W / 2, y: -(dv.len * s) / 2 - 10, homeY: (dv.len * s) / 2 + 70, halfW: (dv.width * s) / 2, r: (dv.width * s) / 2,
    layer: 'both', isBoss: true, alive: true, dead: false, hp: maxHp, maxHp, shieldMax: shield, shield, shieldHitT: 9,
    regen: u.repair * 0.0025 * maxHp, tractor: u.magnet * 14, droneEvery: u.drones ? Math.max(5, 10 - u.drones) : 0, droneT: 6,
    speedMul: 1 + 0.12 * u.thruster, fireMul: 1 + 0.1 * u.reactor, cdMul: clamp(1.15 - 0.06 * sec, 0.6, 1.1),
    t: 0, phase: 1, flash: 0, entered: false,
    weps: dv.mounts.filter((m) => m.part && has(WEAPONS, m.part.id)).map((m, i) => ({ part: m.part!, ox: m.ox, oy: m.oy, cd: 1.2 + i * 0.45 })),
  };
}
const bossMount = (w: { ox: number; oy: number }) => ({ x: S.boss!.x + w.ox * S.boss!.s, y: S.boss!.y - w.oy * S.boss!.s });
function eShot(x: number, y: number, a: number, spd: number, o: Record<string, any> = {}) {
  S.eb.push({ x, y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, r: 4, dmg: edmg(), col: '#ff5a4e', kind: 'bullet', life: 7, t: 0, dead: false, ...o });
}
function ring(x: number, y: number, n: number, spd: number, o: Record<string, any> = {}) { const off = rnd(0, Math.PI * 2); for (let i = 0; i < n; i++) eShot(x, y, off + (i * Math.PI * 2) / n, spd, o); }
function bossFire(w: Boss['weps'][number]) {
  const P = S.P!, { x, y } = bossMount(w), t = w.part.tier, dmg = edmg() * (1 + 0.15 * (t - 1)), spd = bspd(), sec = S.sector;
  if (w.part.id !== 'pd' && w.part.id !== 'artillery') muzzle(x, y + 8, '#ff7a5c', w.part.id === 'rail' ? 22 : 14);
  switch (w.part.id) {
    case 'pulse': { const a = aimAng(x, y); for (let k = 0; k < 3 + (t >= 3 ? 1 : 0); k++) eShot(x, y, a + rnd(-0.04, 0.04), spd * (1 - 0.12 * k), { dmg }); break; }
    case 'spread': { const n = 5 + Math.min(4, t); for (let i = 0; i < n; i++) eShot(x, y, Math.PI / 2 + (i - (n - 1) / 2) * 0.2, spd * 0.85, { dmg, col: '#ff7a6b' }); break; }
    case 'flak': { const a = aimAng(x, y), d = Math.hypot(P.x - x, P.y - y); eShot(x, y, a, 150, { kind: 'orb', r: 7, life: clamp(d / 150, 0.6, 2.2), col: '#ffd27a', dmg }); break; }
    case 'missile': for (const s of [-1, 1]) eShot(x + s * 6, y, Math.PI / 2 + s * 0.7, 140, { kind: 'missile', turn: 1.8 + 0.2 * t, spd: 150 + 10 * t, hp: 5 * sec, life: 5, r: 5, col: '#ff9f5a', dmg: dmg * 1.4 }); break;
    case 'bomb': for (let i = -1; i <= 1; i++) eShot(x + i * 14, y, Math.PI / 2, 90 + rnd(0, 40), { kind: 'mine', r: 6, life: rnd(1.3, 2.1), col: '#f2a541', dmg }); break;
    case 'artillery': { const n = t >= 3 ? 3 : 1; for (let k = 0; k < n; k++) strike(P.x + (k ? rnd(-70, 70) : 0), P.y + (k ? rnd(-70, 70) : 0), dmg * 1.6); break; }
    case 'rail': S.eb.push({ kind: 'beam', x, y, warn: 0.9, dur: 0.3, w: 14 + 2 * t, dmg: dmg * 2.6, t: 0, life: 9, vx: 0, vy: 0, r: 0, col: '#c9a6ff', dead: false }); break;
    case 'tesla': ring(x, y, 10 + t, spd * 0.6, { r: 3, col: '#9be7ff', dmg: dmg * 0.8 }); sfx('zap'); break;
    case 'pd': {
      let best: Ent | null = null, bd = 140 * 140;
      for (const b of S.pb) { if (!['missile', 'shell', 'bomb', 'flak'].includes(b.kind)) continue; const dd = (b.x - x) ** 2 + (b.y - y) ** 2; if (dd < bd) { bd = dd; best = b; } }
      if (best) { best.dead = true; S.beams.push({ x1: x, y1: y, x2: best.x, y2: best.y, col: '#ff9f9f', life: 0.12, max: 0.12, w: 1.5 }); spark(best.x, best.y, '#ffb3a8', 4); }
      break;
    }
  }
}
const strike = (x: number, y: number, dmg: number) => S.eb.push({ kind: 'strike', x, y, delay: 1.1, rad: 38, dmg, t: 0, life: 9, vx: 0, vy: 0, r: 0, dead: false });
function updateBoss(dt: number) {
  const b = S.boss; if (!b || !b.alive) return;
  const P = S.P!;
  b.t += dt; b.flash -= dt;
  if (!b.entered) { b.y += 70 * dt; if (b.y >= b.homeY) { b.y = b.homeY; b.entered = true; b.t = 0; } }
  else { const span = Math.max(0, W / 2 - b.halfW - 12); b.x = W / 2 + Math.sin(b.t * 0.45 * b.speedMul) * span; b.y = b.homeY + Math.sin(b.t * 0.8) * 18; }
  for (const r of b.dv.rects) if (r.type === 'engine') for (const sx of [-0.22, 0.22]) if (Math.random() < 0.6) addFx({ type: 'fire', x: b.x + r.w * sx * b.s, y: b.y - (r.y + r.h) * b.s - 10, vx: rnd(-10, 10), vy: rnd(-160, -110), life: 0.25, max: 0.25, size: rnd(5, 8), grow: 0.4 });
  if (b.phase === 2 && Math.random() < dt * 22) {
    const r = pick(b.dv.rects), x = b.x + rnd(r.x, r.x + r.w) * b.s, y = b.y - (r.y + rnd(0, r.h)) * b.s;
    addFx({ type: 'fire', x, y, vx: rnd(-10, 10), vy: rnd(-30, 10), life: 0.45, max: 0.45, size: rnd(6, 10), grow: 0.8 });
    addFx({ type: 'smoke', x, y, vx: rnd(-10, 10), vy: rnd(40, 80), life: 1.4, max: 1.4, size: 7, grow: 2.4, a: 0.55 });
  }
  if (b.shieldMax) { b.shieldHitT += dt; if (b.shieldHitT > 3) b.shield = Math.min(b.shieldMax, b.shield + b.shieldMax * 0.12 * dt); }
  if (b.regen) b.hp = Math.min(b.maxHp, b.hp + b.regen * dt);
  if (b.phase === 1 && b.hp < b.maxHp * 0.5) { b.phase = 2; setBanner('HULL BREACHED', 'Its guns are running hot', 1.8, '#ff5a4e'); sfx('alarm'); }
  if (b.tractor && S.mode === 'play') P.x += Math.sign(b.x - P.x) * Math.min(Math.abs(b.x - P.x), b.tractor * dt);
  if (b.droneEvery && b.entered) { b.droneT -= dt; if (b.droneT <= 0) { b.droneT = b.droneEvery; for (let i = 0; i < 3; i++) spawnEnemy('drone', b.x, b.y - i * 24, { baseX: clamp(b.x, 80, W - 80), phase: i * 0.6 }); } }
  S.escortT -= dt; if (S.escortT <= 0) { S.escortT = rnd(6, 9); spawnGroup(pick(['heli', 'turret', 'tank', 'jet'] as EnemyType[])); }
  if (!b.entered) return;
  const fm = b.fireMul * (b.phase === 2 ? 1.35 : 1);
  for (const w of b.weps) { w.cd -= dt * fm; if (w.cd > 0) continue; w.cd = BOSS_CD[w.part.id] * b.cdMul * rnd(0.85, 1.15); bossFire(w); fireLog.set(w.part.uid, S.t); }
}
function damageBoss(d: number) {
  const b = S.boss; if (!b || !b.alive || S.mode !== 'play') return;
  d *= S.P!.dv.mods.dmgAir;
  if (b.shield > 0) { const a = Math.min(b.shield, d); b.shield -= a; d -= a; b.shieldHitT = 0; }
  b.hp -= d; b.flash = 0.06;
  if (b.hp <= 0) bossDown();
}
function bossDown() {
  const b = S.boss!; b.alive = false; b.dead = true; b.hp = 0;
  S.mode = 'bossdown'; S.endT = 2.6; S.chain = 0; S.eb = [];
  S.score += 2000 * S.sector; S.kills++;
  for (let i = 0; i < 26; i++) S.pickups.push({ x: b.x + rnd(-b.halfW, b.halfW), y: b.y + rnd(-40, 40), vx: rnd(-80, 80), vy: rnd(-80, 40), val: (6 + 3 * S.sector) * S.P!.dv.scrapMult, t: 0, kind: 'scrap' });
  setBanner(b.ghost.ai ? 'CORE DESTROYED' : 'GHOST LAID TO REST', b.ghost.name, 2.6, '#8fe39a');
  sfx('big'); V.shake = 14; S.slow = 1.2; V.flashA = 0.3;
  boomFx(b.x, b.y, 46, '#ffb347');
  setTimeout(() => { if (S.mode === 'bossdown') { boomFx(b.x, b.y + 30, 80, '#fff1c1'); V.flashA = 0.45; V.shake = 22; sfx('big'); } }, 1500);
}

/* ---------------- player ---------------- */
function updatePlayer(dt: number) {
  const P = S.P!, sp = P.dv.speed;
  let ix = 0, iy = 0;
  if (keys.l) ix--; if (keys.r) ix++; if (keys.u) iy--; if (keys.d) iy++;
  if (ix || iy) { const l = Math.hypot(ix, iy); P.x += (ix / l) * sp * dt; P.y += (iy / l) * sp * dt; P.tx = null; }
  else if (P.tx != null && P.ty != null) {
    const dx = P.tx - P.x, dy = P.ty - P.y, d = Math.hypot(dx, dy), m = sp * 1.7 * dt;
    if (d <= m) { P.x = P.tx; P.y = P.ty; } else { P.x += (dx / d) * m; P.y += (dy / d) * m; }
  }
  const hw = P.dv.width / 2, hl = P.dv.len / 2;
  P.x = clamp(P.x, hw, W - hw); P.y = clamp(P.y, hl + 70, H - hl - 14);
  if (P.tx != null && P.ty != null) { P.tx = clamp(P.tx, hw, W - hw); P.ty = clamp(P.ty, hl + 70, H - hl - 14); }
  P.lastHit += dt;
  if (P.dv.regen) P.hp = Math.min(P.dv.maxHp, P.hp + P.dv.regen * dt);
  if (P.dv.shieldMax && P.lastHit > 2) P.shield = Math.min(P.dv.shieldMax, P.shield + P.dv.shieldRegen * dt);
  P.flash = Math.max(0, P.flash - dt * 5);
  for (const r of P.dv.rects) if (r.type === 'engine') for (const sx of [-0.22, 0.22]) if (Math.random() < 0.7) addFx({ type: 'fire', x: P.x + r.w * sx + rnd(-1, 1), y: P.y + r.y + r.h + 9, vx: rnd(-8, 8), vy: rnd(150, 220), life: 0.2, max: 0.2, size: rnd(3, 4.5), grow: 0.4 });
  if (P.hp < P.dv.maxHp * 0.45 && Math.random() < dt * 16) {
    const r = pick(P.dv.rects), x = P.x + rnd(r.x, r.x + r.w), y = P.y + r.y + rnd(0, r.h);
    addFx({ type: 'smoke', x, y, vx: rnd(-10, 10), vy: rnd(70, 110), life: 1, max: 1, size: 4, grow: 2.4, a: 0.6 });
    if (Math.random() < 0.5) addFx({ type: 'fire', x, y, vx: 0, vy: 60, life: 0.3, max: 0.3, size: 5, grow: 0.6 });
  }
  if (P.hp < P.dv.maxHp * 0.25) V.hurt = Math.max(V.hurt, 0.22 + 0.12 * Math.sin(S.t * 6));
}
export function damagePlayer(d: number) {
  const P = S.P!;
  if (S.mode !== 'play' || S.god) return;
  if (!S.firstHitUsed && hasFlag(S.relics, 'first_hit_free')) { S.firstHitUsed = true; spark(P.x, P.y, '#9aa7b4', 10); setBanner('REACTIVE PLATING', 'First hit absorbed', 1.2, '#9aa7b4'); return; }
  P.lastHit = 0;
  if (P.shield > 0) { const a = Math.min(P.shield, d); P.shield -= a; d -= a; }
  if (d > 0) { P.hp -= d; P.flash = 1; V.hurt = 1; V.shake = Math.min(10, V.shake + d * 0.4); sfx('hit'); }
  if (P.hp <= 0) {
    if (S.cheatDeath && !S.cheatDeathUsed) {
      S.cheatDeathUsed = true; P.hp = P.dv.maxHp * 0.3; S.eb = []; V.flashA = 0.5; setBanner('EMERGENCY JUMP', 'Hull restored to 30%', 1.8, '#7fb6ff'); sfx('alarm');
      return;
    }
    playerDie();
  }
}
function playerDie() {
  const P = S.P!; P.hp = 0; S.mode = 'dying'; S.endT = 2.2;
  for (let i = 0; i < 8; i++) setTimeout(() => boomFx(P.x + rnd(-P.dv.width / 2, P.dv.width / 2), P.y + rnd(-P.dv.len / 2, P.dv.len / 2), rnd(14, 28), pick(['#ffb347', '#ff6a3d', '#fff1c1'])), i * 120);
  sfx('big'); V.shake = 16; S.slow = 0.9; V.flashA = 0.4; boomFx(P.x, P.y, 40, '#ffb347');
}
export function dronePos(i: number, n: number) { const P = S.P!, a = S.t * 1.8 + (i * Math.PI * 2) / n, R = Math.max(P.dv.width, P.dv.len) / 2 + 16; return { x: P.x + Math.cos(a) * R, y: P.y + Math.sin(a) * R * 0.6 }; }
function updateDrones(dt: number) {
  const P = S.P!, n = P.dv.drones; if (!n) return;
  for (let i = 0; i < n; i++) {
    P.droneCd[i] = (P.droneCd[i] || 0) - dt * P.dv.fireMult; if (P.droneCd[i] > 0) continue; P.droneCd[i] = 0.42;
    const p = dronePos(i, n);
    S.pb.push(bolt(p.x, p.y - 4, 0, -650, 4 * (1 + 0.3 * (P.dv.droneTier - 1)), 'air', '#7fb6ff', 2));
  }
}

/* ---------------- player weapons ---------------- */
const bolt = (x: number, y: number, vx: number, vy: number, dmg: number, layer: string, col: string, r: number): Ent => ({ x, y, vx, vy, dmg, layer, col, r, kind: 'bolt', life: 2.5, dead: false });
const layerOk = (bl: string, el: string) => bl === 'both' || el === 'both' || bl === el;
export const allTargets = (): Ent[] => (S.boss && S.boss.alive ? [...S.enemies, S.boss] : S.enemies);
function nearest(x: number, y: number, f: (e: Ent) => boolean, maxD: number) {
  let best: Ent | null = null, bd = maxD;
  for (const e of allTargets()) { if (e.dead || !f(e)) continue; const d = Math.hypot(e.x - x, e.y - y) - (e.isBoss ? e.r * 0.6 : 0); if (d < bd) { bd = d; best = e; } }
  return best;
}
function fireWeapons(dt: number) {
  const P = S.P!, fm = P.dv.fireMult;
  for (const m of P.dv.mounts) {
    const p = m.part; if (!p || !has(WEAPONS, p.id)) continue;
    if (P.cds[p.uid] === undefined) P.cds[p.uid] = rnd(0, 0.25);
    P.cds[p.uid] -= dt * fm; if (P.cds[p.uid] > 0) continue;
    const ok = fireWeapon(p, P.x + m.ox, P.y + m.oy);
    if (ok) fireLog.set(p.uid, S.t);
    P.cds[p.uid] = ok ? wCd(p) * (p.id === 'rail' ? P.dv.mods.railCdMul : 1) : 0.12;
    if (ok && p.id !== 'pd' && p.id !== 'tesla') muzzle(P.x + m.ox, P.y + m.oy - 7, WEAPONS[p.id].col, p.id === 'rail' ? 20 : 10);
  }
}
function fireWeapon(p: Part, x: number, y: number): boolean {
  const d = wDmg(p), c = WEAPONS[p.id].col;
  switch (p.id) {
    case 'pulse': S.pb.push(bolt(x, y - 8, 0, -720, d, 'air', c, 3)); sfx('pew'); return true;
    case 'spread': { const n = p.tier >= 3 ? 5 : 3; for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + (i - (n - 1) / 2) * 0.17; S.pb.push(bolt(x, y, Math.cos(a) * 600, Math.sin(a) * 600, d, 'air', c, 2.5)); } sfx('pew'); return true; }
    case 'flak': { const b = bolt(x, y, 0, -520, d, 'air', c, 4); Object.assign(b, { kind: 'flak', life: 0.45, aoe: 46 }); S.pb.push(b); return true; }
    case 'missile': for (const s of [-1, 1]) { const b = bolt(x + s * 4, y, s * 130, -160, d, 'both', c, 3); Object.assign(b, { kind: 'missile', turn: 5, speed: 460, life: 2.4 }); S.pb.push(b); } return true;
    case 'bomb': { const b = bolt(x, y, rnd(-15, 15), -190, d, 'ground', c, 4); Object.assign(b, { kind: 'bomb', life: 0.55, max: 0.55, aoe: 36 }); S.pb.push(b); return true; }
    case 'artillery': {
      const tg = nearest(x, y, (e) => (e.layer === 'ground' || e.isBoss) && e.y > -10 && e.y < y - 20, 560); if (!tg) return false;
      const b = bolt(x, y, 0, 0, d, 'ground', c, 4);
      Object.assign(b, { kind: 'shell', sx: x, sy: y, tx: tg.x, ty: tg.isBoss ? tg.y : tg.y + S.scroll * 0.6, life: 0.6, max: 0.6, aoe: 32 }); S.pb.push(b); return true;
    }
    case 'rail': {
      S.beams.push({ x1: x, y1: y, x2: x, y2: -10, col: c, life: 0.28, max: 0.28, w: 5 });
      for (let i = 0; i < 16; i++) addFx({ type: 'spark', x: x + rnd(-3, 3), y: rnd(0, y), vx: rnd(-160, 160), vy: rnd(-60, 60), life: rnd(0.15, 0.4), max: 0.4, size: 1.5, drag: 3, tint: '#e6d6ff' });
      for (const e of S.enemies) if (!e.dead && e.y < y && Math.abs(e.x - x) < e.r + 5) damageTarget(e, d);
      const B = S.boss; if (B && B.alive && B.y < y && Math.abs(B.x - x) < B.halfW) damageBoss(d);
      sfx('rail'); return true;
    }
    case 'tesla': {
      let cx = x, cy = y, range = 170, any = false; const hit = new Set<Ent>();
      for (let k = 0; k < 2 + p.tier; k++) {
        let best: Ent | null = null, bd = range;
        for (const e of allTargets()) { if (e.dead || hit.has(e)) continue; const dd = Math.hypot(e.x - cx, e.y - cy) - (e.isBoss ? e.r * 0.6 : 0); if (dd < bd) { bd = dd; best = e; } }
        if (!best) break; hit.add(best);
        S.beams.push({ x1: cx, y1: cy, x2: best.x, y2: best.y, col: c, life: 0.14, max: 0.14, w: 2, zig: true });
        damageTarget(best, d); cx = best.x; cy = best.y; range = 130; any = true;
      }
      if (any) sfx('zap'); return any;
    }
    case 'pd': {
      let best: Ent | null = null, bd = 150 * 150;
      for (const b of S.eb) { if (b.kind === 'beam' || b.kind === 'strike' || b.dead) continue; const dd = (b.x - x) ** 2 + (b.y - y) ** 2; if (dd < bd) { bd = dd; best = b; } }
      if (!best) return false;
      best.dead = true; S.beams.push({ x1: x, y1: y, x2: best.x, y2: best.y, col: c, life: 0.12, max: 0.12, w: 1.5 }); spark(best.x, best.y, c, 4); return true;
    }
  }
  return false;
}
export function damageTarget(e: Ent, d: number) {
  if (e.isBoss) { damageBoss(d); return; }
  if (e.dead) return;
  const m = S.P!.dv.mods;
  e.hp -= d * (e.layer === 'air' ? m.dmgAir : m.dmgGround); e.flash = 0.07;
  if (e.hp <= 0) killEnemy(e as Enemy);
}
function dropScrap(x: number, y: number, total: number, n: number) {
  for (let i = 0; i < n; i++) S.pickups.push({ x, y, vx: rnd(-70, 70), vy: rnd(-90, 20), val: total / n, t: 0, kind: 'scrap' });
}
function killEnemy(e: Enemy) {
  e.dead = true; const d = EN[e.type];
  const big = e.r > 15;
  boomFx(e.x, e.y, e.r * (d.elite ? 2 : 1.25), e.layer === 'air' ? '#ffb347' : '#ff8a3d', e.layer === 'ground');
  if (big) V.shake = Math.min(d.elite ? 16 : 8, V.shake + (d.elite ? 12 : 3));
  sfx(d.elite ? 'big' : 'boom');
  S.score += d.score * (1 + 0.1 * (S.level - 1)); if (!d.salvage) S.kills++;
  const val = d.scrap * (1 + 0.08 * S.level) * S.P!.dv.scrapMult;
  dropScrap(e.x, e.y, val, Math.min(d.elite ? 14 : 6, Math.ceil(d.scrap / 2)));
  if (d.salvage && Math.random() < (e.type === 'wreck' ? 0.45 : 0.25)) S.pickups.push({ x: e.x, y: e.y, vx: rnd(-30, 30), vy: -40, val: 0.12, t: 0, kind: 'repair' });
  if (d.elite) { S.slow = 1; V.flashA = 0.35; setBanner('ELITE DESTROYED', d.name || '', 2, '#8fe39a'); }
  if (hasFlag(S.relics, 'kill_explode') && !d.salvage) explode(e.x, e.y, 42, 10 * (1 + 0.2 * S.level), 'both', '#ff9f5a');
}
function explode(x: number, y: number, r: number, d: number, layer: string, col: string) {
  boomFx(x, y, r * 0.7, col, layer === 'ground');
  if (layer !== 'air') { const sc = worldBlast(x, y, r, d); if (sc > 0) dropScrap(x, y, sc * S.P!.dv.scrapMult, Math.min(6, Math.ceil(sc / 4))); }
  for (const e of S.enemies) if (!e.dead && layerOk(layer, e.layer) && Math.hypot(e.x - x, e.y - y) < r + e.r) damageTarget(e, d);
  const B = S.boss; if (B && B.alive && shipHit(x, y, r * 0.6, B.x, B.y, B.dv, B.s, -1)) damageBoss(d);
}
function updatePB(dt: number) {
  for (const b of S.pb) {
    if (b.dead) continue;
    b.life -= dt;
    if (b.kind === 'shell') {
      const k = 1 - b.life / b.max; b.x = b.sx + (b.tx - b.sx) * k; b.y = b.sy + (b.ty - b.sy) * k;
      if (b.life <= 0) { explode(b.x, b.y, b.aoe, b.dmg, 'ground', b.col); sfx('boom'); b.dead = true; }
      continue;
    }
    if (b.kind === 'missile') {
      if (!b.tg || b.tg.dead) b.tg = nearest(b.x, b.y, () => true, 600);
      const ca = Math.atan2(b.vy, b.vx);
      const na = ca + clamp(angDiff(b.tg ? Math.atan2(b.tg.y - b.y, b.tg.x - b.x) : -Math.PI / 2, ca), -b.turn * dt, b.turn * dt);
      b.vx = Math.cos(na) * b.speed; b.vy = Math.sin(na) * b.speed;
      pushTrail(b, 12);
      if (Math.random() < 0.7) addFx({ type: 'smoke', x: b.x, y: b.y, vx: rnd(-8, 8), vy: rnd(-8, 8), life: 0.55, max: 0.55, size: 3, grow: 2.2, a: 0.4 });
    }
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.kind === 'bomb') { b.vy *= 1 - dt * 1.6; if (b.life <= 0) { explode(b.x, b.y, b.aoe, b.dmg, 'ground', b.col); sfx('boom'); b.dead = true; } continue; }
    if (b.life <= 0) { if (b.kind === 'flak') explode(b.x, b.y, b.aoe, b.dmg, 'air', b.col); b.dead = true; continue; }
    if (b.y < -30 || b.x < -30 || b.x > W + 30 || b.y > H + 30) { b.dead = true; continue; }
    for (const e of S.enemies) { if (e.dead || !layerOk(b.layer, e.layer)) continue; if ((e.x - b.x) ** 2 + (e.y - b.y) ** 2 < (e.r + b.r) ** 2) { hitWith(b, e); break; } }
    const B = S.boss;
    if (!b.dead && B && B.alive && shipHit(b.x, b.y, b.r, B.x, B.y, B.dv, B.s, -1)) hitWith(b, B);
    if (!b.dead && b.layer !== 'ground') for (const m of S.eb) { if (m.kind === 'missile' && !m.dead && (m.x - b.x) ** 2 + (m.y - b.y) ** 2 < 110) { m.hp -= b.dmg; if (m.hp <= 0) { m.dead = true; boomFx(m.x, m.y, 10, '#ffb36b'); } b.dead = true; break; } }
  }
  S.pb = S.pb.filter((b) => !b.dead);
}
function hitWith(b: Ent, e: Ent) {
  if (b.kind === 'flak') explode(b.x, b.y, b.aoe, b.dmg, 'air', b.col);
  else { damageTarget(e, b.dmg); spark(b.x, b.y, b.col, 3); }
  b.dead = true;
}
export function pushTrail(b: Ent, n: number) { (b.trail || (b.trail = [])).push(b.x, b.y); if (b.trail.length > n * 2) b.trail.splice(0, 2); }

/* ---------------- enemies ---------------- */
function updateEnemies(dt: number) {
  const P = S.P!, live = S.mode === 'play' || S.mode === 'dying';
  const canFire = (e: Enemy) => live && e.y > 10 && e.y < H - 120 && e.x > 0 && e.x < W;
  for (const e of S.enemies) {
    if (e.dead) continue;
    e.t += dt; e.flash -= dt; e.cd -= dt;
    if (e.layer === 'ground' && e.type !== 'crawler') e.y += S.scroll * dt;
    switch (e.type) {
      case 'heli':
        if (e.t > 10) e.y += 130 * dt; else if (e.y < e.hoverY) e.y += 95 * dt; else { e.x += e.dir * 50 * dt; if (e.x < 30 || e.x > W - 30) e.dir *= -1; }
        if (e.cd <= 0 && canFire(e)) { e.cd = 1.8; eShot(e.x, e.y + 8, aimAng(e.x, e.y), bspd()); }
        break;
      case 'jet':
        e.y += 270 * dt; e.x += e.vx * dt;
        if (!e.fired && e.y > 110 && canFire(e)) { e.fired = true; const a = aimAng(e.x, e.y); eShot(e.x, e.y, a, bspd() * 1.2); if (S.level >= 4) { eShot(e.x, e.y, a - 0.2, bspd() * 1.2); eShot(e.x, e.y, a + 0.2, bspd() * 1.2); } }
        break;
      case 'drone':
        e.y += 115 * dt; e.x = e.baseX + Math.sin(e.t * 2.4 + e.phase) * 70;
        if (e.cd <= 0) { e.cd = rnd(2.5, 4); if (canFire(e) && Math.random() < 0.35) eShot(e.x, e.y, aimAng(e.x, e.y), bspd() * 0.8, { r: 3 }); }
        break;
      case 'gunship':
        if (e.t > 15) e.y += 90 * dt; else if (e.y < e.hoverY) e.y += 45 * dt; else e.x += clamp(P.x - e.x, -1, 1) * 35 * dt;
        if (e.cd <= 0 && canFire(e)) { e.cd = 2.3; const a = aimAng(e.x, e.y); for (let i = -2; i <= 2; i++) eShot(e.x, e.y + 12, a + i * 0.18, bspd() * 0.9); }
        break;
      case 'bomber':
        e.x += e.vx * dt;
        if (e.cd <= 0 && canFire(e)) { e.cd = 1.1; for (let i = -1; i <= 1; i++) eShot(e.x, e.y + 10, Math.PI / 2 + i * 0.3, bspd() * 0.75, { r: 5, col: '#ff7a4e' }); }
        if ((e.vx > 0 && e.x > W + 60) || (e.vx < 0 && e.x < -60)) e.dead = true;
        break;
      case 'tank':
        e.x += e.vx * dt; if (e.x < 20 || e.x > W - 20) e.vx *= -1;
        e.ang = aimAng(e.x, e.y);
        if (e.cd <= 0 && canFire(e)) { e.cd = 2.4; eShot(e.x + Math.cos(e.ang) * 12, e.y + Math.sin(e.ang) * 12, e.ang, bspd()); }
        break;
      case 'infantry':
        e.x += Math.sin(e.t * 3 + e.y) * 8 * dt;
        if (e.cd <= 0 && canFire(e)) { e.cd = rnd(2.8, 4); eShot(e.x, e.y, aimAng(e.x, e.y), bspd() * 0.65, { r: 2.5, dmg: edmg() * 0.6 }); }
        break;
      case 'turret':
        e.ang = aimAng(e.x, e.y);
        if (e.cd <= 0 && canFire(e)) { e.cd = 2.6; e.burst = 3; e.bt = 0; }
        if (e.burst > 0) { e.bt -= dt; if (e.bt <= 0 && canFire(e)) { e.burst--; e.bt = 0.13; eShot(e.x, e.y, aimAng(e.x, e.y), bspd()); } }
        break;
      case 'sam':
        if (e.cd <= 0 && canFire(e)) { e.cd = 3.8; eShot(e.x, e.y - 8, -Math.PI / 2, 120, { kind: 'missile', turn: 2.2, spd: 160, hp: 4 * hpMult(), life: 5, r: 5, col: '#ff9f5a', dmg: edmg() * 1.5 }); }
        break;
      case 'bunker':
        if (e.cd <= 0 && canFire(e)) { e.cd = 3; ring(e.x, e.y, 10, bspd() * 0.7, { r: 4.5, col: '#ff7a6b' }); }
        break;
      case 'canister':
        e.y += 55 * dt; e.x += Math.sin(e.t * 1.3 + e.phase) * 22 * dt; e.ang = (e.ang || 0) + dt;
        break;
      case 'ace': updateAce(e, dt, canFire(e)); break;
      case 'crawler': updateCrawler(e, dt, canFire(e)); break;
      case 'carrier': updateCarrier(e, dt, canFire(e)); break;
    }
    if (!EN[e.type].elite && (e.y > H + 60 || e.x < -90 || e.x > W + 90)) e.dead = true;
    if (S.mode === 'play' && e.layer === 'air' && !e.dead && !EN[e.type].elite && shipHit(e.x, e.y, e.r * 0.7, P.x, P.y, P.dv, 1, 1)) {
      if (EN[e.type].salvage) damageTarget(e, 999); else { damagePlayer(10 + e.r * 0.6); damageTarget(e, 60); }
    }
  }
  S.enemies = S.enemies.filter((e) => !e.dead);
}
function elitePhase(e: Enemy) { if (!e.phase2 && e.hp < e.maxHp * 0.5) { e.phase2 = true; setBanner('ELITE ENRAGED', EN[e.type].name || '', 1.4, '#ff5a4e'); sfx('alarm'); } return e.phase2 ? 1.4 : 1; }
function updateAce(e: Enemy, dt: number, fire: boolean) {
  const P = S.P!, rage = elitePhase(e);
  if (e.y < e.hoverY) e.y += 80 * dt; else { e.x += clamp(P.x - e.x, -1, 1) * 120 * rage * dt; e.y = e.hoverY + Math.sin(e.t * 1.4) * 30; }
  if (!fire) return;
  if (e.cd <= 0) { e.cd = 1.5 / rage; const a = aimAng(e.x, e.y); for (let i = 0; i < 5; i++) eShot(e.x, e.y + 20, a + (i - 2) * 0.06, bspd() * (1.15 - i * 0.04)); muzzle(e.x, e.y + 20, '#ff7a5c', 14); }
  e.cd2 -= dt; if (e.cd2 <= 0) { e.cd2 = 4 / rage; ring(e.x, e.y, 16, bspd() * 0.7, { r: 4.5, col: '#ff7a6b' }); }
  e.cd3 -= dt; if (e.cd3 <= 0) { e.cd3 = 5.5; for (const s of [-1, 1]) eShot(e.x + s * 20, e.y, Math.PI / 2 + s * 0.8, 140, { kind: 'missile', turn: 2.2, spd: 170, hp: 6 * hpMult(), life: 5, r: 5, col: '#ff9f5a', dmg: edmg() * 1.5 }); }
}
function updateCrawler(e: Enemy, dt: number, fire: boolean) {
  const P = S.P!, rage = elitePhase(e);
  if (e.y < e.holdY) e.y += 40 * dt; else e.x = W / 2 + Math.sin(e.t * 0.35) * 120;
  e.ang = aimAng(e.x, e.y);
  if (!fire) return;
  if (e.cd <= 0) { e.cd = 1.8 / rage; for (const ox of [-26, 0, 26]) { const a = aimAng(e.x + ox, e.y); eShot(e.x + ox, e.y, a, bspd() * 0.95, { r: 5 }); muzzle(e.x + ox, e.y, '#ff7a5c', 10); } }
  e.cd2 -= dt; if (e.cd2 <= 0) { e.cd2 = 4.2 / rage; strike(P.x, P.y, edmg() * 2); if (rage > 1) { strike(P.x + rnd(-80, 80), P.y + rnd(-60, 60), edmg() * 2); } }
  e.cd3 -= dt; if (e.cd3 <= 0) { e.cd3 = 6; for (let i = 0; i < 4; i++) spawnEnemy('infantry', e.x + rnd(-30, 30), e.y + 30 + rnd(0, 10)); }
}
function updateCarrier(e: Enemy, dt: number, fire: boolean) {
  const rage = elitePhase(e);
  if (e.y < e.hoverY) e.y += 50 * dt; else e.x = W / 2 + Math.sin(e.t * 0.3) * 110;
  if (!fire) return;
  if (e.cd <= 0) { e.cd = 4 / rage; for (let i = 0; i < 3; i++) spawnEnemy('drone', e.x + (i - 1) * 30, e.y + 20, { baseX: clamp(e.x + (i - 1) * 30, 80, W - 80), phase: i }); }
  e.cd2 -= dt; if (e.cd2 <= 0) { e.cd2 = 2.6 / rage; const n = 9; for (let i = 0; i < n; i++) eShot(e.x, e.y + 30, Math.PI / 2 + (i - (n - 1) / 2) * 0.16, bspd() * 0.8, { col: '#ff7a6b' }); }
  e.cd3 -= dt; if (e.cd3 <= 0) { e.cd3 = 5; for (const s of [-1, 1]) eShot(e.x + s * 40, e.y, Math.PI / 2 + s * 0.9, 130, { kind: 'missile', turn: 2, spd: 160, hp: 6 * hpMult(), life: 5, r: 5, col: '#ff9f5a', dmg: edmg() * 1.5 }); }
}
function updateEB(dt: number) {
  const P = S.P!, canHit = S.mode === 'play';
  for (const b of S.eb) {
    if (b.dead) continue;
    b.t += dt; b.life -= dt;
    if (b.kind === 'beam') {
      if (b.t >= b.warn && !b.fired) {
        b.fired = true; sfx('rail'); V.shake = Math.min(10, V.shake + 5); V.flashA = Math.max(V.flashA, 0.12);
        for (let i = 0; i < 22; i++) addFx({ type: 'spark', x: b.x + rnd(-b.w / 2, b.w / 2), y: rnd(b.y, H), vx: rnd(-220, 220), vy: rnd(-80, 80), life: rnd(0.2, 0.5), max: 0.5, size: 1.8, drag: 3, tint: '#e3d0ff' });
        if (canHit && Math.abs(P.x - b.x) < b.w / 2 + P.dv.width * 0.35 && P.y > b.y) damagePlayer(b.dmg);
      }
      if (b.t > b.warn + b.dur) b.dead = true; continue;
    }
    if (b.kind === 'strike') {
      if (b.t >= b.delay) { boomFx(b.x, b.y, b.rad * 0.8, '#ff7a4e'); sfx('boom'); if (canHit && shipHit(b.x, b.y, b.rad * 0.7, P.x, P.y, P.dv, 1, 1)) damagePlayer(b.dmg); b.dead = true; }
      continue;
    }
    if (b.kind === 'missile') {
      const ca = Math.atan2(b.vy, b.vx), na = ca + clamp(angDiff(aimAng(b.x, b.y), ca), -b.turn * dt, b.turn * dt);
      b.vx = Math.cos(na) * b.spd; b.vy = Math.sin(na) * b.spd;
      pushTrail(b, 12);
      if (Math.random() < 0.7) addFx({ type: 'smoke', x: b.x, y: b.y, vx: rnd(-8, 8), vy: rnd(-8, 8), life: 0.6, max: 0.6, size: 3.2, grow: 2.2, a: 0.4 });
    }
    if (b.kind === 'mine') b.vy *= 1 - dt * 0.8;
    if ((b.kind === 'mine' || b.kind === 'orb') && b.life <= 0) { ring(b.x, b.y, 8, bspd() * 0.75, { r: 3.5, col: b.col, dmg: b.dmg }); boomFx(b.x, b.y, 10, b.col); b.dead = true; continue; }
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.life <= 0 || b.y > H + 20 || b.y < -60 || b.x < -20 || b.x > W + 20) { b.dead = true; continue; }
    if (canHit && shipHit(b.x, b.y, b.r, P.x, P.y, P.dv, 1, 1)) { damagePlayer(b.dmg); b.dead = true; spark(b.x, b.y, '#ff9f8a', 5); }
  }
  S.eb = S.eb.filter((b) => !b.dead);
}
export function shipHit(x: number, y: number, r: number, sx: number, sy: number, dv: Derived, s: number, dir: number) {
  const pad = dir > 0 ? 3 : 0;
  for (const R of dv.rects) {
    const x0 = sx + R.x * s, x1 = x0 + R.w * s;
    let y0: number, y1: number;
    if (dir > 0) { y0 = sy + R.y * s; y1 = y0 + R.h * s; } else { y1 = sy - R.y * s; y0 = y1 - R.h * s; }
    if (x + r > x0 + pad && x - r < x1 - pad && y + r > y0 + pad && y - r < y1 - pad) return true;
  }
  return false;
}

/* ---------------- pickups ---------------- */
export let onScrap: (v: number) => void = () => {};
export const setScrapHandler = (f: (v: number) => void) => { onScrap = f; };
function updatePickups(dt: number) {
  const P = S.P!, vac = S.mode === 'clear' || S.mode === 'bossdown' || hasFlag(S.relics, 'vacuum');
  for (const p of S.pickups) {
    p.t += dt;
    const dx = P.x - p.x, dy = P.y - p.y, d = Math.hypot(dx, dy) || 1;
    if (S.mode !== 'dying' && (vac || d < P.dv.magnet)) { const sp = vac ? 520 : Math.min(620, 220 + (P.dv.magnet - d) * 4); p.x += (dx / d) * sp * dt; p.y += (dy / d) * sp * dt; }
    else { p.x += p.vx * dt; p.y += (p.vy + S.scroll) * dt; p.vx *= 1 - dt * 2; p.vy *= 1 - dt * 2; }
    if (d < 20 && S.mode !== 'dying') {
      if (p.kind === 'repair') { P.hp = Math.min(P.dv.maxHp, P.hp + P.dv.maxHp * p.val); spark(P.x, P.y, '#8fe39a', 12); setBanner('REPAIR KIT', `+${Math.round(P.dv.maxHp * p.val)} hull`, 0.9, '#8fe39a'); }
      else { S.scrap += p.val; onScrap(p.val); }
      p.dead = true; sfx('pick');
    }
    if (p.y > H + 20) p.dead = true;
  }
  S.pickups = S.pickups.filter((p) => !p.dead);
}

/* ---------------- main update ---------------- */
function checkEnd() {
  const enc = S.enc!;
  if (enc.kind === 'fight' && S.time > enc.duration && (!S.enemies.some((e) => !EN[e.type].salvage) || S.time > enc.duration + 9)) win();
  if (enc.kind === 'elite' && S.elite && S.elite.dead) win();
}
function win() {
  for (const e of S.enemies) if (!EN[e.type].salvage) boomFx(e.x, e.y, e.r, '#ff9f5a', e.layer === 'ground');
  S.enemies = S.enemies.filter((e) => EN[e.type].salvage); S.eb = [];
  S.mode = 'clear'; S.endT = 2.4; setBanner('AREA CLEAR', 'Collecting salvage', 2.2, '#8fe39a'); sfx('clear');
}
export function updateCombat(rawDt: number) {
  if (!S.active) return;
  let dt = rawDt;
  if (S.slow > 0) { S.slow -= rawDt; dt *= 0.3; }
  S.t += dt; updateBg(dt);
  if (S.banner) { S.banner.t -= dt; if (S.banner.t <= 0) S.banner = null; }
  if (S.mode === 'done') { updateFx(dt, S.scroll); return; }
  S.time += dt;
  if (S.mode !== 'dying') { updatePlayer(dt); updateDrones(dt); fireWeapons(dt); }
  if (S.mode === 'play') { if (S.enc!.kind === 'boss') updateBoss(dt); else director(dt); spawnSalvage(dt); }
  updateEnemies(dt); updatePB(dt); updateEB(dt); updatePickups(dt); updateFx(dt, S.scroll);
  for (const b of S.beams) b.life -= dt; S.beams = S.beams.filter((b) => b.life > 0);
  if (S.mode === 'bossdown' && S.boss) {
    S.chain -= dt;
    if (S.chain <= 0) { const b = S.boss; S.chain = 0.12; boomFx(b.x + rnd(-b.halfW, b.halfW), b.y + rnd((-b.dv.len * b.s) / 2, (b.dv.len * b.s) / 2), rnd(14, 30), pick(['#ffb347', '#ff6a3d', '#fff1c1'])); sfx('boom'); V.shake = Math.min(10, V.shake + 2); }
  }
  if (S.mode === 'play') checkEnd();
  else { S.endT -= dt; if (S.endT <= 0) { S.outcome = S.mode === 'dying' ? 'dead' : 'win'; S.mode = 'done'; } }
}
export function endCombat() { S.active = false; }
