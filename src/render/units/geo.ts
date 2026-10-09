// Procedural unit geometry, authored in field units (+Z forward, +Y up) and baked with the livery
// encoding in vertex colours: [luminance, paint mask, lamp mask]. Shapes are bevelled so edges catch
// the moonlight; every vehicle is merged into one geometry per animated part.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type Enc = readonly [number, number, number];
/** Encodings: painted plate, bare metal, dark metal, rubber/track, glass, lamp. */
export const E = {
  paint: [0.72, 1, 0] as Enc, paintD: [0.5, 1, 0] as Enc, metal: [0.75, 0, 0] as Enc, metalD: [0.45, 0, 0] as Enc,
  dark: [0.22, 0, 0] as Enc, rubber: [0.14, 0, 0] as Enc, glass: [0.3, 0, 0.35] as Enc, lamp: [0.6, 0, 1] as Enc,
};

const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3();

export class Builder {
  parts: THREE.BufferGeometry[] = [];
  /** Adds a geometry with an encoding, placed at (x, y, z) with Euler rotation (rx, ry, rz). */
  add(g: THREE.BufferGeometry, enc: Enc, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    let geo = g.index ? g.toNonIndexed() : g.clone();
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    if (!geo.attributes.normal) geo.computeVertexNormals();
    tmpM.compose(tmpP.set(x, y, z), tmpQ.setFromEuler(tmpE.set(rx, ry, rz)), tmpS.set(sx, sy, sz));
    geo.applyMatrix4(tmpM);
    const n = geo.attributes.position.count, c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.set(enc, i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    this.parts.push(geo); geo = null!;
    return this;
  }
  box(w: number, h: number, d: number, enc: Enc, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, bevel = 0.35) {
    const r = Math.min(bevel, w / 2.2, h / 2.2, d / 2.2);
    return this.add(r > 0.02 ? new RoundedBoxGeometry(w, h, d, 1, r) : new THREE.BoxGeometry(w, h, d), enc, x, y, z, rx, ry, rz);
  }
  /** Cylinder along Y unless rotated. */
  cyl(rt: number, rb: number, h: number, enc: Enc, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, seg = 12) {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), enc, x, y, z, rx, ry, rz);
  }
  /** Plan-view polygon (x, z pairs) extruded upward by h from y. */
  plan(pts: number[][], h: number, enc: Enc, y = 0, bevel = 0.3, x = 0, z = 0) {
    const s = new THREE.Shape(); s.moveTo(pts[0][0], -pts[0][1]); for (const p of pts.slice(1)) s.lineTo(p[0], -p[1]); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.01, h - bevel * 2), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 6 });
    g.rotateX(-Math.PI / 2); g.translate(0, bevel, 0);
    return this.add(g, enc, x, y, z);
  }
  /** Side-view profile (z, y pairs) extruded across X by width w, centred at x. */
  side(pts: number[][], w: number, enc: Enc, x = 0, bevel = 0.3) {
    const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) s.lineTo(p[0], p[1]); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.01, w - bevel * 2), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1 });
    g.rotateY(-Math.PI / 2); g.translate(x + w / 2 - bevel, 0, 0);
    return this.add(g, enc);
  }
  sphere(r: number, enc: Enc, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, seg = 10) {
    return this.add(new THREE.SphereGeometry(r, seg, Math.max(4, seg * 0.6 | 0)), enc, x, y, z, 0, 0, 0, sx, sy, sz);
  }
  build() { const g = mergeGeometries(this.parts, false)!; g.computeBoundingBox(); return g; }
}

