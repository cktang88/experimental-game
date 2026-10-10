// Unit layer: every enemy, elite and salvage object, plus their deaths.
//
// Air units fly on the flight plane; ground units sit on the ground plane scaled by groundScale
// (see engine.ts). Every part of every unit is an instance in a per-type InstancedMesh (pool.ts),
// painted by the shared livery shader (livery.ts). Lights, rotor discs, afterburners, contrails,
// headlight cones and muzzle flashes are drawn into the engine's glow/dark quad batches.
//
// Lifecycle: combat removes dead enemies from S.enemies at once. This layer keeps a visual (Vis) per
// enemy; when its enemy disappears on screen, the visual plays a death: aircraft fall burning and
// spinning, trailing smoke, and crash into the city (impact flash on the ground); ground units
// become burning, charred wrecks that scroll away with the ground. Nothing pops in or out.
import * as THREE from 'three';
import type { Engine, FrameCtx, Layer } from '../engine';
import { FIELD_W, FIELD_H } from '../engine';
import type { Enemy } from '../../game/combat';
import type { EnemyType } from '../../data/enemies';
import { boomFx } from '../../game/vfx';
import { rgb, Shape, DarkShape } from '../fx/quads';
import { loadUnitsKit, unitsKitReady } from './kit';
import { liveryUniforms } from './livery';
import { buildSpecs, type UnitSpec, type PartDef } from './specs';
import { Particles, PK } from './particles';
import type { InstPool } from './pool';

const TAU = Math.PI * 2;
const enum St { Alive = 0, Falling = 1, Wreck = 2, Vanish = 3, Corpse = 4 }
const TRAIL = 16;

interface Vis {
  en: Enemy | null; spec: UnitSpec; type: EnemyType; stamp: number;
  x: number; y: number; px: number; py: number; vx: number; vy: number; alt: number;
  yaw: number; pitch: number; roll: number; sc: number; heads: Float32Array; rack: number;
  flash: number; burn: number; age: number; born: number; seed: number;
  state: St; st: number; dur: number; spin: number; rollV: number; h: number; sink: number;
  lastCd: number; lastBurst: number; muzzleT: number; recoil: number; emit: number;
  pop: Float32Array; trail: Float32Array; trailN: number; trailHead: number;
}

// Scratch objects (no per-frame allocation).
const U = new THREE.Matrix4(), SQ = new THREE.Matrix4(), SQ2 = new THREE.Matrix4(), P = new THREE.Matrix4(), T1 = new THREE.Matrix4(), R1 = new THREE.Matrix4(), S1 = new THREE.Matrix4(), H = new THREE.Matrix4();
const q = new THREE.Quaternion(), eu = new THREE.Euler(0, 0, 0, 'YXZ'), vpos = new THREE.Vector3(), vsc = new THREE.Vector3();
const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), vfwd = new THREE.Vector3();
const C = {
  port: rgb('#ff2a1f'), stbd: rgb('#33ff77'), strobe: rgb('#ffffff'), beacon: rgb('#ff3b2e'), engine: rgb('#ffb070'), engineHot: rgb('#ff6a3d'),
  head: rgb('#fff1d6'), cone: rgb('#ffe2b0'), scrap: rgb('#ffc24a'), deck: rgb('#ffcf8a'), fire: rgb('#ff7a2d'), fireHot: rgb('#ffd27a'),
  muzzle: rgb('#ffcf7a'), contrail: rgb('#b9c6d4'), shadow: rgb('#000000'), mark: rgb('#ff5a4e'), markScrap: rgb('#ffc24a'),
};
/**
 * Display scale over the gameplay size: enemies are drawn chunky (Blackhawk Striker readable) while the city
 * below is shrunk to sell the dreadnought's size. Hit radii are unchanged (src/data/enemies.ts).
 */
const DISP_AIR = 1.25, DISP_GROUND = 1.4;
/** Air units' drop shadows land this far (field units) down-right of them: the moon is up-left. */
const SHADOW_DX = 34, SHADOW_DY = 44;
const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const wrap = (a: number) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
const slew = (a: number, b: number, rate: number) => { const d = wrap(b - a); return a + Math.max(-rate, Math.min(rate, d)); };
const hash = (n: number) => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };

