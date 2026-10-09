// WebGL renderer: 3D ships and enemies, instanced glow/smoke quads, bloom.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { S, W, H, dronePos, type Enemy } from '../game/combat';
import { V, FIRE } from '../game/vfx';
import { WEAPONS, partDef, type Derived, buildToGhost } from '../data/parts';
import { clamp, rnd, has } from '../util/rng';

const AIR = 60, AIRB = 74, TAU = Math.PI * 2;
const wx = (x: number) => x - W / 2, wz = (y: number) => y - H / 2;
export const THEMES = [
  { name: 'Scrubland', base: '#222b25', alt: '#2b362e', line: '#323f37', dec: '#1a211c', acc: '#3d4a3a' },
  { name: 'Rust Flats', base: '#33291f', alt: '#3e3226', line: '#473a2c', dec: '#261e17', acc: '#5a4630' },
  { name: 'Glacier Yard', base: '#212c35', alt: '#29363f', line: '#34444f', dec: '#182129', acc: '#3f5363' },
  { name: 'Ash Belt', base: '#2a2628', alt: '#342e31', line: '#3e3639', dec: '#1e1b1c', acc: '#4b3f43' },
  { name: 'Neon Sprawl', base: '#1b1e2b', alt: '#232737', line: '#2c3245', dec: '#13151e', acc: '#3a3157' },
];
const C3 = new Map<string, [number, number, number]>();
function c3(h: string) { let v = C3.get(h); if (!v) { const c = new THREE.Color(h); v = [c.r, c.g, c.b]; C3.set(h, v); } return v; }

class QuadBatch {
  g = new THREE.InstancedBufferGeometry(); n = 0; mesh: THREE.Mesh;
  pos: Float32Array; rs: Float32Array; col: Float32Array; shp: Float32Array; attrs: THREE.InstancedBufferAttribute[];
  constructor(public max: number, material: THREE.Material, order: number) {
    const g = this.g;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5]), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    g.setIndex([0, 2, 1, 0, 3, 2]);
    this.pos = new Float32Array(max * 3); this.rs = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.shp = new Float32Array(max);
    const add = (n: string, arr: Float32Array, sz: number) => { const a = new THREE.InstancedBufferAttribute(arr, sz); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(n, a); return a; };
    this.attrs = [add('aPos', this.pos, 3), add('aRs', this.rs, 3), add('aCol', this.col, 4), add('aShp', this.shp, 1)];
    g.instanceCount = 0;
    this.mesh = new THREE.Mesh(g, material); this.mesh.frustumCulled = false; this.mesh.renderOrder = order;
  }
  begin() { this.n = 0; }
  add(x: number, y: number, z: number, rot: number, len: number, wid: number, c: number[], a: number, shape: number) {
    if (this.n >= this.max || !(a > 0.004)) return;
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.rs[i * 3] = rot; this.rs[i * 3 + 1] = len; this.rs[i * 3 + 2] = wid;
    this.col[i * 4] = c[0]; this.col[i * 4 + 1] = c[1]; this.col[i * 4 + 2] = c[2]; this.col[i * 4 + 3] = Math.min(1.5, a);
    this.shp[i] = shape;
  }
  flush() { this.g.instanceCount = this.n; for (const a of this.attrs) { a.needsUpdate = true; } }
}
const QUAD_VS = `attribute vec3 aPos;attribute vec3 aRs;attribute vec4 aCol;attribute float aShp;
varying vec2 vUv;varying vec4 vCol;varying float vShp;
void main(){vUv=uv;vCol=aCol;vShp=aShp;
  vec2 p=vec2(position.x*aRs.y,position.z*aRs.z);float c=cos(aRs.x),s=sin(aRs.x);
  vec3 w=vec3(aPos.x+p.x*c-p.y*s,aPos.y,aPos.z+p.x*s+p.y*c);
  gl_Position=projectionMatrix*viewMatrix*vec4(w,1.0);}`;
const GLOW_FS = `varying vec2 vUv;varying vec4 vCol;varying float vShp;
void main(){vec2 p=vUv*2.0-1.0;float d=length(p);vec3 col=vCol.rgb;float a=0.0;
  if(vShp<0.5){a=pow(max(0.0,1.0-d),1.5);col=mix(col,vec3(1.0),pow(max(0.0,1.0-d*2.4),2.0));}
  else if(vShp<1.5){a=pow(max(0.0,1.0-d),2.2);}
  else if(vShp<2.5){a=smoothstep(0.62,0.86,d)*(1.0-smoothstep(0.86,1.0,d));}
  else{float ay=abs(p.y),ax=abs(p.x);a=pow(max(0.0,1.0-ay),1.8)*(1.0-smoothstep(0.55,1.0,ax));
    col=mix(col,vec3(1.0),pow(max(0.0,1.0-ay*2.2),3.0)*(1.0-smoothstep(0.3,1.0,ax))*0.9);}
  gl_FragColor=vec4(col*a*vCol.a*2.2,1.0);}`;
const DARK_FS = `varying vec2 vUv;varying vec4 vCol;varying float vShp;
void main(){vec2 p=vUv*2.0-1.0;float d=length(p);float a;
  if(vShp<0.5)a=pow(max(0.0,1.0-d),1.4);
  else if(vShp<1.5){vec2 q=abs(p);a=1.0-smoothstep(0.86,1.0,max(q.x,q.y));}
  else a=smoothstep(0.7,0.85,d)*(1.0-smoothstep(0.9,1.0,d));
  gl_FragColor=vec4(vCol.rgb,a*vCol.a);}`;

