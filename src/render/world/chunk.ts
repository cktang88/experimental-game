// Builds the meshes for one city row (worldgen Chunk): buildings, ground, props, lights and traffic.
// Everything is instanced and positioned in chunk space (= city space; the layer's root group
// scrolls). Per-building handles let the layer update damage state without rebuilding.
import * as THREE from 'three';
import { FLOOR, CITY, Style, type Bldg, type Chunk, type Surface, type Prop } from '../../game/worldgen';
import { GlowBuilder, TrafficBuilder, G } from './lights';
import type { CityKit } from './kit';

export interface Part { mesh: THREE.InstancedMesh; idx: number }
export interface BRef { parts: Part[]; props: Part[]; glows: number[]; rubble: number }
export interface ChunkView {
  chunk: Chunk; group: THREE.Group; refs: Map<Bldg, BRef>;
  glow: THREE.Mesh | null; rubble: THREE.InstancedMesh | null;
  fires: { x: number; y: number; z: number; s: number; seed: number }[];
  stacks: { x: number; y: number; z: number; s: number; seed: number; b: Bldg }[];
  dispose(): void;
}

const SURF: Record<Surface, number> = { walk: 0, plaza: 1, grass: 2, park: 3, lot: 4, gravel: 5, yard: 6, dock: 7, rail: 8, ash: 9, snow: 10, dirt: 11, bund: 12 };
const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
const col = new THREE.Color();

