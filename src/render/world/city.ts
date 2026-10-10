// World layer: the biome far below the flight plane (night city, harbour, airbase, desert, mountains, forest).
// Stylized on purpose: dark masses whose only detail is light — window grids, runway and street lamps, flares,
// moonlit faces on dunes and ridges — plus fires, smoke, rubble and craters from the fighting. Data comes from
// src/game/worldgen.ts (structures), terrain.ts (the ground) and biomegen.ts (what stands on it).
//
// Draw calls: terrain ground, flats (pads, streets, road segments), buildings x3 (box, cylinder, dome geometry),
// props, lights, traffic, craters, plus up to four searchlight beams. Every batch is a global instanced batch in
// city space under one scrolled root group, refilled only when a row enters or leaves (every couple of seconds);
// per frame the CPU only touches buildings whose damage state changed and pushes a few dozen quads (boats, convoys,
// smoke) into the engine's shared glow/dark batches. No per-frame allocation.
import * as THREE from 'three';
import type { Engine, FrameCtx, Layer } from '../engine';
import { FIELD_W, FIELD_H, FLIGHT } from '../engine';
import { THEMES } from '../palette';
import { rgb, Shape, DarkShape } from '../fx/quads';
import { CITY, DARK, STOREY, CITY_K, bGeo, type Bldg, type Cloud, type Surface, type Mover } from '../../game/worldgen';
import { TERR, FIRE, Burn, BURN_T, fireCellCy, fireCellX, highwayX, valleyX, riverX, pathX } from '../../game/terrain';
import { Biome } from '../../game/biomes';
import { U, darkTex, terrTex, fireTex, buildingMaterial, lightMaterial, trafficMaterial, craterMaterial, beamMaterial, terrainMaterial } from './shaders';

