// Biome content: what stands on the ground of each biome, row by row, in FIELD units (see worldgen.ts for the frame).
// Owned by the city/world workstream. Every generator gets a chunk and its city-y band [c0, c1] (c0 < c1, c0 is
// further ahead) and adds structures (fb(), destructible), pads, road segments, lights and movers, masked by
// inBiome() so two biomes share a band along a ragged edge. Set pieces (a dam, a launch site, a lighthouse, a
// stadium...) come along every several rows; `setPieceIn(name)` forces one for screenshots.
//
// From the ship's altitude a field unit is ~1.8 m: a runway is 26 units wide, a cabin 4, a container ship 120 long.
import { rnd, pick } from '../util/rng';
import { FIELD_W as W } from './field';
import { S } from './combat';
import { Biome } from './biomes';
import {
  fb, tier, inBiome, CITY, X0, X1, Style, LC, type Chunk, type Bldg, type Surface, type Mover,
} from './worldgen';
import {
  sampleCy, coastX, quayK, riverX, valleyX, valley2X, wadiX, highwayX, RUNWAY_X, pathX, Burn, fbm, DAMS, type TerrainSample, type SurfaceKind,
} from './terrain';

const ts: TerrainSample = { h: 0, water: 0, cover: 0 };
const T = (x: number, cy: number) => sampleCy(x, cy, ts);
const L = (ch: Chunk, x: number, cy: number, h: number, s: number, c: number, a: number, k = 2, p = Math.random(), b?: Bldg) => { ch.lights.push({ x, cy, h, s, c, a, k, p, b }); };
const pad = (ch: Chunk, x0: number, y0: number, x1: number, y1: number, s: Surface) => { ch.pads.push({ x0, y0, x1, y1, s }); };
const seg = (ch: Chunk, x0: number, cy0: number, x1: number, cy1: number, w: number, s: Surface) => { ch.segs.push({ x0, cy0, x1, cy1, w, s }); };
const zone = (ch: Chunk, x0: number, y0: number, x1: number, y1: number, s: SurfaceKind) => { ch.zones.push({ x0, y0, x1, y1, s }); };
const mover = (ch: Chunk, m: Omit<Mover, 't0' | 'seed'>) => { ch.movers.push({ ...m, t0: CITY.time, seed: Math.random() }); };

/* ---------------- claims: set pieces keep fillers off their ground ---------------- */
interface Claim { x0: number; y0: number; x1: number; y1: number }
const claims: Claim[] = [];
const claim = (x0: number, y0: number, x1: number, y1: number) => { claims.push({ x0, y0, x1, y1 }); if (claims.length > 40) claims.shift(); };
function free(x: number, cy: number, r = 0) {
  for (const c of claims) if (x + r > c.x0 && x - r < c.x1 && cy + r > c.y0 && cy - r < c.y1) return false;
  return true;
}
/** Generators call this to place a structure: in its biome, off claimed ground. */
const ok = (b: Biome, x: number, cy: number, r = 0) => x > X0 + 4 && x < X1 - 4 && inBiome(b, x, cy) && free(x, cy, r);

/** A road following x = f(cy) through the band, masked by the biome. */
function pathRoad(ch: Chunk, b: Biome, f: (cy: number) => number, c0: number, c1: number, w: number, s: Surface, zs: SurfaceKind = 'road', step = 14) {
  for (let cy = c1; cy > c0; cy -= step) {
    const ya = cy, yb = Math.max(c0, cy - step) - 0.6, xa = f(ya), xb = f(yb);
    if (!inBiome(b, (xa + xb) / 2, (ya + yb) / 2) || !free((xa + xb) / 2, (ya + yb) / 2)) continue;
    seg(ch, xa, ya, xb, yb, w, s);
    zone(ch, Math.min(xa, xb) - w / 2, yb, Math.max(xa, xb) + w / 2, ya, zs);
  }
}

/* ---------------- shared structures ---------------- */
const CONTAINER_TINTS = ['#6a3a2a', '#2a4566', '#335c56', '#6e5a2c', '#6a7076', '#47395a', '#36503c', '#7a5226'];
/** A parked aircraft, nose toward -x (rot turns it). Fuel: it burns and blows. */
function plane(ch: Chunk, x: number, cy: number, len: number, span: number, rot = 0, tint = '#4b525a') {
  const c = Math.cos(rot), s = Math.sin(rot);
  const w = Math.abs(c) * len + Math.abs(s) * span, h = Math.abs(s) * len + Math.abs(c) * span;
  return fb(ch, 'plane', x, cy, w, h, 2.2, Style.Shell, { tint, rot, lit: 0, fuel: 0.7, spill: Burn.Oil }, [
    tier(len, len * 0.13, 0, len * 0.11),
    tier(len * 0.22, span, len * 0.05, len * 0.03, -len * 0.04, 0),
    tier(len * 0.12, span * 0.38, len * 0.06, len * 0.025, len * 0.42, 0),
  ]);
}
/** A moored or anchored ship, bow toward -cy. Container ships carry coloured rows on deck. */
function ship(ch: Chunk, x: number, cy: number, len: number, beam: number, kind: 'box' | 'tanker' | 'bulk', lights = true) {
  const hull = fb(ch, 'ship', x, cy, beam, len, 3, Style.Hull, { tint: kind === 'tanker' ? '#2a211d' : '#1d2329', lit: 0.4, keepLit: true, fuel: kind === 'tanker' ? 1.3 : 0, spill: kind === 'tanker' ? Burn.Oil : 0 }, [
    tier(beam, len, 0, 3),
    tier(beam * 0.84, beam * 0.5, 3, 7, 0, len * 0.38),
    tier(beam * 0.5, len * 0.08, 0.5, 2.6, 0, -len * 0.47),
  ]);
  if (kind === 'box') {
    // Container rows: two coloured blocks per hold.
    const holds = Math.floor(len * 0.68 / 12);
    for (let i = 0; i < holds; i++) {
      const hy = cy - len * 0.3 + i * 12;
      fb(ch, 'low', x, hy, beam * 0.8, 10.5, 2.4, Style.Shell, { tint: pick(CONTAINER_TINTS), lit: 0 }, [tier(beam * 0.8, 10.5, 3, 1.4 + Math.random() * 1.6)]);
    }
  } else if (kind === 'tanker') {
    for (let i = 0; i < 5; i++) L(ch, x, cy - len * 0.3 + i * len * 0.13, 3.4, 0.7, LC.Amber, 0.3, 2);
  }
  if (lights) {
    L(ch, x, cy + len * 0.38, 10.5, 1.0, LC.White, 0.7, 2, 0, hull);
    L(ch, x, cy - len * 0.48, 4, 0.8, LC.White, 0.6, 2, 0, hull);
    for (let i = 0; i < 4; i++) L(ch, x + (i % 2 ? beam : -beam) * 0.42, cy - len * 0.3 + i * len * 0.18, 3.5, 0.6, LC.Sodium, 0.45, 2, 0, hull);
  }
  return hull;
}
/** A walled compound with a few houses and a light (desert, mountain posts). */
function compound(ch: Chunk, b: Biome, x: number, cy: number, s: number, style: Style, roof: number, tint?: string) {
  const t = 0.8, wh = 1.3;
  const o = { tint, lit: 0, roof };
  fb(ch, 'wall', x, cy - s / 2, s, t, wh, style, o);
  fb(ch, 'wall', x, cy + s / 2, s, t, wh, style, o);
  fb(ch, 'wall', x - s / 2, cy, t, s, wh, style, o);
  fb(ch, 'wall', x + s / 2, cy, t, s * 0.6, wh, style, o);
  const n = 1 + Math.floor(Math.random() * 3.5);
  for (let i = 0; i < n; i++) {
    const hw = rnd(3.5, s * 0.4), hh = rnd(3, s * 0.35);
    const hx = x + rnd(-1, 1) * (s / 2 - hw / 2 - 1.2), hy = cy + rnd(-1, 1) * (s / 2 - hh / 2 - 1.2);
    fb(ch, 'house', hx, hy, hw, hh, rnd(1.1, 2.4), style, { tint, lit: rnd(0.2, 0.6), roof });
  }
  L(ch, x + rnd(-s, s) * 0.3, cy + rnd(-s, s) * 0.3, 2, 0.9, b === Biome.Desert ? LC.Warm : LC.Sodium, 0.55, 0);
}
/** Floodlight mast: a hot pinpoint and the pool of light it throws. */
function flood(ch: Chunk, x: number, cy: number, h: number, pool: number, c = LC.Flood, a = 1) {
  L(ch, x, cy, h, 0.9, c, 0.7 * a, 2);
  L(ch, x, cy, 0.6, pool, c, 0.07 * a, 4);
}
function cluster(ch: Chunk, b: Biome, cx: number, cy: number, n: number, rad: number, style: Style, roof: number, tint?: string, lamp = LC.Sodium) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * rad, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.8;
    if (!ok(b, x, y, 2)) continue;
    T(x, y); if (ts.water > 0.3) continue;
    const w = rnd(3, 5.5), h = rnd(2.6, 4.2), rot = pick([0, Math.PI / 2, 0.2, -0.3]);
    fb(ch, Math.random() < 0.5 ? 'cabin' : 'house', x, y, w, h, rnd(1.2, 2.2), style, { tint, lit: rnd(0.25, 0.7), roof, rot });
    if (Math.random() < 0.7) L(ch, x + rnd(-3, 3), y + rnd(-3, 3), 1.5, 0.8, Math.random() < 0.6 ? LC.Warm : lamp, 0.5, 0);
  }
}
function church(ch: Chunk, x: number, cy: number, roof: number) {
  fb(ch, 'mid', x, cy, 5, 9, 3.2, Style.Brick, { lit: 0.3, roof }, [tier(5, 9, 0, 3.2), tier(2.4, 2.4, 0, 9, 0, -5)]);
  L(ch, x, cy - 5, 9.4, 0.7, LC.Warm, 0.6, 2);
}
/** A dam across a valley or river: concrete arc, crest lights, powerhouse. Reservoir water is in the terrain. */
function dam(ch: Chunk, b: Biome, cx: number, cy: number, half: number) {
  const n = 7;
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n * 2 - 1, x = cx + u * half, y = cy - (1 - u * u) * half * 0.18;
    fb(ch, 'dam', x, y, (half * 2) / n + 1, 5, 7, Style.Concrete, { lit: 0, tint: '#3a3d42', rot: -u * 0.35 });
    L(ch, x, y - 2, 7.5, 0.8, LC.Sodium, 0.6, 0);
  }
  fb(ch, 'warehouse', cx, cy + 12, 20, 8, 4, Style.Industrial, { lit: 0.5 });
  flood(ch, cx - 8, cy + 18, 6, 14, LC.Flood, 0.8);
  flood(ch, cx + 8, cy + 18, 6, 14, LC.Flood, 0.8);
  void b;
}

