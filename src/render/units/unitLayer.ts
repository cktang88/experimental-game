// Unit layer: every enemy, elite and salvage object.
// Air units fly on the flight plane; ground units sit on the ground plane scaled by groundScale.
// Baseline implementation; the units agent owns this file and src/render/units/*.
import * as THREE from 'three';
import type { Engine, FrameCtx, Layer } from '../engine';
import type { Enemy } from '../../game/combat';
import { rgb, Shape } from '../fx/quads';
import { rnd } from '../../util/rng';

const TAU = Math.PI * 2;
function extrude(pts: number[][], depth: number) {
  const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) s.lineTo(p[0], p[1]); s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.8, bevelSize: 0.6, bevelSegments: 1 }).rotateX(Math.PI / 2).translate(0, depth / 2, 0);
}

export class UnitLayer implements Layer {
  name = 'units';
  pool: Record<string, THREE.Group[]> = {}; live = new Set<THREE.Group>(); boxes = new Map<string, THREE.BoxGeometry>();
  M: Record<string, THREE.Material>; G: Record<string, THREE.BufferGeometry>;
  constructor(private engine: Engine) {
    const std = (c: number, m: number, r: number) => new THREE.MeshStandardMaterial({ color: c, metalness: m, roughness: r });
    const glowBasic = (hex: string, k: number) => { const m = new THREE.MeshBasicMaterial({ color: hex }); m.color.multiplyScalar(k); m.toneMapped = false; return m; };
    this.M = {
      hostile: std(0x8a6f5d, 0.35, 0.6), hostileL: std(0x9b8372, 0.4, 0.5), hostileD: std(0x5a493d, 0.4, 0.55), olive: std(0x5d6d44, 0.2, 0.8), oliveL: std(0x758459, 0.25, 0.7),
      dark: std(0x2a2f24, 0.2, 0.9), concrete: std(0x66605a, 0.1, 0.95), steel: std(0x8a7f72, 0.45, 0.55), inf: std(0x7d8a63, 0.1, 0.9), skin: std(0xc9b48a, 0, 0.9),
      light: glowBasic('#ff3b2e', 4), orange: glowBasic('#ff9a4a', 2.2), crate: std(0x9a7b3a, 0.2, 0.7), crateBand: glowBasic('#ffd24a', 2.5),
      droneMat: new THREE.MeshStandardMaterial({ color: 0x8a3a33, emissive: 0xff3b2e, emissiveIntensity: 1.2, metalness: 0.5, roughness: 0.4 }),
      eliteHull: std(0x4a3a40, 0.6, 0.35), canister: new THREE.MeshStandardMaterial({ color: 0xb08a3a, emissive: 0xffc24a, emissiveIntensity: 0.6, metalness: 0.7, roughness: 0.3 }),
      rotor: new THREE.MeshBasicMaterial({ color: 0xd8dde2, transparent: true, opacity: 0.28, depthWrite: false }),
    };
    this.G = {
      heliBody: new THREE.SphereGeometry(1, 14, 10).scale(7, 5.5, 11), jet: extrude([[0, 13], [11, -8], [3, -5], [0, -12], [-3, -5], [-11, -8]], 3),
      drone: new THREE.OctahedronGeometry(6.5), bomber: extrude([[30, 0], [-10, -28], [-18, -28], [-8, 0], [-18, 28], [-10, 28]], 3.5),
      cyl6: new THREE.CylinderGeometry(6, 6.5, 5, 14), inf: new THREE.CylinderGeometry(2.4, 2.6, 5, 8), head: new THREE.SphereGeometry(1.8, 8, 6),
      oct: new THREE.CylinderGeometry(14, 15, 6, 8), head7: new THREE.CylinderGeometry(7, 7.5, 5, 12),
      dome: new THREE.SphereGeometry(22, 20, 8, 0, TAU, 0, Math.PI / 2).scale(1, 0.55, 1), ring: new THREE.TorusGeometry(16, 2, 6, 24).rotateX(Math.PI / 2),
      canister: new THREE.CylinderGeometry(5, 5, 14, 10).rotateZ(Math.PI / 2),
      ace: extrude([[0, 34], [26, -6], [30, -22], [8, -14], [0, -26], [-8, -14], [-30, -22], [-26, -6]], 9),
      carrier: extrude([[-30, 46], [30, 46], [44, 20], [44, -36], [24, -48], [-24, -48], [-44, -36], [-44, 20]], 10),
    };
  }
  box(w: number, h: number, d: number) { const k = `${w}_${h}_${d}`; let g = this.boxes.get(k); if (!g) { g = new THREE.BoxGeometry(w, h, d); this.boxes.set(k, g); } return g; }

