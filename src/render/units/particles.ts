// Unit-owned particles in WORLD space: smoke trails of falling aircraft, wreck fires, track dust.
// They live between the flight plane and the ground, so they can't use the field-space VFX system.
// Struct-of-arrays, fixed capacity, no per-frame allocation. Drawn into the engine's quad batches.
import type { Engine } from '../engine';
import { rgb, Shape, DarkShape } from '../fx/quads';

export const enum PK { Smoke = 0, Fire = 1, Dust = 2, Spark = 3, Ember = 4 }
const CAP = 1800;
const SMOKE = rgb('#16181b'), SMOKE_WARM = rgb('#3a2a20'), DUST = rgb('#4a4337'), FIRE = [rgb('#fff1c8'), rgb('#ffb347'), rgb('#ff6a2a'), rgb('#a8300f')], SPARK = rgb('#ffcf7a');

export class Particles {
  n = 0;
  private f = new Float32Array(CAP * 12);
  /** Spawn: world position, velocity, life, size, growth (size multiplier per second), drift (0 air .. 1 ground scroll). */
  add(k: PK, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, grow: number, drift: number) {
    if (this.n >= CAP) return;
    const o = this.n++ * 12, f = this.f;
    f[o] = x; f[o + 1] = y; f[o + 2] = z; f[o + 3] = vx; f[o + 4] = vy; f[o + 5] = vz; f[o + 6] = life; f[o + 7] = life; f[o + 8] = size; f[o + 9] = grow; f[o + 10] = k; f[o + 11] = drift;
  }
  clear() { this.n = 0; }
  /** groundDrift: world units per second the ground scrolls (+Z); airDrift: same for the flight plane. */
  update(dt: number, groundDrift: number, airDrift: number) {
    const f = this.f; let w = 0;
    for (let i = 0; i < this.n; i++) {
      const o = i * 12;
      f[o + 6] -= dt; if (f[o + 6] <= 0) continue;
      const k = f[o + 10], drag = k === PK.Spark ? 1.5 : 0.8, d = Math.max(0, 1 - dt * drag);
      f[o + 3] *= d; f[o + 5] *= d;
      if (k === PK.Spark || k === PK.Ember) f[o + 4] -= 220 * dt; else f[o + 4] *= d;
      f[o] += f[o + 3] * dt; f[o + 1] += f[o + 4] * dt; f[o + 2] += (f[o + 5] + airDrift + (groundDrift - airDrift) * f[o + 11]) * dt;
      if (f[o + 1] < 0.5 && (k === PK.Spark || k === PK.Ember)) { f[o + 1] = 0.5; f[o + 4] *= -0.3; f[o + 3] *= 0.5; f[o + 5] *= 0.5; f[o + 11] = 1; }
      f[o + 8] *= 1 + f[o + 9] * dt;
      if (w !== i) f.copyWithin(w * 12, o, o + 12);
      w++;
    }
    this.n = w;
  }
  draw(e: Engine) {
    const f = this.f;
    for (let i = 0; i < this.n; i++) {
      const o = i * 12, q = f[o + 6] / f[o + 7], k = f[o + 10], s = f[o + 8], x = f[o], y = f[o + 1], z = f[o + 2];
      if (k === PK.Smoke) { const a = Math.min(1, (1 - q) * 6) * q * 0.75; e.dark.add(x, y, z, i, s, s, q > 0.75 ? SMOKE_WARM : SMOKE, a, DarkShape.Soft); }
      else if (k === PK.Dust) e.dark.add(x, y, z, i, s, s, DUST, q * 0.35 * Math.min(1, (1 - q) * 5), DarkShape.Soft);
      else if (k === PK.Fire) { const c = FIRE[Math.min(3, ((1 - q) * 4) | 0)]; e.glow.add(x, y, z, i * 0.7, s, s, c, q * 0.9, Shape.Hot); }
      else e.glow.add(x, y, z, 0, s, s, SPARK, q, Shape.Hot);
    }
  }
}