/** Per-type motion feel. */
const HEAD_RATE: Partial<Record<EnemyType, number>> = { tank: 2.2, turret: 3.2, crawler: 1.5, sam: 0.8 };
const FALL: Partial<Record<EnemyType, number>> = { drone: 0.9, jet: 1.2, heli: 1.6, gunship: 1.9, bomber: 2.3, ace: 2.8, carrier: 3.4 };

export class UnitLayer implements Layer {
  name = 'units';
  specs: Partial<Record<EnemyType, UnitSpec>> | null = null;
  vis = new Map<Enemy, Vis>(); dying: Vis[] = []; free: Vis[] = [];
  parts = new Particles();
  pools: InstPool[] = [];
  frame = 0; lastT = -1; time = 0; airDrift = 0;
  constructor(private engine: Engine) {
    loadUnitsKit().then(() => {
      if (!unitsKitReady()) return;
      this.specs = buildSpecs(engine.scene);
      const set = new Set<InstPool>();
      for (const s of Object.values(this.specs)) for (const p of s!.parts) set.add(p.pool);
      this.pools = [...set];
    });
    (window as unknown as { __gdUnits: UnitLayer }).__gdUnits = this;
  }

  clear() {
    for (const v of this.vis.values()) this.release(v);
    for (const v of this.dying) this.release(v);
    this.vis.clear(); this.dying.length = 0; this.parts.clear();
    for (const p of this.pools) { p.begin(); p.end(); }
  }
  private release(v: Vis) { v.en = null; this.free.push(v); }

  private make(en: Enemy, spec: UnitSpec, S: FrameCtx['S']): Vis {
    const v = this.free.pop() ?? ({ heads: new Float32Array(3), pop: new Float32Array(8), trail: new Float32Array(TRAIL * 6) } as Vis);
    const onscreen = en.x > 0 && en.x < FIELD_W && en.y > 8 && en.y < FIELD_H;
    Object.assign(v, {
      en, spec, type: en.type, stamp: this.frame, x: en.x, y: en.y, px: en.x, py: en.y, vx: en.vx ?? 0, vy: 0, alt: 0,
      yaw: 0, pitch: 0, roll: 0, sc: 1, rack: 0, flash: 0, burn: 0, age: 0, born: onscreen ? 1 : 0, seed: Math.random() * 1000,
      state: St.Alive, st: 0, dur: 0, spin: 0, rollV: 0, h: 1, sink: 0, lastCd: en.cd, lastBurst: en.burst ?? 0, muzzleT: 0, recoil: 0, emit: 0,
      trailN: 0, trailHead: 0,
    });
    v.pop.fill(0);
    v.yaw = this.baseYaw(v, en, S);
    for (let i = 0; i < 3; i++) v.heads[i] = this.headTarget(v, en, S, i);
    return v;
  }

  /** Hull heading the unit wants (radians about Y; 0 = nose down the screen). */
  private baseYaw(v: Vis, en: Enemy, S: FrameCtx['S']) {
    switch (en.type) {
      case 'tank': return (en.vx ?? 0) >= 0 ? Math.PI / 2 : -Math.PI / 2;
      case 'bomber': return (en.vx ?? 0) >= 0 ? Math.PI / 2 : -Math.PI / 2;
      case 'jet': case 'drone': { const sp = Math.hypot(v.vx, v.vy); return sp > 20 ? Math.atan2(v.vx, v.vy) : 0; }
      case 'infantry': { const p = S.P; return p ? Math.atan2(p.x - en.x, p.y - en.y) : 0; }
      case 'wreck': return en.ang;
      case 'sam': case 'cache': case 'bunker': case 'turret': return (hash(v.seed) - 0.5) * 1.2 + (en.type === 'sam' ? Math.PI / 2 * (hash(v.seed + 1) > 0.5 ? 1 : -1) : 0);
      case 'crawler': return 0;
      default: return 0;
    }
  }
  /** Turret head yaw relative to the hull. */
  private headTarget(v: Vis, en: Enemy, S: FrameCtx['S'], i: number) {
    const p = S.P;
    if (en.type === 'crawler' && p) { const ox = (i - 1) * 32; return wrap(Math.atan2(p.x - (en.x + ox), p.y - en.y) - v.yaw); }
    if (en.type === 'sam' && p) return wrap(Math.atan2(p.x - en.x, p.y - en.y) - v.yaw);
    return wrap(Math.PI / 2 - en.ang - v.yaw);
  }