  /** Builds a unit model facing +Z (down the field), sized in field units. */
  make(type: string): THREE.Group {
    const pool = this.pool[type] || (this.pool[type] = []); if (pool.length) return pool.pop()!;
    const g = new THREE.Group(), M = this.M, G3 = this.G; g.userData.type = type;
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = g) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
    const rotor = (x: number, y: number, z: number, len: number) => { const r = new THREE.Group(); r.position.set(x, y, z); add(this.box(len, 0.5, 1.8), M.rotor, 0, 0, 0, r).castShadow = false; add(this.box(1.8, 0.5, len), M.rotor, 0, 0, 0, r).castShadow = false; g.add(r); return r; };
    const head = (y: number) => { const h = new THREE.Group(); h.position.y = y; g.add(h); g.userData.head = h; return h; };
    switch (type) {
      case 'heli': add(G3.heliBody, M.hostile); add(this.box(2.4, 2.4, 14), M.hostile, 0, 1, -12); add(this.box(5, 2, 3), M.light, 0, 1, 9); g.userData.rotors = [rotor(0, 6, 0, 34)]; break;
      case 'jet': add(G3.jet, M.hostileL); add(this.box(3, 2, 5), M.light, 0, 2, 4); break;
      case 'drone': g.userData.spin = add(G3.drone, M.droneMat); break;
      case 'gunship': add(this.box(20, 9, 40), M.hostileD); add(this.box(46, 3, 10), M.hostile, 0, 0, -4); add(this.box(8, 3, 6), M.light, 0, 3, 18); g.userData.rotors = [rotor(-18, 6, -14, 26), rotor(18, 6, -14, 26)]; break;
      case 'bomber': add(G3.bomber, M.hostileD); add(this.box(56, 4, 10), M.hostile); add(this.box(4, 2, 4), M.light, 26, 2, 0); break;
      case 'tank': { add(this.box(20, 7, 24), M.olive, 0, 3.5); add(this.box(3.5, 7, 26), M.dark, -11.5, 3.5); add(this.box(3.5, 7, 26), M.dark, 11.5, 3.5); const h = head(9); add(G3.cyl6, M.oliveL, 0, 0, 0, h); add(this.box(3, 3, 14), M.oliveL, 0, 0, 8, h); break; }
      case 'infantry': add(G3.inf, M.inf, 0, 2.5); add(G3.head, M.skin, 0, 6); break;
      case 'turret': { add(G3.oct, M.concrete, 0, 3); const h = head(8.5); add(G3.head7, M.steel, 0, 0, 0, h); add(this.box(4, 4, 16), M.steel, 0, 0, 9, h); add(this.box(3, 1.5, 3), M.light, 0, 3, 0, h); break; }
      case 'sam': { add(this.box(24, 7, 24), M.concrete, 0, 3.5); for (const s of [-1, 1]) add(this.box(5, 5, 16), M.orange, s * 6, 10).rotation.x = -0.7; break; }
      case 'bunker': add(G3.dome, M.concrete); add(G3.ring, M.dark, 0, 2); add(this.box(6, 2, 6), M.light, 0, 12.5); break;
      case 'cache': add(this.box(20, 12, 20), M.crate, 0, 6); add(this.box(21, 2, 21), M.crateBand, 0, 9); add(this.box(21, 2, 21), M.crateBand, 0, 3); break;
      case 'wreck': { for (let i = 0; i < 5; i++) { const b = add(this.box(rnd(8, 18), rnd(4, 9), rnd(10, 26)), i % 2 ? M.hostileD : M.dark, rnd(-12, 12), 3, rnd(-12, 12)); b.rotation.set(rnd(-0.4, 0.4), rnd(0, 3), rnd(-0.4, 0.4)); } add(this.box(4, 2, 4), M.crateBand, 0, 8); break; }
      case 'canister': g.userData.spin = add(G3.canister, M.canister); break;
      case 'ace': add(G3.ace, M.eliteHull); add(this.box(10, 6, 20), M.hostileD, 0, 6, 0); add(this.box(6, 2, 4), M.light, 0, 9, 10); g.userData.rotors = [rotor(-22, 9, -12, 26), rotor(22, 9, -12, 26)]; break;
      case 'crawler': { add(this.box(70, 16, 90), M.olive, 0, 8); for (const s of [-1, 1]) add(this.box(12, 14, 96), M.dark, s * 40, 7); const heads: THREE.Group[] = []; for (const ox of [-26, 0, 26]) { const h = new THREE.Group(); h.position.set(ox, 20, 10); add(G3.cyl6, M.oliveL, 0, 0, 0, h); add(this.box(3.5, 3.5, 18), M.steel, 0, 0, 10, h); g.add(h); heads.push(h); } g.userData.heads = heads; break; }
      case 'carrier': add(G3.carrier, M.eliteHull); add(this.box(20, 14, 30), M.hostileD, 22, 12, -10); add(this.box(60, 1, 70), M.dark, -6, 6, 0); break;
    }
    return g;
  }

  clear() { for (const m of this.live) { this.engine.scene.remove(m); (this.pool[m.userData.type] ||= []).push(m); } this.live.clear(); }

  update({ S, t }: FrameCtx) {
    const e = this.engine, k = e.groundScale, seen = new Set<THREE.Group>(), v = new THREE.Vector3();
    for (const en of S.enemies as Enemy[]) {
      let m: THREE.Group = en._m;
      if (!m) { m = this.make(en.type); en._m = m; e.scene.add(m); }
      seen.add(m);
      const air = en.layer === 'air', u = m.userData;
      if (air) { e.toFlight(en.x, en.y, 0, m.position); m.scale.setScalar(1); }
      else { e.toGround(en.x, en.y, m.position); m.scale.setScalar(k); }
      m.rotation.set(0, 0, 0);
      if (u.rotors) for (const r of u.rotors) r.rotation.y = t * 30;
      if (u.spin) { u.spin.rotation.y = t * 3; u.spin.rotation.x = t * 2; }
      if (u.head) u.head.rotation.y = Math.PI / 2 - en.ang;
      if (u.heads) for (const h of u.heads) h.rotation.y = Math.PI / 2 - en.ang;
      if (en.type === 'bomber') m.rotation.y = en.vx > 0 ? 0 : Math.PI;
      if (en.type === 'jet') m.rotation.z = Math.sin(en.t * 3) * 0.25;
      if (en.type === 'wreck') m.rotation.y = en.ang;
      const s = air ? 1 : k;
      if (en.flash > 0) e.glow.add(m.position.x, m.position.y + 10 * s, m.position.z, 0, en.r * 3.4 * s, en.r * 3.4 * s, rgb('#ffffff'), 0.5, Shape.Soft);
      if (air) {
        if (en.type === 'jet') { e.toFlight(en.x, en.y - 13, 1, v); e.glow.add(v.x, v.y, v.z, 0, 16, 16, rgb('#ffb347'), 0.9, Shape.Hot); }
        else e.glow.add(m.position.x, m.position.y + 8, m.position.z, 0, 10, 10, rgb('#ff5a4e'), 0.5 + 0.5 * Math.sin(t * 8 + en.x), Shape.Hot);
      } else if (en.type === 'cache' || en.type === 'wreck') e.glow.add(m.position.x, 6 * k, m.position.z, 0, en.r * 3 * k, en.r * 3 * k, rgb('#ffc24a'), 0.18 + 0.12 * Math.sin(t * 4 + en.x), Shape.Soft);
    }
    for (const m of this.live) if (!seen.has(m)) { e.scene.remove(m); (this.pool[m.userData.type] ||= []).push(m); }
    this.live = seen;
  }
}
