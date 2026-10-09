// Geometry accumulation for ship building. Every surface is appended into one buffer per material
// key, so a whole dreadnought (hull, superstructure, kitbashed greebles) collapses to about a dozen
// draw calls. Faces are flat-shaded, which suits armour plate.
import * as THREE from 'three';
import type { MatKey } from './materials';

export type V3 = [number, number, number];
export type V2 = [number, number];
/** A horizontal band of a trim sheet: u repeats freely, v stays inside [v0, v1]. */
export interface Band { m: MatKey; v0: number; v1: number }
/** A sub-rectangle of a sheet (decal-style, no repeat). */
export interface Rect { m: MatKey; u0: number; v0: number; u1: number; v1: number }

// Trim sheet bands (v measured from the top of the image; glTF textures are not flipped).
export const B = {
  panels: { m: 't1', v0: 0.004, v1: 0.333 } as Band,
  ribs: { m: 't1', v0: 0.338, v1: 0.392 } as Band,
  lightbar: { m: 't1', v0: 0.395, v1: 0.47 } as Band,
  rail: { m: 't1', v0: 0.47, v1: 0.505 } as Band,
  darkPanel: { m: 't1', v0: 0.508, v1: 0.932 } as Band,
  grille: { m: 't1', v0: 0.935, v1: 0.998 } as Band,
  brackets: { m: 't2', v0: 0.058, v1: 0.245 } as Band,
  doors: { m: 't2', v0: 0.252, v1: 0.632 } as Band,
  bevel: { m: 't2', v0: 0.862, v1: 0.902 } as Band,
  plain: { m: 't3', v0: 0.0, v1: 1.0 } as Band,
  hazard: { m: 'hazard', v0: 0.0, v1: 1.0 } as Band,
  window: { m: 'window', v0: 0.0, v1: 1.0 } as Band,
};
export const R = {
  grate: { m: 't2', u0: 0.425, v0: 0.655, u1: 0.625, v1: 0.722 } as Rect,
  hatchRound: { m: 't2', u0: 0.52, v0: 0.742, u1: 0.64, v1: 0.822 } as Rect,
  hatchCross: { m: 't2', u0: 0.775, v0: 0.645, u1: 0.985, v1: 0.855 } as Rect,
  ventSlots: { m: 't2', u0: 0.25, v0: 0.948, u1: 0.35, v1: 0.988 } as Rect,
  slot: { m: 't2', u0: 0.325, v0: 0.79, u1: 0.46, v1: 0.826 } as Rect,
  wedge: { m: 't2', u0: 0.09, v0: 0.72, u1: 0.28, v1: 0.776 } as Rect,
  plate: { m: 't2', u0: 0.432, v0: 0.738, u1: 0.5, v1: 0.775 } as Rect,
  dots: { m: 't2', u0: 0.015, v0: 0.655, u1: 0.095, v1: 0.688 } as Rect,
  lightBox: { m: 't1', u0: 0.2, v0: 0.94, u1: 0.3, v1: 0.975 } as Rect,
  panelBig: { m: 't1', u0: 0.255, v0: 0.04, u1: 0.745, v1: 0.3 } as Rect,
  panelSq: { m: 't1', u0: 0.02, v0: 0.06, u1: 0.25, v1: 0.28 } as Rect,
  darkBig: { m: 't1', u0: 0.0, v0: 0.508, u1: 1.0, v1: 0.932 } as Rect,
};

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3();