  update(ctx: FrameCtx) {
    const { S } = ctx, e = this.engine;
    this.frame++;
    // Combat time drives everything, so pause and slow-motion apply to deaths too.
    let dt = this.lastT < 0 ? 0 : S.t - this.lastT; this.lastT = S.t;
    if (dt < 0 || dt > 0.25) dt = 0;
    this.time += dt; liveryUniforms.uTime.value = this.time; this.airDrift = S.scroll * dt;
    if (!this.specs) return;
    const specs = this.specs;

    // ---- live enemies
    for (const en of S.enemies as Enemy[]) {
      const spec = specs[en.type]; if (!spec) continue;
      let v = this.vis.get(en);
      if (!v) { v = this.make(en, spec, S); this.vis.set(en, v); }
      v.stamp = this.frame;
      this.live(v, en, S, dt);
    }
    // ---- removed enemies: die on screen, vanish quietly off screen
    for (const [en, v] of this.vis) {
      if (v.stamp === this.frame) continue;
      this.vis.delete(en);
      const onscreen = v.x > -30 && v.x < FIELD_W + 30 && v.y > -30 && v.y < FIELD_H + 40;
      if (en.hp <= 0 || onscreen) this.startDeath(v, S); else this.release(v);
    }
    // ---- deaths
    let w = 0;
    for (let i = 0; i < this.dying.length; i++) {
      const v = this.dying[i];
      if (this.die(v, S, dt)) this.dying[w++] = v; else this.release(v);
    }
    this.dying.length = w;
    while (this.dying.length > 70) this.release(this.dying.shift()!);

    // ---- draw
    for (const p of this.pools) p.begin();
    for (const v of this.vis.values()) this.draw(v, e);
    for (const v of this.dying) this.draw(v, e);
    for (const p of this.pools) p.end();
    const k = e.groundScale;
    this.parts.update(dt, S.scroll * k, S.scroll);
    this.parts.draw(e);
  }

  /* ------------------------------------------------------------ alive */
  private live(v: Vis, en: Enemy, S: FrameCtx['S'], dt: number) {
    v.age += dt;
    if (dt > 0) {
      const ivx = (en.x - v.x) / dt, ivy = (en.y - v.y - (en.layer === 'ground' && en.type !== 'crawler' ? S.scroll * dt : 0)) / dt;
      const a = Math.min(1, dt * 6); v.vx += (ivx - v.vx) * a; v.vy += (ivy - v.vy) * a;
    }
    v.px = v.x; v.py = v.y; v.x = en.x; v.y = en.y;
    v.flash = Math.max(0, Math.min(1, en.flash / 0.07));
    const spec = v.spec, air = spec.air;
    // heading
    const target = this.baseYaw(v, en, S);
    const turn = en.type === 'tank' ? 1.8 : en.type === 'infantry' ? 6 : air ? 4 : 0;
    v.yaw = turn ? slew(v.yaw, target, turn * dt) : target;
    const rate = HEAD_RATE[en.type] ?? 3;
    for (let i = 0; i < spec.heads.length; i++) v.heads[i] = slew(v.heads[i], this.headTarget(v, en, S, i), rate * dt);
    // attitude
    if (air) {
      const bank = en.type === 'jet' || en.type === 'drone' ? -wrap(target - v.yaw) * 1.4 : -v.vx * 0.006;
      v.roll += (Math.max(-0.5, Math.min(0.5, bank)) - v.roll) * Math.min(1, dt * 4);
      const pitch = en.type === 'heli' || en.type === 'gunship' || en.type === 'ace' ? Math.max(-0.2, Math.min(0.25, v.vy * 0.0025)) : 0;
      v.pitch += (pitch - v.pitch) * Math.min(1, dt * 3);
      const hover = en.type === 'heli' || en.type === 'gunship' || en.type === 'ace' || en.type === 'carrier' || en.type === 'canister' ? Math.sin(v.age * 1.7 + v.seed) * 3 : 0;
      v.alt = hover + (v.born ? 0 : spec.revealAlt * (1 - ease(v.age / (en.type === 'jet' ? 0.7 : 1.3))));
      if (en.type === 'drone') v.roll += Math.sin(v.age * 23 + v.seed) * 0.04; // drones jitter
    } else if (en.type === 'infantry') {
      v.alt = Math.abs(Math.sin(v.age * 9 + v.seed)) * 0.6;
    }
    v.sc = v.born ? Math.min(1, ease(v.age / 0.35) * 1.08) : 1;
    if (v.born && v.age < 0.35) v.flash = Math.max(v.flash, 1 - v.age / 0.35);
    // firing: cooldown reset or a burst shot means a muzzle event
    const fired = (en.cd ?? 0) > v.lastCd + 0.4 || (en.burst ?? 0) < v.lastBurst;
    v.lastCd = en.cd ?? 0; v.lastBurst = en.burst ?? 0;
    if (fired && spec.muzzles.length) { v.muzzleT = 0.08; v.recoil = 1; }
    v.muzzleT = Math.max(0, v.muzzleT - dt); v.recoil = Math.max(0, v.recoil - dt * 4);
    if (en.type === 'sam' && fired) { this.worldOf(v, 0, vb.set(0, 9, 2)); for (let i = 0; i < 6; i++) this.parts.add(PK.Dust, vb.x, vb.y, vb.z, (Math.random() - 0.5) * 30, 8, (Math.random() - 0.5) * 30, 1.4, 14 * this.engine.groundScale, 1.2, 1); }
    // track dust
    if (spec.tracks && Math.abs(v.vx) > 4 && dt > 0) {
      v.emit += dt;
      while (v.emit > 0.06) {
        v.emit -= 0.06;
        for (const s of [-1, 1]) {
          this.worldOf(v, -1, vb.set(s * spec.tracks, 1, -spec.size * 0.85));
          const k = this.engine.groundScale;
          this.parts.add(PK.Dust, vb.x, vb.y, vb.z, (Math.random() - 0.5) * 10 * k, 2, (Math.random() - 0.5) * 10 * k, 1.1, spec.size * 0.5 * k, 1.4, 1);
        }
      }
    }
  }

