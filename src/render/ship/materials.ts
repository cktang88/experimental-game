// Ship material library. One PBR language for every hull, turret and greeble: the Quaternius sci-fi
// trim sheets (T_Trim_01/02/03 BaseColor + Normal + ORM, pulled from the loaded scifi kit), tinted per
// faction, plus a few procedural canvas maps for paint and light (hazard stripes, lit window rows,
// soft drop shadows, scorch). Two livery sets share every texture: player gunmetal + hazard, and the
// ghost's blood-oxide hull with hostile light.
import * as THREE from 'three';
import { source, kitLoaded } from '../assets';

export type MatKey =
  | 't1' | 't2' | 't3' | 'dark' | 'black' | 'decal' | 'hazard' | 'paint' | 'window' | 'glass' | 'lamp' | 'glow' | 'core' | 'shadow' | 'scorch' | 'pool' | 'stencil';

/** Kit material name -> library key, so kitbashed pieces merge into our own materials. */
export const KIT_MAT: Record<string, MatKey> = {
  MI_Trim_01: 't1', MI_Trim_02: 't2', MI_Trim_02_Floor: 't2', MI_Trim_02_Variation: 't2', MI_Trim_03: 't3',
  MI_Trim_03_Dark: 'dark', MI_PaddedWall: 'dark', M_Black: 'black', M_Glass: 'glass', M_Light: 'lamp',
  M_Decal_White: 'decal', MI_Decal_Line: 'hazard',
};

export interface Livery {
  hostile: boolean;
  mats: Record<MatKey, THREE.Material>;
  /** Base tints (multiplied with vertex colors) and light colors used by the builders. */
  paint: { hull: THREE.Color; plate: THREE.Color; dark: THREE.Color; accent: THREE.Color; deckLine: THREE.Color; full: THREE.Color };
  light: { window: string; edge: string; strobe: string; deck: string; engine: string; engineHot: string; energy: string; port: string; star: string; navPort: string; navStar: string };
  /** Uniforms animated by the layer (ghost flicker, window pulse). */
  u: { flicker: { value: number }; time: { value: number } };
}

/* ---------------- procedural canvas maps ---------------- */
function canvas(w: number, h: number) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function rand(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function tex(c: HTMLCanvasElement, srgb = true, repeat = true) {
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; t.needsUpdate = true; return t;
}

/** Worn diagonal hazard stripes, white so vertex color tints them (amber for us, rust for ghosts). */
function hazardMap() {
  const W = 256, H = 64, c = canvas(W, H), g = c.getContext('2d')!, r = rand(7);
  g.fillStyle = '#141414'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#e8e8e8';
  for (let x = -H; x < W + H; x += 32) { g.beginPath(); g.moveTo(x, H); g.lineTo(x + 16, H); g.lineTo(x + 16 + H, 0); g.lineTo(x + H, 0); g.closePath(); g.fill(); }
  // Chipped paint and grime.
  for (let i = 0; i < 900; i++) { const v = r(); g.fillStyle = v < 0.5 ? `rgba(20,20,20,${0.15 + r() * 0.5})` : `rgba(90,90,90,${r() * 0.35})`; g.fillRect(r() * W, r() * H, 1 + r() * 3, 1 + r() * 2); }
  const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, 'rgba(0,0,0,0.35)'); gr.addColorStop(0.15, 'rgba(0,0,0,0)'); gr.addColorStop(0.85, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.45)');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  return tex(c);
}

/** Rows of lit cabin windows: thousands of crew behind them. Grey-scale; tinted per livery. */
function windowMap() {
  const W = 512, H = 128, c = canvas(W, H), g = c.getContext('2d')!, r = rand(11);
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  const rows = 4, rh = H / rows;
  for (let row = 0; row < rows; row++) {
    let lit = r() < 0.7;
    for (let x = 2; x < W - 3; x += 4) {
      if (r() < 0.12) lit = r() < 0.72; // rooms switch on and off in runs
      if (x % 64 < 4) continue; // frame posts
      const b = lit ? 150 + r() * 105 : 18 + r() * 20, warm = r();
      g.fillStyle = warm < 0.82 ? `rgb(${b},${b * 0.86},${b * 0.62})` : `rgb(${b * 0.75},${b * 0.9},${b})`;
      g.fillRect(x, row * rh + rh * 0.3, 2, rh * 0.42);
    }
  }
  const t = tex(c); t.magFilter = THREE.LinearFilter; return t;
}