/** Mulberry-style deterministic random per building. */
function rng(seed: number) { let a = Math.floor(seed * 4294967296) >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

type GeoKey = 'box' | 'house' | 'ruin0' | 'ruin1' | 'tank' | 'cyl' | 'chimney' | 'cooler';
class BldBatch {
  m: number[] = []; a0: number[] = []; a1: number[] = []; a2: number[] = []; a3: number[] = [];
  owners: Bldg[] = [];
  add(b: Bldg, mat: THREE.Matrix4, style: number, lit: number, fh: number, tint: THREE.Color, z0: number, broken: number, neon: number, round: number) {
    this.m.push(...mat.elements);
    this.a0.push(style, b.seed, lit, fh); this.a1.push(b.keepLit ? 1 : 0, b.burnT, b.collapseT, b.fire);
    this.a2.push(tint.r, tint.g, tint.b, z0); this.a3.push(broken, neon, round, 0);
    this.owners.push(b);
    return this.owners.length - 1;
  }
}
class PropBatch {
  m: number[] = []; c: number[] = [];
  add(mat: THREE.Matrix4, color: THREE.Color) { this.m.push(...mat.elements); this.c.push(color.r, color.g, color.b); return this.m.length / 16 - 1; }
  get n() { return this.m.length / 16; }
}

export function buildChunk(ch: Chunk, kit: CityKit): ChunkView {
  const k = kit.k, cz = kit.cz, th = ch.theme;
  const X = (x: number) => (x - 800) * k;
  const Z = (cy: number) => cz + (cy - 450 - cz) * k;
  const group = new THREE.Group();
  const refs = new Map<Bldg, BRef>();
  const batches = new Map<GeoKey, BldBatch>();
  const props = new Map<string, PropBatch>();
  const glow = new GlowBuilder();
  const traffic = new TrafficBuilder();
  const fires: ChunkView['fires'] = [], stacks: ChunkView['stacks'] = [];
  const bb = (g: GeoKey) => { let b = batches.get(g); if (!b) batches.set(g, (b = new BldBatch())); return b; };
  const pb = (g: string) => { let b = props.get(g); if (!b) props.set(g, (b = new PropBatch())); return b; };
  const lampCol = kit.lampCol, fh = FLOOR * k;
  const R = (h: number) => h * k;
  const ref = (b: Bldg) => { let r = refs.get(b); if (!r) refs.set(b, (r = { parts: [], props: [], glows: [], rubble: -1 })); return r; };
  const partLater: [Bldg, GeoKey, number][] = [];
  const propLater: [Bldg, string, number][] = [];
  const beacon = (x: number, y: number, z: number, b?: Bldg, size = 3.2) => { const i = glow.add(x, y, z, G.Hot, R(size), R(size), kit.beaconCol, 2.2, false, 0.55 + Math.random() * 0.25, Math.random()); if (b) ref(b).glows.push(i); return i; };

  /* ---- buildings ---- */
  for (const b of ch.bldgs) {
    const r = rng(b.seed);
    const tint = col.setHSL(0.06 + r() * 0.08, 0.15 + r() * 0.2, 0.42 + r() * 0.3).clone();
    if (b.style === Style.Glass) tint.setHSL(0.58 + r() * 0.06, 0.4, 0.5);
    if (b.style === Style.GlassTeal) tint.setHSL(0.47 + r() * 0.05, 0.45, 0.45);
    if (b.style === Style.Metal) tint.setHSL(0.08 + r() * 0.05, 0.12 + r() * 0.1, 0.55 + r() * 0.2);
    if (b.style === Style.House) tint.setHSL(r() * 0.12, 0.12 + r() * 0.15, 0.55 + r() * 0.25);
    const geo: GeoKey = b.kind === 'house' ? 'house' : b.kind === 'ruin' ? (r() < 0.5 ? 'ruin0' : 'ruin1') : b.kind === 'tank' ? 'tank' : b.kind === 'silo' || b.kind === 'flare' ? 'cyl' : b.kind === 'chimney' ? 'chimney' : b.kind === 'cooler' ? 'cooler' : 'box';
    const round = geo === 'tank' || geo === 'cyl' || geo === 'chimney' || geo === 'cooler' ? 1 : 0;
    let top = b.tiers[0];
    for (const t of b.tiers) {
      if (t.z0 + t.hgt >= top.z0 + top.hgt) top = t;
      q.setFromAxisAngle(UP, b.rot);
      m4.compose(v3.set(X(b.x + t.ox), R(t.z0), Z(b.cy + t.oy)), q, s3.set(R(t.w), R(t.hgt), R(t.h)));
      const idx = bb(geo).add(b, m4, b.style, b.lit, fh, tint, R(t.z0), 0, b.neon, round);
      partLater.push([b, geo, idx]);
    }
    const roofY = R(top.z0 + top.hgt), cx = X(b.x + top.ox), cz2 = Z(b.cy + top.oy), tw = top.w, td = top.h;
    // Industrial landmarks: flare flames, chimney beacons and smoke.
    if (b.kind === 'flare') {
      const i = glow.add(cx, roofY, cz2, G.Flame, R(14), R(30), new THREE.Color('#ff8a2a'), 2.6, false, 0, Math.random()); ref(b).glows.push(i);
      ref(b).glows.push(glow.add(cx, 1, cz2, G.Pool, R(130), R(130), new THREE.Color('#ff7a2a'), 0.22, false));
      ref(b).glows.push(glow.add(cx, roofY, cz2, G.Pool, R(60), R(60), new THREE.Color('#ff9a3a'), 0.5, false));
      continue;
    }
    if (b.kind === 'chimney') {
      beacon(cx + R(tw * 0.42), roofY * 0.98, cz2, b); beacon(cx - R(tw * 0.42), roofY * 0.6, cz2, b, 2.6);
      stacks.push({ x: cx, y: roofY, z: cz2, s: R(tw), seed: b.seed, b });
      continue;
    }
    if (b.kind === 'cooler') { stacks.push({ x: cx, y: roofY, z: cz2, s: R(tw * 0.7), seed: b.seed, b }); continue; }
    if (b.kind === 'tank') {
      // Catwalk lights around the rim.
      if (r() < 0.6) ref(b).glows.push(glow.add(cx, roofY + 0.5, cz2, G.Ring, R(tw * 1.04), R(td * 1.04), lampCol, 0.5, true));
      continue;
    }
    if (geo !== 'box') continue;
    // Rooftop clutter on flat roofs.
    const area = tw * td;
    const rx = (u: number) => cx + R(u * tw * 0.5), rz = (u: number) => cz2 + R(u * td * 0.5);
    const isTower = b.kind === 'tower';
    if ((isTower || b.kind === 'mid') && area > 260 && r() < 0.75) {
      const pw = tw * (0.22 + r() * 0.2), pd = td * (0.22 + r() * 0.2), px = (r() - 0.5) * (tw - pw) * 0.7, pz = (r() - 0.5) * (td - pd) * 0.7;
      m4.compose(v3.set(cx + R(px), roofY, cz2 + R(pz)), q.identity(), s3.set(R(pw), R(FLOOR * (0.8 + r() * 0.8)), R(pd)));
      const idx = bb('box').add(b, m4, Style.Concrete, 0.05, fh, tint, 0, 0, 0, 0);
      partLater.push([b, 'box', idx]);
    }
    if (b.kind !== 'warehouse') {
      const nac = Math.floor((area / 220) * r());
      for (let i = 0; i < Math.min(nac, 8); i++) {
        m4.compose(v3.set(rx(r() * 1.6 - 0.8), roofY, rz(r() * 1.6 - 0.8)), q.setFromAxisAngle(UP, r() < 0.5 ? 0 : Math.PI / 2), s3.set(R(2.6 + r()), R(1.4), R(2.2)));
        propLater.push([b, 'ac', pb('ac').add(m4, col.setHSL(0.58, 0.05, 0.45 + r() * 0.2))]);
      }
    } else {
      for (let i = 0; i < Math.floor(area / 500); i++) {
        m4.compose(v3.set(rx(r() * 1.6 - 0.8), roofY, rz(r() * 1.6 - 0.8)), q.identity(), s3.set(R(1.8), R(1.6), R(1.8)));
        propLater.push([b, 'ac', pb('ac').add(m4, col.setHSL(0.08, 0.05, 0.35))]);
      }
    }
    if (b.kind === 'mid' && b.floors <= 14 && (b.style === Style.Brick || b.style === Style.Concrete) && r() < 0.35) {
      const s = 5 + r() * 2;
      m4.compose(v3.set(rx(r() - 0.5), roofY, rz(r() - 0.5)), q.identity(), s3.set(R(s), R(s * 1.3), R(s)));
      propLater.push([b, 'wtower', pb('wtower').add(m4, col.setHSL(0.07, 0.25, 0.28 + r() * 0.1))]);
    }
    if (isTower) {
      if (r() < 0.7) {
        const mh = 14 + r() * 24 * (b.floors / 40);
        m4.compose(v3.set(rx(r() * 0.6 - 0.3), roofY, rz(r() * 0.6 - 0.3)), q.identity(), s3.set(R(6), R(mh), R(6)));
        const pi = pb('mast').add(m4, col.setHSL(0.6, 0.03, 0.5));
        propLater.push([b, 'mast', pi]);
        beacon(m4.elements[12], roofY + R(mh), m4.elements[14], b, 3.6);
      }
      if (b.floors > 28) for (const [sx, sz] of [[-1, -1], [1, 1]]) beacon(rx(sx * 0.92), roofY + 0.5, rz(sz * 0.92), b, 2.2);
      if (area > 900 && r() < 0.35) {
        const s = Math.min(tw, td) * 0.6;
        ref(b).glows.push(glow.add(cx, roofY + 0.4, cz2, G.Ring, R(s), R(s), new THREE.Color('#ffd9a0'), 0.35, true));
      }
      // Crown floodlights washing up the top floors.
      if (r() < 0.4) ref(b).glows.push(glow.add(cx, roofY + 0.3, cz2, G.Pool, R(tw * 1.5), R(td * 1.5), th === 4 ? kit.neonCols[Math.floor(r() * 4)] : kit.winCol, 0.22, true));
    }
    if (b.neon && (isTower || b.kind === 'mid') && r() < 0.6) {
      const sw = tw * (0.5 + r() * 0.35), sh = 8 + r() * 10;
      ref(b).glows.push(glow.add(cx, roofY + R(1), cz2 + R(td * 0.5), G.Sign, R(sw), R(sh), kit.neonCols[(b.neon - 1) % 4], 1.5, true, 0, Math.random()));
    }
  }

  /* ---- ground: pads and roads ---- */
  const nPads = ch.pads.length + ch.roads.length;
  const ground = new THREE.InstancedMesh(kit.geo.box, kit.mat.ground, nPads);
  const aG0 = new Float32Array(nPads * 4), aG1 = new Float32Array(nPads * 4);
  let gi = 0;
  const plan = CITY.plan!;
  for (const p of ch.pads) {
    const w = R(p.x1 - p.x0), d = R(p.y1 - p.y0), hh = p.s === 'rail' || p.s === 'park' || p.s === 'grass' || p.s === 'ash' || p.s === 'snow' ? 0.35 : p.s === 'bund' ? 1.2 : 0.7;
    m4.compose(v3.set(X((p.x0 + p.x1) / 2), 0, Z((p.y0 + p.y1) / 2)), q.identity(), s3.set(w, hh, d));
    ground.setMatrixAt(gi, m4);
    aG0.set([SURF[p.s], Math.random(), w, d], gi * 4); aG1.set([X(p.x0), Z(p.y0), R(11), 0], gi * 4); gi++;
  }
  for (const rd of ch.roads) {
    const w = R(rd.x1 - rd.x0), d = R(rd.y1 - rd.y0);
    m4.compose(v3.set(X((rd.x0 + rd.x1) / 2), 0, Z((rd.y0 + rd.y1) / 2)), q.identity(), s3.set(w, 0.12, d));
    ground.setMatrixAt(gi, m4);
    const streetW = ch.roads.find((x) => x.dir === 1);
    aG0.set([rd.dir === 0 ? 20 : 21, Math.random(), w, d], gi * 4);
    aG1.set([X(rd.x0), Z(rd.y0), streetW ? R(streetW.y1 - streetW.y0) : 0, rd.lanes], gi * 4); gi++;
  }
  ground.geometry = kit.geo.box.clone();
  ground.geometry.setAttribute('aG0', new THREE.InstancedBufferAttribute(aG0, 4));
  ground.geometry.setAttribute('aG1', new THREE.InstancedBufferAttribute(aG1, 4));
  ground.receiveShadow = true; ground.frustumCulled = false;
  group.add(ground);

  /* ---- street lights and traffic ---- */
  const lampP = th === 3 ? 0.45 : 1;
  const lampAt = (x: number, cy: number, big = 1) => {
    if (Math.random() > lampP) return;
    const c = th === 4 && Math.random() < 0.3 ? kit.ledCol : lampCol;
    glow.add(X(x), 0.8, Z(cy), G.Pool, R(34 * big), R(34 * big), c, 0.2, true);
    glow.add(X(x), R(7), Z(cy), G.Hot, R(1.3), R(1.3), c, 0.9, true);
  };
  const inAve = (x: number) => plan.aves.some((a) => x > a.x0 - 3 && x < a.x1 + 3);
  for (const rd of ch.roads) {
    if (rd.dir === 0) {
      const sw = ch.roads.find((x) => x.dir === 1);
      const yEnd = rd.y1 - (sw ? sw.y1 - sw.y0 : 0);
      for (let y = rd.y0 + 8; y < yEnd - 4; y += 22) { lampAt(rd.x0 - 2, y); lampAt(rd.x1 + 2, y + 11); }
      if (rd.major) for (let y = rd.y0 + 14; y < yEnd - 4; y += 34) lampAt((rd.x0 + rd.x1) / 2, y, 0.8);
    } else {
      for (let x = rd.x0 + 10; x < rd.x1; x += 24) { if (!inAve(x)) lampAt(x, rd.y0 - 2); if (!inAve(x + 12)) lampAt(x + 12, rd.y1 + 2); }
      const len = R(rd.x1 - rd.x0), zc = Z((rd.y0 + rd.y1) / 2), off = R((rd.y1 - rd.y0) * 0.22);
      const dens = th === 3 ? 0.15 : th === 4 ? 1.4 : th === 1 ? 0.5 : 1;
      const n = Math.round((len / 260) * dens);
      traffic.lane(X(rd.x0), zc + off, 1, 0, len, n, 70, false);
      traffic.lane(X(rd.x1), zc - off, -1, 0, len, n, 70, false);
    }
  }

  /* ---- props ---- */
  const ships: Prop[] = [];
  for (const p of ch.props) {
    const x = X(p.x), z = Z(p.cy);
    switch (p.k) {
      case 'tree': {
        const burnt = p.v > 0.95 || th === 3 && p.v > 0.5;
        m4.compose(v3.set(x, 0, z), q.setFromAxisAngle(UP, p.v * 6), s3.set(R(p.w), R(p.h), R(p.w)));
        pb('tree').add(m4, burnt ? col.setHSL(0.07, 0.1, 0.08) : th === 2 ? col.setHSL(0.38, 0.12, 0.12) : col.setHSL(0.25 + p.v * 0.08, 0.35, 0.09 + p.v * 0.04));
        break;
      }
      case 'container': {
        const cols = kit.containerCols;
        m4.compose(v3.set(x, 0, z), q.identity(), s3.set(R(p.w), R(p.h), R(p.d)));
        pb('container').add(m4, cols[Math.floor(p.v * cols.length)]);
        break;
      }
      case 'railcar': {
        m4.compose(v3.set(x, 0.4, z), q.identity(), s3.set(R(p.w), R(p.h), R(p.d)));
        pb('container').add(m4, kit.railCols[Math.floor(p.v * kit.railCols.length)]);
        break;
      }
      case 'crane': {
        m4.compose(v3.set(x, 0, z), q.identity(), s3.set(k, k * (p.h / 30), k));
        pb('crane').add(m4, col.setHSL(0.08, 0.35, 0.32));
        beacon(x - R(48), R(p.h + 2), z, undefined, 3.4); beacon(x + R(10), R(p.h + 6), z, undefined, 3);
        glow.add(x - R(30), 0.8, z, G.Pool, R(50), R(34), kit.ledCol, 0.35, true);
        glow.add(x - R(30), R(p.h - 3), z, G.Hot, R(3), R(3), kit.ledCol, 1.4, true);
        glow.add(x - R(60), 0.5, z + R(20), G.Reflect, R(10), R(90), kit.ledCol, 0.45, true);
        break;
      }
      case 'pipe': {
        m4.compose(v3.set(x, 0, z), q.identity(), s3.set(R(p.w), R(p.h * 0.6), R(p.d * 0.6)));
        pb('pipe').add(m4, col.setHSL(0.08, 0.15, 0.35 + p.v * 0.15));
        m4.compose(v3.set(x, 0, z + R(p.d * 0.9)), q.identity(), s3.set(R(p.w), R(p.h * 0.45), R(p.d * 0.45)));
        pb('pipe').add(m4, col.setHSL(0.55, 0.05, 0.4));
        break;
      }
      case 'ship': ships.push(p); break;
      case 'lamp': {
        const dock = p.v > 0.5, c = dock ? kit.ledCol : lampCol;
        glow.add(x, 0.8, z, G.Pool, R(dock ? 40 : 22), R(dock ? 40 : 22), c, dock ? 0.2 : 0.22, true);
        glow.add(x, R(p.h), z, G.Hot, R(dock ? 2 : 1.2), R(dock ? 2 : 1.2), c, 1.1, true);
        if (dock && CITY.plan && p.x < CITY.plan.coast + 2) glow.add(x, 0.4, z + R(40), G.Reflect, R(6), R(80), c, 0.5, true);
        break;
      }
      case 'pylon': {
        m4.compose(v3.set(x, 0, z), q.identity(), s3.set(R(5), R(p.h * 1.6), R(5)));
        pb('mast').add(m4, col.setHSL(0.6, 0.04, 0.45));
        glow.add(x, R(p.h * 1.5), z, G.Hot, R(4), R(4), kit.ledCol, 1.3, true);
        glow.add(x, 0.8, z, G.Pool, R(70), R(70), kit.ledCol, 0.22, true);
        if (Math.random() < 0.5) glow.add(x + R(5.5), R(3), z + R(8), G.Hot, R(1.8), R(1.8), Math.random() < 0.5 ? kit.signalGreen : kit.signalAmber, 1.4, false);
        break;
      }
      case 'fire': {
        fires.push({ x, y: 0, z, s: R(p.w), seed: p.v });
        for (let i = 0; i < 3; i++) glow.add(x + R((Math.random() - 0.5) * p.w), 0.5, z + R((Math.random() - 0.5) * p.w * 0.6), G.Flame, R(p.w * (0.6 + Math.random() * 0.6)), R(p.w * (1.2 + Math.random())), new THREE.Color('#ff7a2a'), 2.4, false, 0, Math.random());
        glow.add(x, 0.6, z, G.Pool, R(p.w * 9), R(p.w * 9), new THREE.Color('#ff6a20'), 0.32, false);
        break;
      }
      case 'rubble': case 'hulk': {
        break; // placed below in the rubble batch
      }
      case 'searchlight': break; // owned by the layer (global beams)
    }
  }
  for (const s of ships) {
    const x = X(s.x), z = Z(s.cy);
    m4.compose(v3.set(x, 0, z), q.identity(), s3.set(R(s.w), R(s.d * 1.1), R(s.d)));
    pb('ship').add(m4, col.setHSL(s.v < 0.5 ? 0.6 : 0.03, 0.25, 0.2));
    // Deck containers and lights.
    for (let cx = -0.3; cx < 0.32; cx += 0.075) for (let row = -1; row <= 1; row++) if (Math.random() < 0.8) {
      m4.compose(v3.set(x + R(cx * s.w), R(s.d * 0.13), z + R(row * s.d * 0.27)), q.identity(), s3.set(R(s.w * 0.065), R(2.8 * (1 + Math.floor(Math.random() * 3))), R(s.d * 0.25)));
      pb('container').add(m4, kit.containerCols[Math.floor(Math.random() * kit.containerCols.length)]);
    }
    glow.add(x - R(s.w * 0.4), R(s.d * 0.13 + s.d * 0.33), z, G.Spill, R(s.d * 0.08), R(s.d * 0.75), kit.winCol, 1.2, false);
    for (let i = 0; i < 5; i++) glow.add(x + R((i / 4 - 0.5) * s.w * 0.8), R(s.d * 0.4), z, G.Hot, R(2.2), R(2.2), kit.ledCol, 1.1, false);
    glow.add(x + R(s.w * 0.48), R(s.d * 0.2), z, G.Hot, R(2), R(2), kit.signalGreen, 1.3, false, 0.4, Math.random());
    glow.add(x, 0.3, z + R(s.d * 0.9), G.Reflect, R(s.w * 0.6), R(s.d * 1.4), kit.ledCol, 0.25, false);
  }

  /* ---- water ---- */
  if (ch.water.length) {
    const wm = new THREE.InstancedMesh(kit.geo.quad, kit.mat.water, ch.water.length);
    ch.water.forEach((w, i) => { m4.compose(v3.set(X((w.x0 + w.x1) / 2), -0.6, Z((w.y0 + w.y1) / 2)), q.identity(), s3.set(R(w.x1 - w.x0), 1, R(w.y1 - w.y0) + 0.5)); wm.setMatrixAt(i, m4); });
    wm.receiveShadow = true; wm.frustumCulled = false; group.add(wm);
  }

  /* ---- instanced meshes for buildings ---- */
  const meshByGeo = new Map<GeoKey, THREE.InstancedMesh>();
  for (const [g, b] of batches) {
    const n = b.owners.length;
    const geo = kit.geo[g].clone();
    geo.setAttribute('aB0', new THREE.InstancedBufferAttribute(new Float32Array(b.a0), 4));
    const a1 = new THREE.InstancedBufferAttribute(new Float32Array(b.a1), 4); a1.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aB1', a1);
    geo.setAttribute('aB2', new THREE.InstancedBufferAttribute(new Float32Array(b.a2), 4));
    geo.setAttribute('aB3', new THREE.InstancedBufferAttribute(new Float32Array(b.a3), 4));
    const round = g === 'tank' || g === 'cyl' || g === 'chimney' || g === 'cooler';
    const mesh = new THREE.InstancedMesh(geo, round ? kit.mat.bldRound : kit.mat.bld, n);
    (mesh.instanceMatrix.array as Float32Array).set(b.m);
    mesh.customDepthMaterial = kit.mat.bldDepth;
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    group.add(mesh); meshByGeo.set(g, mesh);
  }
  for (const [b, g, idx] of partLater) ref(b).parts.push({ mesh: meshByGeo.get(g)!, idx });

  /* ---- props ---- */
  const propMesh = new Map<string, THREE.InstancedMesh>();
  for (const [name, p] of props) {
    const def = kit.props[name];
    const mesh = new THREE.InstancedMesh(def.geo, def.mat, p.n);
    (mesh.instanceMatrix.array as Float32Array).set(p.m);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(p.c), 3);
    mesh.castShadow = def.shadow; mesh.receiveShadow = true; mesh.frustumCulled = false;
    group.add(mesh); propMesh.set(name, mesh);
  }
  for (const [b, name, idx] of propLater) ref(b).props.push({ mesh: propMesh.get(name)!, idx });

  /* ---- rubble: placed heaps plus one hidden slot per building ---- */
  const heaps = ch.props.filter((p) => p.k === 'rubble' || p.k === 'hulk');
  const nR = heaps.length + ch.bldgs.length;
  let rubble: THREE.InstancedMesh | null = null;
  if (nR) {
    rubble = new THREE.InstancedMesh(kit.geo.rubble, kit.mat.rubble, nR);
    rubble.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(nR * 3), 3);
    let ri = 0;
    for (const p of heaps) {
      m4.compose(v3.set(X(p.x), 0, Z(p.cy)), q.setFromAxisAngle(UP, p.rot), s3.set(R(p.w), R(p.h), R(p.d)));
      rubble.setMatrixAt(ri, m4); rubble.setColorAt(ri, col.setRGB(0.3 + (p.v > 0.6 ? 0.08 : 0), 0.3, 0.3)); ri++;
    }
    m4.makeScale(0, 0, 0);
    for (const b of ch.bldgs) {
      ref(b).rubble = ri;
      if (b.dead) { rubbleMatrix(b, X, Z, R, m4); rubble.setColorAt(ri, col.setRGB(0.42, 0.3, 0.3)); } else m4.makeScale(0, 0, 0);
      rubble.setMatrixAt(ri, m4); ri++;
    }
    rubble.castShadow = false; rubble.receiveShadow = true; rubble.frustumCulled = false;
    group.add(rubble);
  }

  /* ---- lights ---- */
  const glowMesh = glow.build(kit.mat.glow);
  if (glowMesh) group.add(glowMesh);
  const trafMesh = traffic.build(kit.mat.traffic);
  if (trafMesh) group.add(trafMesh);

  return {
    chunk: ch, group, refs, glow: glowMesh, rubble, fires, stacks,
    dispose() {
      group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); if ((m as THREE.InstancedMesh).isInstancedMesh) (m as THREE.InstancedMesh).dispose(); } });
    },
  };
}

export function rubbleMatrix(b: Bldg, X: (x: number) => number, Z: (y: number) => number, R: (h: number) => number, out: THREE.Matrix4) {
  const hgt = Math.min(14, 3 + b.hgt * 0.12);
  return out.compose(v3.set(X(b.x), 0, Z(b.cy)), q.setFromAxisAngle(UP, b.seed * 6), s3.set(R(b.w * 1.15), R(hgt), R(b.h * 1.15)));
}
