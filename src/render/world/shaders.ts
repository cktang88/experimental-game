// City shaders. The night city is stylized: dark extruded blocks whose only detail is light —
// procedural window grids, street lamps, traffic and fires. Buildings use the shared
// MeshStandardMaterial (moon, explosion lights, the ship's shadow) with a patch that adds windows,
// roof lips, burning floors and the collapse animation; lights are additive instanced quads.
// City space = the root group's local space (world minus the scroll), so state lives on the GPU
// and the CPU only touches buildings whose damage state changed.
import * as THREE from 'three';
import { DARK } from '../../game/worldgen';
import { TERR, FIRE } from '../../game/terrain';

/** Blackout grid (see worldgen DARK): CITY.time each cell went dark, 0 = lit. */
export const darkTex = new THREE.DataTexture(DARK.data, DARK.n, DARK.n, THREE.RedFormat, THREE.FloatType);
darkTex.minFilter = darkTex.magFilter = THREE.NearestFilter; darkTex.needsUpdate = true;
/** Baked terrain (terrain.ts TERR): shade, water, cover, biome-B weight. Rows wrap (city y ring buffer). */
export const terrTex = new THREE.DataTexture(TERR.data, TERR.nx, TERR.ny, THREE.RGBAFormat, THREE.UnsignedByteType);
terrTex.minFilter = terrTex.magFilter = THREE.LinearFilter; terrTex.wrapT = THREE.RepeatWrapping; terrTex.wrapS = THREE.ClampToEdgeWrapping;
terrTex.generateMipmaps = false; terrTex.needsUpdate = true;
/** Ground fires and broken ice (terrain.ts FIRE): CITY.time it started, kind. */
export const fireTex = new THREE.DataTexture(FIRE.data, FIRE.n, FIRE.n, THREE.RGFormat, THREE.FloatType);
fireTex.minFilter = fireTex.magFilter = THREE.NearestFilter; fireTex.needsUpdate = true;

/** Uniforms shared by every city shader. */
export const U = {
  uTime: { value: 0 },
  /** Scroll offset of the city root in world z (traffic wraps in world space). */
  uScrollZ: { value: 0 },
  uDark: { value: darkTex },
  /** x0 (field), cell size (field), groundScale k, camera z. */
  uDarkMap: { value: new THREE.Vector4(DARK.x0, DARK.cell, 1.65, 641) },
  /** groundScale and one storey in world units. */
  uK: { value: 1.65 }, uFloor: { value: 7 },
  uWinCol: { value: new THREE.Color('#ffb347') },
  uLampCol: { value: new THREE.Color('#ffb347') },
  /** Traffic loop: world z of the top of the loop and its length. */
  uLoop: { value: new THREE.Vector2(-2000, 4000) },
  uTerr: { value: terrTex },
  /** Terrain grid: x0 (field), cell, width and height of the ring (field units). */
  uTerrMap: { value: new THREE.Vector4(TERR.x0, TERR.cell, TERR.nx * TERR.cell, TERR.ny * TERR.cell) },
  uFire: { value: fireTex },
  /** Fire grid: x0 (field), cell, cells per side. */
  uFireMap: { value: new THREE.Vector3(FIRE.x0, FIRE.cell, FIRE.n) },
  /**
   * Ground palettes of biome A and B (blended by the terrain's B weight): flat ground, moonlit faces, canopy,
   * canopy highlights, water, and params (x freeze, y texture: 0 urban 1 sand 2 snow 3 grass, z shadow depth).
   */
  uPA: { value: Array.from({ length: 6 }, () => new THREE.Vector3()) },
  uPB: { value: Array.from({ length: 6 }, () => new THREE.Vector3()) },
  /** Where the night city's traffic may run: +1 the city is biome A, -1 it is biome B, 0 no city. */
  uCityW: { value: 1 },
  /**
   * Thermal-view hook (0 normal .. 1 thermal): every world shader blends to a white-hot heat value. Cool terrain,
   * colder water, warm lit windows and traffic, fires hottest. Set with setWorldThermal().
   */
  uThermal: { value: 0 },
};
/** Thermal / FLIR view hook for the world layer (0..1). */
export function setWorldThermal(k: number) { U.uThermal.value = Math.max(0, Math.min(1, k)); }

