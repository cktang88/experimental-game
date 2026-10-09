// FxBatch: the effects workhorse. One instanced draw call per batch, premultiplied-alpha blending so a
// single batch mixes additive light (fire, glows, beams) with alpha-blended matter (smoke, soot, debris,
// the dark rims on hostile rounds) and keeps insertion order between them.
// Quads lie in the XZ plane (the camera looks down), rotated about Y. All shapes are drawn procedurally
// in the fragment shader except FIRE and SMOKE, which sample the baked puff atlas (atlas.ts).
import * as THREE from 'three';

export const enum FxShape {
  Hot = 0, Soft = 1, Ring = 2, Streak = 3, Fire = 4, Smoke = 5, Hostile = 6, Scorch = 7, Shard = 8, Flare = 9,
  Dark = 10, Star = 11, Beam = 12, Bolt = 13, Diamond = 14, Reticle = 15,
}

const VS = /* glsl */`
attribute vec3 aPos; attribute vec3 aRs; attribute vec4 aCol; attribute vec4 aPar;
varying vec2 vUv; varying vec4 vCol; varying vec4 vPar; varying vec2 vSize;
void main(){
  vUv = uv; vCol = aCol; vPar = aPar; vSize = aRs.yz;
  vec2 p = vec2(position.x * aRs.y, position.z * aRs.z);
  float c = cos(aRs.x), s = sin(aRs.x);
  vec3 w = vec3(aPos.x + p.x * c - p.y * s, aPos.y, aPos.z + p.x * s + p.y * c);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;

const FS = /* glsl */`
uniform sampler2D uAtlas; uniform float uTime;
varying vec2 vUv; varying vec4 vCol; varying vec4 vPar; varying vec2 vSize;
float hash(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
// Fire ramp (linear, HDR): soot red -> orange -> amber -> white-hot.
vec3 fireRamp(float h){
  h = clamp(h, 0.0, 1.0);
  vec3 c = mix(vec3(0.16, 0.025, 0.01), vec3(0.95, 0.16, 0.025), smoothstep(0.0, 0.3, h));
  c = mix(c, vec3(1.0, 0.45, 0.07), smoothstep(0.25, 0.55, h));
  c = mix(c, vec3(1.0, 0.78, 0.36), smoothstep(0.5, 0.8, h));
  c = mix(c, vec3(1.0, 0.97, 0.88), smoothstep(0.78, 1.0, h));
  return c * (0.7 + 7.0 * h * h * h);
}
vec4 atlas(float frame, vec2 uv){
  float f0 = floor(frame), k = frame - f0; f0 = mod(f0, 16.0); float f1 = mod(f0 + 1.0, 16.0);
  vec2 c0 = vec2(mod(f0, 4.0), floor(f0 / 4.0)), c1 = vec2(mod(f1, 4.0), floor(f1 / 4.0));
  vec2 u = clamp(uv, 0.004, 0.996) * 0.25;
  return mix(texture2D(uAtlas, c0 * 0.25 + u), texture2D(uAtlas, c1 * 0.25 + u), k);
}
void main(){
  vec2 p = vUv * 2.0 - 1.0; float d = length(p);
  int shp = int(vPar.x + 0.5); float op = vPar.y, p1 = vPar.z, p2 = vPar.w;
  vec3 col = vCol.rgb; float I = vCol.a;
  vec3 emit = vec3(0.0); float alpha = 0.0; vec3 matter = vec3(0.0);
  if (shp == 0) { // Hot: glow with a white core
    float a = pow(max(0.0, 1.0 - d), 1.6);
    emit = mix(col, vec3(1.0), pow(max(0.0, 1.0 - d * 2.6), 2.0)) * a * I;
  } else if (shp == 1) { // Soft glow
    emit = col * pow(max(0.0, 1.0 - d), 2.4) * I;
  } else if (shp == 2) { // Ring, p1 = thickness
    float t = max(0.04, p1);
    float a = smoothstep(1.0 - t * 2.0, 1.0 - t, d) * (1.0 - smoothstep(1.0 - t * 0.5, 1.0, d));
    emit = col * a * I;
  } else if (shp == 3 || shp == 12) { // Streak (tapered) / Beam (even along its length)
    float ay = abs(p.y), ax = abs(p.x);
    float along = shp == 3 ? (1.0 - smoothstep(0.35, 1.0, ax)) * (0.55 + 0.45 * (0.5 - 0.5 * p.x)) : 1.0 - smoothstep(0.9, 1.0, ax);
    float a = pow(max(0.0, 1.0 - ay), 1.8) * along;
    float core = pow(max(0.0, 1.0 - ay * 2.4), 3.0) * along;
    if (shp == 12) a *= 0.8 + 0.2 * vnoise(vec2(vUv.x * vSize.x * 0.05 - uTime * 30.0, p1 * 10.0));
    emit = (col * a + vec3(1.0) * core * 0.9) * I;
  } else if (shp == 4) { // Fire: atlas puff coloured by heat
    vec4 t = atlas(p1, vUv);
    float dens = t.r;
    float heat = p2 * (0.55 + 0.6 * t.b) - (1.0 - t.g) * 0.15;
    emit = fireRamp(heat) * dens * I;
    alpha = dens * smoothstep(0.55, 0.0, p2) * 0.65; // cooling fire turns sooty
  } else if (shp == 5) { // Smoke: lit atlas puff, p2 = fire light from below
    vec4 t = atlas(p1, vUv);
    float dens = t.r;
    alpha = dens;
    matter = col * (0.35 + 0.95 * t.g);
    emit = fireRamp(0.4 + 0.35 * t.b) * dens * p2 * p2 * 1.1 * (1.0 - t.g * 0.4);
  } else if (shp == 6) { // Hostile round: a dark rim around a hot red core
    float rim = smoothstep(1.0, 0.82, d);
    float core = smoothstep(0.62, 0.18, d);
    alpha = rim * 0.92;
    matter = vec3(0.03, 0.01, 0.01);
    emit = mix(col, vec3(1.0, 0.92, 0.85), smoothstep(0.32, 0.0, d)) * core * I * (1.0 + 0.35 * p1);
  } else if (shp == 7) { // Scorch decal: char core, pale ash rays thrown outward, glowing cracks while hot
    float a = atan(p.y, p.x), sd = p2 * 97.0;
    float lobes = 0.62 + 0.16 * vnoise(vec2(a * 2.2 + sd, sd)) + 0.08 * vnoise(vec2(a * 7.0 - sd, sd * 2.0));
    float rays = pow(vnoise(vec2(a * 11.0 + sd, 3.0)), 2.2);
    float reach = lobes + rays * 0.38;
    float body = smoothstep(reach, reach * 0.62, d);
    float center = smoothstep(lobes * 0.8, 0.0, d);
    float grit = 0.7 + 0.3 * vnoise(p * 9.0 + sd);
    float streak = rays * smoothstep(lobes * 0.3, lobes * 0.85, d);
    matter = mix(vec3(0.004, 0.0035, 0.003), vec3(0.11, 0.1, 0.092), clamp(streak * 1.3 + (1.0 - center) * 0.25, 0.0, 1.0) * grit);
    alpha = body * (0.55 + 0.45 * grit);
    float cracks = smoothstep(0.62, 0.9, vnoise(p * 6.0 + sd)) * center;
    float speck = step(0.9, hash(floor(p * 15.0 + sd))) * smoothstep(0.9, 0.2, d);
    emit = fireRamp(0.35 + 0.35 * cracks) * (cracks * 1.6 + speck * 1.2) * p1;
  } else if (shp == 8) { // Shard: a lit, irregular debris chunk, glowing edge while hot
    float a = atan(p.y, p.x), sd = p2 * 61.0;
    float r = 0.55 + 0.4 * vnoise(vec2(a * 1.6 + sd, sd));
    float body = smoothstep(r, r - 0.12, d);
    float lit = 0.55 + 0.45 * dot(normalize(p + 0.0001), normalize(vec2(-0.6, -0.8)));
    alpha = body;
    matter = col * lit * 1.4;
    emit = fireRamp(0.25 + 0.4 * min(1.0, p1)) * min(1.0, p1) * body * (0.6 + 0.4 * lit);
  } else if (shp == 9) { // Flare: anamorphic streak through a soft core
    float ax = abs(p.x), ay = abs(p.y) * vSize.x / max(1.0, vSize.y);
    float streak = pow(max(0.0, 1.0 - ax), 3.0) * exp(-ay * ay * 3.0);
    float core = pow(max(0.0, 1.0 - length(vec2(p.x, p.y * vSize.y / max(1.0, vSize.x)) * vec2(1.0, 1.0)) * 1.0), 4.0);
    emit = (col * streak + vec3(1.0) * core * 0.5) * I;
  } else if (shp == 10) { // Dark: soft alpha disc (outlines, shadows)
    alpha = pow(max(0.0, 1.0 - d), 1.4);
    matter = col;
  } else if (shp == 11) { // Star: a spiky muzzle burst, p2 = seed
    float a = atan(p.y, p.x);
    float rays = pow(abs(cos(a * 3.0 + p2 * 6.0)), 18.0) + 0.6 * pow(abs(cos(a * 2.0 + p2 * 11.0)), 24.0);
    float shape = max(rays * (1.0 - d), pow(max(0.0, 1.0 - d * 1.8), 2.0));
    emit = mix(col, vec3(1.0), pow(max(0.0, 1.0 - d * 3.0), 2.0)) * shape * I;
  } else if (shp == 13) { // Bolt: plasma teardrop, head at +x
    float x = p.x * 0.5 + 0.5; // 0 tail .. 1 head
    float w = mix(0.15, 1.0, pow(x, 0.7)) * (1.0 - smoothstep(0.86, 1.0, x));
    float ay = abs(p.y) / max(0.05, w);
    float a = pow(max(0.0, 1.0 - ay), 1.5) * smoothstep(0.0, 0.5, x);
    float core = pow(max(0.0, 1.0 - ay * 2.0), 2.0) * smoothstep(0.3, 0.85, x);
    emit = (col * a + vec3(1.0) * core) * I;
  } else if (shp == 14) { // Diamond (salvage glint)
    float m = abs(p.x) + abs(p.y);
    emit = mix(col, vec3(1.0), smoothstep(0.5, 0.0, m)) * smoothstep(1.0, 0.6, m) * I + col * pow(max(0.0, 1.0 - d), 3.0) * I * 0.6;
  } else { // Reticle: dashed target ring that fills with p1 (0..1)
    float a = atan(p.y, p.x) / 6.2832 + 0.5;
    float ring = smoothstep(0.78, 0.84, d) * (1.0 - smoothstep(0.92, 0.98, d));
    float dash = step(0.5, fract(a * 16.0 + uTime * 0.6));
    float fill = smoothstep(p1 + 0.02, p1 - 0.02, d) * 0.22;
    float cross = (1.0 - smoothstep(0.015, 0.04, min(abs(p.x), abs(p.y)))) * step(0.3, d) * step(d, 0.62);
    alpha = (ring * dash + cross) * 0.55;
    matter = vec3(0.02, 0.0, 0.0);
    emit = col * (ring * (0.4 + 0.6 * dash) + fill + cross * 0.8) * I;
  }
  gl_FragColor = vec4((emit + matter * alpha) * op, alpha * op);
}`;

export class FxBatch {
  g = new THREE.InstancedBufferGeometry(); n = 0; mesh: THREE.Mesh; mat: THREE.ShaderMaterial;
  private pos: Float32Array; private rs: Float32Array; private col: Float32Array; private par: Float32Array; private attrs: THREE.InstancedBufferAttribute[];
  constructor(public max: number, atlas: THREE.Texture, order: number, depthTest: boolean) {
    const g = this.g;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5]), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    g.setIndex([0, 2, 1, 0, 3, 2]);
    this.pos = new Float32Array(max * 3); this.rs = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.par = new Float32Array(max * 4);
    const add = (n: string, arr: Float32Array, sz: number) => { const a = new THREE.InstancedBufferAttribute(arr, sz); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(n, a); return a; };
    this.attrs = [add('aPos', this.pos, 3), add('aRs', this.rs, 3), add('aCol', this.col, 4), add('aPar', this.par, 4)];
    g.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS, uniforms: { uAtlas: { value: atlas }, uTime: { value: 0 } },
      transparent: true, depthWrite: false, depthTest, side: THREE.DoubleSide, toneMapped: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = order;
  }
  begin(t: number) { this.n = 0; this.mat.uniforms.uTime.value = t; }
  /**
   * Add a quad at world (x, y, z), rotated by rot about Y, len along its axis and wid across.
   * c is linear RGB, I its emissive intensity, op the overall opacity, p1/p2 shape parameters.
   */
  add(x: number, y: number, z: number, rot: number, len: number, wid: number, c: readonly number[], I: number, shape: number, op: number, p1 = 0, p2 = 0) {
    if (this.n >= this.max || !(op > 0.003)) return;
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.rs[i * 3] = rot; this.rs[i * 3 + 1] = len; this.rs[i * 3 + 2] = wid;
    this.col[i * 4] = c[0]; this.col[i * 4 + 1] = c[1]; this.col[i * 4 + 2] = c[2]; this.col[i * 4 + 3] = I;
    this.par[i * 4] = shape; this.par[i * 4 + 1] = Math.min(1.5, op); this.par[i * 4 + 2] = p1; this.par[i * 4 + 3] = p2;
  }
  flush() {
    this.g.instanceCount = this.n;
    if (!this.n) return;
    for (const a of this.attrs) { a.clearUpdateRanges(); a.addUpdateRange(0, this.n * a.itemSize); a.needsUpdate = true; }
  }
}