function groundTex(th: typeof THEMES[number]) {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d')!;
  g.fillStyle = th.base; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9; i++) { g.globalAlpha = 0.22; g.fillStyle = i % 2 ? th.alt : th.dec; g.beginPath(); g.ellipse(rnd(30, 226), rnd(30, 226), rnd(12, 30), rnd(10, 26), rnd(0, 3), 0, TAU); g.fill(); }
  for (let i = 0; i < 1600; i++) { g.fillStyle = Math.random() < 0.5 ? th.alt : th.dec; g.globalAlpha = rnd(0.1, 0.35); const s = rnd(1, 3.5); g.fillRect(rnd(0, 256), rnd(0, 256), s, s); }
  g.globalAlpha = 0.55; g.strokeStyle = th.line; g.lineWidth = 1.5; g.strokeRect(0.75, 0.75, 254.5, 254.5);
  g.globalAlpha = 0.3; g.beginPath(); g.moveTo(128, 0); g.lineTo(128, 256); g.moveTo(0, 128); g.lineTo(256, 128); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1600 / 256, 2600 / 256); t.anisotropy = 8;
  return t;
}

type MatSet = { hull: THREE.Material; panel: THREE.Material; deck: THREE.Material; edge: THREE.LineBasicMaterial; glass: THREE.Material; nozzle: THREE.Material };
export class Renderer {
  renderer: THREE.WebGLRenderer; scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(30, W / H, 20, 5000);
  composer: EffectComposer; glow: QuadBatch; dark: QuadBatch; ground: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  bld: THREE.InstancedMesh; bldMat: THREE.MeshStandardMaterial; plights: THREE.PointLight[] = [];
  camPos = new THREE.Vector3(); camLook = new THREE.Vector3(); m4 = new THREE.Matrix4();
  pool: Record<string, THREE.Group[]> = {}; live = new Set<THREE.Group>(); boxes = new Map<string, THREE.BoxGeometry>(); wmats = new Map<string, THREE.Material>();
  matP: MatSet; matB: MatSet; em: Record<string, THREE.Material>; geo: Record<string, THREE.BufferGeometry>;
  pMesh: THREE.Group | null = null; pSig = ''; bMesh: THREE.Group | null = null; bRef: unknown = null;
  themeIdx = -1; bank = 0; bbank = 0; px = 0; bx = 0; last = 0;