export const GLSL_COMMON = /* glsl */ `
uniform float uTime; uniform sampler2D uDark; uniform vec4 uDarkMap; uniform float uThermal;
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h12(i), h12(i+vec2(1,0)), f.x), mix(h12(i+vec2(0,1)), h12(i+vec2(1,1)), f.x), f.y); }
/** 1 while the city around city-space point cp has power; fades out after the blackout reaches it. */
float powerAt(vec3 cp, float r){
  float fx = cp.x / uDarkMap.z + 800.0;
  float fy = (cp.z - uDarkMap.w) / uDarkMap.z + 450.0 + uDarkMap.w;
  float cx = clamp(floor((fx - uDarkMap.x) / uDarkMap.y), 0.0, ${DARK.n - 1}.0);
  float cy = mod(floor(fy / uDarkMap.y), ${DARK.n}.0);
  float d = texelFetch(uDark, ivec2(int(cx), int(cy)), 0).r;
  return d <= 0.0 ? 1.0 : 1.0 - smoothstep(0.0, 0.25, uTime - (d + r * 2.2));
}
`;

/* ---------------- buildings ---------------- */
// Per instance: aB (seed, lit fraction, keepLit, style), aS (collapseT, fire, neon, 0).
// Window patterns by worldgen Style: bay width (storeys), window w/h (cell fraction), sill height.
const BLD_VERT_HEAD = /* glsl */ `
attribute vec4 aB; attribute vec4 aS;
uniform float uTime; uniform float uK;
varying vec3 vObj; varying vec3 vSz; varying vec3 vNo; varying vec4 vB; varying vec4 vS; varying vec3 vCity; varying float vH; varying float vFall;
`;
const BLD_VERT = /* glsl */ `
vec3 transformed = vec3(position);
float sy = length(instanceMatrix[1].xyz), z0 = instanceMatrix[3].y;
vSz = vec3(length(instanceMatrix[0].xyz), sy, length(instanceMatrix[2].xyz));
vNo = normal; vB = aB; vS = aS; vFall = 0.0;
vH = z0 + position.y * sy;
if (aS.x > 0.0) {
  // Collapse: the block shudders, sinks into its own footprint and spreads into a low heap.
  float p = clamp((uTime - aS.x) / 1.7, 0.0, 1.0), e = p * p;
  float heap = z0 > 0.2 ? 0.0 : min(sy, 1.4 * uK + sy * 0.06);
  float wy = mix(vH, position.y * heap, e);
  transformed.y = (wy - z0) / max(sy, 0.001);
  transformed.xz *= mix(1.0, 1.14 + 0.1 * fract(aB.x * 13.0), e);
  transformed.x += sin(uTime * 55.0 + aB.x * 40.0) * 0.012 * (1.0 - p) * step(0.0001, p) * position.y;
  vH = wy; vFall = p;
}
vObj = transformed * vSz;
vCity = (instanceMatrix * vec4(transformed, 1.0)).xyz;
`;
const BLD_FRAG_HEAD = /* glsl */ `
uniform float uFloor; uniform float uK; uniform vec3 uWinCol;
varying vec3 vObj; varying vec3 vSz; varying vec3 vNo; varying vec4 vB; varying vec4 vS; varying vec3 vCity; varying float vH; varying float vFall;
const vec3 NEON0 = vec3(1.0, 0.78, 0.5); const vec3 NEON1 = vec3(0.42, 0.52, 1.0); const vec3 NEON2 = vec3(0.17, 1.0, 0.75); const vec3 NEON3 = vec3(1.0, 0.63, 0.19);
`;
const BLD_FRAG = /* glsl */ `
{
  vec3 n = normalize(vNo);
  float seed = vB.x, litF = vB.y, keep = vB.z, sty = vB.w, fire = vS.y, neon = vS.z;
  float flick = 0.75 + 0.25 * sin(uTime * 9.0 + seed * 50.0) * sin(uTime * 13.7 + seed * 23.0);
  float heat = 0.18 + fire * 0.8;
  if (n.y > 0.5) {
    // Roof: dark membrane with a lighter parapet lip that catches the moon; shells (radomes, rockets) stay pale;
    // snow (roof 1) or sand (0.5) settles on the roofs of the mountains and the desert.
    float edge = min(vSz.x * 0.5 - abs(vObj.x), vSz.z * 0.5 - abs(vObj.z));
    float lip = 1.0 - smoothstep(0.15 * uK, 0.45 * uK, edge);
    if (sty > 10.5) diffuseColor.rgb *= sty > 11.5 ? 0.5 : 0.9;
    else diffuseColor.rgb *= mix(0.2, 0.6, lip) * (0.88 + 0.24 * h12(vec2(seed * 71.0, seed * 13.0)));
    float roof = vS.w;
    if (roof > 0.01) {
      vec3 rc = roof > 0.75 ? vec3(0.2, 0.235, 0.29) : vec3(0.15, 0.125, 0.095);
      diffuseColor.rgb = mix(diffuseColor.rgb, rc * (0.85 + 0.3 * lip), 0.85 * (1.0 - fire));
      totalEmissiveRadiance += rc * (roof > 0.75 ? 0.22 : 0.08) * (1.0 - fire);
    }
    float firePatch = smoothstep(0.55, 0.9, vnoise(vCity.xz / (1.2 * uK) + seed * 9.0 + vec2(uTime * 0.4, 0.0)));
    diffuseColor.rgb *= 1.0 - 0.6 * fire;
    totalEmissiveRadiance += vec3(1.0, 0.38, 0.08) * fire * flick * firePatch * 1.4 * (1.0 - vFall);
  } else if (n.y > -0.5) {
    diffuseColor.rgb *= 0.6;
    bool xf = abs(n.x) > 0.5;
    float u = xf ? vObj.z + vSz.z * 0.5 : vObj.x + vSz.x * 0.5;
    float faceId = xf ? (n.x > 0.0 ? 1.0 : 2.0) : (n.z > 0.0 ? 3.0 : 4.0);
    float bayK = 0.9, ww = 0.5, wh = 0.5, wy = 0.25, glass = 0.0, none = 0.0;
    if (sty < 0.5) { bayK = 0.8; ww = 0.42; wh = 0.52; }
    else if (sty < 1.5) { bayK = 0.95; ww = 0.6; wh = 0.48; }
    else if (sty < 2.5) { bayK = 1.6; ww = 0.92; wh = 0.42; wy = 0.3; }
    else if (sty < 4.5) { bayK = 0.62; ww = 0.88; wh = 0.78; wy = 0.12; glass = 1.0; }
    else if (sty < 5.5) { bayK = 2.4; ww = 0.7; wh = 0.22; wy = 0.66; }
    else if (sty < 6.5) { bayK = 1.9; ww = 0.32; wh = 0.42; wy = 0.3; }
    else if (sty > 8.5 && sty < 9.5) { bayK = 2.6; ww = 0.28; wh = 0.32; wy = 0.35; }
    else none = 1.0;
    float bay = uFloor * bayK;
    vec2 cell = vec2(floor(u / bay), floor(vH / uFloor));
    vec2 f = vec2(fract(u / bay), fract(vH / uFloor));
    float inWin = step(abs(f.x - 0.5), ww * 0.5) * step(abs(f.y - wy - wh * 0.5), wh * 0.5) * (1.0 - none);
    // Keep whole bays off the very edges so corners read as solid.
    inWin *= step(0.2 * uK, u) * step(u, (xf ? vSz.z : vSz.x) - 0.2 * uK);
    float h = h12(cell + vec2(faceId * 17.0, seed * 331.0));
    float on = step(h, litF) * inWin;
    // Far away the grid would alias into noise: fade it to its average glow.
    float aa = clamp(2.2 - 2.0 * max(fwidth(u / bay), fwidth(vH / uFloor)) * 2.5, 0.0, 1.0);
    on = mix(litF * ww * wh * 0.9, on, aa); inWin = mix(ww * wh, inWin, aa);
    float power = keep > 0.5 ? 1.0 : powerAt(vCity, h);
    // Mostly the sector's window colour, some warm-white and dim-blue (screens) rooms for variety.
    float hc = h12(cell * 0.37 + seed * 13.0);
    vec3 tone = hc < 0.62 ? uWinCol : hc < 0.86 ? vec3(1.0, 0.78, 0.52) : vec3(0.45, 0.6, 0.9);
    vec3 wc = tone * (0.25 + 0.95 * h12(cell * 1.7 + seed * 91.0) * h12(cell.yx + seed));
    if (glass > 0.5) { wc *= vec3(0.75, 0.9, 1.1); diffuseColor.rgb *= vec3(0.8, 0.95, 1.25); }
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.015, 0.018, 0.024), inWin * 0.75);
    totalEmissiveRadiance += wc * on * power * (1.0 - vFall) * 0.7;
    heat += on * power * 0.35;
    // Hangars: the door side glows where the doors stand open.
    if (sty > 9.5 && sty < 10.5 && faceId > 1.5 && faceId < 2.5) {
      float door = step(vH, vSz.y * 0.75) * step(0.15, fract(u / (6.0 * uK)));
      totalEmissiveRadiance += vec3(1.0, 0.86, 0.66) * door * litF * power * 0.5 * (1.0 - vFall);
    }
    // Ships: a line of deck lights along the sheer.
    if (sty > 11.5) {
      float dl = step(abs(vH - vSz.y * 0.85), 0.12 * uK) * step(0.8, fract(u / (2.0 * uK)));
      totalEmissiveRadiance += vec3(1.0, 0.8, 0.55) * dl * 0.8 * power * (1.0 - vFall);
    }
    // Burning floors: random windows turn to fire, and soot climbs the wall.
    float burn = step(h12(cell + 3.7 + seed), fire * 0.9) * inWin;
    diffuseColor.rgb *= 1.0 - 0.6 * fire;
    totalEmissiveRadiance += vec3(1.0, 0.38, 0.08) * burn * fire * flick * 2.2 * (1.0 - vFall * 0.7);
    // Neon trim along the top storey (Neon Sprawl).
    if (neon > 0.5) {
      vec3 nc = neon < 1.5 ? NEON0 : neon < 2.5 ? NEON1 : neon < 3.5 ? NEON2 : NEON3;
      float band = step(abs(vObj.y - vSz.y + 0.4 * uK), 0.18 * uK);
      totalEmissiveRadiance += nc * band * 1.6 * power * (1.0 - vFall);
    }
  }
  if (vFall > 0.0) {
    // Rubble: dust-grey heap with embers that cool over time.
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.035, 0.032, 0.03), vFall);
    float em = smoothstep(0.72, 0.95, vnoise(vCity.xz / (0.8 * uK) + seed * 7.0));
    totalEmissiveRadiance += vec3(1.0, 0.33, 0.06) * em * (0.1 + fire * 1.2) * flick * vFall;
    heat += em * fire;
  }
  if (uThermal > 0.001) {
    diffuseColor.rgb *= 1.0 - uThermal;
    totalEmissiveRadiance = mix(totalEmissiveRadiance, vec3(min(1.4, heat)), uThermal);
  }
}
`;

