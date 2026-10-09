// Render engine: owns the WebGL renderer, scene, camera, post chain and the render layers.
//
// COORDINATES
//  Gameplay lives on a 2D field (x right, y down) of FIELD_W x FIELD_H units.
//  The player's ship and all aircraft fly on the FLIGHT PLANE at world height FLIGHT.
//  The city and ground units sit on the GROUND PLANE at world height 0, far below.
//  A field point maps to the flight plane with toFlight(x, y) and to the ground with toGround(x, y).
//  toGround returns the ground point directly under the same screen pixel, so a tank hit-tested at
//  field (x, y) is drawn exactly where the player sees it. Ground objects must be scaled by
//  GROUND_SCALE (k > 1) to look the size their gameplay radius says, and that perspective is what
//  sells the altitude: the city below scrolls past under a ship that is visibly much closer.
import * as THREE from 'three';
import type { EffectComposer, BloomEffect } from 'postprocessing';
import { QuadBatch } from './fx/quads';
import { PostChain, type Quality } from './fx/post';
import type { S as CombatState } from '../game/combat';
import { cameraShake, type V as VfxState } from '../game/vfx';

import { FIELD_W, FIELD_H } from '../game/field';
export { FIELD_W, FIELD_H };
export const FLIGHT = 1200;

export interface FrameCtx {
  dt: number; t: number; engine: Engine;
  S: typeof CombatState; V: typeof VfxState;
  /** False while the player ship should be hidden (title, death). */
  showPlayer: boolean;
}
export interface Layer { name: string; update(ctx: FrameCtx): void; clear?(): void }

