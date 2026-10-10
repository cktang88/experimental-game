// Smoke ribbons: real trail geometry for missiles (not dot strings). Each ribbon is a strip of up to
// N points laid down behind its owner; points age, widen, drift with the wind and the scroll, and fade.
// When the owner dies the ribbon detaches and lingers until its last point has faded.
// All ribbons share one indexed mesh (one draw call); the buffers are rebuilt in place each frame.
import * as THREE from 'three';
import type { Engine } from '../engine';

export const enum RibbonStyle { Player = 0, Hostile = 1, Ion = 2 }
const R = 72, N = 44;
const SPACING = 7;
/** Seconds a point lives, per style. */
const LIFE = [1.5, 1.7, 0.9];
const W0 = [3.2, 3.6, 3], GROW = [16, 18, 6];

const VS = /* glsl */`
attribute float aSide; attribute vec4 aInfo; // age, life, dist, style
varying float vSide; varying vec4 vInfo; varying float vU;
attribute float aU;
void main(){ vSide = aSide; vInfo = aInfo; vU = aU; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`;
const FS = /* glsl */`
uniform float uTime;
varying float vSide; varying vec4 vInfo; varying float vU;
float hash(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
void main(){
  float age = vInfo.x, life = vInfo.y, dist = vInfo.z; int style = int(vInfo.w + 0.5);
  float k = clamp(age / life, 0.0, 1.0);
  float side = abs(vSide);
  float n = vnoise(vec2(dist * 0.07, vSide * 1.3 + age * 1.6)) * 0.65 + vnoise(vec2(dist * 0.21 - age * 2.0, vSide * 2.7)) * 0.35;
  vec3 emit = vec3(0.0); float alpha = 0.0; vec3 matter = vec3(0.0);
  if (style == 2) {
    float core = pow(max(0.0, 1.0 - side), 2.0);
    float fl = 0.6 + 0.4 * vnoise(vec2(dist * 0.2 + uTime * 40.0, 3.0));
    emit = vec3(0.75, 0.55, 1.0) * core * (1.0 - k) * (1.0 - k) * 2.2 * fl + vec3(1.0) * pow(max(0.0, 1.0 - side * 3.0), 3.0) * (1.0 - k) * 0.8;
  } else {
    float edge = smoothstep(1.0, 0.25 + 0.5 * n, side);
    float fade = pow(1.0 - k, 1.4) * smoothstep(0.0, 0.05, age);
    alpha = edge * fade * (0.35 + 0.65 * n) * (style == 1 ? 0.75 : 0.62);
    matter = style == 1 ? vec3(0.13, 0.12, 0.12) : vec3(0.42, 0.43, 0.46) * (0.65 + 0.5 * n);
    // Hot exhaust just behind the motor.
    float hot = smoothstep(0.12, 0.0, age) * pow(max(0.0, 1.0 - side), 1.5);
    vec3 hc = style == 1 ? vec3(1.0, 0.16, 0.55) : vec3(1.0, 0.62, 0.25);
    emit = hc * hot * 4.0;
    alpha *= 1.0 - hot;
  }
  gl_FragColor = vec4(emit + matter * alpha, alpha);
}`;

interface Ribbon { used: boolean; attached: boolean; style: number; ground: boolean; n: number; head: number; px: Float32Array; py: Float32Array; ph: Float32Array; pa: Float32Array; pd: Float32Array; dist: number; lx: number; ly: number }

