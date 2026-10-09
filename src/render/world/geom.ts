// Unit geometries for the city's instanced meshes. All pivot at the base centre (y = 0 .. 1) unless
// noted, so an instance matrix scale of (w, h, d) gives a footprint of w x d and height h.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const strip = (g: THREE.BufferGeometry) => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') n.deleteAttribute(k); return n; };
const merge = (gs: THREE.BufferGeometry[]) => { const m = mergeGeometries(gs.map(strip), false)!; m.computeBoundingSphere(); return m; };
const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);
const cyl = (rt: number, rb: number, h: number, seg = 12, x = 0, y = 0, z = 0, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open).translate(x, y + h / 2, z);

/** Building tier: a box without its bottom face. */
export function unitBox() {
  const g = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  // Drop the bottom face (indices 12..17 in BoxGeometry: +x,-x,+y,-y,+z,-z groups of 6).
  const idx = g.index!.array as Uint16Array; const keep: number[] = [];
  for (let i = 0; i < idx.length; i += 6) if (i !== 18) for (let j = 0; j < 6; j++) keep.push(idx[i + j]);
  g.setIndex(keep); g.clearGroups(); g.computeBoundingSphere();
  return g;
}
/** House: walls to 0.66, gable roof above (ridge along x). */
export function unitHouse() {
  const walls = new THREE.BoxGeometry(1, 0.66, 1).translate(0, 0.33, 0);
  const s = new THREE.Shape(); s.moveTo(-0.56, 0); s.lineTo(0.56, 0); s.lineTo(0, 0.34); s.closePath();
  const roof = new THREE.ExtrudeGeometry(s, { depth: 1.08, bevelEnabled: false }).translate(0, 0.66, -0.54);
  roof.rotateY(Math.PI / 2);
  return merge([walls, roof]);
}
/** Ruined shell: subdivided box with a broken, sagging top. */
export function unitRuin(seed: number) {
  const g = new THREE.BoxGeometry(1, 1, 1, 5, 4, 5).translate(0, 0.5, 0);
  const p = g.attributes.position as THREE.BufferAttribute;
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const cache = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i); if (y < 0.3) continue;
    const key = `${p.getX(i).toFixed(2)},${p.getZ(i).toFixed(2)},${y.toFixed(2)}`;
    let d = cache.get(key); if (d === undefined) { d = rnd() * (y > 0.9 ? 0.55 : 0.12); cache.set(key, d); }
    p.setY(i, y - d * y);
  }
  g.computeVertexNormals();
  return strip(g);
}
/** Storage tank: cylinder with a shallow domed roof. */
export function unitTank() {
  const body = cyl(0.5, 0.5, 0.88, 28);
  const pts = []; for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI / 2; pts.push(new THREE.Vector2(Math.cos(a) * 0.5, 0.88 + Math.sin(a) * 0.12)); }
  const dome = new THREE.LatheGeometry(pts, 28);
  const ring = cyl(0.515, 0.515, 0.03, 28, 0, 0.6);
  return merge([body, dome, ring]);
}
export function unitCyl() { return merge([cyl(0.5, 0.5, 1, 16), cyl(0.56, 0.56, 0.02, 16, 0, 0.7), cyl(0.56, 0.56, 0.02, 16, 0, 0.35)]); }
/** Chimney: tapered stack with a lip. */
export function unitChimney() { return merge([cyl(0.34, 0.5, 0.97, 18), cyl(0.4, 0.4, 0.03, 18, 0, 0.97), cyl(0.37, 0.37, 0.012, 18, 0, 0.9)]); }
/** Hyperboloid cooling tower (open top). */
export function unitCooler() {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 12; i++) { const t = i / 12, y = t; const r = 0.5 * (0.62 + 0.38 * Math.pow(Math.abs(t - 0.72) / 0.72, 1.6)); pts.push(new THREE.Vector2(r, y)); }
  const g = new THREE.LatheGeometry(pts, 32);
  return strip(g);
}
/** Gantry crane: legs, cross beams, boom and machinery house. Unit = 1 per field unit (scaled by k). */
export function unitCrane() {
  const parts = [
    box(1, 30, 1, -5, 0, -4), box(1, 30, 1, 5, 0, -4), box(1, 30, 1, -5, 0, 4), box(1, 30, 1, 5, 0, 4),
    box(11, 1.2, 1, 0, 14, -4), box(11, 1.2, 1, 0, 14, 4), box(1, 1.2, 9, -5, 28.8, 0), box(1, 1.2, 9, 5, 28.8, 0),
    box(70, 1.6, 2.2, -14, 30, 0),               // boom reaching over the water (−x)
    box(10, 4.5, 6, 6, 31.6, 0),                 // machinery house
    box(1.2, 10, 1.2, 1, 31.6, -2), box(1.2, 10, 1.2, 1, 31.6, 2),
    box(4, 1.5, 3, -30, 27.5, 0),                // trolley
  ];
  return merge(parts);
}
/** Rooftop water tower: tank on legs with a conical cap. */
export function unitWaterTower() {
  return merge([cyl(0.5, 0.5, 0.5, 12, 0, 0.35), new THREE.ConeGeometry(0.55, 0.22, 12).translate(0, 0.96, 0),
    box(0.06, 0.36, 0.06, -0.35, 0, -0.35), box(0.06, 0.36, 0.06, 0.35, 0, -0.35), box(0.06, 0.36, 0.06, -0.35, 0, 0.35), box(0.06, 0.36, 0.06, 0.35, 0, 0.35)]);
}
/** Antenna mast with cross arms (unit height). */
export function unitMast() { return merge([cyl(0.012, 0.03, 1, 6), box(0.25, 0.012, 0.012, 0, 0.7), box(0.18, 0.012, 0.012, 0, 0.85), box(0.12, 0.25, 0.12)]); }
/** Freighter hull along x: pointed bow at +x, superstructure aft. Unit length 1, beam 1. */
export function unitShip() {
  const s = new THREE.Shape();
  s.moveTo(-0.5, -0.5); s.lineTo(0.36, -0.5); s.quadraticCurveTo(0.5, -0.3, 0.5, 0); s.quadraticCurveTo(0.5, 0.3, 0.36, 0.5); s.lineTo(-0.5, 0.5); s.closePath();
  const hull = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(0, 0, 0);
  hull.scale(1, 0.12, 1);
  const bridge = box(0.08, 0.32, 0.8, -0.4, 0.12, 0);
  const funnel = box(0.04, 0.2, 0.18, -0.46, 0.44, 0);
  return merge([hull, bridge, funnel]);
}
/** Tree canopy: a lumpy icosahedron on a short trunk. */
export function unitTree() {
  const g = new THREE.IcosahedronGeometry(0.5, 1);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const n = 0.8 + 0.35 * Math.abs(Math.sin(x * 9.1 + y * 5.7 + z * 7.3)); p.setXYZ(i, x * n, y * n * 0.8 + 0.6, z * n); }
  g.computeVertexNormals();
  return merge([g, cyl(0.06, 0.08, 0.3, 5)]);
}
/** Rubble mound: a squashed, noisy dome. */
export function unitRubble() {
  const g = new THREE.SphereGeometry(0.5, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const n = 0.7 + 0.5 * Math.abs(Math.sin(x * 23.1 + z * 17.7) * Math.cos(z * 11.3 - x * 5.1)); p.setXYZ(i, x * (0.9 + 0.2 * n), y * n * 2, z * (0.9 + 0.2 * n)); }
  g.computeVertexNormals();
  return strip(g);
}
/** Flat quad in XZ (for water and decals), centred. */
export function unitQuad() { return new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2); }
/** Searchlight beam: open cone from the lamp (y = 0) to the far end (y = 1), widening. */
export function unitBeam() { return new THREE.CylinderGeometry(1, 0.02, 1, 24, 6, true).translate(0, 0.5, 0); }
/** Pipe along x (unit length), radius 0.5, lying on supports. */
export function unitPipe() { return merge([new THREE.CylinderGeometry(0.5, 0.5, 1, 8).rotateZ(Math.PI / 2).translate(0, 1.6, 0)]); }
export { box as boxPart, cyl as cylPart, merge as mergeParts };
