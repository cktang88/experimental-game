// City materials. Every surface of the city is lit by the same moon, explosion lights and shadow map
// as the rest of the game (MeshStandardMaterial), with shader hooks for what a static texture cannot
// do from this altitude: procedural window grids that go dark as the dreadnought passes, burning
// floors, collapse, parapets, snow, lane markings, rails and atmospheric haze.
//
// All shaders share one uniform block (U) and one texture atlas built from the Quaternius Downtown
// PBR set (scripts/assets/build-citytex.mjs). City-space position = world position minus the scroll,
// so textures stay glued to the ground while the root group scrolls.
import * as THREE from 'three';
import { DARK } from '../../game/worldgen';

/** Atlas tiles (mirrors scripts/assets/build-citytex.mjs). */
export const enum Tile { Brick = 0, Concrete = 1, Metal = 2, Asphalt = 3, Dirt = 4, Slate = 5, Drips = 6, Trim = 7 }

const atlasTex = (() => {
  const t = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}assets/textures/city-atlas.webp`);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
})();

/** Blackout grid (see worldgen DARK): CITY.time each cell went dark, 0 = lit. */
export const darkTex = new THREE.DataTexture(DARK.data, DARK.n, DARK.n, THREE.RedFormat, THREE.FloatType);
darkTex.minFilter = darkTex.magFilter = THREE.NearestFilter; darkTex.needsUpdate = true;

/** Uniforms shared by every city shader. */
export const U = {
  uTime: { value: 0 },
  uScroll: { value: 0 },
  uAtlas: { value: atlasTex },
  uDark: { value: darkTex },
  /** x0 (field), cell size (field), groundScale k, camera z. */
  uDarkMap: { value: new THREE.Vector4(-330, 40, 1.65, 641) },
  uWinCol: { value: new THREE.Color('#ffb347') },
  uLampCol: { value: new THREE.Color('#ffb347') },
  /** Haze colour near the ground (city glow) and its strength. */
  uHazeCol: { value: new THREE.Color('#2a2420') },
  /** amount, scale height (world), distance start, distance amount. */
  uHaze: { value: new THREE.Vector4(0.35, 90, 3000, 0.0) },
  uSnow: { value: 0 },
  /** Ground tint per theme (multiplies surfaces) and the ash/neon flavour. */
  uGroundTint: { value: new THREE.Color('#ffffff') },
  uNeon: { value: 0 },
  uWater: { value: new THREE.Color('#05080c') },
};

export const GLSL_COMMON = /* glsl */ `
uniform float uTime; uniform float uScroll; uniform sampler2D uAtlas; uniform sampler2D uDark; uniform vec4 uDarkMap;
uniform vec3 uWinCol; uniform vec3 uLampCol; uniform vec3 uHazeCol; uniform vec4 uHaze; uniform float uSnow; uniform vec3 uGroundTint; uniform float uNeon; uniform vec3 uWater;
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float h11(float p){ p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h12(i), h12(i+vec2(1,0)), f.x), mix(h12(i+vec2(0,1)), h12(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ return 0.55*vnoise(p) + 0.3*vnoise(p*2.03+7.1) + 0.15*vnoise(p*4.1+3.3); }
vec4 atlas(float tile, vec2 uv){
  vec2 o = vec2(mod(tile, 4.0) * 0.25, tile < 3.5 ? 0.5 : 0.0);
  vec2 f = 0.006 + fract(uv) * 0.988;
  vec2 s = vec2(0.25, 0.5);
  return textureGrad(uAtlas, o + f * s, dFdx(uv) * s, dFdy(uv) * s);
}
/** CITY.time the blackout reached this city point (0 = still lit). */
float darkAt(vec3 cp){
  float fx = cp.x / uDarkMap.z + 800.0;
  float fy = (cp.z - uDarkMap.w) / uDarkMap.z + 450.0 + uDarkMap.w;
  float cx = clamp(floor((fx - uDarkMap.x) / uDarkMap.y), 0.0, 63.0);
  float cy = mod(floor(fy / uDarkMap.y), 64.0);
  return texelFetch(uDark, ivec2(int(cx), int(cy)), 0).r;
}
/** 1 while lit, fading to 0 after the blackout reaches it (r staggers individual lights). */
float powerAt(vec3 cp, float r){
  float d = darkAt(cp);
  return d <= 0.0 ? 1.0 : 1.0 - smoothstep(0.0, 0.25, uTime - (d + r * 2.2));
}
vec3 applyHaze(vec3 col, vec3 wp){
  float h = uHaze.x * exp(-max(wp.y, 0.0) / uHaze.y);
  return mix(col, uHazeCol, clamp(h, 0.0, 1.0));
}
`;

/* ---------------- buildings ---------------- */
// Per-instance: aB0 (style, seed, litFraction, floorHeight), aB1 (keepLit, burnT, collapseT, fire),
// aB2 (tint rgb, base height of the tier), aB3 (broken, neon, round, unused).
const BLD_VERT_PRE = /* glsl */ `
attribute vec4 aB0; attribute vec4 aB1; attribute vec4 aB2; attribute vec4 aB3;
varying vec3 vObj; varying vec3 vSz; varying vec3 vNo; varying vec4 vB0; varying vec4 vB1; varying vec4 vB2; varying vec4 vB3; varying vec3 vWP;
uniform float uTime;
`;
const BLD_COLLAPSE = /* glsl */ `
vec3 transformed = vec3(position);
vSz = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
vNo = normal; vB0 = aB0; vB1 = aB1; vB2 = aB2; vB3 = aB3;
if (aB1.z > 0.0) {
  float p = clamp((uTime - aB1.z) / 2.4, 0.0, 1.0);
  float e = p * p;
  float side = fract(aB0.y * 17.0) < 0.5 ? -1.0 : 1.0;
  transformed.y -= e * 1.03;
  transformed.x += side * position.y * e * 0.22;
  transformed.xz += (vec2(h11(aB0.y + floor(uTime * 30.0)), h11(aB0.y * 3.1 + floor(uTime * 30.0))) - 0.5) * 0.02 * (1.0 - p) * step(0.0001, p);
}
vObj = transformed * vSz;
`;
const BLD_FRAG = /* glsl */ `
vec3 bldEmit = vec3(0.0); float bldRough = 0.85; float bldMetal = 0.0;
{
  vec3 n = normalize(vNo);
  vec3 cp = vWP - vec3(0.0, 0.0, uScroll);
  float style = vB0.x, seed = vB0.y, litF = vB0.z, fh = vB0.w;
  bool roof = n.y > 0.45;
  bool xFace = abs(n.x) > 0.5;
  float round_ = vB3.z;
  float faceW = xFace ? vSz.z : vSz.x;
  float u = xFace ? vObj.z + vSz.z * 0.5 : vObj.x + vSz.x * 0.5;
  if (round_ > 0.5) { float a = atan(vObj.z / vSz.z, vObj.x / vSz.x); u = (a + 3.14159) * vSz.x * 0.5; faceW = 3.14159 * vSz.x; }
  float v = vObj.y + vB2.w;
  float faceId = xFace ? (n.x > 0.0 ? 1.0 : 2.0) : (n.z > 0.0 ? 3.0 : 4.0);
  // Facade material per style.
  float tile = 1.0; vec3 tint = vB2.rgb; float texS = 1.0 / 10.0;
  float bayK = 0.9, winW = 0.5, winH = 0.5, winY = 0.25, glassy = 0.0;
  if (style < 0.5) { tile = 0.0; bayK = 0.8; winW = 0.42; winH = 0.52; texS = 1.0 / 7.0; }
  else if (style < 1.5) { tile = 1.0; bayK = 0.95; winW = 0.6; winH = 0.48; }
  else if (style < 2.5) { tile = 7.0; bayK = 1.6; winW = 0.92; winH = 0.42; winY = 0.3; }
  else if (style < 3.5) { tile = 1.0; bayK = 0.62; winW = 0.88; winH = 0.8; winY = 0.12; glassy = 1.0; }
  else if (style < 4.5) { tile = 1.0; bayK = 0.5; winW = 0.86; winH = 0.84; winY = 0.1; glassy = 1.0; }
  else if (style < 5.5) { tile = 2.0; bayK = 2.4; winW = 0.7; winH = 0.22; winY = 0.66; texS = 1.0 / 14.0; }
  else if (style < 6.5) { tile = 7.0; bayK = 1.9; winW = 0.32; winH = 0.42; winY = 0.3; }
  else if (style < 7.5) { tile = 1.0; bayK = 0.9; winW = 0.55; winH = 0.5; }
  else { tile = 2.0; texS = 1.0 / 16.0; litF = 0.0; }
  vec2 tuv = roof ? cp.xz : vec2(u, v);
  vec3 base;
  if (roof) {
    float rt = style > 5.5 && style < 6.5 ? 5.0 : (h11(seed * 7.0) < 0.5 ? 1.0 : 3.0);
    base = atlas(rt, cp.xz / (rt > 4.5 ? 9.0 : 16.0)).rgb;
    base = mix(base, base * vec3(0.8, 0.85, 0.95), h11(seed * 3.0));
    // Parapet: a lighter lip around the roof edge, darker gravel inside.
    float edge = min(vSz.x * 0.5 - abs(vObj.x), vSz.z * 0.5 - abs(vObj.z));
    float lip = (round_ > 0.5) ? 0.0 : 1.0 - smoothstep(0.5, 1.2, edge);
    base *= mix(0.55, 1.15, lip);
    base *= 0.85 + 0.3 * vnoise(cp.xz * 0.15 + seed * 40.0);
    if (style > 4.5 && style < 5.5) {
      // Industrial roof: corrugation and rows of skylights.
      float sk = step(0.82, fract(vObj.x / 9.0)) * step(2.5, edge);
      base = mix(base, vec3(0.06, 0.08, 0.1), sk * 0.8);
      bldEmit += vec3(0.25, 0.35, 0.45) * sk * step(0.55, h11(floor(vObj.x / 9.0) + seed * 9.0)) * 0.35 * powerAt(cp, 0.5);
    }
    base = mix(base, vec3(0.78, 0.84, 0.92), uSnow * (0.75 + 0.25 * lip));
    bldRough = 0.92;
  } else {
    base = atlas(tile, tuv * texS).rgb * tint;
    float drip = atlas(6.0, vec2(u * 0.04 + seed, v * 0.02)).r;
    base *= mix(0.62, 1.05, drip);
    if (style > 4.5 && style < 5.5) base *= 0.75 + 0.25 * step(0.5, fract(u * 0.9));
    if (style > 7.5) base *= 0.8 + 0.2 * step(0.06, fract(v / (fh * 1.5)));
    if (glassy > 0.5) { base = mix(base * 0.18, tint * 0.08, 0.6); bldRough = 0.3; bldMetal = 0.5; }
    // Sodium street glow washing up the lower floors.
    bldEmit += uLampCol * 0.10 * exp(-v / (fh * 1.4)) * powerAt(cp, 0.3);
  }
  // Windows.
  if (!roof && litF > 0.0 && style < 7.5) {
    vec2 cell = vec2(fh * bayK, fh);
    float nb = max(1.0, floor((faceW - fh * 0.3) / cell.x));
    float u0 = (faceW - nb * cell.x) * 0.5;
    vec2 c = vec2((u - u0) / cell.x, v / cell.y);
    vec2 id = floor(c), f = fract(c);
    vec2 fw = max(fwidth(c), vec2(1e-4));
    float mx = (1.0 - winW) * 0.5, y0 = winY, y1 = winY + winH;
    float wx = smoothstep(mx - fw.x, mx + fw.x, f.x) * (1.0 - smoothstep(1.0 - mx - fw.x, 1.0 - mx + fw.x, f.x));
    float wy = smoothstep(y0 - fw.y, y0 + fw.y, f.y) * (1.0 - smoothstep(y1 - fw.y, y1 + fw.y, f.y));
    float inside = step(0.0, id.x) * step(id.x, nb - 1.0);
    float topF = floor((vSz.y + vB2.w) / fh);
    inside *= step(id.y, topF - 1.0) * step(v, vSz.y + vB2.w - fh * 0.35);
    float win = wx * wy * inside;
    vec2 wid = id + vec2(faceId * 131.0, seed * 977.0);
    float r = h12(wid), r2 = h12(wid * 1.37 + 5.1), r3 = h12(wid * 0.71 + 9.7);
    // Whole floors tend to be lit or dark together (offices, apartments).
    float floorK = mix(0.25, 1.75, h12(vec2(id.y, faceId) + seed * 311.0));
    float colK = mix(0.5, 1.5, h12(vec2(id.x * 1.3, faceId) + seed * 173.0));
    float lit = step(r, litF * floorK);
    // Ground floor: shopfronts, mostly lit.
    float shop = 1.0 - step(0.5, id.y);
    lit = mix(lit, step(0.35, r2), shop);
    vec3 wc = mix(uWinCol, vec3(1.0, 0.9, 0.74), step(0.6, r2));
    wc = mix(wc, vec3(0.55, 0.72, 1.0), step(0.94, r3));
    float inten = mix(0.35, 1.2, r3 * r3) * (1.0 + shop * 0.3);
    // TV flicker in a few windows.
    inten *= 1.0 - step(0.97, r2) * 0.5 * step(0.5, fract(sin(uTime * 3.0 + r * 40.0) * 43758.5));
    // Blackout: the grid says when power died here; each window goes out on its own beat.
    float power = vB1.x > 0.5 ? 1.0 : max(powerAt(cp, r3), step(0.975, r) * 0.6);
    if (vB1.z > 0.0) power = 0.0;
    // Anti-aliasing at altitude: when floors (or bays) shrink below a pixel, average along that axis
    // only, so compressed facades still read as columns (or bands) of light rather than mush.
    float lodX = smoothstep(0.3, 0.8, fw.x), lodY = smoothstep(0.3, 0.8, fw.y);
    float aW = winW * 0.85, aH = winH * 0.85;
    vec3 eDet = win * lit * wc * inten;
    vec3 eY = wx * inside * uWinCol * litF * colK * aH * 0.7;          // floors merged: columns
    vec3 eX = wy * inside * uWinCol * litF * floorK * aW * 0.7;        // bays merged: bands
    vec3 eXY = inside * uWinCol * litF * aW * aH * 0.6 * mix(0.6, 1.4, h12(floor(vec2(u, v) / (fh * 6.0)) + seed));
    vec3 we = mix(mix(eDet, eY, lodY), mix(eX, eXY, lodY), lodX) * power;
    // Fire behind the glass: floors near the damage glow and flicker.
    float fire = vB1.w;
    if (fire > 0.0) {
      float fr = h12(wid * 2.3 + 1.0);
      float burn = step(fr, fire * 0.9) * (0.6 + 0.4 * sin(uTime * (9.0 + fr * 7.0) + fr * 30.0));
      vec3 fc = mix(vec3(1.0, 0.35, 0.08), vec3(1.0, 0.7, 0.3), fr) * 3.0;
      we += mix(win * burn * fc, fc * fire * 0.25 * winW * winH, max(lodX, lodY));
      we += vec3(0.6, 0.15, 0.02) * fire * 0.12 * (0.7 + 0.3 * sin(uTime * 5.0 + v));
    }
    bldEmit += we * 1.5;
    base = mix(base, base * 0.25 + vec3(0.01, 0.012, 0.016), win * (1.0 - glassy) * 0.85);
    bldRough = mix(bldRough, 0.25, win);
  }
  // Neon trims on the corners and crowns of the sprawl's towers.
  if (vB3.y > 0.5 && !roof) {
    float edgeU = min(u, faceW - u);
    vec3 nc = vB3.y < 1.5 ? vec3(1.0, 0.25, 0.75) : vB3.y < 2.5 ? vec3(0.65, 0.3, 1.0) : vB3.y < 3.5 ? vec3(0.2, 1.0, 0.75) : vec3(1.0, 0.6, 0.2);
    float strip = 1.0 - smoothstep(0.35, 0.9, edgeU);
    float crown = step(vSz.y + vB2.w - fh * 0.5, v) * step(v, vSz.y + vB2.w - fh * 0.25);
    float band = step(0.94, fract(v / (fh * 6.0)));
    float on = (vB1.x > 0.5 ? 1.0 : powerAt(cp, 0.2)) * (1.0 - step(0.0001, vB1.z));
    bldEmit += nc * (strip * 2.0 + crown * 3.0 + band * 0.6 * step(0.5, h11(seed * 13.0))) * on * (0.85 + 0.15 * sin(uTime * 2.0 + seed * 20.0));
  }
  // Char: scorched facade spreading from the fire, collapsed shells go black.
  float ch = max(vB1.w * 0.8, step(0.0001, vB1.z)) * (0.6 + 0.4 * vnoise(cp.xz * 0.2 + v * 0.1));
  if (style > 6.5 && style < 7.5) ch = max(ch, 0.75 + 0.2 * vnoise(vec2(u, v) * 0.3));
  base = mix(base, vec3(0.025, 0.022, 0.02), clamp(ch, 0.0, 0.9));
  diffuseColor.rgb = base * 0.55;
}
`;

function patchStandard(mat: THREE.MeshStandardMaterial, opts: { vertPre?: string; begin?: string; fragPre?: string; map?: string; postRough?: string; emissive?: string; normal?: string; key: string }) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = (opts.vertPre ?? '') + '\nvarying vec3 vWP;\n' + sh.vertexShader
      .replace('#include <begin_vertex>', opts.begin ?? '#include <begin_vertex>')
      .replace('#include <project_vertex>', `#include <project_vertex>
#ifdef USE_INSTANCING
  vWP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#else
  vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif`);
    if (opts.vertPre?.includes('varying vec3 vWP')) sh.vertexShader = sh.vertexShader.replace('\nvarying vec3 vWP;\n', '\n');
    if (!opts.vertPre?.includes('uniform float uTime')) sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader;
    sh.vertexShader = sh.vertexShader.replace('void main() {', GLSL_HASH_V + '\nvoid main() {');
    sh.fragmentShader = GLSL_COMMON + (opts.fragPre ?? '') + '\nvarying vec3 vWP;\n' + sh.fragmentShader
      .replace('#include <map_fragment>', opts.map ?? '#include <map_fragment>')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n' + (opts.postRough ?? ''))
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n' + (opts.normal ?? ''))
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + (opts.emissive ?? ''))
      .replace('#include <fog_fragment>', 'gl_FragColor.rgb = applyHaze(gl_FragColor.rgb, vWP);\n#include <fog_fragment>');
  };
  mat.customProgramCacheKey = () => opts.key;
  return mat;
}
const GLSL_HASH_V = /* glsl */ `float h11(float p){ p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }`;

export function buildingMaterial(round = false) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.0 });
  return patchStandard(m, {
    key: 'city-bld' + (round ? '-r' : ''),
    vertPre: BLD_VERT_PRE.replace('uniform float uTime;', 'uniform float uTime;').replace('varying vec3 vWP;', 'varying vec3 vWP;'),
    begin: BLD_COLLAPSE,
    fragPre: '\nvarying vec3 vObj; varying vec3 vSz; varying vec3 vNo; varying vec4 vB0; varying vec4 vB1; varying vec4 vB2; varying vec4 vB3;\n',
    map: BLD_FRAG,
    postRough: 'roughnessFactor = bldRough; metalnessFactor = bldMetal;',
    emissive: 'totalEmissiveRadiance += bldEmit;',
  });
}
/** Shadow depth material that follows the collapse animation. */
export function buildingDepthMaterial() {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime;
    sh.vertexShader = BLD_VERT_PRE.replace('varying vec3 vWP;', '') + GLSL_HASH_V + '\n' + sh.vertexShader.replace('#include <begin_vertex>', BLD_COLLAPSE);
  };
  m.customProgramCacheKey = () => 'city-bld-depth';
  return m;
}

/* ---------------- ground: pads and roads ---------------- */
// aG0: kind, seed, sizeX (world), sizeZ (world); aG1: pad origin x/z (city), street width (world), lanes.
// Kinds: 0 walk 1 plaza 2 grass 3 park 4 lot 5 gravel 6 yard 7 dock 8 rail 9 ash 10 snow 11 dirt 12 bund 20 avenue 21 street 30 base
const GROUND_FRAG = /* glsl */ `
vec3 gEmit = vec3(0.0); float gRough = 0.9; float gMetal = 0.0;
{
  vec3 cp = vWP - vec3(0.0, 0.0, uScroll);
  float kind = vG0.x, seed = vG0.y;
  vec2 lc = vObjG.xz;            // local coords centred on the pad (world units)
  vec2 hs = vG0.zw * 0.5;
  float edge = min(hs.x - abs(lc.x), hs.y - abs(lc.y));
  vec3 asph = atlas(3.0, cp.xz / 30.0).rgb * (0.75 + 0.4 * fbm(cp.xz * 0.02));
  asph *= 0.8 + 0.25 * atlas(4.0, cp.xz / 55.0).r;
  vec3 c = asph;
  float pw = powerAt(cp, h12(floor(cp.xz / 20.0)));
  if (kind > 29.5) {
    c = asph * 0.7;
  } else if (kind > 19.5) {
    // Roads. Avenues run along z, streets along x.
    bool ave = kind < 20.5;
    float lanes = vG1.w;
    float across = ave ? lc.x : lc.y;            // -w/2 .. w/2
    float along = ave ? (lc.y + hs.y) : lc.x;    // 0 .. len for avenues (top to bottom)
    float wid = ave ? vG0.z : vG0.w;
    float lw = wid / max(lanes, 1.0);
    float fwA = fwidth(across) * 1.2;
    float paint = 0.0;
    float inX = ave ? step(along, vG0.w - vG1.z) : 1.0;   // not inside the intersection band
    // Centre line (double for majors) and lane dashes.
    float cl = 1.0 - smoothstep(0.18, 0.18 + fwA, abs(abs(across) - (lanes > 2.5 ? 0.45 : 0.0)));
    float dash = step(0.5, fract(along / 9.0));
    float ld = 0.0;
    for (int i = 1; i < 4; i++) { if (float(i) >= lanes * 0.5) break; float o = float(i) * lw; ld += 1.0 - smoothstep(0.12, 0.12 + fwA, abs(abs(across) - o)); }
    paint += cl * (lanes > 2.5 ? 1.0 : dash) * inX;
    paint += ld * dash * inX * 0.8;
    // Crosswalk stripes across avenues at both ends of every intersection.
    if (ave) {
      float zA = vG0.w - vG1.z;
      float zone = step(zA - 6.0, along) * step(along, zA - 1.2) + step(1.0, along) * step(along, 5.8);
      float stripes = step(0.5, fract(across / 2.2)) * step(1.0, hs.x - abs(across));
      paint += zone * stripes * 1.2;
    }
    vec3 pc = mix(vec3(0.85, 0.82, 0.74), vec3(0.9, 0.7, 0.25), step(0.5, cl) * step(2.5, lanes));
    c = mix(c, pc * 0.55, clamp(paint, 0.0, 1.0) * 0.8);
    // Wet tyre-polished lanes and sodium pools are drawn by the light sprites.
    gRough = 0.55 + 0.3 * fbm(cp.xz * 0.05);
    c *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 1.2, edge));   // gutter
  } else {
    vec3 conc = atlas(1.0, cp.xz / 14.0).rgb;
    vec3 dirt = atlas(4.0, cp.xz / 22.0).rgb;
    float k = kind;
    if (k < 0.5) {         // sidewalk: paving slabs and a bright curb
      float g = max(1.0 - smoothstep(0.0, fwidth(cp.x) * 1.5, abs(fract(cp.x / 3.2) - 0.5) * 3.2 - 1.45), 1.0 - smoothstep(0.0, fwidth(cp.z) * 1.5, abs(fract(cp.z / 3.2) - 0.5) * 3.2 - 1.45));
      c = conc * 0.75 * (1.0 - 0.18 * g);
      c = mix(c, conc * 1.1, 1.0 - smoothstep(0.4, 0.9, edge));
    } else if (k < 1.5) {  // plaza
      c = atlas(7.0, cp.xz / 6.0).rgb * 0.7 * (0.9 + 0.2 * step(0.5, fract(cp.x / 6.0) + fract(cp.z / 6.0) - 0.5));
    } else if (k < 3.5) {  // grass / park
      float n = fbm(cp.xz * 0.06 + seed);
      c = mix(vec3(0.035, 0.05, 0.03), vec3(0.06, 0.075, 0.04), n) * (0.7 + 0.6 * dirt.r);
      // Footpaths through parks.
      float pth = 1.0 - smoothstep(0.8, 1.3, abs(sin(lc.x * 0.05 + seed * 6.0) * 18.0 - lc.y + sin(lc.x * 0.013) * 30.0));
      c = mix(c, conc * 0.55, pth * step(2.5, k));
      gRough = 1.0;
    } else if (k < 4.5) {  // parking lot
      c = asph * 0.9;
      float stall = (1.0 - smoothstep(0.1, 0.25, abs(fract(lc.x / 5.0) - 0.5) * 5.0 - 2.3)) * step(3.0, edge) * step(abs(fract(lc.y / 26.0) - 0.5), 0.3);
      c = mix(c, vec3(0.5), stall * 0.5);
    } else if (k < 6.5) {  // gravel / yard
      c = mix(dirt * 0.6, conc * 0.45, 0.5 + 0.5 * vnoise(cp.xz * 0.08)) * (k > 5.5 ? 0.8 : 1.0);
    } else if (k < 7.5) {  // dock concrete with hazard edge
      c = conc * 0.62;
      float stripe = (1.0 - smoothstep(1.0, 1.4, edge)) * step(0.5, fract((lc.x + lc.y) / 3.0));
      c = mix(c, vec3(0.55, 0.42, 0.18), stripe * 0.6);
    } else if (k < 8.5) {  // rail ballast with steel rails and sleepers
      c = mix(dirt * 0.45, vec3(0.16, 0.15, 0.14), 0.5) * (0.8 + 0.4 * vnoise(cp.xz * 0.5));
      float tx = mod(cp.x - vG1.x - vG1.z, vG1.z);   // track pitch passed in vG1.z
      float g = 1.6;
      float rail = (1.0 - smoothstep(0.18, 0.18 + fwidth(cp.x) * 1.5, abs(tx - vG1.z * 0.5 + g))) + (1.0 - smoothstep(0.18, 0.18 + fwidth(cp.x) * 1.5, abs(tx - vG1.z * 0.5 - g)));
      float slp = step(abs(tx - vG1.z * 0.5), g + 1.0) * step(0.55, fract(cp.z / 1.8));
      c = mix(c, vec3(0.12, 0.09, 0.07), slp * 0.7);
      c = mix(c, vec3(0.55, 0.57, 0.6), clamp(rail, 0.0, 1.0));
      gMetal = clamp(rail, 0.0, 1.0) * 0.8; gRough = mix(0.95, 0.3, clamp(rail, 0.0, 1.0));
    } else if (k < 9.5) {  // ash: burned earth with dying embers
      float n = fbm(cp.xz * 0.04 + seed * 3.0);
      c = mix(vec3(0.03, 0.028, 0.026), dirt * 0.35, n * 0.8);
      float em = step(0.985, h12(floor(cp.xz / 1.5))) * smoothstep(0.55, 0.8, n);
      gEmit += vec3(1.0, 0.3, 0.05) * em * (0.6 + 0.4 * sin(uTime * 3.0 + h12(floor(cp.xz / 1.5)) * 20.0)) * 1.4;
    } else if (k < 10.5) { // snow
      float n = fbm(cp.xz * 0.03);
      c = mix(vec3(0.5, 0.55, 0.62), vec3(0.72, 0.78, 0.86), n);
      c *= 0.85 + 0.15 * atlas(4.0, cp.xz / 30.0).r;
      // Tyre tracks.
      c *= 1.0 - 0.25 * step(0.92, fract(lc.x / 7.0)) * step(0.4, vnoise(cp.xz * 0.02));
      gRough = 0.75;
    } else if (k < 11.5) { c = dirt * 0.5; }
    else {                 // tank-farm bund: gravel floor, raised concrete walls at the edge
      c = mix(dirt * 0.45, conc * 0.4, 0.4);
      c = mix(c, conc * 0.8, 1.0 - smoothstep(0.8, 1.6, edge));
    }
    if (k < 1.5 || k == 4.0) c = mix(c, vec3(0.7, 0.75, 0.82), uSnow * 0.7);
  }
  c *= uGroundTint;
  diffuseColor.rgb = c * 0.6;
}
`;
export function groundMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  return patchStandard(m, {
    key: 'city-ground',
    vertPre: 'attribute vec4 aG0; attribute vec4 aG1; varying vec4 vG0; varying vec4 vG1; varying vec3 vObjG;\n',
    begin: `vec3 transformed = vec3(position); vG0 = aG0; vG1 = aG1;
