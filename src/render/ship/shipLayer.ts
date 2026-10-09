// Ship layer: the player's dreadnought and ghost-dreadnought bosses.
// Builds (and caches by build signature) a procedural carrier-scale warship per hull, then drives it
// every frame: mass-y banking and settling, turret slew and recoil, engine plumes, steam, battle damage.
// See hull.ts for the construction and materials.ts for the livery.
import * as THREE from 'three';
import type { Engine, FrameCtx, Layer } from '../engine';
import { FIELD_W, FIELD_H } from '../engine';
import { buildToGhost, derive, starterBuild, type Derived } from '../../data/parts';
import { rgb, Shape, DarkShape } from '../fx/quads';
import { clamp, angDiff } from '../../util/rng';
import { dronePos, fireLog, type Ent } from '../../game/combat';
import { addFx, FIRE } from '../../game/vfx';
import { kitLoaded } from '../assets';
import { livery } from './materials';
import { buildShip, disposeShip, DECK, type ShipModel } from './hull';
import { lightUniforms } from './lights';
import type { Turret } from './turrets';

/** Flight-plane altitude of the ship origin: keeps the deck just under the bullet/muzzle layer. */
const P_ALT = -10;
const v = new THREE.Vector3(), w = new THREE.Vector3(), d = new THREE.Vector3();

interface Rig {
  model: ShipModel; sig: string;
  px: number; py: number; vx: number; vy: number;
  roll: number; rollV: number; pitch: number; pitchV: number; yaw: number;
  seen: Map<number, number>; retarget: Map<number, number>; aims: Map<number, number>;
  lidOpen: number[]; salvo: number[]; fireAcc: number; sparkAcc: number; smokeAcc: number;
}

export class ShipLayer implements Layer {
  name = 'ship';
  private cache = new Map<string, ShipModel>();
  private player: Rig | null = null;
  private boss: Rig | null = null;
  private bossRef: unknown = null;
  constructor(private engine: Engine) {}

  /** Cached ship model for a hull (built on first use). */
  private model(dv: Derived, hostile: boolean, sigBase: string) {
    const sig = `${hostile ? 'G' : 'P'}|${kitLoaded('scifi') ? 1 : 0}|${sigBase}`;
    let m = this.cache.get(sig);
    if (!m) {
      const t0 = performance.now(), L = livery(hostile, this.engine.renderer), t1 = performance.now();
      m = buildShip(dv, L, sigBase);
      if (import.meta.env.DEV) console.info(`[ship] livery ${(t1 - t0).toFixed(0)} ms; built ${hostile ? 'ghost' : 'player'} hull in ${(performance.now() - t1).toFixed(0)} ms, ${Math.round(m.tris / 1000)}k tris, ${m.lights.geometry.getAttribute('position').count} lights`);
      this.cache.set(sig, m);
      // Keep a handful of hulls (refits flip back and forth); dispose the oldest beyond that.
      while (this.cache.size > 5) {
        const [k, old] = this.cache.entries().next().value as [string, ShipModel];
        if (old === this.player?.model || old === this.boss?.model) { this.cache.delete(k); this.cache.set(k, old); break; }
        this.cache.delete(k); old.root.removeFromParent(); disposeShip(old);
      }
    }
    return { m, sig };
  }

  private rig(prev: Rig | null, dv: Derived, hostile: boolean, sigBase: string, x: number, y: number): Rig {
    const { m, sig } = this.model(dv, hostile, sigBase);
    if (prev && prev.sig === sig) return prev;
    if (prev) prev.model.root.removeFromParent();
    this.engine.scene.add(m.root);
    const seen = new Map<number, number>();
    for (const t of m.turrets) seen.set(t.uid, fireLog.get(t.uid) ?? -1);
    return {
      model: m, sig, px: x, py: y, vx: 0, vy: 0, roll: 0, rollV: 0, pitch: 0, pitchV: 0, yaw: 0,
      seen, retarget: new Map(), aims: new Map(), lidOpen: m.turrets.map(() => 0), salvo: m.turrets.map(() => 0), fireAcc: 0, sparkAcc: 0, smokeAcc: 0,
    };
  }

