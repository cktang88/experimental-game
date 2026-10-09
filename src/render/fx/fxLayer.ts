// FX layer: projectiles, beams, pickups, particles and the explosion light pool.
// Baseline implementation; the VFX agent owns this file and src/render/fx/*.
import * as THREE from 'three';
import type { Engine, FrameCtx, Layer } from '../engine';
import { FIELD_H } from '../engine';
import { FIRE } from '../../game/vfx';
import { rgb, Shape, DarkShape } from './quads';
import { clamp, rnd } from '../../util/rng';

const v = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();

export function zigPts(x1: number, y1: number, x2: number, y2: number) {
  const n = Math.max(4, Math.round(Math.hypot(x2 - x1, y2 - y1) / 18)), pts = [x1, y1], nx = -(y2 - y1), ny = x2 - x1, l = Math.hypot(nx, ny) || 1;
  for (let i = 1; i < n; i++) { const k = i / n, o = rnd(-9, 9); pts.push(x1 + (x2 - x1) * k + (nx / l) * o, y1 + (y2 - y1) * k + (ny / l) * o); }
  pts.push(x2, y2); return pts;
}

export class FxLayer implements Layer {
  name = 'fx';
  lights: THREE.PointLight[] = [];
  constructor(private e: Engine) {
    for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xff8a3d, 0, 400, 1.6); e.scene.add(l); this.lights.push(l); }
  }
  /** Glow at a field point on the flight plane. */
  private gf(x: number, y: number, alt: number, size: number, col: string, al: number, shape = Shape.Hot) { this.e.toFlight(x, y, alt, v); this.e.glow.add(v.x, v.y, v.z, 0, size, size, rgb(col), al, shape); }
  /** Glow on the ground (size given in field units, scaled to look right from above). */
  private gg(x: number, y: number, lift: number, size: number, col: string, al: number, shape = Shape.Hot) { const k = this.e.groundScale; this.e.toGround(x, y, v); this.e.glow.add(v.x, lift * k, v.z, 0, size * k, size * k, rgb(col), al, shape); }
  private streak(x1: number, y1: number, x2: number, y2: number, alt: number, wid: number, col: string, al: number) {
    const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy); if (L < 0.01) return;
    this.e.toFlight((x1 + x2) / 2, (y1 + y2) / 2, alt, v); this.e.glow.add(v.x, v.y, v.z, Math.atan2(dy, dx), L + wid, wid, rgb(col), al, Shape.Streak);
  }
  private trail(t: number[] | undefined, col: string, w: number) {
    if (!t) return; for (let i = 2; i < t.length; i += 2) { const k = i / t.length; this.streak(t[i - 2], t[i - 1], t[i], t[i + 1], 4, 1.5 + w * k, col, 0.85 * k); }
  }
  /** Lerp between the flight plane (h=1) and the ground (h=0) for things falling through altitude. */
  private between(x: number, y: number, h: number, out: THREE.Vector3) { this.e.toFlight(x, y, 0, a); this.e.toGround(x, y, b); return out.lerpVectors(b, a, h); }

  clear() { for (const l of this.lights) l.intensity = 0; }

  update({ S, V, t }: FrameCtx) {
    const e = this.e, k = e.groundScale;
    for (const bl of S.eb) if (bl.kind === 'strike') {
      const q = bl.t / bl.delay;
      e.toFlight(bl.x, bl.y, -4, v);
      e.glow.add(v.x, v.y, v.z, 0, bl.rad * 2, bl.rad * 2, rgb('#ff3a2e'), 0.6 + 0.4 * Math.abs(Math.sin(bl.t * 14)), Shape.Ring);
      e.glow.add(v.x, v.y, v.z, 0, bl.rad * 2 * q, bl.rad * 2 * q, rgb('#ff5a4e'), 0.8, Shape.Ring);
    }
    for (const p of S.pb) {
      if (p.kind === 'bomb') { const q = p.life / p.max; this.between(p.x, p.y, Math.pow(q, 1.4), v); const s = 10 + (k - 1) * 10 * (1 - q); e.dark.add(v.x, v.y, v.z, 0, s * 0.5, s * 0.5, rgb('#2a2e33'), 1, DarkShape.Soft); e.glow.add(v.x, v.y + 1, v.z, 0, s * 1.6, s * 1.6, rgb(p.col), 0.55 + 0.35 * Math.sin(t * 45), Shape.Hot); continue; }
      if (p.kind === 'shell') { const q = 1 - p.life / p.max; for (let j = 0; j < 8; j++) { const qq = q - j * 0.025; if (qq < 0) break; this.between(p.sx + (p.tx - p.sx) * qq, p.sy + (p.ty - p.sy) * qq, 1 - qq + Math.sin(qq * Math.PI) * 0.25, v); e.glow.add(v.x, v.y, v.z, 0, j ? 20 - j : 28, j ? 20 - j : 28, rgb(p.col), j ? 0.5 * (1 - j / 8) : 1, j ? Shape.Soft : Shape.Hot); } continue; }
      if (p.kind === 'missile') { this.trail(p.trail, p.col, 3); const sp = Math.hypot(p.vx, p.vy) || 1; this.gf(p.x - (p.vx / sp) * 6, p.y - (p.vy / sp) * 6, 6, 18 + Math.random() * 6, '#ffb347', 0.95); continue; }
      const sp = Math.hypot(p.vx, p.vy) || 1, ux = p.vx / sp, uy = p.vy / sp, L = clamp(sp * 0.04, 10, 34);
      this.streak(p.x, p.y, p.x - ux * L * 1.7, p.y - uy * L * 1.7, 6, p.r * 3.6, p.col, 0.4);
      this.streak(p.x, p.y, p.x - ux * L, p.y - uy * L, 6, p.r * 1.6, p.col, 1.1);
      if (p.kind === 'flak') this.gf(p.x, p.y, 6, 26, p.col, 0.85);
    }
    for (const bl of S.eb) {
      if (bl.kind === 'strike') continue;
      if (bl.kind === 'beam') {
        if (bl.t < bl.warn) { const q = bl.t / bl.warn; this.gf(bl.x, bl.y, 8, 20 + 70 * q, bl.col, 0.95); this.streak(bl.x, bl.y, bl.x, FIELD_H + 60, 2, 2 + 4 * q, '#ff5a4e', 0.35 + 0.5 * Math.abs(Math.sin(bl.t * 22))); }
        else { const q = 1 - (bl.t - bl.warn) / bl.dur; this.streak(bl.x, bl.y, bl.x, FIELD_H + 60, 2, bl.w * 3.6, bl.col, 0.4 * q); this.streak(bl.x, bl.y, bl.x, FIELD_H + 60, 3, bl.w * 1.2, bl.col, q); this.streak(bl.x, bl.y, bl.x, FIELD_H + 60, 4, bl.w * 0.45, '#ffffff', q); this.gf(bl.x, bl.y, 8, 110, bl.col, q); }
        continue;
      }
      if (bl.kind === 'missile') { this.trail(bl.trail, '#ff6a3d', 3); const sp = Math.hypot(bl.vx, bl.vy) || 1; this.gf(bl.x - (bl.vx / sp) * 6, bl.y - (bl.vy / sp) * 6, 6, 20 + Math.random() * 6, '#ff7a3d', 0.95); continue; }
      const sp = Math.hypot(bl.vx, bl.vy);
      if (sp > 20) this.streak(bl.x, bl.y, bl.x - (bl.vx / sp) * bl.r * 4.5, bl.y - (bl.vy / sp) * bl.r * 4.5, 5, bl.r * 1.8, bl.col, 0.55);
      const pulse = bl.kind === 'mine' || bl.kind === 'orb' ? 1 + 0.4 * Math.sin(bl.t * 16) : 1;
      this.gf(bl.x, bl.y, 6, bl.r * 8 * pulse, bl.col, 0.95);
      this.gf(bl.x, bl.y, 7, bl.r * 2.6, '#ffffff', 0.9, Shape.Soft);
    }
    for (const bm of S.beams) {
      const q = bm.life / bm.max;
      if (bm.zig) { const p = zigPts(bm.x1, bm.y1, bm.x2, bm.y2); for (let i = 2; i < p.length; i += 2) { this.streak(p[i - 2], p[i - 1], p[i], p[i + 1], 8, 10, bm.col, 0.35 * q); this.streak(p[i - 2], p[i - 1], p[i], p[i + 1], 9, 3, '#ffffff', q); } this.gf(bm.x2, bm.y2, 8, 34, bm.col, q); }
      else { this.streak(bm.x1, bm.y1, bm.x2, bm.y2, 7, bm.w * 4.4, bm.col, 0.3 * q); this.streak(bm.x1, bm.y1, bm.x2, bm.y2, 8, bm.w * 1.3, bm.col, q); if (bm.w > 2) this.streak(bm.x1, bm.y1, bm.x2, bm.y2, 9, bm.w * 0.45, '#ffffff', q); }
    }
    for (const p of S.pickups) {
      if (p.kind === 'repair') this.gf(p.x, p.y, -6, 30, '#8fe39a', 0.7 + 0.3 * Math.sin(p.t * 8));
      else this.gf(p.x, p.y, -6, 18, '#e0c35c', 0.6 + 0.3 * Math.sin(p.t * 10));
    }
    const lights: typeof V.fx = [];
    for (const f of V.fx) {
      const q = f.life / f.max, gp = !!f.ground;
      const glow = (size: number, col: string, al: number, shape: number, lift = 6) => gp ? this.gg(f.x, f.y, lift, size, col, al, shape) : this.gf(f.x, f.y, lift + 6, size, col, al, shape);
      switch (f.type) {
        case 'fire': { const s = f.size * (0.6 + (1 - q) * (f.grow || 0)); glow(s * 1.9, FIRE[Math.min(4, 1 + Math.floor((1 - q) * 4))], Math.min(0.55, q * 0.8), Shape.Soft); break; }
        case 'spark': { const sp = Math.hypot(f.vx, f.vy) || 1, L = Math.min(18, sp * 0.055) + 1; if (gp) glow(f.size * 3, f.tint || '#ffc35a', Math.min(1, q * 1.6), Shape.Hot); else this.streak(f.x, f.y, f.x - (f.vx / sp) * L, f.y - (f.vy / sp) * L, 13, f.size * 2.2, f.tint || (q > 0.6 ? '#fff3c4' : q > 0.3 ? '#ffc35a' : '#ff6a3d'), Math.min(1, q * 1.6)); break; }
        case 'flash': glow(f.size * 1.7 * (0.5 + 0.5 * q), f.col!, q * 0.55, Shape.Hot, 8); break;
        case 'muzzle': glow(f.size * 2.4 * (0.7 + 0.3 * q), f.col!, q * 1.2, Shape.Hot, 8); break;
        case 'light': lights.push(f); if (lights.length <= 10) glow(f.size * 2, f.col!, q * 0.16, Shape.Soft, 1); break;
        case 'ring': { const d = 2 * (f.size * (1 - q * q * q) + 1); glow(d, f.col!, q * 0.8, Shape.Ring); break; }
        case 'smoke': { const s = f.size * (1 + (1 - q) * (f.grow || 0)) * 2; if (gp) { e.toGround(f.x, f.y, v); e.dark.add(v.x, 8 * k, v.z, 0, s * k, s * k, rgb('#3b3b41'), q * (f.a || 0.5), DarkShape.Soft); } else { e.toFlight(f.x, f.y, 14, v); e.dark.add(v.x, v.y, v.z, 0, s, s, rgb('#3b3b41'), q * (f.a || 0.5), DarkShape.Soft); } break; }
        case 'debris': glow(f.size * 1.8, '#ff9a4a', q * 0.6, Shape.Soft, 4); break;
      }
    }
    for (const dc of V.decals) { e.toGround(dc.x, dc.y, v); e.dark.add(v.x, 0.8, v.z, 0, dc.r * 2 * k, dc.r * 1.7 * k, rgb('#060504'), Math.min(1, dc.life / 3) * 0.85, DarkShape.Soft); }
    lights.sort((p, q) => (q.size * q.life) / q.max - (p.size * p.life) / p.max);
    this.lights.forEach((l, i) => {
      const f = lights[i]; if (!f) { l.intensity = 0; return; }
      const q = f.life / f.max;
      if (f.ground) { e.toGround(f.x, f.y, v); v.y = 40 * k; } else e.toFlight(f.x, f.y, 60, v);
      l.position.copy(v); l.intensity = q * 4e5; l.distance = f.size * 4 * (f.ground ? k : 1);
    });
  }
}
