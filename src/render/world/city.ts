// City layer: the night city far below the flight plane, its traffic, searchlights, fires, craters
// and the cloud deck between it and the dreadnought. Data comes from src/game/worldgen.ts; this
// layer turns each generated row into instanced meshes (chunk.ts), scrolls them with one root
// transform and applies damage-state changes sparsely. Per-frame work is allocation-free.
import * as THREE from 'three';
import type { Engine, FrameCtx, Layer } from '../engine';
import { FIELD_W, FIELD_H, FLIGHT } from '../engine';
import { THEMES } from '../palette';
import { rgb, Shape, DarkShape } from '../fx/quads';
import { CITY, DARK, FLOOR, type Chunk, type Bldg, type Cloud } from '../../game/worldgen';
import { U, darkTex, GLSL_COMMON } from './materials';
import { makeKit, type CityKit } from './kit';
import { buildChunk, rubbleMatrix, type ChunkView } from './chunk';
import { TrafficBuilder } from './lights';

const v = new THREE.Vector3(), w = new THREE.Vector3(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0), ZERO = new THREE.Matrix4().makeScale(0, 0, 0), tmpCol = new THREE.Color();
const SMOKE = rgb('#25242a'), STEAM = rgb('#5d5c63'), FIRE_A = rgb('#ff8a2a'), FIRE_B = rgb('#ffcf6a'), EMBER = rgb('#ff5a1a');

/* ---------------- searchlight beams ---------------- */
const BEAM_VS = /* glsl */ `
varying float vT; varying vec3 vN; varying vec3 vV;
void main(){
  vT = clamp(position.y, 0.0, 1.0);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const BEAM_FS = /* glsl */ `