  clear() {
    if (this.boss) { this.boss.model.root.removeFromParent(); this.boss = null; this.bossRef = null; }
  }

  private warmed = false;
  /**
   * Once the kit is loaded and no fight is running, prepare both liveries (env probe, maps) and
   * compile their shaders on a starter hull, so the first fight starts without a hitch.
   */
  private warm(S: FrameCtx['S']) {
    if (this.warmed || !kitLoaded('scifi') || S.active) return;
    this.warmed = true;
    const e = this.engine, scene = new THREE.Scene();
    for (const hostile of [false, true]) scene.add(this.model(derive(starterBuild()), hostile, JSON.stringify(buildToGhost(starterBuild()))).m.root);
    void e.renderer.compileAsync(scene, e.camera, e.scene).catch(() => undefined);
    scene.clear();
  }

  update({ S, dt, t, showPlayer }: FrameCtx) {
    const e = this.engine, rdt = Math.max(1 / 240, Math.min(0.1, dt));
    this.warm(S);
    lightUniforms.uTime.value = t;
    lightUniforms.uPx.value = e.renderer.domElement.height * e.camera.projectionMatrix.elements[5] * 0.5;
    const P = S.P;
    if (P && showPlayer) {
      this.player = this.rig(this.player, P.dv, false, JSON.stringify(buildToGhost(P.build)), P.x, P.y);
      const r = this.player, m = r.model;
      m.root.visible = true;
      this.motion(r, P.x, P.y, rdt, t, 1, false);
      e.toFlight(P.x, P.y, P_ALT + this.bob(t, 1), m.root.position);
      m.root.rotation.set(r.pitch, r.yaw, r.roll, 'YXZ');
      m.root.scale.set(1, 1, 1);
      m.root.updateMatrixWorld(true);
      this.turrets(r, S, rdt, t, false, P.x, P.y, 1, P.cds);
      this.animate(r, rdt);
      this.plumes(r, t, 1, false, clamp(0.55 + Math.max(0, -r.vy) / 260, 0.4, 1.3));
      this.steam(r, t, 1);
      this.damage(r, P.hp / P.dv.maxHp, rdt, t, 1, false);
      if (P.flash > 0) { e.toFlight(P.x, P.y, 30, v); e.glow.add(v.x, v.y, v.z, 0, P.dv.width * 1.5, P.dv.len * 1.2, rgb('#ffffff'), P.flash * 0.3, Shape.Soft); }
      if (P.shield > 0) { e.toFlight(P.x, P.y, 8, v); e.glow.add(v.x, v.y, v.z, 0, P.dv.width + 40, P.dv.len + 40, rgb('#4fd1e8'), (0.3 + 0.4 * (P.shield / P.dv.shieldMax)) * (P.lastHit < 0.2 ? 1.8 : 1), Shape.Ring); }
      for (let i = 0; i < P.dv.drones; i++) { const p = dronePos(i, P.dv.drones); e.toFlight(p.x, p.y, 10, v); e.glow.add(v.x, v.y, v.z, 0, 22, 22, rgb('#7fb6ff'), 0.95, Shape.Hot); e.glow.add(v.x, v.y, v.z, 0, 5, 5, rgb('#ffffff'), 0.9, Shape.Hot); }
    } else if (this.player) this.player.model.root.visible = false;

    const Bo = S.boss;
    if (Bo && (Bo.alive || S.mode === 'bossdown')) {
      if (this.bossRef !== Bo) { this.clear(); this.bossRef = Bo; }
      this.boss = this.rig(this.boss, Bo.dv, true, JSON.stringify(buildToGhost(Bo.build)), Bo.x, Bo.y);
      const r = this.boss, m = r.model, s = Bo.s, L = livery(true, e.renderer);
      m.root.visible = true;
      const sink = S.mode === 'bossdown' ? clamp((2.6 - S.endT) / 2.6, 0, 1) : 0;
      this.motion(r, Bo.x, Bo.y, rdt, t, s, true);
      e.toFlight(Bo.x, Bo.y, -(DECK + 2) * s - sink * 300 + this.bob(t + 2, s), m.root.position); m.root.position.z += sink * 60;
      m.root.rotation.set(r.pitch + sink * 0.5, r.yaw, r.roll + sink * 0.7, 'YXZ');
      m.root.scale.set(s, s, -s);
      m.root.updateMatrixWorld(true);
      // Ghost flicker: a slow breath with stutters, harder when the hull is breached.
      const fl = 0.82 + 0.12 * Math.sin(t * 2.3) + 0.06 * Math.sin(t * 17.1) - (Math.sin(t * 5.7) * Math.sin(t * 3.1) > 0.85 ? 0.45 : 0) - (Bo.phase === 2 && Math.random() < 0.08 ? 0.4 : 0);
      L.u.flicker.value = fl; lightUniforms.uFlick.value = fl;
      if (m.edges) (m.edges.material as THREE.LineBasicMaterial).opacity = clamp(0.55 + 0.45 * fl, 0, 1);
      this.turrets(r, S, rdt, t, true, Bo.x, Bo.y, s, null);
      this.animate(r, rdt);
      this.plumes(r, t, s, true, 0.8);
      this.steam(r, t, s);
      this.damage(r, Bo.hp / Bo.maxHp, rdt, t, s, true);
      // Menace: a low red aura under the hull and a pale hit flash.
      e.toFlight(Bo.x, Bo.y, -40, v); e.glow.add(v.x, v.y, v.z, 0, Bo.halfW * 2.8, Bo.dv.len * s * 1.3, rgb('#ff3a2e'), 0.1 * fl, Shape.Soft);
      if (Bo.flash > 0) { e.toFlight(Bo.x, Bo.y, 20, v); e.glow.add(v.x, v.y, v.z, 0, Bo.halfW * 2.2, Bo.dv.len * s * 1.1, rgb('#ffd0c0'), 0.25, Shape.Soft); }
      if (Bo.shield > 0) { e.toFlight(Bo.x, Bo.y, 14, v); e.glow.add(v.x, v.y, v.z, 0, Bo.halfW * 2 + 50, Bo.dv.len * s + 50, rgb('#4fd1e8'), (0.3 + 0.5 * Bo.shield / Bo.shieldMax) * (Bo.shieldHitT < 0.15 ? 1.8 : 1), Shape.Ring); }
    } else this.clear();
  }

