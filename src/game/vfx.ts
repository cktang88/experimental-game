// VFX simulation: pooled particles, emitters, scorch decals, camera trauma and the screen-feel knobs
// the post chain reads (chromatic pulse, time grade). Rendering lives in src/render/fx/fxLayer.ts.
//
// Every particle lives in field coordinates (x right, y down) plus a height h:
//  - ground particles (ground: true) sit h field units above the city (the renderer scales by groundScale);
//  - flight particles sit h world units above (+) or below (-) the flight plane, so debris from an air
//    burst can fall away toward the city and shrink with real perspective.
// Particles are pooled objects: addFx() copies a spec into a recycled slot, so spawning allocates
// nothing once the pool is warm, and updateFx() compacts the live list in place (stable order, which
// keeps smoke and fire from popping in front of each other).
import { rnd, pick } from '../util/rng';

export type FxType =
  | 'fire' | 'spark' | 'flash' | 'muzzle' | 'light' | 'ring' | 'smoke' | 'debris'
  | 'ember' | 'puff' | 'dust' | 'shock' | 'haze' | 'flare' | 'ion' | 'emit' | 'glow' | 'star';
export type EmitKind = '' | 'column' | 'burn' | 'vent';

export interface Fx {
  type: FxType; x: number; y: number; vx: number; vy: number; life: number; max: number; size: number;
  col: string; tint: string; grow: number; drag: number; a: number; rot: number; vr: number; ground: boolean;
  /** Height (see header) and its velocity; grav pulls vh down every second. */
  h: number; vh: number; grav: number;
  /** Seconds before the particle appears and starts to age. */
  delay: number; seed: number;
  /** Fire: heat at birth (1 white-hot). Smoke: how strongly fire lights it from below. */
  heat: number;
  emit: EmitKind; acc: number;
  /** Distortion strength (shock, haze) or light importance. */
  str: number;
  /** Second endpoint (ion trails). */
  x2: number; y2: number;
}
export type FxSpec = Partial<Fx> & { type: FxType; x: number; y: number };
export interface Decal { x: number; y: number; r: number; life: number; max: number; seed: number; hot: number }

const BLANK: Fx = {
  type: 'spark', x: 0, y: 0, vx: 0, vy: 0, life: 0.5, max: 0.5, size: 1, col: '', tint: '', grow: 0, drag: 0, a: 0, rot: 0, vr: 0, ground: false,
  h: 0, vh: 0, grav: 0, delay: 0, seed: 0, heat: 0, emit: '', acc: 0, str: 0, x2: 0, y2: 0,
};

export const V = {
  fx: [] as Fx[],
  /** @deprecated kept for old callers; addFx() writes straight into fx. */
  add: [] as Fx[],
  decals: [] as Decal[],
  /** Legacy shake in rough pixels. Anything written here is converted to trauma on the next tick. */
  shake: 0,
  flashA: 0, hurt: 0,
  /** Camera trauma 0..1 (shake amplitude grows with trauma^1.5). */
  trauma: 0,
  /** Player's screen-shake setting, 0..1 (settings panel). Scales the camera only, not the sim. */
  shakeScale: 1,
  /** Directional camera shove in field units, eased back to zero. */
  kickX: 0, kickY: 0,
  /** Chromatic aberration pulse 0..1, decays on its own. */
  ca: 0,
  /** Slow-time grade 0..1: desaturates everything except hot light. Set with setTimeGrade(). */
  timeGrade: 0,
  /** Muzzle light on the player's hull: energy and colour of the latest shot. */
  muzzleE: 0, muzzleX: 0, muzzleY: 0, muzzleCol: '#ffd27a',
  /** Particle budget (the renderer's quality tier sets it). */
  cap: 2600,
};
const TAU = Math.PI * 2;
/** Fire ramp from white-hot to soot (shared with the renderer). */
export const FIRE = ['#fff4d0', '#ffd36e', '#ff9433', '#e2481f', '#8a2414'];
const pool: Fx[] = [];
/** Spawns that are allowed past the budget: one-off events that carry the read of an explosion. */
const PRIORITY: Partial<Record<FxType, true>> = { flash: true, light: true, shock: true, ring: true, emit: true, flare: true, ion: true };