  /* ------------------------------------------------------------ deaths */
  private startDeath(v: Vis, S: FrameCtx['S']) {
    v.st = 0; v.flash = 0;
    const big = v.spec.size;
    if (v.type === 'canister') { v.state = St.Vanish; v.dur = 0.3; }
    else if (v.type === 'infantry') { v.state = St.Corpse; v.dur = 4; }
    else if (v.spec.air) {
      v.state = St.Falling; v.dur = FALL[v.type] ?? 1.6;
      const r = Math.random() < 0.5 ? -1 : 1;
      v.spin = r * (1.5 + Math.random() * 2.5) * (14 / (big + 6)) * 2.2;
      v.rollV = -r * (1 + Math.random() * 2);
      v.vx = Math.max(-160, Math.min(160, v.vx)); v.vy = Math.max(-80, Math.min(200, v.vy));
    } else {
      v.state = St.Wreck; v.dur = 0;
      // turrets are blown off the hull: ballistic offset (pop[0..2]) with velocity (pop[3..5])
      if (v.spec.heads.length && v.type !== 'crawler') { const a = Math.random() * TAU; v.pop[3] = Math.cos(a) * 14; v.pop[4] = 46; v.pop[5] = Math.sin(a) * 14; v.pop[6] = (Math.random() - 0.5) * 6; }
    }
    void S;
    this.dying.push(v);
  }