export class MB {
  p: number[] = []; n: number[] = []; uv: number[] = []; c: number[] = [];
  get tris() { return this.p.length / 9; }
  private push(v: V3, nn: THREE.Vector3, t: V2, col: THREE.Color) {
    this.p.push(v[0], v[1], v[2]); this.n.push(nn.x, nn.y, nn.z); this.uv.push(t[0], t[1]); this.c.push(col.r, col.g, col.b);
  }
  /** Triangle; if `out` is given, the winding is flipped so the face normal points along it. */
  tri(a: V3, b: V3, c: V3, ta: V2, tb: V2, tc: V2, col: THREE.Color, out?: V3) {
    _a.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]); _b.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    _n.crossVectors(_a, _b); const l = _n.length(); if (l < 1e-9) return; _n.multiplyScalar(1 / l);
    if (out && _n.x * out[0] + _n.y * out[1] + _n.z * out[2] < 0) { _n.negate(); this.push(a, _n, ta, col); this.push(c, _n, tc, col); this.push(b, _n, tb, col); return; }
    this.push(a, _n, ta, col); this.push(b, _n, tb, col); this.push(c, _n, tc, col);
  }
  quad(a: V3, b: V3, c: V3, d: V3, ta: V2, tb: V2, tc: V2, td: V2, col: THREE.Color, out?: V3) {
    this.tri(a, b, c, ta, tb, tc, col, out); this.tri(a, c, d, ta, tc, td, col, out);
  }
  /** Append an existing geometry transformed by m (kit pieces). */
  addGeometry(g: THREE.BufferGeometry, m: THREE.Matrix4, col: THREE.Color, group?: { start: number; count: number }) {
    const pos = g.getAttribute('position'), nor = g.getAttribute('normal'), uv = g.getAttribute('uv'), idx = g.getIndex();
    const nm = new THREE.Matrix3().getNormalMatrix(m), v = new THREE.Vector3(), nv = new THREE.Vector3();
    const flip = m.determinant() < 0;
    const start = group ? group.start : 0, count = group ? group.count : idx ? idx.count : pos.count;
    for (let k = start; k < start + count; k += 3) {
      for (let j = 0; j < 3; j++) {
        const jj = flip ? [0, 2, 1][j] : j, i = idx ? idx.getX(k + jj) : k + jj;
        v.fromBufferAttribute(pos, i).applyMatrix4(m);
        if (nor) nv.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize(); else nv.set(0, 1, 0);
        this.p.push(v.x, v.y, v.z); this.n.push(nv.x, nv.y, nv.z);
        if (uv) this.uv.push(uv.getX(i), uv.getY(i)); else this.uv.push(0, 0);
        this.c.push(col.r, col.g, col.b);
      }
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

/** One MB per material key. */
export class Buckets {
  b = new Map<MatKey, MB>();
  get(k: MatKey) { let m = this.b.get(k); if (!m) { m = new MB(); this.b.set(k, m); } return m; }
  /** Build meshes (one per material) into a group. */
  meshes(mats: Record<MatKey, THREE.Material>, into: THREE.Object3D, shadows = true) {
    const out: THREE.Mesh[] = [];
    for (const [k, mb] of this.b) {
      if (!mb.tris) continue;
      const mesh = new THREE.Mesh(mb.geometry(), mats[k]);
      const solid = k === 't1' || k === 't2' || k === 't3' || k === 'dark' || k === 'black';
      mesh.castShadow = shadows && solid; mesh.receiveShadow = shadows && (solid || k === 'paint' || k === 'hazard');
      if (k === 'shadow' || k === 'pool') mesh.renderOrder = 1; if (k === 'decal' || k === 'scorch') mesh.renderOrder = 2;
      mesh.userData.matKey = k; mesh.userData.own = true;
      into.add(mesh); out.push(mesh);
    }
    return out;
  }
}

/* ---------------- shape helpers ---------------- */

/** Planar top-face UV inside a band: u along z (repeating every `tile` units), v across x. */
export function bandUV(band: Band, x: number, z: number, x0: number, x1: number, tile: number): V2 {
  const t = x1 > x0 ? (x - x0) / (x1 - x0) : 0;
  return [z / tile, band.v0 + t * (band.v1 - band.v0)];
}
export function rectUV(r: Rect, s: number, t: number): V2 { return [r.u0 + s * (r.u1 - r.u0), r.v0 + t * (r.v1 - r.v0)]; }

/** Axis-aligned chamfered plan polygon (octagon when c > 0), counter-clockwise seen from above. */
export function octagon(x0: number, z0: number, x1: number, z1: number, c: number): V2[] {
  c = Math.max(0, Math.min(c, (x1 - x0) / 2 - 0.01, (z1 - z0) / 2 - 0.01));
  if (c <= 0.01) return [[x0, z0], [x0, z1], [x1, z1], [x1, z0]];
  return [[x0 + c, z0], [x0, z0 + c], [x0, z1 - c], [x0 + c, z1], [x1 - c, z1], [x1, z1 - c], [x1, z0 + c], [x1 - c, z0]];
}
function insetPoly(poly: V2[], d: number): V2[] {
  // Inset a convex CCW-from-above polygon by moving each vertex toward the centroid proportionally.
  let cx = 0, cz = 0; for (const p of poly) { cx += p[0]; cz += p[1]; } cx /= poly.length; cz /= poly.length;
  return poly.map(([x, z]) => {
    const sx = Math.sign(x - cx), sz = Math.sign(z - cz);
    return [x - sx * Math.min(d, Math.abs(x - cx) * 0.9), z - sz * Math.min(d, Math.abs(z - cz) * 0.9)] as V2;
  });
}

export interface BlockOpts {
  side: Band; top: Band; col: THREE.Color; topCol?: THREE.Color; tile?: number; topTile?: number;
  bevel?: number; taper?: number; sideBand2?: Band; capTop?: boolean;
}
/**
 * Extrude a convex plan polygon from y0 to y1 with a bevelled top edge. Sides take a trim band
 * (u along the perimeter), the top takes a band mapped across its width.
 */
export function block(bk: Buckets, poly: V2[], y0: number, y1: number, o: BlockOpts) {
  const bev = Math.min(o.bevel ?? 1.2, (y1 - y0) * 0.45), taper = o.taper ?? 0;
  const mid = taper > 0 ? insetPoly(poly, taper) : poly, top = insetPoly(mid, bev);
  let cx = 0, cz = 0; for (const p of poly) { cx += p[0]; cz += p[1]; } cx /= poly.length; cz /= poly.length;
  const cy = (y0 + y1) / 2, side = bk.get(o.side.m), tile = o.tile ?? 14;
  const h = y1 - bev - y0, sideV = o.side.v1 - o.side.v0;
  const uScale = sideV > 0 ? h / sideV : tile; // keep texel aspect square on walls
  let per = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], ma = mid[i], mb = mid[(i + 1) % poly.length], ta = top[i], tb = top[(i + 1) % poly.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]), u0 = per / uScale, u1 = (per + len) / uScale; per += len;
    const ex = (a[0] + b[0]) / 2 - cx, ez = (a[1] + b[1]) / 2 - cz;
    const out: V3 = [ex, 0, ez];
    side.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [mb[0], y1 - bev, mb[1]], [ma[0], y1 - bev, ma[1]],
      [u0, o.side.v1], [u1, o.side.v1], [u1, o.side.v0], [u0, o.side.v0], o.col, out);
    const sb = o.sideBand2 ?? B.ribs, s2 = bk.get(sb.m);
    s2.quad([ma[0], y1 - bev, ma[1]], [mb[0], y1 - bev, mb[1]], [tb[0], y1, tb[1]], [ta[0], y1, ta[1]],
      [u0 * 2, sb.v1], [u1 * 2, sb.v1], [u1 * 2, sb.v0], [u0 * 2, sb.v0], o.col, [ex, (y1 - cy) * 0.5 + 0.3, ez]);
  }
  if (o.capTop === false) return;
  let x0 = Infinity, x1 = -Infinity; for (const p of top) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); }
  const tb = bk.get(o.top.m), tt = o.topTile ?? Math.max(8, (x1 - x0) / Math.max(0.05, o.top.v1 - o.top.v0)), tc = o.topCol ?? o.col;
  const c: V3 = [cx, y1, cz], cu = bandUV(o.top, cx, cz, x0, x1, tt);
  for (let i = 0; i < top.length; i++) {
    const a = top[i], b = top[(i + 1) % top.length];
    tb.tri(c, [a[0], y1, a[1]], [b[0], y1, b[1]], cu, bandUV(o.top, a[0], a[1], x0, x1, tt), bandUV(o.top, b[0], b[1], x0, x1, tt), tc, [0, 1, 0]);
  }
}

