// Static light sprites (street lamps, beacons, flames, signs, reflections) and animated traffic.
// Both are instanced quads built once per chunk and animated entirely on the GPU, so the city's
// thousands of lights cost nothing per frame on the CPU.
import * as THREE from 'three';
import { U, GLSL_COMMON } from './materials';

export const enum G {
  /** Soft ground pool (gaussian), lies flat. */ Pool = 0,
  /** Hot point (lamp head, beacon). */ Hot = 1,
  /** Thin ring (helipad). */ Ring = 2,
  /** Flame tongue, stands up facing the camera. */ Flame = 3,
  /** Shimmering reflection streak on water, lies flat. */ Reflect = 4,
  /** Sign panel, stands up facing +z, with scanline flicker. */ Sign = 5,
  /** Window-light spill (rectangle, soft). */ Spill = 6,
}

const VS = /* glsl */ `
attribute vec4 aP;   // x, y, z (chunk space), shape
attribute vec4 aS;   // size x, size y, blink rate (Hz, 0 = steady), phase
attribute vec4 aC;   // rgb * intensity, power (1 = dies in a blackout)
varying vec2 vUv; varying vec4 vC; varying float vShape; varying float vA; varying vec3 vCp;
uniform float uTime; uniform float uScroll;
void main(){
  vUv = uv; vC = aC; vShape = aP.w;
  vec3 c = aP.xyz;
  bool up = aP.w > 2.5 && aP.w < 3.5 || aP.w > 4.5 && aP.w < 5.5;
  vec3 upv = aP.w < 3.5 ? normalize(vec3(0.0, 1.0, 0.8)) : vec3(0.0, 1.0, 0.0);
  vec3 off = up ? vec3(position.x * aS.x, 0.0, 0.0) + upv * (0.5 - position.z) * aS.y : vec3(position.x * aS.x, 0.0, position.z * aS.y);
  vec4 wp = modelMatrix * vec4(c + off, 1.0);
  vCp = (modelMatrix * vec4(c, 1.0)).xyz - vec3(0.0, 0.0, uScroll);
  float a = 1.0;
  if (aS.z > 0.0) { float ph = fract(uTime * aS.z + aS.w); a = aP.w < 1.5 ? smoothstep(0.0, 0.04, ph) * (1.0 - smoothstep(0.1, 0.22, ph)) : 0.75 + 0.25 * sin(ph * 6.2831); }
  vA = a;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const FS = /* glsl */ `