  /** Advances a death; returns false when the visual is finished. */
  private die(v: Vis, S: FrameCtx['S'], dt: number): boolean {
    v.st += dt; const e = this.engine, k = e.groundScale;
    switch (v.state) {
      case St.Vanish: v.sc = 1 - ease(v.st / v.dur); v.flash = 1; return v.st < v.dur;
      case St.Corpse: {
        v.y += S.scroll * dt; v.pitch = -ease(v.st / 0.25) * 1.45; v.burn = 0.5; v.alt = 0;
        v.sink = Math.max(0, v.st - 2.6) * 4; return v.st < v.dur && v.y < FIELD_H + 60;
      }
      case St.Falling: {
        const f = Math.min(1, v.st / v.dur);
        v.h = 1 - f * f;
        v.x += v.vx * dt; v.y += v.vy * dt; v.vx *= 1 - dt * 0.6; v.vy *= 1 - dt * 0.6;
        v.yaw += v.spin * dt; v.roll += v.rollV * dt; v.pitch += (0.7 - v.pitch) * Math.min(1, dt * 1.5);
        v.burn = Math.min(1, v.st * 2); v.alt = 0;
        // smoke trail and fire
        this.position(v, vpos);
        v.emit += dt;
        const step = v.spec.size > 30 ? 0.02 : 0.035;
        while (v.emit > step) {
          v.emit -= step;
          const s = v.spec.size;
          this.parts.add(PK.Smoke, vpos.x + (Math.random() - 0.5) * s * 0.4, vpos.y - s * 0.3, vpos.z + (Math.random() - 0.5) * s * 0.4, 0, 6, 0, 1.6 + s * 0.03, s * 0.55, 1.4, 1 - v.h);
          this.parts.add(PK.Fire, vpos.x, vpos.y + 2, vpos.z, (Math.random() - 0.5) * 20, 0, (Math.random() - 0.5) * 20, 0.35, s * 0.9, 0.6, 1 - v.h);
        }
        if (f >= 1) {
          // impact: flash and fireball on the ground, then a burning wreck that scrolls with the city
          boomFx(v.x, v.y, Math.min(48, v.spec.size * 1.1), '#ff8a3d', true);
          v.state = St.Wreck; v.st = 0; v.h = 0; v.burn = 1;
          v.pitch = (Math.random() - 0.5) * 0.4; v.roll = (Math.random() - 0.5) * 0.7; v.sink = v.spec.size * 0.12;
          for (let i = 0; i < 14; i++) { const a = Math.random() * TAU, sp = 40 + Math.random() * 90; this.parts.add(PK.Spark, vpos.x, 2, vpos.z, Math.cos(a) * sp, 60 + Math.random() * 120, Math.sin(a) * sp, 0.6 + Math.random() * 0.5, 3, 0, 1); }
        }
        return true;
      }
      case St.Wreck: {
        if (!v.spec.air || v.h <= 0) v.y += S.scroll * dt;
        if (!v.spec.air) v.burn = Math.min(1, v.st / 0.35);
        // turret popped off the hull: fly, fall, land
        if (v.pop[4] !== 0 || v.pop[1] > 0) {
          v.pop[0] += v.pop[3] * dt; v.pop[1] += v.pop[4] * dt; v.pop[2] += v.pop[5] * dt; v.pop[4] -= 120 * dt; v.pop[7] += v.pop[6] * dt;
          if (v.pop[1] < -2 && v.pop[4] < 0) { v.pop[1] = -2; v.pop[3] = v.pop[4] = v.pop[5] = v.pop[6] = 0; }
        }
        // fire and smoke from the wreck, dying down over time
        const heat = Math.max(0, 1 - v.st / 14);
        if (heat > 0) {
          this.position(v, vpos); v.emit += dt;
          const step = 0.08 / (0.4 + heat), s = v.spec.size * (v.spec.air ? 1 : k);
          while (v.emit > step) {
            v.emit -= step;
            this.parts.add(PK.Smoke, vpos.x + (Math.random() - 0.5) * s * 0.5, vpos.y + 2, vpos.z + (Math.random() - 0.5) * s * 0.5, 0, 22 + Math.random() * 12, 0, 2.2, s * 0.7, 1.0, 1);
            if (Math.random() < heat) this.parts.add(PK.Fire, vpos.x + (Math.random() - 0.5) * s * 0.5, vpos.y + 3, vpos.z + (Math.random() - 0.5) * s * 0.5, 0, 10, 0, 0.5, s * 0.55 * (0.5 + heat), 0.4, 1);
          }
        }
        return v.y < FIELD_H + 140 && v.st < 40;
      }
    }
    return false;
  }