#ifdef USE_INSTANCING
vObjG = position * vec3(length(instanceMatrix[0].xyz), 1.0, length(instanceMatrix[2].xyz));
#else
vObjG = position;
#endif`,
    fragPre: '\nvarying vec4 vG0; varying vec4 vG1; varying vec3 vObjG;\n',
    map: GROUND_FRAG,
    postRough: 'roughnessFactor = gRough; metalnessFactor = gMetal;',
    emissive: 'totalEmissiveRadiance += gEmit;',
  });
}

/* ---------------- water ---------------- */
export function waterMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.12, metalness: 0.2 });
  return patchStandard(m, {
    key: 'city-water',
    map: /* glsl */ `
      vec3 cpw = vWP - vec3(0.0, 0.0, uScroll);
      float wv = fbm(cpw.xz * 0.02 + vec2(uTime * 0.05, uTime * 0.03));
      diffuseColor.rgb = uWater * (0.8 + 0.4 * wv);`,
    normal: /* glsl */ `
      {
        vec3 cpn = vWP - vec3(0.0, 0.0, uScroll);
        vec2 q = cpn.xz * 0.08;
        float t = uTime * 0.6;
        float a = vnoise(q + vec2(t, 0.3 * t)) - vnoise(q * 1.7 - vec2(0.5 * t, t));
        float b = vnoise(q.yx + vec2(0.7 * t, -t)) - vnoise(q * 2.3 + vec2(t, 0.2 * t));
        vec3 pn = normalize(vec3(a * 0.35, 1.0, b * 0.35));
        normal = normalize((viewMatrix * vec4(pn, 0.0)).xyz);
      }`,
    emissive: /* glsl */ `
      {
        vec3 cpe = vWP - vec3(0.0, 0.0, uScroll);
        // Sky and city glow reflected at a grazing angle (fresnel), broken up by the swell.
        vec3 nW = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
        vec3 V = normalize(cameraPosition - vWP);
        float fr = 0.03 + 0.6 * pow(1.0 - max(dot(nW, V), 0.0), 3.0);
        float sw = fbm(cpe.xz * vec2(0.03, 0.012) + vec2(0.0, uTime * 0.08));
        totalEmissiveRadiance += (uHazeCol * 1.6 + uLampCol * 0.05 * sw) * fr;
        // Moonlight glitter.
        float gl = pow(vnoise(cpe.xz * 0.7 + vec2(uTime * 1.3, -uTime * 0.7)) * vnoise(cpe.xz * 0.53 - vec2(uTime * 0.9, uTime * 1.1)), 6.0);
        totalEmissiveRadiance += vec3(0.75, 0.82, 1.0) * gl * 6.0 * (0.4 + 0.6 * sw);
      }`,
  });
}