const MAX_BLD = 12288, MAX_RND = 2048, MAX_FLAT = 14336, MAX_PROP = 8192, MAX_LIGHT = 12288, MAX_CARS = 2048, MAX_CRATER = 96;
/** Detail sizes authored for the old ground scale shrink with the city (see worldgen CITY_K). */
const CK = CITY_K;
const v = new THREE.Vector3(), w = new THREE.Vector3(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
const SMOKE = rgb('#25242a'), STEAM = rgb('#5d5c63'), FIRE_A = rgb('#ff8a2a'), FIRE_B = rgb('#ffcf6a'), EMBER = rgb('#ff5a1a');
const CLOUD = rgb('#3c4250'), SEARCH = rgb('#cfe2ff'), FOAM = rgb('#9fb6cc'), HULL = rgb('#07090c'), HEAD = rgb('#ffe2b0'), TAIL = rgb('#ff9a40'), MAST = rgb('#f2f6ff'), BEAM_C = rgb('#d8e6ff'), ICE_STEAM = rgb('#8a96a6');

/** Ground surfaces (stylized: near-black with a hint of the zone). */
const SURF: Record<Surface, string> = {
  walk: '#1c1f24', plaza: '#24262b', grass: '#141c15', park: '#111a12', lot: '#17191c', gravel: '#1f1f1f', yard: '#1b1c1c',
  dock: '#1f2124', rail: '#16130f', ash: '#1f1b1a', snow: '#2a3038', dirt: '#1d1912', bund: '#1a1918',
  runway: '#202328', taxi: '#1b1d21', apron: '#2c2f33', concrete: '#212326', mark: '#6a6e73', pitch: '#1c3a20', sand: '#2a241b',
  road: '#101113', snowroad: '#262c35', basin: '#04070b', berm: '#1a1814', pad: '#252629', deck: '#1a1c1f',
};
const STYLE_TINT: number[][] = [
  // [hue, sat, light] ranges per Style: dark blocks with a little colour of the material.
  [0.03, 0.18, 0.13], [0.6, 0.04, 0.15], [0.58, 0.06, 0.14], [0.58, 0.18, 0.12], [0.5, 0.2, 0.11],
  [0.08, 0.1, 0.12], [0.07, 0.14, 0.15], [0.05, 0.05, 0.05], [0.07, 0.06, 0.16],
  [0.08, 0.2, 0.16], [0.58, 0.05, 0.13], [0.6, 0.03, 0.4], [0.6, 0.08, 0.08],
];
const CONTAINERS = ['#5a2a1e', '#1f3550', '#2c4a46', '#5c4a24', '#6a6e72', '#3a2f45', '#2a3a2a'].map((h) => new THREE.Color(h));
/** Ground palettes per biome (linear): flat ground, moonlit faces, canopy, canopy highlight, water, params. */
const GROUND: number[][][] = [
  /* City */ [[0.018, 0.019, 0.022], [0.006, 0.007, 0.009], [0.01, 0.016, 0.011], [0.01, 0.02, 0.012], [0.004, 0.007, 0.012], [0, 0, 0.3]],
  /* Port */ [[0.02, 0.021, 0.023], [0.014, 0.016, 0.02], [0.01, 0.016, 0.011], [0.012, 0.022, 0.014], [0.003, 0.006, 0.011], [0, 3, 0.4]],
  /* Airfield */ [[0.022, 0.026, 0.02], [0.012, 0.015, 0.012], [0.008, 0.013, 0.008], [0.01, 0.019, 0.011], [0.004, 0.007, 0.012], [0, 3, 0.4]],
  /* Desert */ [[0.046, 0.035, 0.024], [0.055, 0.05, 0.045], [0.012, 0.017, 0.01], [0.012, 0.02, 0.01], [0.004, 0.006, 0.008], [0, 1, 0.6]],
  /* Snow */ [[0.075, 0.09, 0.118], [0.11, 0.14, 0.2], [0.006, 0.01, 0.011], [0.014, 0.024, 0.028], [0.02, 0.03, 0.045], [1, 2, 0.6]],
  /* Forest */ [[0.016, 0.019, 0.012], [0.008, 0.011, 0.007], [0.005, 0.009, 0.006], [0.012, 0.026, 0.014], [0.003, 0.006, 0.01], [0, 3, 0.6]],
];
const LIGHT_COL: THREE.Color[] = [];

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
/** One geometry of buildings (box, cylinder or dome) with the per-instance state the building shader reads. */
class BldBatch {
  mesh: THREE.InstancedMesh; aB: THREE.InstancedBufferAttribute; aS: THREE.InstancedBufferAttribute; n = 0;
  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, public max: number) {
    this.aB = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.aS = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4); this.aS.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aB', this.aB); geo.setAttribute('aS', this.aS);
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    Object.assign(this.mesh, { count: 0, frustumCulled: false, receiveShadow: true });
  }
  done() {
    const m = this.mesh; m.count = this.n; m.instanceMatrix.needsUpdate = true; m.instanceColor!.needsUpdate = true;
    this.aB.needsUpdate = true; this.aS.clearUpdateRanges(); this.aS.needsUpdate = true;
  }
}

export class CityLayer implements Layer {
  name = 'city';
  root = new THREE.Group();
  ground: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  /** Buildings by geometry: 0 box, 1 cylinder (tanks, stacks, rockets), 2 dome (radomes, igloos). */
  bld: BldBatch[];
  flats: THREE.InstancedMesh; props: THREE.InstancedMesh;
  lights = quadBatch(MAX_LIGHT, ['aL', 'aC', 'aK'], lightMaterial());
  cars = quadBatch(MAX_CARS, ['aT', 'aC'], trafficMaterial());
  craters = quadBatch(MAX_CRATER, ['aK'], craterMaterial());
  beams: THREE.Mesh[] = []; beamMats: THREE.ShaderMaterial[] = []; beamAim: THREE.Vector3[] = [];
  anchors: Anchor[] = []; fires: Spot[] = []; stacks: Spot[] = []; sweeps: Spot[] = [];
  /** Lights that belong to a building (roof beacons, flares): light index -> building. */
  bLights: { i: number; b: Bldg }[] = [];
  gen = -1; darkVer = -1; terrVer = -1; fireVer = -1;
  /** Change detection without per-frame strings: [gen, rows, first id, last id] and [craters, first born, last born]. */
  private sig = [NaN, 0, 0, 0]; private craterSig = [NaN, 0, 0];
  private k = 1; private cz = 0; private nL = 0;

