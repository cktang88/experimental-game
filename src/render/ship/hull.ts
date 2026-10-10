// Procedural carrier-scale warship built from a Derived hull layout (dv.rects / dv.mounts).
// Ship-local space: x to starboard (screen right), y up, +z toward the stern; field units
// (one unit is about one screen pixel, so a 150-unit starter hull is ~300 m of ship at 2 m/unit).
//
// Layers, outside in:
//   1. Hull: one continuous lofted slab (chamfered deck edge, armour belt, bilge, keel) whose plan
//      follows the section widths with 45-degree transitions and an ogival bow.
//   2. Deck: plating strakes that follow the hull lines, each strake a trim-sheet band.
//   3. Superstructure per section type (bridge tower stack, gun decks, broadside sponsons, armoured
//      flight deck, utility spine, engine block), with lit window bands and drop shadows.
//   4. Kitbash: Quaternius sci-fi kit pieces (vents, fans, barrels, lights, decals) merged per material.
//   5. Life: thousands of running lights, rotating radars, spinning fans, beacons and strobes.
import * as THREE from 'three';
import { WEAPONS, UTILS, type Derived, type Rect as HullRect, type Mount } from '../../data/parts';
import { SHIP_SCALE } from '../../game/field';
import { has, mulberry32, type Rng } from '../../util/rng';
import { source, meshesOf } from '../assets';
import { Buckets, B, R, block, flat, flatRect, lathe, box, octagon, type V2, type V3, type Band } from './mesh';
import { KIT_MAT, STENCIL_CHARS, type Livery, type MatKey } from './materials';
import { LightSet, LMode, lightMaterial } from './lights';
import { buildMount, GunRig, type Turret } from './turrets';
import { mountTraverse } from './arcs';
import { occupied, claim, onDeck, deckGreebles, beltGreebles, stencil, antenna, dish, machinery, type GCtx } from './greebles';

/** Ships are designed at this SHIP_SCALE; other scales build at the reference size and scale the body. */
const REF_SCALE = 2.6;

export const DECK = 8, KEEL = -9;

export interface Nozzle { x: number; y: number; z: number; r: number; main: boolean }
export interface Spinner { obj: THREE.Object3D; speed: number }
export interface ShipModel {
  /** root: placed and oriented by the layer. body: scaled by k; every mesh and every point below is in body space. */
  root: THREE.Group; body: THREE.Group; k: number;
  turrets: Turret[]; rig: GunRig; nozzles: Nozzle[]; dmgPts: V3[]; vents: V3[]; spinners: Spinner[];
  lights: THREE.Points; edges: THREE.LineSegments | null; scorch: THREE.Mesh; len: number; width: number; hostile: boolean; tris: number;
}

interface Ctx extends GCtx {
  rnd: Rng;
  dmg: V3[]; vents: V3[]; spin: Spinner[]; nozzles: Nozzle[]; root: THREE.Group; turrets: Turret[];
  edgeSegs: THREE.BufferGeometry[]; sig: number;
}

/* ---------------- helpers ---------------- */
const col = (c: THREE.Color, k: number) => c.clone().multiplyScalar(k);
function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

/** Soft drop shadow on the surface at y, cast by something h tall over the plan rect. Moon is up-left-forward. */
function dropShadow(c: Ctx, x0: number, z0: number, x1: number, z1: number, y: number, h: number) {
  const ox = h * 0.8, oz = h * 0.62, g = 0.8 + h * 0.3;
  c.bk.get('shadow').quad([x0 - g + ox, y, z0 - g + oz], [x1 + g + ox, y, z0 - g + oz], [x1 + g + ox, y, z1 + g + oz], [x0 - g + ox, y, z1 + g + oz], [0, 0], [1, 0], [1, 1], [0, 1], c.L.paint.hull, [0, 1, 0]);
}

/** Additive pool of warm light on a surface (floodlights, window spill). */
function pool(c: Ctx, x: number, z: number, w: number, d: number, y: number, k = 1) {
  c.bk.get('pool').quad([x - w / 2, y, z - d / 2], [x + w / 2, y, z - d / 2], [x + w / 2, y, z + d / 2], [x - w / 2, y, z + d / 2], [0, 0], [1, 0], [1, 1], [0, 1], col(c.L.paint.full, k), [0, 1, 0]);
}

/** Roof clutter on a superstructure block: a machinery field, hatches, a skylight strip, masts and dishes. */
function roof(c: Ctx, x0: number, z0: number, x1: number, z1: number, y: number) {
  const P = c.L.paint, w = x1 - x0, d = z1 - z0;
  if (w < 3 || d < 3) return;
  // Big roofs carry a whole machinery field (the small-scale layer that makes the block a building).
  if (w * d > 40) { machinery(c, c.rnd, x0 + 0.4, z0 + 0.4, x1 - 0.4, z1 - 0.4, y, 0.9); return; }
  if (c.rnd() < 0.6 && d > 5) { const sx = x0 + w * (0.2 + c.rnd() * 0.6); flat(c.bk, 'window', sx - 0.25, z0 + 1, sx + 0.25, z1 - 1, y + 0.04, P.full, [[0, 0.25], [0, 0.5], [(d - 2) / 60, 0.5], [(d - 2) / 60, 0.25]]); }
  // Dense rooftop plant: the small-scale layer that gives the tower its size.
  const n = Math.min(14, Math.floor((w * d) / 14));
  for (let i = 0; i < n; i++) {
    const kind = Math.floor(c.rnd() * 7), cx = x0 + 1 + c.rnd() * (w - 2), cz = z0 + 1 + c.rnd() * (d - 2);
    if (kind === 0) flatRect(c.bk, R.hatchRound, cx - 0.5, cz - 0.5, cx + 0.5, cz + 0.5, y + 0.05, P.plate);
    else if (kind === 1) flatRect(c.bk, R.ventSlots, cx - 0.8, cz - 0.35, cx + 0.8, cz + 0.35, y + 0.05, P.hull);
    else if (kind === 2) kit(c, 'Prop_Vent_Small', cx, y + 0.02, cz, c.rnd() < 0.5 ? 0 : Math.PI / 2, 0.9);
    else if (kind === 3) { const bw = 0.6 + c.rnd() * 1.4, bd = 0.5 + c.rnd() * 1.2, bh = 0.3 + c.rnd() * 0.7; box(c.bk, B.ribs, bw, bh, bd, col(P.hull, 0.9 + c.rnd() * 0.4), new THREE.Matrix4().makeTranslation(cx, y + bh / 2, cz)); }
    else if (kind === 4) antenna(c, cx, y, cz, 1.5 + c.rnd() * 3, c.rnd);
    else if (kind === 5) dish(c, cx, y, cz, 0.5 + c.rnd() * 0.6, c.rnd);
    else c.lights.add(cx, y + 0.15, cz, c.L.light.edge, 0.9, 0.16, LMode.Steady, c.rnd());
  }
}

/** Lit window band around a convex plan polygon between heights ya..yb. */
function windowBand(c: Ctx, poly: V2[], ya: number, yb: number, rows = 0.5, tile = 40) {
  let cx = 0, cz = 0; for (const p of poly) { cx += p[0]; cz += p[1]; } cx /= poly.length; cz /= poly.length;
  const mb = c.bk.get('window'); let per = c.rnd() * 30;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 1.5) { per += len; continue; }
    const nx = (b[1] - a[1]) / len, nz = -(b[0] - a[0]) / len, dir = (nx * ((a[0] + b[0]) / 2 - cx) + nz * ((a[1] + b[1]) / 2 - cz)) > 0 ? 1 : -1, o = 0.07 * dir;
    const v0 = Math.floor(c.rnd() * 2) * 0.5;
    mb.quad([a[0] + nx * o, ya, a[1] + nz * o], [b[0] + nx * o, ya, b[1] + nz * o], [b[0] + nx * o, yb, b[1] + nz * o], [a[0] + nx * o, yb, a[1] + nz * o],
      [per / tile, v0 + rows], [(per + len) / tile, v0 + rows], [(per + len) / tile, v0], [per / tile, v0], c.L.paint.full, [nx * dir, 0, nz * dir]);
    per += len;
  }
}

/** Lights along a polygon outline at height y, pushed outward by `out`. */
function outlineLights(c: Ctx, poly: V2[], y: number, step: number, hex: string, k: number, size: number, fill = 1, mode = LMode.Steady, out = 0.25) {
  let cx = 0, cz = 0; for (const p of poly) { cx += p[0]; cz += p[1]; } cx /= poly.length; cz /= poly.length;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ax = a[0] + Math.sign(a[0] - cx) * out, az = a[1] + Math.sign(a[1] - cz) * out, bx = b[0] + Math.sign(b[0] - cx) * out, bz = b[1] + Math.sign(b[1] - cz) * out;
    c.lights.row([ax, y, az], [bx, y, bz], step, hex, k, size, fill, mode, c.rnd);
  }
}