/** Patch a standard material into the city building material. */
export function buildingMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0.0 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + BLD_VERT_HEAD)
      .replace('#include <begin_vertex>', BLD_VERT);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL_COMMON + BLD_FRAG_HEAD)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + BLD_FRAG);
  };
  m.customProgramCacheKey = () => 'city-bld-v2';
  return m;
}

/* ---------------- lights: lamps, pools, beacons ---------------- */
// Per instance: aL (x, y, z, size) in city space, aC (r, g, b, alpha), aK (kind, phase, 0, 0).
// Kinds: 0 street lamp core (goes dark in a blackout), 1 lamp pool on the ground, 2 always-on light,
// 3 blinking roof beacon, 4 pool that never blacks out, 5 road glow (aK.z = length along z, aK.w = 1 when the road
// runs along x), 6 sequenced strobe (approach lights: phase aK.y 0..1 along the run), 7 rotating beacon
// (white / teal), 8 lighthouse (steady, a bright flash every few seconds).
const LIGHT_VS = /* glsl */ `
attribute vec4 aL; attribute vec4 aC; attribute vec4 aK;
varying vec2 vUv; varying vec4 vC; varying float vKind; varying vec3 vP;
void main(){
  vUv = uv; vKind = aK.x;
  float pw = aK.x < 1.5 ? powerAt(aL.xyz, aK.y) : 1.0;
  float blink = aK.x > 2.5 && aK.x < 3.5 ? step(0.82, fract(uTime * 0.7 + aK.y)) : 1.0;
  vec3 lc = aC.rgb;
  if (aK.x > 5.5 && aK.x < 6.5) { float f = fract(uTime * 1.6 - aK.y * 0.9); blink = f < 0.07 ? 1.0 : 0.0; }
  if (aK.x > 6.5 && aK.x < 7.5) { float f = fract(uTime * 0.45 + aK.y); float g = fract(f * 2.0); blink = smoothstep(0.0, 0.08, g) * (1.0 - smoothstep(0.12, 0.24, g)); lc = f < 0.5 ? aC.rgb : vec3(0.35, 1.6, 1.1); }
  if (aK.x > 7.5) blink = 0.55 + 1.6 * smoothstep(0.9, 1.0, fract(uTime * 0.2 + aK.y));
  vC = vec4(lc * (1.0 - 0.5 * uThermal), aC.a * pw * blink);
  bool road = aK.x > 4.5 && aK.x < 5.5;
  vec2 sz = road ? (aK.w > 0.5 ? vec2(aK.z, aL.w) : vec2(aL.w, aK.z)) : vec2(aL.w);
  vUv = road && aK.w > 0.5 ? uv.yx : uv;
  vec3 p = aL.xyz + vec3(position.x * sz.x, 0.0, position.z * sz.y);
  vP = p;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 1.0);
  if (vC.a < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;
const LIGHT_FS = /* glsl */ `
varying vec2 vUv; varying vec4 vC; varying float vKind; varying vec3 vP;
void main(){
  float d = length(vUv * 2.0 - 1.0);
  float a; vec3 col = vC.rgb;
  if ((vKind > 0.5 && vKind < 1.5) || (vKind > 3.5 && vKind < 4.5)) a = pow(max(0.0, 1.0 - d), 1.6);
  else if (vKind > 4.5 && vKind < 5.5) { vec2 q = abs(vUv * 2.0 - 1.0); a = pow(max(0.0, 1.0 - q.x), 1.4) * (1.0 - smoothstep(0.9, 1.0, q.y)) * powerAt(vP, 0.0); }
  else { a = pow(max(0.0, 1.0 - d), 2.0); col = mix(col, vec3(1.0), pow(max(0.0, 1.0 - d * 2.5), 2.0)); }
  gl_FragColor = vec4(col * a * vC.a, 1.0);
}`;
export function lightMaterial() {
  return new THREE.ShaderMaterial({ uniforms: U, vertexShader: GLSL_COMMON + LIGHT_VS, fragmentShader: GLSL_COMMON + LIGHT_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
}

/* ---------------- traffic ---------------- */
// Per instance: aT (world x, start offset, speed, length), aC (r, g, b, a). World space (not scrolled):
// cars loop over the visible avenue stretch and are carried by the scroll.
const TRAFFIC_VS = /* glsl */ `
attribute vec4 aT; attribute vec4 aC;
uniform float uScrollZ; uniform vec2 uLoop; uniform sampler2D uTerr; uniform vec4 uTerrMap; uniform float uCityW;
varying vec2 vUv; varying vec4 vC;
void main(){
  vUv = uv; vC = aC;
  float z = uLoop.x + mod(aT.y + uTime * aT.z + uScrollZ, uLoop.y);
  vec3 p = vec3(aT.x + position.x * 0.7 * uDarkMap.z, 0.9, z + position.z * aT.w);
  float pw = powerAt(p - vec3(0.0, 0.0, uScrollZ), fract(aT.y * 0.013));
  vC.a *= 0.35 + 0.65 * pw;
  // Only on the night city's ground (the other biome's weight is in the terrain's alpha).
  float fx = aT.x / uDarkMap.z + 800.0, fy = (z - uScrollZ - uDarkMap.w) / uDarkMap.z + 450.0 + uDarkMap.w;
  float wb = texture2D(uTerr, vec2((fx - uTerrMap.x) / uTerrMap.z, fy / uTerrMap.w)).a;
  vC.a *= step(0.5, uCityW > 0.0 ? 1.0 - wb : wb) * step(0.001, abs(uCityW));
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const TRAFFIC_FS = /* glsl */ `
varying vec2 vUv; varying vec4 vC;
void main(){
  vec2 p = abs(vUv * 2.0 - 1.0);
  float a = pow(max(0.0, 1.0 - p.x), 1.5) * pow(max(0.0, 1.0 - p.y), 0.8);
  gl_FragColor = vec4(vC.rgb * a * vC.a, 1.0);
}`;
export function trafficMaterial() {
  return new THREE.ShaderMaterial({ uniforms: U, vertexShader: GLSL_COMMON + TRAFFIC_VS, fragmentShader: TRAFFIC_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
}

/* ---------------- craters ---------------- */
const CRATER_VS = /* glsl */ `
attribute vec4 aK;   // x, z (city space), radius, born
varying vec2 vUv; varying float vAge; varying float vSeed;
void main(){ vUv = uv; vAge = uTime - aK.w; vSeed = aK.x * 0.013 + aK.y * 0.007;
  vec3 p = vec3(aK.x + position.x * aK.z * 2.0, 1.1, aK.y + position.z * aK.z * 2.0);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 1.0); }`;
const CRATER_FS = /* glsl */ `
varying vec2 vUv; varying float vAge; varying float vSeed;
void main(){
  vec2 p = vUv * 2.0 - 1.0; float r = length(p);
  float n = vnoise(p * 4.0 + vSeed * 10.0);
  float rr = r + (n - 0.5) * 0.25;
  float scorch = (1.0 - smoothstep(0.35, 1.0, rr)) * 0.9;
  float rim = smoothstep(0.32, 0.42, rr) * (1.0 - smoothstep(0.42, 0.55, rr));
  vec3 col = mix(vec3(0.02, 0.018, 0.016), vec3(0.08, 0.07, 0.065), rim);
  float hot = exp(-vAge * 0.35);
  float em = smoothstep(0.6, 0.85, vnoise(p * 9.0 + vSeed * 3.0)) * (1.0 - smoothstep(0.1, 0.6, rr)) * (0.3 + 0.7 * hot);
  col += vec3(1.0, 0.32, 0.06) * em * 1.6 + vec3(1.0, 0.45, 0.1) * (1.0 - smoothstep(0.0, 0.45, rr)) * hot * 0.5;
  gl_FragColor = vec4(col, clamp(max(scorch, rim * 0.9) + em, 0.0, 1.0));
}`;
export function craterMaterial() {
  return new THREE.ShaderMaterial({ uniforms: U, vertexShader: 'uniform float uTime;\n' + CRATER_VS, fragmentShader: GLSL_COMMON + CRATER_FS, transparent: true, depthWrite: false });
}

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
export function beamMaterial() {
  return new THREE.ShaderMaterial({ uniforms: { uCol: { value: new THREE.Color('#bcd6ff').multiplyScalar(0.4) }, uA: { value: 0 } }, vertexShader: BEAM_VS, fragmentShader: BEAM_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
}

/* ---------------- terrain (the ground of every biome) ---------------- */
// A patched MeshStandardMaterial (moon, explosion lights and the ship's shadow still land on it). The terrain grid
// gives moonlight shade, water, canopy and the biome blend; detail is procedural; the fire grid adds wildfire fronts,
// burning oil and broken ice. Fire timings mirror terrain.ts BURN_T (forest 16 s, oil 26 s, ice 10 s, scrub 7 s).
const TER_VERT_HEAD = /* glsl */ `varying vec3 vWP;`;
const TER_VERT = /* glsl */ `vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;`;
const TER_FRAG_HEAD = /* glsl */ `
uniform sampler2D uTerr; uniform vec4 uTerrMap; uniform sampler2D uFire; uniform vec3 uFireMap;
uniform vec3 uPA[6]; uniform vec3 uPB[6]; uniform float uScrollZ; uniform float uK;
varying vec3 vWP;
float burnDur(float k){ return k < 1.5 ? 16.0 : k < 2.5 ? 26.0 : k < 3.5 ? 10.0 : 7.0; }
`;
const TER_FRAG = /* glsl */ `
{
  // Field coordinates of this ground point: x, and city y (constant while the world scrolls).
  vec2 fp = vec2(vWP.x / uK + 800.0, (vWP.z - uScrollZ - uDarkMap.w) / uK + 450.0 + uDarkMap.w);
  vec4 t = texture2D(uTerr, vec2((fp.x - uTerrMap.x) / uTerrMap.z, fp.y / uTerrMap.w));
  float sh = t.r, wat = t.g, cov = t.b, wb = t.a;
  vec3 P0 = mix(uPA[0], uPB[0], wb), P1 = mix(uPA[1], uPB[1], wb), P2 = mix(uPA[2], uPB[2], wb);
  vec3 P3 = mix(uPA[3], uPB[3], wb), P4 = mix(uPA[4], uPB[4], wb), P5 = mix(uPA[5], uPB[5], wb);
  float n1 = vnoise(fp * 0.045), n2 = vnoise(fp * 0.31 + 7.0), n3 = vnoise(fp * 1.1 + 3.0);
  float lit = smoothstep(0.5, 0.92, sh), shd = smoothstep(0.5, 0.08, sh);
  vec3 alb = P0 * (0.72 + 0.4 * n1 + 0.14 * n2) * (1.0 - shd * P5.z);
  vec3 em = P1 * lit * (0.7 + 0.3 * n2);
  float ty = P5.y;
  // Sand: wind ripples across the dunes. Snow: crisp glitter on the moonlit faces. Grass: mottled turf.
  float sand = 1.0 - smoothstep(0.5, 1.0, abs(ty - 1.0)), snow = 1.0 - smoothstep(0.5, 1.0, abs(ty - 2.0)), grass = 1.0 - smoothstep(0.5, 1.0, abs(ty - 3.0));
  alb *= 1.0 + sand * 0.12 * sin(fp.x * 0.9 + fp.y * 0.45 + n2 * 9.0);
  if (snow > 0.01) em += P1 * snow * pow(h12(floor(fp * 1.7)), 60.0) * (0.3 + 2.0 * lit);
  alb *= 1.0 - grass * 0.25 * n3;
  float cv = 0.0, wm = 0.0;
  if (cov > 0.12) {
    // Canopy: clumped crowns that catch the moon on their upper-left side.
    float crowns = smoothstep(0.3, 0.8, vnoise(fp * 0.32) * 0.65 + vnoise(fp * 0.7 + 11.0) * 0.45);
    cv = smoothstep(0.32, 0.62, cov + (n2 - 0.5) * 0.35);
    alb = mix(alb, P2 * (0.35 + 1.0 * crowns), cv);
    em = mix(em, P3 * crowns * crowns * (0.25 + lit * 1.8) * (0.6 + 0.8 * n1), cv);
  }
  float crack = 0.0;
  if (wat > 0.3) {
    // Water: near-black, moonlit ripples drifting in patches; a pale line of surf at the shore; ice when frozen.
    wm = smoothstep(0.42, 0.58, wat);
    float frz = P5.x;
    float swath = smoothstep(0.55, 0.9, vnoise(vec2(fp.x * 0.004 + fp.y * 0.002, fp.y * 0.003) + uTime * 0.004));
    float rip = pow(vnoise(vec2(fp.x * 0.09 + uTime * 0.05, fp.y * 0.45 - uTime * 0.25)), 10.0);
    vec3 wAlb = P4 * (0.8 + 0.3 * n1), wEm = vec3(0.45, 0.55, 0.7) * rip * (0.03 + 0.4 * swath) * (1.0 - frz) + P4 * 0.2 + vec3(0.004, 0.007, 0.011) * swath;
    float surf = (1.0 - smoothstep(0.0, 0.12, abs(wat - 0.5))) * (1.0 - frz);
    wEm += vec3(0.35, 0.4, 0.45) * surf * (0.4 + 0.6 * n3);
    if (frz > 0.01) crack = (1.0 - smoothstep(0.0, 0.035, abs(vnoise(fp * 0.09) - 0.5))) + 0.5 * (1.0 - smoothstep(0.0, 0.03, abs(vnoise(fp * 0.27 + 4.0) - 0.5)));
    vec3 iAlb = P0 * 0.55 + vec3(0.02, 0.03, 0.05), iEm = P1 * (0.25 + 0.2 * n2) + vec3(0.12, 0.16, 0.22) * crack * 0.35;
    wAlb = mix(wAlb, iAlb, frz); wEm = mix(wEm, iEm, frz);
    alb = mix(alb, wAlb, wm); em = mix(em, wEm, wm);
  }
  float heat = mix(0.07 + 0.05 * (1.0 - shd), 0.02, wm) + 0.03 * cv;
  // Ground fires (the grid is coarse: warp the lookup so fronts read as ragged lines, not squares).
  vec2 fq = fp + (vec2(n2, n3) - 0.5) * uFireMap.y * 0.9;
  float gx = floor((fq.x - uFireMap.x) / uFireMap.y), gy = mod(floor(fq.y / uFireMap.y), uFireMap.z);
  if (gx >= 0.0 && gx < uFireMap.z) {
    vec2 f = texelFetch(uFire, ivec2(int(gx), int(gy)), 0).rg;
    if (f.x > 0.0) {
      float age = uTime - f.x, dur = burnDur(f.y);
      if (f.y > 2.5 && f.y < 3.5) {
        // Broken ice: black water spreading out with the cracks, steaming.
        float hole = smoothstep(0.2, 0.9, age * 0.8 + n2 * 0.6 - 0.3);
        alb = mix(alb, P4 * 0.6, hole * wm); em = mix(em, vec3(0.0), hole * wm * 0.8);
        em += vec3(0.25, 0.3, 0.36) * crack * (1.0 - hole) * wm;
      } else if (age > 0.0) {
        float on = smoothstep(0.0, 1.2, age) * (1.0 - smoothstep(dur * 0.55, dur, age));
        float flick = 0.6 + 0.4 * sin(uTime * 9.0 + n3 * 30.0) * sin(uTime * 6.3 + n2 * 17.0);
        float tongues = smoothstep(0.35, 0.8, vnoise(fq * 0.35 + vec2(0.0, -uTime * 1.4)));
        vec3 fc = f.y > 1.5 && f.y < 2.5 ? vec3(1.0, 0.42, 0.08) : vec3(1.0, 0.36, 0.06);
        float charK = smoothstep(0.0, 3.0, age);
        alb *= 1.0 - 0.8 * charK;
        em *= 1.0 - 0.85 * charK;
        em += fc * on * (0.25 + 1.6 * tongues) * flick;
        em += vec3(1.0, 0.3, 0.05) * smoothstep(0.82, 0.95, n3) * charK * (1.0 - on) * 0.25;
        heat += on * (0.6 + 0.6 * tongues) + charK * 0.08;
      }
    }
  }
  diffuseColor.rgb = alb;
  totalEmissiveRadiance += em;
  if (uThermal > 0.001) {
    diffuseColor.rgb *= 1.0 - uThermal;
    totalEmissiveRadiance = mix(totalEmissiveRadiance, vec3(heat), uThermal);
  }
}
`;
export function terrainMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + TER_VERT_HEAD)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n' + TER_VERT);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL_COMMON + TER_FRAG_HEAD)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + TER_FRAG);
  };
  m.customProgramCacheKey = () => 'city-terrain-v1';
  return m;
}
