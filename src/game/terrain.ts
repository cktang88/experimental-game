// Terrain: the ground of every biome as analytic fields (height, water, canopy cover), baked into a ring-buffer grid
// the ground shader samples, plus the terrain queries gameplay can use (isWater, surfaceAt, ...) and the event grid
// for wildfires, burning oil and broken ice. Owned by the city/world workstream.
//
// COORDINATES: field x, and CITY space y (cy = field y - S.scrollY, constant while the world scrolls), like worldgen.
// Everything is deterministic for a seed (CITY.seed), so content generators, the grid and queries agree.
import { clamp } from '../util/rng';
import { Biome } from './biomes';

/* ---------------- noise ---------------- */
let NSEED = 1;
export function setNoiseSeed(s: number) { NSEED = (s | 0) || 1; }
/** Lattice hash in [0, 1). */
export function hash2(ix: number, iy: number) {
  let h = Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263) + Math.imul(NSEED, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** Smooth value noise in [0, 1]. */
export function vnoise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
export function fbm(x: number, y: number, oct = 4) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) { s += vnoise(x, y) * a; n += a; x = x * 2.03 + 17.1; y = y * 2.03 - 9.7; a *= 0.5; }
  return s / n;
}
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/* ---------------- biome blend ---------------- */
/** Which biomes are on the ground now; written by worldgen when a fight seeds the world. */
export const BIO = {
  a: Biome.City as Biome,
  /** Second biome (-1 none) and the city-space y where the ground turns into it (smaller cy = further ahead). */
  b: -1 as Biome | -1, edge: -1e9,
  /** Width of the blend band (field units) and per-fight phases for every analytic path. */
  band: 220, ph: [0, 0, 0, 0, 0, 0, 0, 0],
};
/** Weight of biome B at (x, cy): 0 = all A, 1 = all B. The boundary wanders across the field. */
export function weightB(x: number, cy: number) {
  if (BIO.b < 0) return 0;
  const p = BIO.ph;
  const e = BIO.edge + 170 * Math.sin(x * 0.0023 + p[0]) + 70 * Math.sin(x * 0.0071 + p[1]) + 40 * (vnoise(x * 0.01, 3.3) - 0.5);
  return smooth(BIO.band * 0.5, -BIO.band * 0.5, cy - e);
}
/** Weight of biome `b` at (x, cy). */
export function weightOf(b: Biome, x: number, cy: number) {
  const w = weightB(x, cy);
  return (BIO.a === b ? 1 - w : 0) + (BIO.b === b ? w : 0);
}
/** The dominant biome at (x, cy). */
export const biomeAtCy = (x: number, cy: number): Biome => (BIO.b >= 0 && weightB(x, cy) > 0.5 ? BIO.b as Biome : BIO.a);

/* ---------------- analytic paths (rivers, valleys, roads, coasts) ---------------- */
/** A meandering line x = f(cy). */
export function pathX(base: number, amp: number, i: number, cy: number) {
  const p = BIO.ph[i & 7];
  return base + amp * (0.6 * Math.sin(cy * 0.0019 + p) + 0.3 * Math.sin(cy * 0.0053 + p * 2.1) + 0.1 * Math.sin(cy * 0.013 + p * 3.7));
}
/** Harbour: x of the shoreline (water on the left). Straight quays where `quay` is high, a natural shore elsewhere. */
export function coastX(cy: number) {
  const p = BIO.ph;
  const wavy = 330 + 110 * Math.sin(cy * 0.0016 + p[2]) + 45 * Math.sin(cy * 0.0049 + p[3]) + 30 * (fbm(cy * 0.01, 7.7, 3) - 0.5);
  return wavy + (QUAY_X - wavy) * quayK(cy);
}
export const QUAY_X = 400;
/** 1 along a container terminal's straight quay, 0 on a natural shore. */
export function quayK(cy: number) { return smooth(-0.15, 0.25, Math.sin(cy * 0.0012 + BIO.ph[4])); }
/** Forest river and mountain valley floor. */
export const riverX = (cy: number) => pathX(560, 260, 5, cy);
export const valleyX = (cy: number) => pathX(820, 300, 6, cy);
export const valley2X = (cy: number) => pathX(1350, 180, 1, cy);
/** Desert: dry riverbed and the convoy highway. */
export const wadiX = (cy: number) => pathX(500, 240, 7, cy);
export const highwayX = (cy: number) => 1060 + 60 * Math.sin(cy * 0.0011 + BIO.ph[2]);
/** Airbase: x of the main runway's centre line. */
export const RUNWAY_X = 660;