/* ------------------------------------------------------------------ tank */
/** Main battle tank hull (no turret). ~28 long, 17 wide. */
export function tankHull() {
  const b = new Builder();
  for (const s of [-1, 1]) {
    const x = s * 6.7;
    b.box(4.2, 4.2, 27, E.rubber, x, 2.1, 0, 0, 0, 0, 1.4);
    for (let i = 0; i < 16; i++) b.box(4.3, 0.35, 0.7, E.dark, x, 4.25, -12.6 + i * 1.68, 0, 0, 0, 0.08);
    for (let i = 0; i < 6; i++) b.cyl(1.7, 1.7, 0.7, E.metalD, s * 8.85, 1.9, -9.5 + i * 3.8, 0, 0, Math.PI / 2, 10);
    b.box(0.6, 2.2, 21, E.paint, s * 9.1, 3.5, 0.5, 0, 0, s * -0.08, 0.15);
    b.box(4.8, 0.45, 27.5, E.paint, x, 4.75, 0, 0, 0, 0, 0.15);
  }
  b.side([[-13.2, 1.4], [-13.2, 5.6], [-10, 6.5], [7.5, 6.5], [13.6, 4.2], [13.6, 2.6], [10.5, 1.2]], 9.6, E.paint, 0, 0.35);
  // engine deck: grille slats and exhausts
  b.box(8, 0.5, 6, E.dark, 0, 6.6, -9.3, 0, 0, 0, 0.1);
  for (let i = 0; i < 5; i++) b.box(7.4, 0.35, 0.5, E.metalD, 0, 6.95, -11.6 + i * 1.15, 0, 0, 0, 0.05);
  for (const s of [-1, 1]) b.box(1.8, 1, 0.9, E.dark, s * 3.2, 5.6, -13.3, 0, 0, 0, 0.2);
  // glacis details: tow hooks, driver hatch, headlight housings, tail lamps
  b.cyl(1.1, 1.1, 0.5, E.metal, 0, 6.6, 6.3, 0, 0, 0, 10);
  for (const s of [-1, 1]) {
    b.box(1.4, 1, 1, E.metalD, s * 4, 5.3, 12.9, 0, 0, 0, 0.2);
    b.box(0.9, 0.6, 0.4, E.glass, s * 4, 5.35, 13.45, 0, 0, 0, 0.1);
    b.box(0.8, 0.5, 0.4, E.lamp, s * 4.3, 5.4, -13.45, 0, 0, 0, 0.1);
    b.box(2.2, 1.2, 3.6, E.paintD, s * 6.8, 5.6, -7, 0, 0, 0, 0.3);
  }
  return b.build();
}
/** Tank turret; pivot at (0, 6.5, -1). Barrel points +Z. */
export function tankTurret() {
  const b = new Builder(), y = 6.5;
  b.plan([[-4.8, -5.2], [4.8, -5.2], [6.2, -1], [5.2, 3.8], [2.6, 5.6], [-2.6, 5.6], [-5.2, 3.8], [-6.2, -1]], 3.3, E.paint, y, 0.45, 0, -1);
  b.box(10, 1.6, 2.6, E.dark, 0, y + 1.3, -7.2, 0, 0, 0, 0.3);
  b.box(3.2, 2.4, 2, E.paintD, 0, y + 1.6, 5.3, 0, 0, 0, 0.4);
  b.cyl(0.62, 0.7, 15, E.metalD, 0, y + 1.7, 12.5, Math.PI / 2, 0, 0, 10);
  b.cyl(0.95, 0.95, 2.4, E.metalD, 0, y + 1.7, 13, Math.PI / 2, 0, 0, 10);
  b.box(1.7, 1.1, 1.8, E.dark, 0, y + 1.7, 20.4, 0, 0, 0, 0.2);
  b.cyl(1.5, 1.6, 1.1, E.paintD, -2.3, y + 3.6, -2.4, 0, 0, 0, 12);
  b.cyl(1.1, 1.1, 0.4, E.metal, -2.3, y + 4.25, -2.4, 0, 0, 0, 12);
  b.box(1.6, 0.9, 1.4, E.metalD, 2.4, y + 3.6, -0.5, 0, 0, 0, 0.2);
  b.cyl(0.07, 0.07, 7, E.dark, -4, y + 6.8, -5.4, 0, 0, 0, 4);
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) b.cyl(0.32, 0.32, 1.3, E.dark, s * (4.6 + i * 0.25), y + 2.6, 2.8 - i * 0.7, 1.1, 0, s * 0.4, 6);
  return b.build();
}