  /** Mass-y motion: a damped spring on roll and pitch driven by smoothed velocity. */
  private motion(r: Rig, x: number, y: number, dt: number, t: number, s: number, mirrored: boolean) {
    const ivx = (x - r.px) / dt, ivy = (y - r.py) / dt; r.px = x; r.py = y;
    const k = 1 - Math.exp(-dt * 5); r.vx += (clamp(ivx, -900, 900) - r.vx) * k; r.vy += (clamp(ivy, -900, 900) - r.vy) * k;
    const sgn = mirrored ? -1 : 1;
    const rollT = clamp(-r.vx / 900, -0.26, 0.26) * (mirrored ? 0.7 : 1) + Math.sin(t * 0.37 + s) * 0.012;
    const pitchT = clamp(r.vy / 2400, -0.07, 0.07) * sgn;
    const w0 = 2.4, z = 0.55;
    r.rollV += ((rollT - r.roll) * w0 * w0 - 2 * z * w0 * r.rollV) * dt; r.roll += r.rollV * dt;
    r.pitchV += ((pitchT - r.pitch) * w0 * w0 - 2 * z * w0 * r.pitchV) * dt; r.pitch += r.pitchV * dt;
    r.yaw += (clamp(-r.vx / 5000, -0.05, 0.05) * sgn - r.yaw) * (1 - Math.exp(-dt * 2));
  }
  private bob(t: number, s: number) { return (Math.sin(t * 0.7) * 1.1 + Math.sin(t * 1.27 + 1) * 0.45) * s; }

