// Weapon turrets: one design per weapon id. Each turret is a small rig (yaw group, recoiling barrel
// groups, hatches) whose meshes are merged per material. The ship layer drives yaw and recoil.
import * as THREE from 'three';
import { Buckets, B, R, block, lathe, box, flatRect, octagon, type V2, type V3 } from './mesh';
import type { Livery } from './materials';
import { LightSet, LMode } from './lights';

export type AimKind = 'track' | 'cone' | 'fixed' | 'spin';
export interface Turret {
  uid: number; id: string; tier: number;
  /** Mount position in ship-local space (deck height). */
  x: number; y: number; z: number;
  root: THREE.Group; yaw: THREE.Group;
  barrels: THREE.Object3D[]; barrelRest: number[];
  /** Muzzle points in yaw-local space (for flashes). */
  muzzles: V3[];
  aim: AimKind; arc: number; rate: number; layer: 'air' | 'ground' | 'both' | 'none';
  cur: number; kick: number; lastFire: number; recoil: number;
  /** Extra animated parts. */
  lids: THREE.Object3D[]; doors: THREE.Object3D[]; glowMats: THREE.Material[];
  charge: THREE.Mesh | null;
}

const rotZ = new THREE.Matrix4().makeRotationX(-Math.PI / 2); // lathe Y axis -> -Z (forward)
const M = () => new THREE.Matrix4();
const T = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);

function rig(bk: Buckets, L: Livery, into: THREE.Object3D) {
  bk.meshes(L.mats, into, true);
}

/** Barrel along -Z starting at (x, y, z0): mantlet, tube, muzzle brake. */
function barrel(bk: Buckets, L: Livery, x: number, y: number, z0: number, len: number, r: number, brake = true, tipGlow = false) {
  const prof: V2[] = [[0, 0], [r * 1.9, 0], [r * 1.9, len * 0.12], [r * 1.25, len * 0.16], [r, len * 0.3], [r * 0.85, len * (brake ? 0.84 : 1)]];
  if (brake) prof.push([r * 1.45, len * 0.86], [r * 1.45, len], [r * 0.6, len]);
  else prof.push([r * 0.5, len]);
  lathe(bk, B.rail, prof, 10, L.paint.dark, T(x, y, z0).multiply(rotZ), false);
  if (tipGlow) lathe(bk, { m: 'glow', v0: 0, v1: 1 }, [[r * 0.55, len - 0.05], [r * 0.55, len + 0.3], [0, len + 0.3]], 8, L.paint.full, T(x, y, z0).multiply(rotZ));
}

/** Angular armoured gun house (top silhouette is what reads from the camera). */
function house(bk: Buckets, L: Livery, w: number, d: number, h: number, y0: number, nose = 0.62, stripe = true) {
  const poly: V2[] = [[-w * nose, -d * 0.55], [-w, -d * 0.12], [-w, d * 0.42], [-w * 0.8, d * 0.55], [w * 0.8, d * 0.55], [w, d * 0.42], [w, -d * 0.12], [w * nose, -d * 0.55]];
  block(bk, poly.map(([x, z]) => [x, z] as V2).reverse(), y0, y0 + h, { side: B.darkPanel, top: B.panels, col: L.paint.hull, bevel: Math.min(1.6, h * 0.4), taper: 0.5 });
  if (stripe) {
    // Hazard band across the rear of the roof, and a roof hatch.
    const y = y0 + h + 0.03;
    bk.get('hazard').quad([-w * 0.7, y, d * 0.28], [w * 0.7, y, d * 0.28], [w * 0.7, y, d * 0.42], [-w * 0.7, y, d * 0.42], [0, 1], [w * 0.09, 1], [w * 0.09, 0], [0, 0], L.paint.accent, [0, 1, 0]);
    flatRect(bk, R.hatchRound, -w * 0.32, d * 0.0, w * 0.06, d * 0.24, y, L.paint.hull);
    flatRect(bk, R.ventSlots, w * 0.2, -d * 0.1, w * 0.6, d * 0.2, y, L.paint.hull, true);
  }
}