/* ------------------------------------------------------------------ infantry */
/** One soldier (~6 tall), merged; faces +Z, rifle at the ready, helmet lamp. */
export function soldier() {
  const b = new Builder();
  for (const s of [-1, 1]) b.box(0.75, 2.8, 0.85, E.paintD, s * 0.5, 1.4, 0, 0, 0, 0, 0.2);
  b.box(2.1, 2.4, 1.3, E.paint, 0, 3.9, 0, 0, 0, 0, 0.35);
  b.box(1.6, 1.8, 0.9, E.paintD, 0, 4.1, -1, 0, 0, 0, 0.3);
  b.sphere(0.72, E.paint, 0, 5.75, 0.05, 1, 0.8, 1.05, 8);
  b.box(0.4, 0.3, 0.35, E.lamp, 0, 5.85, 0.78, 0, 0, 0, 0.05);
  for (const s of [-1, 1]) b.box(0.55, 2, 0.6, E.paintD, s * 1.25, 4, 0.55, -0.9, 0, 0, 0.15);
  b.box(0.35, 0.45, 3.4, E.dark, 0.3, 4.2, 1.6, 0, 0, 0, 0.05);
  return b.build();
}

/* ------------------------------------------------------------------ SAM launcher (on a truck chassis) */
export function samRack() {
  const b = new Builder();
  b.box(5, 1.6, 5, E.metalD, 0, 0.8, 0, 0, 0, 0, 0.4);
  b.cyl(2.2, 2.6, 1.2, E.paintD, 0, 1.9, 0, 0, 0, 0, 12);
  // two launch boxes of 2x2 tubes, raised at 55 degrees
  for (const s of [-1, 1]) {
    const x = s * 2.7, ry = 0, rx = -0.95;
    b.box(2.6, 2.6, 9, E.paint, x, 5, 0.8, rx, ry, 0, 0.3);
    for (const a of [-0.6, 0.6]) for (const c of [-0.6, 0.6]) {
      const p = new THREE.Vector3(a, c, 4.55).applyEuler(new THREE.Euler(rx, 0, 0)).add(new THREE.Vector3(x, 5, 0.8));
      b.cyl(0.45, 0.45, 0.25, E.lamp, p.x, p.y, p.z, rx + Math.PI / 2, 0, 0, 8);
    }
  }
  b.cyl(0.25, 0.25, 4, E.metalD, 0, 4, -2.2, 0, 0, 0, 6);
  return b.build();
}
export function radarDish() {
  const b = new Builder();
  const dish = new THREE.SphereGeometry(2.6, 14, 6, 0, Math.PI * 2, 0, 0.8);
  b.add(dish, E.metal, 0, -1.6, 0, -1.2, 0, 0, 1, 0.6, 1);
  b.box(0.4, 0.4, 2.2, E.dark, 0, 0.2, 0.6, 0, 0, 0, 0.05);
  return b.build();
}

/* ------------------------------------------------------------------ bunker */
export function bunkerRing() {
  const b = new Builder();
  // revetment: sloped concrete ring of 12 segments with sandbag lips
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, r = 20.5;
    b.box(9.6, 4.2, 4, E.metal, Math.sin(a) * r, 2.1, Math.cos(a) * r, 0, a, 0, 0.9);
    b.box(8.6, 1.3, 2.6, E.paintD, Math.sin(a) * (r - 0.4), 4.6, Math.cos(a) * (r - 0.4), 0, a, 0, 0.6);
  }
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.26; b.box(2.4, 1, 0.6, E.lamp, Math.sin(a) * 14.2, 5.3, Math.cos(a) * 14.2, 0, a, 0, 0.1); }
  return b.build();
}