  /** Slew turrets toward their targets and detect shots for recoil. */
  private turrets(r: Rig, S: FrameCtx['S'], dt: number, t: number, hostile: boolean, sx: number, sy: number, s: number, cds: Record<number, number> | null) {
    const P = S.P, B = S.boss;
    for (let i = 0; i < r.model.turrets.length; i++) {
      const tr = r.model.turrets[i];
      const fx = sx + tr.x * s, fy = hostile ? sy - tr.z * s : sy + tr.z * s;
      let want = 0;
      if (tr.aim === 'spin') { tr.cur += tr.rate * dt; }
      else if (tr.aim !== 'fixed') {
        let rt = (r.retarget.get(tr.uid) ?? 0) - dt;
        if (rt <= 0) {
          rt = 0.15 + Math.random() * 0.1;
          let tx = NaN, ty = NaN;
          if (hostile) { if (P) { tx = P.x; ty = P.y; } }
          else {
            const tg = this.target(tr, S.enemies, S.eb, B && B.alive ? B : null, fx, fy);
            if (tg) { tx = tg.x; ty = tg.y; }
          }
          if (tx === tx) { const dx = tx - fx, dy = ty - fy; r.aims.set(tr.uid, hostile ? Math.atan2(-dx, dy) : Math.atan2(-dx, -dy)); }
          else r.aims.set(tr.uid, 0);
          r.retarget.set(tr.uid, rt);
        } else r.retarget.set(tr.uid, rt);
        want = r.aims.get(tr.uid) ?? 0;
        if (tr.aim === 'cone') want = clamp(want, -tr.arc, tr.arc);
        const dd = angDiff(want, tr.cur), mx = tr.rate * dt;
        // Ease in the last few degrees so heavy guns settle instead of snapping.
        tr.cur += clamp(dd * Math.min(1, dt * 6), -mx, mx);
      } else tr.cur = 0;
      tr.yaw.rotation.y = tr.cur;
      const lf = fireLog.get(tr.uid);
      if (lf !== undefined && lf !== r.seen.get(tr.uid)) { r.seen.set(tr.uid, lf); tr.kick = 1; this.onFire(r, tr, i, s); }
      // Rail charge glow follows the cooldown.
      if (tr.charge) {
        const cd = cds ? cds[tr.uid] ?? 0 : 0.5, q = hostile ? 0.5 + 0.5 * Math.sin(t * 3) : clamp(1 - cd / 1.7, 0, 1);
        (tr.charge.material as THREE.MeshBasicMaterial).color.setRGB(0.79 * (0.4 + 3 * q * q), 0.65 * (0.4 + 3 * q * q), 1 * (0.4 + 3 * q * q));
      }
    }
  }
  private target(tr: Turret, enemies: FrameCtx['S']['enemies'], eb: Ent[], boss: Ent | null, x: number, y: number): Ent | null {
    let best: Ent | null = null, bd = tr.layer === 'none' ? 260 * 260 : 760 * 760;
    if (tr.layer === 'none') {
      for (const b of eb) { if (b.dead || b.kind === 'beam' || b.kind === 'strike') continue; const dd = (b.x - x) ** 2 + (b.y - y) ** 2; if (dd < bd) { bd = dd; best = b; } }
      return best;
    }
    for (const en of enemies) {
      if (en.dead || (tr.layer !== 'both' && en.layer !== tr.layer)) continue;
      const dd = (en.x - x) ** 2 + (en.y - y) ** 2; if (dd < bd) { bd = dd; best = en; }
    }
    if (boss && tr.layer !== 'ground') { const dd = (boss.x - x) ** 2 + (boss.y - y) ** 2 * 0.5; if (dd < bd) best = boss; }
    if (boss && tr.layer === 'ground' && !best) best = boss;
    return best;
  }
  private onFire(r: Rig, tr: Turret, i: number, s: number) {
    const e = this.engine;
    if (tr.lids.length) { r.lidOpen[i] = 1; r.salvo[i] = (r.salvo[i] + 1) % 6; }
    // Barrel-tip flash at the real muzzle (combat's own muzzle fx marks the mount).
    for (const mz of tr.muzzles) {
      v.set(mz[0], mz[1], mz[2]); tr.yaw.localToWorld(v);
      e.glow.add(v.x, v.y + 2, v.z, 0, 16 * s, 16 * s, rgb(r.model.hostile ? '#ff7a5c' : '#fff1c1'), 0.9, Shape.Hot);
    }
  }
  /** Recoil, VLS lids, bomb-bay doors. */
  private animate(r: Rig, dt: number) {
    const m = r.model;
    for (let i = 0; i < m.turrets.length; i++) {
      const tr = m.turrets[i];
      if (tr.kick > 0.001) {
        tr.kick *= Math.exp(-dt * (tr.id === 'artillery' ? 3.5 : 7));
        const off = tr.recoil * (1 - Math.pow(1 - tr.kick, 3));
        for (let b = 0; b < tr.barrels.length; b++) tr.barrels[b].position.z = tr.barrelRest[b] + off;
      }
      if (tr.lids.length) {
        r.lidOpen[i] = Math.max(0, r.lidOpen[i] - dt * 1.6);
        const o = Math.min(1, r.lidOpen[i] * 2.2), a = r.salvo[i] * 2;
        for (let k = 0; k < tr.lids.length; k++) tr.lids[k].rotation.x = (k === a || k === a + 1 ? -1.3 : 0) * o;
      }
      if (tr.doors.length) {
        const o = Math.min(1, tr.kick * 3);
        tr.doors[0].rotation.z = -1.25 * o; tr.doors[1].rotation.z = 1.25 * o;
      }
    }
    for (const sp of m.spinners) sp.obj.rotation.y += sp.speed * dt;
  }