/** Soft rounded-rectangle shadow (alpha). */
function softMap() {
  const S = 64, c = canvas(S, S), g = c.getContext('2d')!, d = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const qx = Math.abs((x + 0.5) / S * 2 - 1), qy = Math.abs((y + 0.5) / S * 2 - 1);
    const m = Math.pow(Math.pow(qx, 4) + Math.pow(qy, 4), 0.25), a = Math.max(0, Math.min(1, (1 - m) / 0.45));
    const i = (y * S + x) * 4; d.data[i] = d.data[i + 1] = d.data[i + 2] = Math.round(a * a * 255); d.data[i + 3] = 255;
  }
  g.putImageData(d, 0, 0); return tex(c, false, false);
}

/** Radial falloff (light pools). */
function glowMap() {
  const S = 64, c = canvas(S, S), g = c.getContext('2d')!, gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, '#fff'); gr.addColorStop(0.35, '#8a8a8a'); gr.addColorStop(0.7, '#262626'); gr.addColorStop(1, '#000');
  g.fillStyle = gr; g.fillRect(0, 0, S, S); return tex(c, false, false);
}

/** Burn scars for battle damage: blotchy soot with a hot rim. */
function scorchMap() {
  // Luminance is coverage (alphaMap reads green): white soot blotches on black.
  const S = 128, c = canvas(S, S), g = c.getContext('2d')!, r = rand(5);
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 70; i++) {
    const a = r() * Math.PI * 2, d = Math.pow(r(), 1.5) * S * 0.3, x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d, rad = 4 + r() * 16;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, `rgba(255,255,255,${0.3 + r() * 0.3})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
  }
  return tex(c, false, false);
}

let shared: null | { hazard: THREE.Texture; window: THREE.Texture; soft: THREE.Texture; scorch: THREE.Texture; glow: THREE.Texture } = null;
function sharedMaps() { return (shared ??= { hazard: hazardMap(), window: windowMap(), soft: softMap(), scorch: scorchMap(), glow: glowMap() }); }

/* ---------------- kit textures ---------------- */
interface TrimSet { map: THREE.Texture | null; red: THREE.Texture | null; normal: THREE.Texture | null; orm: THREE.Texture | null }
type Trims = Record<'t1' | 't2' | 't3' | 'dark' | 'decal', TrimSet>;
let trims: Trims | null = null;
function kitTrims() {
  if (trims || !kitLoaded('scifi')) return trims;
  const out: Record<string, TrimSet> = {};
  const want: Record<string, string> = { t1: 'T_Trim_01', t2: 'T_Trim_02', t3: 'T_Trim_03', dark: 'T_Trim_03_Cables', decal: 'T_Decals' };
  for (const k of Object.keys(want)) out[k] = { map: null, red: null, normal: null, orm: null };
  const probe = ['WallAstra_Straight', 'Column_Hollow', 'TopCables_Straight', 'WallBand_Straight', 'Platform_Metal', 'Decal_Logo', 'Column_Large_Straight', 'Platform_3Plates', 'Column_Pipes'];
  for (const name of probe) {
    source('scifi', name)?.traverse((o) => {
      const mesh = o as THREE.Mesh; if (!mesh.isMesh) return;
      for (const m of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[]) {
        const mapName = m.map?.name || '';
        for (const k of Object.keys(want)) {
          const base = want[k];
          if (k === 'dark' ? mapName === base : !mapName.startsWith(base)) continue;
          if (k !== 'dark' && mapName.startsWith('T_Trim_03_Cables')) continue;
          const s = out[k];
          if (/_Red$/.test(mapName)) s.red ??= m.map; else if (!/_Blue$/.test(mapName)) s.map ??= m.map;
          s.normal ??= m.normalMap; s.orm ??= m.roughnessMap;
        }
      }
    });
  }
  trims = out as Trims;
  return trims;
}

/* ---------------- environment ---------------- */
let envTex: THREE.Texture | null = null;
/** A night-sky reflection probe: cold moonlit zenith, sodium city glow from below the horizon. */
export function shipEnv(renderer: THREE.WebGLRenderer) {
  if (envTex) return envTex;
  const scene = new THREE.Scene();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vP;void main(){vP=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: `varying vec3 vP;void main(){float y=vP.y;
      vec3 zen=vec3(0.05,0.07,0.11),hor=vec3(0.16,0.13,0.11),low=vec3(0.42,0.24,0.10);
      vec3 c=y>0.0?mix(hor,zen,pow(y,0.6)):mix(hor,low,pow(-y,0.5));
      float moon=pow(max(0.0,dot(vP,normalize(vec3(-0.35,0.8,-0.3)))),180.0)*14.0;
      float strip=smoothstep(0.08,0.0,abs(y-0.02))*0.25;
      gl_FragColor=vec4(c+moon+vec3(0.9,0.7,0.5)*strip,1.0);}`,
  }));
  scene.add(sky);
  const pm = new THREE.PMREMGenerator(renderer);
  envTex = pm.fromScene(scene, 0.02).texture;
  pm.dispose(); sky.geometry.dispose(); (sky.material as THREE.Material).dispose();
  return envTex;
}

/* ---------------- shader patches ---------------- */
type Patch = (sh: THREE.WebGLProgramParametersWithUniforms) => void;
/** Chain shader patches onto a material (each patch edits the same shader source in order). */
export function addPatch(m: THREE.Material, key: string, f: Patch) {
  const prev = m.onBeforeCompile.bind(m), pk = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (sh, r) => { prev(sh, r); f(sh); };
  m.customProgramCacheKey = () => pk() + '|' + key;
}

/**
 * Micro plating, procedural in the shader: two scales of staggered plates (big hull plates and small
 * deck tiles), each with a dark seam line and a per-plate tone. Projected from the dominant axis of the
 * object-space normal, in ship design units, so plates keep their size on every hull. Both layers fade
 * out by screen footprint (fwidth) before they can alias, so far away only the big plates remain.
 */
const SEAM_GLSL = `
float gdHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float gdPlates(vec2 q,vec2 cell,float seam,float tone){
  vec2 g=q/cell;float row=floor(g.y);g.x+=gdHash(vec2(row,cell.x))*0.9;
  vec2 id=floor(g),f=fract(g),fw=max(fwidth(g),vec2(1e-4));
  vec2 e=min(f,1.0-f)/fw;
  float line=1.0-smoothstep(0.35,1.35,min(e.x,e.y));
  float vis=1.0-smoothstep(0.09,0.3,max(fw.x,fw.y));
  return 1.0+vis*((gdHash(id)-0.5)*tone-seam*line);
}`;
const seamPatch: Patch = (sh) => {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vGdP;varying vec3 vGdN;')
    .replace('#include <project_vertex>', 'vGdP=transformed;vGdN=objectNormal;\n#include <project_vertex>');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vGdP;varying vec3 vGdN;' + SEAM_GLSL)
    .replace('#include <map_fragment>', `#include <map_fragment>
      {vec3 an=abs(vGdN);vec2 q=an.y>0.6?vGdP.xz:(an.x>an.z?vGdP.zy:vGdP.xy);
       diffuseColor.rgb*=gdPlates(q,vec2(7.0,4.4),0.42,0.16)*gdPlates(q+vec2(0.31,0.17),vec2(1.7,1.1),0.3,0.12);}`);
};

/**
 * Shader-animated guns: every turret of a ship lives in one merged mesh per material. Each vertex carries
 * aGun = (gun index, kind); per gun the uniforms hold pivot + yaw (uGunA) and recoil / door slide (uGunB).
 * kind 0 turns with the gun, kind 1 (barrels) also recoils along +z, kind 2 (doors) slides outward in x;
 * uGunB.z scales the gun's geometry.
 */
export const MAX_GUNS = 96;
const GUN_GLSL = `attribute vec2 aGun;uniform vec4 uGunA[${MAX_GUNS}];uniform vec4 uGunB[${MAX_GUNS}];
vec3 gdGunRot(vec3 p){float a=uGunA[int(aGun.x+0.5)].w;float c=cos(a),s=sin(a);return vec3(c*p.x+s*p.z,p.y,-s*p.x+c*p.z);}
vec3 gdGunPos(vec3 p){int i=int(aGun.x+0.5);vec4 b=uGunB[i];p*=b.z>0.0?b.z:1.0;
  if(aGun.y>0.5&&aGun.y<1.5)p.z+=b.x;else if(aGun.y>1.5)p.x+=sign(p.x)*b.y;
  return gdGunRot(p)+uGunA[i].xyz;}`;
export interface GunUniforms { uGunA: { value: Float32Array }; uGunB: { value: Float32Array } }
export function gunUniforms(): GunUniforms { return { uGunA: { value: new Float32Array(MAX_GUNS * 4) }, uGunB: { value: new Float32Array(MAX_GUNS * 4) } }; }
/** A per-ship clone of a livery material that runs the gun transform. */
export function gunMaterial(base: THREE.Material, u: GunUniforms) {
  const m = base.clone();
  m.onBeforeCompile = base.onBeforeCompile; m.customProgramCacheKey = base.customProgramCacheKey;
  addPatch(m, 'gun', (sh) => {
    sh.uniforms.uGunA = u.uGunA; sh.uniforms.uGunB = u.uGunB;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + GUN_GLSL)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed=gdGunPos(transformed);');
    if (sh.vertexShader.includes('#include <beginnormal_vertex>')) sh.vertexShader = sh.vertexShader.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal=gdGunRot(objectNormal);');
  });
  return m;
}

/** Stencil lettering atlas (hull numbers, callsign): 6 x 7 glyphs, white on black, used as an alpha map. */
export const STENCIL_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-./ ';
let stencilTex: THREE.Texture | null = null;
function stencilMap() {
  if (stencilTex) return stencilTex;
  const C = 64, cols = 8, rows = Math.ceil(STENCIL_CHARS.length / cols), c = canvas(C * cols, C * rows), g = c.getContext('2d')!;
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '700 54px "Saira Stencil One", "Chakra Petch", Impact, monospace';
  for (let i = 0; i < STENCIL_CHARS.length; i++) g.fillText(STENCIL_CHARS[i], (i % cols) * C + C / 2, Math.floor(i / cols) * C + C / 2 + 3, C * 0.86);
  // Stencil bridges: thin horizontal gaps through every glyph.
  g.fillStyle = '#000'; for (let r = 0; r < rows; r++) g.fillRect(0, r * C + C * 0.5, c.width, 3);
  stencilTex = tex(c, false, false); stencilTex.userData = { cols, rows };
  return stencilTex;
}

/* ---------------- livery sets ---------------- */
const cache = new Map<string, Livery>();
export function livery(hostile: boolean, renderer: THREE.WebGLRenderer | null): Livery {
  const key = `${hostile}_${kitLoaded('scifi')}`;
  const hit = cache.get(key); if (hit) return hit;
  const T = kitTrims(), M = sharedMaps(), env = renderer ? shipEnv(renderer) : null;
  const u = { flicker: { value: 1 }, time: { value: 0 } };
  const pbr = (k: 't1' | 't2' | 't3' | 'dark', tint: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => {
    const s = T?.[k];
    const m = new THREE.MeshStandardMaterial({
      color: tint, vertexColors: true, metalness: 0.62, roughness: 1.5,
      map: s?.map || null, normalMap: s?.normal || null, roughnessMap: s?.orm || null, metalnessMap: s?.orm || null,
      envMap: env, envMapIntensity: 0.45, ...o,
    });
    if (!s?.orm) { m.metalness = 0.55; m.roughness = 0.5; }
    if (m.normalMap) m.normalScale.set(1.4, 1.4);
    return m;
  };
  const glowBasic = (hex: string, k: number, o: THREE.MeshBasicMaterialParameters = {}) => { const m = new THREE.MeshBasicMaterial({ color: hex, vertexColors: true, ...o }); m.color.multiplyScalar(k); m.toneMapped = false; return m; };
  const P = hostile
    ? { hull: '#4a3633', plate: '#3e2c2a', dark: '#1e1514', accent: '#8a2a1c', deckLine: '#7a2a22' }
    : { hull: '#4c545d', plate: '#40474f', dark: '#22272c', accent: '#f2a541', deckLine: '#c9c4b4' };
  const L = hostile
    ? { window: '#ff7a5c', edge: '#ff5a4e', strobe: '#ff3a2e', deck: '#ff6a3d', engine: '#ff6a3d', engineHot: '#ffc0a0', energy: '#ff5a4e', port: '#ff3a2e', star: '#ff3a2e', navPort: '#ff3a2e', navStar: '#ff7a5c' }
    : { window: '#ffcf8a', edge: '#ffd9a0', strobe: '#f4fbff', deck: '#4fd1e8', engine: '#ffb347', engineHot: '#fff1c1', energy: '#4fd1e8', port: '#f2a541', star: '#8fe3ff', navPort: '#ff4636', navStar: '#3dff8a' };
  const mats: Record<MatKey, THREE.Material> = {
    t1: pbr('t1', hostile ? '#d8a89a' : '#c8d0da'),
    t2: pbr('t2', hostile ? '#c89a8e' : '#bcc6d0'),
    t3: pbr('t3', hostile ? '#8a6058' : '#8a929c', { metalness: 0.5 }),
    dark: pbr('dark', hostile ? '#5a3a36' : '#5a626c'),
    black: new THREE.MeshStandardMaterial({ color: '#07090b', roughness: 0.6, metalness: 0.4, envMap: env, side: THREE.DoubleSide }),
    decal: new THREE.MeshStandardMaterial({
      map: T?.decal.map ?? null, alphaMap: T?.decal.map ?? null, color: hostile ? '#c85a40' : '#d8d4c6', transparent: true, alphaTest: 0.35, roughness: 0.7, metalness: 0.1,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false, envMap: env, envMapIntensity: 0.4,
    }),
    hazard: new THREE.MeshStandardMaterial({ map: M.hazard, vertexColors: true, roughness: 0.65, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, envMap: env, envMapIntensity: 0.5 }),
    paint: new THREE.MeshStandardMaterial({ map: T?.t3.map ?? null, vertexColors: true, roughness: 0.75, metalness: 0.15, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, envMap: env, envMapIntensity: 0.4 }),
    glass: glowBasic(L.window, hostile ? 0.9 : 1.3),
    window: glowBasic(L.window, hostile ? 1.6 : 2.2, { map: M.window }),
    lamp: glowBasic(L.edge, 3),
    glow: glowBasic(L.energy, 3.2),
    core: glowBasic(L.engine, 4.5),
    shadow: new THREE.MeshBasicMaterial({ color: '#000000', alphaMap: M.soft, transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    pool: new THREE.MeshBasicMaterial({ color: hostile ? '#ff5a3a' : '#ffb870', vertexColors: true, alphaMap: M.glow, transparent: true, opacity: hostile ? 0.3 : 0.4, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    scorch: new THREE.MeshBasicMaterial({ color: '#000000', alphaMap: M.scorch, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    stencil: new THREE.MeshStandardMaterial({ color: hostile ? '#9a4a3a' : '#d9d3c0', vertexColors: true, alphaMap: stencilMap(), transparent: true, alphaTest: 0.4, roughness: 0.8, metalness: 0.1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, envMap: env, envMapIntensity: 0.3 }),
  };
  for (const k of ['t1', 't2', 't3', 'dark'] as MatKey[]) addPatch(mats[k], 'seams', seamPatch);
  if (hostile) {
    // Ghostly flicker: the dead ship's emissives breathe and stutter.
    for (const k of ['window', 'glass', 'lamp', 'glow', 'core'] as MatKey[]) {
      const m = mats[k] as THREE.MeshBasicMaterial;
      addPatch(m, 'ghostflick', (sh) => { sh.uniforms.uFlick = u.flicker; sh.fragmentShader = 'uniform float uFlick;\n' + sh.fragmentShader.replace('#include <opaque_fragment>', 'outgoingLight *= uFlick;\n#include <opaque_fragment>'); });
    }
    // Rust-red rim on the hull so the silhouette smoulders even from straight above.
    for (const k of ['t1', 't2', 't3'] as MatKey[]) {
      const m = mats[k] as THREE.MeshStandardMaterial;
      addPatch(m, 'ghostrim', (sh) => {
        sh.uniforms.uFlick = u.flicker;
        sh.fragmentShader = 'uniform float uFlick;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\nfloat rim=1.0-abs(dot(normalize(vViewPosition),normal));totalEmissiveRadiance+=vec3(1.0,0.14,0.06)*pow(rim,4.0)*0.35*uFlick;');
      });
    }
  }
  const out: Livery = {
    hostile, mats, u,
    paint: { hull: new THREE.Color(P.hull), plate: new THREE.Color(P.plate), dark: new THREE.Color(P.dark), accent: new THREE.Color(P.accent), deckLine: new THREE.Color(P.deckLine), full: new THREE.Color(1, 1, 1) },
    light: L,
  };
  cache.set(key, out);
  return out;
}