interface TowerOpts { side?: Band; top?: Band; col?: THREE.Color; bevel?: number; taper?: number; win?: [number, number][]; edgeLights?: boolean; shadow?: boolean; claim?: boolean; roof?: boolean }
/** A superstructure block: geometry, drop shadow, window bands, roof-edge lights, occupancy. */
function tower(c: Ctx, poly: V2[], y0: number, y1: number, o: TowerOpts = {}) {
  const base = o.col ?? c.L.paint.hull;
  // Roofs catch the moon; walls sit in shadow.
  block(c.bk, poly, y0, y1, { side: o.side ?? B.darkPanel, top: o.top ?? B.panels, col: col(base, 0.7), topCol: col(base, 1.3), bevel: o.bevel ?? 1, taper: o.taper ?? 0.3 });
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  if (o.shadow !== false) dropShadow(c, x0, z0, x1, z1, y0 + 0.06, y1 - y0);
  for (const [a, b] of o.win ?? []) windowBand(c, poly, a, b);
  if (o.win?.length) {
    // Window light spilling onto the deck round the base.
    const k = 0.55;
    pool(c, (x0 + x1) / 2, z1 + 1.2, x1 - x0, 4, y0 + 0.09, k); pool(c, (x0 + x1) / 2, z0 - 1.2, x1 - x0, 4, y0 + 0.09, k * 0.7);
    pool(c, x0 - 1.2, (z0 + z1) / 2, 4, z1 - z0, y0 + 0.09, k * 0.8); pool(c, x1 + 1.2, (z0 + z1) / 2, 4, z1 - z0, y0 + 0.09, k * 0.8);
  }
  const bev = Math.min(o.bevel ?? 1, (y1 - y0) * 0.45), ins = bev + (o.taper ?? 0.3);
  if (o.roof !== false) roof(c, x0 + ins, z0 + ins, x1 - ins, z1 - ins, y1);
  if (o.edgeLights !== false) outlineLights(c, poly.map(([x, z]) => [x * 0.985, z] as V2), y1 + 0.12, 1.1, c.L.light.edge, 0.9, 0.22, 0.75, LMode.Steady, -0.4);
  if (o.claim !== false) claim(c, x0, z0, x1, z1);
  c.edgeSegs.push(edgeRing(poly, y1));
  return { x0, x1, z0, z1 };
}
function edgeRing(poly: V2[], y: number) {
  const p: number[] = [];
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; p.push(a[0], y, a[1], b[0], y, b[1]); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); return g;
}

/* ---------------- kitbash ---------------- */
const kitCache = new Map<string, { geo: THREE.BufferGeometry; m: THREE.Matrix4; key: MatKey }[]>();
function kitParts(name: string) {
  let k = kitCache.get(name); if (k) return k;
  k = [];
  const src = source('scifi', name);
  if (src) for (const { mesh, matrix } of meshesOf(src)) {
    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material;
    k.push({ geo: mesh.geometry, m: matrix, key: KIT_MAT[mat.name] ?? 't2' });
  }
  kitCache.set(name, k); return k;
}
function kitCol(c: Ctx, key: MatKey) {
  const P = c.L.paint;
  if (key === 'glass' || key === 'lamp' || key === 'window' || key === 'glow' || key === 'core') return P.full;
  return key === 't1' ? P.hull : key === 't2' ? P.plate : key === 't3' ? P.plate : key === 'dark' ? P.dark : key === 'hazard' ? P.accent : P.hull;
}
/** Place a kit model: position, yaw, uniform scale (and optional extra matrix). */
function kit(c: Ctx, name: string, x: number, y: number, z: number, yaw = 0, s = 1, pre?: THREE.Matrix4, into?: Buckets) {
  const parts = kitParts(name); if (!parts.length) return false;
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(s, s, s));
  if (pre) m.multiply(pre);
  for (const p of parts) (into ?? c.bk).get(p.key).addGeometry(p.geo, m.clone().multiply(p.m), kitCol(c, p.key));
  return true;
}

/* ---------------- hull outline ---------------- */
const HULL_K: Record<string, number> = { bridge: 0.84, gundeck: 0.94, battery: 0.9, armor: 1, spine: 0.84, engine: 0.9 };
interface Station { z: number; hw: number }
function stations(rects: HullRect[]): Station[] {
  const st: Station[] = [], hws = rects.map((r) => (r.w / 2) * (HULL_K[r.type] ?? 0.9));
  const ramp = rects.map((r, i) => (i ? Math.min(Math.max(Math.abs(hws[i] - hws[i - 1]) * 0.9, 2), Math.min(r.h, rects[i - 1].h) * 0.4) : 0));
  rects.forEach((r, i) => {
    const z0 = r.y, z1 = r.y + r.h, hw = hws[i];
    if (i === 0) {
      const room = r.h - (rects.length > 1 ? ramp[1] / 2 : 6) - 1, L = Math.min(r.h * 0.8, 60, room);
      // Clipper prow: a fine entry that swells into the shoulders.
      for (let k = 0; k <= 8; k++) { const t = k / 8; st.push({ z: z0 + L * t, hw: hw * (0.08 + 0.92 * (0.55 * t + 0.45 * (1 - Math.pow(1 - t, 3)))) }); }
    } else {
      st.push({ z: z0 - ramp[i] / 2, hw: hws[i - 1] }, { z: z0 + ramp[i] / 2, hw });
    }
    if (i === rects.length - 1) st.push({ z: z1 - 5, hw }, { z: z1, hw: hw - 4 });
  });
  // Monotonic guard.
  for (let i = 1; i < st.length; i++) if (st[i].z <= st[i - 1].z) st[i].z = st[i - 1].z + 0.01;
  return st;
}
function hwFn(st: Station[]) {
  return (z: number) => {
    if (z <= st[0].z) return st[0].hw; if (z >= st[st.length - 1].z) return st[st.length - 1].hw;
    for (let i = 1; i < st.length; i++) if (z <= st[i].z) { const a = st[i - 1], b = st[i], t = (z - a.z) / (b.z - a.z || 1); return a.hw + (b.hw - a.hw) * t; }
    return st[st.length - 1].hw;
  };
}
/** Inner edge of the outboard gallery: the main deck spans +-terrace(hw). */
export const terrace = (hw: number) => hw - Math.min(Math.max(5, hw * 0.13), hw * 0.4);
/** Starboard half-profile, top to bottom: main deck edge, terrace wall, gallery, chamfer, belt, bilge, keel. */
function profile(hw: number): V2[] {
  const T = terrace(hw);
  return [[T, DECK], [T + 0.5, DECK - 2.4], [hw - 1.4, DECK - 2.4], [hw, DECK - 3.6], [hw, DECK - 8], [hw - 2, DECK - 10], [hw * 0.62, KEEL + 1.5], [hw * 0.25, KEEL]];
}
const PROFILE_BANDS: Band[] = [B.lightbar, B.grille, B.ribs, B.panels, B.ribs, B.darkPanel, B.darkPanel];
const PROFILE_SHADE = [1.0, 0.8, 1.0, 1.0, 0.8, 0.6, 0.5];