/** Flat quad on a horizontal plane at height y (decal-like), UVs from a rect or band. */
export function flat(bk: Buckets, key: MatKey, x0: number, z0: number, x1: number, z1: number, y: number, col: THREE.Color, uv: [V2, V2, V2, V2] = [[0, 0], [1, 0], [1, 1], [0, 1]]) {
  bk.get(key).quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], uv[0], uv[1], uv[2], uv[3], col, [0, 1, 0]);
}
/** Flat quad with a sheet rect (rotated 90 deg when rot). */
export function flatRect(bk: Buckets, r: Rect, x0: number, z0: number, x1: number, z1: number, y: number, col: THREE.Color, rot = false) {
  const a = rectUV(r, 0, 0), b = rectUV(r, 1, 0), c = rectUV(r, 1, 1), d = rectUV(r, 0, 1);
  flat(bk, r.m, x0, z0, x1, z1, y, col, rot ? [d, a, b, c] : [a, b, c, d]);
}

/** Lathe a profile [radius, y][] around Y (or along Z if alongZ) with `seg` segments; UV u around, v along band. */
export function lathe(bk: Buckets, band: Band, prof: V2[], seg: number, col: THREE.Color, m: THREE.Matrix4, closeTop = false, uRep = 2) {
  const mb = bk.get(band.m), v = new THREE.Vector3();
  const P = (r: number, y: number, a: number): V3 => { v.set(Math.cos(a) * r, y, Math.sin(a) * r).applyMatrix4(m); return [v.x, v.y, v.z]; };
  const O = (a: number, y: number): V3 => { v.set(Math.cos(a), 0, Math.sin(a)).transformDirection(m); return [v.x, v.y, v.z]; };
  let L = 0; const acc = [0]; for (let i = 1; i < prof.length; i++) { L += Math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]); acc.push(L); }
  for (let s = 0; s < seg; s++) {
    const a0 = (s / seg) * Math.PI * 2, a1 = ((s + 1) / seg) * Math.PI * 2, u0 = (s / seg) * uRep, u1 = ((s + 1) / seg) * uRep;
    for (let i = 0; i < prof.length - 1; i++) {
      const [r0, y0] = prof[i], [r1, y1] = prof[i + 1];
      const v0 = band.v0 + (acc[i] / (L || 1)) * (band.v1 - band.v0), v1 = band.v0 + (acc[i + 1] / (L || 1)) * (band.v1 - band.v0);
      const am = (a0 + a1) / 2, o = O(am, 0);
      // Outward hint: radial, unless the segment is a flat cap facing up/down.
      const dr = r1 - r0, dy = y1 - y0, hint: V3 = Math.abs(dr) > Math.abs(dy) * 3 ? (() => { v.set(0, dr > 0 ? -1 : 1, 0).transformDirection(m); return [v.x, v.y, v.z] as V3; })() : o;
      mb.quad(P(r0, y0, a0), P(r0, y0, a1), P(r1, y1, a1), P(r1, y1, a0), [u0, v0], [u1, v0], [u1, v1], [u0, v1], col, hint);
    }
  }
  if (closeTop) {
    const [r, y] = prof[prof.length - 1]; if (r <= 0.01) return;
    v.set(0, y, 0).applyMatrix4(m); const c: V3 = [v.x, v.y, v.z];
    v.set(0, 1, 0).transformDirection(m); const up: V3 = [v.x, v.y, v.z];
    for (let s = 0; s < seg; s++) { const a0 = (s / seg) * Math.PI * 2, a1 = ((s + 1) / seg) * Math.PI * 2; mb.tri(c, P(r, y, a0), P(r, y, a1), [0.5, band.v0], [0, band.v1], [1, band.v1], col, up); }
  }
}