/* ---------------- set pieces ---------------- */
let forced: string | null = null;
/** Debug: force the next set piece of the biome on the ground (window.__city.setPieceIn('dam')). */
export function setPieceIn(name: string) { forced = name; CITY.sinceSet = 99; }
const SET_PIECES: Record<Biome, string[]> = {
  [Biome.City]: ['stadium', 'tvtower'],
  [Biome.Port]: ['lighthouse', 'oilterminal', 'drydock'],
  [Biome.Airfield]: ['bigtransport', 'shelters', 'radar'],
  [Biome.Desert]: ['launchsite', 'gasplant', 'citadel'],
  [Biome.Snow]: ['dam', 'fort', 'radar'],
  [Biome.Forest]: ['mill', 'dam', 'lookout'],
};
/** Should this chunk carry a set piece of biome b? Returns its name. */
function setPieceDue(b: Biome, c0: number, c1: number): string | null {
  const mid = (c0 + c1) / 2;
  if (!inBiome(b, W / 2, mid)) return null;
  if (forced && SET_PIECES[b].includes(forced)) { const f = forced; forced = null; CITY.sinceSet = 0; return f; }
  if (CITY.sinceSet < 6 || Math.random() > 0.45) return null;
  CITY.sinceSet = 0;
  return pick(SET_PIECES[b]);
}

/* ======================================================================================================== */
/* NIGHT CITY: blocks come from worldgen's plan; here only its set pieces.                                   */
/* ======================================================================================================== */
function clearArea(ch: Chunk, x0: number, y0: number, x1: number, y1: number) {
  const gone = new Set<Bldg>();
  ch.bldgs = ch.bldgs.filter((b) => (b.x > x0 && b.x < x1 && b.cy > y0 && b.cy < y1 ? (gone.add(b), false) : true));
  if (gone.size) S.decor = S.decor.filter((d) => !gone.has(d as Bldg));
  ch.props = ch.props.filter((p) => !(p.x > x0 && p.x < x1 && p.cy > y0 && p.cy < y1) && !(p.on && gone.has(p.on)));
  ch.pads = ch.pads.filter((p) => !((p.x0 + p.x1) / 2 > x0 && (p.x0 + p.x1) / 2 < x1 && (p.y0 + p.y1) / 2 > y0 && (p.y0 + p.y1) / 2 < y1));
  ch.roads = ch.roads.filter((r) => !(r.dir === 0 && (r.x0 + r.x1) / 2 > x0 && (r.x0 + r.x1) / 2 < x1));
}
export function genCity(ch: Chunk, c0: number, c1: number) {
  CITY.sinceSet++;
  const sp = setPieceDue(Biome.City, c0, c1);
  if (!sp) return;
  const cx = rnd(W * 0.25, W * 0.75), cy = (c0 + c1) / 2;
  if (!inBiome(Biome.City, cx, cy)) return;
  if (sp === 'stadium') {
    // A floodlit bowl: from up here a bright green rectangle in the dark grid.
    const w = 64, h = 46;
    clearArea(ch, cx - w / 2 - 6, cy - h / 2 - 6, cx + w / 2 + 6, cy + h / 2 + 6);
    pad(ch, cx - w / 2 - 6, cy - h / 2 - 6, cx + w / 2 + 6, cy + h / 2 + 6, 'plaza');
    pad(ch, cx - w * 0.32, cy - h * 0.3, cx + w * 0.32, cy + h * 0.3, 'pitch');
    const o = { lit: 0.15, tint: '#2b2e33' };
    fb(ch, 'stand', cx, cy - h / 2 + 3, w, 6, 4.5, Style.Concrete, o);
    fb(ch, 'stand', cx, cy + h / 2 - 3, w, 6, 4.5, Style.Concrete, o);
    fb(ch, 'stand', cx - w / 2 + 3, cy, 6, h - 12, 4.5, Style.Concrete, o);
    fb(ch, 'stand', cx + w / 2 - 3, cy, 6, h - 12, 4.5, Style.Concrete, o);
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      fb(ch, 'mast', cx + sx * (w / 2 - 1), cy + sy * (h / 2 - 1), 1.4, 1.4, 14, Style.Metal, { lit: 0 });
      L(ch, cx + sx * (w / 2 - 1), cy + sy * (h / 2 - 1), 14.4, 2.6, LC.Flood, 1, 2);
    }
    L(ch, cx, cy, 0.5, w * 0.9, LC.Flood, 0.12, 1);
    claim(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2);
  } else {
    // TV tower: a needle with a lit pod and a beacon, over a small plaza.
    clearArea(ch, cx - 14, cy - 14, cx + 14, cy + 14);
    pad(ch, cx - 14, cy - 14, cx + 14, cy + 14, 'plaza');
    const t = fb(ch, 'tower', cx, cy, 5, 5, 62, Style.Concrete, { lit: 0.2, keepLit: true }, [tier(5, 5, 0, 3), tier(1.6, 1.6, 3, 59), tier(5.5, 5.5, 40, 3.2)]);
    L(ch, cx, cy, 62.5, 2.2, LC.White, 0.9, 3, 0, t);
    L(ch, cx, cy, 43.4, 1.6, LC.Sodium, 0.7, 2, 0, t);
  }
}