export class Ribbons {
  mesh: THREE.Mesh; mat: THREE.ShaderMaterial;
  private g = new THREE.BufferGeometry();
  private pos: Float32Array; private side: Float32Array; private info: Float32Array; private uu: Float32Array;
  private attrs: THREE.BufferAttribute[];
  private rs: Ribbon[] = [];
  private free: number[] = [];
  private v = new THREE.Vector3(); private a = new THREE.Vector3(); private b = new THREE.Vector3();
  constructor(private e: Engine, order: number) {
    const V = R * N * 2;
    this.pos = new Float32Array(V * 3); this.side = new Float32Array(V); this.info = new Float32Array(V * 4); this.uu = new Float32Array(V);
    const mk = (arr: Float32Array, sz: number) => { const a = new THREE.BufferAttribute(arr, sz); a.setUsage(THREE.DynamicDrawUsage); return a; };
    this.attrs = [mk(this.pos, 3), mk(this.side, 1), mk(this.info, 4), mk(this.uu, 1)];
    this.g.setAttribute('position', this.attrs[0]); this.g.setAttribute('aSide', this.attrs[1]); this.g.setAttribute('aInfo', this.attrs[2]); this.g.setAttribute('aU', this.attrs[3]);
    const idx = new Uint32Array(R * (N - 1) * 6); let o = 0;
    for (let r = 0; r < R; r++) for (let i = 0; i < N - 1; i++) { const a = (r * N + i) * 2; idx[o++] = a; idx[o++] = a + 1; idx[o++] = a + 2; idx[o++] = a + 1; idx[o++] = a + 3; idx[o++] = a + 2; }
    this.g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS, uniforms: { uTime: { value: 0 } }, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide, toneMapped: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(this.g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = order;
    for (let i = 0; i < R; i++) {
      this.rs.push({ used: false, attached: false, style: 0, ground: false, n: 0, head: 0, px: new Float32Array(N), py: new Float32Array(N), ph: new Float32Array(N), pa: new Float32Array(N), pd: new Float32Array(N), dist: 0, lx: 0, ly: 0 });
      this.free.push(R - 1 - i);
    }
  }
  clear() { for (let i = 0; i < R; i++) if (this.rs[i].used) { this.rs[i].used = false; this.free.push(i); } }
  /** Start a ribbon; returns its id or -1 when all are busy. */
  open(style: number, x: number, y: number): number {
    const id = this.free.pop(); if (id === undefined) return -1;
    const r = this.rs[id]; r.used = true; r.attached = true; r.style = style; r.n = 0; r.head = 0; r.dist = 0; r.lx = x; r.ly = y;
    this.push(r, x, y, 0);
    return id;
  }
  private push(r: Ribbon, x: number, y: number, h: number) {
    const i = (r.head + r.n) % N;
    if (r.n === N) r.head = (r.head + 1) % N; else r.n++;
    r.px[i] = x; r.py[i] = y; r.ph[i] = h; r.pa[i] = 0; r.pd[i] = r.dist;
  }
  /** Feed the owner's current position (call every frame while it lives). */
  feed(id: number, x: number, y: number) {
    const r = this.rs[id]; if (!r || !r.used) return;
    r.attached = true;
    const d = Math.hypot(x - r.lx, y - r.ly);
    if (d >= SPACING) { r.dist += d; r.lx = x; r.ly = y; this.push(r, x, y, 0); }
    else { const i = (r.head + r.n - 1) % N; r.px[i] = x; r.py[i] = y; }
  }
  /** Mark every ribbon unfed; feed() re-marks the live ones. */
  beginFrame() { for (const r of this.rs) r.attached = false; }

  update(gdt: number, scroll: number, t: number) {
    this.mat.uniforms.uTime.value = t;
    const e = this.e, P = this.pos, Sd = this.side, I = this.info, U = this.uu, v = this.v, A = this.a, B = this.b;
    let slot = 0;
    for (let id = 0; id < R; id++) {
      const r = this.rs[id]; if (!r.used) continue;
      const life = LIFE[r.style];
      // Age points; drop expired ones from the tail.
      for (let j = 0; j < r.n; j++) { const i = (r.head + j) % N; r.pa[i] += gdt; r.py[i] += scroll * gdt * (r.style === RibbonStyle.Ion ? 0 : 0.9); r.px[i] += gdt * 6; }
      while (r.n > 0 && r.pa[r.head] > life) { r.head = (r.head + 1) % N; r.n--; }
      if (r.n < 2 && !r.attached) { r.used = false; this.free.push(id); continue; }
      if (r.n < 2) continue;
      const base = slot * N * 2;
      for (let j = 0; j < N; j++) {
        const jj = Math.min(j, r.n - 1);
        // Newest first so u runs from the head (0) to the tail (1).
        const i = (r.head + r.n - 1 - jj) % N;
        const ip = (r.head + r.n - 1 - Math.max(0, jj - 1)) % N, inn = (r.head + r.n - 1 - Math.min(r.n - 1, jj + 1)) % N;
        e.toFlight(r.px[ip], r.py[ip], 30, A); e.toFlight(r.px[inn], r.py[inn], 30, B);
        let dx = A.x - B.x, dz = A.z - B.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        const age = r.pa[i], w = (W0[r.style] + GROW[r.style] * age) * (jj === 0 ? 0.4 : 1);
        e.toFlight(r.px[i], r.py[i], 30, v);
        const o = (base + j * 2) * 3;
        P[o] = v.x - dz * w; P[o + 1] = v.y; P[o + 2] = v.z + dx * w;
        P[o + 3] = v.x + dz * w; P[o + 4] = v.y; P[o + 5] = v.z - dx * w;
        const s = base + j * 2; Sd[s] = -1; Sd[s + 1] = 1;
        const dd = j >= r.n ? life : age;
        I[s * 4] = dd; I[s * 4 + 1] = life; I[s * 4 + 2] = r.pd[i]; I[s * 4 + 3] = r.style;
        I[s * 4 + 4] = dd; I[s * 4 + 5] = life; I[s * 4 + 6] = r.pd[i]; I[s * 4 + 7] = r.style;
        U[s] = U[s + 1] = jj / (N - 1);
      }
      slot++;
    }
    this.g.setDrawRange(0, slot * (N - 1) * 6);
    if (slot) for (const a of this.attrs) { a.clearUpdateRanges(); a.addUpdateRange(0, slot * N * 2 * a.itemSize); a.needsUpdate = true; }
  }
}