function hull(c: Ctx, st: Station[]) {
  const P = c.L.paint, LL = c.L.light;
  for (let i = 0; i < st.length - 1; i++) {
    const a = st[i], b = st[i + 1], pa = profile(a.hw), pb = profile(b.hw);
    for (const sx of [1, -1]) {
      for (let k = 0; k < pa.length - 1; k++) {
        const band = PROFILE_BANDS[k], h = Math.hypot(pa[k + 1][0] - pa[k][0], pa[k + 1][1] - pa[k][1]), tile = h / (band.v1 - band.v0) || 10;
        const out: V3 = [sx * (pa[k][0] + pa[k + 1][0]) / 2, (pa[k][1] + pa[k + 1][1]) / 2 - (DECK - 6), 0];
        if (k === 1) { out[0] = 0; out[1] = 1; } // gallery deck faces up
        c.bk.get(band.m).quad([sx * pa[k][0], pa[k][1], a.z], [sx * pb[k][0], pb[k][1], b.z], [sx * pb[k + 1][0], pb[k + 1][1], b.z], [sx * pa[k + 1][0], pa[k + 1][1], a.z],
          [a.z / tile, band.v0], [b.z / tile, band.v0], [b.z / tile, band.v1], [a.z / tile, band.v1], col(k === 1 ? P.plate : P.hull, PROFILE_SHADE[k]), out);
      }
      // Safety line inboard of the deck edge.
      { const ia = terrace(a.hw) - 1.6, ib = terrace(b.hw) - 1.6, y = DECK + 0.03;
        c.bk.get('paint').quad([sx * ia, y, a.z], [sx * (ia - 0.45), y, a.z], [sx * (ib - 0.45), y, b.z], [sx * ib, y, b.z], [0, a.z / 30], [0.02, a.z / 30], [0.02, b.z / 30], [0, b.z / 30], col(P.accent, 0.55), [0, 1, 0]); }
      // Life along the hull: main-deck edge lamps, terrace portholes, gallery walkway lamps, belt portholes.
      const T0 = terrace(a.hw), T1 = terrace(b.hw);
      // Thousands of crew: dense, faint porthole rows on four decks of the belt, deck-edge lamps above.
      c.lights.row([sx * (T0 - 0.4), DECK + 0.15, a.z], [sx * (T1 - 0.4), DECK + 0.15, b.z], 1.6, LL.edge, 1.0, 0.24, 0.8, LMode.Steady, c.rnd);
      c.lights.row([sx * (T0 + 0.55), DECK - 1.0, a.z], [sx * (T1 + 0.55), DECK - 1.0, b.z], 0.55, LL.window, 0.9, 0.2, 0.55, LMode.Steady, c.rnd);
      c.lights.row([sx * (a.hw - 1.6), DECK - 2.25, a.z], [sx * (b.hw - 1.6), DECK - 2.25, b.z], 1.2, LL.window, 1.0, 0.22, 0.7, LMode.Steady, c.rnd);
      for (const [yy, f] of [[DECK - 4.6, 0.55], [DECK - 5.5, 0.5], [DECK - 6.4, 0.42], [DECK - 7.3, 0.32]]) c.lights.row([sx * (a.hw + 0.12), yy, a.z], [sx * (b.hw + 0.12), yy, b.z], 0.5, LL.window, 0.85, 0.19, f, LMode.Steady, c.rnd);
    }
    const kA = pa[pa.length - 1], kB = pb[pb.length - 1];
    c.bk.get('t1').quad([-kA[0], KEEL, a.z], [kA[0], KEEL, a.z], [kB[0], KEEL, b.z], [-kB[0], KEEL, b.z], [0, 0.6], [1, 0.6], [1, 0.9], [0, 0.9], P.dark, [0, -1, 0]);
  }
  // Bow and stern caps (the transom faces the camera).
  const cap = (s: Station, dir: number) => {
    const half = profile(s.hw), ring: V2[] = [...half, ...half.slice().reverse().map(([x, y]) => [-x, y] as V2)];
    const mb = c.bk.get('t1'), cz = s.z, tile = 24;
    const uv = (x: number, y: number): V2 => [x / tile, B.darkPanel.v0 + ((DECK - y) / (DECK - KEEL)) * (B.darkPanel.v1 - B.darkPanel.v0)];
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      mb.tri([0, DECK - 5, cz], [p[0], p[1], cz], [q[0], q[1], cz], uv(0, DECK - 5), uv(p[0], p[1]), uv(q[0], q[1]), col(P.hull, 0.7), [0, 0, dir]);
    }
  };
  cap(st[0], -1); cap(st[st.length - 1], 1);
  // Stern: rows of cabin lights across the transom, and a hazard band at the deck edge.
  const s = st[st.length - 1];
  for (const [yy, f] of [[DECK - 1.2, 0.7], [DECK - 4, 0.75], [DECK - 4.9, 0.6], [DECK - 5.8, 0.6], [DECK - 6.7, 0.5], [DECK - 7.6, 0.4]]) c.lights.row([-s.hw + 2.5, yy, s.z + 0.3], [s.hw - 2.5, yy, s.z + 0.3], 0.5, LL.window, 0.95, 0.2, f, LMode.Steady, c.rnd);
  const zt = s.z - 0.2, hz = c.bk.get('hazard'), e = terrace(s.hw) - 0.3;
  hz.quad([-e, DECK + 0.04, zt - 2.2], [e, DECK + 0.04, zt - 2.2], [e, DECK + 0.04, zt], [-e, DECK + 0.04, zt], [0, 0], [e / 4, 0], [e / 4, 1], [0, 1], P.accent, [0, 1, 0]);
  // Edge silhouette for the ghost livery.
  const ep: number[] = [];
  for (let i = 0; i < st.length - 1; i++) for (const sx of [1, -1]) for (const k of [0, 3]) {
    const pa = profile(st[i].hw)[k], pb = profile(st[i + 1].hw)[k]; ep.push(sx * pa[0], pa[1], st[i].z, sx * pb[0], pb[1], st[i + 1].z);
  }
  const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.Float32BufferAttribute(ep, 3)); c.edgeSegs.push(eg);
}

/** Deck plating: parallel strakes (fixed x lanes), broken into staggered plates of varied tone, clipped to the deck edge. */
function deck(c: Ctx, st: Station[], rects: HullRect[], maxHw: number) {
  const SW = 7.5, E = terrace(maxHw), N = Math.max(5, (Math.round((E * 2) / SW) | 1)), half = (N - 1) / 2;
  const typeAt = (z: number) => { for (const r of rects) if (z >= r.y && z <= r.y + r.h) return r.type; return rects[rects.length - 1].type; };
  const zS = st[0].z, zE = st[st.length - 1].z;
  for (let k = 0; k < N; k++) {
    const d = Math.abs(k - half), x0 = -E + (2 * E * k) / N, x1 = -E + (2 * E * (k + 1)) / N;
    let cur = zS - c.rnd() * 10;
    while (cur < zE) {
      const L = 7 + c.rnd() * 11, za = Math.max(cur, zS), zb = Math.min(cur + L, zE); cur += L;
      if (zb - za < 0.05) continue;
      const rr = c.rnd(), tone = rr < 0.06 ? 0.62 : rr > 0.95 ? 1.18 : 0.84 + c.rnd() * 0.22;
      const zs = [za]; for (const s0 of st) if (s0.z > za + 0.01 && s0.z < zb - 0.01) zs.push(s0.z); zs.push(zb);
      for (let j = 0; j < zs.length - 1; j++) {
        const z0 = zs[j], z1 = zs[j + 1], type = typeAt((z0 + z1) / 2);
        let band: Band;
        if (type === 'armor') band = d <= 2 ? B.doors : d <= 3 ? B.brackets : d % 2 ? B.darkPanel : B.panels;
        else if (type === 'engine') band = d === 0 ? B.grille : d <= 2 ? B.darkPanel : d % 2 ? B.panels : B.brackets;
        else if (type === 'battery') band = d === 0 ? B.doors : d % 2 ? B.darkPanel : B.panels;
        else band = d === 0 ? B.doors : d % 3 === 1 ? B.panels : d % 3 === 2 ? B.brackets : B.darkPanel;
        const ea = c.de(z0), eb = c.de(z1), cl = (x: number, e: number) => Math.max(-e, Math.min(e, x));
        const xa0 = cl(x0, ea), xa1 = cl(x1, ea), xb0 = cl(x0, eb), xb1 = cl(x1, eb);
        if (xa1 - xa0 < 0.01 && xb1 - xb0 < 0.01) continue;
        const tile = (x1 - x0) / (band.v1 - band.v0), vv = (x: number) => band.v0 + ((x - x0) / (x1 - x0)) * (band.v1 - band.v0);
        const shade = col(type === 'armor' && d <= 2 ? c.L.paint.plate : c.L.paint.hull, tone);
        c.bk.get(band.m).quad([xa0, DECK, z0], [xa1, DECK, z0], [xb1, DECK, z1], [xb0, DECK, z1],
          [z0 / tile, vv(xa0)], [z0 / tile, vv(xa1)], [z1 / tile, vv(xb1)], [z1 / tile, vv(xb0)], shade, [0, 1, 0]);
      }
    }
  }
}