/* ---------------- props: metal, containers, trees, rubble ---------------- */
export type PropFlavor = 'metal' | 'container' | 'tree' | 'rubble' | 'ship';
export function propMaterial(flavor: PropFlavor) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: flavor === 'metal' ? 0.55 : 0.85, metalness: flavor === 'metal' ? 0.45 : 0.1 });
  const body: Record<PropFlavor, string> = {
    metal: `vec3 t = atlas(2.0, (abs(nW.y) > 0.5 ? cp.xz : vec2(cp.x + cp.z, cp.y)) / 12.0).rgb; diffuseColor.rgb *= t * 0.9;`,
    container: `float cor = 0.75 + 0.25 * step(0.5, fract((cp.x + cp.z) * 1.6));
      vec3 t = atlas(2.0, vec2(cp.x + cp.z, cp.y) / 10.0).rgb;
      diffuseColor.rgb *= mix(vec3(1.0), t * 1.4, 0.45) * (abs(nW.y) > 0.5 ? 1.0 : cor) * 0.75;
      if (nW.y > 0.5) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.7, 0.76, 0.84), uSnow * 0.85);`,
    tree: `float n = vnoise(cp.xz * 0.6 + cp.y * 0.3); diffuseColor.rgb *= (0.55 + 0.6 * n);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.68, 0.76), uSnow * smoothstep(0.2, 0.9, nW.y) * 0.8);`,
    rubble: `vec3 t = atlas(1.0, cp.xz / 8.0).rgb; diffuseColor.rgb *= t * (0.5 + 0.5 * vnoise(cp.xz * 0.4)) * 0.6;`,
    ship: `vec3 t = atlas(2.0, vec2(cp.x + cp.z, cp.y) / 18.0).rgb; diffuseColor.rgb *= t * 1.1;`,
  };
  return patchStandard(m, {
    key: 'city-prop-' + flavor,
    map: `{ vec3 cp = vWP - vec3(0.0, 0.0, uScroll); vec3 nW = normalize(vNW); ${body[flavor]} }`,
    vertPre: 'varying vec3 vNW;\n',
    begin: `#include <begin_vertex>
#ifdef USE_INSTANCING
vNW = normalize(mat3(instanceMatrix) * normal);
#else
vNW = normal;
#endif`,
    fragPre: '\nvarying vec3 vNW;\n',
    emissive: flavor === 'rubble' ? `{ vec3 cp = vWP - vec3(0.0, 0.0, uScroll); float e = smoothstep(0.62, 0.9, vnoise(cp.xz * 0.35 + floor(uTime * 0.0))); totalEmissiveRadiance += vec3(1.0, 0.3, 0.06) * e * (0.6 + 0.4 * sin(uTime * 2.3 + cp.x)) * max(0.0, vColor.r - vColor.g) * 30.0; }` : '',
  });
}