export function buildTurret(id: string, tier: number, uid: number, x: number, y: number, z: number, L: Livery, lights: LightSet): Turret {
  const root = new THREE.Group(), yaw = new THREE.Group(); root.position.set(x, y, z); root.add(yaw);
  const s = (1 + 0.07 * (tier - 1)) * 1.2; root.scale.setScalar(s);
  const t: Turret = {
    uid, id, tier, x, y, z, root, yaw, barrels: [], barrelRest: [], muzzles: [], aim: 'cone', arc: 0.45, rate: 2.2, layer: 'air',
    cur: 0, kick: 0, lastFire: -99, recoil: 1.6, lids: [], doors: [], glowMats: [], charge: null,
  };
  const hb = new Buckets();
  const addBarrels = (fn: (bk: Buckets) => void, rest = 0) => {
    const g = new THREE.Group(); const bk = new Buckets(); fn(bk); rig(bk, L, g); g.position.z = rest; yaw.add(g); t.barrels.push(g); t.barrelRest.push(rest); return g;
  };
  const E = L.light;
  switch (id) {
    case 'pulse': {
      house(hb, L, 4.6, 10, 3.2, 0.4);
      addBarrels((bk) => { barrel(bk, L, -1.5, 2.1, -3.5, 11, 0.62, true, true); barrel(bk, L, 1.5, 2.1, -3.5, 11, 0.62, true, true); });
      t.muzzles.push([-1.5, 2.1, -14.5], [1.5, 2.1, -14.5]); t.arc = 0.5; t.rate = 2.6; t.layer = 'air'; t.recoil = 1.4;
      break;
    }
    case 'spread': {
      house(hb, L, 6.2, 8, 2.6, 0.4, 0.85);
      addBarrels((bk) => {
        for (let i = -2; i <= 2; i++) {
          const a = i * 0.2, m = new THREE.Matrix4().makeRotationY(-a).premultiply(T(i * 0.9, 1.9, -3.4));
          box(bk, B.rail, 0.7, 0.7, 7, L.paint.dark, m.clone().multiply(T(0, 0, -3.5)));
          box(bk, { m: 'glow', v0: 0, v1: 1 }, 0.5, 0.5, 0.6, L.paint.full, m.clone().multiply(T(0, 0.05, -7.1)));
        }
        box(bk, { m: 'glow', v0: 0, v1: 1 }, 9, 0.4, 0.5, L.paint.full, T(0, 2.9, -3.6));
      });
      t.muzzles.push([0, 1.9, -11]); t.arc = 0.3; t.rate = 1.8; t.layer = 'air'; t.recoil = 0.9;
      break;
    }
    case 'flak': {
      block(hb, octagon(-5, -4.5, 5, 5.5, 1.6), 0.4, 4, { side: B.darkPanel, top: B.brackets, col: L.paint.hull, bevel: 1.2, taper: 0.4 });
      flatRect(hb, R.grate, -3.6, 1.5, 3.6, 4.6, 4.03, L.paint.hull);
      addBarrels((bk) => { for (const bx of [-2.6, -0.9, 0.9, 2.6]) barrel(bk, L, bx, 2.6, -3.8, 8.5, 0.5, true); });
      t.muzzles.push([-1.7, 2.6, -12.3], [1.7, 2.6, -12.3]); t.arc = 0.6; t.rate = 2.4; t.layer = 'air'; t.recoil = 1.8;
      break;
    }
    case 'missile': {
      // Vertical launch cells under armoured lids; a small tracking director on top.
      block(hb, octagon(-6, -6.5, 6, 6.5, 1.4), 0.2, 2.6, { side: B.darkPanel, top: B.darkPanel, col: L.paint.hull, bevel: 0.8 });
      const lidsG = new THREE.Group(); root.add(lidsG);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) {
        const cx = -3.6 + i * 3.6, cz = -4.5 + j * 3;
        flatRect(hb, R.slot, cx - 1.4, cz - 1.15, cx + 1.4, cz + 1.15, 2.63, L.paint.dark);
        const lid = new THREE.Group(); lid.position.set(cx, 2.7, cz - 1.1);
        const lb = new Buckets(); box(lb, B.brackets, 2.6, 0.3, 2.2, j % 2 ? L.paint.plate : L.paint.hull, T(0, 0, 1.1)); rig(lb, L, lid);
        lidsG.add(lid); t.lids.push(lid);
      }
      for (const bx of [-6.4, 6.4]) hb.get('hazard').quad([bx - 0.3, 2.65, -6], [bx + 0.3, 2.65, -6], [bx + 0.3, 2.65, 6], [bx - 0.3, 2.65, 6], [0, 0], [0, 1], [3, 1], [3, 0], L.paint.accent, [0, 1, 0]);
      yaw.position.set(0, 2.6, 7.5);
      addBarrels((bk) => { lathe(bk, B.ribs, [[0, 0], [1.8, 0], [1.6, 1.4], [0.6, 2.2], [0, 2.3]], 10, L.paint.hull, M()); box(bk, B.rail, 0.5, 0.5, 3, L.paint.dark, T(0, 1.4, -2)); }, 0);
      t.aim = 'track'; t.arc = Math.PI; t.rate = 4; t.layer = 'both'; t.recoil = 0; t.muzzles.push([0, 2, -3]);
      lights.add(x, y + 3.2 * s, z + 7.5 * s, E.edge, 2.5, 0.9, LMode.Beacon);
      break;
    }
    case 'bomb': {
      // Ventral bomb bay seen through the deck: a glowing well under two hinged doors.
      block(hb, octagon(-6, -6, 6, 6, 1.6), -0.4, 0.5, { side: B.ribs, top: B.ribs, col: L.paint.dark, bevel: 0.3, capTop: false });
      hb.get('black').quad([-5, 0.1, -5], [5, 0.1, -5], [5, 0.1, 5], [-5, 0.1, 5], [0, 0], [1, 0], [1, 1], [0, 1], L.paint.dark, [0, 1, 0]);
      hb.get('core').quad([-3.6, 0.15, -3.8], [3.6, 0.15, -3.8], [3.6, 0.15, 3.8], [-3.6, 0.15, 3.8], [0, 0], [1, 0], [1, 1], [0, 1], L.paint.full.clone().multiplyScalar(0.07), [0, 1, 0]);
      for (const side of [-1, 1]) {
        const door = new THREE.Group(); door.position.set(side * 5, 0.55, 0);
        const db = new Buckets(); box(db, B.brackets, 5, 0.35, 10, L.paint.plate, T(-side * 2.5, 0, 0));
        db.get('hazard').quad([-side * 0.2, 0.19, -5], [-side * 1.2, 0.19, -5], [-side * 1.2, 0.19, 5], [-side * 0.2, 0.19, 5], [0, 0], [0, 1], [3, 1], [3, 0], L.paint.accent, [0, 1, 0]);
        rig(db, L, door); root.add(door); t.doors.push(door);
      }
      for (const [lx, lz] of [[-6.2, -6.2], [6.2, -6.2], [-6.2, 6.2], [6.2, 6.2]]) lights.add(x + lx * s, y + 0.8, z + lz * s, E.port, 2.2, 0.9, LMode.Beacon, (lx + lz) * 0.05 + 0.5);
      t.aim = 'fixed'; t.arc = 0; t.layer = 'ground'; t.recoil = 0;
      break;
    }
    case 'artillery': {
      lathe(hb, B.panels, [[0, 0.3], [7, 0.3], [7, 1.6], [6.2, 3.4], [4.6, 4.8], [0, 5.1]], 16, L.paint.hull, M());
      flatRect(hb, R.hatchCross, -2.2, 0.8, 2.2, 5, 5.12, L.paint.hull);
      addBarrels((bk) => {
        const m = T(0, 3.2, -3).multiply(new THREE.Matrix4().makeRotationX(0.28)).multiply(rotZ);
        lathe(bk, B.rail, [[0, 0], [2.6, 0], [2.6, 2], [1.7, 2.6], [1.5, 8.5], [2.4, 9], [2.4, 11.5], [1.0, 11.6]], 12, L.paint.dark, m);
      });
      t.muzzles.push([0, 6.5, -14]); t.aim = 'track'; t.arc = Math.PI; t.rate = 1.1; t.layer = 'ground'; t.recoil = 3.2;
      break;
    }
    case 'rail': {
      house(hb, L, 5, 14, 3.4, 0.4, 0.7);
      addBarrels((bk) => {
        for (const bx of [-1.7, 1.7]) box(bk, B.rail, 1.1, 1.5, 30, L.paint.dark, T(bx, 2.6, -18));
        box(bk, B.ribs, 4.6, 0.8, 30, L.paint.hull, T(0, 1.8, -18));
        for (let k = 0; k < 8; k++) lathe(bk, B.ribs, [[2.2, 0], [2.9, 0], [2.9, 0.9], [2.2, 0.9]], 10, L.paint.hull, T(0, 2.4, -6 - k * 3.6).multiply(rotZ));
      }, 0);
      // Charge glow strip between the rails: brightens as the slug charges.
      const cg = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.3, 28), (L.mats.glow as THREE.MeshBasicMaterial).clone());
      cg.position.set(0, 2.5, -18); cg.userData.own = true; t.barrels[0].add(cg); t.charge = cg; t.glowMats.push(cg.material as THREE.Material);
      t.muzzles.push([0, 2.6, -33]); t.aim = 'fixed'; t.arc = 0.05; t.rate = 0.6; t.layer = 'both'; t.recoil = 2.6;
      break;
    }
    case 'tesla': {
      lathe(hb, B.ribs, [[0, 0.3], [5.4, 0.3], [5.4, 1.4], [3.2, 2]], 12, L.paint.hull, M());
      addBarrels((bk) => {
        lathe(bk, B.rail, [[0, 1.8], [2.2, 1.8], [1.4, 3], [1.1, 9], [0, 9]], 10, L.paint.dark, M());
        for (let k = 0; k < 3; k++) lathe(bk, B.ribs, [[1, 3.5 + k * 1.7], [3.6 - k * 0.5, 3.7 + k * 1.7], [3.6 - k * 0.5, 4.3 + k * 1.7], [1, 4.5 + k * 1.7]], 14, L.paint.plate, M());
        lathe(bk, { m: 'glow', v0: 0, v1: 1 }, [[0, 8.6], [1.7, 9.1], [1.7, 10.2], [0, 10.9]], 10, L.paint.full, M());
      });
      t.aim = 'spin'; t.arc = Math.PI; t.rate = 0.8; t.layer = 'both'; t.recoil = 0; t.muzzles.push([0, 10, 0]);
      break;
    }
    case 'pd': {
      lathe(hb, B.ribs, [[0, 0.3], [4.2, 0.3], [4.2, 1.2]], 10, L.paint.hull, M());
      addBarrels((bk) => {
        lathe(bk, B.panels, [[0, 1.2], [3.4, 1.2], [3.3, 2.6], [2.4, 4], [0, 4.4]], 12, L.paint.plate, M());
        lathe(bk, B.rail, [[0, 0], [0.9, 0], [0.9, 7], [0.4, 7]], 8, L.paint.dark, T(0, 2.6, -2).multiply(rotZ));
      });
      t.muzzles.push([0, 2.6, -9]); t.aim = 'track'; t.arc = Math.PI; t.rate = 7; t.layer = 'none'; t.recoil = 0.6;
      break;
    }
    default: {
      house(hb, L, 4, 8, 3, 0.4);
      t.aim = 'fixed';
    }
  }
  if (id !== 'missile' && id !== 'bomb' && id !== 'tesla') {
    // Ring of crew lights round the gun house.
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; lights.add(x + Math.cos(a) * 7.4 * s, y + 0.5, z + Math.sin(a) * 7.4 * s, E.edge, 1.3, 0.7, LMode.Steady); }
  }
  // Static parts of the turret rotate with yaw except the bay, VLS and coil base.
  rig(hb, L, id === 'missile' || id === 'bomb' || id === 'tesla' ? root : yaw);
  root.traverse((o) => { o.userData.own = true; });
  return t;
}