/* ---------------- section features ---------------- */
function paintQuad(c: Ctx, x0: number, z0: number, x1: number, z1: number, colr: THREE.Color, y = DECK + 0.03) {
  flat(c.bk, 'paint', x0, z0, x1, z1, y, colr, [[x0 / 30, z0 / 30], [x1 / 30, z0 / 30], [x1 / 30, z1 / 30], [x0 / 30, z1 / 30]]);
}
function hazardStrip(c: Ctx, x0: number, z0: number, x1: number, z1: number, y = DECK + 0.04) {
  const alongZ = z1 - z0 > x1 - x0, L = alongZ ? z1 - z0 : x1 - x0, wv = alongZ ? x1 - x0 : z1 - z0, u = L / (wv * 4);
  const mb = c.bk.get('hazard');
  if (alongZ) mb.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, 0], [0, 1], [u, 1], [u, 0], c.L.paint.accent, [0, 1, 0]);
  else mb.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, 0], [u, 0], [u, 1], [0, 1], c.L.paint.accent, [0, 1, 0]);
}
/** Forward-pointing chevron painted on deck. */
function chevron(c: Ctx, x: number, z: number, w: number, th: number, colr: THREE.Color) {
  const mb = c.bk.get('paint'), y = DECK + 0.035;
  for (const s of [-1, 1]) mb.quad([0 + x, y, z], [s * w + x, y, z + w * 0.7], [s * w + x, y, z + w * 0.7 + th], [0 + x, y, z + th], [0, 0], [1, 0], [1, 1], [0, 1], colr, [0, 1, 0]);
}
function digits(c: Ctx, text: string, x: number, z: number, s: number) {
  const w = 0.82 * s; let cx = x - ((text.length - 1) * w) / 2;
  for (const ch of text) { kit(c, `Decal_${ch}`, cx, DECK + 0.05, z, 0, s); cx += w; }
}
function mast(c: Ctx, x: number, y: number, z: number, h: number) {
  box(c.bk, B.rail, 0.7, h, 0.7, c.L.paint.dark, new THREE.Matrix4().makeTranslation(x, y + h / 2, z));
  box(c.bk, B.rail, 9, 0.4, 0.5, c.L.paint.dark, new THREE.Matrix4().makeTranslation(x, y + h * 0.7, z));
  box(c.bk, B.rail, 5, 0.35, 0.45, c.L.paint.dark, new THREE.Matrix4().makeTranslation(x, y + h * 0.88, z));
  for (const ax of [-3.5, -1.2, 1.4, 3.3]) box(c.bk, B.rail, 0.18, 4, 0.18, c.L.paint.dark, new THREE.Matrix4().makeTranslation(x + ax, y + h * 0.7 + 2, z));
  c.lights.add(x, y + h + 0.4, z, c.L.light.strobe, 3, 1.4, LMode.Strobe, c.rnd());
  c.lights.add(x - 4.5, y + h * 0.7, z, c.L.light.port, 2.2, 1.0, LMode.Beacon, 0.1);
  c.lights.add(x + 4.5, y + h * 0.7, z, c.L.light.star, 2.2, 1.0, LMode.Beacon, 0.6);
  dropShadow(c, x - 0.4, z - 0.4, x + 0.4, z + 0.4, DECK + 0.07, h * 0.6);
}
function radar(c: Ctx, x: number, y: number, z: number, r: number, speed: number) {
  const g = new THREE.Group(); g.position.set(x, y, z);
  const bk = new Buckets();
  box(bk, B.rail, 0.8, 1.6, 0.8, c.L.paint.dark, new THREE.Matrix4().makeTranslation(0, 0.8, 0));
  // Dish: shallow paraboloid facing sideways, on a yoke.
  const dm = new THREE.Matrix4().makeTranslation(0, 1.9, 0).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2 - 0.35));
  lathe(bk, B.panels, [[0, 0], [r * 0.45, 0.12 * r], [r * 0.8, 0.32 * r], [r, 0.5 * r]], 12, c.L.paint.plate, dm);
  lathe(bk, B.rail, [[0, 0], [r * 0.12, 0], [r * 0.08, 0.9 * r], [0, 0.95 * r]], 6, c.L.paint.dark, dm);
  bk.meshes(c.L.mats, g, true);
  g.rotation.y = c.rnd() * Math.PI * 2;
  c.root.add(g); c.spin.push({ obj: g, speed });
  c.lights.add(x, y + 2.2 + r * 0.3, z, c.L.light.port, 1.6, 0.8, LMode.Beacon, c.rnd());
}
function fan(c: Ctx, x: number, z: number, s: number, y = DECK) {
  kit(c, 'Prop_Fan_Small', x, y + 0.25 * s, z, 0, s);
  const parts = kitParts('Prop_Fan_Small_Propeller'); if (!parts.length) return;
  // Only the big engine intakes spin (each spinner is its own draw call); small fans are merged, static.
  if (s < 2) { kit(c, 'Prop_Fan_Small_Propeller', x, y + 0.3 * s, z, c.rnd() * 6, s); return; }
  const g = new THREE.Group(); g.position.set(x, y + 0.3 * s, z); g.scale.setScalar(s);
  const bk = new Buckets(); for (const p of parts) bk.get(p.key).addGeometry(p.geo, p.m, kitCol(c, p.key));
  bk.meshes(c.L.mats, g, false); c.root.add(g); c.spin.push({ obj: g, speed: 7 + c.rnd() * 4 });
  c.vents.push([x, y + 1, z]);
}
function pipeRun(c: Ctx, x: number, y: number, z0: number, z1: number, r: number) {
  const m = new THREE.Matrix4().makeTranslation(x, y, z0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  lathe(c.bk, B.rail, [[r, 0], [r, z1 - z0]], 8, c.L.paint.dark, m);
  for (let z = z0 + 3; z < z1 - 1; z += 7) box(c.bk, B.ribs, r * 2 + 1, r * 2 + 0.6, 0.9, c.L.paint.hull, new THREE.Matrix4().makeTranslation(x, y, z));
}
function flood(c: Ctx, x: number, z: number, yaw: number) {
  kit(c, 'Prop_Light_Wide', x, DECK, z, yaw, 0.8);
  pool(c, x - Math.sign(x) * 3, z, 6, 5, DECK + 0.09, 0.6);
}

function bridgeSection(c: Ctx, r: HullRect, first: boolean) {
  const W = r.w, z0 = r.y, z1 = r.y + r.h, zc = (z0 + z1) / 2, P = c.L.paint, LL = c.L.light;
  if (first) {
    digits(c, String(10 + (c.sig % 89)).padStart(2, '0'), 0, z0 + r.h * 0.22, 3.2);
    for (let k = 0; k < 3; k++) chevron(c, 0, z0 + r.h * 0.06 + k * 1.6 - 2, 2.2, 0.55, col(P.deckLine, 0.9));
    paintQuad(c, -0.15, z0 + r.h * 0.3, 0.15, zc - 7, col(P.deckLine, 0.7));
    c.lights.add(0, DECK + 0.6, z0 + 1.2, LL.strobe, 2.4, 0.4, LMode.Strobe, 0.3);
    c.lights.row([0, DECK + 0.1, z0 + 5], [0, DECK + 0.1, zc - 8], 0.9, LL.deck, 1.3, 0.22, 1, LMode.Chase, c.rnd);
  }
  // Tower stack aft of the forward gun: plinth, hab block, bridge wings, flag bridge, crown, mast.
  const t0 = zc + 9, a = Math.min(W * 0.27, 26), L = z1 - 1 - t0;
  tower(c, octagon(-a, t0, a, z1 - 1, 3), DECK, DECK + 6, { side: B.darkPanel, top: B.brackets, win: [[DECK + 1.2, DECK + 2.8], [DECK + 3.4, DECK + 5]] });
  tower(c, octagon(-a * 0.72, t0 + L * 0.1, a * 0.72, z1 - 3, 2.5), DECK + 6, DECK + 14, { side: B.panels, top: B.darkPanel, win: [[DECK + 7, DECK + 8.8], [DECK + 9.6, DECK + 11.4], [DECK + 12, DECK + 13.4]], claim: false });
  tower(c, octagon(-a * 1.25, t0 + L * 0.16, a * 1.25, t0 + L * 0.42, 2.2), DECK + 14, DECK + 18, { side: B.lightbar, top: B.panels, win: [[DECK + 14.6, DECK + 17.2]], claim: false, roof: false });
  tower(c, octagon(-a * 0.45, t0 + L * 0.2, a * 0.45, z1 - L * 0.3, 1.8), DECK + 18, DECK + 25, { side: B.darkPanel, top: B.brackets, win: [[DECK + 19, DECK + 20.6], [DECK + 21.4, DECK + 23]], claim: false });
  tower(c, octagon(-a * 0.22, t0 + L * 0.3, a * 0.22, z1 - L * 0.45, 1), DECK + 25, DECK + 29, { side: B.ribs, top: B.darkPanel, win: [[DECK + 25.8, DECK + 27.4]], claim: false, roof: false });
  // Wing-tip lights.
  c.lights.add(-a * 1.25 - 0.5, DECK + 17, t0 + L * 0.29, LL.port, 2.4, 1.1, LMode.Beacon, 0.2);
  c.lights.add(a * 1.25 + 0.5, DECK + 17, t0 + L * 0.29, LL.star, 2.4, 1.1, LMode.Beacon, 0.7);
  mast(c, 0, DECK + 29, t0 + L * 0.42, 15);
  radar(c, -a * 0.5, DECK + 14, z1 - 6, 2.4, 1.1);
  radar(c, a * 0.52, DECK + 14, z1 - 6.5, 1.6, -1.9);
  // Sensor masts and whips crowding the upper bridge.
  for (let k = 0; k < 6; k++) antenna(c, (c.rnd() * 2 - 1) * a * 0.4, DECK + 25, t0 + L * (0.32 + c.rnd() * 0.2), 2 + c.rnd() * 4, c.rnd);
  for (let k = 0; k < 3; k++) dish(c, (c.rnd() * 2 - 1) * a * 0.6, DECK + 18, t0 + L * (0.22 + c.rnd() * 0.5), 0.6 + c.rnd() * 0.6, c.rnd);
  // Exhaust stacks aft with heat haze.
  for (const sx of [-1, 1]) {
    lathe(c.bk, B.ribs, [[0, 0], [2.3, 0], [2.3, 4.5], [1.8, 5], [1.5, 5]], 10, P.dark, new THREE.Matrix4().makeTranslation(sx * a * 0.55, DECK + 11, t0 + 15 + 0 * L));
    c.bk.get('core').quad([sx * a * 0.55 - 1.2, DECK + 15.9, t0 + 13.8], [sx * a * 0.55 + 1.2, DECK + 15.9, t0 + 13.8], [sx * a * 0.55 + 1.2, DECK + 15.9, t0 + 16.2], [sx * a * 0.55 - 1.2, DECK + 15.9, t0 + 16.2], [0, 0], [1, 0], [1, 1], [0, 1], col(P.full, 0.35), [0, 1, 0]);
    c.vents.push([sx * a * 0.55, DECK + 16, t0 + 15]);
  }
  c.dmg.push([-a * 0.45, DECK + 14.1, t0 + L * 0.8], [a * 0.82, DECK + 6.1, t0 + 2.5], [-a * 0.8, DECK + 6.1, z1 - 3], [a * 0.3, DECK + 25.1, t0 + L * 0.55]);
}

function gundeckSection(c: Ctx, r: HullRect) {
  const W = r.w, z0 = r.y, z1 = r.y + r.h, zc = (z0 + z1) / 2, P = c.L.paint;
  const hx = Math.min(W * 0.1, 11);
  tower(c, octagon(-hx, z0 + 5, hx, z1 - 4, 2.5), DECK, DECK + 5, { side: B.darkPanel, top: B.doors, win: [[DECK + 1, DECK + 2.6], [DECK + 3.1, DECK + 4.4]], roof: false });
  tower(c, octagon(-hx * 0.62, z0 + 9, hx * 0.62, z1 - 9, 1.5), DECK + 5, DECK + 9, { side: B.panels, top: B.brackets, win: [[DECK + 5.8, DECK + 7.6]], claim: false });
  flatRect(c.bk, R.grate, -hx + 1.6, z0 + 6.5, -hx * 0.62 - 0.6, z1 - 5.5, DECK + 5.05, P.hull, true);
  flatRect(c.bk, R.grate, hx * 0.62 + 0.6, z0 + 6.5, hx - 1.6, z1 - 5.5, DECK + 5.05, P.hull, true);
  for (const sx of [-1, 1]) {
    const tx = sx * W * 0.27;
    tower(c, octagon(tx - 3, zc + 10, tx + 3, Math.min(z1 - 1.5, zc + 16), 1), DECK, DECK + 2.6, { side: B.ribs, top: B.brackets, edgeLights: false });
    hazardStrip(c, tx - 3.2, zc + 8.6, tx + 3.2, zc + 9.6);
  }
  c.dmg.push([-hx * 2, DECK + 0.4, zc], [hx * 2, DECK + 0.4, zc + 5], [0, DECK + 9.1, zc]);
}

function batterySection(c: Ctx, r: HullRect) {
  const W = r.w, z0 = r.y, z1 = r.y + r.h, zc = (z0 + z1) / 2, P = c.L.paint, hwS = (W / 2) * HULL_K.battery;
  // Citadel blocks between the three gun houses.
  for (const sx of [-1, 1]) {
    const xa = sx * 11, xb = sx * (W * 0.36 - 11.5), x0 = Math.min(xa, xb), x1 = Math.max(xa, xb);
    if (x1 - x0 > 6) {
      tower(c, octagon(x0, z0 + 4, x1, z1 - 4, 2.2), DECK, DECK + 3.4, { side: B.darkPanel, top: B.panels, win: [[DECK + 0.8, DECK + 2.5]] });
      flatRect(c.bk, R.hatchCross, x0 + 1.5, z0 + 6, x0 + 3.5, z0 + 8, DECK + 3.45, P.hull);
      kit(c, 'Prop_Vent_Big', (x0 + x1) / 2 + 2, DECK + 3.45, zc + 4, Math.PI / 2, 1.1);
      kit(c, 'Prop_Vent_Wide', (x0 + x1) / 2 + 2, DECK + 3.45, z1 - 7, 0, 1.3);
    }
    const sxp = sx * hwS;
    c.dmg.push([sx * W * 0.2, DECK + 3.5, zc], [sx * hwS * 0.78, DECK + 0.4, zc + 6]);
  }
}

function armorSection(c: Ctx, r: HullRect) {
  const W = r.w, z0 = r.y, z1 = r.y + r.h, zc = (z0 + z1) / 2, P = c.L.paint, LL = c.L.light, hwA = W / 2;
  // Flight deck: edge lines, dashed centreline, threshold bars and chase lights.
  const lx = W * 0.2, line = col(P.deckLine, 0.85);
  for (const sx of [-1, 1]) {
    paintQuad(c, sx * lx - 0.35, z0 + 1.5, sx * lx + 0.35, z1 - 1.5, line);
    c.lights.row([sx * (lx + 1.3), DECK + 0.15, z0 + 2], [sx * (lx + 1.3), DECK + 0.15, z1 - 2], 3, LL.deck, 1.5, 0.8, 1, LMode.Chase, c.rnd);
    for (let k = 0; k < 4; k++) paintQuad(c, sx * (lx - 2 - k * 1.6) - 0.5, z0 + 2, sx * (lx - 2 - k * 1.6) + 0.5, z0 + 7, line);
  }
  for (let z = z0 + 9; z < z1 - 4; z += 5.5) if (Math.abs(z - zc) > 10) paintQuad(c, -0.3, z, 0.3, z + 3, line);
  // Deck elevators: lit wells with hazard borders.
  for (const sx of [-1, 1]) {
    const ex = sx * W * 0.34, x0 = ex - 5.5, x1 = ex + 5.5, ez0 = zc - 6, ez1 = zc + 6;
    if (!onDeck(c, x0, ez0, x1, ez1, 0.5)) continue;
    c.bk.get('black').quad([x0, DECK + 0.02, ez0], [x1, DECK + 0.02, ez0], [x1, DECK + 0.02, ez1], [x0, DECK + 0.02, ez1], [0, 0], [1, 0], [1, 1], [0, 1], P.dark, [0, 1, 0]);
    flat(c.bk, 'core', x0 + 1.2, ez0 + 1.2, x1 - 1.2, ez1 - 1.2, DECK + 0.03, col(P.full, 0.22));
    flatRect(c.bk, R.hatchCross, x0 + 2.2, ez0 + 2.5, x1 - 2.2, ez1 - 2.5, DECK + 0.05, P.plate);
    hazardStrip(c, x0, ez0 - 1, x1, ez0); hazardStrip(c, x0, ez1, x1, ez1 + 1);
    for (const [px, pz] of [[x0, ez0], [x1, ez0], [x0, ez1], [x1, ez1]]) c.lights.add(px, DECK + 0.3, pz, LL.port, 2, 0.9, LMode.Beacon, c.rnd());
    claim(c, x0 - 1, ez0 - 1.5, x1 + 1, ez1 + 1.5);
  }
  // Armour strakes bolted along the belt.
  for (const sx of [-1, 1]) for (let z = z0 + 1; z < z1 - 2; z += 9.5) {
    const xa = sx * (hwA - 0.6), xb = sx * (hwA + 1.8);
    block(c.bk, octagon(Math.min(xa, xb), z, Math.max(xa, xb), z + 8.6, 0.8), DECK - 7.2, DECK - 1.6, { side: B.panels, top: B.ribs, col: col(P.hull, 0.9), bevel: 0.6 });
  }
  c.dmg.push([-W * 0.25, DECK + 0.4, zc - 6], [W * 0.22, DECK + 0.4, zc + 8], [0, DECK + 0.4, z0 + 6]);
}

function spineSection(c: Ctx, r: HullRect) {
  const W = r.w, z0 = r.y, z1 = r.y + r.h, zc = (z0 + z1) / 2, P = c.L.paint;
  // Central trunk of pipes and cable trays.
  claim(c, -6, z0, 6, z1);
  for (const [px, pr] of [[-3.6, 1.2], [0, 1.6], [3.6, 1.2]] as [number, number][]) pipeRun(c, px, DECK + pr + 0.2, z0 - 0.5, z1 + 0.5, pr);
  dropShadow(c, -5, z0, 5, z1, DECK + 0.06, 2.4);
  // Radiator fin banks with glowing roots, fore and aft of the module mounts.
  for (const sx of [-1, 1]) for (const [za, zb] of [[z0 + 2, zc - 10], [zc + 10, z1 - 2]]) {
    if (zb - za < 4) continue;
    const xa = sx * (W * 0.12), xb = sx * (W * 0.38), x0 = Math.min(xa, xb), x1 = Math.max(xa, xb);
    for (let x = x0 + 0.8; x < x1; x += 1.7) box(c.bk, B.rail, 0.45, 2.6, zb - za, P.dark, new THREE.Matrix4().makeTranslation(x, DECK + 1.3, (za + zb) / 2));
    flat(c.bk, 'core', x0, za, x1, zb, DECK + 0.08, col(P.full, 0.12));
    dropShadow(c, x0, za, x1, zb, DECK + 0.06, 2.6); claim(c, x0, za, x1, zb);
    c.dmg.push([(x0 + x1) / 2, DECK + 2.7, (za + zb) / 2]);
  }
}

function engineSection(c: Ctx, r: HullRect, last: boolean) {
  const W = r.w, z0 = r.y, z1 = r.y + r.h, zc = (z0 + z1) / 2, P = c.L.paint, LL = c.L.light;
  const nx = W * 0.22, rad = Math.min(8.5, W * 0.1), yc = last ? DECK - 1 : DECK + rad * 0.55;
  for (const sx of [-1, 1]) {
    const x = sx * nx;
    // Engine nacelle: armoured barrel housing lying along z.
    const m = new THREE.Matrix4().makeTranslation(x, yc, z0 + 3).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
    lathe(c.bk, B.panels, [[0, 0], [rad * 0.7, 0], [rad, 2.5], [rad, z1 - z0 - 6], [rad * 1.05, z1 - z0 - 3.5]], 16, col(P.hull, 1.25), m, false, 3);
    for (let zz = 5; zz < z1 - z0 - 6; zz += 4.5) lathe(c.bk, B.ribs, [[rad * 1.04, zz], [rad * 1.04, zz + 1.2]], 16, P.dark, m, false, 4);
    box(c.bk, B.brackets, rad * 0.9, 0.8, z1 - z0 - 10, col(P.hull, 1.3), new THREE.Matrix4().makeTranslation(x, yc + rad + 0.2, (z0 + z1) / 2 + 1));
    // Nozzle bell flaring past the stern.
    const mb = new THREE.Matrix4().makeTranslation(x, yc, z1 - 3.5).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
    lathe(c.bk, B.ribs, [[rad * 1.05, 0], [rad * 0.92, 1.2], [rad * 0.98, 4], [rad * 1.2, 8.5], [rad * 1.08, 8.6]], 16, P.dark, mb);
    lathe(c.bk, { m: 'black', v0: 0, v1: 1 }, [[rad * 1.06, 8.55], [rad * 0.88, 4], [rad * 0.78, 1.5]], 16, P.dark, mb);
    lathe(c.bk, { m: 'core', v0: 0, v1: 1 }, [[rad * 0.78, 1.5], [rad * 0.5, 1.7], [0, 1.9]], 16, P.full, mb);
    lathe(c.bk, { m: 'glow', v0: 0, v1: 1 }, [[rad * 0.3, 1.95], [0, 2.0]], 10, P.full, mb);
    c.nozzles.push({ x, y: yc, z: z1 + 5, r: rad, main: true });
    // Intake fans and heat vents on the nacelle crown.
    fan(c, x, zc - 5, 2.6, yc + rad - 0.4);
    kit(c, 'Prop_Vent_Big', x, yc + rad + 0.05, z1 - 9, Math.PI / 2, 1.2);
    kit(c, 'Prop_Vent_Small', x + rad * 0.4, yc + rad * 0.9, z1 - 14, 0, 0.9);
    c.vents.push([x, yc + rad + 0.4, z1 - 9]);
    for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; c.lights.add(x + Math.cos(a) * rad * 1.22, yc + Math.sin(a) * rad * 1.22, z1 + 5.2, LL.engine, 1.4, 0.3, LMode.Flicker, c.rnd()); }
    dropShadow(c, x - rad, z0 + 3, x + rad, z1 - 2, DECK + 0.06, rad);
    claim(c, x - rad - 1, z0 + 2, x + rad + 1, z1);
    c.dmg.push([x, yc + rad, zc + 4]);
  }
  // Manoeuvring thrusters at the corners.
  for (const sx of [-1, 1]) for (const zz of [z0 + 4, z1 - 3]) {
    const x = sx * ((W / 2) * HULL_K.engine - 1.2);
    c.bk.get('core').quad([x - 0.9, DECK - 3.5, zz - 1.3], [x + 0.9, DECK - 3.5, zz - 1.3], [x + 0.9, DECK - 3.5, zz + 1.3], [x - 0.9, DECK - 3.5, zz + 1.3], [0, 0], [1, 0], [1, 1], [0, 1], col(P.full, 0.3), [sx, 0, 0]);
    c.nozzles.push({ x: x + sx * 1.5, y: DECK - 3.5, z: zz, r: 1.4, main: false });
  }
  hazardStrip(c, -nx + rad + 1.2, z1 - 6, nx - rad - 1.2, z1 - 4.8);
}