/** Box from a center/size with a transform, each face mapped to a band. */
export function box(bk: Buckets, band: Band, sx: number, sy: number, sz: number, col: THREE.Color, m: THREE.Matrix4, tile = 0) {
  const mb = bk.get(band.m), v = new THREE.Vector3(), hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const P = (x: number, y: number, z: number): V3 => { v.set(x, y, z).applyMatrix4(m); return [v.x, v.y, v.z]; };
  const D = (x: number, y: number, z: number): V3 => { v.set(x, y, z).transformDirection(m); return [v.x, v.y, v.z]; };
  const T = (len: number): [V2, V2, V2, V2] => { const u = tile ? len / tile : 1; return [[0, band.v1], [u, band.v1], [u, band.v0], [0, band.v0]]; };
  const faces: [V3, V3, V3, V3, V3, number][] = [
    [P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz), D(0, 0, 1), sx],
    [P(hx, -hy, -hz), P(-hx, -hy, -hz), P(-hx, hy, -hz), P(hx, hy, -hz), D(0, 0, -1), sx],
    [P(hx, -hy, hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), D(1, 0, 0), sz],
    [P(-hx, -hy, -hz), P(-hx, -hy, hz), P(-hx, hy, hz), P(-hx, hy, -hz), D(-1, 0, 0), sz],
    [P(-hx, hy, hz), P(hx, hy, hz), P(hx, hy, -hz), P(-hx, hy, -hz), D(0, 1, 0), sx],
  ];
  for (const [a, b, c, d, o, len] of faces) { const t = T(len); mb.quad(a, b, c, d, t[0], t[1], t[2], t[3], col, o); }
}