/* ======================================================================================================== */
/* HARBOUR: dark water on the left, straight quays with gantry cranes and container stacks, a natural shore    */
/* with a fishing village, ships alongside and underway with wakes, a lighthouse on the breakwater.            */
/* ======================================================================================================== */
export function genPort(ch: Chunk, c0: number, c1: number) {
  const B = Biome.Port;
  CITY.sinceSet++;
  const mid = (c0 + c1) / 2, q = quayK(mid);
  const sp = setPieceDue(B, c0, c1);
  // Coast road behind the waterfront.
  pathRoad(ch, B, (cy) => coastX(cy) + (quayK(cy) > 0.5 ? 345 : 60), c0, c1, 5, 'road');
  if (q > 0.5) {
    const cx = coastX(mid);
    // Quay apron and cranes.
    if (ok(B, cx + 30, mid)) {
      pad(ch, cx - 1, c0, cx + 66, c1, 'dock'); zone(ch, cx - 1, c0, cx + 66, c1, 'dock');
      for (let y = Math.ceil(c0 / 12) * 12; y < c1; y += 12) L(ch, cx + 1, y, 1, 0.8, LC.Sodium, 0.5, 0);
      for (let y = c0 + rnd(4, 16); y < c1 - 6; y += rnd(26, 36)) {
        if (!ok(B, cx + 6, y)) continue;
        const cr = fb(ch, 'crane', cx + 6, y, 12, 4, 13.5, Style.Shell, { tint: '#7a5a2a', lit: 0 }, [
          tier(10, 3.2, 0, 12.2, 1, 0), tier(40, 2.2, 12.2, 1.4, -8, 0), tier(4, 4, 12.2, 3.5, 4, 0),
        ]);
        L(ch, cx - 27, y, 13.8, 0.9, LC.Amber, 0.75, 3, Math.random(), cr);
        L(ch, cx + 6, y, 1, 10, LC.Flood, 0.05, 1);
      }
      // Ship alongside.
      if (Math.random() < 0.55 && free(cx - 12, mid)) ship(ch, cx - 12, mid + rnd(-20, 20), rnd(95, 140), 15, pick(['box', 'box', 'bulk']));
    }
    // Container yard: coloured stacks in long blocks, floodlit.
    const yx0 = cx + 72, yx1 = cx + 255;
    for (let y = c0 + 4; y < c1 - 4; y += 8.5) {
      for (let x = yx0; x < yx1; x += 25) {
        if (Math.random() < 0.18 || !ok(B, x + 11, y)) continue;
        fb(ch, 'low', x + 11, y + 2.6, 22, 5.2, 1.4 * (1 + Math.floor(Math.random() * 3.4)), Style.Shell, { tint: pick(CONTAINER_TINTS), lit: 0 });
      }
    }
    if (inBiome(B, yx0 + 90, mid)) {
      pad(ch, yx0 - 4, c0, yx1 + 4, c1, 'concrete'); zone(ch, yx0 - 4, c0, yx1 + 4, c1, 'dock');
      for (let y = c0 + 20; y < c1; y += 60) for (const x of [yx0 + 60, yx0 + 140]) flood(ch, x, y, 14, 26, LC.Sodium, 0.9);
    }
    // Sheds and a rail siding, then the harbour district.
    for (let y = c0 + 4; y < c1 - 10; y += rnd(30, 44)) if (ok(B, cx + 290, y + 12)) fb(ch, 'warehouse', cx + 290, y + 12, 44, rnd(18, 26), 4, Style.Industrial, { lit: 0.12 });
    if (inBiome(B, cx + 322, mid)) { seg(ch, cx + 322, c1, cx + 322, c0, 2.4, 'rail'); for (let y = c0 + 8; y < c1 - 8; y += 9) if (Math.random() < 0.6) ch.props.push({ k: 'railcar', x: cx + 322, cy: y, w: 1.4, d: 8, h: 1.1, rot: 0, v: Math.random() }); }
    district(ch, B, cx + 360, X1, c0, c1);
  } else {
    // Natural shore: scrub, a fishing village with a jetty and boats, houses up the slope.
    if (Math.random() < 0.45) {
      const y = rnd(c0 + 20, c1 - 20), sx = coastX(y);
      if (ok(B, sx + 30, y)) {
        cluster(ch, B, sx + 40, y, 14, 34, Style.House, 0, undefined, LC.Sodium);
        seg(ch, sx + 4, y, sx - 40, y + 6, 2.4, 'dock');
        for (let i = 0; i < 3; i++) fb(ch, 'ship', sx - 14 - i * 9, y + 10 + rnd(-2, 2), 2.4, 7, 1.2, Style.Hull, { tint: '#2a2f33', lit: 0 });
        L(ch, sx - 40, y + 6, 2, 0.8, LC.White, 0.6, 3);
      }
    }
    for (let i = 0; i < 6; i++) {
      const y = rnd(c0, c1), x = coastX(y) + rnd(90, 600);
      if (ok(B, x, y, 3)) fb(ch, 'house', x, y, rnd(4, 7), rnd(3, 5), rnd(1.2, 3), Style.House, { lit: rnd(0.2, 0.6), rot: rnd(-0.4, 0.4) });
    }
    district(ch, B, coastX(mid) + 640, X1, c0, c1);
  }
  // On the water: channel buoys, anchored ships, traffic with wakes.
  for (let y = c0 + rnd(0, 40); y < c1; y += 80) {
    const x = coastX(y) - 95;
    if (inBiome(B, x, y)) { L(ch, x, y, 1, 0.8, LC.Teal, 0.6, 3, Math.random()); L(ch, x - 70, y + 20, 1, 0.8, LC.White, 0.5, 3, Math.random()); }
  }
  if (Math.random() < 0.3) { const y = rnd(c0, c1), x = coastX(y) - rnd(170, 360); if (ok(B, x, y, 30) && T(x, y).water > 0.9) ship(ch, x, y, rnd(110, 170), 18, pick(['bulk', 'tanker', 'box'])); }
  if (Math.random() < 0.55) { const y = rnd(c0, c1), x = coastX(y) - rnd(60, 160); if (inBiome(B, x, y)) mover(ch, { k: Math.random() < 0.6 ? 'tug' : 'boat', x, cy: y, v: rnd(9, 18), path: 0, a: pick([-Math.PI / 2, Math.PI / 2]) + rnd(-0.4, 0.4), len: rnd(5, 9), n: 1 }); }
  if (Math.random() < 0.3) { const y = rnd(c0, c1), x = coastX(y) - rnd(220, 380); if (inBiome(B, x, y)) mover(ch, { k: 'ship', x, cy: y, v: rnd(7, 11), path: 0, a: -Math.PI / 2 + rnd(-0.15, 0.15), len: rnd(90, 130), n: 1 }); }

  if (!sp) return;
  const cy = mid, cx = coastX(cy);
  if (sp === 'lighthouse') {
    // Breakwater curving out into the water, a lighthouse sweeping its beam at the end.
    const ex = cx - rnd(220, 300), ey = cy - rnd(60, 120);
    seg(ch, cx + 2, cy + 10, (cx + ex) / 2, cy - 10, 6, 'concrete');
    seg(ch, (cx + ex) / 2, cy - 10, ex, ey, 6, 'concrete');
    for (let i = 1; i < 6; i++) L(ch, cx + (ex - cx) * (i / 6), cy + 10 + (ey - cy - 10) * (i / 6), 1, 0.6, LC.Sodium, 0.35, 0);
    const lh = fb(ch, 'lighthouse', ex, ey, 4, 4, 13, Style.Shell, { tint: '#8a8f96', lit: 0, keepLit: true });
    L(ch, ex, ey, 13.6, 1.8, LC.White, 1, 8, 0, lh);
    claim(ex - 10, ey - 10, cx + 10, cy + 20);
  } else if (sp === 'oilterminal') {
    // A tanker at a T-jetty, the tank farm behind the quay. Everything here burns.
    const jx = cx - 150;
    seg(ch, cx, cy + 4, jx, cy + 4, 3, 'dock'); seg(ch, jx, cy - 70, jx, cy + 70, 5, 'dock');
    for (let i = 0; i < 6; i++) L(ch, jx, cy - 60 + i * 24, 2.5, 0.8, LC.Sodium, 0.55, 0);
    ship(ch, jx - 13, cy, 150, 20, 'tanker');
    tankFarm(ch, B, cx + 120, cy, 210, 110);
    claim(jx - 30, cy - 80, cx + 230, cy + 80);
  } else {
    // Drydock: a ship in a dark basin under two portal cranes, welding light spilling everywhere.
    const bx = cx + 150;
    pad(ch, bx - 20, cy - 80, bx + 20, cy + 80, 'basin');
    ship(ch, bx, cy, 130, 17, 'box', false);
    for (const y of [cy - 30, cy + 35]) {
      const cr = fb(ch, 'gantry', bx, y, 50, 5, 18, Style.Metal, { tint: '#4a3a24', lit: 0 }, [tier(3, 4, 0, 17, -23, 0), tier(3, 4, 0, 17, 23, 0), tier(50, 4, 17, 2.5)]);
      L(ch, bx, y, 19.8, 1.2, LC.Amber, 0.8, 3, Math.random(), cr);
    }
    for (let i = 0; i < 8; i++) L(ch, bx + rnd(-8, 8), cy + rnd(-60, 60), 4, 0.9, LC.Flood, 0.9, 3, Math.random());
    flood(ch, bx - 26, cy - 60, 12, 30); flood(ch, bx + 26, cy + 60, 12, 30);
    claim(bx - 30, cy - 90, bx + 30, cy + 90);
  }
}
/** Harbour district: blocks of mid-rises and sheds with streets, out to x1. */
function district(ch: Chunk, b: Biome, x0: number, x1: number, c0: number, c1: number) {
  for (let y = c0; y < c1; y += 34) {
    seg(ch, x0, y, x1, y, 3.6, 'road'); zone(ch, x0, y - 2, x1, y + 2, 'road');
    for (let x = x0 + 4; x < x1 - 10; x += rnd(30, 42)) {
      if (!ok(b, x + 14, y + 17, 4)) continue;
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const w = rnd(8, 14), h = rnd(8, 12), bx = x + 4 + i * (26 / n) + w / 2, by = y + 4 + rnd(0, 26 - h) + h / 2;
        fb(ch, Math.random() < 0.3 ? 'warehouse' : 'mid', bx, by, w, h, rnd(1.5, 6.5), pick([Style.Brick, Style.Concrete, Style.Panel, Style.Industrial]), { lit: rnd(0.15, 0.6) });
      }
    }
  }
  for (let i = 0; i < 4; i++) { const x = rnd(x0, x1), y = rnd(c0, c1); if (inBiome(b, x, y)) L(ch, x, y, 2, 0.9, LC.Sodium, 0.5, 0); }
}
/** Round tanks in bunds: chain reactions. */
function tankFarm(ch: Chunk, b: Biome, cx: number, cy: number, w: number, h: number) {
  pad(ch, cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, 'bund');
  const s = rnd(14, 19);
  for (let x = cx - w / 2 + s * 0.7; x < cx + w / 2 - s * 0.5; x += s + 4) for (let y = cy - h / 2 + s * 0.7; y < cy + h / 2 - s * 0.5; y += s + 4) {
    if (Math.random() < 0.12 || !inBiome(b, x, y)) continue;
    const d = s * rnd(0.8, 1);
    fb(ch, 'tank', x, y, d, d, d * rnd(0.35, 0.5), Style.Metal, { tint: '#5a5e62', lit: 0, spill: Burn.Oil });
  }
  for (let i = 0; i < 4; i++) L(ch, cx + rnd(-w, w) * 0.45, cy + rnd(-h, h) * 0.45, 8, 0.9, LC.Sodium, 0.55, 0);
}