/* ---------------- utility modules ---------------- */
function utilModule(c: Ctx, m: Mount) {
  const x = m.ox, z = m.oy, P = c.L.paint, LL = c.L.light, id = m.part?.id ?? '', tier = m.part?.tier ?? 1, s = 1 + 0.06 * (tier - 1);
  const T = (dx: number, dy: number, dz: number) => new THREE.Matrix4().makeTranslation(x + dx, DECK + dy, z + dz);
  claim(c, x - 9, z - 9, x + 9, z + 9);
  switch (id) {
    case 'plate': {
      for (let k = 0; k < 3; k++) block(c.bk, octagon(x - 7 + k * 1.2, z - 7.5 + k * 1.2, x + 7 - k * 1.2, z + 7.5 - k * 1.2, 2), DECK + k * 1.6, DECK + (k + 1) * 1.6, { side: B.ribs, top: B.panels, col: col(P.hull, 0.95 + k * 0.05), bevel: 0.5 });
      dropShadow(c, x - 7, z - 7.5, x + 7, z + 7.5, DECK + 0.06, 4.8);
      hazardStrip(c, x - 4.4, z + 3, x + 4.4, z + 4.2, DECK + 4.85);
      break;
    }
    case 'shield': {
      lathe(c.bk, B.ribs, [[0, 0], [7.5 * s, 0], [7.5 * s, 1.2], [5.5 * s, 2]], 18, P.hull, T(0, 0, 0));
      lathe(c.bk, B.panels, [[5.5 * s, 2], [5 * s, 3.6], [3.2 * s, 5.2], [0, 5.8 * s]], 18, P.plate, T(0, 0, 0));
      lathe(c.bk, { m: 'glow', v0: 0, v1: 1 }, [[5.65 * s, 1.95], [5.65 * s, 2.35], [5.2 * s, 2.35]], 24, P.full, T(0, 0, 0));
      for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + (k * Math.PI) / 2; box(c.bk, B.rail, 1, 4, 1, P.dark, T(Math.cos(a) * 6.6 * s, 2, Math.sin(a) * 6.6 * s)); c.lights.add(x + Math.cos(a) * 6.6 * s, DECK + 4.3, z + Math.sin(a) * 6.6 * s, LL.energy, 2.6, 1, LMode.Beacon, k / 4); }
      dropShadow(c, x - 6, z - 6, x + 6, z + 6, DECK + 0.06, 5);
      break;
    }
    case 'thruster': {
      for (const sx of [-1, 1]) {
        lathe(c.bk, B.panels, [[0, 0], [2.6, 0], [3, 2], [3, 9], [2.4, 10]], 12, P.hull, T(sx * 3.6, 3, -4.5).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
        lathe(c.bk, { m: 'core', v0: 0, v1: 1 }, [[2.1, 9.8], [0, 9.9]], 10, P.full, T(sx * 3.6, 3, -4.5).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
        c.nozzles.push({ x: x + sx * 3.6, y: DECK + 3, z: z + 6, r: 2.2, main: false });
      }
      dropShadow(c, x - 6.6, z - 4.5, x + 6.6, z + 5.5, DECK + 0.06, 6);
      break;
    }
    case 'reactor': {
      lathe(c.bk, B.darkPanel, [[0, 0], [7 * s, 0], [7 * s, 2.5], [6 * s, 3.4]], 16, P.hull, T(0, 0, 0));
      lathe(c.bk, { m: 'core', v0: 0, v1: 1 }, [[6 * s, 3.4], [4.6 * s, 3.5]], 24, P.full, T(0, 0, 0));
      lathe(c.bk, B.ribs, [[4.6 * s, 3.5], [4.2 * s, 4.5], [2 * s, 5], [0, 5.1]], 16, P.plate, T(0, 0, 0));
      for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; kit(c, 'Prop_Vent_Small', x + Math.cos(a) * 5.3 * s, DECK + 3.42, z + Math.sin(a) * 5.3 * s, -a + Math.PI / 2, 1.6); }
      c.vents.push([x, DECK + 5, z]);
      dropShadow(c, x - 6.5, z - 6.5, x + 6.5, z + 6.5, DECK + 0.06, 4);
      break;
    }
    case 'repair': {
      block(c.bk, octagon(x - 5, z - 4, x + 5, z + 4, 1.5), DECK, DECK + 2.5, { side: B.ribs, top: B.brackets, col: P.hull, bevel: 0.5 });
      lathe(c.bk, B.rail, [[0, 0], [1.6, 0], [1.4, 5], [0, 5]], 8, P.dark, T(-2, 2.5, 0));
      box(c.bk, B.rail, 1, 1, 15, P.plate, T(-2, 7.5, -5).multiply(new THREE.Matrix4().makeRotationX(-0.25)));
      box(c.bk, B.hazard, 1.05, 1.05, 3, P.accent, T(-2, 8.9, -10.5).multiply(new THREE.Matrix4().makeRotationX(-0.25)));
      c.lights.add(x - 2, DECK + 9.6, z - 12, '#8fe39a', 2.6, 1.1, LMode.Beacon, c.rnd());
      dropShadow(c, x - 3, z - 13, x - 1, z + 2, DECK + 0.06, 8);
      break;
    }
    case 'magnet': {
      lathe(c.bk, B.darkPanel, [[0, 0], [6.5 * s, 0], [6.5 * s, 1.6], [0, 1.6]], 16, P.dark, T(0, 0, 0));
      lathe(c.bk, B.ribs, [[6 * s, 1.6], [6.2 * s, 2.4], [6.2 * s, 3.6], [4.4 * s, 3.8], [4.4 * s, 1.6]], 20, new THREE.Color('#e0c35c').multiplyScalar(0.55), T(0, 0, 0));
      lathe(c.bk, { m: 'glow', v0: 0, v1: 1 }, [[4.3 * s, 2], [0, 2.1]], 16, P.full, T(0, 0, 0));
      dropShadow(c, x - 6, z - 6, x + 6, z + 6, DECK + 0.06, 3.8);
      break;
    }
    case 'drones': {
      c.bk.get('black').quad([x - 7, DECK + 0.02, z - 7], [x + 7, DECK + 0.02, z - 7], [x + 7, DECK + 0.02, z + 7], [x - 7, DECK + 0.02, z + 7], [0, 0], [1, 0], [1, 1], [0, 1], P.dark, [0, 1, 0]);
      flatRect(c.bk, R.hatchCross, x - 6, z - 6, x + 6, z + 6, DECK + 0.05, P.plate);
      hazardStrip(c, x - 7.5, z - 8.4, x + 7.5, z - 7.2); hazardStrip(c, x - 7.5, z + 7.2, x + 7.5, z + 8.4);
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; c.lights.add(x + Math.cos(a) * 8.6, DECK + 0.3, z + Math.sin(a) * 8.6, LL.deck, 2, 0.85, LMode.Chase, k / 8); }
      break;
    }
    default: {
      flatRect(c.bk, R.hatchRound, x - 4.5, z - 4.5, x + 4.5, z + 4.5, DECK + 0.05, P.plate);
      lathe(c.bk, B.ribs, [[4.6, 0], [5.2, 0], [5.2, 0.5], [4.6, 0.5]], 16, P.dark, T(0, 0, 0));
    }
  }
}