  /* ------------------------------------------------------------ transforms */
  /** World position of the unit root. */
  private position(v: Vis, out: THREE.Vector3) {
    const e = this.engine;
    if (v.spec.air && v.state !== St.Wreck) {
      if (v.state === St.Falling) { e.toFlight(v.x, v.y, 0, va); e.toGround(v.x, v.y, vb); out.lerpVectors(vb, va, v.h); out.y += 6; return out; }
      return e.toFlight(v.x, v.y, v.alt, out);
    }
    e.toGround(v.x, v.y, out); out.y += (v.alt - v.sink) * (v.spec.air ? 1 : e.groundScale);
    if (v.spec.air) out.y += 2;
    return out;
  }
  /** Unit root matrix into U. */
  private rootMatrix(v: Vis) {
    const air = v.spec.air, s = (air ? DISP_AIR : this.engine.groundScale * DISP_GROUND) * v.sc;
    this.position(v, vpos);
    q.setFromEuler(eu.set(v.pitch, v.yaw, v.roll, 'YXZ'));
    return U.compose(vpos, q, vsc.set(s, s, s));
  }
  /** World position of a point in the unit frame (head < 0) or a head's frame. Uses the current U. */
  private worldOf(v: Vis, head: number, p: THREE.Vector3) {
    this.rootMatrix(v);
    if (head >= 0) { this.headMatrix(v, head); return p.applyMatrix4(H); }
    return p.applyMatrix4(U);
  }
  /** Head frame (pivot, yaw, recoil, pop) into H, from U. */
  private headMatrix(v: Vis, i: number) {
    const piv = v.spec.heads[i];
    const pop = v.state === St.Wreck && v.type !== 'crawler';
    T1.makeTranslation(piv.x + (pop ? v.pop[0] : 0), piv.y + (pop ? v.pop[1] : 0), piv.z + (pop ? v.pop[2] : 0));
    q.setFromEuler(eu.set(pop ? v.pop[7] * 0.5 : 0, v.heads[i] + (pop ? v.pop[7] : 0), pop ? v.pop[7] * 0.3 : 0, 'YXZ'));
    R1.makeRotationFromQuaternion(q);
    return H.multiplyMatrices(U, T1).multiply(R1);
  }
  private partMatrix(v: Vis, p: PartDef) {
    if (p.anim === 'none') return U;
    if (p.anim === 'head') {
      this.headMatrix(v, p.head);
      if (v.recoil > 0 && v.state === St.Alive) H.multiply(T1.makeTranslation(0, 0, -v.recoil * 1.2));
      S1.makeScale(p.scale, p.scale, p.scale); T1.makeTranslation(-p.origin.x, -p.origin.y, -p.origin.z);
      return P.multiplyMatrices(H, S1).multiply(T1);
    }
    let a = 0, ax = 0;
    const t = this.time + v.seed;
    switch (p.anim) {
      case 'rotor': a = v.state === St.Wreck ? 0.3 : t * p.speed; break;
      case 'rotorV': a = t * p.speed; ax = 1; break;
      case 'spin': a = t * p.speed; break;
      case 'dish': a = v.state === St.Wreck ? 0.7 : t * p.speed; break;
      case 'rack': a = v.heads[p.head] ?? 0; break;
    }
    T1.makeTranslation(p.pivot.x, p.pivot.y, p.pivot.z);
    if (ax) R1.makeRotationZ(Math.PI / 2).multiply(S1.makeRotationY(a));
    else if (p.anim === 'spin') R1.makeRotationX(a).multiply(S1.makeRotationZ(a * 0.4));
    else R1.makeRotationY(a);
    P.multiplyMatrices(U, T1).multiply(R1);
    if (p.scale !== 1) P.multiply(S1.makeScale(p.scale, p.scale, p.scale));
    return P.multiply(T1.makeTranslation(-p.origin.x, -p.origin.y, -p.origin.z));
  }

