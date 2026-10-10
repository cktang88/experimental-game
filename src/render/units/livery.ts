// The livery material: one PBR shader that paints every enemy unit in the same military night style.
//
// Unit geometry carries an ENCODING instead of colours (see scripts/assets/prep-units.mjs):
//   r = luminance (panel detail, grime), g = paint mask, b = lamp mask.
// It comes from the model's texture (Quaternius ships) or from vertex colours (Kenney and procedural
// parts). The shader turns it into livery paint over bare gunmetal, adds the sci-fi trim sheet's
// grunge layer in object space (triplanar), and handles two per-instance effects:
//   aFx.x = hit flash (0..1), aFx.y = burn (0 = intact, 1 = charred wreck with glowing embers).
import * as THREE from 'three';
import type { Detail } from './kit';
import { flirUniform } from '../flir';

/**
 * rim: the silhouette edge light (fresnel) every unit carries, so it reads as a hard-edged object over
 * the busy city: hostile red on everything that fights (docs/ART.md "Readability"), gold on salvage.
 */
export interface Livery { paint: number; metal: number; lamp: string; lampK: number; rim: string; rimK: number }
/** Enemy military liveries (docs/ART.md): olive drab, desert, charcoal. Lamps and rims are hostile red. */
export const LIVERY = {
  olive: { paint: 0x4f5a34, metal: 0x3d4247, lamp: '#ff5a4e', lampK: 3, rim: '#ff5a4e', rimK: 1.25 },
  desert: { paint: 0x8a7550, metal: 0x44474a, lamp: '#ff5a4e', lampK: 3, rim: '#ff5a4e', rimK: 1.1 },
  charcoal: { paint: 0x2b2f33, metal: 0x4a5058, lamp: '#ff5a4e', lampK: 3, rim: '#ff5a4e', rimK: 1.3 },
  /** Elites: charcoal with oxide-red paint. */
  elite: { paint: 0x5a2a26, metal: 0x2e3236, lamp: '#ff5a4e', lampK: 4, rim: '#ff6a4e', rimK: 1.4 },
  /** Salvage: worn hazard-yellow (scrap colour) over steel; lamps glow scrap gold. */
  salvage: { paint: 0x8a6a2a, metal: 0x4c5157, lamp: '#ffc24a', lampK: 3.5, rim: '#ffc24a', rimK: 1.0 },
  /** Poured concrete (flak towers): pale enough to read as a mass against the night city. */
  concrete: { paint: 0x8d8b84, metal: 0x5d6064, lamp: '#ff5a4e', lampK: 3, rim: '#ff5a4e', rimK: 1.1 },
  /** Infantry fatigues. */
  fatigue: { paint: 0x46502f, metal: 0x2a2c2a, lamp: '#fff1d6', lampK: 3, rim: '#ff5a4e', rimK: 0.55 },
} satisfies Record<string, Livery>;
export type LiveryName = keyof typeof LIVERY;

export const liveryUniforms = { uTime: { value: 0 } };
let blank: THREE.DataTexture | null = null;
const blankTex = () => blank ?? (blank = Object.assign(new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1), { needsUpdate: true }));

export interface LiveryOpts { map?: THREE.Texture | null; normalMap?: THREE.Texture | null; detailScale?: number; double?: boolean;
  /** A ground unit: its depth is lifted over the rooftops (GROUND_LIFT). */ ground?: boolean }
/**
 * Ground units are true scale and live at any field point, which is usually inside a city block: the buildings
 * would bury a 10 m tank. Their vertices are slid along the camera ray toward the eye by GROUND_LIFT world units of
 * depth: the projected position is unchanged (same pixels), only the depth test now sees them above the roofs,
 * and still far below the flight plane, so the dreadnought and aircraft still cover them. unitLayer lifts their
 * lights and halos the same way (liftToward).
 */
export const GROUND_LIFT = 110;
const cache = new Map<string, THREE.MeshStandardMaterial>();