/* ---------------- dams ---------------- */
/** Dams built by biomegen (path 0: mountain valley, 1: forest river): the reservoir upstream is water. */
export const DAMS: { path: 0 | 1; cy: number; half: number }[] = [];
/** 0..1 reservoir water at (x, cy). */
export function damWater(x: number, cy: number) {
  let w = 0;
  for (let i = 0; i < DAMS.length; i++) {
    const d = DAMS[i];
    if (cy > d.cy - 3 || cy < d.cy - 320) continue;
    const vx = d.path === 0 ? valleyX(cy) : riverX(cy), u = (d.cy - cy) / 320;
    const half = d.half * (1 - 0.65 * u) + 10 * Math.sin(cy * 0.04 + x * 0.02);
    w = Math.max(w, clamp(Math.min((half - Math.abs(x - vx)) / 5, (cy - (d.cy - 320)) / 30, (d.cy - 3 - cy) / 3), 0, 1));
  }
  return w;
}

/* ---------------- per-biome fields ---------------- */
export interface TerrainSample {
  /** Height in field units (shading only: the ground is drawn flat). */
  h: number;
  /** 0 land .. 1 open water. */
  water: number;
  /** Canopy / scrub cover 0..1 (pines, forest, palms). */
  cover: number;
}
const tmpA: TerrainSample = { h: 0, water: 0, cover: 0 }, tmpB: TerrainSample = { h: 0, water: 0, cover: 0 };