/* ======================================================================================================== */
/* AIRBASE: runways along the flight path with approach strobes, taxiway edge lights, hangars, revetments,    */
/* parked aircraft, radomes, fuel farm and ammunition igloos.                                                 */
/* ======================================================================================================== */
interface Runway { top: number; bot: number; x: number }
const AIR = { runways: [] as Runway[], gen: -1 };
function runwaysFor(c0: number): Runway[] {
  if (AIR.gen !== CITY.gen) { AIR.gen = CITY.gen; AIR.runways = []; }
  const rw = AIR.runways;
  if (!rw.length) { const bot = rnd(450, 800); rw.push({ bot, top: bot - rnd(1300, 1700), x: RUNWAY_X }); }
  while (rw[rw.length - 1].top > c0 - 400) {
    const last = rw[rw.length - 1], bot = last.top - rnd(520, 760);
    rw.push({ bot, top: bot - rnd(1300, 1700), x: RUNWAY_X + rnd(-30, 30) });
  }
  return rw;
}
export function genAirfield(ch: Chunk, c0: number, c1: number) {
  const B = Biome.Airfield;
  CITY.sinceSet++;
  const sp = setPieceDue(B, c0, c1);
  for (const r of runwaysFor(c0)) {
    const y0 = Math.max(c0, r.top), y1 = Math.min(c1, r.bot);
    const rx = r.x, hw = 13;
    // The approach lights hang below the threshold (the near end): crossbars and the running rabbit.
    const a0 = Math.max(c0, r.bot), a1 = Math.min(c1, r.bot + 320);
    if (a1 > a0 && inBiome(B, rx, (a0 + a1) / 2)) {
      for (let y = Math.ceil((a0 - r.bot) / 16) * 16 + r.bot; y < a1; y += 16) {
        const d = y - r.bot;
        if (d < 4) continue;
        const bar = d % 64 < 1 ? 9 : 4;
        for (let i = -2; i <= 2; i++) L(ch, rx + i * bar * 0.5, y, 0.6, 0.6, LC.White, 0.45, 2);
        L(ch, rx, y, 0.8, 1.5, LC.White, 1, 6, 1 - d / 320);
      }
    }
    if (y1 <= y0 || !inBiome(B, rx, (y0 + y1) / 2)) continue;
    pad(ch, rx - hw, y0, rx + hw, y1, 'runway'); zone(ch, rx - hw, y0, rx + hw, y1, 'runway');
    // Markings: centre dashes, threshold piano keys, touchdown bars.
    for (let y = Math.ceil(y0 / 18) * 18; y < y1; y += 18) pad(ch, rx - 0.4, y, rx + 0.4, y + 8, 'mark');
    for (const [end, dir] of [[r.bot, -1], [r.top, 1]] as const) {
      if (end < y0 - 1 || end > y1 + 1) continue;
      for (let i = -4; i <= 4; i++) if (i !== 0) pad(ch, rx + i * 2.6 - 0.7, end + dir * 2 - (dir < 0 ? 10 : 0), rx + i * 2.6 + 0.7, end + dir * 2 + (dir > 0 ? 10 : 0), 'mark');
      for (let i = -6; i <= 6; i++) L(ch, rx + i * 2, end, 0.6, 0.8, dir < 0 ? LC.Teal : LC.Amber, 0.75, 2);
      for (const s of [-1, 1]) pad(ch, rx + s * 6 - 1.2, end + dir * 40 - (dir < 0 ? 10 : 0), rx + s * 6 + 1.2, end + dir * 40 + (dir > 0 ? 10 : 0), 'mark');
    }
    for (let y = Math.ceil(y0 / 12) * 12; y < y1; y += 12) { L(ch, rx - hw - 0.4, y, 0.5, 0.7, LC.White, 0.5, 2); L(ch, rx + hw + 0.4, y, 0.5, 0.7, LC.White, 0.5, 2); }
    for (let y = Math.ceil(y0 / 9) * 9; y < y1; y += 9) L(ch, rx, y, 0.4, 0.5, LC.White, 0.3, 2);
    // Parallel taxiway with blue edges and green centre, rapid exits every few hundred units.
    const tx = rx + 62;
    pad(ch, tx - 6, y0, tx + 6, y1, 'taxi'); zone(ch, tx - 6, y0, tx + 6, y1, 'runway');
    for (let y = Math.ceil(y0 / 10) * 10; y < y1; y += 10) { L(ch, tx - 6.4, y, 0.4, 0.55, LC.Blue, 0.5, 2); L(ch, tx + 6.4, y, 0.4, 0.55, LC.Blue, 0.5, 2); }
    for (let y = Math.ceil(y0 / 7) * 7; y < y1; y += 7) L(ch, tx, y, 0.3, 0.4, LC.Teal, 0.3, 2);
    for (let y = Math.ceil((y0 - r.top) / 280) * 280 + r.top + 60; y < y1; y += 280) {
      pad(ch, rx + hw, y - 5, tx - 6, y + 5, 'taxi');
      for (let x = rx + hw + 3; x < tx - 6; x += 6) { L(ch, x, y - 5.4, 0.4, 0.5, LC.Blue, 0.45, 2); L(ch, x, y + 5.4, 0.4, 0.5, LC.Blue, 0.45, 2); }
    }
    // Apron, parked aircraft, hangars.
    const ax0 = tx + 8, ax1 = tx + 150;
    pad(ch, ax0, y0, ax1, y1, 'apron'); zone(ch, ax0, y0, ax1, y1, 'apron');
    for (let y = y0 + 14; y < y1 - 14; y += 34) {
      if (!ok(B, ax0 + 40, y)) continue;
      if (Math.random() < 0.65) plane(ch, ax0 + 26, y, rnd(20, 26), rnd(22, 28), 0, pick(['#4b525a', '#545b63', '#40464d']));
      if (Math.random() < 0.5) for (let k = 0; k < 2; k++) plane(ch, ax0 + 70 + k * 20, y + rnd(-3, 3), 10, 8, 0, '#3e444b');
    }
    for (let y = Math.ceil(y0 / 70) * 70; y < y1; y += 70) flood(ch, ax1 - 4, y, 12, 32, LC.Flood, 0.8);
    for (let y = y0 + rnd(0, 20); y < y1 - 30; y += rnd(46, 60)) {
      if (!ok(B, ax1 + 30, y + 20)) continue;
      const hg = fb(ch, 'hangar', ax1 + 30, y + 20, 46, 40, 7.5, Style.Hangar, { lit: rnd(0.3, 0.9), tint: '#2e3338' });
      if (Math.random() < 0.4) L(ch, ax1 + 6, y + 20, 0.5, 16, LC.Flood, 0.08, 1, 0, hg);
    }
    // Operations: barracks and offices behind the hangars, a road.
    pathRoad(ch, B, () => ax1 + 70, y0, y1, 4, 'road');
    for (let y = y0 + 8; y < y1 - 8; y += rnd(16, 24)) if (ok(B, ax1 + 92, y)) fb(ch, 'mid', ax1 + 92 + rnd(-6, 6), y, rnd(16, 26), rnd(6, 9), rnd(1.5, 3.5), pick([Style.Concrete, Style.Panel]), { lit: rnd(0.3, 0.7) });
    // Revetments west of the runway: earth U-berms around fighters, linked by a loop.
    const vx = rx - 105;
    pathRoad(ch, B, () => vx + 34, y0, y1, 4, 'taxi', 'runway');
    for (let y = y0 + 14; y < y1 - 14; y += 36) {
      if (!ok(B, vx, y)) continue;
      fb(ch, 'wall', vx - 9, y, 3, 26, 2.4, Style.Concrete, { tint: '#2c2a25', lit: 0 });
      fb(ch, 'wall', vx, y - 12, 20, 3, 2.4, Style.Concrete, { tint: '#2c2a25', lit: 0 });
      fb(ch, 'wall', vx, y + 12, 20, 3, 2.4, Style.Concrete, { tint: '#2c2a25', lit: 0 });
      if (Math.random() < 0.75) plane(ch, vx + 2, y, 11, 8.5, Math.PI, '#3c4248');
      L(ch, vx + 14, y, 1.5, 0.8, LC.Blue, 0.4, 2);
    }
    // Ammunition igloos and the fuel farm further out: they blow.
    for (let y = y0 + 10; y < y1 - 10; y += 24) if (ok(B, rx - 210, y)) fb(ch, 'igloo', rx - 210 + (Math.floor(y / 24) % 2) * 22, y, 12, 9, 4, Style.Shell, { tint: '#3a3f3a', lit: 0, fuel: 1.2 });
    if (Math.random() < 0.35) tankFarm(ch, B, ax1 + 210, (y0 + y1) / 2, 90, Math.min(90, y1 - y0));
    // Perimeter road and fence lights.
    for (const px of [rx - 300, ax1 + 290]) { pathRoad(ch, B, () => px, y0, y1, 3, 'road'); for (let y = Math.ceil(y0 / 40) * 40; y < y1; y += 40) L(ch, px, y, 2, 0.7, LC.Sodium, 0.4, 0); }
    // Control tower once per runway, mid-length.
    const tmid = (r.top + r.bot) / 2;
    if (tmid >= y0 && tmid < y1 && ok(B, ax1 + 18, tmid)) {
      const tw = fb(ch, 'tower', ax1 + 18, tmid, 7, 7, 18, Style.Glass, { lit: 0.8, keepLit: true }, [tier(7, 7, 0, 3), tier(3, 3, 3, 12), tier(6, 6, 15, 3)]);
      L(ch, ax1 + 18, tmid, 18.6, 1.4, LC.White, 1, 7, 0, tw);
    }
  }
  // Between runways: grass, scattered huts, a crossing taxiway.
  if (Math.random() < 0.5) { const y = rnd(c0, c1), x = rnd(X0 + 40, RUNWAY_X - 330); if (ok(B, x, y, 6)) cluster(ch, B, x, y, 5, 25, Style.Concrete, 0); }
  if (!sp) return;
  const cy = (c0 + c1) / 2;
  if (sp === 'bigtransport') {
    const x = RUNWAY_X + 270, y = cy;
    if (!free(x, y, 30)) return;
    pad(ch, x - 40, y - 40, x + 40, y + 40, 'apron');
    plane(ch, x, y, 52, 58, 0.1, '#5d646c');
    flood(ch, x - 36, y - 36, 14, 40); flood(ch, x + 36, y + 36, 14, 40);
    for (let i = 0; i < 6; i++) L(ch, x + rnd(-20, 20), y + rnd(-20, 20), 1, 0.7, LC.Amber, 0.6, 3);
    claim(x - 42, y - 42, x + 42, y + 42);
  } else if (sp === 'shelters') {
    const x = RUNWAY_X - 420;
    for (let i = 0; i < 4; i++) { const y = cy - 60 + i * 40; if (inBiome(B, x, y)) { fb(ch, 'dome', x, y, 26, 22, 7, Style.Shell, { tint: '#3d423d', lit: 0, fuel: 0.6 }); L(ch, x + 15, y, 1, 0.9, LC.Blue, 0.5, 2); } }
    seg(ch, x + 14, cy - 80, x + 14, cy + 80, 6, 'taxi');
    claim(x - 20, cy - 80, x + 20, cy + 80);
  } else radarSite(ch, B, RUNWAY_X - 520, cy);
}
function radarSite(ch: Chunk, b: Biome, x: number, cy: number, roof = 0) {
  if (!inBiome(b, x, cy)) return;
  pad(ch, x - 30, cy - 26, x + 30, cy + 26, 'concrete');
  for (const [dx, dy, s] of [[-14, -8, 14], [12, 6, 11], [-6, 14, 8]]) fb(ch, 'dome', x + dx, cy + dy, s, s, s * 0.8, Style.Shell, { tint: '#8d939a', lit: 0, roof });
  fb(ch, 'mid', x + 16, cy - 14, 12, 7, 2.5, Style.Concrete, { lit: 0.5, roof });
  const m = fb(ch, 'mast', x - 22, cy + 18, 1.2, 1.2, 16, Style.Metal, { lit: 0 });
  L(ch, x - 22, cy + 18, 16.4, 1.2, LC.Amber, 0.9, 3, 0, m);
  flood(ch, x, cy, 8, 30, LC.Flood, 0.6);
  claim(x - 32, cy - 28, x + 32, cy + 28);
}