export function resetFx() {
  for (const f of V.fx) pool.push(f);
  V.fx.length = 0; V.add.length = 0; V.decals.length = 0;
  V.shake = 0; V.flashA = 0; V.hurt = 0; V.trauma = 0; V.kickX = 0; V.kickY = 0; V.ca = 0; V.timeGrade = 0; V.muzzleE = 0;
}

/** Spawn a particle. Returns it (or null when the budget is spent), so callers may tweak it. */
export function addFx(f: FxSpec): Fx | null {
  if (V.fx.length >= V.cap && !PRIORITY[f.type]) return null;
  const o = pool.pop() ?? { ...BLANK };
  Object.assign(o, BLANK, f);
  if (!o.seed) o.seed = Math.random();
  V.fx.push(o);
  return o;
}

/* ---------------- camera feel ---------------- */
export const MAX_SHAKE = 16;
const MAX_ROLL = 0.012;
/** Add camera trauma (0..1). 0.1 is a nudge, 0.35 a heavy hit, 0.7+ a capital ship dying. */
export function addTrauma(amount: number) { V.trauma = Math.min(1, Math.max(0, V.trauma + amount)); }
/** Shove the camera by (dx, dy) field units; it springs back over ~120 ms. Recoil for big guns. */
export function kick(dx: number, dy: number) {
  V.kickX += dx; V.kickY += dy;
  const l = Math.hypot(V.kickX, V.kickY); if (l > 22) { V.kickX *= 22 / l; V.kickY *= 22 / l; }
}
/** A brief chromatic split at the screen edges (0..1). */
export function pulseCA(k: number) { V.ca = Math.min(1, Math.max(V.ca, k)); }
/** Slow-time look (0 off, 1 full): the world drains toward cold monochrome, fire and plasma keep their colour. */
export function setTimeGrade(k: number) { V.timeGrade = Math.min(1, Math.max(0, k)); }
function absorbLegacyShake() { if (V.shake > 0) { addTrauma(Math.sqrt(V.shake / 22)); V.shake = 0; } }
const wobble = (t: number, s: number) => (Math.sin(t * 0.031 + s) + 0.6 * Math.sin(t * 0.047 + s * 3) + 0.4 * Math.sin(t * 0.073 + s * 7)) / 2;
const shakeOut = { x: 0, y: 0, roll: 0 };
/** Camera offset this frame in field units, plus a roll in radians. Called by the engine with real time. */
export function cameraShake(dtReal: number, nowMs: number) {
  absorbLegacyShake();
  V.trauma = Math.max(0, V.trauma - dtReal / 0.75);
  const kf = Math.exp(-dtReal / 0.12); V.kickX *= kf; V.kickY *= kf;
  const k = MAX_SHAKE * V.trauma ** 1.5 * V.shakeScale;
  shakeOut.x = k * wobble(nowMs, 1) + V.kickX * V.shakeScale;
  shakeOut.y = k * wobble(nowMs, 5) + V.kickY * V.shakeScale;
  shakeOut.roll = MAX_ROLL * V.trauma ** 2 * wobble(nowMs, 9) * V.shakeScale;
  return shakeOut;
}

/* ---------------- recipes ---------------- */
/** Colors whose explosions are flak bursts (player flak shells, enemy flak orbs): black puffs, not fireballs. */
const FLAK_COLS: Record<string, true> = { '#ffd27a': true };
/** Projectile colors whose hit sparks should be a small warhead blast instead (seeker missiles). */
const WARHEAD_COLS: Record<string, true> = { '#ff9f5a': true };
/** Explosion colors that are energy discharges (Bulwark Aegis): a cyan shock front, no fire. */
const ENERGY_COLS: Record<string, true> = { '#9ff3ff': true };

/**
 * An explosion at field (x, y) with radius r. ground puts it on the city far below (scorch, dust ring,
 * debris thrown up toward the camera, a smoke column and lingering fires); otherwise it bursts on the
 * flight plane and its debris falls away toward the city.
 */
