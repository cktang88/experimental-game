// City layer: the night city far below the flight plane. Stylized on purpose — dark extruded
// blocks lit by window grids, street-lamp lines and traffic streams, plus fires, smoke, rubble and
// craters from the fighting. Data comes from src/game/worldgen.ts.
//
// Draw calls: ground, flats (blocks, roads, water), buildings, props, lights, traffic, craters,
// plus four searchlight beams. Everything is a global instanced batch in city space under one
// scrolled root group; batches are refilled only when a row enters or leaves (every few seconds),
// and per frame the CPU only touches buildings whose damage state changed. No per-frame allocation.
import * as THREE from 'three';
import type { Engine, FrameCtx, Layer } from '../engine';
import { FIELD_W, FIELD_H, FLIGHT } from '../engine';
import { THEMES } from '../palette';
import { rgb, Shape, DarkShape } from '../fx/quads';
import { CITY, DARK, STOREY, CITY_K, type Bldg, type Cloud, type Surface } from '../../game/worldgen';
import { U, darkTex, buildingMaterial, lightMaterial, trafficMaterial, craterMaterial, beamMaterial } from './shaders';

const MAX_BLD = 12288, MAX_FLAT = 12288, MAX_PROP = 8192, MAX_LIGHT = 8192, MAX_CARS = 2048, MAX_CRATER = 96;
/** Detail sizes authored for the old ground scale shrink with the city (see worldgen CITY_K). */
const CK = CITY_K;
const v = new THREE.Vector3(), w = new THREE.Vector3(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
const SMOKE = rgb('#25242a'), STEAM = rgb('#5d5c63'), FIRE_A = rgb('#ff8a2a'), FIRE_B = rgb('#ffcf6a'), EMBER = rgb('#ff5a1a');
const CLOUD = rgb('#3c4250'), SEARCH = rgb('#cfe2ff');

/** Ground surfaces (stylized: near-black with a hint of the zone). */
const SURF: Record<Surface, string> = {
  walk: '#1c1f24', plaza: '#24262b', grass: '#141c15', park: '#111a12', lot: '#17191c', gravel: '#1f1f1f', yard: '#1b1c1c',
  dock: '#1d1e20', rail: '#16130f', ash: '#1f1b1a', snow: '#2a3038', dirt: '#211c16', bund: '#1a1918',
};
const STYLE_TINT: number[][] = [
  // [hue, sat, light] ranges per Style: dark blocks with a little colour of the material.
  [0.03, 0.18, 0.13], [0.6, 0.04, 0.15], [0.58, 0.06, 0.14], [0.58, 0.18, 0.12], [0.5, 0.2, 0.11],
  [0.08, 0.1, 0.12], [0.07, 0.14, 0.15], [0.05, 0.05, 0.05], [0.07, 0.06, 0.16],
];
const CONTAINERS = ['#5a2a1e', '#1f3550', '#2c4a46', '#5c4a24', '#6a6e72', '#3a2f45', '#2a3a2a'].map((h) => new THREE.Color(h));

interface Anchor { x: number; z: number; y: number; phase: number; b?: Bldg }
interface Spot { x: number; y: number; z: number; s: number; seed: number; b?: Bldg }

/** An instanced flat quad batch with custom per-instance float attributes. */
function quadBatch(max: number, names: string[], mat: THREE.Material) {
  const g = new THREE.InstancedBufferGeometry();
  const qd = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  g.index = qd.index; g.setAttribute('position', qd.attributes.position); g.setAttribute('uv', qd.attributes.uv);
  const attrs: Record<string, THREE.InstancedBufferAttribute> = {};
  for (const n of names) { const a = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4); g.setAttribute(n, a); attrs[n] = a; }
  g.instanceCount = 0;
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false;
  return { g, mesh, attrs };
}