/** A shared livery material (cached by livery + texture). */
export function liveryMaterial(name: LiveryName, detail: Detail | null, o: LiveryOpts = {}) {
  const key = `${name}|${o.map?.uuid ?? 'vc'}|${o.detailScale ?? 1}|${o.double ? 1 : 0}|${o.ground ? 1 : 0}`;
  const hit = cache.get(key); if (hit) return hit;
  const L: Livery = LIVERY[name];
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.4, side: o.double ? THREE.DoubleSide : THREE.FrontSide });
  if (o.map) { o.map.colorSpace = THREE.NoColorSpace; o.map.needsUpdate = true; m.map = o.map; }
  else m.vertexColors = true;
  if (o.normalMap) { m.normalMap = o.normalMap; m.normalScale.set(0.9, 0.9); }
  const lamp = new THREE.Color(L.lamp).multiplyScalar(L.lampK), rimC = new THREE.Color(L.rim).multiplyScalar(L.rimK);
  const uniforms = {
    uPaint: { value: new THREE.Color(L.paint) }, uMetal: { value: new THREE.Color(L.metal) }, uLamp: { value: lamp }, uRim: { value: rimC },
    uGrunge: { value: detail?.grunge ?? blankTex() }, uDetail: { value: 1 / (o.detailScale ?? 22) }, uTime: liveryUniforms.uTime, uFlir: flirUniform,
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec2 aFx; varying vec2 vFx; varying vec3 vObjPos; varying vec3 vObjN;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vFx = aFx; vObjPos = position; vObjN = normal;`)
      .replace('#include <project_vertex>', o.ground ? `#include <project_vertex>
{ float zf = -mvPosition.z; gl_Position = projectionMatrix * vec4(mvPosition.xyz * (max(zf - ${GROUND_LIFT.toFixed(1)}, zf * 0.5) / zf), 1.0); }` : '#include <project_vertex>');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uPaint; uniform vec3 uMetal; uniform vec3 uLamp; uniform vec3 uRim; uniform sampler2D uGrunge; uniform float uDetail; uniform float uTime; uniform float uFlir;
varying vec2 vFx; varying vec3 vObjPos; varying vec3 vObjN;
float tri(vec3 p, vec3 w) { return texture2D(uGrunge, p.yz).r * w.x + texture2D(uGrunge, p.xz).r * w.y + texture2D(uGrunge, p.xy).r * w.z; }`)
      .replace('#include <map_fragment>', `
#ifdef USE_MAP
  vec3 enc = texture2D(map, vMapUv).rgb;
#else
  vec3 enc = vec3(1.0, 0.0, 0.0);
#endif
#if defined( USE_COLOR )
  enc = vColor.rgb;
#endif
  vec3 tw = pow(abs(normalize(vObjN)), vec3(4.0)); tw /= (tw.x + tw.y + tw.z + 1e-4);
  vec3 tp = vObjPos * uDetail;
  float gr = tri(tp, tw);
  float gr2 = tri(tp * 2.7 + 0.37, tw);
  float lum = enc.r, paint = smoothstep(0.25, 0.75, enc.g), lampM = smoothstep(0.45, 0.8, enc.b);
  float wear = smoothstep(0.62, 0.7, gr2) * paint;
  vec3 base = mix(uMetal, uPaint, paint * (1.0 - wear * 0.7)) * (0.45 + 1.3 * lum * lum) * (0.6 + 0.7 * gr);
  base = mix(base, vec3(0.03, 0.028, 0.026) * (0.6 + gr), vFx.y);
  diffuseColor.rgb = base;`)
      .replace('#include <color_fragment>', '')
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = clamp(mix(0.42, 0.72, paint) * (0.75 + 0.5 * gr) + vFx.y * 0.3, 0.2, 1.0);`)
      .replace('#include <metalnessmap_fragment>', `float metalnessFactor = mix(0.7, 0.25, paint) * (1.0 - vFx.y * 0.6);`)
      .replace('#include <emissivemap_fragment>', `
  totalEmissiveRadiance = uLamp * lampM * (1.0 - vFx.y);
  totalEmissiveRadiance += vec3(1.0, 0.92, 0.82) * vFx.x * 0.55;
  // Marking rim: a thin hostile edge light on the silhouette so every unit reads as a hard-edged
  // target over the city (kept below the bloom threshold: an outline, not a glow).
  float rim = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 1.6);
  totalEmissiveRadiance += uRim * smoothstep(0.12, 0.6, rim) * 0.85 * (1.0 - vFx.y);
  // Moonlit fill: the paint stays legible in the dark (chunky, readable silhouettes over a quiet city).
  totalEmissiveRadiance += base * 0.32 * (1.0 - vFx.y);
  float ember = smoothstep(0.58, 0.8, gr2) * (0.55 + 0.45 * sin(uTime * 6.0 + vObjPos.x * 0.7 + vObjPos.z * 0.5));
  totalEmissiveRadiance += vec3(1.0, 0.32, 0.06) * ember * vFx.y * 1.6;
  // FLIR: a running machine is warmer than the night: the body glows grey-white, lamps and engines hotter,
  // the lower hull (tracks, wheels, engine bay) hottest; wrecks stay hot while they burn.
  float bodyHeat = 0.55 + 0.35 * smoothstep(0.7, -0.2, vObjN.y) + lampM * 1.2 + vFx.y * 0.8;
  totalEmissiveRadiance = mix(totalEmissiveRadiance, vec3(bodyHeat), uFlir);`);
  };
  m.customProgramCacheKey = () => `livery|${o.map ? 1 : 0}|${o.normalMap ? 1 : 0}|${o.ground ? 1 : 0}`;
  cache.set(key, m);
  return m;
}