export class Engine {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(28, FIELD_W / FIELD_H, 50, 20000);
  /** Post chain (src/render/fx/post.ts): AO, distortion, bloom, tone map, grade, SMAA. */
  post: PostChain;
  composer: EffectComposer;
  bloom: BloomEffect;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  /** Additive glow quads (bullets, fire, light) and alpha-blended quads (smoke, decals, shadows). */
  glow: QuadBatch; dark: QuadBatch;
  layers: Layer[] = [];
  camPos = new THREE.Vector3(); camLook = new THREE.Vector3();
  /** Ground units per field unit (see header). */
  groundScale = 1;
  private shake = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement) {
    // The post chain owns anti-aliasing, depth and tone mapping (ACES runs in post, on the HDR frame).
    const r = new THREE.WebGLRenderer({ canvas, antialias: false, stencil: false, depth: false, powerPreference: 'high-performance' });
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.NoToneMapping;
    this.renderer = r;
    this.scene.fog = new THREE.Fog(0x0b0f14, 4000, 9000);
    this.hemi = new THREE.HemisphereLight(0x8fa6c4, 0x1a1512, 0.9);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
    this.sun.castShadow = true;
    const coarse = matchMedia('(pointer:coarse)').matches;
    this.sun.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 1.5;
    this.scene.add(this.sun, this.sun.target);
    this.glow = QuadBatch.glow(9000); this.dark = QuadBatch.dark(4000);
    this.scene.add(this.dark.mesh, this.glow.mesh);
    this.post = new PostChain(r, this.scene, this.camera);
    this.composer = this.post.composer; this.bloom = this.post.bloom;
    this.fitCamera();
  }

  add<L extends Layer>(layer: L): L { this.layers.push(layer); return layer; }

  /** World position on the flight plane (alt raises it toward the camera). */
  toFlight(x: number, y: number, alt = 0, out = new THREE.Vector3()) { return out.set(x - FIELD_W / 2, FLIGHT + alt, y - FIELD_H / 2); }
  /** World position on the ground under the same screen pixel as field (x, y). */
  toGround(x: number, y: number, out = new THREE.Vector3()) {
    const c = this.camPos, k = this.groundScale;
    return out.set(c.x + (x - FIELD_W / 2 - c.x) * k, 0, c.z + (y - FIELD_H / 2 - c.z) * k);
  }

  private css = { w: FIELD_W, h: FIELD_H };
  resize(cssW: number, cssH: number) {
    this.css.w = cssW; this.css.h = cssH;
    const pr = Math.min(window.devicePixelRatio || 1, this.post.quality === 'high' ? 1.5 : 1) * this.post.renderScale;
    this.renderer.setPixelRatio(pr); this.renderer.setSize(cssW, cssH, true);
    this.post.setSize(cssW, cssH);
  }
  /** Graphics quality tier ('high' | 'low'); the settings UI may call this at any time. */
  get quality(): Quality { return this.post.quality; }
  setQuality(q: Quality) { this.post.setQuality(q); this.resize(this.css.w, this.css.h); try { localStorage.setItem('gd.quality', q); } catch { /* ignore */ } }

  /** Frame the whole field on the flight plane with a gentle forward tilt. */
  fitCamera() {
    const cam = this.camera, tilt = 0.32, dir = new THREE.Vector3(0, Math.cos(tilt), Math.sin(tilt));
    const corners = [[-FIELD_W / 2, -FIELD_H / 2], [FIELD_W / 2, -FIELD_H / 2], [-FIELD_W / 2, FIELD_H / 2], [FIELD_W / 2, FIELD_H / 2]].map(([x, z]) => new THREE.Vector3(x, FLIGHT, z));
    let tz = 0;
    const place = (d: number) => { cam.position.set(0, FLIGHT, tz).addScaledVector(dir, d); cam.lookAt(0, FLIGHT, tz); cam.updateMatrixWorld(); cam.updateProjectionMatrix(); };
    for (let it = 0; it < 6; it++) {
      let lo = 100, hi = 20000;
      for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; place(mid); const ok = corners.every((v) => { const p = v.clone().project(cam); return Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1; }); if (ok) hi = mid; else lo = mid; }
      place(hi);
      const top = corners[0].clone().project(cam).y, bot = corners[2].clone().project(cam).y;
      tz -= ((top + bot) / 2) * FIELD_H * 0.45;
    }
    this.camPos.copy(cam.position); this.camLook.set(0, FLIGHT, tz);
    this.groundScale = cam.position.y / (cam.position.y - FLIGHT);
    // Sun shadow frustum covers the visible ground footprint.
    const g0 = this.toGround(-200, -400), g1 = this.toGround(FIELD_W + 200, FIELD_H + 200);
    const cx = (g0.x + g1.x) / 2, cz = (g0.z + g1.z) / 2, hw = Math.abs(g1.x - g0.x) / 2, hd = Math.abs(g1.z - g0.z) / 2;
    this.sun.target.position.set(cx, 0, cz);
    this.sun.position.set(cx - 1400, 3600, cz - 1100);
    Object.assign(this.sun.shadow.camera, { left: -hw * 1.2, right: hw * 1.2, top: hd * 1.2, bottom: -hd * 1.2, near: 100, far: 9000 });
    this.sun.shadow.camera.updateProjectionMatrix();
  }

  clearLayers() { for (const l of this.layers) l.clear?.(); }

  render(ctx: Omit<FrameCtx, 'engine'>) {
    const full: FrameCtx = { ...ctx, engine: this };
    this.glow.begin(); this.dark.begin(); this.post.distort.begin(ctx.t);
    for (const l of this.layers) l.update(full);
    this.glow.flush(); this.dark.flush();
    // Camera trauma (src/game/vfx.ts): translate the whole view in the flight plane and roll a hair.
    const cam = this.camera, sh = cameraShake(ctx.dt, performance.now());
    this.shake.set(sh.x, 0, sh.y);
    cam.position.copy(this.camPos).add(this.shake);
    cam.lookAt(this.camLook.x + this.shake.x, this.camLook.y, this.camLook.z + this.shake.z);
    if (sh.roll) cam.rotateZ(sh.roll);
    this.post.frame(ctx.dt, cam);
  }
}

export function webglAvailable() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}
