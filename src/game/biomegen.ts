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
const CONTAINER_TINTS = ['#553226', '#243a55', '#2c4c47', '#5a4a26', '#565b60', '#3b3149', '#2f4233', '#62441f'];
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
  const hull = fb(ch, 'ship', x, cy, beam, len, 3, Style.Hull, { tint: kind === 'tanker' ? '#3a2e27' : '#2d343c', lit: 0.4, keepLit: true, fuel: kind === 'tanker' ? 1.3 : 0, spill: kind === 'tanker' ? Burn.Oil : 0 }, [
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
  L(ch, x, cy, h, 0.8, c, 0.4 * a, 2);
  L(ch, x, cy, 0.6, pool, c, 0.06 * a, 4);
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
  // Forced pieces wait for a row near the top of the screen, so they scroll through the whole view.
  if (forced && SET_PIECES[b].includes(forced)) { if (c1 + S.scrollY > 420) return null; const f = forced; forced = null; CITY.sinceSet = 0; return f; }
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
  const cx = rnd(SAFE_X0 + 80, SAFE_X1 - 80), cy = (c0 + c1) / 2;
  if (!inBiome(Biome.City, cx, cy)) return;
  if (sp === 'stadium') {
    // A floodlit bowl: from up here a bright green rectangle in the dark grid.
    const w = 120, h = 88;
    clearArea(ch, cx - w / 2 - 6, cy - h / 2 - 6, cx + w / 2 + 6, cy + h / 2 + 6);
    pad(ch, cx - w / 2 - 6, cy - h / 2 - 6, cx + w / 2 + 6, cy + h / 2 + 6, 'plaza');
    pad(ch, cx - w * 0.32, cy - h * 0.3, cx + w * 0.32, cy + h * 0.3, 'pitch');
    const o = { lit: 0.15, tint: '#2b2e33' };
    fb(ch, 'stand', cx, cy - h / 2 + 4, w, 8, 5.5, Style.Concrete, o);
    fb(ch, 'stand', cx, cy + h / 2 - 4, w, 8, 5.5, Style.Concrete, o);
    fb(ch, 'stand', cx - w / 2 + 4, cy, 8, h - 16, 5.5, Style.Concrete, o);
    fb(ch, 'stand', cx + w / 2 - 4, cy, 8, h - 16, 5.5, Style.Concrete, o);
    // A ring of floodlight masts round the bowl: the stadium's signature from orbit.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2, mx = cx + Math.cos(a) * (w / 2 + 2), my = cy + Math.sin(a) * (h / 2 + 2);
      fb(ch, 'mast', mx, my, 1.6, 1.6, 18, Style.Metal, { lit: 0 });
      L(ch, mx, my, 18.4, 1.5, LC.Flood, 1, 2);
    }
    L(ch, cx, cy, 0.5, w * 0.8, LC.Flood, 0.02, 4);
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
/* with shipyards, refineries, marinas and fishing villages, ships alongside, at anchor and under way with      */
/* wakes, a lighthouse on the breakwater. Port lights run on their own generators (kind 2 / 4): they stay on    */
/* when the city grid fails, so the waterfront keeps its sodium glow under the ship.                           */
/* ======================================================================================================== */
/** Where a set piece may sit so it scrolls through the view clear of the side HUD panels. */
const SAFE_X0 = 320, SAFE_X1 = 1280;
const safeX = (x: number) => Math.max(SAFE_X0, Math.min(SAFE_X1, x));
/** A glowing line (runway edge, quay edge, spillway): kind 9 strip along cy (ax 0) or x (ax 1); never blacks out. */
const LINE = (ch: Chunk, x: number, cy: number, len: number, w: number, c: number, a: number, ax: 0 | 1 = 0) => { ch.lights.push({ x, cy, h: 0.5, s: w, c, a, k: 9, p: 0, len, ax }); };
/** A yard floodlight that keeps burning in a blackout: a hot head and a broad pool. */
function yardLight(ch: Chunk, x: number, cy: number, h: number, pool: number, c = LC.Sodium, a = 1) {
  L(ch, x, cy, h, 0.8, c, 0.5 * a, 2);
  L(ch, x, cy, 0.6, pool, c, 0.11 * a, 4);
}
export function genPort(ch: Chunk, c0: number, c1: number) {
  const B = Biome.Port;
  CITY.sinceSet++;
  const mid = (c0 + c1) / 2, q = quayK(mid);
  // The set piece first, so it claims its ground before the yards fill in around it.
  const sp = setPieceDue(B, c0, c1);
  if (sp) portSetPiece(ch, sp, mid);
  // Coast road behind the waterfront.
  pathRoad(ch, B, (cy) => coastX(cy) + (quayK(cy) > 0.5 ? 345 : 70), c0, c1, 5, 'road');
  if (q > 0.5) {
    const cx = coastX(mid);
    // Quay apron: pale concrete with a sodium edge line, gantry cranes along the berth.
    if (ok(B, cx + 30, mid)) {
      pad(ch, cx - 1, c0, cx + 66, c1, 'dock'); zone(ch, cx - 1, c0, cx + 66, c1, 'dock');
      LINE(ch, cx + 0.5, mid, c1 - c0, 1.6, LC.Sodium, 0.16);
      for (let y = Math.ceil(c0 / 14) * 14; y < c1; y += 14) L(ch, cx + 1, y, 1, 0.7, LC.Sodium, 0.5, 2);
      for (let y = c0 + rnd(4, 16); y < c1 - 6; y += rnd(26, 36)) {
        if (!ok(B, cx + 6, y)) continue;
        // Ship-to-shore gantry: a portal over the quay rails and a long boom out over the berth.
        const cr = fb(ch, 'crane', cx + 8, y, 14, 6, 16, Style.Shell, { tint: '#8a6a34', lit: 0 }, [
          tier(2, 6, 0, 15, -6, 0), tier(2, 6, 0, 15, 6, 0), tier(56, 2.6, 15, 1.6, -12, 0), tier(6, 5, 15, 4, 6, 0),
        ]);
        L(ch, cx - 39, y, 16.8, 0.9, LC.Amber, 0.8, 3, Math.random(), cr);
        L(ch, cx + 8, y, 16.8, 0.8, LC.White, 0.7, 2, 0, cr);
        // The boom's work lights pour onto the ship and the quay below.
        L(ch, cx - 14, y, 0.6, 22, LC.Flood, 0.09, 4);
      }
      // Ship alongside.
      if (Math.random() < 0.8 && free(cx - 14, mid, 10)) ship(ch, cx - 14, mid + rnd(-20, 20), rnd(110, 150), 18, pick(['box', 'box', 'bulk']));
    }
    // Container yard: coloured stacks in long blocks on pale concrete, under tall sodium masts.
    const yx0 = cx + 72, yx1 = cx + 255;
    if (inBiome(B, yx0 + 90, mid)) {
      pad(ch, yx0 - 4, c0, yx1 + 4, c1, 'concrete'); zone(ch, yx0 - 4, c0, yx1 + 4, c1, 'dock');
      for (let y = Math.ceil(c0 / 50) * 50 + 10; y < c1; y += 50) for (const x of [yx0 + 45, yx0 + 135]) if (free(x, y)) yardLight(ch, x, y, 16, 46, LC.Sodium, 1);
    }
    for (let y = c0 + 4; y < c1 - 4; y += 8.5) {
      for (let x = yx0; x < yx1; x += 25) {
        if (Math.random() < 0.18 || !ok(B, x + 11, y, 3)) continue;
        fb(ch, 'low', x + 11, y + 2.6, 22, 5.2, 1.4 * (1 + Math.floor(Math.random() * 3.4)), Style.Shell, { tint: pick(CONTAINER_TINTS), lit: 0 });
      }
    }
    // Straddle carriers working the lanes.
    if (Math.random() < 0.6) mover(ch, { k: 'car', x: yx0 + 20 + Math.floor(Math.random() * 7) * 25, cy: mid, v: pick([-1, 1]) * rnd(5, 9), path: 0, a: Math.PI / 2, len: 0, n: 1 });
    // Sheds and a rail siding, then the harbour district.
    for (let y = c0 + 4; y < c1 - 10; y += rnd(30, 44)) if (ok(B, cx + 290, y + 12)) fb(ch, 'warehouse', cx + 290, y + 12, 44, rnd(18, 26), 4, Style.Industrial, { lit: 0.25 });
    if (inBiome(B, cx + 322, mid)) { seg(ch, cx + 322, c1, cx + 322, c0, 2.4, 'rail'); for (let y = c0 + 8; y < c1 - 8; y += 9) if (Math.random() < 0.6) ch.props.push({ k: 'railcar', x: cx + 322, cy: y, w: 1.4, d: 8, h: 1.1, rot: 0, v: Math.random() }); }
    // Logistics belt: big distribution sheds with lit loading docks, truck parks under sodium masts.
    const lx0 = cx + 350;
    if (inBiome(B, lx0 + 120, mid)) {
      pad(ch, lx0, c0, lx0 + 250, c1, 'lot');
      for (let y = c0 + 6; y < c1 - 20; y += 44) for (const x of [lx0 + 40, lx0 + 150]) {
        if (!ok(B, x, y + 18, 8)) continue;
        fb(ch, 'warehouse', x, y + 18, 70, 28, 5, Style.Industrial, { lit: 0.35, keepLit: true });
        LINE(ch, x, y + 33, 64, 1.6, LC.Sodium, 0.14, 1);
        for (let k = 0; k < 6; k++) ch.props.push({ k: 'railcar', x: x - 28 + k * 11, cy: y + 40, w: 2.2, d: 7, h: 1.6, rot: 0, v: Math.random() });
      }
      for (let y = Math.ceil(c0 / 60) * 60; y < c1; y += 60) yardLight(ch, lx0 + 100, y, 14, 50, LC.Sodium, 0.85);
    }
    district(ch, B, cx + 610, X1, c0, c1);
  } else {
    // Natural shore: something worth looking at on every stretch.
    const sx = coastX(mid), f = Math.floor((mid / 130) * 7.31 + BIO_SEEDISH()) % 4;
    if (f === 0) shipyard(ch, B, sx, mid, c0, c1);
    else if (f === 1) shoreRefinery(ch, B, sx, mid);
    else if (f === 2) marina(ch, B, sx, mid);
    else fishingVillage(ch, B, sx, mid);
    for (let i = 0; i < 6; i++) {
      const y = rnd(c0, c1), x = coastX(y) + rnd(150, 300);
      if (ok(B, x, y, 3)) fb(ch, 'house', x, y, rnd(4, 7), rnd(3, 5), rnd(1.2, 3), Style.House, { lit: rnd(0.3, 0.7), rot: rnd(-0.4, 0.4) });
    }
    district(ch, B, sx + 320, X1, c0, c1);
  }
  // On the water: channel buoys, ships at anchor, traffic with wakes.
  for (let y = c0 + rnd(0, 40); y < c1; y += 80) {
    const x = coastX(y) - 95;
    if (inBiome(B, x, y)) { L(ch, x, y, 1, 0.8, LC.Teal, 0.6, 3, Math.random()); L(ch, x - 70, y + 20, 1, 0.8, LC.White, 0.5, 3, Math.random()); }
  }
  if (Math.random() < 0.55) { const y = rnd(c0, c1), x = coastX(y) - rnd(170, 330); if (ok(B, x, y, 30) && T(x, y).water > 0.9) ship(ch, x, y, rnd(110, 170), 18, pick(['bulk', 'tanker', 'box'])); }
  if (Math.random() < 0.7) { const y = rnd(c0, c1), x = coastX(y) - rnd(60, 160); if (inBiome(B, x, y)) mover(ch, { k: Math.random() < 0.6 ? 'tug' : 'boat', x, cy: y, v: rnd(9, 18), path: 0, a: pick([-Math.PI / 2, Math.PI / 2]) + rnd(-0.4, 0.4), len: rnd(5, 9), n: 1 }); }
  if (Math.random() < 0.4) { const y = rnd(c0, c1), x = coastX(y) - rnd(220, 380); if (inBiome(B, x, y)) mover(ch, { k: 'ship', x, cy: y, v: rnd(7, 11), path: 0, a: -Math.PI / 2 + rnd(-0.15, 0.15), len: rnd(90, 130), n: 1 }); }
}
/** A cheap per-fight offset so shore features don't repeat in the same order every fight. */
const BIO_SEEDISH = () => (CITY.seed % 97) / 13;
/** Shipyard: slipways running down into the water with hulls on the ways, tower cranes, welding sparks. */
function shipyard(ch: Chunk, b: Biome, sx: number, mid: number, c0: number, c1: number) {
  if (!ok(b, sx + 60, mid, 20)) return;
  pad(ch, sx - 2, c0 + 4, sx + 150, c1 - 4, 'concrete'); zone(ch, sx - 2, c0 + 4, sx + 150, c1 - 4, 'dock');
  for (let i = 0; i < 3; i++) {
    const y = c0 + 20 + i * ((c1 - c0 - 40) / 2.2);
    seg(ch, sx + 110, y, sx - 30, y, 16, 'pad');
    fb(ch, 'ship', sx + 36, y, 82, 11, 3.5, Style.Hull, { tint: '#3a4048', lit: 0.2, keepLit: true, rot: 0 }, [tier(82, 11, 0, 3.5)]);
    for (let k = 0; k < 3; k++) L(ch, sx + 10 + k * 26, y + rnd(-3, 3), 4, 0.9, LC.Flood, 0.9, 3, Math.random());
    const tc = fb(ch, 'mast', sx + 60, y - 13, 2, 2, 22, Style.Metal, { lit: 0 }, [tier(2, 2, 0, 22), tier(30, 1.4, 22, 1.2, -6, 0)]);
    L(ch, sx + 60, y - 13, 22.6, 0.9, LC.Amber, 0.8, 3, Math.random(), tc);
  }
  yardLight(ch, sx + 130, mid - 30, 14, 50, LC.Sodium, 1);
  yardLight(ch, sx + 130, mid + 30, 14, 50, LC.Sodium, 1);
  claim(sx - 40, c0, sx + 150, c1);
}
/** Coastal refinery: tank farm, columns and a flare burning over the water. */
function shoreRefinery(ch: Chunk, b: Biome, sx: number, mid: number) {
  if (!ok(b, sx + 90, mid, 30)) return;
  tankFarm(ch, b, sx + 80, mid - 20, 130, 80);
  pad(ch, sx + 150, mid - 40, sx + 230, mid + 40, 'pad');
  for (let i = 0; i < 6; i++) fb(ch, 'silo', sx + 160 + (i % 3) * 22, mid - 26 + Math.floor(i / 3) * 40, 4, 4, rnd(12, 20), Style.Metal, { lit: 0, tint: '#4a4a48' });
  fb(ch, 'flare', sx + 210, mid + 30, 1.8, 1.8, 18, Style.Metal, { lit: 0, keepLit: true, spill: Burn.Oil, tint: '#3b3631' });
  seg(ch, sx + 30, mid + 40, sx - 70, mid + 40, 3, 'dock');
  for (let i = 0; i < 8; i++) L(ch, sx + rnd(20, 230), mid + rnd(-50, 50), 6, 0.9, LC.Sodium, 0.6, 2);
  yardLight(ch, sx + 190, mid, 12, 40, LC.Sodium, 0.9);
  claim(sx - 70, mid - 70, sx + 235, mid + 60);
}
/** Marina: a curving breakwater with lamps, pontoons and small boats in rows. */
function marina(ch: Chunk, b: Biome, sx: number, mid: number) {
  if (!inBiome(b, sx - 40, mid)) return;
  seg(ch, sx, mid - 50, sx - 70, mid - 20, 5, 'concrete');
  seg(ch, sx - 70, mid - 20, sx - 80, mid + 40, 5, 'concrete');
  L(ch, sx - 80, mid + 40, 4, 1, LC.Teal, 0.8, 3, 0.3);
  for (let i = 0; i < 6; i++) L(ch, sx - 10 - i * 12, mid - 46 + i * 5, 1, 0.6, LC.Sodium, 0.45, 2);
  for (let r = 0; r < 3; r++) {
    const py = mid - 10 + r * 16;
    seg(ch, sx, py, sx - 55, py, 1.6, 'dock');
    for (let k = 0; k < 6; k++) fb(ch, 'ship', sx - 8 - k * 8, py + (k % 2 ? 3 : -3), 2, 5, 1, Style.Shell, { tint: '#8a8f96', lit: 0 });
  }
  cluster(ch, b, sx + 40, mid, 12, 30, Style.House, 0, undefined, LC.Sodium);
  claim(sx - 90, mid - 60, sx + 10, mid + 50);
}
function fishingVillage(ch: Chunk, b: Biome, sx: number, mid: number) {
  if (!ok(b, sx + 30, mid)) return;
  cluster(ch, b, sx + 40, mid, 18, 40, Style.House, 0, undefined, LC.Sodium);
  seg(ch, sx + 4, mid, sx - 50, mid + 6, 2.4, 'dock');
  for (let i = 0; i < 5; i++) fb(ch, 'ship', sx - 14 - i * 9, mid + 10 + rnd(-2, 2), 2.4, 7, 1.2, Style.Hull, { tint: '#3a4048', lit: 0.3, keepLit: true });
  L(ch, sx - 50, mid + 6, 2, 0.9, LC.White, 0.7, 3);
  for (let i = 0; i < 4; i++) mover(ch, { k: 'boat', x: sx - rnd(30, 120), cy: mid + rnd(-40, 40), v: rnd(4, 8), path: 0, a: Math.PI + rnd(-0.6, 0.6), len: 4, n: 1 });
  yardLight(ch, sx + 10, mid + 4, 6, 24, LC.Sodium, 0.8);
}
function portSetPiece(ch: Chunk, sp: string, cy: number) {
  const B = Biome.Port, cx = coastX(cy);
  if (sp === 'lighthouse') {
    // A long breakwater curving out into the water, a tall lighthouse sweeping its beam over the sea.
    const ex = safeX(cx - 110), ey = cy - 70;
    seg(ch, cx + 2, cy + 60, cx - 40, cy, 8, 'concrete');
    seg(ch, cx - 40, cy, ex, ey, 8, 'concrete');
    for (let i = 1; i < 9; i++) { const t = i / 9; L(ch, cx + 2 + (ex - cx - 2) * t, cy + 60 + (ey - cy - 60) * t, 1.5, 0.6, LC.Sodium, 0.45, 2); }
    pad(ch, ex - 7, ey - 7, ex + 7, ey + 7, 'concrete');
    const lh = fb(ch, 'lighthouse', ex, ey, 5, 5, 22, Style.Shell, { tint: '#b0b4ba', lit: 0, keepLit: true }, [tier(5, 5, 0, 20), tier(3.6, 3.6, 20, 2.4)]);
    L(ch, ex, ey, 22.6, 2.2, LC.White, 1, 8, 0, lh);
    fb(ch, 'house', ex + 6, ey + 6, 5, 4, 2, Style.House, { lit: 0.6 });
    claim(ex - 14, ey - 14, cx + 10, cy + 66);
  } else if (sp === 'oilterminal') {
    // A tanker at a T-jetty, a big tank farm behind the quay. Everything here burns.
    const jx = cx - 150;
    seg(ch, cx, cy + 4, jx, cy + 4, 3, 'dock'); seg(ch, jx, cy - 80, jx, cy + 80, 6, 'dock');
    for (let i = 0; i < 7; i++) L(ch, jx, cy - 72 + i * 24, 2.5, 0.8, LC.Sodium, 0.6, 2);
    LINE(ch, jx, cy, 160, 1.6, LC.Sodium, 0.12);
    ship(ch, jx - 14, cy, 170, 22, 'tanker');
    const fx0 = safeX(cx + 160);
    tankFarm(ch, B, fx0, cy, 260, 160);
    fb(ch, 'flare', fx0 + 140, cy - 70, 1.8, 1.8, 20, Style.Metal, { lit: 0, keepLit: true, spill: Burn.Oil, tint: '#3b3631' });
    for (const [dx, dy] of [[-110, -70], [110, -70], [-110, 70], [110, 70]]) yardLight(ch, fx0 + dx, cy + dy, 12, 50, LC.Sodium, 0.9);
    claim(jx - 40, cy - 90, fx0 + 150, cy + 90);
  } else {
    // Drydock: a ship in a black basin cut into the quay under two portal cranes, welding light spilling out.
    const bx = safeX(cx + 120);
    seg(ch, bx, cy - 115, bx, cy + 115, 60, 'basin');
    seg(ch, bx - 34, cy - 115, bx - 34, cy + 115, 8, 'concrete'); seg(ch, bx + 34, cy - 115, bx + 34, cy + 115, 8, 'concrete');
    ship(ch, bx, cy, 170, 24, 'box', false);
    for (const y of [cy - 50, cy + 50]) {
      const cr = fb(ch, 'gantry', bx, y, 76, 6, 24, Style.Shell, { tint: '#7a5a2a', lit: 0 }, [tier(3, 5, 0, 23, -36, 0), tier(3, 5, 0, 23, 36, 0), tier(76, 4, 23, 3)]);
      L(ch, bx, y, 26.6, 1.2, LC.Amber, 0.85, 3, Math.random(), cr);
      LINE(ch, bx, y, 70, 2.4, LC.Flood, 0.1, 1);
    }
    for (let i = 0; i < 14; i++) L(ch, bx + rnd(-10, 10), cy + rnd(-80, 80), 4, 0.9, LC.Flood, 0.95, 3, Math.random());
    for (const [dx, dy] of [[-40, -100], [40, -30], [-40, 30], [40, 100]]) yardLight(ch, bx + dx, cy + dy, 14, 44, LC.Flood, 0.8);
    claim(bx - 42, cy - 120, bx + 42, cy + 120);
  }
}
/** Harbour district: blocks of mid-rises and sheds with streets, out to x1. */
function district(ch: Chunk, b: Biome, x0: number, x1: number, c0: number, c1: number) {
  for (let y = c0; y < c1; y += 34) {
    seg(ch, x0, y, x1, y, 3.6, 'road'); zone(ch, x0, y - 2, x1, y + 2, 'road');
    LINE(ch, (x0 + x1) / 2, y, x1 - x0, 2.6, LC.Sodium, 0.08, 1);
    for (let x = x0 + 4; x < x1 - 10; x += rnd(30, 42)) {
      if (!ok(b, x + 14, y + 17, 4)) continue;
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const w = rnd(8, 14), h = rnd(8, 12), bx = x + 4 + i * (26 / n) + w / 2, by = y + 4 + rnd(0, 26 - h) + h / 2;
        fb(ch, Math.random() < 0.3 ? 'warehouse' : 'mid', bx, by, w, h, rnd(1.5, 6.5), pick([Style.Brick, Style.Concrete, Style.Panel, Style.Industrial]), { lit: rnd(0.25, 0.7) });
      }
    }
  }
  for (let i = 0; i < 6; i++) { const x = rnd(x0, x1), y = rnd(c0, c1); if (inBiome(b, x, y)) L(ch, x, y, 2, 0.9, LC.Sodium, 0.5, 2); }
}
/** Round tanks in bunds: chain reactions. */
function tankFarm(ch: Chunk, b: Biome, cx: number, cy: number, w: number, h: number) {
  pad(ch, cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, 'bund');
  const s = rnd(16, 22);
  for (let x = cx - w / 2 + s * 0.7; x < cx + w / 2 - s * 0.5; x += s + 4) for (let y = cy - h / 2 + s * 0.7; y < cy + h / 2 - s * 0.5; y += s + 4) {
    if (Math.random() < 0.12 || !inBiome(b, x, y)) continue;
    const d = s * rnd(0.8, 1);
    fb(ch, 'tank', x, y, d, d, d * rnd(0.35, 0.5), Style.Metal, { tint: '#6a6e72', lit: 0, spill: Burn.Oil });
  }
  for (let i = 0; i < 5; i++) L(ch, cx + rnd(-w, w) * 0.45, cy + rnd(-h, h) * 0.45, 8, 0.9, LC.Sodium, 0.6, 2);
}

/* ======================================================================================================== */
/* AIRBASE: runways along the flight path with approach strobes and glowing edge lines, blue taxiway edges,  */
/* floodlit aprons with parked and taxiing aircraft, hangars, revetments, radomes, fuel farm and igloos.      */
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
  if (sp) airSetPiece(ch, sp, (c0 + c1) / 2);
  for (const r of runwaysFor(c0)) {
    const y0 = Math.max(c0, r.top), y1 = Math.min(c1, r.bot);
    const rx = r.x, hw = 13;
    // The approach lights hang below the threshold (the near end): crossbars and the running rabbit.
    const a0 = Math.max(c0, r.bot), a1 = Math.min(c1, r.bot + 320);
    if (a1 > a0 && inBiome(B, rx, (a0 + a1) / 2)) {
      LINE(ch, rx, (a0 + a1) / 2, a1 - a0, 1.4, LC.White, 0.06);
      for (let y = Math.ceil((a0 - r.bot) / 16) * 16 + r.bot; y < a1; y += 16) {
        const d = y - r.bot;
        if (d < 4) continue;
        const bar = d % 64 < 1 ? 9 : 4;
        for (let i = -2; i <= 2; i++) L(ch, rx + i * bar * 0.5, y, 0.6, 0.6, LC.White, 0.5, 2);
        L(ch, rx, y, 0.8, 1.6, LC.White, 1, 6, 1 - d / 320);
      }
    }
    if (y1 <= y0 || !inBiome(B, rx, (y0 + y1) / 2)) continue;
    const ym = (y0 + y1) / 2, yl = y1 - y0;
    pad(ch, rx - hw, y0, rx + hw, y1, 'runway'); zone(ch, rx - hw, y0, rx + hw, y1, 'runway');
    // Shoulders: a pale strip either side so the runway reads as a hard-edged band against the grass.
    pad(ch, rx - hw - 3, y0, rx - hw, y1, 'concrete'); pad(ch, rx + hw, y0, rx + hw + 3, y1, 'concrete');
    // Markings: centre dashes, threshold piano keys, touchdown bars.
    for (let y = Math.ceil(y0 / 18) * 18; y < y1; y += 18) pad(ch, rx - 0.4, y, rx + 0.4, y + 8, 'mark');
    for (const [end, dir] of [[r.bot, -1], [r.top, 1]] as const) {
      if (end < y0 - 1 || end > y1 + 1) continue;
      for (let i = -4; i <= 4; i++) if (i !== 0) pad(ch, rx + i * 2.6 - 0.7, end + dir * 2 - (dir < 0 ? 10 : 0), rx + i * 2.6 + 0.7, end + dir * 2 + (dir > 0 ? 10 : 0), 'mark');
      for (let i = -6; i <= 6; i++) L(ch, rx + i * 2, end, 0.6, 0.8, dir < 0 ? LC.Teal : LC.Amber, 0.8, 2);
      LINE(ch, rx, end, 26, 1.6, dir < 0 ? LC.Teal : LC.Amber, 0.25, 1);
      for (const s of [-1, 1]) pad(ch, rx + s * 6 - 1.2, end + dir * 40 - (dir < 0 ? 10 : 0), rx + s * 6 + 1.2, end + dir * 40 + (dir > 0 ? 10 : 0), 'mark');
    }
    // Edge and centre lights: pinpoints plus a faint glowing line, so the runway reads as two rails of light.
    LINE(ch, rx - hw - 0.5, ym, yl, 1.5, LC.White, 0.1); LINE(ch, rx + hw + 0.5, ym, yl, 1.5, LC.White, 0.1);
    LINE(ch, rx, ym, yl, 1, LC.White, 0.04);
    for (let y = Math.ceil(y0 / 12) * 12; y < y1; y += 12) { L(ch, rx - hw - 0.4, y, 0.5, 0.7, LC.White, 0.55, 2); L(ch, rx + hw + 0.4, y, 0.5, 0.7, LC.White, 0.55, 2); }
    for (let y = Math.ceil(y0 / 9) * 9; y < y1; y += 9) L(ch, rx, y, 0.4, 0.5, LC.White, 0.3, 2);
    // Parallel taxiway with blue edges and green centre, rapid exits every few hundred units.
    const tx = rx + 62;
    pad(ch, tx - 6, y0, tx + 6, y1, 'taxi'); zone(ch, tx - 6, y0, tx + 6, y1, 'runway');
    LINE(ch, tx - 6.4, ym, yl, 1.3, LC.Blue, 0.12); LINE(ch, tx + 6.4, ym, yl, 1.3, LC.Blue, 0.12); LINE(ch, tx, ym, yl, 0.9, LC.Teal, 0.07);
    for (let y = Math.ceil(y0 / 10) * 10; y < y1; y += 10) { L(ch, tx - 6.4, y, 0.4, 0.55, LC.Blue, 0.5, 2); L(ch, tx + 6.4, y, 0.4, 0.55, LC.Blue, 0.5, 2); }
    for (let y = Math.ceil(y0 / 7) * 7; y < y1; y += 7) L(ch, tx, y, 0.3, 0.4, LC.Teal, 0.3, 2);
    for (let y = Math.ceil((y0 - r.top) / 280) * 280 + r.top + 60; y < y1; y += 280) {
      pad(ch, rx + hw, y - 5, tx - 6, y + 5, 'taxi');
      LINE(ch, (rx + hw + tx - 6) / 2, y - 5.4, tx - 6 - rx - hw, 1.2, LC.Blue, 0.12, 1); LINE(ch, (rx + hw + tx - 6) / 2, y + 5.4, tx - 6 - rx - hw, 1.2, LC.Blue, 0.12, 1);
    }
    // Aircraft taxiing out to the runway, beacons flashing.
    if (Math.random() < 0.45) mover(ch, { k: 'jet', x: tx, cy: ym, v: pick([-1, 1]) * rnd(5, 9), path: 0, a: Math.PI / 2, len: rnd(16, 24), n: 1 });
    // Apron: pale floodlit concrete, parked aircraft in rows, service trucks.
    const ax0 = tx + 8, ax1 = tx + 150;
    pad(ch, ax0, y0, ax1, y1, 'apron'); zone(ch, ax0, y0, ax1, y1, 'apron');
    for (let y = y0 + 14; y < y1 - 14; y += 34) {
      if (!ok(B, ax0 + 40, y)) continue;
      if (Math.random() < 0.7) plane(ch, ax0 + 26, y, rnd(20, 26), rnd(22, 28), 0, pick(['#6b727a', '#757c84', '#5f666e']));
      if (Math.random() < 0.55) for (let k = 0; k < 2; k++) plane(ch, ax0 + 70 + k * 20, y + rnd(-3, 3), 10, 8, 0, '#5a6168');
    }
    for (let y = Math.ceil(y0 / 60) * 60; y < y1; y += 60) if (free(ax1 - 4, y)) yardLight(ch, ax1 - 4, y, 14, 52, LC.Flood, 0.9);
    if (Math.random() < 0.6) mover(ch, { k: 'car', x: ax0 + 52, cy: ym, v: pick([-1, 1]) * rnd(6, 10), path: 0, a: Math.PI / 2, len: 0, n: 1 });
    for (let y = y0 + rnd(0, 20); y < y1 - 30; y += rnd(46, 60)) {
      if (!ok(B, ax1 + 30, y + 20, 10)) continue;
      const hg = fb(ch, 'hangar', ax1 + 30, y + 20, 46, 40, 7.5, Style.Hangar, { lit: rnd(0.4, 0.9), tint: '#5a6066' });
      if (Math.random() < 0.6) L(ch, ax1 + 4, y + 20, 0.5, 20, LC.Flood, 0.1, 4, 0, hg);
    }
    // Operations: barracks and offices behind the hangars, a road.
    pathRoad(ch, B, () => ax1 + 70, y0, y1, 4, 'road');
    for (let y = y0 + 8; y < y1 - 8; y += rnd(16, 24)) if (ok(B, ax1 + 92, y)) fb(ch, 'mid', ax1 + 92 + rnd(-6, 6), y, rnd(16, 26), rnd(6, 9), rnd(1.5, 3.5), pick([Style.Concrete, Style.Panel]), { lit: rnd(0.4, 0.8) });
    // Revetments west of the runway: earth U-berms around fighters, linked by a loop.
    const vx = rx - 105;
    pathRoad(ch, B, () => vx + 34, y0, y1, 4, 'taxi', 'runway');
    LINE(ch, vx + 34, ym, yl, 1, LC.Blue, 0.07);
    for (let y = y0 + 14; y < y1 - 14; y += 36) {
      if (!ok(B, vx, y)) continue;
      fb(ch, 'wall', vx - 9, y, 3, 26, 2.4, Style.Concrete, { tint: '#3a372f', lit: 0 });
      fb(ch, 'wall', vx, y - 12, 20, 3, 2.4, Style.Concrete, { tint: '#3a372f', lit: 0 });
      fb(ch, 'wall', vx, y + 12, 20, 3, 2.4, Style.Concrete, { tint: '#3a372f', lit: 0 });
      if (Math.random() < 0.75) plane(ch, vx + 2, y, 11, 8.5, Math.PI, '#5a6168');
      L(ch, vx + 14, y, 1.5, 0.8, LC.Blue, 0.45, 2);
      L(ch, vx, y, 0.5, 12, LC.Flood, 0.06, 4);
    }
    // Ammunition igloos and the fuel farm further out: they blow.
    for (let y = y0 + 10; y < y1 - 10; y += 24) if (ok(B, rx - 210, y)) fb(ch, 'igloo', rx - 210 + (Math.floor(y / 24) % 2) * 22, y, 12, 9, 4, Style.Shell, { tint: '#4a4f4a', lit: 0, fuel: 1.2 });
    if (Math.random() < 0.35 && free(ax1 + 210, ym, 50)) tankFarm(ch, B, ax1 + 210, ym, 90, Math.min(90, yl));
    // Perimeter road and fence lights.
    for (const px of [rx - 300, ax1 + 290]) { pathRoad(ch, B, () => px, y0, y1, 3, 'road'); for (let y = Math.ceil(y0 / 40) * 40; y < y1; y += 40) L(ch, px, y, 2, 0.7, LC.Sodium, 0.45, 2); }
    // Control tower once per runway, mid-length.
    const tmid = (r.top + r.bot) / 2;
    if (tmid >= y0 && tmid < y1 && ok(B, ax1 + 18, tmid)) {
      const tw = fb(ch, 'tower', ax1 + 18, tmid, 7, 7, 18, Style.Glass, { lit: 0.8, keepLit: true }, [tier(7, 7, 0, 3), tier(3, 3, 3, 12), tier(6, 6, 15, 3)]);
      L(ch, ax1 + 18, tmid, 18.6, 1.6, LC.White, 1, 7, 0, tw);
    }
  }
  // Between runways: grass, scattered huts.
  if (Math.random() < 0.5) { const y = rnd(c0, c1), x = rnd(X0 + 40, RUNWAY_X - 330); if (ok(B, x, y, 6)) cluster(ch, B, x, y, 5, 25, Style.Concrete, 0); }
}
function airSetPiece(ch: Chunk, sp: string, cy: number) {
  const B = Biome.Airfield;
  if (sp === 'bigtransport') {
    // A giant transport on its own floodlit pad, crews and trucks around it, beacon flashing.
    const x = RUNWAY_X + 290, y = cy;
    pad(ch, x - 56, y - 56, x + 56, y + 56, 'apron'); zone(ch, x - 56, y - 56, x + 56, y + 56, 'apron');
    plane(ch, x, y, 74, 80, 0.1, '#7a8189');
    L(ch, x, y, 4, 1.2, LC.Amber, 0.9, 3, 0.2);
    for (const [dx, dy] of [[-50, -50], [50, -50], [-50, 50], [50, 50]]) yardLight(ch, x + dx, y + dy, 16, 60, LC.Flood, 1);
    for (let i = 0; i < 8; i++) L(ch, x + rnd(-30, 30), y + rnd(-30, 30), 1, 0.7, LC.Amber, 0.6, 3);
    claim(x - 60, y - 60, x + 60, y + 60);
  } else if (sp === 'shelters') {
    // Hardened aircraft shelters: a row of big domes, their mouths lit, on a taxi loop.
    const x = safeX(RUNWAY_X - 340);
    seg(ch, x + 22, cy - 120, x + 22, cy + 120, 7, 'taxi');
    LINE(ch, x + 22, cy, 240, 1.2, LC.Blue, 0.1);
    for (let i = 0; i < 5; i++) {
      const y = cy - 100 + i * 50;
      if (!inBiome(B, x, y)) continue;
      fb(ch, 'dome', x, y, 34, 28, 9, Style.Shell, { tint: '#5a5f5a', lit: 0, fuel: 0.6 });
      L(ch, x + 18, y, 0.5, 16, LC.Flood, 0.12, 4); L(ch, x + 18, y, 1.2, 0.9, LC.Blue, 0.6, 2);
    }
    claim(x - 24, cy - 125, x + 30, cy + 125);
  } else radarSite(ch, B, safeX(RUNWAY_X - 330), cy);
}
function radarSite(ch: Chunk, b: Biome, x: number, cy: number, roof = 0) {
  if (!inBiome(b, x, cy)) return;
  pad(ch, x - 44, cy - 38, x + 44, cy + 38, 'concrete');
  for (const [dx, dy, s] of [[-20, -12, 22], [18, 10, 17], [-8, 22, 12]]) fb(ch, 'dome', x + dx, cy + dy, s, s, s * 0.8, Style.Shell, { tint: '#a3a9b0', lit: 0, roof });
  fb(ch, 'mid', x + 24, cy - 22, 16, 9, 2.5, Style.Concrete, { lit: 0.6, roof });
  const m = fb(ch, 'mast', x - 32, cy + 26, 1.4, 1.4, 22, Style.Metal, { lit: 0 });
  L(ch, x - 32, cy + 26, 22.4, 1.2, LC.Amber, 0.9, 3, 0, m);
  L(ch, x + 24, cy - 22, 4, 1.4, LC.White, 0.9, 7, 0.3);
  yardLight(ch, x, cy, 10, 50, LC.Flood, 0.8);
  claim(x - 46, cy - 40, x + 46, cy + 40);
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
  if (sp) desertSetPiece(ch, sp, c0, c1);
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
}