/* ---------------- medium equipment ---------------- */
/** Medium-scale kit equipment (vents, fans, tanks, deck houses) and edge floodlights for one section. */
function equipment(c: Ctx, r: HullRect, rnd: Rng) {
  const P = c.L.paint;
  const items: { w: number; d: number; f: (x: number, z: number) => void }[] = [
    { w: 2.4, d: 1.4, f: (x, z) => kit(c, 'Prop_Vent_Big', x, DECK + 0.02, z, 0, 1.1) },
    { w: 1.4, d: 2.6, f: (x, z) => kit(c, 'Prop_Vent_Big', x, DECK + 0.02, z, Math.PI / 2, 1.1) },
    { w: 1.4, d: 1.0, f: (x, z) => kit(c, 'Prop_Vent_Small', x, DECK + 0.02, z, 0, 1.1) },
    { w: 2.6, d: 0.7, f: (x, z) => kit(c, 'Prop_Vent_Wide', x, DECK + 0.02, z, 0, 1.2) },
    { w: 3.0, d: 3.0, f: (x, z) => { fan(c, x, z, 1.2); } },
    { w: 1.8, d: 3.6, f: (x, z) => {
      for (const dx of [-0.45, 0.45]) kit(c, 'Prop_Barrel_Large', x + dx, DECK + 0.42, z + 1.5, 0, 1.6, new THREE.Matrix4().makeRotationX(-Math.PI / 2));
      dropShadow(c, x - 0.9, z - 1.7, x + 0.9, z + 1.7, DECK + 0.06, 0.9);
    } },
    { w: 3.2, d: 2.4, f: (x, z) => {
      // Small deck house with lit windows.
      tower(c, octagon(x - 1.6, z - 1.2, x + 1.6, z + 1.2, 0.4), DECK, DECK + 1.3, { side: B.darkPanel, top: B.brackets, bevel: 0.15, taper: 0.08, win: [[DECK + 0.45, DECK + 0.95]], edgeLights: false, roof: false, claim: false });
    } },
  ];
  const area = r.w * r.h, tries = Math.round(area / 70);
  for (let i = 0; i < tries; i++) {
    const it = items[Math.floor(rnd() * items.length)];
    const x = (rnd() * 2 - 1) * (r.w / 2), z = r.y + 2 + rnd() * (r.h - 4);
    const x0 = x - it.w / 2, x1 = x + it.w / 2, z0 = z - it.d / 2, z1 = z + it.d / 2;
    if (!onDeck(c, x0, z0, x1, z1, 1.5) || occupied(c, x0, z0, x1, z1, 0.8)) continue;
    it.f(x, z); claim(c, x0, z0, x1, z1);
  }
  // Deck floodlights in pairs along the deck edges.
  for (let z = r.y + 5; z < r.y + r.h - 3; z += 11) for (const sx of [-1, 1]) {
    const x = sx * (c.de(z) - 1.2);
    if (!occupied(c, x - 0.8, z - 0.6, x + 0.8, z + 0.6, 0.2) && onDeck(c, x - 0.8, z - 0.6, x + 0.8, z + 0.6, -0.6)) { flood(c, x, z, sx > 0 ? Math.PI / 2 : -Math.PI / 2); claim(c, x - 0.8, z - 0.6, x + 0.8, z + 0.6); }
  }
}