  /* ------------------------------------------------------------ drawing */
  private draw(v: Vis, e: Engine) {
    const spec = v.spec, air = spec.air, k = air ? DISP_AIR : e.groundScale * DISP_GROUND, alive = v.state === St.Alive;
    this.rootMatrix(v);
    const wreckAir = air && v.state === St.Wreck;
    for (const p of spec.parts) {
      const isRotor = p.anim === 'rotor' || p.anim === 'rotorV';
      if (isRotor && wreckAir) continue; // blades are gone
      if (spec.squad) {
        // A squad: the same part at each figure's offset, scaled up so it reads from altitude.
        const sq = spec.squadScale ?? 1, m = this.partMatrix(v, p);
        for (let i = 0; i < spec.squad.length; i++) {
          const o = spec.squad[i];
          SQ.makeTranslation(o.x, o.y, o.z).multiply(SQ2.makeScale(sq, sq, sq));
          p.pool.push(SQ2.multiplyMatrices(m, SQ), v.flash, v.burn);
        }
        continue;
      }
      p.pool.push(this.partMatrix(v, p), v.flash, isRotor ? 0 : v.burn);
    }
    const t = this.time + v.seed, s = k * v.sc;
    // ----- contrails (jets): wingtip history drifting back with the air
    if (v.type === 'jet' && alive) this.contrail(v, e);
    if (!alive) {
      if (v.state === St.Falling || (v.state === St.Wreck && v.st < 14)) {
        // flickering fire light on the wreck
        const heat = v.state === St.Falling ? 1 : Math.max(0, 1 - v.st / 14);
        this.position(v, vpos);
        const fl = 0.6 + 0.4 * Math.sin(t * 23) * Math.sin(t * 7.3);
        e.glow.add(vpos.x, vpos.y + 3, vpos.z, 0, spec.size * 3.2 * s * heat, spec.size * 3.2 * s * heat, C.fire, 0.35 * fl * heat, Shape.Soft);
      }
      if (v.state === St.Vanish) { this.position(v, vpos); e.glow.add(vpos.x, vpos.y, vpos.z, 0, 60 * (1 - v.st / v.dur), 60 * (1 - v.st / v.dur), C.scrap, 1, Shape.Hot); }
      return;
    }
    // ----- lights
    const fwdYaw = v.yaw;
    for (let i = 0; i < spec.lights.length; i++) {
      const L = spec.lights[i];
      vb.copy(L.p);
      if (L.head >= 0) { this.headMatrix(v, L.head); vb.applyMatrix4(H); } else vb.applyMatrix4(U);
      const sz = L.size * s;
      switch (L.kind) {
        case 'port': e.glow.add(vb.x, vb.y + 1, vb.z, 0, sz, sz, C.port, 0.95, Shape.Hot); break;
        case 'stbd': e.glow.add(vb.x, vb.y + 1, vb.z, 0, sz, sz, C.stbd, 0.85, Shape.Hot); break;
        case 'strobe': { const ph = (t * 0.85) % 1; if (ph < 0.035 || (ph > 0.11 && ph < 0.145)) e.glow.add(vb.x, vb.y + 1.5, vb.z, 0, sz * 2.2, sz * 2.2, C.strobe, 1.2, Shape.Hot); break; }
        case 'beacon': { const a = Math.pow(0.5 + 0.5 * Math.sin(t * 4.2), 3); e.glow.add(vb.x, vb.y + 1, vb.z, 0, sz * 1.6, sz * 1.6, C.beacon, a, Shape.Hot); break; }
        case 'deck': { const a = ((i * 0.13 - t * 1.6) % 1 + 1) % 1; e.glow.add(vb.x, vb.y + 1, vb.z, 0, sz, sz, C.deck, 0.25 + 0.75 * Math.pow(a, 6), Shape.Hot); break; }
        case 'scrap': { const a = 0.45 + 0.35 * Math.sin(t * 3.1); e.glow.add(vb.x, vb.y + 1, vb.z, 0, sz, sz, C.scrap, a * (v.type === 'cache' ? 2 : 0.6), v.type === 'cache' ? Shape.Hot : Shape.Soft); if (v.type === 'cache' && Math.sin(t * 5.5) > 0.6) e.glow.add(vb.x, vb.y + 1, vb.z, 0, sz * 4, sz * 4, C.scrap, 0.5, Shape.Soft); break; }
        case 'engine': {
          // engine core plus an exhaust plume whose length follows airspeed (hovering craft barely show one)
          const fl = 0.85 + 0.15 * Math.sin(t * 40 + i), sp = Math.min(1, Math.hypot(v.vx, v.vy) / 260);
          e.glow.add(vb.x, vb.y, vb.z, 0, sz * 0.8 * fl, sz * 0.8 * fl, C.engine, 0.9, Shape.Hot);
          vfwd.set(Math.sin(fwdYaw), 0, Math.cos(fwdYaw));
          const len = sz * (0.7 + 2.6 * sp);
          e.glow.add(vb.x - vfwd.x * len * 0.5, vb.y - 0.5, vb.z - vfwd.z * len * 0.5, Math.atan2(vfwd.z, vfwd.x), len, sz * 0.45, C.engineHot, (0.35 + 0.4 * sp) * fl, Shape.Streak);
          break;
        }
        case 'head': {
          // headlamp and its cone on the ground ahead
          const yaw = v.type === 'infantry' ? fwdYaw : fwdYaw;
          vfwd.set(Math.sin(yaw), 0, Math.cos(yaw));
          e.glow.add(vb.x, vb.y + 0.5, vb.z, 0, sz * 1.4, sz * 1.4, C.head, 0.9, Shape.Hot);
          const inf = v.type === 'infantry', len = (inf ? 22 : 52) * s, wid = (inf ? 9 : 22) * s;
          e.glow.add(vb.x + vfwd.x * len * 0.5, 0.6, vb.z + vfwd.z * len * 0.5, Math.atan2(vfwd.z, vfwd.x), len, wid, C.cone, inf ? 0.22 : 0.14, Shape.Soft);
          break;
        }
      }
    }
    // ----- muzzle flashes
    if (v.muzzleT > 0 && spec.muzzles.length) {
      const n = spec.heads.length ? spec.heads.length : 1;
      for (let h = 0; h < n; h++) for (const m of spec.muzzles) {
        vb.copy(m);
        if (spec.heads.length) { this.headMatrix(v, h); vb.applyMatrix4(H); } else vb.applyMatrix4(U);
        const z = (air ? 22 : 14) * s * (0.8 + Math.random() * 0.4);
        e.glow.add(vb.x, vb.y + 1, vb.z, Math.random() * TAU, z, z, C.muzzle, 1.2, Shape.Hot);
      }
    }
    // ----- hostile marking (docs/ART.md "Readability"): every unit is cut out of the city by a dark halo;
    // ground units also carry thin target brackets; aircraft cast a drop shadow on the city far below.
    this.position(v, vpos);
    const mk = spec.mark * s, fade = v.sc;
    if (!air) {
      const salvage = v.type === 'cache' || v.type === 'wreck';
      e.dark.add(vpos.x, 1.2 * k, vpos.z, fwdYaw, mk * 2.8, mk * 2.8, C.shadow, 0.78 * fade, DarkShape.Soft);
      const pulse = 0.85 + 0.15 * Math.sin(t * 3);
      e.glow.add(vpos.x, 1.6 * k, vpos.z, 0, mk * 2.0, mk * 2.0, salvage ? C.markScrap : C.mark, (salvage ? 0.6 : 0.75) * pulse * fade, Shape.Bracket);
    } else {
      e.dark.add(vpos.x, vpos.y - 8, vpos.z, 0, mk * 2.6, mk * 2.6, C.shadow, 0.55 * fade, DarkShape.Soft);
      const sh = 1 - v.alt / 900;
      if (sh > 0) {
        e.toGround(v.x + SHADOW_DX, v.y + SHADOW_DY, vb);
        e.dark.add(vb.x, 1.6, vb.z, Math.atan2(Math.cos(fwdYaw), Math.sin(fwdYaw)), spec.size * 2.3 * k * 0.55, spec.size * 1.7 * k * 0.55, C.shadow, 0.5 * sh * fade, DarkShape.Soft);
      }
    }
  }