export function boomFx(x: number, y: number, r: number, col: string, ground = false) {
  if (!ground && FLAK_COLS[col]) { flakFx(x, y, r); return; }
  if (ENERGY_COLS[col]) { energyBurst(x, y, r, col); return; }
  r *= 1.3; // the fireball reads bigger than the damage radius: blasts should feel generous
  const big = r >= 22, huge = r >= 40, m = big ? 1.3 : 1, s = Math.sqrt(r / 16);
  // 1. Two flashes: a white-hot core and a wider amber bloom, plus a lens flare on big ones.
  addFx({ type: 'flash', x, y, life: 0.1, max: 0.1, size: r * 3.4, col: '#fff6e0', ground, h: 4 });
  addFx({ type: 'flash', x, y, life: 0.3 * m, max: 0.3 * m, size: r * 5, col: '#ff9a3c', ground, h: 2 });
  if (r >= 16) addFx({ type: 'flare', x, y, life: 0.22 * m, max: 0.22 * m, size: r * (huge ? 9 : 6), col: '#ffc070', ground, h: 6 });
  addFx({ type: 'light', x, y, life: 0.55 * m, max: 0.55 * m, size: r * 2.1 * 2, str: r, col: '#ff8a3d', ground });
  // 2. Two rings: a hot shock front and a slower smoke/dust ring; the shock also bends the screen.
  addFx({ type: 'ring', x, y, life: 0.32, max: 0.32, size: r * 2.4, col: '#ffe2b0', ground, h: 3 });
  addFx({ type: 'shock', x, y, life: 0.42 * m, max: 0.42 * m, size: r * 4.4, str: Math.min(1, 0.35 + r / 50), ground });
  // 3. Rolling fireball in layers: a white-hot core, seven lobes thrown outward, and outer billows
  //    that cool to soot and hand over to the smoke.
  const vh0 = ground ? 1 : 0;
  addFx({ type: 'fire', x, y, life: 0.32 * m, max: 0.32 * m, size: r * 0.95, grow: 0.7, ground, h: 6, vh: vh0 * 30, rot: rnd(0, TAU), vr: rnd(-2, 2), heat: 1 });
  const lobes = r >= 12 ? 7 : 4, a0 = rnd(0, TAU);
  for (let i = 0; i < lobes; i++) {
    const a = a0 + (i / lobes) * TAU + rnd(-0.3, 0.3), d = r * rnd(0.15, 0.4), sp = r * rnd(1.2, 2.2);
    addFx({ type: 'fire', x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(0.5, 0.8) * m, max: 0.8 * m,
      size: r * rnd(0.5, 0.75), grow: 1.0, drag: 3.2, ground, h: rnd(3, 9), vh: vh0 * rnd(25, 60) * s, rot: rnd(0, TAU), vr: rnd(-1.6, 1.6), heat: rnd(0.85, 1), delay: rnd(0, 0.04) });
  }
  const nb = Math.min(10, 2 + Math.round(r / 6));
  for (let i = 0; i < nb; i++) {
    const a = rnd(0, TAU), d = r * rnd(0.3, 0.7), sp = r * rnd(0.5, 1.1);
    addFx({ type: 'fire', x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(0.75, 1.15) * m, max: 1.15 * m,
      size: r * rnd(0.45, 0.7), grow: 1.3, drag: 2.2, ground, h: rnd(2, 6), vh: vh0 * rnd(20, 45) * s, rot: rnd(0, TAU), vr: rnd(-1, 1), heat: rnd(0.6, 0.8), delay: rnd(0.03, 0.1) });
  }
  // 4. Smoke: appears as the fire dies, lit from below at first, then rises (ground) or drifts (air).
  const ns = Math.min(12, 3 + Math.round(r / 4));
  for (let i = 0; i < ns; i++) {
    const a = rnd(0, TAU), d = rnd(0, r * 0.5);
    addFx({ type: 'smoke', x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, vx: Math.cos(a) * rnd(8, 26), vy: Math.sin(a) * rnd(8, 26), life: rnd(1.6, 2.8) * m, max: 2.8 * m,
      size: r * rnd(0.55, 0.9), grow: 1.7, a: rnd(0.6, 0.8), drag: 1.2, ground, h: 6, vh: ground ? rnd(14, 30) : 0, rot: rnd(0, TAU), vr: rnd(-0.5, 0.5), heat: 1, delay: rnd(0.2, 0.42), col: ground ? '#4a4648' : '#46474d' });
  }
  // 5. Sparks: fast streaks; on the ground they also arc up toward the camera and fall back.
  const nk = Math.min(34, 8 + Math.round(r * 0.8));
  for (let i = 0; i < nk; i++) {
    const a = rnd(0, TAU), sp = rnd(120, 420) * s;
    addFx({ type: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(0.25, 0.8), max: 0.8, size: rnd(1, 2.4), drag: 2.2, ground, h: 4, vh: ground ? rnd(40, 220) : rnd(-60, 60), grav: ground ? -420 : -120 });
  }
  // 6. Embers: slow glowing motes that float up out of the blast.
  const ne = Math.min(16, Math.round(r / 2.5));
  for (let i = 0; i < ne; i++) {
    const a = rnd(0, TAU), sp = rnd(10, 60);
    addFx({ type: 'ember', x: x + rnd(-r, r) * 0.4, y: y + rnd(-r, r) * 0.4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(1.2, 2.6), max: 2.6, size: rnd(1.2, 2.4), drag: 0.8, ground, h: 6, vh: ground ? rnd(20, 70) : rnd(-20, 20), seed: Math.random(), delay: rnd(0, 0.2) });
  }
  // 7. Debris chunks with smoke trails.
  if (r >= 10) {
    const nd = Math.min(18, 3 + Math.round(r / 3.5));
    for (let i = 0; i < nd; i++) {
      const a = rnd(0, TAU), sp = rnd(60, 230) * s;
      addFx({ type: 'debris', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(0.9, 1.8), max: 1.8, size: rnd(2, 4.5) * Math.min(1.6, s), rot: rnd(0, TAU), vr: rnd(-14, 14), drag: 1.1,
        col: pick(['#3b4148', '#55493f', '#2b2f33', '#6b5a48']), ground, h: 4, vh: ground ? rnd(80, 260) : rnd(-80, 60), grav: ground ? -380 : -300, heat: rnd(0.4, 1) });
    }
  }
  if (ground) {
    // Dust shockwave: a ring of low dust puffs racing outward along the ground.
    const nu = Math.min(16, 6 + Math.round(r / 3));
    for (let i = 0; i < nu; i++) {
      const a = (i / nu) * TAU + rnd(-0.2, 0.2), sp = rnd(90, 150) * s;
      addFx({ type: 'dust', x: x + Math.cos(a) * r * 0.3, y: y + Math.sin(a) * r * 0.3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(0.9, 1.4), max: 1.4, size: r * rnd(0.35, 0.55), grow: 2.2, drag: 2.6, ground, h: 2, rot: rnd(0, TAU), a: 0.45, col: '#6a5d50' });
    }
    V.decals.push({ x, y, r: r * rnd(0.95, 1.25), life: 45, max: 45, seed: Math.random(), hot: 1 });
    if (V.decals.length > 90) V.decals.shift();
    if (r >= 12) addFx({ type: 'emit', emit: 'column', x, y, life: rnd(3, 5) * m, max: 5 * m, size: r * 0.5, ground: true });
    if (r >= 14) addFx({ type: 'emit', emit: 'burn', x, y, life: rnd(2, 3.5) * m, max: 3.5 * m, size: r * 0.55, ground: true });
  }
  addTrauma(Math.min(0.45, (r / 70) ** 1.4));
  if (r >= 30) pulseCA(Math.min(1, r / 70));
  if (big && !ground) V.flashA = Math.max(V.flashA, Math.min(0.14, r / 300));
}