  constructor(private engine: Engine) {
    const e = engine;
    if (import.meta.env.DEV) (window as unknown as { __cityLayer: unknown }).__cityLayer = this;
    this.k = e.groundScale; this.cz = e.camPos.z;
    U.uDarkMap.value.set(DARK.x0, DARK.cell, this.k, this.cz);
    U.uK.value = this.k; U.uFloor.value = STOREY * this.k;
    if (!LIGHT_COL.length) {
      for (const [h, m] of [['#ffae48', 2.6], ['#f0f4ff', 2.6], ['#ffb347', 2.4], ['#5a86ff', 3.0], ['#7ef0c8', 2.2], ['#ffc98a', 2.4], ['#e4ecff', 2.6], ['#ff8a2a', 2.4]] as const) LIGHT_COL.push(new THREE.Color(h).multiplyScalar(m));
    }
    e.scene.add(this.root);
    CITY.camH = e.camPos.y; CITY.groundK = this.k;
    const cam = e.camPos;
    CITY.project = (x, y, alt, out) => {
      e.toGround(x, y, v); v.y = alt * this.k;
      const s = (cam.y - FLIGHT) / (cam.y - v.y);
      out.x = cam.x + (v.x - cam.x) * s + FIELD_W / 2; out.y = cam.z + (v.z - cam.z) * s + FIELD_H / 2;
      return out;
    };

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(12000, 9000).rotateX(-Math.PI / 2), terrainMaterial());
    const mid = e.toGround(FIELD_W / 2, FIELD_H / 2);
    this.ground.position.set(mid.x, -0.5, mid.z); this.ground.receiveShadow = true;
    e.scene.add(this.ground);