uniform vec3 uCol; uniform float uA;
varying float vT; varying vec3 vN; varying vec3 vV;
void main(){
  float f = pow(abs(dot(normalize(vN), normalize(vV))), 2.0);
  float a = pow(1.0 - vT, 1.6) * smoothstep(0.0, 0.03, vT) * f * uA;
  gl_FragColor = vec4(uCol * a, 1.0);
}`;
/* ---------------- clouds ---------------- */
const CLOUD_VS = /* glsl */ `
attribute vec4 aC0; attribute vec4 aC1;   // centre xyz, seed | width, depth, alpha, high
varying vec2 vUv; varying vec4 vC1; varying float vSeed;
void main(){ vUv = uv; vC1 = aC1; vSeed = aC0.w;
  vec3 p = aC0.xyz + vec3(position.x * aC1.x, 0.0, position.z * aC1.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }`;
const CLOUD_FS = /* glsl */ `
uniform vec3 uCloudLo; uniform vec3 uCloudHi;
varying vec2 vUv; varying vec4 vC1; varying float vSeed;
void main(){
  vec2 p = vUv * 2.0 - 1.0;
  vec2 q = vUv * vec2(vC1.x, vC1.y) / 260.0 + vSeed;
  float t = uTime * 0.01;
  float n = fbm(q * 1.4 + vec2(t, 0.0)) * 0.65 + fbm(q * 3.7 - vec2(0.0, t * 2.0)) * 0.35;
  float shape = 1.0 - smoothstep(0.35, 1.0, length(p * vec2(1.0, 1.15)) + (n - 0.5) * 0.7);
  float d = smoothstep(0.35, 0.85, n * shape + shape * 0.25);
  if (d < 0.005) discard;
  vec3 col = mix(uCloudLo, uCloudHi, smoothstep(0.2, 1.0, d) * (0.6 + 0.4 * n));
  gl_FragColor = vec4(col, d * vC1.z);
}`;
/* ---------------- craters ---------------- */
const CRATER_VS = /* glsl */ `
attribute vec4 aK;   // x, z (chunk space), radius, born
varying vec2 vUv; varying float vAge; varying float vSeed;
void main(){ vUv = uv; vAge = uTime - aK.w; vSeed = aK.x * 0.013 + aK.y * 0.007;
  vec3 p = vec3(aK.x + position.x * aK.z * 2.0, 0.9, aK.y + position.z * aK.z * 2.0);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 1.0); }`;
const CRATER_FS = /* glsl */ `
varying vec2 vUv; varying float vAge; varying float vSeed;
void main(){
  vec2 p = vUv * 2.0 - 1.0; float r = length(p);
  float n = vnoise(p * 4.0 + vSeed * 10.0);
  float rr = r + (n - 0.5) * 0.25;
  float scorch = (1.0 - smoothstep(0.35, 1.0, rr)) * 0.9;
  float bowl = 1.0 - smoothstep(0.0, 0.45, rr);
  float rim = smoothstep(0.32, 0.42, rr) * (1.0 - smoothstep(0.42, 0.55, rr));
  vec3 col = mix(vec3(0.02, 0.018, 0.016), vec3(0.09, 0.08, 0.075), rim);
  float a = max(scorch, rim * 0.9);
  float hot = exp(-vAge * 0.35);
  float em = smoothstep(0.6, 0.85, vnoise(p * 9.0 + vSeed * 3.0)) * (1.0 - smoothstep(0.1, 0.6, rr)) * (0.4 + 0.6 * hot);
  col += vec3(1.0, 0.32, 0.06) * em * (0.75 + 0.25 * sin(uTime * 4.0 + n * 20.0)) * 2.0 + vec3(1.0, 0.45, 0.1) * bowl * hot * 0.6;
  gl_FragColor = vec4(col, clamp(a + em, 0.0, 1.0));
}`;

interface Anchor { x: number; z: number; y: number; phase: number; b?: Bldg; view: ChunkView }

export class CityLayer implements Layer {
  name = 'city';
  root = new THREE.Group();
  kit: CityKit;
  views = new Map<Chunk, ChunkView>();
  gen = -1; darkVer = -1;
  base: THREE.Mesh;
  avenues: THREE.Mesh | null = null;
  craters: THREE.Mesh; craterAttr: THREE.InstancedBufferAttribute; craterSig = '';
  clouds: THREE.Mesh; cloudA0: THREE.InstancedBufferAttribute; cloudA1: THREE.InstancedBufferAttribute;
  beams: THREE.Mesh[] = []; beamMats: THREE.ShaderMaterial[] = []; beamAim: THREE.Vector3[] = [];
  anchors: Anchor[] = [];
  trains: THREE.InstancedMesh; trainCars: { x: number; z0: number; len: number; speed: number; off: number; cars: number }[] = [];
  private k = 1; private cz = 0;

  constructor(private engine: Engine) {
    const e = engine;
    if (import.meta.env.DEV) (window as unknown as { __cityLayer: unknown }).__cityLayer = this;
    this.k = e.groundScale; this.cz = e.camPos.z;
    this.kit = makeKit(this.k, this.cz);
    U.uDarkMap.value.set(DARK.x0, DARK.cell, this.k, this.cz);
    e.scene.add(this.root);
    CITY.camH = e.camPos.y; CITY.groundK = this.k;
    const cam = e.camPos;
    CITY.project = (x, y, alt, out) => {
      e.toGround(x, y, v); v.y = alt * this.k;
      const s = (cam.y - FLIGHT) / (cam.y - v.y);
      out.x = cam.x + (v.x - cam.x) * s + FIELD_W / 2; out.y = cam.z + (v.z - cam.z) * s + FIELD_H / 2;
      return out;
    };

    // Ground under everything (follows the camera footprint, textured in city space).
    const bg = new THREE.PlaneGeometry(9000, 6000).rotateX(-Math.PI / 2);
    const nv = bg.attributes.position.count;
    bg.setAttribute('aG0', new THREE.BufferAttribute(new Float32Array(nv * 4).map((_, i) => (i % 4 === 0 ? 30 : i % 4 >= 2 ? 9000 : 0)), 4));
    bg.setAttribute('aG1', new THREE.BufferAttribute(new Float32Array(nv * 4), 4));
    this.base = new THREE.Mesh(bg, this.kit.mat.ground);
    const mid = e.toGround(FIELD_W / 2, FIELD_H / 2);
    this.base.position.set(mid.x, -0.4, mid.z); this.base.receiveShadow = true;
    e.scene.add(this.base);

    // Craters (alpha decals in city space).
    const cg = new THREE.InstancedBufferGeometry();
    const qd = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    cg.index = qd.index; cg.setAttribute('position', qd.attributes.position); cg.setAttribute('uv', qd.attributes.uv);
    this.craterAttr = new THREE.InstancedBufferAttribute(new Float32Array(96 * 4), 4); this.craterAttr.setUsage(THREE.DynamicDrawUsage);
    cg.setAttribute('aK', this.craterAttr); cg.instanceCount = 0;
    this.craters = new THREE.Mesh(cg, new THREE.ShaderMaterial({ uniforms: U, vertexShader: 'uniform float uTime;\n' + CRATER_VS, fragmentShader: GLSL_COMMON + CRATER_FS, transparent: true, depthWrite: false }));
    this.craters.frustumCulled = false; this.craters.renderOrder = -1;
    this.root.add(this.craters);

    // Cloud deck.
    const clg = new THREE.InstancedBufferGeometry();
    clg.index = qd.index; clg.setAttribute('position', qd.attributes.position); clg.setAttribute('uv', qd.attributes.uv);
    this.cloudA0 = new THREE.InstancedBufferAttribute(new Float32Array(32 * 4), 4); this.cloudA0.setUsage(THREE.DynamicDrawUsage);
    this.cloudA1 = new THREE.InstancedBufferAttribute(new Float32Array(32 * 4), 4); this.cloudA1.setUsage(THREE.DynamicDrawUsage);
    clg.setAttribute('aC0', this.cloudA0); clg.setAttribute('aC1', this.cloudA1); clg.instanceCount = 0;
    const cloudU = { ...U, uCloudLo: { value: new THREE.Color('#3a2a22') }, uCloudHi: { value: new THREE.Color('#6a7488') } };
    this.clouds = new THREE.Mesh(clg, new THREE.ShaderMaterial({ uniforms: cloudU, vertexShader: CLOUD_VS, fragmentShader: GLSL_COMMON + CLOUD_FS, transparent: true, depthWrite: false }));
    this.clouds.frustumCulled = false; this.clouds.renderOrder = 1;
    e.scene.add(this.clouds);

    // Searchlights.
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.ShaderMaterial({ uniforms: { uCol: { value: new THREE.Color('#bcd6ff').multiplyScalar(0.4) }, uA: { value: 0 } }, vertexShader: BEAM_VS, fragmentShader: BEAM_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
      const b = new THREE.Mesh(this.kit.geo.beam, mat); b.frustumCulled = false; b.visible = false; b.renderOrder = 1;
      e.scene.add(b); this.beams.push(b); this.beamMats.push(mat); this.beamAim.push(new THREE.Vector3());
    }

    // Freight trains (Glacier Yard): one global batch, moved per frame.
    this.trains = new THREE.InstancedMesh(this.kit.props.container.geo, this.kit.props.container.mat, 160);
    this.trains.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(160 * 3), 3);
    for (let i = 0; i < 160; i++) this.trains.setColorAt(i, this.kit.railCols[i % this.kit.railCols.length]);
    this.trains.count = 0; this.trains.frustumCulled = false; this.trains.castShadow = true;
    e.scene.add(this.trains);
  }

  clear() { /* city persists between screens */ }

  private X = (x: number) => (x - 800) * this.k;
  private Z = (cy: number) => this.cz + (cy - 450 - this.cz) * this.k;
  private R = (h: number) => h * this.k;

  /** Rebuild everything for a new seed or theme. */
  private reseed() {
    for (const vw of this.views.values()) { this.root.remove(vw.group); vw.dispose(); }
    this.views.clear();
    this.gen = CITY.gen;
    const e = this.engine, th = THEMES[CITY.theme % THEMES.length], ti = CITY.theme % 5;
    U.uWinCol.value.set(th.window);
    const lamp = ti === 2 ? '#cfe0ff' : ti === 4 ? '#ffc070' : ti === 1 ? '#ff9a3a' : '#ffae48';
    U.uLampCol.value.set(lamp); this.kit.lampCol.set(lamp); this.kit.winCol.set(th.window);
    U.uSnow.value = ti === 2 ? 1 : 0;
    U.uHazeCol.value.set(['#2b2621', '#33241a', '#1c2633', '#2a1f1d', '#251b33'][ti]);
    U.uHaze.value.set(ti === 2 ? 0.28 : 0.38, 70, 0, 0);
    U.uGroundTint.value.set(['#c8ccd2', '#e0c8a8', '#d0dcec', '#c8bcb4', '#c4c0d8'][ti]);
    U.uWater.value.set('#060a10');
    const cm = this.clouds.material as THREE.ShaderMaterial;
    cm.uniforms.uCloudLo.value.set(['#3b2c22', '#4a2c1a', '#2a3445', '#40261d', '#3d2347'][ti]).multiplyScalar(0.9);
    cm.uniforms.uCloudHi.value.set(['#5f6878', '#665a52', '#7c8aa0', '#5a5052', '#5a5878'][ti]).multiplyScalar(0.8);
    e.renderer.setClearColor(th.fog);
    const fog = e.scene.fog as THREE.Fog; fog.color.set(th.fog); fog.near = 3100; fog.far = 6400;
    // Avenue traffic: screen-fixed lanes that wrap off-screen.
    if (this.avenues) { e.scene.remove(this.avenues); this.avenues.geometry.dispose(); this.avenues = null; }
    const tb = new TrafficBuilder(), plan = CITY.plan!;
    const zTop = this.engine.toGround(0, -420, v).z, zBot = this.engine.toGround(0, FIELD_H + 160, w).z, L = zBot - zTop;
    const dens = ti === 3 ? 0.18 : ti === 4 ? 1.5 : ti === 1 ? 0.45 : ti === 2 ? 0.6 : 1;
    for (const a of plan.aves) {
      const lanes = a.major ? 4 : 2, wid = this.R(a.x1 - a.x0), cx = this.X((a.x0 + a.x1) / 2);
      for (let i = 0; i < lanes; i++) {
        const dir = i < lanes / 2 ? 1 : -1, off = ((i % (lanes / 2)) + 0.5) * (wid / lanes) * (dir > 0 ? -1 : 1) * 0.9;
        const n = Math.round((L / (a.major ? 120 : 200)) * dens);
        tb.lane(cx + off, dir > 0 ? zTop : zBot, 0, dir, L, n, a.major ? 95 : 70, true);
      }
    }
    this.avenues = tb.build(this.kit.mat.traffic);
    if (this.avenues) e.scene.add(this.avenues);
    // Trains on the rail corridor.
    this.trainCars = [];
    if (ti === 2) {
      const rc = plan.cols.find((c) => c.zone === 'rail');
      if (rc) for (let i = 0; i < 4; i++) {
        const tracks = Math.floor((rc.x1 - rc.x0 - 10) / 11), tr = Math.floor(Math.random() * tracks);
        this.trainCars.push({ x: rc.x0 + 10 + tr * 11, z0: zTop, len: L + 900, speed: (Math.random() < 0.5 ? 1 : -1) * (30 + Math.random() * 40), off: Math.random() * L, cars: 14 + Math.floor(Math.random() * 16) });
      }
    }
  }

  private syncChunks() {
    let changed = false;
    for (const [ch, vw] of this.views) if (!CITY.chunks.includes(ch)) { this.root.remove(vw.group); vw.dispose(); this.views.delete(ch); changed = true; }
    for (const ch of CITY.chunks) if (!this.views.has(ch)) {
      const vw = buildChunk(ch, this.kit);
      this.root.add(vw.group); this.views.set(ch, vw); changed = true;
    }
    if (!changed) return;
    // Searchlight anchors from the rows on screen.
    this.anchors.length = 0;
    for (const vw of this.views.values()) for (const p of vw.chunk.props) if (p.k === 'searchlight') this.anchors.push({ x: this.X(p.x), z: this.Z(p.cy), y: this.R(p.h) + 2, phase: p.v * 10, b: p.on, view: vw });
  }

  /** Push a building's state into its instances. */
  private apply(b: Bldg) {
    const vw = this.views.get(b.chunk); if (!vw) return;
    const r = vw.refs.get(b); if (!r) return;
    for (const p of r.parts) {
      const a = p.mesh.geometry.attributes.aB1 as THREE.InstancedBufferAttribute;
      a.setXYZW(p.idx, b.keepLit ? 1 : 0, b.burnT, b.collapseT, b.fire);
      a.addUpdateRange(p.idx * 4, 4); a.needsUpdate = true;
    }
    if (b.dead) {
      for (const p of r.props) { p.mesh.setMatrixAt(p.idx, ZERO); p.mesh.instanceMatrix.needsUpdate = true; }
      if (vw.glow && r.glows.length) {
        const c = vw.glow.geometry.attributes.aC as THREE.InstancedBufferAttribute;
        for (const i of r.glows) { c.setXYZW(i, 0, 0, 0, 0); }
        c.needsUpdate = true; r.glows.length = 0;
      }
      if (vw.rubble && r.rubble >= 0) {
        const ember = Math.min(0.25, 0.08 + b.fire * 0.2);
        vw.rubble.setMatrixAt(r.rubble, rubbleMatrix(b, this.X, this.Z, this.R, m4));
        vw.rubble.setColorAt(r.rubble, tmpCol.setRGB(0.3 + ember, 0.3, 0.3));
        vw.rubble.instanceMatrix.needsUpdate = true; vw.rubble.instanceColor!.needsUpdate = true;
        r.rubble = -1;
      }
    }
  }

  update({ S, dt, engine: e }: FrameCtx) {
    if (this.gen !== CITY.gen || !CITY.plan) { if (!CITY.plan) return; this.reseed(); }
    this.syncChunks();
    const k = this.k, scrollZ = S.scrollY * k, t = CITY.time;
    this.root.position.z = scrollZ;
    U.uTime.value = t; U.uScroll.value = scrollZ;
    if (this.darkVer !== DARK.ver) { this.darkVer = DARK.ver; darkTex.needsUpdate = true; }
    for (const b of CITY.dirty) this.apply(b);
    CITY.dirty.length = 0;
    for (const b of CITY.burning) this.apply(b);

    const glow = e.glow, dark = e.dark;
    // Burning buildings: flames licking from the roof and a smoke column leaning downwind.
    for (const b of CITY.burning) {
      const f = b.fire; if (f <= 0.02) continue;
      const fy = b.y; if (fy < -150 || fy > FIELD_H + 60) continue;
      const sink = b.collapseT > 0 ? Math.min(1, ((t - b.collapseT) / 2.4) ** 2) : 0;
      const top = b.dead ? this.R(Math.min(14, 3 + b.hgt * 0.12)) : this.R(b.hgt) * (1 - sink);
      const x = this.X(b.x), z = this.Z(b.cy) + scrollZ, sz = this.R(Math.max(b.w, b.h));
      this.burn(glow, dark, x, top, z, sz, f, b.seed, t);
    }
    // Ambient fires, refinery stacks and cooling towers.
    for (const vw of this.views.values()) {
      const fy = vw.chunk.cy0 + S.scrollY;
      if (fy > FIELD_H + 40 || vw.chunk.cy1 + S.scrollY < -200) continue;
      for (const f of vw.fires) this.burn(glow, dark, f.x, 1, f.z + scrollZ, f.s * 1.5, 0.6, f.seed, t);
      for (const s of vw.stacks) if (!s.b.dead) this.plume(dark, s.x, s.y, s.z + scrollZ, s.s, s.seed, t, s.b.kind === 'cooler');
    }
    this.updateCraters();
    this.updateClouds(S.clouds as Cloud[]);
    this.updateBeams(S, dt);
    this.updateTrains(t, scrollZ);
  }

  private burn(glow: Engine['glow'], dark: Engine['dark'], x: number, y: number, z: number, sz: number, f: number, seed: number, t: number) {
    const k = this.k;
    for (let i = 0; i < 3; i++) {
      const ph = t * (5 + i * 1.7) + seed * 40 + i * 2.1;
      const fl = 0.75 + 0.25 * Math.sin(ph) * Math.sin(ph * 1.7 + 1);
      const ox = Math.sin(seed * 91 + i * 2.4) * sz * 0.25, oz = Math.cos(seed * 57 + i * 1.9) * sz * 0.2;
      glow.add(x + ox, y + 2 + i, z + oz, 0, sz * (0.45 + 0.25 * f) * fl, sz * (0.45 + 0.25 * f) * fl, i === 0 ? FIRE_B : FIRE_A, 0.55 * f * fl, Shape.Soft);
    }
    glow.add(x, y + 1, z, 0, sz * 2.2, sz * 2.2, EMBER, 0.12 * f, Shape.Soft);
    for (let i = 0; i < 7; i++) {
      const ph = (t * 0.22 + i / 7 + seed * 3.7) % 1;
      const h = y + ph * 320 * k * (0.4 + 0.6 * f);
      const sx = x + ph * ph * 90 * k + Math.sin(seed * 20 + i * 3) * sz * 0.2, szz = z + ph * 40 * k;
      const s = (sz * 0.6 + ph * 70 * k) * (0.6 + 0.6 * f);
      dark.add(sx, h, szz, ph * 3 + seed, s, s, SMOKE, (1 - ph) * (ph < 0.08 ? ph / 0.08 : 1) * 0.42 * Math.min(1, f * 1.5), DarkShape.Soft);
    }
  }

  private plume(dark: Engine['dark'], x: number, y: number, z: number, sz: number, seed: number, t: number, steam: boolean) {
    const k = this.k;
    for (let i = 0; i < 6; i++) {
      const ph = (t * (steam ? 0.12 : 0.18) + i / 6 + seed * 5.1) % 1;
      const h = y + ph * (steam ? 160 : 220) * k;
      const s = sz * (steam ? 1.0 : 1.2) + ph * (steam ? 80 : 60) * k;
      dark.add(x + ph * ph * 110 * k, h, z + ph * 30 * k, ph * 2 + seed, s, s, steam ? STEAM : SMOKE, (1 - ph) * Math.min(1, ph * 8) * (steam ? 0.22 : 0.28), DarkShape.Soft);
    }
  }

  private updateCraters() {
    const cr = CITY.craters;
    const sig = cr.length + ':' + (cr.length ? cr[cr.length - 1].born : 0) + ':' + (cr.length ? cr[0].born : 0);
    if (sig === this.craterSig) return;
    this.craterSig = sig;
    const a = this.craterAttr; const n = Math.min(96, cr.length);
    for (let i = 0; i < n; i++) { const c = cr[cr.length - n + i]; a.setXYZW(i, this.X(c.x), this.Z(c.cy), this.R(c.r), c.born); }
    a.needsUpdate = true; (this.craters.geometry as THREE.InstancedBufferGeometry).instanceCount = n;
  }

  private updateClouds(cl: Cloud[]) {
    const e = this.engine, cam = e.camPos, n = Math.min(32, cl.length);
    for (let i = 0; i < n; i++) {
      const c = cl[i];
      // The cloud sits under the same pixel as field (x, y) at its altitude.
      e.toFlight(c.x, c.y, 0, v);
      const s = (cam.y - c.alt) / (cam.y - FLIGHT);
      this.cloudA0.setXYZW(i, cam.x + (v.x - cam.x) * s, c.alt, cam.z + (v.z - cam.z) * s, c.seed);
      this.cloudA1.setXYZW(i, c.w * s, c.h * s, c.a, c.alt > 1250 ? 1 : 0);
    }
    this.cloudA0.needsUpdate = true; this.cloudA1.needsUpdate = true;
    (this.clouds.geometry as THREE.InstancedBufferGeometry).instanceCount = n;
  }

  private updateBeams(S: FrameCtx['S'], dt: number) {
    const e = this.engine, scrollZ = this.root.position.z, t = CITY.time;
    let bi = 0;
    for (const a of this.anchors) {
      if (bi >= this.beams.length) break;
      if (a.b?.dead) continue;
      const wz = a.z + scrollZ;
      // Field y of the anchor (inverse of toGround) to fade beams in and out at the screen edges.
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
      } else w.set(this.X(800) + sx * 1.6, FLIGHT - 100, -500 + sz);
      if (aim.lengthSq() === 0) aim.copy(w); else aim.lerp(w, Math.min(1, dt * 1.2));
      v.set(a.x, a.y, wz);
      w.subVectors(aim, v); const L = w.length(); w.divideScalar(L);
      q.setFromUnitVectors(UP, w);
      beam.position.copy(v); beam.quaternion.copy(q); beam.scale.set(L * 0.032, L, L * 0.032);
      beam.visible = true; mat.uniforms.uA.value = 0.75 * fade * (0.85 + 0.15 * Math.sin(t * 13 + a.phase));
      e.glow.add(v.x, v.y + 1, v.z, 0, 26 * this.k, 26 * this.k, rgb('#cfe2ff'), 0.9 * fade, Shape.Hot);
    }
    for (; bi < this.beams.length; bi++) { this.beams[bi].visible = false; this.beamAim[bi].set(0, 0, 0); }
  }

  private updateTrains(t: number, scrollZ: number) {
    let n = 0;
    const carL = this.R(18.5);
    for (const tr of this.trainCars) {
      const dir = Math.sign(tr.speed);
      const head = ((tr.off + t * tr.speed + scrollZ) % tr.len + tr.len) % tr.len + tr.z0 - (dir < 0 ? 900 : 0);
      const x = this.X(tr.x);
      for (let i = 0; i < tr.cars && n < 160; i++) {
        const z = head - dir * i * carL;
        m4.compose(v.set(x, 0.4, z), q.identity(), s3.set(this.R(4.6), this.R(i === 0 ? 5 : 4.2), this.R(16)));
        this.trains.setMatrixAt(n++, m4);
      }
      // Headlight on the locomotive.
      this.engine.glow.add(x, this.R(3), head + dir * this.R(9), 0, this.R(5), this.R(5), rgb('#fff2d8'), 1.2, Shape.Hot);
      this.engine.glow.add(x, 1, head + dir * this.R(30), 0, this.R(10), this.R(40), rgb('#fff2d8'), 0.25, Shape.Soft);
    }
    this.trains.count = n; this.trains.instanceMatrix.needsUpdate = true;
  }
}
void FLOOR;