/** Navigation lights: red to port, green to starboard at the beam, white at bow and stern, strobes on top. */
function navLights(c: Ctx, st: { z: number; hw: number }[]) {
  const LL = c.L.light; let wide = st[0];
  for (const s of st) if (s.hw > wide.hw) wide = s;
  const zs = [wide.z, (st[0].z + wide.z) / 2];
  for (const z of zs) {
    const hw = c.hw(z);
    c.lights.add(-hw - 0.3, DECK - 2.2, z, LL.navPort, 2.6, 0.5, LMode.Steady);
    c.lights.add(hw + 0.3, DECK - 2.2, z, LL.navStar, 2.6, 0.5, LMode.Steady);
  }
  const zs0 = st[0].z, zs1 = st[st.length - 1].z;
  c.lights.add(0, DECK + 0.4, zs0 + 0.3, LL.strobe, 1.6, 0.35, LMode.Steady);
  c.lights.add(0, DECK + 0.3, zs1 + 0.4, LL.strobe, 1.6, 0.35, LMode.Steady);
  for (const sx of [-1, 1]) c.lights.add(sx * (c.hw(zs1 - 2) - 0.5), DECK + 0.4, zs1 - 1, LL.strobe, 3, 0.45, LMode.Strobe, sx > 0 ? 0.5 : 0);
}

