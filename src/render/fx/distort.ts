// Screen-space refraction. Shockwave rings, heat haze over fires and engines, and the rail's ionised
// channel are drawn as signed UV offsets into a small float target (one instanced draw call); the post
// chain's DistortEffect then bends the frame through it and splits colour where the bend is strongest.
import * as THREE from 'three';

export const enum DistShape { Shock = 0, Haze = 1, Line = 2 }

const VS = /* glsl */`
attribute vec3 aPos; attribute vec3 aRs; attribute vec4 aPar;
varying vec2 vUv; varying vec4 vPar; varying float vRot;
void main(){
  vUv = uv; vPar = aPar; vRot = aRs.x;
  vec2 p = vec2(position.x * aRs.y, position.z * aRs.z);
  float c = cos(aRs.x), s = sin(aRs.x);
  vec3 w = vec3(aPos.x + p.x * c - p.y * s, aPos.y, aPos.z + p.x * s + p.y * c);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;
const FS = /* glsl */`
uniform float uTime;
varying vec2 vUv; varying vec4 vPar; varying float vRot;
float hash(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
void main(){
  vec2 p = vUv * 2.0 - 1.0; float d = length(p);
  int shp = int(vPar.x + 0.5); float str = vPar.y, k = vPar.z, seed = vPar.w;
  vec2 off = vec2(0.0);
  if (shp == 0) { // expanding ring: k is progress 0..1
    float rr = 0.12 + 0.86 * k, w = 0.07 + 0.1 * k;
    float prof = exp(-pow((d - rr) / w, 2.0)) * (d - rr < 0.0 ? 0.6 : 1.0);
    off = (p / max(d, 0.001)) * prof * str * (1.0 - k) * 0.03;
  } else if (shp == 1) { // heat haze: rising noise
    float m = pow(max(0.0, 1.0 - d), 1.5);
    vec2 q = p * 2.5 + vec2(seed * 13.0, uTime * 1.8);
    off = vec2(vnoise(q) - 0.5, vnoise(q + vec2(5.2, 1.3)) - 0.5) * m * str * 0.012;
  } else { // line wobble across the quad's short axis
    float g = exp(-p.y * p.y * 6.0) * (1.0 - smoothstep(0.85, 1.0, abs(p.x)));
    float wv = sin(p.x * 40.0 + uTime * 24.0 + seed * 10.0) * 0.6 + (vnoise(vec2(p.x * 12.0 - uTime * 8.0, seed * 7.0)) - 0.5);
    off = vec2(0.0, sign(p.y) * g + wv * g * 0.6) * str * 0.01;
  }
  // Rotate the local offset into world XZ, then to screen UV (world z runs down the screen).
  float c = cos(vRot), s = sin(vRot);
  vec2 w = vec2(off.x * c - off.y * s, off.x * s + off.y * c);
  gl_FragColor = vec4(w.x, -w.y, 0.0, 0.0);
}`;

export class DistortBatch {
  scene = new THREE.Scene();
  target: THREE.WebGLRenderTarget;
  g = new THREE.InstancedBufferGeometry(); n = 0; mat: THREE.ShaderMaterial;
  private pos: Float32Array; private rs: Float32Array; private par: Float32Array; private attrs: THREE.InstancedBufferAttribute[];
  private clear = new THREE.Color();
  /** Fraction of the drawing buffer the target is sized to. */
  scale = 0.5;
  constructor(public max = 256) {
    const g = this.g;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5]), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    g.setIndex([0, 2, 1, 0, 3, 2]);
    this.pos = new Float32Array(max * 3); this.rs = new Float32Array(max * 3); this.par = new Float32Array(max * 4);
    const add = (n: string, arr: Float32Array, sz: number) => { const a = new THREE.InstancedBufferAttribute(arr, sz); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(n, a); return a; };
    this.attrs = [add('aPos', this.pos, 3), add('aRs', this.rs, 3), add('aPar', this.par, 4)];
    g.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: { uTime: { value: 0 } }, transparent: true, depthTest: false, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, this.mat); mesh.frustumCulled = false; this.scene.add(mesh);
    this.target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
  }
  setSize(w: number, h: number) { this.target.setSize(Math.max(4, Math.round(w * this.scale)), Math.max(4, Math.round(h * this.scale))); }
  begin(t: number) { this.n = 0; this.mat.uniforms.uTime.value = t; }
  add(x: number, y: number, z: number, rot: number, len: number, wid: number, shape: number, str: number, k = 0, seed = 0) {
    if (this.n >= this.max || !(str > 0.002)) return;
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.rs[i * 3] = rot; this.rs[i * 3 + 1] = len; this.rs[i * 3 + 2] = wid;
    this.par[i * 4] = shape; this.par[i * 4 + 1] = str; this.par[i * 4 + 2] = k; this.par[i * 4 + 3] = seed;
  }
  /** Render the offsets (call before the composer). */
  render(r: THREE.WebGLRenderer, cam: THREE.Camera) {
    this.g.instanceCount = this.n;
    if (this.n) for (const a of this.attrs) { a.clearUpdateRanges(); a.addUpdateRange(0, this.n * a.itemSize); a.needsUpdate = true; }
    const prev = r.getRenderTarget(), ca = r.getClearAlpha(); r.getClearColor(this.clear);
    r.setRenderTarget(this.target); r.setClearColor(0x000000, 0); r.clear(true, false, false);
    if (this.n) r.render(this.scene, cam);
    r.setRenderTarget(prev); r.setClearColor(this.clear, ca);
  }
}
