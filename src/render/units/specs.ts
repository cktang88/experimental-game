// Unit specs: what every enemy type is made of (instanced parts), where its lights and muzzles are,
// and how its parts move. Authored in field units, +Z forward, +Y up.
import * as THREE from 'three';
import type { EnemyType } from '../../data/enemies';
import { kitModel, kitDetail, type KitModel } from './kit';
import { liveryMaterial, type LiveryName } from './livery';
import { InstPool } from './pool';
import { rotorDisc } from './rotor';
import * as G from './geo';

/** head: yaws to the unit's aim; rotor: spins about Y; rotorV: tail rotor (spins about X);
 *  spin: tumbles slowly (salvage); dish: radar sweep; rack: launcher that tracks the aim slowly. */
export type Anim = 'none' | 'head' | 'rotor' | 'rotorV' | 'spin' | 'dish' | 'rack';
/** Part transform in the unit frame: T(pivot) * R(anim) * S(scale) * T(-origin). */
export interface PartDef { pool: InstPool; pivot: THREE.Vector3; origin: THREE.Vector3; anim: Anim; speed: number; head: number; scale: number }
export type LightKind = 'port' | 'stbd' | 'strobe' | 'beacon' | 'engine' | 'head' | 'scrap' | 'deck';
/** A light at p (unit frame, or the frame of head `head` when >= 0). */
export interface LightDef { p: THREE.Vector3; kind: LightKind; size: number; head: number }
export interface UnitSpec {
  type: EnemyType; air: boolean; parts: PartDef[]; lights: LightDef[];
  /** Turret pivots (unit frame). Muzzles are in head frame (relative to the pivot). */
  heads: THREE.Vector3[]; muzzles: THREE.Vector3[];
  /** Rough half-length for effects (smoke, fire, wreck size). */
  size: number; revealAlt: number; tracks: number;
  /** Draw several copies (a squad) at these unit-frame offsets, each scaled by squadScale. */
  squad?: THREE.Vector3[]; squadScale?: number;
  /** Half-size of the hostile marking (dark halo and target brackets), field units. */
  mark: number;
}

/** Yaw (radians) that turns each kit model's nose to +Z. */
const ORIENT: Record<string, number> = {};

interface NormOpts { len?: number; span?: number; yaw?: number; ground?: boolean; lift?: number }
/** Bakes a kit model into field units: nose +Z, centred, scaled to a target length (Z) or span (X). */
function norm(m: KitModel, o: NormOpts) {
  const yaw = o.yaw ?? ORIENT[m.name] ?? 0;
  const R = new THREE.Matrix4().makeRotationY(yaw);
  const box = new THREE.Box3();
  for (const p of m.parts) { const g = p.geo.clone().applyMatrix4(R); g.computeBoundingBox(); box.union(g.boundingBox!); }
  const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const s = o.len ? o.len / size.z : o.span ? o.span / size.x : 1;
  const M = new THREE.Matrix4().makeTranslation(0, o.ground ? (o.lift ?? 0) : 0, 0)
    .multiply(new THREE.Matrix4().makeScale(s, s, s))
    .multiply(new THREE.Matrix4().makeTranslation(-c.x, o.ground ? -box.min.y : -c.y, -c.z))
    .multiply(R);
  return {
    parts: m.parts.map((p) => ({ node: p.node, geo: p.geo.clone().applyMatrix4(M), map: p.map, normalMap: p.normalMap, pivot: p.pivot.clone().applyMatrix4(M) })),
    size: size.clone().multiplyScalar(s),
  };
}