function fieldOf(b: Biome, x: number, cy: number, o: TerrainSample): TerrainSample {
  o.h = 0; o.water = 0; o.cover = 0;
  switch (b) {
    case Biome.City: {
      o.h = 2 * fbm(x * 0.004, cy * 0.004, 2);
      break;
    }
    case Biome.Port: {
      const cx = coastX(cy), d = x - cx;
      o.water = smooth(4, -4, d);
      // Land rises gently from the shore; the sea floor is flat (water is drawn flat anyway).
      o.h = d > 0 ? Math.min(14, d * 0.05) * (0.6 + 0.6 * fbm(x * 0.006, cy * 0.006, 3)) : 0;
      // Natural shores carry scrub and a few trees.
      o.cover = d > 0 ? (1 - quayK(cy)) * smooth(0.45, 0.7, fbm(x * 0.012, cy * 0.012, 3)) * smooth(260, 60, d) : 0;
      break;
    }
    case Biome.Airfield: {
      o.h = 4 * fbm(x * 0.005, cy * 0.005, 3);
      // Tree lines and scrub away from the runway complex.
      const off = Math.abs(x - RUNWAY_X - 120);
      o.cover = smooth(520, 700, off) * smooth(0.5, 0.72, fbm(x * 0.01, cy * 0.01, 3)) * 0.9;
      break;
    }
    case Biome.Desert: {
      const w = fbm(x * 0.0025, cy * 0.0025, 3);
      // Dune crests run diagonally across the field: long windward slopes, short steep lee faces, broken up by warp.
      const ph = (x * 0.8 + cy * 0.45) * 0.0085 + w * 5 + 1.5 * fbm(x * 0.006 + 3, cy * 0.006, 2);
      const s = ph - Math.floor(ph);
      const dune = s < 0.72 ? s / 0.72 : (1 - s) / 0.28;
      const amp = 16 * smooth(0.25, 0.7, fbm(x * 0.0035 + 5, cy * 0.0035, 2));
      let h = dune * dune * (3 - 2 * dune) * amp + 7 * fbm(x * 0.008, cy * 0.008, 3);
      // Mesas: flat-topped plateaus with hard escarpments.
      const m = fbm(x * 0.0018 + 40, cy * 0.0018, 4);
      const mesa = smooth(0.63, 0.655, m);
      h = h * (1 - mesa) + (34 + 4 * fbm(x * 0.02, cy * 0.02, 2)) * mesa;
      // The wadi: a dry riverbed carved through everything.
      const dw = Math.abs(x - wadiX(cy));
      h -= 12 * Math.exp(-(dw * dw) / 700);
      o.h = h;
      // Palms and scrub only along the wadi.
      o.cover = smooth(40, 10, dw) * smooth(0.4, 0.62, fbm(x * 0.03, cy * 0.03, 2)) * 0.8;
      break;
    }
    case Biome.Snow: {
      // Ridged mountains (big shapes first, little detail) with two valleys carved through them.
      let h = 0, a = 1, fx = x * 0.0016, fy = cy * 0.0016, n = 0;
      for (let i = 0; i < 4; i++) {
        const r = 1 - Math.abs(2 * vnoise(fx, fy) - 1);
        h += r * r * a; n += a; a *= 0.42; fx = fx * 2.1 + 3.1; fy = fy * 2.1 - 1.3;
      }
      h = (h / n) * 170;
      const d1 = Math.abs(x - valleyX(cy)), d2 = Math.abs(x - valley2X(cy));
      const v = Math.min(smooth(10, 210, d1), smooth(10, 130, d2) * 0.6 + 0.4);
      h = h * (0.12 + 0.88 * v) + 6 * fbm(x * 0.02, cy * 0.02, 2);
      // Frozen lakes in the valley floor.
      const lakeN = fbm(x * 0.006 + 9, cy * 0.006, 3);
      o.water = Math.max(smooth(0.58, 0.6, lakeN) * smooth(110, 60, d1), DAMS.length ? damWater(x, cy) : 0);
      if (o.water > 0) h = h * (1 - o.water) + 2 * o.water;
      o.h = h;
      // Pines below the tree line, thinning on steep and high ground.
      const tl = 52 + 18 * fbm(x * 0.008, cy * 0.008, 2);
      o.cover = smooth(tl + 4, tl - 14, h) * smooth(0.42, 0.62, fbm(x * 0.012, cy * 0.012, 3)) * (1 - o.water);
      break;
    }
    case Biome.Forest: {
      o.h = 22 * fbm(x * 0.003, cy * 0.003, 4);
      const dr = Math.abs(x - riverX(cy));
      const rw = 9 + 5 * Math.sin(cy * 0.004 + BIO.ph[3]);
      o.water = smooth(rw + 2, rw - 2, dr);
      // Lakes.
      const ln = fbm(x * 0.004 + 21, cy * 0.004, 3);
      o.water = Math.max(o.water, smooth(0.715, 0.73, ln), DAMS.length ? damWater(x, cy) : 0);
      o.h -= 8 * Math.exp(-(dr * dr) / 2500);
      // Canopy everywhere except clearings, the river banks and clear-cut blocks.
      const clear = smooth(0.64, 0.6, fbm(x * 0.006 + 2, cy * 0.006, 3));
      const cut = (Math.sin(x * 0.03 + BIO.ph[1]) > 0.55 && fbm(x * 0.002, cy * 0.002, 2) > 0.62) ? 0.15 : 1;
      o.cover = (0.75 + 0.25 * fbm(x * 0.03, cy * 0.03, 2)) * clear * cut * smooth(rw + 3, rw + 9, dr) * (1 - o.water);
      break;
    }
  }
  return o;
}

/** Terrain at (x, cy), blended across the biome edge. */
export function sampleCy(x: number, cy: number, o: TerrainSample): TerrainSample {
  const w = weightB(x, cy);
  if (w <= 0.001) return fieldOf(BIO.a, x, cy, o);
  if (w >= 0.999) return fieldOf(BIO.b as Biome, x, cy, o);
  fieldOf(BIO.a, x, cy, tmpA); fieldOf(BIO.b as Biome, x, cy, tmpB);
  o.h = tmpA.h + (tmpB.h - tmpA.h) * w; o.water = tmpA.water + (tmpB.water - tmpA.water) * w; o.cover = tmpA.cover + (tmpB.cover - tmpA.cover) * w;
  return o;
}