/** Flak air burst: a sharp flash, a ring of shrapnel and an oily black puff that hangs in the air. */
export function flakFx(x: number, y: number, r: number) {
  addFx({ type: 'flash', x, y, life: 0.08, max: 0.08, size: r * 1.8, col: '#fff3d0', h: 2 });
  addFx({ type: 'flash', x, y, life: 0.18, max: 0.18, size: r * 2.4, col: '#ffb347', h: 1 });
  addFx({ type: 'star', x, y, life: 0.12, max: 0.12, size: r * 2.2, col: '#ffe6a8', rot: rnd(0, TAU), h: 3 });
  addFx({ type: 'light', x, y, life: 0.3, max: 0.3, size: r * 3, str: r * 0.6, col: '#ffb347' });
  addFx({ type: 'shock', x, y, life: 0.3, max: 0.3, size: r * 3, str: 0.45 });
  for (let i = 0; i < 4; i++) {
    const a = rnd(0, TAU), d = rnd(0, r * 0.3);
    addFx({ type: 'puff', x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, vx: Math.cos(a) * rnd(6, 20), vy: Math.sin(a) * rnd(6, 20) + 10, life: rnd(1.8, 2.8), max: 2.8, size: r * rnd(0.4, 0.6), grow: 1.5, drag: 1.5, a: 0.92, rot: rnd(0, TAU), vr: rnd(-0.6, 0.6), heat: 1, delay: i * 0.02, col: '#4d4844' });
  }
  addFx({ type: 'fire', x, y, life: 0.22, max: 0.22, size: r * 0.55, grow: 0.8, heat: 1, rot: rnd(0, TAU) });
  for (let i = 0; i < 14; i++) {
    const a = rnd(0, TAU), sp = rnd(220, 460);
    addFx({ type: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(0.12, 0.3), max: 0.3, size: rnd(0.9, 1.5), drag: 4, tint: '#ffe0a0' });
  }
  addTrauma(0.04);
}