/* ------------------------------------------------------------------ salvage */
/** A stack of military supply crates on a pallet with a beacon mast. */
export function crates() {
  const b = new Builder();
  b.box(22, 1.2, 20, E.dark, 0, 0.6, 0, 0, 0, 0, 0.2);
  const crate = (w: number, h: number, d: number, x: number, y: number, z: number, ry: number) => {
    b.box(w, h, d, E.paint, x, y + h / 2, z, 0, ry, 0, 0.5);
    for (const s of [-0.32, 0.32]) b.box(w + 0.2, h + 0.15, 0.6, E.metalD, x + Math.sin(ry) * s * d, y + h / 2, z + Math.cos(ry) * s * d, 0, ry, 0, 0.1);
    b.box(w * 0.4, 0.3, d * 0.25, E.paintD, x, y + h + 0.1, z, 0, ry, 0, 0.1);
  };
  crate(11, 6.5, 8, -4.5, 1.2, -4.5, 0.05); crate(9, 6, 8, 5.5, 1.2, -4, -0.08); crate(16, 5, 8, 0, 1.2, 5.5, 0.03);
  crate(8, 5, 7, -3.5, 7.7, -4.2, 0.35);
  b.cyl(0.25, 0.25, 7, E.metalD, 7.5, 9.2, -6.5, 0, 0, 0, 6);
  b.cyl(0.8, 0.8, 1, E.lamp, 7.5, 13.1, -6.5, 0, 0, 0, 10);
  return b.build();
}
/** Floating salvage canister: an armoured cylinder with glowing gold bands. */
export function canister() {
  const b = new Builder();
  b.cyl(4.2, 4.2, 14, E.paint, 0, 0, 0, 0, 0, Math.PI / 2, 16);
  for (const x of [-7.3, 7.3]) b.cyl(3.4, 4.3, 1.2, E.metalD, x, 0, 0, 0, 0, Math.PI / 2, 16);
  for (const x of [-3.8, 0, 3.8]) b.cyl(4.45, 4.45, 0.8, E.lamp, x, 0, 0, 0, 0, Math.PI / 2, 16);
  for (let i = 0; i < 4; i++) b.box(13, 0.9, 0.9, E.metalD, 0, Math.cos(i * Math.PI / 2) * 4.3, Math.sin(i * Math.PI / 2) * 4.3, 0, 0, 0, 0.15);
  return b.build();
}

/* ------------------------------------------------------------------ crawler (siege fortress) */
/** Two enormous track units and the chassis between them. Long axis is X (it crawls sideways). */
export function crawlerTracks() {
  const b = new Builder();
  for (const s of [-1, 1]) {
    const z = s * 33;
    b.box(104, 13, 16, E.rubber, 0, 6.5, z, 0, 0, 0, 4.5);
    for (let i = 0; i < 40; i++) b.box(1.4, 0.8, 16.4, E.dark, -50 + i * 2.56, 13, z, 0, 0, 0, 0.1);
    for (let i = 0; i < 9; i++) b.cyl(4.6, 4.6, 1.2, E.metalD, -44 + i * 11, 5.4, z + s * 8.4, Math.PI / 2, 0, 0, 14);
    b.box(98, 2.5, 3, E.paint, 0, 12, z + s * 9.2, 0, 0, 0, 0.6);
    for (let i = 0; i < 5; i++) b.box(10, 1, 15, E.paintD, -40 + i * 20, 14, z, 0, 0, 0, 0.3);
  }
  b.box(92, 8, 52, E.metalD, 0, 9, 0, 0, 0, 0, 1);
  return b.build();
}

/* ------------------------------------------------------------------ wreck heap */
export function scrapHeap() {
  const b = new Builder();
  b.sphere(14, E.dark, 0, -6, 0, 1.25, 0.55, 1, 9);
  b.side([[-12, 0], [-12, 5], [-7, 7], [9, 7], [13, 3.5], [11, 0]], 10, E.paintD, -2, 0.4);
  b.box(4, 3.6, 22, E.rubber, 7, 2.5, 1, 0.1, 0.3, 0.25, 1.2);
  b.box(14, 1, 9, E.metal, -9, 3, 7, 0.4, 0.8, 0.2, 0.2);
  b.cyl(0.6, 0.6, 15, E.metalD, -3, 7, -4, 0.3, 0.6, 1.2, 8);
  b.box(6, 4, 6, E.paint, 9, 2, -9, 0.3, 0.5, -0.4, 0.5);
  return b.build();
}
