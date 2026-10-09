import { rnd, pick } from '../util/rng';

export type FxType = 'fire' | 'spark' | 'flash' | 'muzzle' | 'light' | 'ring' | 'smoke' | 'debris';
export interface Fx {
  type: FxType; x: number; y: number; vx: number; vy: number; life: number; max: number; size: number;
  col?: string; tint?: string; grow?: number; drag?: number; a?: number; rot?: number; vr?: number; ground?: boolean;
}
export interface Decal { x: number; y: number; r: number; life: number; max: number }

export const V = {
  fx: [] as Fx[],
  add: [] as Fx[],
  decals: [] as Decal[],
  shake: 0, flashA: 0, hurt: 0,
};
const TAU = Math.PI * 2;
export const FIRE = ['#fff4d0', '#ffd36e', '#ff9433', '#e2481f', '#8a2414'];

export function resetFx() { V.fx = []; V.add = []; V.decals = []; V.shake = 0; V.flashA = 0; V.hurt = 0; }
export const addFx = (f: Fx) => { V.add.push(f); };

export function boomFx(x: number, y: number, r: number, col: string, ground = false) {
  const big = r >= 22, m = big ? 1.35 : 1;
  addFx({ type: 'flash', x, y, vx: 0, vy: 0, life: 0.13, max: 0.13, size: r * 2.8, col: '#ffe9b8', ground });
  addFx({ type: 'light', x, y, vx: 0, vy: 0, life: 0.5 * m, max: 0.5 * m, size: r * 4, col: '#ff7a2d', ground });
  const nf = Math.min(16, 4 + Math.round(r / 2.5));
  for (let i = 0; i < nf; i++) {
    const a = rnd(0, TAU), d = rnd(0, r * 0.55), s = rnd(10, 70) * (r / 18);
    addFx({ type: 'fire', x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(0.35, 0.7) * m, max: 0.7 * m, size: r * rnd(0.45, 0.85), grow: 1.3, drag: 2.6, ground, col });
  }
  const ne = Math.min(28, 6 + Math.round(r * 0.9));
  for (let i = 0; i < ne; i++) {
    const a = rnd(0, TAU), s = rnd(90, 330) * Math.sqrt(r / 16);
    addFx({ type: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(0.25, 0.75), max: 0.75, size: rnd(1, 2.3), drag: 2.4, ground });
  }
  const ns = 2 + Math.round(r / 7);
  for (let i = 0; i < ns; i++) addFx({ type: 'smoke', x: x + rnd(-r / 2, r / 2), y: y + rnd(-r / 2, r / 2), vx: rnd(-20, 20), vy: rnd(-20, 20), life: rnd(1, 2) * m, max: 2 * m, size: r * rnd(0.45, 0.75), grow: 1.7, a: 0.6, drag: 1, ground });
  addFx({ type: 'ring', x, y, vx: 0, vy: 0, life: 0.4, max: 0.4, size: r * 2.6, col: '#ffd9a0', ground });
  if (r >= 12) {
    const nd = 3 + Math.round(r / 6);
    for (let i = 0; i < nd; i++) {
      const a = rnd(0, TAU), s = rnd(80, 240);
      addFx({ type: 'debris', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(0.5, 1.1), max: 1.1, size: rnd(2, 5), rot: rnd(0, TAU), vr: rnd(-14, 14), drag: 1.6, col: pick(['#3b4148', '#55493f', '#2b2f33', '#6b5a48']), ground });
    }
  }
  if (ground) V.decals.push({ x, y, r: r * rnd(0.9, 1.25), life: 10, max: 10 });
  if (big) V.flashA = Math.max(V.flashA, Math.min(0.18, r / 200));
}
export function spark(x: number, y: number, col: string, n: number) {
  for (let i = 0; i < n; i++) { const a = rnd(0, TAU), s = rnd(60, 220); addFx({ type: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(0.1, 0.28), max: 0.28, size: 1.4, drag: 3, tint: col }); }
  addFx({ type: 'muzzle', x, y, vx: 0, vy: 0, life: 0.07, max: 0.07, size: 9, col });
}
export const muzzle = (x: number, y: number, col: string, s = 9) => addFx({ type: 'muzzle', x, y, vx: 0, vy: 0, life: 0.06, max: 0.06, size: s, col });

export function updateFx(dt: number, scroll: number) {
  if (V.add.length) { V.fx.push(...V.add); V.add = []; }
  for (const f of V.fx) {
    f.life -= dt; f.x += f.vx * dt; f.y += f.vy * dt;
    if (f.ground) f.y += scroll * dt;
    if (f.drag) { const k = Math.max(0, 1 - dt * f.drag); f.vx *= k; f.vy *= k; }
    if (f.type === 'debris') { f.rot! += f.vr! * dt; if (Math.random() < 0.45) addFx({ type: 'smoke', x: f.x, y: f.y, vx: 0, vy: 0, life: 0.6, max: 0.6, size: f.size * 1.4, grow: 1.5, a: 0.45, ground: f.ground }); }
  }
  V.fx = V.fx.filter((f) => f.life > 0);
  if (V.fx.length > 1400) V.fx.splice(0, V.fx.length - 1400);
  for (const d of V.decals) { d.life -= dt; d.y += scroll * dt; }
  V.decals = V.decals.filter((d) => d.life > 0 && d.y < 900);
  if (V.decals.length > 60) V.decals.splice(0, V.decals.length - 60);
  V.shake = Math.max(0, V.shake - dt * 30);
  V.flashA = Math.max(0, V.flashA - dt * 2.2);
  V.hurt = Math.max(0, V.hurt - dt * 2.5);
}
