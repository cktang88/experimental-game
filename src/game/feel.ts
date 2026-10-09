// Pure game-feel math: heavy-ship movement, hitstop and slow-motion. No DOM, no Three.js; unit tested.
// Hitstop numbers come from dead-air feel.js (kill 0.065 + 0.045 * weight, hit 0.012 + 0.014 * weight) capped and
// rate-limited the way tinwar's hitstop.ts does it (maxMs 60, cooldownMs 240) so a stream of kills never stutters.
// Big moments (elite kill, boss death, player heavy hit) bypass the cap with `force`.
// Slow-mo uses tinwar's slowmo.ts shape: rate 0.25, ramp in 100 ms, 1200 ms in all, ramp out over the last 300 ms.

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/* ---------------- movement ---------------- */
export interface MoveTune { topSpeed: number; accel: number; brake: number }
export interface Vel { x: number; y: number }

/**
 * One velocity step for a heavy ship. `wish` is a direction (length 0..1, longer is normalized).
 * Accelerates toward wish * topSpeed at `accel` (units/s²), brakes at `brake` when there is no input, and
 * reverses at accel + brake so a change of heart bites instead of drifting.
 */
export function stepShipVelocity(v: Vel, wish: Vel, t: MoveTune, dt: number): Vel {
  let wx = wish.x, wy = wish.y;
  const wl = Math.hypot(wx, wy);
  if (wl > 1) { wx /= wl; wy /= wl; }
  const tx = wx * t.topSpeed, ty = wy * t.topSpeed;
  const dx = tx - v.x, dy = ty - v.y, d = Math.hypot(dx, dy);
  if (d < 1e-6) return { x: tx, y: ty };
  const idle = wl < 1e-3;
  const reversing = !idle && v.x * wx + v.y * wy < 0;
  const rate = idle ? t.brake : reversing ? t.accel + t.brake : t.accel;
  const step = Math.min(d, rate * dt);
  return { x: v.x + (dx / d) * step, y: v.y + (dy / d) * step };
}

/**
 * The wish vector that flies a ship to a target point and arrives without overshoot: full thrust far away,
 * then the largest speed that can still brake to a stop in the remaining distance (v = sqrt(2·brake·d)).
 * Used for mouse/touch steering so drag and keyboard share the same physics.
 */
export function arriveWish(x: number, y: number, tx: number, ty: number, t: MoveTune): Vel {
  const dx = tx - x, dy = ty - y, d = Math.hypot(dx, dy);
  if (d < 2) return { x: 0, y: 0 };
  const want = Math.min(t.topSpeed, Math.sqrt(2 * t.brake * 0.8 * d));
  const k = want / t.topSpeed;
  return { x: (dx / d) * k, y: (dy / d) * k };
}

/** Bank angle input in -1..1 from lateral velocity, eased toward its target (renderers tilt the hull by it). */
export function stepBank(bank: number, vx: number, topSpeed: number, dt: number): number {
  const target = clamp(vx / Math.max(1, topSpeed), -1, 1);
  return bank + (target - bank) * Math.min(1, dt * 5);
}

/* ---------------- hitstop ---------------- */
export const HITSTOP = { maxS: 0.06, cooldownS: 0.24, elite: 0.12, bossDeath: 0.35, playerHurt: 0.1 } as const;

/** Freeze length in seconds (dead-air formula). weight = damage / 80. */
export function hitstopFor(kill: boolean, damage: number): number {
  const w = clamp(damage / 80, 0, 1);
  return kill ? 0.065 + 0.045 * w : 0.012 + 0.014 * w;
}

export interface StopState { left: number; since: number; total: number }
export const newStop = (): StopState => ({ left: 0, since: 99, total: 0 });

/**
 * Ask for a freeze. Ordinary requests are capped to HITSTOP.maxS for the whole freeze and are refused inside the
 * cooldown after one ended. Forced requests (elite, boss, heavy hit) always take, up to their own length.
 * Returns whether the freeze grew.
 */