  /** Engine plumes: hot core, long streak and soft bloom per nozzle, flickering with thrust. */
  private plumes(r: Rig, t: number, s: number, hostile: boolean, thrust: number) {
    const e = this.engine, m = r.model, L = livery(hostile, e.renderer).light;
    d.set(0, 0, 1).transformDirection(m.root.matrixWorld);
    const rot = Math.atan2(d.z, d.x);
    for (let i = 0; i < m.nozzles.length; i++) {
      const n = m.nozzles[i];
      v.set(n.x, n.y, n.z).applyMatrix4(m.root.matrixWorld);
      const fl = 0.85 + 0.15 * Math.sin(t * 31 + i * 2.1) + 0.08 * Math.sin(t * 13.3 + i);
      if (n.main) {
        const rr = n.r * s, len = rr * (4.5 + 3.5 * thrust) * fl;
        e.glow.add(v.x, v.y, v.z, 0, rr * 2.6, rr * 2.6, rgb(L.engineHot), 0.9, Shape.Hot);
        e.glow.add(v.x + d.x * len * 0.5, v.y, v.z + d.z * len * 0.5, rot, len, rr * 1.7, rgb(L.engine), 0.75 * fl, Shape.Streak);
        e.glow.add(v.x + d.x * len * 0.25, v.y, v.z + d.z * len * 0.25, rot, len * 0.55, rr * 0.8, rgb(L.engineHot), 0.8 * fl, Shape.Streak);
        e.glow.add(v.x + d.x * rr, v.y - 4, v.z + d.z * rr, 0, rr * 6, rr * 6, rgb(L.engine), 0.22 * thrust, Shape.Soft);
      } else {
        // Manoeuvring jets fire against lateral motion.
        const side = Math.sign(n.x) * (hostile ? -1 : 1), q = n.r > 2 ? 0.6 : clamp((side < 0 ? r.vx : -r.vx) / 260, 0, 1);
        if (q > 0.05) {
          const ox = n.r > 2 ? d.x : Math.sign(n.x) * (hostile ? -1 : 1), oz = n.r > 2 ? d.z : 0, rr = n.r * s;
          e.glow.add(v.x + ox * rr * 2, v.y, v.z + oz * rr * 2, Math.atan2(oz, ox), rr * 5 * q * fl, rr * 1.2, rgb(L.engine), 0.7 * q, Shape.Streak);
        }
      }
    }
  }