/* ======================================================================================================== */
/* DESERT: dunes and mesas, a dry wadi with an oasis, walled compounds, oil wellheads and flare stacks,       */
/* a highway with convoys, a pipeline, and the launch site.                                                   */
/* ======================================================================================================== */
const SAND = '#4a4033';
export function genDesert(ch: Chunk, c0: number, c1: number) {
  const B = Biome.Desert;
  CITY.sinceSet++;
  const sp = setPieceDue(B, c0, c1);
  // Highway and its convoys.
  pathRoad(ch, B, highwayX, c0, c1, 6, 'road');
  if (Math.random() < 0.55) {
    const y = rnd(c0, c1), up = Math.random() < 0.5;
    if (inBiome(B, highwayX(y), y)) mover(ch, { k: 'convoy', x: highwayX(y) + (up ? -1.4 : 1.4), cy: y, v: up ? -rnd(8, 13) : rnd(8, 13), path: 1, a: 0, len: 0, n: 3 + Math.floor(Math.random() * 7) });
  }
  // The pipeline: a pale line with pump stations.
  const pX = (cy: number) => pathX(1500, 140, 3, cy);
  for (let cy = c1; cy > c0; cy -= 20) if (inBiome(B, pX(cy), cy)) seg(ch, pX(cy), cy, pX(cy - 20.5), cy - 20.5, 1.1, 'concrete');
  if (Math.random() < 0.3) { const y = rnd(c0, c1); if (ok(B, pX(y) + 8, y)) { fb(ch, 'warehouse', pX(y) + 8, y, 10, 7, 2.2, Style.Industrial, { lit: 0.4, roof: 0.5 }); L(ch, pX(y) + 8, y, 3, 0.9, LC.Sodium, 0.6, 0); } }
  // Compounds scattered over the flats (never on mesas).
  for (let i = 0; i < 6; i++) {
    const x = rnd(X0 + 30, X1 - 30), y = rnd(c0 + 10, c1 - 10);
    if (Math.random() < 0.3 || !ok(B, x, y, 14) || T(x, y).h > 26 || Math.abs(x - highwayX(y)) < 20) continue;
    compound(ch, B, x, y, rnd(12, 22), Style.Adobe, 0.5, SAND);
    // A track out of the gate, toward the highway when it is near.
    const hx = highwayX(y), tx = Math.abs(hx - x) < 260 ? hx : x + Math.sign(hx - x) * rnd(40, 90);
    seg(ch, x, y, tx, y + rnd(-30, 30), 1.4, 'dirt');
  }
  // A truck stop on the highway: sheds, fuel tanks, a pool of sodium light.
  if (Math.random() < 0.3) {
    const y = rnd(c0 + 10, c1 - 10), x = highwayX(y) + pick([-1, 1]) * 18;
    if (ok(B, x, y, 14)) {
      pad(ch, x - 14, y - 16, x + 14, y + 16, 'pad');
      for (let i = 0; i < 4; i++) fb(ch, i < 2 ? 'warehouse' : 'house', x + rnd(-8, 8), y - 10 + i * 7, rnd(5, 9), 4, rnd(1.2, 2.2), Style.Adobe, { tint: SAND, lit: rnd(0.3, 0.7), roof: 0.5 });
      fb(ch, 'tank', x + 10, y + 10, 4, 4, 2.4, Style.Metal, { tint: '#5a5e62', lit: 0, spill: Burn.Oil });
      flood(ch, x, y, 6, 24, LC.Sodium, 0.8);
    }
  }
  // Oasis village along the wadi.
  if (Math.random() < 0.35) {
    const y = rnd(c0 + 20, c1 - 20), x = wadiX(y) + rnd(-12, 12);
    if (ok(B, x, y, 20)) {
      cluster(ch, B, x + 18, y, 12, 30, Style.Adobe, 0.5, SAND, LC.Warm);
      fb(ch, 'dome', x + 30, y - 10, 7, 7, 5, Style.Shell, { tint: '#5a5040', lit: 0, roof: 0.5 });
      const mn = fb(ch, 'lighthouse', x + 36, y - 16, 1.4, 1.4, 11, Style.Shell, { tint: '#5a5040', lit: 0 });
      L(ch, x + 36, y - 16, 11.3, 0.8, LC.Warm, 0.7, 2, 0, mn);
    }
  }
  // Oil field: nodding donkeys, a flare stack, dirt tracks.
  if (Math.random() < 0.55) {
    const x = rnd(X0 + 60, X1 - 60), y = rnd(c0 + 20, c1 - 20);
    if (ok(B, x, y, 40) && T(x, y).h < 26) {
      let px = x, py = y;
      for (let i = 0; i < 7; i++) {
        const wx = x + rnd(-60, 60), wy = y + rnd(-45, 45);
        if (!ok(B, wx, wy, 4)) continue;
        pad(ch, wx - 4, wy - 4, wx + 4, wy + 4, 'pad');
        fb(ch, 'pump', wx, wy, 3, 1.4, 1.6, Style.Metal, { lit: 0, fuel: 0.6, spill: Burn.Oil, tint: '#3a3530' });
        L(ch, wx + 2, wy + 2, 1.2, 0.6, LC.Amber, 0.5, 2);
        seg(ch, px, py, wx, wy, 1.4, 'dirt'); px = wx; py = wy;
      }
      fb(ch, 'flare', x, y, 1.6, 1.6, 16, Style.Metal, { lit: 0, keepLit: true, spill: Burn.Oil, tint: '#3b3631' });
      claim(x - 4, y - 4, x + 4, y + 4);
    }
  }
  // A radio mast on a mesa top.
  if (Math.random() < 0.25) for (let i = 0; i < 6; i++) {
    const x = rnd(X0, X1), y = rnd(c0, c1);
    if (T(x, y).h > 33 && ok(B, x, y)) { const m = fb(ch, 'mast', x, y, 1, 1, 12, Style.Metal, { lit: 0 }); L(ch, x, y, 12.4, 1, LC.Amber, 0.85, 3, Math.random(), m); break; }
  }
  if (!sp) return;
  const cy = (c0 + c1) / 2, cx = pick([W * 0.3, W * 0.7]);
  if (sp === 'launchsite') {
    // A rocket on its pad under floodlights, steam rolling off the flame trench, a long road out.
    if (!inBiome(B, cx, cy)) return;
    pad(ch, cx - 34, cy - 34, cx + 34, cy + 34, 'pad'); zone(ch, cx - 34, cy - 34, cx + 34, cy + 34, 'apron');
    seg(ch, cx, cy + 6, cx, cy + 46, 5, 'basin');
    const rk = fb(ch, 'rocket', cx, cy, 4.6, 4.6, 36, Style.Shell, { tint: '#9aa0a6', lit: 0, keepLit: true, fuel: 2.4, spill: Burn.Oil });
    rk.maxHp = rk.hp = 160; rk.value = 4;
    fb(ch, 'gantry', cx + 6, cy, 5, 6, 40, Style.Metal, { lit: 0.6, keepLit: true, tint: '#3a3d40' });
    for (let h = 6; h < 40; h += 6) L(ch, cx + 6, cy, h, 0.7, LC.Amber, 0.6, 2);
    L(ch, cx + 6, cy, 40.6, 1.2, LC.White, 0.9, 3);
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { fb(ch, 'mast', cx + sx * 30, cy + sy * 30, 1.2, 1.2, 15, Style.Metal, { lit: 0 }); L(ch, cx + sx * 30, cy + sy * 30, 15.4, 2.6, LC.Flood, 1, 2); }
    L(ch, cx, cy, 0.5, 80, LC.Flood, 0.14, 1);
    fb(ch, 'mid', cx + 70, cy + 40, 12, 8, 2, Style.Concrete, { lit: 0.6, keepLit: true, roof: 0.5 });
    seg(ch, cx, cy + 34, highwayX(cy + 120), cy + 120, 4, 'road');
    claim(cx - 40, cy - 40, cx + 80, cy + 50);
  } else if (sp === 'gasplant') {
    // Gas-oil separation plant: tanks, columns, pipe racks, three flares. Hit it and it chains for seconds.
    if (!inBiome(B, cx, cy)) return;
    pad(ch, cx - 90, cy - 60, cx + 90, cy + 60, 'pad');
    tankFarm(ch, B, cx - 45, cy, 80, 110);
    for (let i = 0; i < 6; i++) fb(ch, 'silo', cx + 20 + (i % 3) * 14, cy - 30 + Math.floor(i / 3) * 30, 4, 4, rnd(10, 18), Style.Metal, { lit: 0, tint: '#4a4a48' });
    for (let y = cy - 40; y <= cy + 40; y += 20) ch.props.push({ k: 'pipe', x: cx + 35, cy: y, w: 60, d: 1.4, h: 1.2, rot: 0, v: 0 });
    for (let i = 0; i < 3; i++) fb(ch, 'flare', cx + 75, cy - 40 + i * 40, 1.8, 1.8, 18, Style.Metal, { lit: 0, keepLit: true, spill: Burn.Oil, tint: '#3b3631' });
    for (let i = 0; i < 10; i++) L(ch, cx + rnd(-80, 80), cy + rnd(-55, 55), 6, 0.9, LC.Sodium, 0.6, 2);
    claim(cx - 95, cy - 65, cx + 95, cy + 65);
  } else {
    // An old citadel on a rise: thick walls, corner towers, a lit keep.
    if (!inBiome(B, cx, cy)) return;
    const s = 56;
    for (const [dx, dy, w, h] of [[0, -s / 2, s, 3], [0, s / 2, s, 3], [-s / 2, 0, 3, s], [s / 2, 0, 3, s]]) fb(ch, 'wall', cx + dx, cy + dy, w, h, 4, Style.Adobe, { tint: SAND, lit: 0, roof: 0.5 });
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { fb(ch, 'tower', cx + sx * s / 2, cy + sy * s / 2, 7, 7, 7, Style.Adobe, { tint: SAND, lit: 0.3, roof: 0.5 }); L(ch, cx + sx * s / 2, cy + sy * s / 2, 7.5, 0.9, LC.Warm, 0.7, 2); }
    fb(ch, 'mid', cx, cy, 16, 14, 6, Style.Adobe, { tint: SAND, lit: 0.5, roof: 0.5 });
    cluster(ch, B, cx, cy, 10, 20, Style.Adobe, 0.5, SAND, LC.Warm);
    flood(ch, cx, cy + s / 2 + 4, 4, 30, LC.Warm, 0.7);
    claim(cx - s / 2 - 6, cy - s / 2 - 6, cx + s / 2 + 6, cy + s / 2 + 6);
  }
}

