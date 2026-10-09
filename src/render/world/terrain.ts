// World layer: the ground far below, city blocks, roads and clouds.
// Baseline implementation; the city agent owns this file and src/render/world/*.
import * as THREE from 'three';
import type { Engine, FrameCtx, Layer } from '../engine';
import { FIELD_W } from '../engine';
import { THEMES, type Theme } from '../palette';
import { rgb, Shape, DarkShape } from '../fx/quads';
import { rnd } from '../../util/rng';

const TAU = Math.PI * 2;
function groundTex(th: Theme) {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d')!;
  g.fillStyle = th.base; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9; i++) { g.globalAlpha = 0.22; g.fillStyle = i % 2 ? th.alt : th.dec; g.beginPath(); g.ellipse(rnd(30, 226), rnd(30, 226), rnd(12, 30), rnd(10, 26), rnd(0, 3), 0, TAU); g.fill(); }
  for (let i = 0; i < 1600; i++) { g.fillStyle = Math.random() < 0.5 ? th.alt : th.dec; g.globalAlpha = rnd(0.1, 0.35); const s = rnd(1, 3.5); g.fillRect(rnd(0, 256), rnd(0, 256), s, s); }
  g.globalAlpha = 0.55; g.strokeStyle = th.line; g.lineWidth = 1.5; g.strokeRect(0.75, 0.75, 254.5, 254.5);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}

export class TerrainLayer implements Layer {
  name = 'terrain';
  ground: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  bld: THREE.InstancedMesh; bldMat: THREE.MeshStandardMaterial;
  m4 = new THREE.Matrix4(); themeIdx = -1; tileWorld = 256;
  constructor(private engine: Engine) {
    const k = engine.groundScale;
    this.tileWorld = 256 * k;
    const span = 6000;
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(span, span).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 }));
    const mid = engine.toGround(FIELD_W / 2, 450);
    this.ground.position.set(mid.x, -1, mid.z); this.ground.receiveShadow = true;
    engine.scene.add(this.ground);
    this.bldMat = new THREE.MeshStandardMaterial({ color: 0x2b362e, roughness: 0.85, metalness: 0.15 });
    this.bld = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.bldMat, 160);
    Object.assign(this.bld, { castShadow: true, receiveShadow: true, count: 0, frustumCulled: false });
    engine.scene.add(this.bld);
  }
  update({ S, t }: FrameCtx) {
    const e = this.engine, k = e.groundScale, th = THEMES[S.theme % THEMES.length];
    if (this.themeIdx !== S.theme) {
      this.themeIdx = S.theme;
      const old = this.ground.material.map; const tex = groundTex(th);
      tex.repeat.set(6000 / this.tileWorld, 6000 / this.tileWorld);
      this.ground.material.map = tex; this.ground.material.needsUpdate = true; old?.dispose();
      this.bldMat.color.set(th.alt).multiplyScalar(1.2);
      e.renderer.setClearColor(th.fog); (e.scene.fog as THREE.Fog).color.set(th.fog);
    }
    this.ground.material.map!.offset.y = (S.scrollY * k) / this.tileWorld;
    const g = new THREE.Vector3();
    let bi = 0;
    for (const d of S.decor) {
      switch (d.type) {
        case 'block': if (bi < 160) {
          const h = (d.hgt || 14) * k; e.toGround(d.x + d.w / 2, d.y + d.h / 2, g);
          this.m4.makeScale(d.w * k, h, d.h * k); this.m4.setPosition(g.x, h / 2, g.z); this.bld.setMatrixAt(bi++, this.m4);
          if (h > 24 * k) e.glow.add(g.x, h + 2, g.z, 0, 6 * k, 6 * k, rgb('#ff5a4e'), 0.35 + 0.35 * Math.sin(t * 3 + d.x), Shape.Hot);
        } break;
        case 'road': e.toGround(FIELD_W / 2, d.y + d.h / 2, g); e.dark.add(g.x, 0.4, g.z, 0, FIELD_W * 4 * k, d.h * k, rgb(th.dec), 0.95, DarkShape.Rect); break;
        case 'crater': e.toGround(d.x, d.y, g); e.dark.add(g.x, 0.5, g.z, 0, d.r * 2.4 * k, d.r * 2.4 * k, rgb('#050404'), 0.6, DarkShape.Soft); e.dark.add(g.x, 0.6, g.z, 0, d.r * 2.1 * k, d.r * 2.1 * k, rgb(th.alt), 0.75, DarkShape.Ring); break;
        case 'field': e.toGround(d.x + d.w / 2, d.y + d.h / 2, g); e.dark.add(g.x, 0.3, g.z, 0, d.w * k, d.h * k, rgb(th.alt), 0.45, DarkShape.Rect); break;
        case 'pad': e.toGround(d.x, d.y, g); e.dark.add(g.x, 0.5, g.z, 0, d.r * 2 * k, d.r * 2 * k, rgb(th.acc), 0.9, DarkShape.Ring); break;
      }
    }
    this.bld.count = bi; this.bld.instanceMatrix.needsUpdate = true;
    for (const c of S.clouds) { const p = e.toFlight(c.x, c.y, 300); e.dark.add(p.x, p.y, p.z, 0, c.w, c.h, rgb('#dfe7ee'), 0.06, DarkShape.Soft); }
  }
}
