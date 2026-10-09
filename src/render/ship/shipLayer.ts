// Ship layer: the player's dreadnought and ghost-dreadnought bosses.
// Baseline implementation; the ship agent owns this file and src/render/ship/*.
import * as THREE from 'three';
import type { Engine, FrameCtx, Layer } from '../engine';
import { WEAPONS, partDef, buildToGhost, type Derived } from '../../data/parts';
import { rgb, Shape } from '../fx/quads';
import { clamp, has } from '../../util/rng';
import { dronePos } from '../../game/combat';

const BOSS_ALT = 40;
type MatSet = { hull: THREE.Material; panel: THREE.Material; deck: THREE.Material; edge: THREE.LineBasicMaterial; glass: THREE.Material; nozzle: THREE.Material };

function extrude(pts: number[][], depth: number) {
  const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) s.lineTo(p[0], p[1]); s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.8, bevelSize: 0.6, bevelSegments: 1 }).rotateX(Math.PI / 2).translate(0, depth / 2, 0);
}

export class ShipLayer implements Layer {
  name = 'ship';
  matP: MatSet; matB: MatSet;
  boxes = new Map<string, THREE.BoxGeometry>(); wmats = new Map<string, THREE.Material>();
  turret = new THREE.CylinderGeometry(4.2, 4.8, 3, 14);
  nozzle = new THREE.CylinderGeometry(3.2, 4, 6, 12).rotateX(Math.PI / 2);
  disc = new THREE.CircleGeometry(2.7, 12);
  pMesh: THREE.Group | null = null; pSig = ''; bMesh: THREE.Group | null = null; bRef: unknown = null;
  bank = 0; bbank = 0; px = 0; bx = 0;
  constructor(private engine: Engine) {
    const std = (c: number, m: number, r: number, side: THREE.Side = THREE.FrontSide) => new THREE.MeshStandardMaterial({ color: c, metalness: m, roughness: r, side });
    const glowBasic = (hex: string, k: number) => { const m = new THREE.MeshBasicMaterial({ color: hex }); m.color.multiplyScalar(k); m.toneMapped = false; return m; };
    const line = (hex: string, k: number, o: number) => { const m = new THREE.LineBasicMaterial({ color: hex, transparent: true, opacity: o }); m.color.multiplyScalar(k); m.toneMapped = false; return m; };
    const DS = THREE.DoubleSide;
    this.matP = { hull: std(0x6a7b8e, 0.55, 0.4), panel: std(0x3a4653, 0.5, 0.55), deck: std(0x7d90a5, 0.5, 0.45), edge: line('#9fb6ca', 0.7, 0.5), glass: glowBasic('#5fe0ff', 4), nozzle: glowBasic('#ffb050', 4) };
    this.matB = { hull: std(0x5a232b, 0.5, 0.42, DS), panel: std(0x2e1418, 0.5, 0.6, DS), deck: std(0x6e3139, 0.5, 0.5, DS), edge: line('#ff5040', 2.5, 0.95), glass: glowBasic('#ffcf5c', 4), nozzle: glowBasic('#ff6a3d', 4) };
  }
  box(w: number, h: number, d: number) { const k = `${w}_${h}_${d}`; let g = this.boxes.get(k); if (!g) { g = new THREE.BoxGeometry(w, h, d); this.boxes.set(k, g); } return g; }
  wmat(col: string) { let m = this.wmats.get(col); if (!m) { m = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.6, metalness: 0.3, roughness: 0.35 }); this.wmats.set(col, m); } return m; }

  /** Builds a ship from derived hull data. Local +Z is toward the stern; field units. */
  build(dv: Derived, isBoss: boolean) {
    const M = isBoss ? this.matB : this.matP, g = new THREE.Group();
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, own = false) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; m.userData.own = own; g.add(m); return m; };
    const tops: number[] = [];
    for (const r of dv.rects) {
      const k = r.type === 'battery' ? 5 : 3;
      const pts = r.type === 'bridge'
        ? [[r.x, r.y + r.h], [r.x, r.y + r.h * 0.5], [-r.w * 0.18, r.y], [r.w * 0.18, r.y], [r.x + r.w, r.y + r.h * 0.5], [r.x + r.w, r.y + r.h]]
        : [[r.x + k, r.y], [r.x + r.w - k, r.y], [r.x + r.w, r.y + k], [r.x + r.w, r.y + r.h - k], [r.x + r.w - k, r.y + r.h], [r.x + k, r.y + r.h], [r.x, r.y + r.h - k], [r.x, r.y + k]];
      const depth = ({ bridge: 20, armor: 24, battery: 18 } as Record<string, number>)[r.type] || 18;
      const geo = extrude(pts, depth); add(geo, M.hull, 0, 0, 0, true);
      const el = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), M.edge); el.userData.own = true; g.add(el);
      tops.push(depth / 2 + 0.8);
    }
    for (const m of dv.mounts) {
      const p = m.part; if (!p) continue;
      const top = tops[m.si], col = partDef(p.id).col;
      if (has(WEAPONS, p.id)) {
        add(this.turret, M.panel, m.ox, top + 1.5, m.oy);
        const len = p.id === 'rail' ? 30 : 18;
        add(this.box(3, 3, len), this.wmat(col), m.ox, top + 3, m.oy - len / 2 - 2);
      } else { const u = add(this.box(10, 5, 10), this.wmat(col), m.ox, top + 2.5, m.oy); u.rotation.y = Math.PI / 4; }
    }
    return g;
  }
  dispose(g: THREE.Group) { g.traverse((o) => { if (o.userData.own && (o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose(); }); }

  clear() { if (this.bMesh) { this.engine.scene.remove(this.bMesh); this.dispose(this.bMesh); this.bMesh = null; this.bRef = null; } }

  update({ S, dt, showPlayer, t }: FrameCtx) {
    const e = this.engine, rdt = Math.max(1 / 240, dt), v = new THREE.Vector3();
    const P = S.P;
    if (P && showPlayer) {
      const sig = JSON.stringify(buildToGhost(P.build));
      if (this.pSig !== sig) { if (this.pMesh) { e.scene.remove(this.pMesh); this.dispose(this.pMesh); } this.pMesh = this.build(P.dv, false); e.scene.add(this.pMesh); this.pSig = sig; }
      const vx = (P.x - this.px) / rdt; this.px = P.x; this.bank += (clamp(-vx / 900, -0.3, 0.3) - this.bank) * Math.min(1, rdt * 6);
      const pm = this.pMesh!; pm.visible = true; e.toFlight(P.x, P.y, 0, pm.position); pm.rotation.set(0, 0, this.bank);
      for (const r of P.dv.rects) if (r.type === 'engine') for (const sx of [-0.22, 0.22]) { e.toFlight(P.x + r.w * sx, P.y + r.y + r.h + 10, 0, v); e.glow.add(v.x, v.y, v.z, 0, 30 + Math.random() * 10, 30, rgb('#ffb347'), 0.95, Shape.Hot); }
      if (P.flash > 0) { e.toFlight(P.x, P.y, 30, v); e.glow.add(v.x, v.y, v.z, 0, P.dv.width * 1.5, P.dv.len * 1.2, rgb('#ffffff'), P.flash * 0.3, Shape.Soft); }
      if (P.shield > 0) { e.toFlight(P.x, P.y, 8, v); e.glow.add(v.x, v.y, v.z, 0, P.dv.width + 40, P.dv.len + 40, rgb('#4fd1e8'), (0.3 + 0.4 * (P.shield / P.dv.shieldMax)) * (P.lastHit < 0.2 ? 1.8 : 1), Shape.Ring); }
      for (let i = 0; i < P.dv.drones; i++) { const p = dronePos(i, P.dv.drones); e.toFlight(p.x, p.y, 10, v); e.glow.add(v.x, v.y, v.z, 0, 22, 22, rgb('#7fb6ff'), 0.95, Shape.Hot); }
    } else if (this.pMesh) this.pMesh.visible = false;
    const B = S.boss;
    if (B && (B.alive || S.mode === 'bossdown')) {
      if (this.bRef !== B) { this.clear(); this.bMesh = this.build(B.dv, true); this.bMesh.scale.set(B.s, B.s, -B.s); e.scene.add(this.bMesh); this.bRef = B; this.bx = B.x; }
      const sink = S.mode === 'bossdown' ? (2.6 - S.endT) / 2.6 : 0;
      const vx = (B.x - this.bx) / rdt; this.bx = B.x; this.bbank += (clamp(vx / 400, -0.25, 0.25) - this.bbank) * Math.min(1, rdt * 5);
      const bm = this.bMesh!; bm.visible = true; e.toFlight(B.x, B.y, BOSS_ALT - sink * 300, bm.position); bm.position.z += sink * 60; bm.rotation.set(sink * 0.5, 0, this.bbank + sink * 0.7);
      for (const r of B.dv.rects) if (r.type === 'engine') for (const sx of [-0.22, 0.22]) { e.toFlight(B.x + r.w * sx * B.s, B.y - (r.y + r.h) * B.s - 14, BOSS_ALT, v); e.glow.add(v.x, v.y, v.z, 0, 46 + Math.random() * 10, 46, rgb('#ff6a3d'), 0.9, Shape.Hot); }
      if (B.shield > 0) { e.toFlight(B.x, B.y, BOSS_ALT + 8, v); e.glow.add(v.x, v.y, v.z, 0, B.halfW * 2 + 50, B.dv.len * B.s + 50, rgb('#4fd1e8'), (0.3 + 0.5 * B.shield / B.shieldMax) * (B.shieldHitT < 0.15 ? 1.8 : 1), Shape.Ring); }
      void t;
    } else this.clear();
  }
}