/* ======================================================================================================== */
/* SNOW MOUNTAINS: moonlit ridges, a valley road with villages and their warm windows, frozen lakes with ice  */
/* huts, a dam holding a frozen reservoir, a pass fort, a radar station on a summit.                          */
/* ======================================================================================================== */
export function genSnow(ch: Chunk, c0: number, c1: number) {
  const B = Biome.Snow;
  CITY.sinceSet++;
  const sp = setPieceDue(B, c0, c1);
  if (sp) snowSetPiece(ch, sp, c0, c1);
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
  if (sp) forestSetPiece(ch, sp, c0, c1);
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
  for (let sp2 = 0; sp2 < 2; sp2++) if (Math.random() < 0.5) {
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
}

/* ---------------- set pieces of the desert, the mountains and the forest ---------------- */
// Each is placed before the rest of its row (so it claims its ground), centred well inside the field (safeX) so it
// scrolls through the whole view clear of the HUD's side panels, and carries a light signature that reads from orbit.
function desertSetPiece(ch: Chunk, sp: string, c0: number, c1: number) {
  const B = Biome.Desert, cy = (c0 + c1) / 2;
  let cx = safeX(pick([W * 0.32, W * 0.68]));
  if (Math.abs(cx - highwayX(cy)) < 140) cx = safeX(highwayX(cy) + (cx < highwayX(cy) ? -180 : 180));
  if (!inBiome(B, cx, cy)) return;
  if (sp === 'launchsite') {
    // A rocket on its pad under a ring of floodlights, searchlights sweeping the sky, steam off the flame trench.
    pad(ch, cx - 60, cy - 60, cx + 60, cy + 60, 'pad'); zone(ch, cx - 60, cy - 60, cx + 60, cy + 60, 'apron');
    seg(ch, cx, cy + 10, cx, cy + 80, 9, 'basin');
    const rk = fb(ch, 'rocket', cx, cy, 7, 7, 56, Style.Shell, { tint: '#b4b9bf', lit: 0, keepLit: true, fuel: 2.6, spill: Burn.Oil }, [tier(7, 7, 0, 50), tier(4, 4, 50, 6)]);
    rk.maxHp = rk.hp = 180; rk.value = 4;
    fb(ch, 'gantry', cx + 9, cy, 8, 9, 60, Style.Metal, { lit: 0.6, keepLit: true, tint: '#4a4d50' });
    for (let h = 6; h < 60; h += 6) L(ch, cx + 9, cy, h, 0.7, LC.Amber, 0.65, 2);
    L(ch, cx + 9, cy, 60.6, 1.3, LC.White, 0.95, 3);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2, mx = cx + Math.cos(a) * 54, my = cy + Math.sin(a) * 54;
      fb(ch, 'mast', mx, my, 1.4, 1.4, 20, Style.Metal, { lit: 0 });
      L(ch, mx, my, 20.4, 1.4, LC.Flood, 1, 2);
    }
    L(ch, cx, cy, 0.5, 120, LC.Flood, 0.05, 4);
    for (const [dx, dy] of [[-56, -56], [56, 56]]) ch.props.push({ k: 'searchlight', x: cx + dx, cy: cy + dy, w: 0, d: 0, h: 2, rot: 0, v: Math.random() });
    fb(ch, 'mid', cx + 90, cy + 50, 16, 10, 2.2, Style.Concrete, { lit: 0.7, keepLit: true, roof: 0.5 });
    seg(ch, cx, cy + 60, highwayX(cy + 160), cy + 160, 5, 'road');
    claim(cx - 66, cy - 66, cx + 100, cy + 66);
  } else if (sp === 'gasplant') {
    // Gas-oil separation plant: tank farm, process columns, pipe racks, a line of flares. Hit it and it chains.
    pad(ch, cx - 130, cy - 80, cx + 130, cy + 80, 'pad');
    tankFarm(ch, B, cx - 65, cy, 120, 150);
    for (let i = 0; i < 9; i++) fb(ch, 'silo', cx + 20 + (i % 3) * 18, cy - 40 + Math.floor(i / 3) * 40, 5, 5, rnd(12, 22), Style.Metal, { lit: 0, tint: '#5a5a58' });
    for (let y = cy - 60; y <= cy + 60; y += 20) ch.props.push({ k: 'pipe', x: cx + 50, cy: y, w: 90, d: 1.4, h: 1.2, rot: 0, v: 0 });
    for (let i = 0; i < 4; i++) fb(ch, 'flare', cx + 115, cy - 60 + i * 40, 2, 2, 22, Style.Metal, { lit: 0, keepLit: true, spill: Burn.Oil, tint: '#3b3631' });
    for (let i = 0; i < 16; i++) L(ch, cx + rnd(-120, 110), cy + rnd(-75, 75), 6, 0.9, LC.Sodium, 0.65, 2);
    for (const [dx, dy] of [[-120, -75], [120, -75], [-120, 75], [120, 75]]) yardLight(ch, cx + dx, cy + dy, 14, 60, LC.Sodium, 0.9);
    claim(cx - 135, cy - 85, cx + 135, cy + 85);
  } else {
    // An old citadel: thick walls, corner towers, a lit keep and the town packed around it.
    const s = 90;
    for (const [dx, dy, w, h] of [[0, -s / 2, s, 4], [0, s / 2, s, 4], [-s / 2, 0, 4, s], [s / 2, 0, 4, s]]) fb(ch, 'wall', cx + dx, cy + dy, w, h, 5, Style.Adobe, { tint: SAND, lit: 0, roof: 0.5 });
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { fb(ch, 'tower', cx + sx * s / 2, cy + sy * s / 2, 10, 10, 9, Style.Adobe, { tint: SAND, lit: 0.3, roof: 0.5 }); L(ch, cx + sx * s / 2, cy + sy * s / 2, 9.5, 1, LC.Warm, 0.8, 2); }
    fb(ch, 'mid', cx, cy, 24, 20, 8, Style.Adobe, { tint: SAND, lit: 0.6, roof: 0.5 });
    fb(ch, 'dome', cx + 22, cy - 22, 12, 12, 8, Style.Shell, { tint: '#6a6050', lit: 0, roof: 0.5 });
    for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; L(ch, cx + Math.cos(a) * (s / 2 + 3), cy + Math.sin(a) * (s / 2 + 3), 1, 18, LC.Warm, 0.035, 4); }
    cluster(ch, B, cx, cy, 16, 32, Style.Adobe, 0.5, SAND, LC.Warm);
    cluster(ch, B, cx + 70, cy + 40, 14, 40, Style.Adobe, 0.5, SAND, LC.Warm);
    claim(cx - s / 2 - 8, cy - s / 2 - 8, cx + s / 2 + 8, cy + s / 2 + 8);
  }
}
/** A dam across a valley or river: a concrete arc lit along its crest, the spillway glowing white below it. */
function bigDam(ch: Chunk, cx: number, cy: number, half: number) {
  const n = 9;
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n * 2 - 1, x = cx + u * half, y = cy - (1 - u * u) * half * 0.18;
    fb(ch, 'dam', x, y, (half * 2) / n + 1, 7, 9, Style.Concrete, { lit: 0, tint: '#5a5e64', rot: -u * 0.35 });
    L(ch, x, y - 3, 9.5, 0.8, LC.Sodium, 0.65, 2);
  }
  // Spillway: a bright apron of falling water and mist below the centre of the arc.
  LINE(ch, cx, cy + 10, 26, 7, LC.Flood, 0.22);
  L(ch, cx, cy + 22, 0.5, 40, LC.Flood, 0.06, 4);
  L(ch, cx, cy + 12, 0.8, 18, LC.White, 0.1, 4);
  fb(ch, 'warehouse', cx + half * 0.5, cy + 16, 26, 10, 5, Style.Industrial, { lit: 0.7, keepLit: true });
  yardLight(ch, cx - half * 0.6, cy + 20, 8, 30, LC.Flood, 0.8);
  yardLight(ch, cx + half * 0.6, cy + 20, 8, 30, LC.Flood, 0.8);
}
function snowSetPiece(ch: Chunk, sp: string, c0: number, c1: number) {
  const B = Biome.Snow, cy = (c0 + c1) / 2;
  if (sp === 'dam') {
    const x = valleyX(cy);
    if (!inBiome(B, x, cy) || x < SAFE_X0 - 60 || x > SAFE_X1 + 60) return;
    bigDam(ch, x, cy, 110);
    DAMS.push({ path: 0, cy, half: 120 });
    claim(x - 120, cy - 26, x + 120, cy + 32);
  } else if (sp === 'fort') {
    // Star fort astride the pass: thick walls, bastions with floodlights, barracks, a radome.
    const x = safeX(valleyX(cy) + 40);
    if (!inBiome(B, x, cy)) return;
    const s = 74;
    for (const [dx, dy, w, h] of [[0, -s / 2, s, 3.5], [0, s / 2, s, 3.5], [-s / 2, 0, 3.5, s], [s / 2, 0, 3.5, s]]) fb(ch, 'wall', x + dx, cy + dy, w, h, 4, Style.Concrete, { lit: 0, roof: 1, tint: '#4a4e54' });
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      fb(ch, 'tower', x + sx * s / 2, cy + sy * s / 2, 12, 12, 6, Style.Concrete, { lit: 0.5, roof: 1, rot: Math.PI / 4 });
      yardLight(ch, x + sx * s / 2, cy + sy * s / 2, 7, 28, LC.Flood, 0.8);
    }
    for (let i = 0; i < 6; i++) fb(ch, 'mid', x + rnd(-22, 22), cy + rnd(-22, 22), rnd(8, 14), rnd(6, 10), rnd(2, 4), Style.Concrete, { lit: rnd(0.5, 0.9), roof: 1 });
    fb(ch, 'dome', x - 16, cy + 16, 10, 10, 7, Style.Shell, { tint: '#a3a9b0', lit: 0, roof: 1 });
    ch.props.push({ k: 'searchlight', x: x + s / 2, cy: cy - s / 2, w: 0, d: 0, h: 6, rot: 0, v: Math.random() });
    claim(x - s / 2 - 10, cy - s / 2 - 10, x + s / 2 + 10, cy + s / 2 + 10);
  } else {
    // Radar on the highest ground in the band.
    let bx = 0, by = 0, bh = -1;
    for (let i = 0; i < 24; i++) { const x = rnd(SAFE_X0, SAFE_X1), y = rnd(c0, c1); const h = T(x, y).h; if (h > bh && inBiome(B, x, y)) { bh = h; bx = x; by = y; } }
    if (bh > 0) radarSite(ch, B, bx, by, 1);
  }
}
function forestSetPiece(ch: Chunk, sp: string, c0: number, c1: number) {
  const B = Biome.Forest, cy = (c0 + c1) / 2;
  if (sp === 'mill') {
    // Lumber mill on the river bank: sheds, log decks, a smoking stack, log rafts, sodium yard lights.
    const x = safeX(riverX(cy) + 60);
    if (!inBiome(B, x, cy)) return;
    pad(ch, x - 50, cy - 56, x + 60, cy + 56, 'dirt');
    fb(ch, 'warehouse', x + 14, cy - 26, 50, 24, 6, Style.Industrial, { lit: 0.5, keepLit: true });
    fb(ch, 'warehouse', x + 26, cy + 22, 30, 18, 5, Style.Industrial, { lit: 0.4, keepLit: true });
    fb(ch, 'chimney', x - 12, cy + 10, 4, 4, 22, Style.Metal, { lit: 0 });
    for (let i = 0; i < 14; i++) ch.props.push({ k: 'logs', x: x - 36 + (i % 2) * 11, cy: cy - 44 + Math.floor(i / 2) * 13, w: 10, d: 2.6, h: 1.8, rot: 0, v: Math.random() });
    for (let i = 0; i < 8; i++) ch.props.push({ k: 'logs', x: riverX(cy) + rnd(-3, 3), cy: cy - 44 + i * 12, w: 2.4, d: 10, h: 0.7, rot: 0, v: Math.random() });
    for (const [dx, dy] of [[-44, -50], [54, -50], [-44, 50], [54, 50]]) yardLight(ch, x + dx, cy + dy, 9, 34, LC.Sodium, 0.9);
    claim(x - 52, cy - 58, x + 62, cy + 58);
  } else if (sp === 'dam') {
    const x = riverX(cy);
    if (!inBiome(B, x, cy) || x < SAFE_X0 - 60 || x > SAFE_X1 + 60) return;
    bigDam(ch, x, cy, 72);
    DAMS.push({ path: 1, cy, half: 90 });
    claim(x - 80, cy - 26, x + 80, cy + 32);
  } else {
    // Fire lookout on the highest ground, a ranger station and its floodlit yard.
    let bx = 0, by = 0, bh = -1;
    for (let i = 0; i < 20; i++) { const x = rnd(SAFE_X0, SAFE_X1), y = rnd(c0, c1); const h = T(x, y).h; if (h > bh && ok(B, x, y, 10)) { bh = h; bx = x; by = y; } }
    if (bh < 0) return;
    pad(ch, bx - 18, by - 18, bx + 18, by + 18, 'dirt');
    const t = fb(ch, 'tower', bx, by, 4, 4, 18, Style.Glass, { lit: 0.9, keepLit: true }, [tier(1.6, 1.6, 0, 15), tier(4, 4, 15, 3)]);
    L(ch, bx, by, 18.5, 1.2, LC.Warm, 0.95, 2, 0, t);
    L(ch, bx, by, 19, 1, LC.White, 0.8, 7, 0.6, t);
    fb(ch, 'cabin', bx + 10, by + 8, 7, 5, 2, Style.House, { lit: 0.8 });
    yardLight(ch, bx + 10, by - 8, 5, 26, LC.Sodium, 0.8);
    claim(bx - 20, by - 20, bx + 20, by + 20);
  }
}

/** Per-biome generator (the night city's blocks come from worldgen; this adds its set pieces). */
export const GEN: Record<Biome, (ch: Chunk, c0: number, c1: number) => void> = {
  [Biome.City]: genCity, [Biome.Port]: genPort, [Biome.Airfield]: genAirfield, [Biome.Desert]: genDesert, [Biome.Snow]: genSnow, [Biome.Forest]: genForest,
};
/** Forget per-fight state (claims, dams, runways). */
export function resetBiomeGen() { claims.length = 0; DAMS.length = 0; AIR.gen = -1; }