export function requestStop(s: StopState, sec: number, force = false): boolean {
  if (sec <= 0) return false;
  if (force) {
    if (sec <= s.left) return false;
    s.left = sec; s.total = Math.max(s.total, sec); return true;
  }
  if (s.left > 0) {
    const room = Math.max(0, HITSTOP.maxS - (s.total - s.left));
    const want = Math.min(sec, room);
    if (want <= s.left) return false;
    s.left = want; return true;
  }
  if (s.since < HITSTOP.cooldownS) return false;
  s.left = Math.min(HITSTOP.maxS, sec); s.total = s.left; return true;
}

/** Advance real time. Returns true while the simulation should stay frozen this frame. */
export function stepStop(s: StopState, realDt: number): boolean {
  if (s.left > 0) {
    s.left -= realDt;
    if (s.left <= 0) { s.left = 0; s.since = 0; s.total = 0; }
    return true;
  }
  s.since += realDt;
  return false;
}

/* ---------------- slow-mo ---------------- */
export interface SlowShape { rate: number; rampIn: number; duration: number; rampOut: number }
export const SLOWMO: SlowShape = { rate: 0.25, rampIn: 0.1, duration: 1.2, rampOut: 0.3 };
/** A shorter dip for overdrive activation and big broadsides. */
export const SLOWMO_SHORT: SlowShape = { rate: 0.4, rampIn: 0.06, duration: 0.5, rampOut: 0.2 };
/** The long fall of a ghost dreadnought. */
export const SLOWMO_BOSS: SlowShape = { rate: 0.2, rampIn: 0.12, duration: 2.0, rampOut: 0.5 };

/** Time scale t seconds into a slow-mo: 1 before, `rate` through the hold, back to 1 at the end. */
export function slowSpeedAt(t: number, s: SlowShape = SLOWMO): number {
  if (t <= 0 || t >= s.duration) return 1;
  if (t < s.rampIn) return 1 + (s.rate - 1) * (t / s.rampIn);
  const out = s.duration - s.rampOut;
  if (t < out) return s.rate;
  return s.rate + (1 - s.rate) * ((t - out) / s.rampOut);
}

export interface SlowState { t: number; shape: SlowShape | null }
export const newSlow = (): SlowState => ({ t: 0, shape: null });
/** Start a slow-mo unless a deeper one is already running. */
export function requestSlow(s: SlowState, shape: SlowShape) {
  if (s.shape && s.shape.rate <= shape.rate && s.t < s.shape.duration - s.shape.rampOut) return;
  s.shape = shape; s.t = 0;
}
/** Advance by real dt; returns the time scale to apply to the simulation this frame. */
export function stepSlow(s: SlowState, realDt: number): number {
  if (!s.shape) return 1;
  const k = slowSpeedAt(s.t + realDt / 2, s.shape);
  s.t += realDt;
  if (s.t >= s.shape.duration) { s.shape = null; s.t = 0; }
  return k;
}
/** 0..1 intensity for the cinematic look (vignette, letterbox) while slow-mo runs. */
export function slowIntensity(s: SlowState): number {
  if (!s.shape) return 0;
  return clamp(1 - (slowSpeedAt(s.t, s.shape) - s.shape.rate) / (1 - s.shape.rate), 0, 1);
}

/* ---------------- carnage ---------------- */
export const CARNAGE = { grace: 1.6, decayBase: 8, decayFrac: 0.35, perMult: 80, maxMult: 3 } as const;
export interface Carnage { value: number; mult: number; since: number; peak: number }
export const newCarnage = (): Carnage => ({ value: 0, mult: 1, since: 99, peak: 1 });
export const carnageMult = (value: number) => Math.min(CARNAGE.maxMult, 1 + Math.max(0, value) / CARNAGE.perMult);
export function addCarnage(c: Carnage, amount: number) {
  if (amount <= 0) return;
  c.value = Math.min(CARNAGE.perMult * (CARNAGE.maxMult - 1), c.value + amount); c.since = 0; c.mult = carnageMult(c.value); c.peak = Math.max(c.peak, c.mult);
}
/** Decays after a short grace; the more you have, the faster it bleeds, so keeping x3 means never stopping. */
export function stepCarnage(c: Carnage, dt: number) {
  c.since += dt;
  if (c.since > CARNAGE.grace && c.value > 0) c.value = Math.max(0, c.value - (CARNAGE.decayBase + c.value * CARNAGE.decayFrac) * dt);
  c.mult = carnageMult(c.value);
}