/* ---------------- the baked grid ---------------- */
/**
 * Ring buffer the ground shader samples: TERR.nx x TERR.ny cells of TERR.cell field units over [x0, ...) x city y.
 * RGBA8 per cell: R moonlight shade (0.5 = flat ground, higher faces the moon, lower faces away),
 * G water, B canopy cover, A weight of biome B.
 */
export const TERR = { cell: 4, nx: 600, ny: 512, x0: -400, data: new Uint8Array(600 * 512 * 4), ver: 0 };
/** Moon direction (field x, up, city y): high in the upper left, like the engine's key light. */
const LX = -0.52, LY = 0.72, LZ = -0.46;
/** Shading gain per biome: how hard slopes catch the moon. */
const SHADE_G: Record<number, number> = { [Biome.City]: 1.2, [Biome.Port]: 1.6, [Biome.Airfield]: 1.6, [Biome.Desert]: 1.6, [Biome.Snow]: 1.5, [Biome.Forest]: 2.4 };
const ts: TerrainSample = { h: 0, water: 0, cover: 0 };

/**
 * The grid is baked a few rows a frame, upward (decreasing city y), always ahead of the rows the world has generated:
 * a rolling window of three sampled rows gives each baked row its slope. bakeTerrain(n) bakes up to n rows toward
 * TERR's wanted top (terrainWant); the whole screen is baked at once when a fight seeds.
 */
interface Row { gy: number; h: Float32Array; water: Float32Array; cover: Float32Array; w: Float32Array }
const mkRow = (): Row => ({ gy: 0, h: new Float32Array(TERR.nx + 2), water: new Float32Array(TERR.nx + 2), cover: new Float32Array(TERR.nx + 2), w: new Float32Array(TERR.nx + 2) });
const RB = { rows: [mkRow(), mkRow(), mkRow()], /** next row to shade */ g: 0, /** topmost row wanted */ want: 0, ready: false };
function sampleRow(r: Row, gy: number) {
  const { cell, x0 } = TERR, cy = (gy + 0.5) * cell;
  r.gy = gy;
  for (let i = 0; i < TERR.nx + 2; i++) {
    const x = x0 + (i - 0.5) * cell;
    sampleCy(x, cy, ts);
    r.h[i] = ts.h; r.water[i] = ts.water; r.cover[i] = ts.cover; r.w[i] = BIO.b >= 0 ? weightB(x, cy) : 0;
  }
}
/** Start baking at city y cy (the bottom of the world), discarding everything. */
export function resetTerrain(cy = 0) {
  TERR.data.fill(0); TERR.ver++;
  RB.g = Math.floor(cy / TERR.cell); RB.want = RB.g; RB.ready = false;
}
/** Ask for the grid to be baked up to city y cy (the top of the generated world). */
export function terrainWant(cy: number) { RB.want = Math.min(RB.want, Math.floor(cy / TERR.cell)); }
/** Rows still to bake. */
export const terrainLag = () => RB.g - RB.want + 1;
/** Bake up to maxRows rows toward the wanted top. */
export function bakeTerrain(maxRows: number) {
  if (RB.g < RB.want) return;
  const { cell, nx, ny, data } = TERR, R = RB.rows;
  if (!RB.ready) { sampleRow(R[0], RB.g + 1); sampleRow(R[1], RB.g); RB.ready = true; }
  const gA = SHADE_G[BIO.a] ?? 1.5, gB = BIO.b >= 0 ? SHADE_G[BIO.b] ?? 1.5 : gA;
  let n = 0;
  while (RB.g >= RB.want && n < maxRows) {
    // R[0] = row g + 1 (below), R[1] = row g, R[2] = row g - 1 (above).
    sampleRow(R[2], RB.g - 1);
    const below = R[0], mid = R[1], above = R[2], gy = RB.g, row = ((gy % ny) + ny) % ny;
    for (let i = 0; i < nx; i++) {
      const c = i + 1;
      const dx = (mid.h[c + 1] - mid.h[c - 1]) / (2 * cell), dz = (below.h[c] - above.h[c]) / (2 * cell);
      // n = (-dx, 1, -dz) normalised; shade relative to flat ground.
      const inv = 1 / Math.sqrt(dx * dx + 1 + dz * dz), w = mid.w[c], wat = mid.water[c];
      const g = gA + (gB - gA) * w;
      const sh = clamp(0.5 + ((-dx * LX + LY - dz * LZ) * inv - LY) * g * (1 - wat), 0, 1);
      const k = (row * nx + i) * 4;
      data[k] = sh * 255; data[k + 1] = wat * 255; data[k + 2] = mid.cover[c] * 255; data[k + 3] = w * 255;
    }
    // Roll the window up one row.
    R[0] = mid; R[1] = above; R[2] = below;
    RB.g--; n++;
  }
  if (n) TERR.ver++;
}