/* ======================================================================================================== */
/* SNOW MOUNTAINS: moonlit ridges, a valley road with villages and their warm windows, frozen lakes with ice  */
/* huts, a dam holding a frozen reservoir, a pass fort, a radar station on a summit.                          */
/* ======================================================================================================== */
export function genSnow(ch: Chunk, c0: number, c1: number) {
  const B = Biome.Snow;
  CITY.sinceSet++;
  const sp = setPieceDue(B, c0, c1);
  pathRoad(ch, B, valleyX, c0, c1, 4, 'snowroad');
  pathRoad(ch, B, valley2X, c0, c1, 3, 'snowroad');
  if (Math.random() < 0.35) { const y = rnd(c0, c1); if (inBiome(B, valleyX(y), y)) mover(ch, { k: 'car', x: valleyX(y), cy: y, v: (Math.random() < 0.5 ? -1 : 1) * rnd(6, 10), path: 2, a: 0, len: 0, n: 1 + Math.floor(Math.random() * 2) }); }
  // Villages strung along the valley road; lamps on the road between them.
  const town = Math.random() < 0.6;
  if (town) {
    const y = rnd(c0 + 10, c1 - 10), x = Math.random() < 0.7 ? valleyX(y) : valley2X(y);
    cluster(ch, B, x + rnd(-6, 6), y, 22, 46, Style.House, 1, undefined, LC.Sodium);
    if (ok(B, x + 16, y - 10)) church(ch, x + 16, y - 10, 1);
    for (let yy = y - 50; yy < y + 50; yy += 14) if (inBiome(B, valleyX(yy), yy)) L(ch, valleyX(yy) + 3, yy, 1.5, 0.7, LC.Sodium, 0.5, 0);
  }
  for (let y = Math.ceil(c0 / 36) * 36; y < c1; y += 36) if (!town && inBiome(B, valleyX(y), y) && Math.random() < 0.5) L(ch, valleyX(y) + 2.6, y, 1.5, 0.6, LC.Sodium, 0.35, 0);
  // Lone cabins and ice huts.
  for (let i = 0; i < 22; i++) {
    const x = i < 12 ? valleyX(c0) + rnd(-150, 150) : rnd(X0, X1), y = rnd(c0, c1);
    if (!ok(B, x, y, 3)) continue;
    T(x, y);
    if (ts.water > 0.6) { fb(ch, 'cabin', x, y, 1.6, 1.4, 0.9, Style.House, { lit: 0.6, roof: 1 }); L(ch, x, y, 1, 0.6, LC.Warm, 0.55, 0); continue; }
    if (ts.h < 60 && Math.random() < 0.7) { fb(ch, 'cabin', x, y, rnd(3, 4.5), rnd(2.5, 3.5), 1.4, Style.House, { lit: rnd(0.3, 0.8), roof: 1, rot: rnd(-0.5, 0.5) }); if (Math.random() < 0.6) L(ch, x + 2, y, 1, 0.7, LC.Warm, 0.5, 0); }
  }
  // A ski lift climbing a slope: a line of pylon lights.
  if (Math.random() < 0.15) {
    const x = valleyX(c1) + rnd(60, 120) * pick([-1, 1]), y = rnd(c0, c1);
    if (ok(B, x, y)) for (let i = 0; i < 8; i++) L(ch, x + i * 9, y - i * 6, 3, 0.6, LC.Warm, 0.45, 2);
  }
  if (!sp) return;
  const cy = (c0 + c1) / 2;
  if (sp === 'dam') {
    const x = valleyX(cy);
    if (!inBiome(B, x, cy)) return;
    dam(ch, B, x, cy, 70);
    DAMS.push({ path: 0, cy, half: 80 });
    claim(x - 80, cy - 20, x + 80, cy + 26);
  } else if (sp === 'fort') {
    const x = valleyX(cy) + 26;
    if (!inBiome(B, x, cy)) return;
    const s = 44;
    for (const [dx, dy, w, h] of [[0, -s / 2, s, 2.5], [0, s / 2, s, 2.5], [-s / 2, 0, 2.5, s], [s / 2, 0, 2.5, s]]) fb(ch, 'wall', x + dx, cy + dy, w, h, 3, Style.Concrete, { lit: 0, roof: 1, tint: '#3c4046' });
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { fb(ch, 'tower', x + sx * s / 2, cy + sy * s / 2, 6, 6, 6, Style.Concrete, { lit: 0.4, roof: 1 }); flood(ch, x + sx * s / 2, cy + sy * s / 2, 6.5, 18, LC.Flood, 0.6); }
    for (let i = 0; i < 4; i++) fb(ch, 'mid', x + rnd(-12, 12), cy + rnd(-12, 12), rnd(6, 10), rnd(5, 8), rnd(2, 3.5), Style.Concrete, { lit: rnd(0.4, 0.8), roof: 1 });
    fb(ch, 'dome', x - 10, cy + 10, 6, 6, 4, Style.Shell, { tint: '#8d939a', lit: 0, roof: 1 });
    claim(x - s / 2 - 8, cy - s / 2 - 8, x + s / 2 + 8, cy + s / 2 + 8);
  } else {
    // Radar on the highest ground in the band.
    let bx = 0, by = 0, bh = -1;
    for (let i = 0; i < 24; i++) { const x = rnd(80, W - 80), y = rnd(c0, c1); const h = T(x, y).h; if (h > bh && inBiome(B, x, y)) { bh = h; bx = x; by = y; } }
    if (bh > 0) radarSite(ch, B, bx, by, 1);
  }
}