/* ---------------- build ---------------- */
export function buildShip(dv: Derived, L: Livery, sigText: string, callsign = ''): ShipModel {
  // Build at the reference ship scale so every detail keeps its proportion to the hull, then scale the body.
  const k = SHIP_SCALE / REF_SCALE, ik = 1 / k;
  const rects: HullRect[] = dv.rects.map((r) => ({ ...r, x: r.x * ik, y: r.y * ik, w: r.w * ik, h: r.h * ik }));
  const mounts: Mount[] = dv.mounts.map((m) => ({ ...m, ox: m.ox * ik, oy: m.oy * ik }));
  const sig = hash(sigText), st = stations(rects), hw = hwFn(st);
  const root = new THREE.Group(); root.name = L.hostile ? 'ghost-dreadnought' : 'dreadnought';
  const body = new THREE.Group(); body.scale.setScalar(k); root.add(body);
  const c: Ctx = {
    bk: new Buckets(), L, lights: new LightSet(), rnd: mulberry32(sig), occ: [], dmg: [], vents: [], spin: [], nozzles: [], root: body, turrets: [],
    hw, de: (z: number) => terrace(hw(z)), z0: st[0].z, z1: st[st.length - 1].z, edgeSegs: [], sig,
  };
  // Each section draws from its own seeded stream: type, position and the parts it carries.
  const secRng = (i: number, salt = 0) => mulberry32(hash(`${i}|${rects[i].type}|${mounts.filter((m) => m.si === i).map((m) => m.part ? m.part.id + m.part.tier : '-').join(',')}|${salt}`));
  const maxHw = Math.max(...st.map((s) => s.hw));
  // Weapon mounts first: their barbettes, casemates and sponsons claim deck before anything else.
  const rig = new GunRig();
  for (const m of mounts) {
    const p = m.part;
    if (!p || !has(WEAPONS, p.id)) { claim(c, m.ox - 8.5, m.oy - 8.5, m.ox + 8.5, m.oy + 8.5); continue; }
    const trav = mountTraverse(m, rects[m.si].type), h = hw(m.oy);
    const { t, claim: cl } = buildMount({ uid: p.uid, id: p.id, tier: p.tier, x: m.ox, z: m.oy, deck: DECK, trav, hw: h, terrace: terrace(h), gallery: DECK - 2.4 }, rig, c.bk, L, c.lights);
    c.turrets.push(t); claim(c, cl[0], cl[1], cl[2], cl[3]);
  }
  hull(c, st);
  deck(c, st, rects, maxHw);
  navLights(c, st);
  rects.forEach((r, i) => {
    c.rnd = secRng(i);
    switch (r.type) {
      case 'bridge': bridgeSection(c, r, i === 0); break;
      case 'gundeck': gundeckSection(c, r); break;
      case 'battery': batterySection(c, r); break;
      case 'armor': armorSection(c, r); break;
      case 'spine': spineSection(c, r); break;
      case 'engine': engineSection(c, r, i === rects.length - 1); break;
    }
    // Section seams: a raised rib across the deck, a line of lights and a stencilled frame number.
    if (i > 0) {
      const z = r.y, e = Math.min(c.de(z - 0.5), c.de(z + 0.5)) - 0.2;
      box(c.bk, B.ribs, 2 * e, 0.35, 0.7, col(L.paint.hull, 0.8), new THREE.Matrix4().makeTranslation(0, DECK + 0.17, z));
      c.lights.row([-e + 1, DECK + 0.45, z], [e - 1, DECK + 0.45, z], 1.2, L.light.edge, 0.9, 0.2, 0.7, LMode.Steady, c.rnd);
      const fx = e - 4;
      if (!occupied(c, fx - 2, z + 0.6, fx + 2, z + 2, 0)) { stencilText(c, `FR ${String(i * 40 + 12).padStart(3, '0')}`, fx, z + 1.3, 0.8); claim(c, fx - 2, z + 0.6, fx + 2, z + 2); }
    }
  });
  // Callsign stencilled across the aft deck, and again small on the bow.
  const cs = (callsign || (L.hostile ? 'UNKNOWN' : 'DREADNOUGHT')).toUpperCase().replace(/[^A-Z0-9 .\-]/g, '').slice(0, 14);
  {
    const last = rects[rects.length - 1], zz = last.y + last.h - 8, w = cs.length * 1.4 * 0.72;
    if (!occupied(c, -w / 2, zz - 1, w / 2, zz + 1, 0)) { stencilText(c, cs, 0, zz, 1.4); claim(c, -w / 2, zz - 1, w / 2, zz + 1); }
    const zb = rects[0].y + rects[0].h * 0.36;
    stencilText(c, cs, 0, zb, 0.7);
  }
  if (!rects.some((r) => r.type === 'engine')) {
    // Every hull gets at least a pair of cruise drives at the stern.
    const r = rects[rects.length - 1], z1 = r.y + r.h, rad = Math.min(6, r.w * 0.07);
    for (const sx of [-1, 1]) {
      const x = sx * r.w * 0.2, mb = new THREE.Matrix4().makeTranslation(x, DECK - 4, z1 - 2).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
      lathe(c.bk, B.ribs, [[rad, 0], [rad * 1.2, 5], [rad * 1.1, 5.1]], 14, L.paint.dark, mb);
      lathe(c.bk, { m: 'core', v0: 0, v1: 1 }, [[rad, 1], [0, 1.2]], 12, L.paint.full, mb);
      c.nozzles.push({ x, y: DECK - 4, z: z1 + 3, r: rad, main: true });
    }
  }
  // Utility modules.
  for (const m of mounts) { const p = m.part; if (!p || !has(WEAPONS, p.id)) utilModule(c, m); }
  // Medium equipment, then the dense small layer, section by section; hull-side detail last.
  rects.forEach((r, i) => {
    const rnd = secRng(i, 1);
    equipment(c, r, rnd);
    deckGreebles(c, rnd, r.y, r.y + r.h, r.type);
    beltGreebles(c, rnd, r.y, r.y + r.h, r.type, DECK);
  });
  // Fill damage points so fires can break out anywhere on the hull.
  c.rnd = mulberry32(sig ^ 0x5bd1e995);
  for (let i = 0; i < 26; i++) { const z = c.z0 + 8 + c.rnd() * (c.z1 - c.z0 - 14), w = c.de(z) - 4; c.dmg.push([(c.rnd() * 2 - 1) * w, DECK + 0.4, z]); }

  c.bk.meshes(L.mats, body, true);
  const gunTris = rig.build(L, body);
  const lights = c.lights.points(lightMaterial(L.hostile)); body.add(lights);
  // Scorch decals: hidden until the hull is hurt (draw range grows with damage).
  const sb = new Buckets(), dm = sb.get('scorch');
  for (const p of c.dmg) { const r = 3 + c.rnd() * 5, a = c.rnd() * Math.PI; const ca = Math.cos(a) * r, sa = Math.sin(a) * r; const y = p[1] + 0.12;
    dm.quad([p[0] - ca + sa, y, p[2] - sa - ca], [p[0] + ca + sa, y, p[2] + sa - ca], [p[0] + ca - sa, y, p[2] + sa + ca], [p[0] - ca - sa, y, p[2] - sa + ca], [0, 0], [1, 0], [1, 1], [0, 1], L.paint.hull, [0, 1, 0]); }
  const scorch = sb.meshes(L.mats, body, false)[0];
  scorch.geometry.setDrawRange(0, 0);
  let edges: THREE.LineSegments | null = null;
  if (L.hostile && c.edgeSegs.length) {
    const pos: number[] = [];
    for (const g of c.edgeSegs) { const a = g.getAttribute('position'); for (let i = 0; i < a.count; i++) pos.push(a.getX(i), a.getY(i) + 0.05, a.getZ(i)); g.dispose(); }
    const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const em = new THREE.LineBasicMaterial({ color: '#ff5040', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }); em.color.multiplyScalar(1.5); em.toneMapped = false;
    edges = new THREE.LineSegments(eg, em); edges.userData.own = true; body.add(edges);
  } else for (const g of c.edgeSegs) g.dispose();
  let tris = 0; body.traverse((o) => { const g = (o as THREE.Mesh).geometry; if ((o as THREE.Mesh).isMesh && g) tris += (g.index ? g.index.count : g.getAttribute('position').count) / 3; });
  void gunTris;
  // Layer-facing data lives in root space (body space x k).
  const toRoot = (p: V3): V3 => [p[0] * k, p[1] * k, p[2] * k];
  return {
    root, body, k, turrets: c.turrets, rig,
    nozzles: c.nozzles.map((n) => ({ ...n, x: n.x * k, y: n.y * k, z: n.z * k, r: n.r * k })),
    dmgPts: c.dmg.map(toRoot), vents: c.vents.map(toRoot), spinners: c.spin, lights, edges, scorch, len: dv.len, width: dv.width, hostile: L.hostile, tris,
  };
}

/** Stencilled deck lettering (callsign, frame numbers). */
function stencilText(c: Ctx, text: string, x: number, z: number, h: number) {
  const tx = c.L.mats.stencil as THREE.MeshStandardMaterial, ud = tx.alphaMap?.userData as { cols: number; rows: number } | undefined;
  stencil(c.bk, text, x, z, DECK + 0.05, h, c.L.paint.full, STENCIL_CHARS, ud?.cols ?? 8, ud?.rows ?? 5);
}

export function disposeShip(m: ShipModel) {
  m.root.traverse((o) => {
    if (!o.userData.own) return;
    const mesh = o as THREE.Mesh; mesh.geometry?.dispose();
    if (o === m.lights || o === m.edges) (mesh.material as THREE.Material).dispose();
  });
  m.rig.dispose();
}