/** Extreme vertices: port (+X), starboard (-X), tail (-Z), nose (+Z), top (+Y). */
function extremes(geos: THREE.BufferGeometry[]) {
  const port = new THREE.Vector3(-1e9), stbd = new THREE.Vector3(1e9), tail = new THREE.Vector3(0, 0, 1e9), nose = new THREE.Vector3(0, 0, -1e9), top = new THREE.Vector3(0, -1e9);
  for (const g of geos) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (x > port.x) port.set(x, y, z);
      if (x < stbd.x) stbd.set(x, y, z);
      if (z < tail.z) tail.set(x, y, z);
      if (z > nose.z) nose.set(x, y, z);
      if (y > top.y) top.set(x, y, z);
    }
  }
  return { port, stbd, tail, nose, top };
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export function buildSpecs(scene: THREE.Scene): Partial<Record<EnemyType, UnitSpec>> {
  const D = kitDetail();
  const pool = (geo: THREE.BufferGeometry, liv: LiveryName, cap: number, o: { map?: THREE.Texture | null; normalMap?: THREE.Texture | null; shadow?: boolean; detail?: number } = {}) => {
    const p = new InstPool(geo, liveryMaterial(liv, D, { map: o.map, normalMap: o.normalMap, detailScale: o.detail }), cap, o.shadow ?? true);
    scene.add(p.mesh); return p;
  };
  const rotorPool = (cap: number) => { const r = rotorDisc(); const p = new InstPool(r.geo, r.mat, cap, false); p.mesh.renderOrder = 1; scene.add(p.mesh); return p; };
  const part = (p: InstPool, o: Partial<Omit<PartDef, 'pool'>> = {}): PartDef => {
    const pivot = o.pivot ?? V(0, 0, 0);
    return { pool: p, pivot, origin: o.origin ?? pivot, anim: o.anim ?? 'none', speed: o.speed ?? 0, head: o.head ?? -1, scale: o.scale ?? 1 };
  };
  const kitParts = (name: string, liv: LiveryName, cap: number, o: NormOpts) => {
    const m = kitModel(name); if (!m) return null;
    const n = norm(m, o);
    return { n, parts: n.parts.map((p) => ({ src: p, pool: pool(p.geo, liv, cap, { map: p.map, normalMap: p.normalMap }) })) };
  };
  const L = (p: THREE.Vector3, kind: LightKind, size: number, head = -1): LightDef => ({ p, kind, size, head });
  const S: Partial<Record<EnemyType, UnitSpec>> = {};
  const base = (type: EnemyType, air: boolean, size: number): UnitSpec => ({ type, air, parts: [], lights: [], muzzles: [], size, heads: [], revealAlt: air ? 320 : 0, tracks: 0, mark: size * 1.2 });
  /** An aircraft from a ship model with nav lights at the wingtips, a strobe at the tail and a beacon on top. */
  const aircraft = (type: EnemyType, model: string, liv: LiveryName, cap: number, o: NormOpts, size: number) => {
    const k = kitParts(model, liv, cap, o); if (!k) return null;
    const s = base(type, true, size);
    for (const p of k.parts) s.parts.push(part(p.pool));
    const x = extremes(k.n.parts.map((p) => p.geo));
    const nav = Math.max(3.5, Math.min(7, size * 0.3));
    s.lights.push(L(x.port, 'port', nav), L(x.stbd, 'stbd', nav), L(V(0, x.top.y, x.tail.z * 0.85), 'strobe', nav * 1.2), L(V(0, x.top.y + 0.5, x.top.z), 'beacon', nav));
    S[type] = s; return { s, x, n: k.n };
  };
  const rotor = (p: InstPool, at: THREE.Vector3, r: number, speed: number, anim: Anim = 'rotor') => part(p, { pivot: at, origin: V(0, 0, 0), anim, speed, scale: r });

  // ---------------- air
  {
    const a = aircraft('jet', 'Q_Omen', 'charcoal', 48, { len: 30 }, 14);
    if (a) for (const sx of [-1.6, 1.6]) a.s.lights.push(L(V(sx, 0, a.x.tail.z), 'engine', 12));
  }
  {
    const a = aircraft('drone', 'Q_Bob', 'charcoal', 96, { len: 17 }, 8);
    if (a) { a.s.lights = a.s.lights.filter((l) => l.kind !== 'strobe'); a.s.lights.push(L(V(0, 0, a.x.tail.z), 'engine', 9)); a.s.revealAlt = 200; }
  }
  {
    const a = aircraft('heli', 'Q_Zenith', 'olive', 24, { len: 36 }, 15);
    if (a) {
      const r = rotorPool(48);
      a.s.parts.push(rotor(r, V(0, a.x.top.y + 1.5, a.n.size.z * 0.18), 19, 34), rotor(r, V(1.8, 1, a.x.tail.z + 2.5), 4.2, 50, 'rotorV'));
      a.s.muzzles.push(V(0, -1, a.x.nose.z));
    }
  }
  {
    const a = aircraft('gunship', 'Q_Spitfire', 'olive', 16, { span: 54 }, 26);
    if (a) {
      const r = rotorPool(32);
      a.s.parts.push(rotor(r, V(a.x.port.x - 3, a.x.top.y + 1, a.x.port.z), 15, 30), rotor(r, V(a.x.stbd.x + 3, a.x.top.y + 1, a.x.stbd.z), 15, -30));
      a.s.lights.push(L(V(0, a.x.top.y * 0.5, a.x.tail.z), 'engine', 10));
      a.s.muzzles.push(V(0, -1, a.x.nose.z));
    }
  }
  {
    const a = aircraft('bomber', 'Q_Challenger', 'desert', 10, { span: 78 }, 34);
    if (a) for (const sx of [-0.18, 0.18]) a.s.lights.push(L(V(a.n.size.x * sx * 0.5, 0, a.x.tail.z), 'engine', 13));
  }
  {
    const a = aircraft('ace', 'Q_Executioner', 'elite', 2, { span: 84 }, 40);
    if (a) {
      const r = rotorPool(4);
      a.s.parts.push(rotor(r, V(a.x.port.x - 2, a.x.top.y + 2, a.x.port.z), 21, 32), rotor(r, V(a.x.stbd.x + 2, a.x.top.y + 2, a.x.stbd.z), 21, -32));
      for (const sx of [-0.12, 0.12]) a.s.lights.push(L(V(a.n.size.x * sx, 0, a.x.tail.z), 'engine', 14));
      a.s.muzzles.push(V(0, -2, a.x.nose.z));
      a.s.revealAlt = 600;
    }
  }
  {
    const a = aircraft('carrier', 'Q_Imperial', 'elite', 2, { len: 128 }, 60);
    if (a) {
      const r = rotorPool(8), w = a.n.size.x * 0.5, l = a.n.size.z * 0.5;
      for (const [fx, fz] of [[-1, 0.62], [1, 0.62], [-1, -0.55], [1, -0.55]]) a.s.parts.push(rotor(r, V(fx * (w + 4), 2, fz * l), 13, 26 * fx));
      for (let i = 0; i < 9; i++) for (const sx of [-1, 1]) a.s.lights.push(L(V(sx * w * 0.42, a.x.top.y * 0.7, -l * 0.7 + i * l * 0.17), 'deck', 5));
      for (const sx of [-0.25, 0, 0.25]) a.s.lights.push(L(V(w * sx, 0, a.x.tail.z), 'engine', 15));
      a.s.revealAlt = 700;
    }
  }
  {
    const s = base('canister', true, 9);
    s.parts.push(part(pool(G.canister(), 'salvage', 16, { detail: 10 }), { anim: 'spin', speed: 0.9 }));
    s.lights.push(L(V(0, 0, 0), 'scrap', 34));
    s.revealAlt = 240; S.canister = s;
  }

  // ---------------- ground
  {
    const s = base('tank', false, 15);
    s.parts.push(part(pool(G.tankHull(), 'olive', 48, { detail: 14 })));
    s.heads.push(V(0, 6.5, -1));
    s.parts.push(part(pool(G.tankTurret(), 'olive', 48, { detail: 14 }), { pivot: V(0, 6.5, -1), anim: 'head', head: 0 }));
    s.muzzles.push(V(0, 1.7, 22.4));
    for (const sx of [-4, 4]) s.lights.push(L(V(sx, 5.4, 13.6), 'head', 5));
    s.tracks = 6.7; S.tank = s;
  }
  {
    // A squad reads as a cluster of three oversized figures: one soldier is a pixel from up here.
    const s = base('infantry', false, 4);
    s.parts.push(part(pool(G.soldier(), 'fatigue', 720, { detail: 6 })));
    s.squad = [V(-4.5, 0, -2.5), V(4.5, 0, -1.5), V(0, 0, 4)]; s.squadScale = 1.6;
    s.lights.push(L(V(0, 5.85 * 1.6, 4 + 0.9 * 1.6), 'head', 2.6));
    s.mark = 12;
    S.infantry = s;
  }
  {
    const k = kitParts('K_TurretDouble', 'charcoal', 32, { span: 30, ground: true });
    if (k) {
      const s = base('turret', false, 15);
      const head = k.parts.find((p) => p.src.node === 'turret');
      const piv = head ? head.src.pivot : V(0, 8, 0);
      s.heads.push(piv);
      for (const p of k.parts) s.parts.push(p === head ? part(p.pool, { pivot: piv, anim: 'head', head: 0 }) : part(p.pool));
      for (const sx of [-2.6, 2.6]) s.muzzles.push(V(sx, 3, 16));
      s.lights.push(L(V(0, k.n.size.y - piv.y + 0.4, -5), 'beacon', 5, 0));
      S.turret = s;
    }
  }
  {
    const k = kitParts('K_TruckFlat', 'desert', 24, { len: 30, ground: true });
    if (k) {
      const s = base('sam', false, 15);
      for (const p of k.parts) s.parts.push(part(p.pool));
      const deck = k.n.size.y * 0.5, rp = V(0, deck, -6), dp = V(0, k.n.size.y + 2.6, 7.5);
      s.heads.push(rp);
      s.parts.push(part(pool(G.samRack(), 'desert', 24, { detail: 12 }), { pivot: rp, origin: V(0, 0, 0), anim: 'rack', head: 0 }));
      s.parts.push(part(pool(G.radarDish(), 'charcoal', 24, { detail: 6 }), { pivot: dp, origin: V(0, 0, 0), anim: 'dish', speed: 2.2 }));
      for (const sx of [-4.5, 4.5]) s.lights.push(L(V(sx, k.n.size.y * 0.42, 15.2), 'head', 4));
      S.sam = s;
    }
  }
  {
    const k = kitParts('K_HangarRoundGlass', 'charcoal', 16, { span: 32, ground: true });
    const s = base('bunker', false, 24);
    if (k) for (const p of k.parts) s.parts.push(part(p.pool));
    s.parts.push(part(pool(G.bunkerRing(), 'desert', 16, { detail: 14 })));
    s.lights.push(L(V(0, (k?.n.size.y ?? 10) + 0.6, 0), 'beacon', 8));
    S.bunker = s;
  }
  {
    const s = base('cache', false, 13);
    s.parts.push(part(pool(G.crates(), 'salvage', 16, { detail: 10 })));
    s.lights.push(L(V(7.5, 13.2, -6.5), 'scrap', 9));
    S.cache = s;
  }
  {
    const s = base('wreck', false, 20);
    s.parts.push(part(pool(G.scrapHeap(), 'olive', 16, { detail: 12 })));
    for (const [n, x, z, ry] of [['K_DebrisPlateA', -8, 9, 0.6], ['K_DebrisDrivetrain', 9, 6, 2.2], ['K_DebrisDoor', -10, -7, 1.1], ['K_DebrisTire', 4, -11, 0.3]] as const) {
      const m = kitModel(n); if (!m) continue;
      const nn = norm(m, { len: 9, ground: true });
      for (const p of nn.parts) s.parts.push(part(pool(p.geo.applyMatrix4(new THREE.Matrix4().makeRotationY(ry).setPosition(x, 0, z)), 'olive', 16)));
    }
    s.lights.push(L(V(0, 6, 0), 'scrap', 30));
    S.wreck = s;
  }
  {
    const s = base('crawler', false, 52);
    s.parts.push(part(pool(G.crawlerTracks(), 'olive', 2, { detail: 26 })));
    let top = 26;
    const deck = kitModel('Q_Imperial');
    if (deck) {
      const n = norm(deck, { len: 96, ground: true, lift: 12 });
      for (const p of n.parts) s.parts.push(part(pool(p.geo.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI / 2)), 'olive', 2, { map: p.map, normalMap: p.normalMap })));
      top = 12 + n.size.y;
    }
    const tp = pool(G.tankTurret(), 'olive', 6, { detail: 14 });
    [-32, 0, 32].forEach((ox, i) => {
      const piv = V(ox, top - 3, 0);
      s.heads.push(piv);
      s.parts.push(part(tp, { pivot: piv, origin: V(0, 6.5, -1), anim: 'head', head: i, scale: 1.5 }));
    });
    s.muzzles.push(V(0, 1.7 * 1.5, 22.4 * 1.5));
    for (const sz of [-20, 20]) s.lights.push(L(V(54, 10, sz), 'head', 8), L(V(-54, 10, sz), 'head', 8));
    s.lights.push(L(V(0, top + 4, -22), 'beacon', 10));
    s.tracks = 33; S.crawler = s;
  }
  return S;
}