  /** Steam and exhaust haze from vents and stacks: stateless puffs that drift aft. */
  private steam(r: Rig, t: number, s: number) {
    const e = this.engine, m = r.model;
    d.set(0, 0, 1).transformDirection(m.root.matrixWorld);
    for (let i = 0; i < m.vents.length; i++) {
      const vp = m.vents[i];
      v.set(vp[0], vp[1], vp[2]).applyMatrix4(m.root.matrixWorld);
      for (let k = 0; k < 3; k++) {
        const q = (t * 0.45 + k / 3 + i * 0.37) % 1, sz = (3 + q * 12) * s;
        e.dark.add(v.x + d.x * q * 18 * s + Math.sin(i + q * 3) * 2 * s, v.y + 3 + q * 6, v.z + d.z * q * 18 * s, q * 2, sz, sz, rgb('#a9b2bb'), (1 - q) * q * 0.55, DarkShape.Soft);
      }
    }
  }

  /** Battle damage: scorch at 60%, sparks; fires, smoke and venting under 30%. */
  private damage(r: Rig, frac: number, dt: number, t: number, s: number, hostile: boolean) {
    const e = this.engine, m = r.model, pts = m.dmgPts, n = pts.length;
    const sc = clamp((0.75 - frac) / 0.6, 0, 1), nScorch = Math.floor(n * sc);
    m.scorch.geometry.setDrawRange(0, nScorch * 6);
    if (frac >= 0.6 || frac <= 0) return;
    const toField = (p: THREE.Vector3) => { p.x += FIELD_W / 2; p.z += FIELD_H / 2; return p; };
    r.sparkAcc += dt * (0.6 - frac) * 14;
    while (r.sparkAcc > 1) {
      r.sparkAcc -= 1;
      const p = pts[Math.floor(Math.random() * Math.max(1, nScorch))];
      toField(w.set(p[0], p[1], p[2]).applyMatrix4(m.root.matrixWorld));
      for (let k = 0; k < 4; k++) { const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 160; addFx({ type: 'spark', x: w.x, y: w.z, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.25 + Math.random() * 0.2, max: 0.45, size: 1.2, drag: 3, tint: '#ffd27a' }); }
    }
    if (frac >= 0.3) return;
    const nf = Math.min(n, 2 + Math.floor(((0.3 - frac) / 0.3) * 7));
    for (let i = 0; i < nf; i++) {
      const p = pts[i];
      v.set(p[0], p[1] + 1, p[2]).applyMatrix4(m.root.matrixWorld);
      const fl = 0.7 + 0.3 * Math.sin(t * (11 + i) + i * 7);
      e.glow.add(v.x, v.y + 2, v.z, 0, (9 + 4 * fl) * s, (9 + 4 * fl) * s, rgb(FIRE[2]), 0.6 * fl, Shape.Soft);
      e.glow.add(v.x, v.y + 2.5, v.z, 0, 4 * s, 4 * s, rgb(FIRE[1]), 0.8 * fl, Shape.Hot);
      // Venting: pale jets from the hull side nearest the fire.
      if (i % 3 === 1) {
        w.set(Math.sign(p[0] || 1) * 1, 0, 0).transformDirection(m.root.matrixWorld);
        const vl = (14 + 8 * Math.sin(t * 9 + i)) * s;
        e.glow.add(v.x + w.x * vl * 0.6, v.y, v.z + w.z * vl * 0.6, Math.atan2(w.z, w.x), vl, 3 * s, rgb(hostile ? '#ff9a7a' : '#cfe3f0'), 0.22, Shape.Streak);
      }
    }
    r.smokeAcc += dt * nf * 3;
    while (r.smokeAcc > 1) {
      r.smokeAcc -= 1;
      const p = pts[Math.floor(Math.random() * nf)];
      toField(w.set(p[0], p[1], p[2]).applyMatrix4(m.root.matrixWorld));
      addFx({ type: 'smoke', x: w.x, y: w.z, vx: (Math.random() - 0.5) * 16, vy: 60 + Math.random() * 40, life: 1.3, max: 1.3, size: 3.5 * s, grow: 2.6, a: 0.5 });
      if (Math.random() < 0.4) addFx({ type: 'fire', x: w.x, y: w.z, vx: 0, vy: 50, life: 0.3, max: 0.3, size: 4 * s, grow: 0.6 });
    }
  }
}