  constructor(canvas: HTMLCanvasElement) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    this.renderer = renderer;
    const scene = this.scene;
    scene.fog = new THREE.Fog(0x0b0f14, 1100, 2200);
    scene.add(new THREE.HemisphereLight(0xa8bed6, 0x2a221c, 1.1));
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
    sun.position.set(-260, 520, -200); sun.castShadow = true;
    const coarse = matchMedia('(pointer:coarse)').matches;
    sun.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
    Object.assign(sun.shadow.camera, { left: -420, right: 420, top: 620, bottom: -620, near: 50, far: 1500 });
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.6;
    scene.add(sun, sun.target);
    const rim = new THREE.DirectionalLight(0x6fa8ff, 0.7); rim.position.set(300, 200, 400); scene.add(rim);
    for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xff8a3d, 0, 200, 1.4); scene.add(l); this.plights.push(l); }
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1600, 2600).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 }));
    this.ground.position.set(0, -0.5, -300); this.ground.receiveShadow = true; scene.add(this.ground);
    this.bldMat = new THREE.MeshStandardMaterial({ color: 0x2b362e, roughness: 0.85, metalness: 0.15 });
    this.bld = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.bldMat, 120);
    Object.assign(this.bld, { castShadow: true, receiveShadow: true, count: 0, frustumCulled: false }); scene.add(this.bld);
    const glowMat = new THREE.ShaderMaterial({ vertexShader: QUAD_VS, fragmentShader: GLOW_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
    const darkMat = new THREE.ShaderMaterial({ vertexShader: QUAD_VS, fragmentShader: DARK_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.dark = new QuadBatch(2500, darkMat, 1); this.glow = new QuadBatch(7000, glowMat, 2);
    scene.add(this.dark.mesh, this.glow.mesh);
    const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4, type: THREE.HalfFloatType });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(W, H), 0.75, 0.45, 0.82));
    this.composer.addPass(new OutputPass());
    const std = (c: number, m: number, r: number, side: THREE.Side = THREE.FrontSide) => new THREE.MeshStandardMaterial({ color: c, metalness: m, roughness: r, side });
    const glowBasic = (hex: string, k: number) => { const m = new THREE.MeshBasicMaterial({ color: hex }); m.color.multiplyScalar(k); m.toneMapped = false; return m; };
    const line = (hex: string, k: number, o: number) => { const m = new THREE.LineBasicMaterial({ color: hex, transparent: true, opacity: o }); m.color.multiplyScalar(k); m.toneMapped = false; return m; };
    const DS = THREE.DoubleSide;
    this.matP = { hull: std(0x6a7b8e, 0.55, 0.4), panel: std(0x3a4653, 0.5, 0.55), deck: std(0x7d90a5, 0.5, 0.45), edge: line('#9fb6ca', 0.7, 0.5), glass: glowBasic('#5fe0ff', 4), nozzle: glowBasic('#ffb050', 4) };
    this.matB = { hull: std(0x5a232b, 0.5, 0.42, DS), panel: std(0x2e1418, 0.5, 0.6, DS), deck: std(0x6e3139, 0.5, 0.5, DS), edge: line('#ff5040', 2.5, 0.95), glass: glowBasic('#ffcf5c', 4), nozzle: glowBasic('#ff6a3d', 4) };
    this.em = {
      hostile: std(0x8a6f5d, 0.35, 0.6), hostileL: std(0x9b8372, 0.4, 0.5), hostileD: std(0x5a493d, 0.4, 0.55), olive: std(0x5d6d44, 0.2, 0.8), oliveL: std(0x758459, 0.25, 0.7),
      dark: std(0x2a2f24, 0.2, 0.9), concrete: std(0x66605a, 0.1, 0.95), steel: std(0x8a7f72, 0.45, 0.55), inf: std(0x7d8a63, 0.1, 0.9), skin: std(0xc9b48a, 0, 0.9),
      light: glowBasic('#ff3b2e', 4), orange: glowBasic('#ff9a4a', 2.2), crate: std(0x9a7b3a, 0.2, 0.7), crateBand: glowBasic('#ffd24a', 2.5),
      droneMat: new THREE.MeshStandardMaterial({ color: 0x8a3a33, emissive: 0xff3b2e, emissiveIntensity: 1.2, metalness: 0.5, roughness: 0.4 }),
      eliteHull: std(0x4a3a40, 0.6, 0.35), canister: new THREE.MeshStandardMaterial({ color: 0xb08a3a, emissive: 0xffc24a, emissiveIntensity: 0.6, metalness: 0.7, roughness: 0.3 }),
      rotor: new THREE.MeshBasicMaterial({ color: 0xd8dde2, transparent: true, opacity: 0.28, depthWrite: false }),
    };
    const ex = this.ex;
    this.geo = {
      heliBody: new THREE.SphereGeometry(1, 14, 10).scale(7, 5.5, 11), jet: ex([[0, 13], [11, -8], [3, -5], [0, -12], [-3, -5], [-11, -8]], 3),
      drone: new THREE.OctahedronGeometry(6.5), bomber: ex([[30, 0], [-10, -28], [-18, -28], [-8, 0], [-18, 28], [-10, 28]], 3.5),
      cyl6: new THREE.CylinderGeometry(6, 6.5, 5, 14), inf: new THREE.CylinderGeometry(2.4, 2.6, 5, 8), head: new THREE.SphereGeometry(1.8, 8, 6),
      oct: new THREE.CylinderGeometry(14, 15, 6, 8), head7: new THREE.CylinderGeometry(7, 7.5, 5, 12),
      dome: new THREE.SphereGeometry(22, 20, 8, 0, TAU, 0, Math.PI / 2).scale(1, 0.55, 1), ring: new THREE.TorusGeometry(16, 2, 6, 24).rotateX(Math.PI / 2),
      turret: new THREE.CylinderGeometry(4.2, 4.8, 3, 14), nozzle: new THREE.CylinderGeometry(3.2, 4, 6, 12).rotateX(Math.PI / 2), disc: new THREE.CircleGeometry(2.7, 12),
      canister: new THREE.CylinderGeometry(5, 5, 14, 10).rotateZ(Math.PI / 2),
      ace: ex([[0, 34], [26, -6], [30, -22], [8, -14], [0, -26], [-8, -14], [-30, -22], [-26, -6]], 9),
      carrier: ex([[-30, 46], [30, 46], [44, 20], [44, -36], [24, -48], [-24, -48], [-44, -36], [-44, 20]], 10),
    };
    this.fitCamera();
  }
  ex = (pts: number[][], depth: number) => {
    const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) s.lineTo(p[0], p[1]); s.closePath();
    return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.8, bevelSize: 0.6, bevelSegments: 1 }).rotateX(Math.PI / 2).translate(0, depth / 2, 0);
  };
  resize(cssW: number, cssH: number) {
    const pr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.renderer.setPixelRatio(pr); this.renderer.setSize(cssW, cssH, true);
    this.composer.setPixelRatio(pr); this.composer.setSize(cssW, cssH);
  }
  fitCamera() {
    const cam = this.camera, tilt = 0.3, dir = new THREE.Vector3(0, Math.cos(tilt), Math.sin(tilt));
    const corners = [[-W / 2, -H / 2], [W / 2, -H / 2], [-W / 2, H / 2], [W / 2, H / 2]].map(([x, z]) => new THREE.Vector3(x, AIR, z));
    let tz = 0;
    const place = (d: number) => { cam.position.set(0, AIR, tz).addScaledVector(dir, d); cam.lookAt(0, AIR, tz); cam.updateMatrixWorld(); cam.updateProjectionMatrix(); };
    for (let it = 0; it < 6; it++) {
      let lo = 50, hi = 9000;
      for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; place(mid); const ok = corners.every((v) => { const p = v.clone().project(cam); return Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1; }); if (ok) hi = mid; else lo = mid; }
      place(hi);
      const top = corners[0].clone().project(cam).y, bot = corners[2].clone().project(cam).y;
      tz -= ((top + bot) / 2) * H * 0.45;
    }
    this.camPos.copy(cam.position); this.camLook.set(0, AIR, tz);
  }
  box(w: number, h: number, d: number) { const k = `${w}_${h}_${d}`; let g = this.boxes.get(k); if (!g) { g = new THREE.BoxGeometry(w, h, d); this.boxes.set(k, g); } return g; }
  wmat(col: string) { let m = this.wmats.get(col); if (!m) { m = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.6, metalness: 0.3, roughness: 0.35 }); this.wmats.set(col, m); } return m; }

  buildShip(dv: Derived, isBoss: boolean) {
    const M = isBoss ? this.matB : this.matP, g = new THREE.Group();
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, own = false) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; m.userData.own = own; g.add(m); return m; };
    const tops: number[] = [];
    for (const r of dv.rects) {
      const k = r.type === 'battery' ? 5 : 3;
      const pts = r.type === 'bridge'
        ? [[r.x, r.y + r.h], [r.x, r.y + r.h * 0.5], [-r.w * 0.18, r.y], [r.w * 0.18, r.y], [r.x + r.w, r.y + r.h * 0.5], [r.x + r.w, r.y + r.h]]
        : [[r.x + k, r.y], [r.x + r.w - k, r.y], [r.x + r.w, r.y + k], [r.x + r.w, r.y + r.h - k], [r.x + r.w - k, r.y + r.h], [r.x + k, r.y + r.h], [r.x, r.y + r.h - k], [r.x, r.y + k]];
      const depth = ({ bridge: 8, armor: 9.5, battery: 7 } as Record<string, number>)[r.type] || 7;
      const geo = this.ex(pts, depth); add(geo, M.hull, 0, 0, 0, true);
      const el = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), M.edge); el.userData.own = true; g.add(el);
      const top = depth / 2 + 0.8; tops.push(top);
      const cz = r.y + r.h / 2;
      switch (r.type) {
        case 'bridge': add(this.box(r.w * 0.42, 6, r.h * 0.45), M.panel, 0, top + 3, r.y + r.h * 0.62); add(this.box(r.w * 0.36, 1.6, 2.2), M.glass, 0, top + 5.2, r.y + r.h * 0.42); add(this.box(2, 8, 2), M.deck, r.w * 0.12, top + 7, r.y + r.h * 0.75); break;
        case 'engine': for (const sx of [-0.22, 0.22]) { add(this.geo.nozzle, M.panel, r.w * sx, 0, r.y + r.h + 2); add(this.geo.disc, M.nozzle, r.w * sx, 0, r.y + r.h + 5.05); } break;
        case 'armor': for (const s of [-1, 1]) add(this.box(3, depth + 2, r.h - 3), M.panel, s * (r.w / 2 + 1), 0, cz); break;
        case 'battery': for (const s of [-1, 1]) add(this.box(6, depth, r.h - 2), M.panel, s * (r.w / 2 + 2), 0, cz); break;
        case 'spine': add(this.box(4, 3, r.h), M.deck, 0, top + 1.5, cz); break;
        case 'gundeck': add(this.box(r.w - 10, 1, r.h - 6), M.deck, 0, top + 0.5, cz); break;
      }
    }
    for (const m of dv.mounts) {
      const p = m.part; if (!p) continue;
      const top = tops[m.si], col = partDef(p.id).col;
      if (has(WEAPONS, p.id)) {
        if (WEAPONS[p.id].layer === 'ground') { add(this.box(9, 2, 8), M.panel, m.ox, top + 1, m.oy); add(this.box(6, 0.8, 3), this.wmat(col), m.ox, top + 2.3, m.oy); }
        else {
          add(this.geo.turret, M.panel, m.ox, top + 1.5, m.oy);
          const len = p.id === 'rail' ? 15 : 9, bw = p.id === 'rail' ? 2.4 : 1.6;
          const xs = p.id === 'spread' || p.id === 'missile' ? [-2, 2] : [0];
          for (const dx of xs) add(this.box(bw, bw, len), this.wmat(col), m.ox + dx, top + 2.6, m.oy - len / 2 - 1);
          add(this.box(2.6, 1, 2.6), this.wmat(col), m.ox, top + 3.3, m.oy);
        }
      } else { const u = add(this.box(5, 3, 5), this.wmat(col), m.ox, top + 1.5, m.oy); u.rotation.y = Math.PI / 4; }
    }
    return g;
  }
  disposeShip(g: THREE.Group) { g.traverse((o) => { if (o.userData.own && (o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose(); }); }

  enemyMesh(type: string): THREE.Group {
    const pool = this.pool[type] || (this.pool[type] = []); if (pool.length) return pool.pop()!;
    const g = new THREE.Group(), M = this.em, G3 = this.geo; g.userData.type = type;
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = g) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
    const rotor = (x: number, y: number, z: number, len: number) => { const r = new THREE.Group(); r.position.set(x, y, z); add(this.box(len, 0.5, 1.8), M.rotor, 0, 0, 0, r).castShadow = false; add(this.box(1.8, 0.5, len), M.rotor, 0, 0, 0, r).castShadow = false; g.add(r); return r; };
    const head = (y: number) => { const h = new THREE.Group(); h.position.y = y; g.add(h); g.userData.head = h; return h; };
    switch (type) {
      case 'heli': add(G3.heliBody, M.hostile); add(this.box(2.4, 2.4, 14), M.hostile, 0, 1, -12); add(this.box(5, 2, 3), M.light, 0, 1, 9); g.userData.rotors = [rotor(0, 6, 0, 34)]; break;
      case 'jet': add(G3.jet, M.hostileL); add(this.box(3, 2, 5), M.light, 0, 2, 4); break;
      case 'drone': g.userData.spin = add(G3.drone, M.droneMat); break;
      case 'gunship': add(this.box(20, 9, 40), M.hostileD); add(this.box(46, 3, 10), M.hostile, 0, 0, -4); add(this.box(8, 3, 6), M.light, 0, 3, 18); g.userData.rotors = [rotor(-18, 6, -14, 26), rotor(18, 6, -14, 26)]; break;
      case 'bomber': add(G3.bomber, M.hostileD); add(this.box(56, 4, 10), M.hostile); add(this.box(4, 2, 4), M.light, 26, 2, 0); break;
      case 'tank': { add(this.box(20, 7, 24), M.olive, 0, 3.5); add(this.box(3.5, 7, 26), M.dark, -11.5, 3.5); add(this.box(3.5, 7, 26), M.dark, 11.5, 3.5); const h = head(9); add(G3.cyl6, M.oliveL, 0, 0, 0, h); add(this.box(3, 3, 14), M.oliveL, 0, 0, 8, h); break; }
      case 'infantry': add(G3.inf, M.inf, 0, 2.5); add(G3.head, M.skin, 0, 6); break;
      case 'turret': { add(G3.oct, M.concrete, 0, 3); const h = head(8.5); add(G3.head7, M.steel, 0, 0, 0, h); add(this.box(4, 4, 16), M.steel, 0, 0, 9, h); add(this.box(3, 1.5, 3), M.light, 0, 3, 0, h); break; }
      case 'sam': { add(this.box(24, 7, 24), M.concrete, 0, 3.5); for (const s of [-1, 1]) add(this.box(5, 5, 16), M.orange, s * 6, 10).rotation.x = -0.7; break; }
      case 'bunker': add(G3.dome, M.concrete); add(G3.ring, M.dark, 0, 2); add(this.box(6, 2, 6), M.light, 0, 12.5); break;
      case 'cache': add(this.box(20, 12, 20), M.crate, 0, 6); add(this.box(21, 2, 21), M.crateBand, 0, 9); add(this.box(21, 2, 21), M.crateBand, 0, 3); break;
      case 'wreck': { for (let i = 0; i < 5; i++) { const b = add(this.box(rnd(8, 18), rnd(4, 9), rnd(10, 26)), i % 2 ? M.hostileD : M.dark, rnd(-12, 12), 3, rnd(-12, 12)); b.rotation.set(rnd(-0.4, 0.4), rnd(0, 3), rnd(-0.4, 0.4)); } add(this.box(4, 2, 4), M.crateBand, 0, 8); break; }
      case 'canister': g.userData.spin = add(G3.canister, M.canister); break;
      case 'ace': add(G3.ace, M.eliteHull); add(this.box(10, 6, 20), M.hostileD, 0, 6, 0); add(this.box(6, 2, 4), M.light, 0, 9, 10); for (const s of [-1, 1]) add(this.box(3, 3, 16), M.steel, s * 14, 5, 12); g.userData.rotors = [rotor(-22, 9, -12, 26), rotor(22, 9, -12, 26)]; break;
      case 'crawler': { add(this.box(70, 16, 90), M.olive, 0, 8); for (const s of [-1, 1]) add(this.box(12, 14, 96), M.dark, s * 40, 7); for (const ox of [-26, 0, 26]) { const h = new THREE.Group(); h.position.set(ox, 20, 10); add(G3.cyl6, M.oliveL, 0, 0, 0, h); add(this.box(3.5, 3.5, 18), M.steel, 0, 0, 10, h); g.add(h); (g.userData.heads ||= []).push(h); } add(this.box(8, 3, 8), M.light, 0, 18, -30); break; }
      case 'carrier': add(G3.carrier, M.eliteHull); add(this.box(20, 14, 30), M.hostileD, 22, 12, -10); add(this.box(60, 1, 70), M.dark, -6, 6, 0); for (const z of [-30, -10, 10, 30]) add(this.box(2, 1, 2), M.light, -6, 7, z); break;
    }
    return g;
  }
  syncEnemies() {
    const seen = new Set<THREE.Group>();
    for (const e of S.enemies as Enemy[]) {
      let m: THREE.Group = e._m;
      if (!m) { m = this.enemyMesh(e.type); e._m = m; this.scene.add(m); }
      seen.add(m);
      const air = e.layer === 'air', u = m.userData;
      m.position.set(wx(e.x), air ? AIR : 0, wz(e.y)); m.rotation.set(0, 0, 0);
      if (u.rotors) for (const r of u.rotors) r.rotation.y = S.t * 30;
      if (u.spin) { u.spin.rotation.y = S.t * 3; u.spin.rotation.x = S.t * 2; }
      if (u.head) u.head.rotation.y = Math.PI / 2 - e.ang;
      if (u.heads) for (const h of u.heads) h.rotation.y = Math.PI / 2 - e.ang;
      if (e.type === 'bomber') m.rotation.y = e.vx > 0 ? 0 : Math.PI;
      if (e.type === 'jet') m.rotation.z = Math.sin(e.t * 3) * 0.25;
      if (e.type === 'heli' || e.type === 'ace') { m.rotation.x = 0.12; m.rotation.z = Math.sin(e.t * 1.7) * 0.12; }
      if (e.type === 'wreck') m.rotation.y = e.ang;
      if (e.flash > 0) this.glow.add(wx(e.x), (air ? AIR : 4) + 8, wz(e.y), 0, e.r * 3.4, e.r * 3.4, c3('#ffffff'), 0.5, 1);
      if (air) {
        if (e.type === 'jet') this.gq(e.x, e.y - 13, AIR + 1, 16 + Math.random() * 5, '#ffb347', 0.9, 0);
        else if (e.type === 'bomber') { const s = e.vx > 0 ? -1 : 1; this.gq(e.x + s * 28, e.y - 6, AIR + 1, 18, '#ffb347', 0.8, 0); this.gq(e.x + s * 28, e.y + 6, AIR + 1, 18, '#ffb347', 0.8, 0); }
        else if (e.type === 'canister') this.gq(e.x, e.y, AIR + 4, 26, '#ffc24a', 0.35 + 0.25 * Math.sin(S.t * 5 + e.x), 1);
        else if (e.type === 'ace' || e.type === 'carrier') { for (const s of [-1, 1]) this.gq(e.x + s * 16, e.y - e.r * 0.8, AIR + 2, 26 + Math.random() * 6, '#ff7a3d', 0.9, 0); }
        else this.gq(e.x, e.y, AIR + 8, 10, '#ff5a4e', 0.5 + 0.5 * Math.sin(S.t * 8 + e.x), 0);
      } else if (e.type === 'cache' || e.type === 'wreck') this.gq(e.x, e.y, 6, e.r * 3, '#ffc24a', 0.18 + 0.12 * Math.sin(S.t * 4 + e.x), 1);
      else if (e.type === 'turret' || e.type === 'bunker' || e.type === 'sam') this.gq(e.x, e.y, 14, 8, '#ff5a4e', 0.4 + 0.4 * Math.sin(S.t * 6 + e.x), 0);
    }
    for (const m of this.live) if (!seen.has(m)) { this.scene.remove(m); (this.pool[m.userData.type] ||= []).push(m); }
    this.live = seen;
  }
  gq(x: number, y: number, alt: number, size: number, col: string, a: number, shape = 0) { this.glow.add(wx(x), alt, wz(y), 0, size, size, c3(col), a, shape); }
  streak(x1: number, y1: number, x2: number, y2: number, alt: number, wid: number, col: string, a: number) {
    const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy); if (L < 0.01) return;
    this.glow.add(wx((x1 + x2) / 2), alt, wz((y1 + y2) / 2), Math.atan2(dy, dx), L + wid, wid, c3(col), a, 3);
  }
  dq(x: number, y: number, alt: number, w: number, h: number, rot: number, col: string, a: number, shape: number) { this.dark.add(wx(x), alt, wz(y), rot, w, h, c3(col), a, shape); }

  clearCombat() {
    for (const m of this.live) { this.scene.remove(m); (this.pool[m.userData.type] ||= []).push(m); }
    this.live.clear();
    if (this.bMesh) { this.scene.remove(this.bMesh); this.disposeShip(this.bMesh); this.bMesh = null; this.bRef = null; }
  }

  render(showPlayer: boolean) {
    const now = performance.now(), rdt = Math.min(0.05, (now - (this.last || now)) / 1000) || 0.016; this.last = now;
    const th = THEMES[S.theme % THEMES.length];
    this.glow.begin(); this.dark.begin();
    if (this.themeIdx !== S.theme) {
      this.themeIdx = S.theme; const old = this.ground.material.map; this.ground.material.map = groundTex(th); this.ground.material.needsUpdate = true; old?.dispose();
      this.bldMat.color.set(th.alt).multiplyScalar(1.2); this.renderer.setClearColor(th.dec); (this.scene.fog as THREE.Fog).color.set(th.dec);
    }
    this.ground.material.map!.offset.y = S.scrollY / 256;
    let bi = 0;
    for (const d of S.decor) {
      switch (d.type) {
        case 'block': if (bi < 120) { const h = d.hgt || 14; this.m4.makeScale(d.w, h, d.h); this.m4.setPosition(wx(d.x + d.w / 2), h / 2, wz(d.y + d.h / 2)); this.bld.setMatrixAt(bi++, this.m4); if (h > 24) this.gq(d.x + d.w / 2, d.y + d.h / 2, h + 1.5, 5, '#ff5a4e', 0.35 + 0.35 * Math.sin(S.t * 3 + d.x), 0); } break;
        case 'road': this.dq(W / 2, d.y + d.h / 2, 0.4, W * 4, d.h, 0, th.dec, 0.95, 1); for (let x = -W; x < W * 2; x += 40) this.dq(x + 10, d.y + d.h / 2, 0.6, 20, 2, 0, th.line, 0.9, 1); break;
        case 'crater': this.dq(d.x, d.y, 0.5, d.r * 2.4, d.r * 2.4, 0, '#050404', 0.6, 0); this.dq(d.x, d.y, 0.6, d.r * 2.1, d.r * 2.1, 0, th.alt, 0.75, 2); break;
        case 'field': this.dq(d.x + d.w / 2, d.y + d.h / 2, 0.3, d.w, d.h, 0, th.alt, 0.45, 1); break;
        case 'pad': this.dq(d.x, d.y, 0.5, d.r * 2, d.r * 2, 0, th.acc, 0.9, 2); this.gq(d.x, d.y, 1, d.r * 0.8, '#f2a541', 0.25 + 0.2 * Math.sin(S.t * 4 + d.y), 0); break;
      }
    }
    this.bld.count = bi; this.bld.instanceMatrix.needsUpdate = true;
    for (const dc of V.decals) this.dq(dc.x, dc.y, 0.8, dc.r * 2, dc.r * 1.7, 0, '#060504', Math.min(1, dc.life / 3) * 0.85, 0);
    for (const b of S.eb) if (b.kind === 'strike') {
      const k = b.t / b.delay;
      this.glow.add(wx(b.x), AIR - 4, wz(b.y), 0, b.rad * 2, b.rad * 2, c3('#ff3a2e'), 0.6 + 0.4 * Math.abs(Math.sin(b.t * 14)), 2);
      this.glow.add(wx(b.x), AIR - 4, wz(b.y), 0, b.rad * 2 * k, b.rad * 2 * k, c3('#ff5a4e'), 0.8, 2);
      this.streak(b.x - 9, b.y, b.x + 9, b.y, AIR - 4, 1.5, '#ff5a4e', 0.9); this.streak(b.x, b.y - 9, b.x, b.y + 9, AIR - 4, 1.5, '#ff5a4e', 0.9);
    }
    this.syncEnemies();
    const P = S.P;
    if (P && showPlayer) {
      const sig = JSON.stringify(buildToGhost(P.build));
      if (this.pSig !== sig) { if (this.pMesh) { this.scene.remove(this.pMesh); this.disposeShip(this.pMesh); } this.pMesh = this.buildShip(P.dv, false); this.scene.add(this.pMesh); this.pSig = sig; }
      const vx = (P.x - this.px) / rdt; this.px = P.x; this.bank += (clamp(-vx / 520, -0.42, 0.42) - this.bank) * Math.min(1, rdt * 8);
      const pm = this.pMesh!; pm.visible = true; pm.position.set(wx(P.x), AIR, wz(P.y)); pm.rotation.set(0, 0, this.bank);
      for (const r of P.dv.rects) if (r.type === 'engine') for (const sx of [-0.22, 0.22]) { this.gq(P.x + r.w * sx, P.y + r.y + r.h + 6, AIR, 13 + Math.random() * 5, '#ffb347', 0.95); this.gq(P.x + r.w * sx, P.y + r.y + r.h + 14, AIR, 9, '#ff7a2d', 0.5, 1); }
      if (P.flash > 0) this.gq(P.x, P.y, AIR + 12, Math.max(P.dv.width, P.dv.len) * 1.5, '#ffffff', P.flash * 0.35, 1);
      if (P.shield > 0) this.glow.add(wx(P.x), AIR + 3, wz(P.y), 0, P.dv.width + 22, P.dv.len + 22, c3('#4fd1e8'), (0.3 + 0.4 * (P.shield / P.dv.shieldMax)) * (P.lastHit < 0.2 ? 1.8 : 1), 2);
      for (let i = 0; i < P.dv.drones; i++) { const p = dronePos(i, P.dv.drones); this.gq(p.x, p.y, AIR + 4, 14, '#7fb6ff', 0.95); this.dq(p.x, p.y, AIR + 3, 6, 6, 0, '#9fb4c6', 1, 1); }
    } else if (this.pMesh) this.pMesh.visible = false;
    const B = S.boss;
    if (B && (B.alive || S.mode === 'bossdown')) {
      if (this.bRef !== B) { if (this.bMesh) { this.scene.remove(this.bMesh); this.disposeShip(this.bMesh); } this.bMesh = this.buildShip(B.dv, true); this.bMesh.scale.set(B.s, B.s, -B.s); this.scene.add(this.bMesh); this.bRef = B; this.bx = B.x; }
      const sink = S.mode === 'bossdown' ? (2.6 - S.endT) / 2.6 : 0;
      const vx = (B.x - this.bx) / rdt; this.bx = B.x; this.bbank += (clamp(vx / 260, -0.3, 0.3) - this.bbank) * Math.min(1, rdt * 5);
      this.bMesh!.visible = true; this.bMesh!.position.set(wx(B.x), AIRB - sink * 70, wz(B.y) + sink * 25); this.bMesh!.rotation.set(sink * 0.5, 0, this.bbank + sink * 0.7);
      for (const r of B.dv.rects) if (r.type === 'engine') for (const sx of [-0.22, 0.22]) this.gq(B.x + r.w * sx * B.s, B.y - (r.y + r.h) * B.s - 8, AIRB, 26 + Math.random() * 6, '#ff6a3d', 0.9);
      if (B.flash > 0) this.gq(B.x, B.y, AIRB + 12, B.halfW * 2.4, '#ffffff', 0.18, 1);
      if (B.shield > 0) this.glow.add(wx(B.x), AIRB + 4, wz(B.y), 0, B.halfW * 2 + 28, B.dv.len * B.s + 28, c3('#4fd1e8'), (0.3 + 0.5 * B.shield / B.shieldMax) * (B.shieldHitT < 0.15 ? 1.8 : 1), 2);
    } else if (this.bMesh) { this.scene.remove(this.bMesh); this.disposeShip(this.bMesh); this.bMesh = null; this.bRef = null; }
    for (const b of S.pb) {
      if (b.kind === 'bomb') { const k = b.life / b.max, alt = 4 + (AIR - 4) * Math.pow(k, 1.4); this.dq(b.x, b.y, alt - 0.5, 5, 5, 0, '#2a2e33', 1, 0); this.gq(b.x, b.y, alt, 9 + 6 * k, b.col, 0.55 + 0.35 * Math.sin(S.t * 45)); continue; }
      if (b.kind === 'shell') { const k = 1 - b.life / b.max; for (let j = 0; j < 8; j++) { const kk = k - j * 0.025; if (kk < 0) break; this.gq(b.sx + (b.tx - b.sx) * kk, b.sy + (b.ty - b.sy) * kk, AIR * (1 - kk) + Math.sin(kk * Math.PI) * 45, j ? 12 - j : 18, b.col, j ? 0.5 * (1 - j / 8) : 1, j ? 1 : 0); } continue; }
      if (b.kind === 'missile') { this.trail(b, b.col); const sp = Math.hypot(b.vx, b.vy) || 1; this.dq(b.x, b.y, AIR + 3, 9, 3, Math.atan2(b.vy, b.vx), '#c8d2dc', 1, 1); this.gq(b.x - (b.vx / sp) * 6, b.y - (b.vy / sp) * 6, AIR + 4, 16 + Math.random() * 5, '#ffb347', 0.95); continue; }
      const sp = Math.hypot(b.vx, b.vy) || 1, ux = b.vx / sp, uy = b.vy / sp, L = clamp(sp * 0.034, 8, 26);
      this.streak(b.x, b.y, b.x - ux * L * 1.7, b.y - uy * L * 1.7, AIR + 4, b.r * 3.4, b.col, 0.4);
      this.streak(b.x, b.y, b.x - ux * L, b.y - uy * L, AIR + 4, b.r * 1.5, b.col, 1.1);
      if (b.kind === 'flak') this.gq(b.x, b.y, AIR + 4, 22, b.col, 0.85);
    }
    for (const b of S.eb) {
      if (b.kind === 'strike') continue;
      if (b.kind === 'beam') {
        if (b.t < b.warn) { const k = b.t / b.warn; this.gq(b.x, b.y, AIR + 6, 18 + 60 * k, b.col, 0.95); this.streak(b.x, b.y, b.x, H + 60, AIR, 1.5 + 3 * k, '#ff5a4e', 0.35 + 0.5 * Math.abs(Math.sin(b.t * 22))); }
        else { const k = 1 - (b.t - b.warn) / b.dur; this.streak(b.x, b.y, b.x, H + 60, AIR, b.w * 3.6, b.col, 0.4 * k); this.streak(b.x, b.y, b.x, H + 60, AIR + 1, b.w * 1.2, b.col, k); this.streak(b.x, b.y, b.x, H + 60, AIR + 2, b.w * 0.45, '#ffffff', k); this.gq(b.x, b.y, AIR + 6, 90, b.col, k); }
        continue;
      }
      if (b.kind === 'missile') { this.trail(b, '#ff6a3d'); const sp = Math.hypot(b.vx, b.vy) || 1; this.dq(b.x, b.y, AIR + 3, 10, 3.4, Math.atan2(b.vy, b.vx), '#5a3a34', 1, 1); this.gq(b.x - (b.vx / sp) * 6, b.y - (b.vy / sp) * 6, AIR + 4, 18 + Math.random() * 5, '#ff7a3d', 0.95); continue; }
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > 20) this.streak(b.x, b.y, b.x - (b.vx / sp) * b.r * 4.5, b.y - (b.vy / sp) * b.r * 4.5, AIR + 3, b.r * 1.8, b.col, 0.55);
      const pulse = b.kind === 'mine' || b.kind === 'orb' ? 1 + 0.4 * Math.sin(b.t * 16) : 1;
      this.gq(b.x, b.y, AIR + 4, b.r * 7.6 * pulse, b.col, 0.95);
      this.gq(b.x, b.y, AIR + 5, b.r * 2.4, '#ffffff', 0.9, 1);
    }
    for (const b of S.beams) {
      const k = b.life / b.max;
      if (b.zig) { const p = zigPts(b.x1, b.y1, b.x2, b.y2); for (let i = 2; i < p.length; i += 2) { this.streak(p[i - 2], p[i - 1], p[i], p[i + 1], AIR + 6, 8, b.col, 0.35 * k); this.streak(p[i - 2], p[i - 1], p[i], p[i + 1], AIR + 7, 2.4, '#ffffff', k); } this.gq(b.x2, b.y2, AIR + 6, 26, b.col, k); }
      else { this.streak(b.x1, b.y1, b.x2, b.y2, AIR + 5, b.w * 4.4, b.col, 0.3 * k); this.streak(b.x1, b.y1, b.x2, b.y2, AIR + 6, b.w * 1.3, b.col, k); if (b.w > 2) this.streak(b.x1, b.y1, b.x2, b.y2, AIR + 7, b.w * 0.45, '#ffffff', k); }
    }
    for (const p of S.pickups) {
      if (p.kind === 'repair') { this.gq(p.x, p.y, AIR - 8, 22, '#8fe39a', 0.7 + 0.3 * Math.sin(p.t * 8)); this.dq(p.x, p.y, AIR - 9, 9, 3, 0, '#8fe39a', 1, 1); this.dq(p.x, p.y, AIR - 9, 3, 9, 0, '#8fe39a', 1, 1); }
      else { this.gq(p.x, p.y, AIR - 8, 14, '#e0c35c', 0.6 + 0.3 * Math.sin(p.t * 10)); this.dq(p.x, p.y, AIR - 9, 5, 5, p.t * 5, '#e0c35c', 1, 1); }
    }
    const lights: typeof V.fx = [];
    for (const f of V.fx) {
      const k = f.life / f.max, gp = !!f.ground, alt = gp ? 3 : AIR + 6;
      switch (f.type) {
        case 'fire': { const s = f.size * (0.6 + (1 - k) * (f.grow || 0)); this.gq(f.x, f.y, alt, s * 1.9, FIRE[Math.min(4, 1 + Math.floor((1 - k) * 4))], Math.min(0.55, k * 0.8), 1); break; }
        case 'spark': { const sp = Math.hypot(f.vx, f.vy) || 1, L = Math.min(18, sp * 0.055) + 1; this.streak(f.x, f.y, f.x - (f.vx / sp) * L, f.y - (f.vy / sp) * L, alt + 1, f.size * 2.2, f.tint || (k > 0.6 ? '#fff3c4' : k > 0.3 ? '#ffc35a' : '#ff6a3d'), Math.min(1, k * 1.6)); break; }
        case 'flash': this.gq(f.x, f.y, alt + 2, f.size * 1.7 * (0.5 + 0.5 * k), f.col!, k * 0.55); break;
        case 'muzzle': this.gq(f.x, f.y, alt + 2, f.size * 2.4 * (0.7 + 0.3 * k), f.col!, k * 1.2); break;
        case 'light': lights.push(f); if (lights.length <= 10) this.gq(f.x, f.y, gp ? 1 : alt - 6, f.size * 2, f.col!, k * 0.16, 1); break;
        case 'ring': { const d = 2 * (f.size * (1 - k * k * k) + 1); this.glow.add(wx(f.x), alt, wz(f.y), 0, d, d, c3(f.col!), k * 0.8, 2); break; }
        case 'smoke': { const s = f.size * (1 + (1 - k) * (f.grow || 0)); this.dq(f.x, f.y, gp ? 6 : AIR + 12, s * 2, s * 2, 0, '#3b3b41', k * (f.a || 0.5), 0); break; }
        case 'debris': this.dq(f.x, f.y, alt, f.size * 1.3, f.size * 0.85, f.rot || 0, f.col!, Math.min(1, k * 2), 1); this.gq(f.x, f.y, alt + 0.5, f.size * 1.8, '#ff9a4a', k * 0.6, 1); break;
      }
    }
    lights.sort((a, b) => (b.size * b.life) / b.max - (a.size * a.life) / a.max);
    this.plights.forEach((l, i) => { const f = lights[i]; if (!f) { l.intensity = 0; return; } const k = f.life / f.max; l.position.set(wx(f.x), f.ground ? 18 : AIR + 30, wz(f.y)); l.intensity = k * 9000; l.distance = f.size * 3; });
    for (const cl of S.clouds) { this.dq(cl.x, cl.y, 170, cl.w, cl.h, 0, '#dfe7ee', 0.07, 0); this.dq(cl.x + cl.w * 0.2, cl.y - cl.h * 0.2, 172, cl.w * 0.66, cl.h * 0.66, 0, '#dfe7ee', 0.06, 0); }
    this.glow.flush(); this.dark.flush();
    const cam = this.camera, sh = V.shake * 0.7;
    cam.position.copy(this.camPos); if (sh) { cam.position.x += rnd(-sh, sh); cam.position.z += rnd(-sh, sh); }
    cam.lookAt(this.camLook.x + (sh ? rnd(-sh, sh) * 0.4 : 0), this.camLook.y, this.camLook.z);
    this.composer.render();
  }
  trail(b: { [k: string]: any }, col: string) {
    const t = b.trail; if (!t) return;
    for (let i = 2; i < t.length; i += 2) { const k = i / t.length; this.streak(t[i - 2], t[i - 1], t[i], t[i + 1], AIR + 2, 1 + 3 * k, col, 0.85 * k); }
  }
}
export function zigPts(x1: number, y1: number, x2: number, y2: number) {
  const n = Math.max(4, Math.round(Math.hypot(x2 - x1, y2 - y1) / 14)), pts = [x1, y1], nx = -(y2 - y1), ny = x2 - x1, l = Math.hypot(nx, ny) || 1;
  for (let i = 1; i < n; i++) { const k = i / n, o = rnd(-7, 7); pts.push(x1 + (x2 - x1) * k + (nx / l) * o, y1 + (y2 - y1) * k + (ny / l) * o); }
  pts.push(x2, y2); return pts;
}
export function webglAvailable() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}