    this.flats = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0.05 }), MAX_FLAT);
    this.flats.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_FLAT * 3), 3);
    Object.assign(this.flats, { count: 0, frustumCulled: false, receiveShadow: true });

    const mat = buildingMaterial();
    const dome = new THREE.SphereGeometry(0.5, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 2, 1);
    dome.computeVertexNormals();
    this.bld = [
      new BldBatch(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), mat, MAX_BLD),
      new BldBatch(new THREE.CylinderGeometry(0.5, 0.5, 1, 12).translate(0, 0.5, 0), mat, MAX_RND),
      new BldBatch(dome, mat, MAX_RND),
    ];

    this.props = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.2 }), MAX_PROP);
    this.props.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PROP * 3), 3);
    Object.assign(this.props, { count: 0, frustumCulled: false, receiveShadow: true });

    this.craters.mesh.renderOrder = -1;
    this.root.add(this.flats, this.craters.mesh, ...this.bld.map((b) => b.mesh), this.props, this.lights.mesh);
    e.scene.add(this.cars.mesh);

    const beamGeo = new THREE.CylinderGeometry(1, 0.04, 1, 14, 1, true).translate(0, 0.5, 0);
    for (let i = 0; i < 4; i++) {
      const bm = beamMaterial();
      const b = new THREE.Mesh(beamGeo, bm); b.frustumCulled = false; b.visible = false; b.renderOrder = 1;
      e.scene.add(b); this.beams.push(b); this.beamMats.push(bm); this.beamAim.push(new THREE.Vector3());
    }
  }

  clear() { /* the world persists between screens */ }

  private X = (x: number) => (x - 800) * this.k;
  private Z = (cy: number) => this.cz + (cy - 450 - this.cz) * this.k;
  private R = (h: number) => h * this.k;

  /** New seed or biome: colours, the ground palettes and the traffic loop. */
  private reseed() {
    this.gen = CITY.gen; this.sig[0] = NaN;
    const e = this.engine, a = CITY.biomeA, b = CITY.biomeB >= 0 ? CITY.biomeB : a;
    const th = THEMES[a % THEMES.length];
    U.uWinCol.value.set(th.window);
    U.uLampCol.value.set(a === Biome.Snow ? '#ffc890' : a === Biome.Desert ? '#ff9a3a' : '#ffae48');
    for (let i = 0; i < 6; i++) { U.uPA.value[i].fromArray(GROUND[a][i]); U.uPB.value[i].fromArray(GROUND[b][i]); }
    U.uCityW.value = a === Biome.City ? 1 : CITY.biomeB === Biome.City ? -1 : 0;
    this.ground.material.color.set(0xffffff);
    e.renderer.setClearColor(th.fog);
    const fog = e.scene.fog as THREE.Fog; fog.color.set(th.fog); fog.near = 3400; fog.far = 7400;
    // Traffic on the night city's avenues: lanes loop over the visible stretch and ride the scroll.
    const zTop = e.toGround(0, -420, v).z, zBot = e.toGround(0, FIELD_H + 160, w).z, L = zBot - zTop;
    U.uLoop.value.set(zTop, L);
    const { aT, aC } = this.cars.attrs;
    let n = 0;
    if (CITY.plan) for (const av of CITY.plan.aves) {
      const lanes = av.major ? 4 : 2, wid = this.R((av.x1 - av.x0) * CK), cx = this.X(800 + ((av.x0 + av.x1) / 2 - 800) * CK);
      for (let i = 0; i < lanes; i++) {
        const dir = i < lanes / 2 ? 1 : -1, off = ((i % (lanes / 2)) + 0.5) * (wid / lanes) * (dir > 0 ? 1 : -1) * 0.9;
        // From this altitude traffic is a faint drift of light along the avenues, not individual cars.
        const cars = Math.round(L / (av.major ? 260 : 520));
        for (let c = 0; c < cars && n < MAX_CARS; c++, n++) {
          aT.setXYZW(n, cx + off, Math.random() * L, dir * this.R((av.major ? 60 + Math.random() * 30 : 40 + Math.random() * 25) * CK), this.R(9 * CK));
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
  /** A strip from (x0, cy0) to (x1, cy1), w wide. */
  private strip(n: number, x0: number, y0: number, x1: number, y1: number, wd: number, y: number, c: THREE.Color) {
    if (n >= MAX_FLAT) return n;
    const dx = this.R(x1 - x0), dz = this.R(y1 - y0), len = Math.hypot(dx, dz) + this.R(wd) * 0.3;
    m4.compose(v.set(this.X((x0 + x1) / 2), y, this.Z((y0 + y1) / 2)), q.setFromAxisAngle(UP, -Math.atan2(dz, dx)), s3.set(len, 1, this.R(wd)));
    this.flats.setMatrixAt(n, m4); this.flats.setColorAt(n, c);
    return n + 1;
  }

  /** Refill every batch from the rows currently alive (runs when a row enters or leaves). */
  private rebuild() {
    const R = this.R, X = this.X, Z = this.Z, lamp = U.uLampCol.value;
    let nf = 0, np = 0; this.nL = 0;
    for (const bb of this.bld) bb.n = 0;
    this.anchors.length = 0; this.fires.length = 0; this.stacks.length = 0; this.bLights.length = 0; this.sweeps.length = 0;
    const road = new THREE.Color(THEMES[0].dec).multiplyScalar(0.5), water = new THREE.Color('#04070b');
    const lampHot = lamp.clone().multiplyScalar(2.2), white = new THREE.Color('#e8eeff').multiplyScalar(1.6), amber = new THREE.Color('#ffb347').multiplyScalar(1.8);
    const surf: Record<string, THREE.Color> = {};
    for (const key in SURF) surf[key] = new THREE.Color(SURF[key as Surface]);
    for (const ch of CITY.chunks) {
      for (const wt of ch.water) nf = this.flat(nf, wt.x0, wt.y0, wt.x1, wt.y1, 0.1, water);
      for (const p of ch.pads) nf = this.flat(nf, p.x0, p.y0, p.x1, p.y1, p.s === 'mark' ? 0.55 : 0.4, surf[p.s]);
      for (const s of ch.segs) nf = this.strip(nf, s.x0, s.cy0, s.x1, s.cy1, s.w, s.s === 'mark' ? 0.55 : 0.45, surf[s.s]);
      for (const r of ch.roads) {
        nf = this.flat(nf, r.x0, r.y0, r.x1, r.y1, 0.8, road);
        // The street itself glows with its lamps: from this high the grid reads as faint lines of
        // light between dark blocks (kept dim: the city is the backdrop, never the subject).
        if (r.dir === 0) this.light(X((r.x0 + r.x1) / 2), 1.2, Z((r.y0 + r.y1) / 2), R((r.x1 - r.x0) * 1.6), lamp, r.major ? 0.11 : 0.06, 5, 0, R(r.y1 - r.y0), 0);
        else this.light(X((r.x0 + r.x1) / 2), 1.2, Z((r.y0 + r.y1) / 2), R((r.y1 - r.y0) * 1.6), lamp, 0.06, 5, 0, R(r.x1 - r.x0), 1);
        // Lamp heads only along the major avenues, a pixel of sodium every so often.
        if (r.major && r.dir === 0) for (let y = r.y0 + 6; y < r.y1; y += 22) for (const x of [r.x0 + 0.6, r.x1 - 0.6]) this.light(X(x), R(1), Z(y), R(1.3), lampHot, 0.55, 0);
      }
      for (const b of ch.bldgs) {
        const geo = bGeo(b.kind), bb = this.bld[geo];
        if (b.tint) col.set(b.tint).multiplyScalar(0.55 + 0.25 * ((b.seed * 7.31) % 1));
        else {
          const st = STYLE_TINT[b.style] ?? STYLE_TINT[1];
          const h = (b.seed * 7.31) % 1, h2 = (b.seed * 13.7) % 1;
          col.setHSL(st[0] + (h - 0.5) * 0.05, st[1], st[2] * (0.5 + 0.4 * h2));
        }
        b.rg = geo; b.ri = bb.n; b.rn = 0;
        let top = b.tiers[0];
        const cr = Math.cos(b.rot), sr = Math.sin(b.rot);
        for (const t of b.tiers) {
          if (bb.n >= bb.max) break;
          if (t.z0 + t.hgt >= top.z0 + top.hgt) top = t;
          // Tier offsets turn with the building (field x right, city y down; rotation about the vertical).
          const ox = t.ox * cr + t.oy * sr, oy = -t.ox * sr + t.oy * cr;
          m4.compose(v.set(X(b.x + ox), R(t.z0), Z(b.cy + oy)), q.setFromAxisAngle(UP, b.rot), s3.set(R(t.w), R(t.hgt), R(t.h)));
          bb.mesh.setMatrixAt(bb.n, m4); bb.mesh.setColorAt(bb.n, col);
          bb.aB.setXYZW(bb.n, b.seed, b.lit, b.keepLit ? 1 : 0, b.style);
          bb.aS.setXYZW(bb.n, b.collapseT > 0 ? b.collapseT : 0, b.fire, b.neon, b.roof);
          bb.n++; b.rn++;
        }
        const roofY = R(top.z0 + top.hgt), cx = X(b.x + top.ox), cz = Z(b.cy + top.oy);
        if (b.kind === 'flare') { this.fires.push({ x: cx, y: roofY, z: cz, s: R(4), seed: b.seed, b }); continue; }
        if (b.kind === 'chimney' || b.kind === 'cooler') { this.stacks.push({ x: cx, y: roofY, z: cz, s: R(top.w * (b.kind === 'cooler' ? 0.7 : 1)), seed: b.seed, b }); }
        // Aviation beacons on the tall ones (white and amber: red is reserved for threats).
        if (b.hgt > 40 && !b.dead && b.kind !== 'rocket' && b.kind !== 'gantry') {
          const i = this.light(cx, roofY + R(0.6), cz, R(2.2), b.seed > 0.5 ? white : amber, 0.8, 3, b.seed * 7);
          if (i >= 0) this.bLights.push({ i, b });
        }
      }
      for (const L of ch.lights) {
        // Pinpoints are authored at their real size; from this altitude they need a couple of pixels to read.
        const pool = L.k === 1 || L.k === 4, sz = pool ? L.s : Math.max(2.8, L.s * 2.6);
        const i = this.light(X(L.x), R(L.h), Z(L.cy), R(sz), LIGHT_COL[L.c] ?? white, pool ? L.a * 2.6 : Math.min(0.85, 0.25 + L.a), L.k, L.p);
        if (L.b && i >= 0) this.bLights.push({ i, b: L.b });
        if (L.k === 8) this.sweeps.push({ x: X(L.x), y: R(L.h), z: Z(L.cy), s: R(L.s), seed: L.p, b: L.b });
      }
      for (const p of ch.props) {
        const x = X(p.x), z = Z(p.cy);
        switch (p.k) {
          case 'lamp': this.light(x, R(p.h || 1), z, R(1.3), lampHot, 0.6, p.v > 0.5 ? 2 : 0); this.light(x, 1.4, z, R(5), lamp, 0.1, 1); break;
          case 'tree': np = this.box(np, x, 0, z, R(p.w), R(p.h), R(p.w), 0, col.setHSL(0.3, 0.25, p.v > 0.9 ? 0.03 : 0.06 + p.v * 0.03)); break;
          case 'container': np = this.box(np, x, 0, z, R(p.w), R(p.h), R(p.d), p.rot, CONTAINERS[Math.floor(p.v * CONTAINERS.length)].clone().multiplyScalar(0.5)); break;
          case 'railcar': case 'loco': np = this.box(np, x, 0, z, R(p.w), R(p.h), R(p.d), 0, col.setHSL(0.06, 0.2, 0.08 + p.v * 0.05)); break;
          case 'pipe': np = this.box(np, x, R(2), z, R(p.w), R(p.h), R(p.d), 0, col.setHSL(0.08, 0.1, 0.16)); break;
          case 'logs': np = this.box(np, x, 0, z, R(p.w), R(p.h), R(p.d), p.rot, col.setHSL(0.07, 0.35, 0.07 + p.v * 0.04)); break;
          case 'rubble': case 'hulk': np = this.box(np, x, 0, z, R(p.w), R(p.h), R(p.d), p.rot, col.setHSL(0.05, 0.05, 0.07)); break;
          case 'pylon': np = this.box(np, x, 0, z, R(0.5), R(p.h), R(0.5), 0, col.setHSL(0.6, 0.05, 0.12)); break;
          case 'crane': {
            np = this.box(np, x, 0, z, R(4 * CK), R(p.h), R(4 * CK), 0, col.setHSL(0.09, 0.5, 0.2));
            np = this.box(np, x - R(16 * CK), R(p.h - 4 * CK), z, R(46 * CK), R(2.5 * CK), R(3 * CK), 0, col.setHSL(0.09, 0.5, 0.2));
            this.light(x - R(38 * CK), R(p.h - 2 * CK), z, R(1.6), amber, 0.7, 3, p.v * 5);
            break;
          }
          case 'searchlight': this.anchors.push({ x, z, y: R(p.h) + 1, phase: p.v * 10, b: p.on }); break;
          case 'fire': this.fires.push({ x, y: 1, z, s: R(p.w), seed: p.v }); break;
        }
      }
    }
    for (const bb of this.bld) bb.done();
    this.flats.count = nf; this.flats.instanceMatrix.needsUpdate = true; this.flats.instanceColor!.needsUpdate = true;
    this.props.count = np; this.props.instanceMatrix.needsUpdate = true; this.props.instanceColor!.needsUpdate = true;
    for (const n in this.lights.attrs) this.lights.attrs[n].needsUpdate = true;
    this.lights.g.instanceCount = this.nL;
    for (const bl of this.bLights) if (bl.b.dead) this.lights.attrs.aC.setW(bl.i, 0);
  }

  /** Push a building's damage state into its instances. */
  private apply(b: Bldg) {
    if (b.ri < 0) return;
    const bb = this.bld[b.rg], ct = b.collapseT > 0 ? b.collapseT : 0;
    for (let i = b.ri; i < b.ri + b.rn; i++) { bb.aS.setX(i, ct); bb.aS.setY(i, b.fire); }
    bb.aS.addUpdateRange(b.ri * 4, b.rn * 4); bb.aS.needsUpdate = true;
    if (b.dead) for (const bl of this.bLights) if (bl.b === b) { this.lights.attrs.aC.setW(bl.i, 0); this.lights.attrs.aC.needsUpdate = true; }
  }

  update({ S, dt, engine: e }: FrameCtx) {
    if (!CITY.seeded) return;
    if (this.gen !== CITY.gen) this.reseed();
    const chs = CITY.chunks;
    const g = this.sig, first = chs.length ? chs[0].id : 0, last = chs.length ? chs[chs.length - 1].id : 0;
    if (g[0] !== CITY.gen || g[1] !== chs.length || g[2] !== first || g[3] !== last) { g[0] = CITY.gen; g[1] = chs.length; g[2] = first; g[3] = last; this.rebuild(); }
    const k = this.k, scrollZ = S.scrollY * k, t = CITY.time;
    this.root.position.z = scrollZ;
    U.uTime.value = t; U.uScrollZ.value = scrollZ;
    if (this.darkVer !== DARK.ver) { this.darkVer = DARK.ver; darkTex.needsUpdate = true; }
    if (this.terrVer !== TERR.ver) { this.terrVer = TERR.ver; terrTex.needsUpdate = true; }
    if (this.fireVer !== FIRE.ver) { this.fireVer = FIRE.ver; fireTex.needsUpdate = true; }
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
        // Flare stack: a tall standing flame and the orange wash it throws on the ground.
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
    // Lighthouses sweep their beams across the water.
    for (const s of this.sweeps) {
      if (s.b?.dead) continue;
      const fy = (s.z + scrollZ - this.cz) / k + 450 + this.cz;
      if (fy < -300 || fy > FIELD_H + 100) continue;
      const a = t * 0.8 + s.seed * 6, L = this.R(170);
      for (const o of [0, Math.PI]) {
        const ca = Math.cos(a + o), sa = Math.sin(a + o);
        glow.add(s.x + ca * L * 0.5, s.y, s.z + scrollZ + sa * L * 0.5, a + o, L, this.R(14), BEAM_C, 0.06, Shape.Soft);
      }
    }
    this.updateMovers(glow, dark, S.scrollY, t);
    this.updateGroundFires(glow, dark, S.scrollY, t);
    this.updateCraters();
    this.updateClouds(S.clouds as Cloud[]);
    this.updateBeams(S, dt);
  }

  /** Boats with wakes, convoys and cars with headlights: a few quads each, drawn from their paths and the clock. */
  private updateMovers(glow: Engine['glow'], dark: Engine['dark'], scrollY: number, t: number) {
    const R = this.R;
    for (const ch of CITY.chunks) for (const m of ch.movers) {
      const d = (t - m.t0) * m.v;
      let x: number, cy: number, hx: number, hy: number;
      if (m.path === 0) { x = m.x + Math.cos(m.a) * d; cy = m.cy + Math.sin(m.a) * d; hx = Math.cos(m.a); hy = Math.sin(m.a); }
      else {
        cy = m.cy + d;
        const off = m.x - moverPath(m, m.cy), s = Math.sign(m.v) || 1;
        x = moverPath(m, cy) + off;
        hx = (moverPath(m, cy + s) - moverPath(m, cy)); hy = s;
        const l = Math.hypot(hx, hy); hx /= l; hy /= l;
      }
      const fy = cy + scrollY;
      if (fy < -120 || fy > FIELD_H + 120 || x < -300 || x > FIELD_W + 300) continue;
      const wx = this.X(x), wz = this.Z(cy) + scrollY * this.k, rot = Math.atan2(hy, hx);
      if (m.k === 'convoy' || m.k === 'car') {
        for (let i = 0; i < m.n; i++) {
          const bx = wx - hx * R(i * 6), bz = wz - hy * R(i * 6);
          glow.add(bx + hx * R(1.2), 1.2, bz + hy * R(1.2), rot, R(1.6), R(1.1), HEAD, 0.55, Shape.Hot);
          glow.add(bx + hx * R(4.5), 0.9, bz + hy * R(4.5), rot, R(6), R(2.4), HEAD, 0.07, Shape.Soft);
          glow.add(bx - hx * R(1.4), 1.0, bz - hy * R(1.4), rot, R(0.8), R(0.8), TAIL, 0.22, Shape.Hot);
        }
        continue;
      }
      // Vessels: dark hull, a white mast light, a V of foam behind and a churned centre wake.
      const len = m.k === 'ship' ? m.len : m.k === 'barge' ? m.len : m.len, beam = Math.max(2, len * (m.k === 'ship' ? 0.14 : 0.36));
      dark.add(wx, 0.7, wz, rot, R(len), R(beam), HULL, 0.95, DarkShape.Rect);
      const sx = wx - hx * R(len * 0.5), sz = wz - hy * R(len * 0.5);
      const wl = R(len * (m.k === 'ship' ? 2.2 : 3.2) + 20), ww = R(beam * 0.5 + 1.4);
      for (const side of [-1, 1]) {
        const a2 = rot + Math.PI + side * 0.32, c2 = Math.cos(a2), s2 = Math.sin(a2);
        glow.add(sx + c2 * wl * 0.5, 0.6, sz + s2 * wl * 0.5, a2, wl, ww, FOAM, 0.075, Shape.Soft);
      }
      glow.add(sx - hx * wl * 0.35, 0.6, sz - hy * wl * 0.35, rot, wl * 0.8, R(beam * 0.9), FOAM, 0.1, Shape.Soft);
      glow.add(wx + hx * R(len * 0.5), 0.6, wz + hy * R(len * 0.5), rot, R(beam * 0.8), R(beam * 1.2), FOAM, 0.16, Shape.Soft);
      glow.add(wx + hx * R(len * 0.3), R(3), wz + hy * R(len * 0.3), 0, R(1.2), R(1.2), MAST, 0.7, Shape.Hot);
      glow.add(sx, R(2), sz, 0, R(1), R(1), TAIL, 0.35, Shape.Hot);
    }
  }

  /** Smoke over the wildfire and burning oil, steam off broken ice (a sample of cells; flames are in the ground shader). */
  private updateGroundFires(glow: Engine['glow'], dark: Engine['dark'], scrollY: number, t: number) {
    const act = FIRE.active, k = this.k, refCy = -scrollY + FIELD_H / 2;
    const stride = Math.max(1, Math.ceil(act.length / 70));
    for (let j = 0; j < act.length; j += stride) {
      const i = act[j], t0 = FIRE.data[i * 2], kind = FIRE.data[i * 2 + 1], age = t - t0, dur = BURN_T[kind] ?? 10;
      if (age < 0 || age > dur) continue;
      const cy = fireCellCy(i, refCy), fy = cy + scrollY;
      if (fy < -100 || fy > FIELD_H + 60) continue;
      const x = this.X(fireCellX(i)), z = this.Z(cy) + scrollY * k, seed = (i * 0.618) % 1;
      if (kind === Burn.Ice) {
        for (let n = 0; n < 2; n++) {
          const ph = (t * 0.3 + n / 2 + seed * 3) % 1, s = this.R(8 + ph * 26);
          dark.add(x + ph * this.R(12), 2 + ph * this.R(30), z + ph * this.R(6), ph * 2 + seed, s, s, ICE_STEAM, (1 - ph) * Math.min(1, ph * 6) * 0.22 * (1 - age / dur), DarkShape.Soft);
        }
        continue;
      }
      const on = Math.min(1, age / 1.2) * (1 - Math.max(0, (age - dur * 0.55) / (dur * 0.45)));
      if (on <= 0.05) continue;
      glow.add(x, 2, z, 0, this.R(FIRE.cell * 2.2), this.R(FIRE.cell * 2.2), EMBER, 0.05 * on, Shape.Soft);
      const oil = kind === Burn.Oil;
      for (let n = 0; n < (oil ? 3 : 2); n++) {
        const ph = (t * (oil ? 0.16 : 0.22) + n / 3 + seed * 5) % 1;
        const h = 2 + ph * 150 * k * (oil ? 1.2 : 0.8), s = this.R(10) + ph * 40 * k * (oil ? 1.3 : 1);
        dark.add(x + ph * ph * 60 * k, h, z + ph * 24 * k, ph * 3 + seed, s, s, SMOKE, (1 - ph) * Math.min(1, ph * 10) * (oil ? 0.42 : 0.26) * on, DarkShape.Soft);
      }
    }
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

  /** Cloud deck between the world and the ship: soft dark quads with altitude parallax. */
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
      beam.visible = true; mat.uniforms.uA.value = 0.3 * fade * (0.85 + 0.15 * Math.sin(t * 13 + a.phase));
      e.glow.add(v.x, v.y + 1, v.z, 0, 10 * this.k, 10 * this.k, SEARCH, 0.5 * fade, Shape.Hot);
    }
    for (; bi < this.beams.length; bi++) { this.beams[bi].visible = false; this.beamAim[bi].set(0, 0, 0); }
  }
}

/** x of a path mover's road or river at city y (see worldgen Mover.path). */
function moverPath(m: Mover, cy: number) {
  switch (m.path) {
    case 1: return highwayX(cy);
    case 2: return valleyX(cy);
    case 3: return riverX(cy);
    default: return pathX(1120, 300, 0, cy);
  }
}