export class CityLayer implements Layer {
  name = 'city';
  root = new THREE.Group();
  ground: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  bld: THREE.InstancedMesh; aB: THREE.InstancedBufferAttribute; aS: THREE.InstancedBufferAttribute;
  flats: THREE.InstancedMesh; props: THREE.InstancedMesh;
  lights = quadBatch(MAX_LIGHT, ['aL', 'aC', 'aK'], lightMaterial());
  cars = quadBatch(MAX_CARS, ['aT', 'aC'], trafficMaterial());
  craters = quadBatch(MAX_CRATER, ['aK'], craterMaterial());
  beams: THREE.Mesh[] = []; beamMats: THREE.ShaderMaterial[] = []; beamAim: THREE.Vector3[] = [];
  anchors: Anchor[] = []; fires: Spot[] = []; stacks: Spot[] = [];
  /** Lights that belong to a building (roof beacons, flares): light index -> building. */
  bLights: { i: number; b: Bldg }[] = [];
  gen = -1; darkVer = -1;
  /** Change detection without per-frame strings: [gen, rows, first id, last id] and [craters, first born, last born]. */
  private sig = [NaN, 0, 0, 0]; private craterSig = [NaN, 0, 0];
  private k = 1; private cz = 0; private nL = 0;

  constructor(private engine: Engine) {
    const e = engine;
    if (import.meta.env.DEV) (window as unknown as { __cityLayer: unknown }).__cityLayer = this;
    this.k = e.groundScale; this.cz = e.camPos.z;
    U.uDarkMap.value.set(DARK.x0, DARK.cell, this.k, this.cz);
    U.uK.value = this.k; U.uFloor.value = STOREY * this.k;
    e.scene.add(this.root);
    CITY.camH = e.camPos.y; CITY.groundK = this.k;
    const cam = e.camPos;
    CITY.project = (x, y, alt, out) => {
      e.toGround(x, y, v); v.y = alt * this.k;
      const s = (cam.y - FLIGHT) / (cam.y - v.y);
      out.x = cam.x + (v.x - cam.x) * s + FIELD_W / 2; out.y = cam.z + (v.z - cam.z) * s + FIELD_H / 2;
      return out;
    };

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(12000, 9000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x0e1013, roughness: 1, metalness: 0 }));
    const mid = e.toGround(FIELD_W / 2, FIELD_H / 2);
    this.ground.position.set(mid.x, -0.5, mid.z); this.ground.receiveShadow = true;
    e.scene.add(this.ground);

    this.flats = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0.05 }), MAX_FLAT);
    this.flats.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_FLAT * 3), 3);
    Object.assign(this.flats, { count: 0, frustumCulled: false, receiveShadow: true });

    const bg = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.aB = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BLD * 4), 4);
    this.aS = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BLD * 4), 4); this.aS.setUsage(THREE.DynamicDrawUsage);
    bg.setAttribute('aB', this.aB); bg.setAttribute('aS', this.aS);
    this.bld = new THREE.InstancedMesh(bg, buildingMaterial(), MAX_BLD);
    this.bld.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BLD * 3), 3);
    Object.assign(this.bld, { count: 0, frustumCulled: false, receiveShadow: true });

    this.props = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.2 }), MAX_PROP);
    this.props.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PROP * 3), 3);
    Object.assign(this.props, { count: 0, frustumCulled: false, receiveShadow: true });

    this.craters.mesh.renderOrder = -1;
    this.root.add(this.flats, this.craters.mesh, this.bld, this.props, this.lights.mesh);
    e.scene.add(this.cars.mesh);

    const beamGeo = new THREE.CylinderGeometry(1, 0.04, 1, 14, 1, true).translate(0, 0.5, 0);
    for (let i = 0; i < 4; i++) {
      const mat = beamMaterial();
      const b = new THREE.Mesh(beamGeo, mat); b.frustumCulled = false; b.visible = false; b.renderOrder = 1;
      e.scene.add(b); this.beams.push(b); this.beamMats.push(mat); this.beamAim.push(new THREE.Vector3());
    }
  }

  clear() { /* the city persists between screens */ }

  private X = (x: number) => (x - 800) * this.k;
  private Z = (cy: number) => this.cz + (cy - 450 - this.cz) * this.k;
  private R = (h: number) => h * this.k;

  /** New seed or theme: colours and the traffic loop. */
  private reseed() {
    this.gen = CITY.gen; this.sig[0] = NaN;
    const e = this.engine, th = THEMES[CITY.theme % THEMES.length], ti = CITY.theme % 5;
    U.uWinCol.value.set(th.window);
    U.uLampCol.value.set(ti === 2 ? '#cfe0ff' : ti === 4 ? '#ffc070' : ti === 1 ? '#ff9a3a' : '#ffae48');
    this.ground.material.color.set(th.dec).multiplyScalar(0.55);
    e.renderer.setClearColor(th.fog);
    const fog = e.scene.fog as THREE.Fog; fog.color.set(th.fog); fog.near = 3400; fog.far = 7400;
    // Traffic on the avenues: lanes loop over the visible stretch and ride the scroll.
    const zTop = e.toGround(0, -420, v).z, zBot = e.toGround(0, FIELD_H + 160, w).z, L = zBot - zTop;
    U.uLoop.value.set(zTop, L);
    const dens = ti === 3 ? 0.2 : ti === 4 ? 1.5 : ti === 1 ? 0.45 : ti === 2 ? 0.6 : 1;
    const { aT, aC } = this.cars.attrs;
    let n = 0;
    for (const a of CITY.plan!.aves) {
      const lanes = a.major ? 4 : 2, wid = this.R(a.x1 - a.x0), cx = this.X((a.x0 + a.x1) / 2);
      for (let i = 0; i < lanes; i++) {
        const dir = i < lanes / 2 ? 1 : -1, off = ((i % (lanes / 2)) + 0.5) * (wid / lanes) * (dir > 0 ? 1 : -1) * 0.9;
        // From this altitude traffic is a faint drift of light along the avenues, not individual cars.
        const cars = Math.round((L / (a.major ? 260 : 520)) * dens);
        for (let c = 0; c < cars && n < MAX_CARS; c++, n++) {
          aT.setXYZW(n, cx + off, Math.random() * L, dir * this.R((a.major ? 60 + Math.random() * 30 : 40 + Math.random() * 25) * CK), this.R(9 * CK));
          if (dir > 0) aC.setXYZW(n, 1.0, 0.9, 0.72, 0.45); else aC.setXYZW(n, 1.0, 0.42, 0.14, 0.3);
        }
      }
    }
    aT.needsUpdate = true; aC.needsUpdate = true; this.cars.g.instanceCount = n;
  }

  private light(x: number, y: number, z: number, size: number, c: THREE.Color, a: number, kind: number, phase = Math.random(), len = 0, alongX = 0) {
    if (this.nL >= MAX_LIGHT) return -1;
    const i = this.nL++, { aL, aC, aK } = this.lights.attrs;
    aL.setXYZW(i, x, y, z, size); aC.setXYZW(i, c.r, c.g, c.b, a); aK.setXYZW(i, kind, phase, len, alongX);
    return i;
  }
  private box(n: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, rot: number, c: THREE.Color) {
    if (n >= MAX_PROP) return n;
    m4.compose(v.set(x, y, z), q.setFromAxisAngle(UP, rot), s3.set(sx, sy, sz));
    this.props.setMatrixAt(n, m4); this.props.setColorAt(n, c);
    return n + 1;
  }
  private flat(n: number, x0: number, y0: number, x1: number, y1: number, y: number, c: THREE.Color) {
    if (n >= MAX_FLAT) return n;
    m4.compose(v.set(this.X((x0 + x1) / 2), y, this.Z((y0 + y1) / 2)), q.identity(), s3.set(this.R(x1 - x0), 1, this.R(y1 - y0)));
    this.flats.setMatrixAt(n, m4); this.flats.setColorAt(n, c);
    return n + 1;
  }

  /** Refill every batch from the rows currently alive (runs when a row enters or leaves). */
  private rebuild() {
    const R = this.R, X = this.X, Z = this.Z, lamp = U.uLampCol.value, ti = CITY.theme % 5;
    let nb = 0, nf = 0, np = 0; this.nL = 0;
    this.anchors.length = 0; this.fires.length = 0; this.stacks.length = 0; this.bLights.length = 0;
    const road = new THREE.Color(THEMES[ti].dec).multiplyScalar(0.5), water = new THREE.Color('#04070b');
    const lampHot = lamp.clone().multiplyScalar(2.2), white = new THREE.Color('#e8eeff').multiplyScalar(1.6), amber = new THREE.Color('#ffb347').multiplyScalar(1.8);
    const surf: Record<string, THREE.Color> = {};
    for (const key in SURF) surf[key] = new THREE.Color(SURF[key as Surface]);
    for (const ch of CITY.chunks) {
      for (const wt of ch.water) nf = this.flat(nf, wt.x0, wt.y0, wt.x1, wt.y1, 0.1, water);
      for (const p of ch.pads) nf = this.flat(nf, p.x0, p.y0, p.x1, p.y1, 0.4, surf[p.s]);
      for (const r of ch.roads) {
        nf = this.flat(nf, r.x0, r.y0, r.x1, r.y1, 0.8, road);
        // The street itself glows with its lamps: from this high the grid reads as faint lines of
        // light between dark blocks (kept dim: the city is the backdrop, never the subject).
        if (r.dir === 0) this.light(X((r.x0 + r.x1) / 2), 1.2, Z((r.y0 + r.y1) / 2), R((r.x1 - r.x0) * 1.6), lamp, r.major ? 0.13 : 0.075, 5, 0, R(r.y1 - r.y0), 0);
        else this.light(X((r.x0 + r.x1) / 2), 1.2, Z((r.y0 + r.y1) / 2), R((r.y1 - r.y0) * 1.6), lamp, 0.075, 5, 0, R(r.x1 - r.x0), 1);
        // Lamp heads only along the major avenues, a pixel of sodium every so often.
        if (r.major && r.dir === 0) for (let y = r.y0 + 6; y < r.y1; y += 22) for (const x of [r.x0 + 0.6, r.x1 - 0.6]) this.light(X(x), R(1), Z(y), R(1.3), lampHot, 0.55, 0);
      }
      for (const b of ch.bldgs) {
        const st = STYLE_TINT[b.style] ?? STYLE_TINT[1];
        const h = (b.seed * 7.31) % 1, h2 = (b.seed * 13.7) % 1;
        col.setHSL(st[0] + (h - 0.5) * 0.05, st[1], st[2] * (0.5 + 0.4 * h2));
        b.ri = nb; b.rn = 0;
        let top = b.tiers[0];
        for (const t of b.tiers) {
          if (nb >= MAX_BLD) break;
          if (t.z0 + t.hgt >= top.z0 + top.hgt) top = t;
          m4.compose(v.set(X(b.x + t.ox), R(t.z0), Z(b.cy + t.oy)), q.setFromAxisAngle(UP, b.rot), s3.set(R(t.w), R(t.hgt), R(t.h)));
          this.bld.setMatrixAt(nb, m4); this.bld.setColorAt(nb, col);
          this.aB.setXYZW(nb, b.seed, b.lit, b.keepLit ? 1 : 0, b.style);
          this.aS.setXYZW(nb, b.collapseT > 0 ? b.collapseT : 0, b.fire, b.neon, 0);
          nb++; b.rn++;
        }
        const roofY = R(top.z0 + top.hgt), cx = X(b.x + top.ox), cz = Z(b.cy + top.oy);
        if (b.kind === 'flare') { this.fires.push({ x: cx, y: roofY, z: cz, s: R(4), seed: b.seed, b }); continue; }
        if (b.kind === 'chimney' || b.kind === 'cooler') { this.stacks.push({ x: cx, y: roofY, z: cz, s: R(top.w * (b.kind === 'cooler' ? 0.7 : 1)), seed: b.seed, b }); }
        // Aviation beacons on the tall ones (white and amber: red is reserved for threats).
        if (b.hgt > 40 && !b.dead) {
          const i = this.light(cx, roofY + R(0.6), cz, R(2.2), b.seed > 0.5 ? white : amber, 0.8, 3, b.seed * 7);
          if (i >= 0) this.bLights.push({ i, b });
        }
      }
      for (const p of ch.props) {
        const x = X(p.x), z = Z(p.cy);
        switch (p.k) {
          case 'lamp': this.light(x, R(p.h || 1), z, R(1.3), lampHot, 0.6, p.v > 0.5 ? 2 : 0); this.light(x, 1.4, z, R(5), lamp, 0.1, 1); break;
          case 'tree': np = this.box(np, x, 0, z, R(p.w), R(p.h), R(p.w), 0, col.setHSL(0.3, 0.25, p.v > 0.9 ? 0.03 : 0.06 + p.v * 0.03)); break;
          case 'container': np = this.box(np, x, 0, z, R(p.w), R(p.h), R(p.d), p.rot, CONTAINERS[Math.floor(p.v * CONTAINERS.length)].clone().multiplyScalar(0.5)); break;
          case 'railcar': case 'loco': np = this.box(np, x, 0, z, R(p.w), R(p.h), R(p.d), 0, col.setHSL(0.06, 0.2, 0.08 + p.v * 0.05)); break;
          case 'pipe': np = this.box(np, x, R(2), z, R(p.w), R(p.h), R(p.d), 0, col.setHSL(0.08, 0.1, 0.16)); break;
          case 'rubble': case 'hulk': np = this.box(np, x, 0, z, R(p.w), R(p.h), R(p.d), p.rot, col.setHSL(0.05, 0.05, 0.07)); break;
          case 'pylon': np = this.box(np, x, 0, z, R(0.5), R(p.h), R(0.5), 0, col.setHSL(0.6, 0.05, 0.12)); break;
          case 'crane': {
            np = this.box(np, x, 0, z, R(4 * CK), R(p.h), R(4 * CK), 0, col.setHSL(0.09, 0.5, 0.2));
            np = this.box(np, x - R(16 * CK), R(p.h - 4 * CK), z, R(46 * CK), R(2.5 * CK), R(3 * CK), 0, col.setHSL(0.09, 0.5, 0.2));
            this.light(x - R(38 * CK), R(p.h - 2 * CK), z, R(1.6), amber, 0.7, 3, p.v * 5);
            break;
          }
          case 'ship': {
            np = this.box(np, x, 0, z, R(p.w), R(p.h), R(p.d), 0, col.setHSL(0.6, 0.08, 0.09));
            np = this.box(np, x + R(p.w * 0.36), R(p.h), z, R(p.w * 0.12), R(8 * CK), R(p.d * 0.7), 0, col.setHSL(0.6, 0.04, 0.2));
            for (let i = 0; i < 4; i++) this.light(x + R((i / 3 - 0.5) * p.w * 0.85), R(p.h + 0.3), z, R(1.2), lampHot, 0.6, 2);
            break;
          }
          case 'searchlight': this.anchors.push({ x, z, y: R(p.h) + 1, phase: p.v * 10, b: p.on }); break;
          case 'fire': this.fires.push({ x, y: 1, z, s: R(p.w), seed: p.v }); break;
        }
      }
    }
    this.bld.count = nb; this.bld.instanceMatrix.needsUpdate = true; this.bld.instanceColor!.needsUpdate = true;
    this.aB.needsUpdate = true; this.aS.clearUpdateRanges(); this.aS.needsUpdate = true;
    this.flats.count = nf; this.flats.instanceMatrix.needsUpdate = true; this.flats.instanceColor!.needsUpdate = true;
    this.props.count = np; this.props.instanceMatrix.needsUpdate = true; this.props.instanceColor!.needsUpdate = true;
    for (const n in this.lights.attrs) this.lights.attrs[n].needsUpdate = true;
    this.lights.g.instanceCount = this.nL;
    for (const bl of this.bLights) if (bl.b.dead) this.lights.attrs.aC.setW(bl.i, 0);
  }

  /** Push a building's damage state into its instances. */
  private apply(b: Bldg) {
    if (b.ri < 0) return;
    const ct = b.collapseT > 0 ? b.collapseT : 0;
    for (let i = b.ri; i < b.ri + b.rn; i++) { this.aS.setX(i, ct); this.aS.setY(i, b.fire); }
    this.aS.addUpdateRange(b.ri * 4, b.rn * 4); this.aS.needsUpdate = true;
    if (b.dead) for (const bl of this.bLights) if (bl.b === b) { this.lights.attrs.aC.setW(bl.i, 0); this.lights.attrs.aC.needsUpdate = true; }
  }

  update({ S, dt, engine: e }: FrameCtx) {
    if (!CITY.plan) return;
    if (this.gen !== CITY.gen) this.reseed();
    const chs = CITY.chunks;
    const g = this.sig, first = chs.length ? chs[0].id : 0, last = chs.length ? chs[chs.length - 1].id : 0;
    if (g[0] !== CITY.gen || g[1] !== chs.length || g[2] !== first || g[3] !== last) { g[0] = CITY.gen; g[1] = chs.length; g[2] = first; g[3] = last; this.rebuild(); }
    const k = this.k, scrollZ = S.scrollY * k, t = CITY.time;
    this.root.position.z = scrollZ;
    U.uTime.value = t; U.uScrollZ.value = scrollZ;
    if (this.darkVer !== DARK.ver) { this.darkVer = DARK.ver; darkTex.needsUpdate = true; }
    for (let i = 0; i < CITY.dirty.length; i++) this.apply(CITY.dirty[i]);
    CITY.dirty.length = 0;
    for (let i = 0; i < CITY.burning.length; i++) this.apply(CITY.burning[i]);

    const glow = e.glow, dark = e.dark;
    // Burning buildings: flames licking from the roof (or the heap) and a smoke column leaning downwind.
    for (let i = 0; i < CITY.burning.length; i++) {
      const b = CITY.burning[i], f = b.fire;
      if (f <= 0.02 || b.y < -150 || b.y > FIELD_H + 60) continue;
      const sink = b.collapseT > 0 ? Math.min(1, ((t - b.collapseT) / 1.7) ** 2) : 0;
      const top = b.dead ? this.R(Math.min(5, b.hgt * 0.1)) + this.R(b.hgt) * (1 - sink) : this.R(b.hgt);
      this.burn(glow, dark, this.X(b.x), top, this.Z(b.cy) + scrollZ, this.R(Math.max(b.w, b.h)), f, b.seed, t);
    }
    for (const f of this.fires) {
      if (f.b?.dead) continue;
      const fy = (f.z + scrollZ - this.cz) / k + 450 + this.cz;
      if (fy < -150 || fy > FIELD_H + 60) continue;
      if (f.b) {
        // Refinery flare: a tall standing flame and the orange wash it throws on the ground.
        const fl = 0.8 + 0.2 * Math.sin(t * 11 + f.seed * 30);
        glow.add(f.x, f.y + f.s, f.z + scrollZ, 0, f.s * 1.2 * fl, f.s * 2.2 * fl, FIRE_A, 1.1, Shape.Soft);
        glow.add(f.x, f.y + f.s * 0.6, f.z + scrollZ, 0, f.s * 0.6, f.s * 1.1, FIRE_B, 1.2, Shape.Hot);
        glow.add(f.x, 2, f.z + scrollZ, 0, f.s * 9, f.s * 9, FIRE_A, 0.06, Shape.Soft);
      } else this.burn(glow, dark, f.x, f.y, f.z + scrollZ, f.s * 1.5, 0.6, f.seed, t);
    }
    for (const s of this.stacks) {
      if (s.b?.dead) continue;
      const fy = (s.z + scrollZ - this.cz) / k + 450 + this.cz;
      if (fy < -200 || fy > FIELD_H + 60) continue;
      this.plume(dark, s.x, s.y, s.z + scrollZ, s.s, s.seed, t, s.b?.kind === 'cooler');
    }
    this.updateCraters();
    this.updateClouds(S.clouds as Cloud[]);
    this.updateBeams(S, dt);
  }

  private burn(glow: Engine['glow'], dark: Engine['dark'], x: number, y: number, z: number, sz: number, f: number, seed: number, t: number) {
    const k = this.k;
    for (let i = 0; i < 3; i++) {
      const ph = t * (5 + i * 1.7) + seed * 40 + i * 2.1;
      const fl = 0.75 + 0.25 * Math.sin(ph) * Math.sin(ph * 1.7 + 1);
      const ox = Math.sin(seed * 91 + i * 2.4) * sz * 0.25, oz = Math.cos(seed * 57 + i * 1.9) * sz * 0.2;
      glow.add(x + ox, y + 2 + i, z + oz, 0, sz * (0.45 + 0.25 * f) * fl, sz * (0.45 + 0.25 * f) * fl, i === 0 ? FIRE_B : FIRE_A, 0.38 * f * fl, Shape.Soft);
    }
    glow.add(x, 2, z, 0, sz * 2.4, sz * 2.4, EMBER, 0.12 * f, Shape.Soft);
    for (let i = 0; i < 5; i++) {
      const ph = (t * 0.22 + i / 5 + seed * 3.7) % 1;
      const h = y + ph * 160 * k * (0.4 + 0.6 * f);
      const s = (sz * 0.8 + ph * 34 * k) * (0.6 + 0.6 * f);
      dark.add(x + ph * ph * 50 * k + Math.sin(seed * 20 + i * 3) * sz * 0.2, h, z + ph * 22 * k, ph * 3 + seed, s, s, SMOKE, (1 - ph) * (ph < 0.08 ? ph / 0.08 : 1) * 0.36 * Math.min(1, f * 1.5), DarkShape.Soft);
    }
  }

  private plume(dark: Engine['dark'], x: number, y: number, z: number, sz: number, seed: number, t: number, steam: boolean) {
    const k = this.k;
    for (let i = 0; i < 5; i++) {
      const ph = (t * (steam ? 0.12 : 0.18) + i / 5 + seed * 5.1) % 1;
      const s = sz * (steam ? 1.0 : 1.2) + ph * (steam ? 40 : 30) * k;
      dark.add(x + ph * ph * 60 * k, y + ph * (steam ? 90 : 120) * k, z + ph * 16 * k, ph * 2 + seed, s, s, steam ? STEAM : SMOKE, (1 - ph) * Math.min(1, ph * 8) * (steam ? 0.22 : 0.28), DarkShape.Soft);
    }
  }

  private updateCraters() {
    const cr = CITY.craters;
    const g = this.craterSig, b0 = cr.length ? cr[0].born : 0, b1 = cr.length ? cr[cr.length - 1].born : 0;
    if (g[0] === cr.length && g[1] === b0 && g[2] === b1) return;
    g[0] = cr.length; g[1] = b0; g[2] = b1;
    const a = this.craters.attrs.aK, n = Math.min(MAX_CRATER, cr.length);
    for (let i = 0; i < n; i++) { const c = cr[cr.length - n + i]; a.setXYZW(i, this.X(c.x), this.Z(c.cy), this.R(c.r), c.born); }
    a.needsUpdate = true; this.craters.g.instanceCount = n;
  }

  /** Cloud deck between the city and the ship: soft dark quads with altitude parallax. */
  private updateClouds(cl: Cloud[]) {
    const e = this.engine, cam = e.camPos;
    for (let i = 0; i < cl.length; i++) {
      const c = cl[i];
      e.toFlight(c.x, c.y, 0, v);
      const s = (cam.y - c.alt) / (cam.y - FLIGHT);
      const x = cam.x + (v.x - cam.x) * s, z = cam.z + (v.z - cam.z) * s;
      e.dark.add(x, c.alt, z, c.seed, c.w * s, c.h * s, CLOUD, c.a * 0.3, DarkShape.Soft);
      e.dark.add(x + c.w * s * 0.25, c.alt + 2, z - c.h * s * 0.15, c.seed + 1, c.w * s * 0.6, c.h * s * 0.7, CLOUD, c.a * 0.25, DarkShape.Soft);
    }
  }

  private updateBeams(S: FrameCtx['S'], dt: number) {
    const e = this.engine, scrollZ = this.root.position.z, t = CITY.time;
    let bi = 0;
    for (const a of this.anchors) {
      if (bi >= this.beams.length) break;
      if (a.b?.dead) continue;
      const wz = a.z + scrollZ;
      const fy = (wz - this.cz) / this.k + FIELD_H / 2 + this.cz;
      if (fy < -260 || fy > FIELD_H + 120) continue;
      const fade = Math.min(1, (fy + 260) / 200, (FIELD_H + 120 - fy) / 160);
      const beam = this.beams[bi], aim = this.beamAim[bi], mat = this.beamMats[bi]; bi++;
      // Sweep the sky; when the dreadnought is close, hunt for it.
      const P = S.P;
      const sx = Math.sin(t * 0.37 + a.phase) * 520, sz = Math.cos(t * 0.29 + a.phase * 1.3) * 300 - 200;
      if (P) {
        e.toFlight(P.x, P.y, -60, w);
        const track = 0.5 + 0.5 * Math.sin(t * 0.21 + a.phase * 2);
        w.x += sx * (1 - track * 0.85); w.z += sz * (1 - track * 0.85);
      } else w.set(sx * 1.6, FLIGHT - 100, -500 + sz);
      if (aim.lengthSq() === 0) aim.copy(w); else aim.lerp(w, Math.min(1, dt * 1.2));
      v.set(a.x, a.y, wz);
      w.subVectors(aim, v); const L = w.length(); w.divideScalar(L);
      q.setFromUnitVectors(UP, w);
      beam.position.copy(v); beam.quaternion.copy(q); beam.scale.set(L * 0.032, L, L * 0.032);
      beam.visible = true; mat.uniforms.uA.value = 0.7 * fade * (0.85 + 0.15 * Math.sin(t * 13 + a.phase));
      e.glow.add(v.x, v.y + 1, v.z, 0, 22 * this.k, 22 * this.k, SEARCH, 0.9 * fade, Shape.Hot);
    }
    for (; bi < this.beams.length; bi++) { this.beams[bi].visible = false; this.beamAim[bi].set(0, 0, 0); }
  }
}