/** An energy discharge: white flash, a fast cyan shock front that bends the screen, sparks, no fire. */
export function energyBurst(x: number, y: number, r: number, col: string) {
  addFx({ type: 'flash', x, y, life: 0.14, max: 0.14, size: r * 3, col: '#ffffff', h: 8 });
  addFx({ type: 'flash', x, y, life: 0.4, max: 0.4, size: r * 6, col, h: 6 });
  addFx({ type: 'flare', x, y, life: 0.35, max: 0.35, size: r * 14, col, h: 8 });
  addFx({ type: 'light', x, y, life: 0.6, max: 0.6, size: r * 5, str: r * 0.8, col });
  addFx({ type: 'ring', x, y, life: 0.3, max: 0.3, size: r * 3, col: '#ffffff', h: 6, a: 1 });
  addFx({ type: 'ring', x, y, life: 0.65, max: 0.65, size: r * 5.2, col, h: 6, a: 0.9 });
  addFx({ type: 'ring', x, y, life: 0.9, max: 0.9, size: r * 6.5, col, h: 4, a: 0.4 });
  addFx({ type: 'shock', x, y, life: 0.75, max: 0.75, size: r * 10, str: 1 });
  for (let i = 0; i < 44; i++) {
    const a = rnd(0, TAU), sp = rnd(300, 900);
    addFx({ type: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(0.3, 0.7), max: 0.7, size: rnd(1.2, 2.2), drag: 2.5, tint: i % 3 ? col : '#ffffff', h: 6 });
  }
  addTrauma(0.45); pulseCA(0.8);
}

/**
 * The broadside: the signature moment. A wall of gun flashes down the hull side, a horizontal flare, a bank of
 * cordite smoke rolling outward, a pressure wave that bends the screen, and the whole view shoved away from the guns.
 * (x, y) is the hull side, side -1 port / 1 starboard, n guns, len the hull length.
 */
export function broadsideFx(x: number, y: number, side: number, n: number, len: number) {
  const span = len * 0.72, guns = Math.max(3, n * 2 + 1);
  for (let i = 0; i < guns; i++) {
    const yy = y + (i / (guns - 1) - 0.5) * span, d = rnd(0, 0.05);
    addFx({ type: 'flash', x: x + side * 14, y: yy, life: 0.13, max: 0.13, size: 46, col: '#ffe2b0', h: 10, delay: d });
    addFx({ type: 'star', x: x + side * 22, y: yy, life: 0.1, max: 0.1, size: 70, col: '#ffd9a0', rot: rnd(-0.3, 0.3), h: 12, delay: d });
    for (let j = 0; j < 2; j++) addFx({ type: 'smoke', x: x + side * rnd(16, 34), y: yy + rnd(-10, 10), vx: side * rnd(90, 220), vy: rnd(-25, 25), life: rnd(1.4, 2.2), max: 2.2, size: rnd(9, 15), grow: 2.6, drag: 2.2, a: 0.55, col: '#5a5550', heat: 1, rot: rnd(0, TAU), vr: rnd(-0.6, 0.6), delay: d + 0.02 });
    for (let j = 0; j < 3; j++) { const a = (side > 0 ? 0 : Math.PI) + rnd(-0.45, 0.45), sp = rnd(300, 700); addFx({ type: 'spark', x: x + side * 18, y: yy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(0.15, 0.35), max: 0.35, size: rnd(1, 1.8), drag: 3, h: 10, delay: d }); }
  }
  addFx({ type: 'flare', x: x + side * 60, y, life: 0.25, max: 0.25, size: 520 + n * 60, col: '#ffc070', h: 14 });
  addFx({ type: 'light', x: x + side * 50, y, life: 0.35, max: 0.35, size: 520, str: 30 + n * 6, col: '#ffb060' });
  addFx({ type: 'shock', x: x + side * 70, y, life: 0.45, max: 0.45, size: span * 1.2, str: 0.8 });
  kick(-side * (4 + 2 * Math.min(5, n)), 0);
  addTrauma(Math.min(0.4, 0.12 + 0.05 * n));
  pulseCA(Math.min(0.45, 0.15 + 0.06 * n));
}