/* ======================================================================================================== */
/* FOREST: dense canopy, a river with a lumber mill and bridges, logging roads to clear-cuts, small towns,    */
/* lookout towers. Hits on the canopy start wildfires (worldgen spreadFire).                                  */
/* ======================================================================================================== */
const forestRoad = (cy: number) => pathX(1120, 300, 0, cy);
export function genForest(ch: Chunk, c0: number, c1: number) {
  const B = Biome.Forest;
  CITY.sinceSet++;
  const sp = setPieceDue(B, c0, c1);
  // Main road; a bridge where it crosses the river.
  pathRoad(ch, B, forestRoad, c0, c1, 3.6, 'dirt');
  const d0 = forestRoad(c1) - riverX(c1), d1 = forestRoad(c0) - riverX(c0);
  if (Math.sign(d0) !== Math.sign(d1)) {
    // Find the crossing.
    let a = c0, b = c1;
    for (let i = 0; i < 12; i++) { const m = (a + b) / 2; if (Math.sign(forestRoad(m) - riverX(m)) === Math.sign(d1)) a = m; else b = m; }
    const y = (a + b) / 2, x = riverX(y);
    if (inBiome(B, x, y)) {
      const br = fb(ch, 'bridge', x, y, 34, 4.5, 1.2, Style.Concrete, { lit: 0, tint: '#3a3c40' }, [tier(34, 4.5, 1.6, 1)]);
      for (let i = -2; i <= 2; i++) L(ch, x + i * 7, y - 2.6, 3, 0.6, LC.Sodium, 0.5, 0, Math.random(), br);
    }
  }
  if (Math.random() < 0.3) { const y = rnd(c0, c1); if (inBiome(B, forestRoad(y), y)) mover(ch, { k: 'car', x: forestRoad(y), cy: y, v: (Math.random() < 0.5 ? -1 : 1) * rnd(6, 10), path: 4, a: 0, len: 0, n: Math.random() < 0.3 ? 3 : 1 }); }
  // Logging spurs off the main road to clear-cut landings.
  if (Math.random() < 0.55) {
    const y = rnd(c0 + 10, c1 - 10), x0 = forestRoad(y), dir = Math.random() < 0.5 ? -1 : 1;
    let x = x0, yy = y;
    const len = rnd(140, 320);
    for (let s = 0; s < len; s += 20) {
      const nx = x + dir * 20, ny = yy + rnd(-8, 8);
      if (!inBiome(B, nx, ny) || T(nx, ny).water > 0.3) break;
      seg(ch, x, yy, nx, ny, 2.2, 'dirt'); x = nx; yy = ny;
    }
    if (ok(B, x, yy, 10)) {
      pad(ch, x - 14, yy - 10, x + 14, yy + 10, 'dirt');
      for (let i = 0; i < 4; i++) ch.props.push({ k: 'logs', x: x + rnd(-10, 10), cy: yy + rnd(-6, 6), w: rnd(5, 8), d: 1.6, h: 1.1, rot: rnd(-0.3, 0.3), v: Math.random() });
      fb(ch, 'cabin', x + 10, yy - 6, 4, 3, 1.4, Style.Industrial, { lit: 0.4 });
      L(ch, x, yy, 3, 0.8, LC.Sodium, 0.55, 0);
    }
  }
  // Small towns where the road runs near the river; lone cabins in clearings.
  if (Math.random() < 0.55) {
    const y = rnd(c0 + 10, c1 - 10), x = Math.random() < 0.65 ? forestRoad(y) : riverX(y) + pick([-30, 30]);
    if (ok(B, x, y, 10)) {
      cluster(ch, B, x + rnd(-10, 10), y, 18, 38, Style.House, 0, undefined, LC.Sodium);
      if (ok(B, x - 12, y + 8)) church(ch, x - 12, y + 8, 0);
      for (let yy = y - 40; yy < y + 40; yy += 12) L(ch, forestRoad(yy) + 2.4, yy, 1.5, 0.7, LC.Sodium, 0.5, 0);
    }
  }
  for (let i = 0; i < 24; i++) {
    const x = rnd(X0, X1), y = rnd(c0, c1);
    if (!ok(B, x, y, 3)) continue;
    T(x, y);
    if (ts.cover < 0.35 && ts.water < 0.2) {
      // A farmstead in the clearing: house, barn, a yard light.
      if (Math.random() < 0.4) fb(ch, 'warehouse', x + 6, y + 4, rnd(5, 8), rnd(3.5, 5), 1.8, Style.Industrial, { lit: 0.1, rot: rnd(-0.4, 0.4) }); fb(ch, 'cabin', x, y, rnd(3, 4.5), rnd(2.5, 3.5), 1.4, Style.House, { lit: rnd(0.3, 0.8), rot: rnd(-0.5, 0.5) }); L(ch, x + 2, y, 1, 0.7, LC.Warm, 0.5, 0); }
  }
  // Barges on the river.
  if (Math.random() < 0.25) { const y = rnd(c0, c1); if (inBiome(B, riverX(y), y) && T(riverX(y), y).water > 0.8) mover(ch, { k: 'barge', x: riverX(y), cy: y, v: (Math.random() < 0.5 ? -1 : 1) * rnd(4, 7), path: 3, a: 0, len: 12, n: 1 }); }
  if (!sp) return;
  const cy = (c0 + c1) / 2;
  if (sp === 'mill') {
    // Lumber mill on the river bank: sheds, log decks, a smoking stack, log rafts.
    const x = riverX(cy) + 46;
    if (!inBiome(B, x, cy)) return;
    pad(ch, x - 34, cy - 40, x + 40, cy + 40, 'dirt');
    fb(ch, 'warehouse', x + 10, cy - 18, 36, 18, 5, Style.Industrial, { lit: 0.35 });
    fb(ch, 'warehouse', x + 18, cy + 16, 22, 14, 4, Style.Industrial, { lit: 0.25 });
    fb(ch, 'chimney', x - 8, cy + 8, 3, 3, 16, Style.Metal, { lit: 0 });
    for (let i = 0; i < 10; i++) ch.props.push({ k: 'logs', x: x - 24 + (i % 2) * 9, cy: cy - 30 + Math.floor(i / 2) * 13, w: 8, d: 2.2, h: 1.6, rot: 0, v: Math.random() });
    for (let i = 0; i < 6; i++) ch.props.push({ k: 'logs', x: riverX(cy) + rnd(-3, 3), cy: cy - 30 + i * 11, w: 2, d: 9, h: 0.6, rot: 0, v: Math.random() });
    for (let i = 0; i < 6; i++) L(ch, x + rnd(-30, 36), cy + rnd(-36, 36), 5, 0.9, LC.Sodium, 0.6, 2);
    flood(ch, x, cy, 9, 30, LC.Sodium, 0.7);
    claim(x - 36, cy - 42, x + 42, cy + 42);
  } else if (sp === 'dam') {
    const x = riverX(cy);
    if (!inBiome(B, x, cy)) return;
    dam(ch, B, x, cy, 48);
    DAMS.push({ path: 1, cy, half: 70 });
    claim(x - 56, cy - 20, x + 56, cy + 26);
  } else {
    // Fire lookout on the highest ground, and a ranger post.
    let bx = 0, by = 0, bh = -1;
    for (let i = 0; i < 20; i++) { const x = rnd(80, W - 80), y = rnd(c0, c1); const h = T(x, y).h; if (h > bh && ok(B, x, y, 6)) { bh = h; bx = x; by = y; } }
    if (bh < 0) return;
    pad(ch, bx - 9, by - 9, bx + 9, by + 9, 'dirt');
    const t = fb(ch, 'tower', bx, by, 3, 3, 14, Style.Glass, { lit: 0.9, keepLit: true }, [tier(1.4, 1.4, 0, 12), tier(3, 3, 12, 2)]);
    L(ch, bx, by, 14.5, 1.1, LC.Warm, 0.9, 2, 0, t);
    fb(ch, 'cabin', bx + 6, by + 5, 4, 3, 1.4, Style.House, { lit: 0.6 });
    claim(bx - 10, by - 10, bx + 10, by + 10);
  }
}

/** Per-biome generator (the night city's blocks come from worldgen; this adds its set pieces). */
export const GEN: Record<Biome, (ch: Chunk, c0: number, c1: number) => void> = {
  [Biome.City]: genCity, [Biome.Port]: genPort, [Biome.Airfield]: genAirfield, [Biome.Desert]: genDesert, [Biome.Snow]: genSnow, [Biome.Forest]: genForest,
};
/** Forget per-fight state (claims, dams, runways). */
export function resetBiomeGen() { claims.length = 0; DAMS.length = 0; AIR.gen = -1; }