  private contrail(v: Vis, e: Engine) {
    const spec = v.spec, tr = v.trail, port = spec.lights[0], stbd = spec.lights[1];
    // shift the stored points back with the air stream, then push the current wingtips
    const drift = this.airDrift;
    for (let j = 0; j < v.trailN; j++) { tr[j * 6 + 2] += drift; tr[j * 6 + 5] += drift; }
    va.copy(port.p).applyMatrix4(U); vb.copy(stbd.p).applyMatrix4(U);
    const i = v.trailHead; tr[i * 6] = va.x; tr[i * 6 + 1] = va.y; tr[i * 6 + 2] = va.z; tr[i * 6 + 3] = vb.x; tr[i * 6 + 4] = vb.y; tr[i * 6 + 5] = vb.z;
    v.trailHead = (i + 1) % TRAIL; v.trailN = Math.min(TRAIL, v.trailN + 1);
    for (let j = 1; j < v.trailN; j++) {
      const a = (v.trailHead - j + TRAIL) % TRAIL, b = (a - 1 + TRAIL) % TRAIL, f = 1 - j / v.trailN;
      for (let side = 0; side < 2; side++) {
        const o = side * 3, ax = tr[a * 6 + o], az = tr[a * 6 + o + 2], bx = tr[b * 6 + o], bz = tr[b * 6 + o + 2];
        const dx = ax - bx, dz = az - bz, L = Math.hypot(dx, dz); if (L < 0.01) continue;
        vc.set((ax + bx) / 2, tr[a * 6 + o + 1], (az + bz) / 2);
        e.glow.add(vc.x, vc.y, vc.z, Math.atan2(dz, dx), L + 1.5, 1.6 + (1 - f) * 2, C.contrail, 0.22 * f, Shape.Streak);
      }
    }
  }
}