/** Impact sparks (a projectile hitting something) with a small flash. */
export function spark(x: number, y: number, col: string, n: number) {
  if (WARHEAD_COLS[col]) { boomFx(x, y, 9, col); return; }
  for (let i = 0; i < n + 3; i++) {
    const a = rnd(0, TAU), sp = rnd(80, 300);
    addFx({ type: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(0.1, 0.32), max: 0.32, size: rnd(1, 1.7), drag: 3.5, tint: col, h: 2 });
  }
  addFx({ type: 'muzzle', x, y, life: 0.08, max: 0.08, size: 10, col });
  addFx({ type: 'ring', x, y, life: 0.16, max: 0.16, size: 22, col, h: 1, a: 0.6 });
}

/** A gun's muzzle event: star flash, a puff of gas and the hull light. */
export function muzzle(x: number, y: number, col: string, s = 9) {
  addFx({ type: 'muzzle', x, y, life: 0.07, max: 0.07, size: s, col, h: 4 });
  addFx({ type: 'star', x, y, life: 0.06, max: 0.06, size: s * 3.2, col, rot: rnd(-0.3, 0.3), h: 5 });
  if (s >= 12) addFx({ type: 'smoke', x, y, vx: rnd(-10, 10), vy: rnd(-20, 10), life: 0.6, max: 0.6, size: s * 0.6, grow: 2.2, a: 0.3, drag: 2, col: '#4a4c52', rot: rnd(0, TAU), heat: 0.5 });
  if (s >= V.muzzleE * 10) { V.muzzleX = x; V.muzzleY = y; V.muzzleCol = col; }
  V.muzzleE = Math.min(3, V.muzzleE + s / 10);
}

/** Rail aftermath: a lingering ionised channel, a screen-bending line, recoil and a chromatic kick. */
export function railFx(x1: number, y1: number, x2: number, y2: number, col: string, hostile = false) {
  addFx({ type: 'ion', x: x1, y: y1, x2, y2, life: 1.1, max: 1.1, size: hostile ? 16 : 10, col, str: 1 });
  addFx({ type: 'flash', x: x1, y: y1, life: 0.14, max: 0.14, size: 70, col: '#ffffff', h: 6 });
  addFx({ type: 'flare', x: x1, y: y1, life: 0.2, max: 0.2, size: 360, col, h: 6 });
  addFx({ type: 'light', x: x1, y: (y1 + y2) / 2, life: 0.3, max: 0.3, size: 380, str: 40, col });
  const n = Math.min(26, Math.round(Math.abs(y2 - y1) / 30));
  for (let i = 0; i < n; i++) {
    const k = Math.random(), x = x1 + (x2 - x1) * k, y = y1 + (y2 - y1) * k;
    addFx({ type: 'ember', x: x + rnd(-4, 4), y, vx: rnd(-30, 30), vy: rnd(-10, 10), life: rnd(0.5, 1.2), max: 1.2, size: rnd(1, 1.8), drag: 1, tint: col, h: 4, seed: Math.random() });
  }
  if (!hostile) { kick(0, 7); addTrauma(0.12); pulseCA(0.22); }
}