/* ---------------- event grid: wildfire, burning oil, broken ice ---------------- */
export const enum Burn { None = 0, Forest = 1, Oil = 2, Ice = 3, Scrub = 4 }
/**
 * Same layout as the blackout grid (worldgen DARK): FIRE.n x FIRE.n cells of FIRE.cell field units, a ring over
 * city y. RG float per cell: R = CITY.time it ignited (or the ice broke), G = Burn kind. Shaders sample it.
 */
export const FIRE = { cell: 20, n: 128, x0: -330, data: new Float32Array(128 * 128 * 2), ver: 0, active: [] as number[] };
/** Seconds a cell burns, by kind. */
export const BURN_T: Record<number, number> = { [Burn.Forest]: 16, [Burn.Oil]: 26, [Burn.Ice]: 10, [Burn.Scrub]: 7 };
export const fireRow = (cy: number) => ((Math.floor(cy / FIRE.cell) % FIRE.n) + FIRE.n) % FIRE.n;
export function clearFireRows(cy0: number, cy1: number) {
  for (let y = cy0; y <= cy1 + FIRE.cell; y += FIRE.cell) { const r = fireRow(y) * FIRE.n * 2; FIRE.data.fill(0, r, r + FIRE.n * 2); }
  FIRE.ver++;
}
export function resetFire() { FIRE.data.fill(0); FIRE.active.length = 0; FIRE.ver++; }
/** Cell index at (x, cy), or -1 off the grid. */
export function fireCell(x: number, cy: number) {
  const gx = Math.floor((x - FIRE.x0) / FIRE.cell);
  if (gx < 0 || gx >= FIRE.n) return -1;
  return fireRow(cy) * FIRE.n + gx;
}
/** City y of the centre of cell i, near a reference cy (the ring wraps). */
export function fireCellCy(i: number, nearCy: number) {
  const r = Math.floor(i / FIRE.n), span = FIRE.n * FIRE.cell;
  let cy = (r + 0.5) * FIRE.cell;
  cy += Math.round((nearCy - cy) / span) * span;
  return cy;
}
export const fireCellX = (i: number) => FIRE.x0 + ((i % FIRE.n) + 0.5) * FIRE.cell;
/** Light cell i (time t, kind k) unless it already burned. Returns true when it caught. */
export function igniteCell(i: number, t: number, k: Burn) {
  if (i < 0 || FIRE.data[i * 2] > 0) return false;
  FIRE.data[i * 2] = t; FIRE.data[i * 2 + 1] = k; FIRE.ver++;
  FIRE.active.push(i);
  return true;
}

/* ---------------- queries ---------------- */
export type SurfaceKind = 'water' | 'ice' | 'sand' | 'snow' | 'rock' | 'forest' | 'grass' | 'urban' | 'road' | 'runway' | 'apron' | 'dock';
export interface TerrainInfo { biome: Biome; surface: SurfaceKind; h: number; water: number; cover: number }