varying vec2 vUv; varying vec4 vC; varying float vShape; varying float vA; varying vec3 vCp;
void main(){
  vec2 p = vUv * 2.0 - 1.0; float d = length(p); float a = 0.0; vec3 col = vC.rgb;
  float s = vShape;
  if (s < 0.5) { a = exp(-d * d * 3.2) - 0.04; }
  else if (s < 1.5) { a = pow(max(0.0, 1.0 - d), 2.2); col = mix(col, vec3(1.0), pow(max(0.0, 1.0 - d * 2.5), 2.0) * 0.7); }
  else if (s < 2.5) { a = smoothstep(0.78, 0.88, d) * (1.0 - smoothstep(0.9, 1.0, d)); }
  else if (s < 3.5) {
    float t = uTime * 2.6 + vC.a * 31.0;
    float y = vUv.y;
    float w = (1.0 - y) * 0.9 + 0.1;
    float n = vnoise(vec2(p.x * 2.5, y * 3.0 - t * 1.6)) * 0.6 + vnoise(vec2(p.x * 5.0, y * 6.0 - t * 2.3)) * 0.4;
    a = smoothstep(w, w * 0.2, abs(p.x) + (n - 0.5) * 0.5) * smoothstep(1.0, 0.25, y + (n - 0.5) * 0.4) * smoothstep(0.0, 0.08, y);
    col = mix(vec3(1.0, 0.85, 0.5), col, smoothstep(0.0, 0.6, y));
  }
  else if (s < 4.5) {
    float sh = vnoise(vec2(p.x * 3.0, vCp.z * 0.08 - uTime * 0.9)) * vnoise(vec2(p.y * 7.0 + uTime, vCp.x * 0.05));
    a = (1.0 - smoothstep(0.2, 1.0, abs(p.x))) * (1.0 - smoothstep(0.3, 1.0, abs(p.y))) * smoothstep(0.15, 0.6, sh) * 1.6;
  }
  else if (s < 5.5) {
    vec2 q = abs(p);
    a = (1.0 - smoothstep(0.86, 1.0, max(q.x, q.y)));
    float scan = 0.75 + 0.25 * step(0.5, fract(vUv.y * 9.0 + uTime * 0.7));
    float glyph = step(0.42, h12(floor(vec2(vUv.x * 9.0, vUv.y * 4.0)) + floor(uTime * 0.5 + vC.a * 5.0)));
    a *= mix(0.45, 1.0, glyph) * scan;
    a += (1.0 - smoothstep(0.0, 0.08, 1.0 - max(q.x, q.y))) * 0.8;
  }
  else { vec2 q = abs(p); a = (1.0 - smoothstep(0.5, 1.0, q.x)) * (1.0 - smoothstep(0.5, 1.0, q.y)); }
  float power = vC.a > 0.5 ? powerAt(vCp, h12(vCp.xz)) : 1.0;
  a *= vA * power;
  if (a <= 0.003) discard;
  gl_FragColor = vec4(col * a, 1.0);
}`;

export function glowMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: U, vertexShader: VS, fragmentShader: GLSL_COMMON + FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  });
}

/** Accumulates light sprites for one chunk, then bakes them into one instanced mesh. */
export class GlowBuilder {
  p: number[] = []; s: number[] = []; c: number[] = [];
  get n() { return this.p.length / 4; }
  add(x: number, y: number, z: number, shape: G, sx: number, sy: number, col: THREE.Color, inten: number, power = true, blink = 0, phase = 0) {
    this.p.push(x, y, z, shape); this.s.push(sx, sy, blink, phase); this.c.push(col.r * inten, col.g * inten, col.b * inten, power ? 1 : 0);
    return this.n - 1;
  }
  build(mat: THREE.Material) {
    if (!this.n) return null;
    const g = new THREE.InstancedBufferGeometry();
    const q = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    g.index = q.index; g.setAttribute('position', q.attributes.position); g.setAttribute('uv', q.attributes.uv);
    g.setAttribute('aP', new THREE.InstancedBufferAttribute(new Float32Array(this.p), 4));
    g.setAttribute('aS', new THREE.InstancedBufferAttribute(new Float32Array(this.s), 4));
    g.setAttribute('aC', new THREE.InstancedBufferAttribute(new Float32Array(this.c), 4));
    g.instanceCount = this.n;
    const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.renderOrder = 0;
    return m;
  }
}

/* ---------------- traffic ---------------- */
// Each instance is one car: aL0 (lane start x, z, dir x, dir z), aL1 (lane length, speed, offset, wrap mode).
// Wrap mode 1 = the lane is screen-fixed (avenues): the lane start is in world space and the car
// position adds the scroll, so cars wrap off-screen and never pop.
const TVS = /* glsl */ `
attribute vec4 aL0; attribute vec4 aL1;
varying vec2 vUv; varying float vFade; varying vec3 vCp;
uniform float uTime; uniform float uScroll;
void main(){
  vUv = uv;
  float len = aL1.x;
  float s = mod(aL1.z + uTime * aL1.y + (aL1.w > 0.5 ? uScroll * sign(aL0.w) : 0.0), len);
  vec2 dir = aL0.zw;
  vec2 c = aL0.xy + dir * s;
  vec2 side = vec2(-dir.y, dir.x);
  vec2 xz = c + dir * position.z * 22.0 + side * position.x * 5.0;
  vec4 wp = modelMatrix * vec4(xz.x, 0.6, xz.y, 1.0);
  vCp = (modelMatrix * vec4(c.x, 0.0, c.y, 1.0)).xyz - vec3(0.0, 0.0, uScroll);
  vFade = smoothstep(0.0, 40.0, s) * (1.0 - smoothstep(len - 40.0, len, s));
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
// Quad spans 22 world units along the car's heading (+z of the quad = forward) and 5 across.
const TFS = /* glsl */ `
varying vec2 vUv; varying float vFade; varying vec3 vCp;
void main(){
  vec2 p = vUv * 2.0 - 1.0;  // p.y: -1 rear .. +1 front (after rotateX the quad's +z maps to uv.y = 0)
  float fwd = -p.y;
  vec3 col = vec3(0.0);
  // Headlight beams fanning forward from the car's nose (nose at fwd = 0.1).
  float b = smoothstep(0.1, 0.2, fwd) * (1.0 - smoothstep(0.35, 1.0, fwd));
  float cone = 1.0 - smoothstep(0.15 + fwd * 0.9, 0.3 + fwd * 1.1, abs(p.x));
  col += vec3(1.0, 0.93, 0.78) * b * cone * 0.55;
  // Two headlamps.
  float hl = exp(-(pow((abs(p.x) - 0.32) * 7.0, 2.0) + pow((fwd - 0.1) * 22.0, 2.0)));
  col += vec3(1.0, 0.95, 0.85) * hl * 2.4;
  // Tail lamps at the rear (fwd = -0.35).
  float tl = exp(-(pow((abs(p.x) - 0.34) * 9.0, 2.0) + pow((fwd + 0.33) * 26.0, 2.0)));
  col += vec3(0.75, 0.08, 0.04) * tl * 1.4;
  col *= vFade;
  if (dot(col, vec3(1.0)) < 0.004) discard;
  gl_FragColor = vec4(col, 1.0);
}`;
export function trafficMaterial() {
  return new THREE.ShaderMaterial({ uniforms: U, vertexShader: TVS, fragmentShader: GLSL_COMMON + TFS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
}
export class TrafficBuilder {
  a: number[] = []; b: number[] = [];
  get n() { return this.a.length / 4; }
  /** A lane from (x, z) along (dx, dz) of length len; n cars at speed (world units/s). */
  lane(x: number, z: number, dx: number, dz: number, len: number, cars: number, speed: number, screenFixed: boolean) {
    for (let i = 0; i < cars; i++) { this.a.push(x, z, dx, dz); this.b.push(len, speed * (0.85 + Math.random() * 0.3), Math.random() * len, screenFixed ? 1 : 0); }
  }
  build(mat: THREE.Material) {
    if (!this.n) return null;
    const g = new THREE.InstancedBufferGeometry();
    const q = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    g.index = q.index; g.setAttribute('position', q.attributes.position); g.setAttribute('uv', q.attributes.uv);
    g.setAttribute('aL0', new THREE.InstancedBufferAttribute(new Float32Array(this.a), 4));
    g.setAttribute('aL1', new THREE.InstancedBufferAttribute(new Float32Array(this.b), 4));
    g.instanceCount = this.n;
    const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.renderOrder = 0;
    return m;
  }
}