/* ---------------- simulation ---------------- */
function emitTick(f: Fx, dt: number) {
  const q = f.life / f.max;
  f.acc += dt;
  if (f.emit === 'column') {
    const every = 0.06 + (1 - q) * 0.12;
    while (f.acc > every) {
      f.acc -= every;
      addFx({ type: 'smoke', x: f.x + rnd(-0.3, 0.3) * f.size, y: f.y + rnd(-0.3, 0.3) * f.size, vx: rnd(4, 16), vy: rnd(-12, 2), life: rnd(2.4, 3.6), max: 3.6, size: f.size * rnd(0.7, 1.05), grow: 2.6, a: 0.7 * (0.4 + 0.6 * q), drag: 0.4, ground: true, h: 4, vh: rnd(30, 55), rot: rnd(0, TAU), vr: rnd(-0.4, 0.4), heat: 0.8 * q, col: '#47454a' });
    }
  } else if (f.emit === 'burn') {
    const every = 0.045;
    while (f.acc > every) {
      f.acc -= every;
      if (Math.random() < 0.25 + 0.75 * q) addFx({ type: 'fire', x: f.x + rnd(-0.45, 0.45) * f.size, y: f.y + rnd(-0.45, 0.45) * f.size, vx: rnd(-6, 6), vy: rnd(-8, 4), life: rnd(0.35, 0.7), max: 0.7, size: f.size * rnd(0.35, 0.6) * (0.5 + 0.5 * q), grow: 0.5, ground: true, h: 2, vh: rnd(16, 34), rot: rnd(0, TAU), vr: rnd(-1, 1), heat: rnd(0.55, 0.85) });
      if (Math.random() < 0.08) addFx({ type: 'ember', x: f.x + rnd(-0.4, 0.4) * f.size, y: f.y + rnd(-0.4, 0.4) * f.size, vx: rnd(-14, 14), vy: rnd(-14, 14), life: rnd(1, 2), max: 2, size: rnd(1, 1.8), ground: true, h: 4, vh: rnd(30, 70), drag: 0.6 });
    }
  } else if (f.emit === 'vent') {
    const every = 0.05;
    while (f.acc > every) { f.acc -= every; addFx({ type: 'smoke', x: f.x, y: f.y, vx: f.vx + rnd(-8, 8), vy: f.vy + rnd(-8, 8), life: 0.9, max: 0.9, size: f.size, grow: 2, a: 0.4, drag: 1, h: f.h, col: '#3a3b40', rot: rnd(0, TAU) }); }
  }
}

export function updateFx(dt: number, scroll: number) {
  absorbLegacyShake();
  const fx = V.fx; let w = 0;
  for (let i = 0; i < fx.length; i++) {
    const f = fx[i];
    // Ground things ride the scrolling city; smoke left in the air drifts back past the advancing ship.
    if (f.ground) f.y += scroll * dt;
    else if (f.type === 'smoke' || f.type === 'puff') f.y += scroll * 0.9 * dt;
    if (f.delay > 0) { f.delay -= dt; fx[w++] = f; continue; }
    f.life -= dt;
    if (f.life <= 0) { pool.push(f); continue; }
    f.x += f.vx * dt; f.y += f.vy * dt;
    if (f.drag) { const k = Math.max(0, 1 - dt * f.drag); f.vx *= k; f.vy *= k; if (f.type !== 'debris' && f.type !== 'spark') f.vh *= k; }
    if (f.vh || f.grav) {
      f.vh += f.grav * dt; f.h += f.vh * dt;
      if (f.ground && f.h < 0) {
        f.h = 0;
        if (f.type === 'debris' && f.vh < -40) { f.vh *= -0.25; f.vx *= 0.5; f.vy *= 0.5; f.vr *= 0.5; addFx({ type: 'dust', x: f.x, y: f.y, life: 0.6, max: 0.6, size: f.size * 2.5, grow: 2, a: 0.35, ground: true, h: 1, col: '#5d544a', rot: rnd(0, TAU) }); }
        else { f.vh = 0; f.vx *= 0.8; f.vy *= 0.8; f.vr *= 0.8; }
      }
    }
    if (f.vr) f.rot += f.vr * dt;
    if (f.type === 'debris') {
      f.acc += dt;
      if (f.acc > 0.035 && (f.h > 1 || !f.ground)) { f.acc = 0; addFx({ type: 'smoke', x: f.x, y: f.y, life: 0.7, max: 0.7, size: f.size * 1.6, grow: 1.8, a: 0.4, ground: f.ground, h: f.h, col: '#35363a', rot: rnd(0, TAU), heat: 0.4 * f.heat * (f.life / f.max) }); }
    } else if (f.type === 'emit') emitTick(f, dt);
    else if (f.type === 'ember') { f.vx += Math.sin(f.life * 5 + f.seed * 20) * 30 * dt; }
    fx[w++] = f;
  }
  fx.length = w;
  const ds = V.decals; let dw = 0;
  for (let i = 0; i < ds.length; i++) { const d = ds[i]; d.life -= dt; d.y += scroll * dt; d.hot = Math.max(0, d.hot - dt / 6); if (d.life > 0 && d.y < 1000) ds[dw++] = d; }
  ds.length = dw;
  V.flashA = Math.max(0, V.flashA - dt * 2.2);
  V.hurt = Math.max(0, V.hurt - dt * 2.5);
}
