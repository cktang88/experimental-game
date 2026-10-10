// World generation: the biome scrolling far beneath the fight (night city, harbour, airbase, desert, mountains,
// forest), plus the cloud deck. Owned by the city/world agent. Combat calls seedDecor() on start, updateBg(dt) every
// tick and worldBlast() for every ground explosion; it returns scrap to spill (destroyed structures pay out).
//
// COORDINATES
//  Everything here is in FIELD units (see field.ts). The world is generated in rows ("chunks") in a fixed CITY
//  space: field y = cy + S.scrollY, so a structure's cy never changes while it scrolls.
//  Decor.x / Decor.y are kept in field space every tick for gameplay code; the renderer works from cy.
//  Rows are generated upward (decreasing cy) and dropped once they scroll past the bottom edge.
//  Heights (hgt, tier.z0, tier.hgt) are field units too; the renderer multiplies everything by
//  engine.groundScale.
//
// SCALE
//  The dreadnought is an aircraft carrier (~330 m) seen from far above: a city block is a small fraction of its hull
//  and buildings read as tiny lit rectangles. The city fillers below are authored in DESIGN units (a block is
//  ~100-200 design units, FLOOR is one storey) and every row is shrunk by CITY_K into field units about the field's
//  centre line (see shrinkRow). The other biomes (biomegen.ts) are authored in field units directly; their
//  structures still get hit points and scrap from their design size (fb()).
//
// BIOMES (biomes.ts, terrain.ts, biomegen.ts)
//  S.theme is the biome of the fight; CITY.biomeB (or -1) is the biome it crosses into at city y CITY.edge
//  (a coastline, a desert edge, a snowline). The ground itself is analytic (terrain.ts) and baked per row into a
//  grid the ground shader samples; structures, roads, lights and moving traffic are generated per row and masked by
//  the biome weight, so the edge is a ragged blend, not a cut. When the ship crosses the edge S.theme becomes the
//  second biome (post grade and the banner follow).
import { rnd, pick, clamp } from '../util/rng';
import { FIELD_W as W, FIELD_H as H } from './field';
import { S, groundBlast, setBanner } from './combat';
import { addFx, boomFx, V } from './vfx';
import { Biome, BIOMES, BIOME_COUNT, biomeName } from './biomes';
import {
  BIO, TERR, FIRE, Burn, BURN_T, bakeTerrain, terrainWant, terrainLag, resetTerrain, resetFire, clearFireRows, sampleCy, weightB, weightOf, biomeAtCy,
  setNoiseSeed, hash2, fireCell, fireCellCy, fireCellX, igniteCell, type SurfaceKind, type TerrainInfo, type TerrainSample,
} from './terrain';
import { GEN, setPieceIn, resetBiomeGen } from './biomegen';

/** Field units per design unit: how far below the ship the city is shrunk. */
export const CITY_K = 0.25;
/** One storey, in design units (STOREY is the same in field units). */
export const FLOOR = 4.4;
export const STOREY = FLOOR * CITY_K;
/**
 * Every blast covers many small structures, each still paying 1-4 scrap. Combat multiplies worldBlast()'s scrap by
 * cityPay(): the pay of the biome the last blast landed in (BIOMES[b].pay, tuned per biome against
 * tests/unit/economy.test.ts so every biome pays about what the night city does).
 */
export const cityPay = () => CITY.payK;
/** World generated across this x span (wider than the field: the top of the view is wider). */
export const X0 = -330, X1 = W + 330;
/** The same span in design units, and the design <-> field mapping (about the field's centre line). */
const DX0 = W / 2 + (X0 - W / 2) / CITY_K, DX1 = W / 2 + (X1 - W / 2) / CITY_K;
export const fx = (dx: number) => W / 2 + (dx - W / 2) * CITY_K;
export const toDX = (x: number) => W / 2 + (x - W / 2) / CITY_K;
const GEN_TOP = -380, DROP_BOTTOM = H + 90;
/** A generated chunk holds whole block rows until it is at least this tall (field units). */
const CHUNK_MIN = 120;

export type Surface =
  | 'walk' | 'plaza' | 'grass' | 'park' | 'lot' | 'gravel' | 'yard' | 'dock' | 'rail' | 'ash' | 'snow' | 'dirt' | 'bund'
  | 'runway' | 'taxi' | 'apron' | 'concrete' | 'mark' | 'pitch' | 'sand' | 'road' | 'snowroad' | 'basin' | 'berm' | 'pad' | 'deck';
export const SURFACES: Surface[] = [
  'walk', 'plaza', 'grass', 'park', 'lot', 'gravel', 'yard', 'dock', 'rail', 'ash', 'snow', 'dirt', 'bund',
  'runway', 'taxi', 'apron', 'concrete', 'mark', 'pitch', 'sand', 'road', 'snowroad', 'basin', 'berm', 'pad', 'deck',
];
export type BKind =
  | 'tower' | 'mid' | 'low' | 'house' | 'warehouse' | 'tank' | 'chimney' | 'flare' | 'cooler' | 'ruin' | 'silo'
  | 'crane' | 'ship' | 'cargo' | 'hangar' | 'plane' | 'dome' | 'igloo' | 'rocket' | 'gantry' | 'wall' | 'dam' | 'bridge'
  | 'cabin' | 'lighthouse' | 'pump' | 'mast' | 'stand';
export type PropKind = 'tree' | 'container' | 'crane' | 'railcar' | 'loco' | 'pipe' | 'ship' | 'searchlight' | 'lamp' | 'fire' | 'rubble' | 'hulk' | 'pylon' | 'logs' | 'palm';
/** Facade styles (renderer maps them to window patterns). */
export const enum Style {
  Brick = 0, Concrete = 1, Panel = 2, Glass = 3, GlassTeal = 4, Industrial = 5, House = 6, Charred = 7, Metal = 8,
  /** Desert mud brick: a few small warm windows. */ Adobe = 9,
  /** Hangar: dark, a lit strip along the door side. */ Hangar = 10,
  /** Plain pale shell, no windows (radomes, igloos, rockets). */ Shell = 11,
  /** Ship hull: dark, a row of deck lights. */ Hull = 12,
}
/** Geometry a building kind is drawn with (renderer): 0 box, 1 cylinder, 2 dome. */
export const bGeo = (k: BKind) => (k === 'tank' || k === 'silo' || k === 'chimney' || k === 'flare' || k === 'cooler' || k === 'rocket' || k === 'lighthouse') ? 1 : (k === 'dome' || k === 'igloo') ? 2 : 0;

export interface Decor {
  type: 'bldg' | 'crater';
  /** Field position of the footprint centre (kept in sync with the scroll). */
  x: number; y: number;
  /** City-space y (constant): field y = cy + S.scrollY. */
  cy: number;
  /** Footprint size (field units) and approximate hit radius. */
  w: number; h: number; r: number;
  /** Height in field units (0 for flat decor). */
  hgt: number;
  [k: string]: unknown;
}
export interface Tier { ox: number; oy: number; w: number; h: number; z0: number; hgt: number }
export interface Bldg extends Decor {
  type: 'bldg'; kind: BKind; tiers: Tier[]; style: Style; seed: number; floors: number;
  /** Fraction of windows lit; keepLit buildings never black out (generators). */
  lit: number; keepLit: boolean; neon: number;
  hp: number; maxHp: number; value: number;
  /** Fire intensity 0..1 and the CITY.time it started (-1 never). */
  fire: number; burnT: number;
  /** CITY.time the collapse started (-1 standing). */
  collapseT: number;
  dead: boolean; chunk: Chunk;
  /** Rotation in radians about the vertical axis (houses, tanks, ships). Tier offsets rotate with it. */
  rot: number;
  /** Colour override (hex) instead of the style's tint: containers, hulls, radomes. */
  tint?: string;
  /** Snow (1) or sand (0.5) settled on the roof. */
  roof: number;
  /** Fuel: when it collapses it goes up in a fireball and a chain blast of this many times its size (0 none). */
  fuel: number;
  /** Ground fire it leaves (terrain.ts Burn): burning oil, a fuel spill. */
  spill: number;
  /** Renderer bookkeeping: geometry batch, first instance index of its tiers and how many (-1 / 0 when not drawn). */
  rg: number; ri: number; rn: number;
}
export interface Crater extends Decor { type: 'crater'; born: number }
export interface Pad { x0: number; y0: number; x1: number; y1: number; s: Surface }
/** dir 0: avenue along the scroll (vertical on screen); 1: cross street. */
export interface Road { x0: number; y0: number; x1: number; y1: number; dir: 0 | 1; lanes: number; major: boolean }
/** A straight strip at any angle (country roads, runway markings, pipelines, walls on the ground). */
export interface Seg { x0: number; cy0: number; x1: number; cy1: number; w: number; s: Surface }
export interface Prop { k: PropKind; x: number; cy: number; w: number; d: number; h: number; rot: number; v: number; on?: Bldg }
export interface Water { x0: number; y0: number; x1: number; y1: number }
/**
 * A point light on the ground. c: colour (LC), k: kind (0 lamp that blacks out, 2 always on, 3 blink,
 * 6 sequenced strobe running along p 0..1, 7 rotating beacon alternating white / teal, 8 lighthouse, 9 glowing line that
 * never blacks out: runway edges, quay edges, spillways), p: phase.
 */
export interface WLight {
  x: number; cy: number; h: number; s: number; c: number; a: number; k: number; p: number; b?: Bldg;
  /** Kind 9 (glowing line): length along cy (ax 0) or x (ax 1); s is its width. */
  len?: number; ax?: 0 | 1;
}
/** Light colours (renderer palette): sodium, white, amber, taxi blue, teal-green, warm window, cold flood, fire orange. */
export const enum LC { Sodium = 0, White = 1, Amber = 2, Blue = 3, Teal = 4, Warm = 5, Flood = 6, Fire = 7 }
/**
 * Something that moves on its own (drawn per frame by the renderer from CITY.time): boats with wakes, convoys,
 * cars. path: 0 straight along angle a (field radians, 0 = +x, PI/2 = down the screen), 1 desert highway,
 * 2 mountain valley road, 3 forest river, 4 forest road (x follows the path, cy moves at v). Moves v field units/s
 * from (x, cy) at CITY.time t0 (path movers keep x's offset from the path).
 */
export interface Mover {
  k: 'ship' | 'tug' | 'boat' | 'convoy' | 'car' | 'barge' | 'jet';
  x: number; cy: number; t0: number; v: number; path: number; a: number;
  /** Hull length (field units) or vehicles in a convoy. */
  len: number; n: number; seed: number;
}
/** A rectangle of a known surface, for terrain queries (runways, docks, roads, built-up blocks). */
export interface ZoneRect { x0: number; y0: number; x1: number; y1: number; s: SurfaceKind }
export interface Chunk {
  id: number; cy0: number; cy1: number; theme: number;
  bldgs: Bldg[]; pads: Pad[]; roads: Road[]; props: Prop[]; water: Water[];
  segs: Seg[]; lights: WLight[]; movers: Mover[]; zones: ZoneRect[];
}

type Zone = 'water' | 'docks' | 'harbor' | 'down' | 'core' | 'mid' | 'park' | 'refinery' | 'tanks' | 'works' | 'rail' | 'yard' | 'suburb' | 'ruins' | 'neon' | 'housing';
interface Col { x0: number; x1: number; zone: Zone }
interface Ave { x0: number; x1: number; major: boolean }
interface Plan { theme: number; cols: Col[]; aves: Ave[]; coast: number }
interface Pending { t: number; x: number; cy: number; r: number; dmg: number }
export interface Cloud { x: number; y: number; w: number; h: number; alt: number; a: number; seed: number }

/** Shared world state read by the renderer. */
export const CITY = {
  /** Increments on every reseed so the renderer can rebuild. */
  gen: 0,
  /** World clock (seconds); drives every city animation and state transition. */
  time: 0,
  /** Biome under the ship now (S.theme follows it), the biome of the fight's start, and the one it crosses into. */
  theme: 0, biomeA: 0 as Biome, biomeB: -1 as Biome | -1,
  /** City y of the biome edge (BIO.edge), and whether the ship has crossed it. */
  edge: -1e9, crossed: false,
  /** Scrap multiplier of the last blast's biome (cityPay()). */
  payK: BIOMES[0].pay,
  /** Per-fight seed of every analytic field (terrain.ts). */
  seed: 1,
  chunks: [] as Chunk[],
  craters: [] as Crater[],
  /** Buildings whose state changed since the renderer last looked. */
  dirty: [] as Bldg[],
  /** Buildings currently burning or smouldering (for fx). */
  burning: [] as Bldg[],
  /** Street plan of the night city (null when no city is on the ground). */
  plan: null as Plan | null,
  seeded: false,
  /** Camera height in world units and ground scale, set by the renderer (parallax of clouds). */
  camH: 3038, groundK: 1.65,
  /**
   * Field point under the same pixel as a point `alt` field units above the ground at (x, y).
   * The renderer installs the real projection; it is used so blasts can hit what the player sees.
   */
  project: (x: number, y: number, _alt: number, out: { x: number; y: number }) => { out.x = x; out.y = y; return out; },
  nextCy: 0, nextId: 1,
  pending: [] as Pending[],
  /** Rows since the last set piece, per biome generator (biomegen.ts). */
  sinceSet: 0,
};

/**
 * Blackout grid: the city's power dies around the dreadnought as it passes. A ring buffer of
 * DARK.n x DARK.n cells (DARK.cell field units each) over [X0, ...) x city y, holding the CITY.time
 * each cell went dark (0 = still lit). Shaders sample it to switch windows, lamps and signs off.
 */
export const DARK = { cell: 20, n: 128, x0: X0, data: new Float32Array(128 * 128), ver: 0 };
const darkRow = (cy: number) => ((Math.floor(cy / DARK.cell) % DARK.n) + DARK.n) % DARK.n;
function clearDarkRows(cy0: number, cy1: number) {
  for (let y = cy0; y <= cy1 + DARK.cell; y += DARK.cell) DARK.data.fill(0, darkRow(y) * DARK.n, darkRow(y) * DARK.n + DARK.n);
  DARK.ver++;
}
function blackout(x: number, y: number, rad: number) {
  const cy = y - S.scrollY, c = DARK.cell;
  for (let gy = Math.floor((cy - rad) / c); gy <= Math.floor((cy + rad) / c); gy++) {
    const row = ((gy % DARK.n) + DARK.n) % DARK.n;
    for (let gx = Math.max(0, Math.floor((x - rad - DARK.x0) / c)); gx <= Math.min(DARK.n - 1, Math.floor((x + rad - DARK.x0) / c)); gx++) {
      const i = row * DARK.n + gx;
      if (DARK.data[i] > 0) continue;
      const d = Math.hypot(DARK.x0 + (gx + 0.5) * c - x, (gy + 0.5) * c - cy);
      if (d > rad) continue;
      DARK.data[i] = CITY.time + 0.05 + (d / rad) * 0.6 + Math.random() * 0.5; DARK.ver++;
    }
  }
}

/* ---------------- plan: avenues, columns and zones of the night city ---------------- */
function makePlan(): Plan {
  const cols: Col[] = [], aves: Ave[] = [];
  let x = DX0 - 40, n = 0;
  while (x < DX1 + 40) {
    const major = n % 3 === 0;
    const aw = major ? 32 : 20;
    aves.push({ x0: x, x1: x + aw, major });
    x += aw;
    const bw = rnd(130, 200);
    cols.push({ x0: x, x1: x + bw, zone: 'down' });
    x += bw; n++;
  }
  // Zones are laid out across the screen (field units), so the view keeps its composition: a glittering core
  // down the middle with a neon strip, office districts, mid-rise housing, then low suburbs at the edges.
  const mid = W / 2, neonSide = Math.random() < 0.5 ? -1 : 1;
  cols.forEach((c) => {
    const cx = (c.x0 + c.x1) / 2, sd = ((cx - mid) * CITY_K) / (W / 2), dc = Math.abs(sd);
    c.zone = dc < 0.16 ? 'core' : dc < 0.36 ? (Math.sign(sd) === neonSide && dc < 0.32 ? 'neon' : 'core') : dc < 0.62 ? 'down' : dc < 0.85 ? (Math.random() < 0.25 ? 'park' : 'mid') : 'suburb';
  });
  return { theme: Biome.City, cols, aves, coast: -9999 };
}

/**
 * Decor's field y follows the scroll through a shared getter (field y = cy + S.scrollY), so thousands of
 * small buildings cost nothing per tick.
 */
const SCROLLED = Object.defineProperty({}, 'y', { get(this: Decor) { return this.cy + S.scrollY; }, enumerable: true });

/* ---------------- block fillers ---------------- */
let seedCounter = 1;
const nextSeed = () => ((seedCounter = (seedCounter * 1103515245 + 12345) >>> 0) % 100000) / 100000 + Math.random() * 1e-3;

/** A building in DESIGN units (shrunk with its row). */
export function bldg(ch: Chunk, kind: BKind, x0: number, y0: number, x1: number, y1: number, tiers: Tier[], style: Style, o: Partial<Bldg> = {}): Bldg {
  const w = x1 - x0, h = y1 - y0, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  let top = 0; for (const t of tiers) top = Math.max(top, t.z0 + t.hgt);
  const floors = Math.max(1, Math.round(top / FLOOR));
  const maxHp = kind === 'tank' ? 40 + w : Math.min(240, 30 + floors * 5 + (w * h) / 90);
  const b: Bldg = Object.assign(Object.create(SCROLLED) as Bldg, {
    type: 'bldg' as const, kind, x: cx, cy, w, h, r: Math.hypot(w, h) / 2, hgt: top, tiers, style, seed: nextSeed(), floors,
    lit: rnd(0.25, 0.7), keepLit: Math.random() < 0.12, neon: 0,
    hp: maxHp, maxHp, value: scrapValue(kind, maxHp),
    fire: 0, burnT: -1, collapseT: -1, dead: false, chunk: ch, rot: 0, roof: 0, fuel: 0, spill: 0, rg: 0, ri: -1, rn: 0, ...o,
  });
  if (o.fuel === undefined && (kind === 'tank' || kind === 'silo' || kind === 'flare')) b.fuel = 1;
  ch.bldgs.push(b); S.decor.push(b);
  return b;
}
/** Scrap a collapsed building pays (1-4, bigger pays more); combat scales it by carnage. */
export function scrapValue(kind: BKind, maxHp: number) {
  if (kind === 'tank' || kind === 'rocket') return 3;
  return clamp(Math.round(maxHp / 60), 1, 4);
}
export const tier = (w: number, h: number, z0: number, hgt: number, ox = 0, oy = 0): Tier => ({ ox, oy, w, h, z0, hgt });

function shrinkBldg(b: Bldg) {
  const k = CITY_K;
  b.x = fx(b.x); b.cy *= k;
  b.w *= k; b.h *= k; b.r *= k; b.hgt *= k;
  for (const t of b.tiers) { t.ox *= k; t.oy *= k; t.w *= k; t.h *= k; t.z0 *= k; t.hgt *= k; }
}
/**
 * A structure in FIELD units (the other biomes): centre (x, cy), footprint w x h, height hgt, or explicit tiers
 * (field units, offsets from the centre). Hit points and scrap come from its design size, like the city's.
 */
export function fb(ch: Chunk, kind: BKind, x: number, cy: number, w: number, h: number, hgt: number, style: Style, o: Partial<Bldg> = {}, tiers?: Tier[]): Bldg {
  const k = CITY_K;
  const td = (tiers ?? [tier(w, h, 0, hgt)]).map((t) => tier(t.w / k, t.h / k, t.z0 / k, t.hgt / k, t.ox / k, t.oy / k));
  const b = bldg(ch, kind, toDX(x) - w / k / 2, cy / k - h / k / 2, toDX(x) + w / k / 2, cy / k + h / k / 2, td, style, o);
  shrinkBldg(b);
  return b;
}

/** Split [a, b] into pieces of roughly size s (at least 1). */
function splits(a: number, b: number, s0: number, s1: number): number[] {
  const out = [a]; let x = a;
  while (b - x > s1 * 1.4) { x += rnd(s0, s1); out.push(x); }
  out.push(b); return out;
}

/** A lot with a building: picks massing from the zone. */
function lotBuilding(ch: Chunk, zone: Zone, x0: number, y0: number, x1: number, y1: number, dens: number) {
  const w = x1 - x0, h = y1 - y0;
  if (w < 10 || h < 10) return;
  const fl = (a: number, b: number) => Math.round(rnd(a, b)) * FLOOR;
  let style: Style = pick([Style.Brick, Style.Concrete, Style.Panel, Style.Brick, Style.Concrete]);
  const tiers: Tier[] = [];
  let kind: BKind = 'mid';
  switch (zone) {
    case 'core': case 'neon': {
      const tall = zone === 'neon' ? rnd(18, 62) : rnd(14, 48) * dens;
      if (w > 34 && h > 30 && Math.random() < 0.8) {
        kind = 'tower';
        style = zone === 'neon' ? pick([Style.Glass, Style.GlassTeal, Style.Panel, Style.Metal]) : pick([Style.Glass, Style.GlassTeal, Style.Panel, Style.Concrete, Style.Glass]);
        const pod = fl(2, 6);
        tiers.push(tier(w, h, 0, pod));
        const tw = w * rnd(0.55, 0.85), th = h * rnd(0.55, 0.85), ox = rnd(-1, 1) * (w - tw) * 0.4, oy = rnd(-1, 1) * (h - th) * 0.4;
        const top = Math.max(pod + FLOOR * 6, Math.round(tall) * FLOOR);
        if (Math.random() < 0.45) {
          const brk = pod + (top - pod) * rnd(0.55, 0.8);
          tiers.push(tier(tw, th, pod, brk - pod, ox, oy));
          tiers.push(tier(tw * rnd(0.6, 0.85), th * rnd(0.6, 0.85), brk, top - brk, ox, oy));
        } else tiers.push(tier(tw, th, pod, top - pod, ox, oy));
      } else {
        kind = 'mid'; tiers.push(tier(w, h, 0, fl(5, 16 * dens + 4)));
      }
      break;
    }
    case 'down': case 'harbor': {
      if (Math.random() < 0.18 * dens && w > 30 && h > 30) {
        kind = 'tower'; style = pick([Style.Glass, Style.Concrete, Style.Panel]);
        const pod = fl(2, 4), top = fl(14, 30);
        tiers.push(tier(w, h, 0, pod), tier(w * 0.7, h * 0.7, pod, top - pod, rnd(-3, 3), rnd(-3, 3)));
      } else { kind = 'mid'; tiers.push(tier(w, h, 0, fl(3, 7 + 7 * dens))); }
      if (zone === 'harbor' && Math.random() < 0.5) { kind = 'warehouse'; style = Style.Industrial; tiers.length = 0; tiers.push(tier(w, h, 0, fl(2, 3))); }
      break;
    }
    case 'mid': case 'housing': {
      kind = 'mid'; style = pick([Style.Brick, Style.Concrete, Style.Panel]);
      tiers.push(tier(w, h, 0, fl(3, zone === 'housing' ? 12 : 8)));
      break;
    }
    case 'yard': case 'works': {
      kind = 'warehouse'; style = Style.Industrial; tiers.push(tier(w, h, 0, fl(2, 4)));
      break;
    }
    default: tiers.push(tier(w, h, 0, fl(2, 6)));
  }
  const b = bldg(ch, kind, x0, y0, x1, y1, tiers, style);
  if (zone === 'neon') b.neon = Math.random() < 0.75 ? 1 + Math.floor(Math.random() * 4) : 0;
  if (zone === 'neon') b.lit = rnd(0.45, 0.85);
  if (kind === 'warehouse') b.lit = rnd(0.05, 0.25);
  if (kind === 'tower') { b.lit = rnd(0.3, 0.75); if (Math.random() < 0.5) ch.props.push({ k: 'searchlight', x: b.x, cy: b.cy, w: 0, d: 0, h: b.hgt, rot: rnd(0, 6.28), v: Math.random(), on: b }); }
}

/** Dense block: perimeter lots around a courtyard, or a few large lots. */
function fillDense(ch: Chunk, zone: Zone, x0: number, y0: number, x1: number, y1: number, dens: number) {
  const r = Math.random();
  if (r < 0.08 && zone !== 'neon') { fillPark(ch, x0, y0, x1, y1); return; }
  if (r < 0.14) { ch.pads.push({ x0, y0, x1, y1, s: 'lot' }); return; }
  if (r < 0.2) {
    ch.pads.push({ x0, y0, x1, y1, s: 'plaza' });
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, s = Math.min(x1 - x0, y1 - y0) * 0.5;
    lotBuilding(ch, zone === 'down' ? 'core' : zone, cx - s / 2, cy - s / 2, cx + s / 2, cy + s / 2, dens + 0.4);
    for (let i = 0; i < 6; i++) ch.props.push({ k: 'tree', x: rnd(x0 + 4, x1 - 4), cy: pick([rnd(y0 + 3, y0 + 8), rnd(y1 - 8, y1 - 3)]), w: rnd(4, 6), d: 0, h: rnd(4, 7), rot: 0, v: Math.random() });
    return;
  }
  // Lots are coarser than a real city's: from the ship's altitude a lot is a few pixels, and fewer,
  // larger footprints keep the instance count sane.
  const sz = zone === 'neon' || zone === 'core' ? [56, 96] : [36, 64];
  const xs = splits(x0, x1, sz[0], sz[1]), ys = splits(y0, y1, sz[0], sz[1]);
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) {
    const g = Math.random() < 0.85 ? rnd(0.6, 2.2) : 0;
    if (g === 0 && Math.random() < 0.5) { ch.pads.push({ x0: xs[i], y0: ys[j], x1: xs[i + 1], y1: ys[j + 1], s: Math.random() < 0.5 ? 'lot' : 'gravel' }); continue; }
    lotBuilding(ch, zone, xs[i] + g, ys[j] + g, xs[i + 1] - g, ys[j + 1] - g, dens);
  }
}

function fillPark(ch: Chunk, x0: number, y0: number, x1: number, y1: number) {
  ch.pads.push({ x0, y0, x1, y1, s: 'park' });
  const n = Math.round(((x1 - x0) * (y1 - y0)) / 70);
  for (let i = 0; i < n; i++) ch.props.push({ k: 'tree', x: rnd(x0 + 3, x1 - 3), cy: rnd(y0 + 3, y1 - 3), w: rnd(4, 8), d: 0, h: rnd(4, 9), rot: 0, v: Math.random() });
  const lamps = Math.round((x1 - x0 + y1 - y0) / 30);
  for (let i = 0; i < lamps; i++) ch.props.push({ k: 'lamp', x: rnd(x0 + 6, x1 - 6), cy: rnd(y0 + 6, y1 - 6), w: 0, d: 0, h: 3, rot: 0, v: 0 });
  if (Math.random() < 0.4) ch.props.push({ k: 'searchlight', x: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: 0, d: 0, h: 0, rot: rnd(0, 6.28), v: Math.random() });
}

function fillSuburb(ch: Chunk, zone: Zone, x0: number, y0: number, x1: number, y1: number) {
  const burnt = zone === 'ruins' ? 0.75 : 0.06;
  ch.pads.push({ x0, y0, x1, y1, s: zone === 'ruins' ? 'ash' : 'grass' });
  if (zone === 'ruins') {
    // Burned-out remnants: broken mid-rises, rubble, fires.
    const xs = splits(x0 + 3, x1 - 3, 44, 70), ys = splits(y0 + 3, y1 - 3, 44, 70);
    for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) {
      if (Math.random() < 0.25) { ch.props.push({ k: 'rubble', x: (xs[i] + xs[i + 1]) / 2, cy: (ys[j] + ys[j + 1]) / 2, w: xs[i + 1] - xs[i] - 4, d: ys[j + 1] - ys[j] - 4, h: rnd(3, 7), rot: 0, v: Math.random() }); continue; }
      const g = 2;
      const b = bldg(ch, Math.random() < 0.6 ? 'ruin' : 'mid', xs[i] + g, ys[j] + g, xs[i + 1] - g, ys[j + 1] - g, [tier(xs[i + 1] - xs[i] - 2 * g, ys[j + 1] - ys[j] - 2 * g, 0, Math.round(rnd(2, 9)) * FLOOR)], Math.random() < burnt ? Style.Charred : pick([Style.Brick, Style.Concrete]));
      b.lit = b.style === Style.Charred ? 0 : rnd(0.02, 0.15);
    }
  } else {
    // Terraces facing the street, back gardens between.
    const rowsY = [y0 + 12, y1 - 12];
    for (const ry of rowsY) for (let x = x0 + 22; x < x1 - 22; x += rnd(46, 60)) {
      const w = rnd(30, 40), d = rnd(12, 16);
      const b = bldg(ch, 'house', x - w / 2, ry - d / 2, x + w / 2, ry + d / 2, [tier(w, d, 0, FLOOR * (Math.random() < 0.3 ? 2 : 1))], Math.random() < burnt ? Style.Charred : Style.House);
      b.lit = b.style === Style.Charred ? 0 : rnd(0.15, 0.6);
      for (let t = 0; t < 2; t++) if (Math.random() < 0.6) ch.props.push({ k: 'tree', x: x + rnd(-10, 10), cy: (y0 + y1) / 2 + rnd(-12, 12), w: rnd(4, 7), d: 0, h: rnd(4, 7), rot: 0, v: Math.random() * 0.5 });
    }
  }
  const fires = zone === 'ruins' ? rnd(1, 4) : 0;
  for (let i = 0; i < Math.floor(fires); i++) ch.props.push({ k: 'fire', x: rnd(x0 + 5, x1 - 5), cy: rnd(y0 + 5, y1 - 5), w: rnd(5, 10), d: 0, h: 0, rot: 0, v: Math.random() });
}

/** Density along the city: a slowly wandering downtown core. */
const densAt = (cy: number) => clamp(0.55 + 0.45 * Math.sin(cy * 0.0021) + 0.25 * Math.sin(cy * 0.0057 + 1.7), 0.15, 1.25);

/** One row of night-city blocks (design units) below design y cy1 into the chunk; returns the row's top. */
function genBlockRow(ch: Chunk, plan: Plan, cy1: number) {
  const blockD = rnd(100, 160), streetW = 18;
  const cy0 = cy1 - blockD - streetW;
  ch.roads.push({ x0: DX0 - 60, x1: DX1 + 60, y0: cy1 - streetW, y1: cy1, dir: 1, lanes: 2, major: false });
  for (const a of plan.aves) ch.roads.push({ x0: a.x0, x1: a.x1, y0: cy0, y1: cy1, dir: 0, lanes: a.major ? 4 : 2, major: a.major });
  const by0 = cy0, by1 = cy1 - streetW, dens = densAt(cy0 * CITY_K);
  for (const c of plan.cols) {
    const s = 4; // sidewalk width
    ch.pads.push({ x0: c.x0, y0: by0, x1: c.x1, y1: by1, s: 'walk' });
    const x0 = c.x0 + s, x1 = c.x1 - s, y0 = by0 + s, y1 = by1 - s;
    switch (c.zone) {
      case 'suburb': case 'ruins': fillSuburb(ch, c.zone, x0, y0, x1, y1); break;
      case 'park': if (Math.random() < 0.5) { fillPark(ch, x0, y0, x1, y1); break; } fillDense(ch, 'mid', x0, y0, x1, y1, dens * 0.7); break;
      default: fillDense(ch, c.zone, x0, y0, x1, y1, c.zone === 'core' || c.zone === 'neon' ? dens + 0.2 : dens * 0.8);
    }
  }
  return cy0;
}

/** Shrinks a chunk generated in design units into field units (see SCALE in the header). */
function shrinkRow(ch: Chunk) {
  const k = CITY_K;
  for (const b of ch.bldgs) shrinkBldg(b);
  for (const p of ch.pads) { p.x0 = fx(p.x0); p.x1 = fx(p.x1); p.y0 *= k; p.y1 *= k; }
  for (const r of ch.roads) { r.x0 = fx(r.x0); r.x1 = fx(r.x1); r.y0 *= k; r.y1 *= k; }
  for (const w of ch.water) { w.x0 = fx(w.x0); w.x1 = fx(w.x1); w.y0 *= k; w.y1 *= k; }
  // From this high a park's trees, a quay's lamps and the ruins' fires merge into texture: keep a
  // sample of them (trees as larger canopy clumps), so the city stays quieter than the fight above it.
  let n = 0;
  for (const p of ch.props) {
    const keep = p.k === 'tree' ? 0.08 : p.k === 'container' ? 0.4 : p.k === 'railcar' ? 0.7 : p.k === 'lamp' ? 0.3 : p.k === 'fire' ? 0.18 : p.k === 'searchlight' ? 0.15 : p.k === 'rubble' || p.k === 'hulk' ? 0.5 : 1;
    if (keep < 1 && Math.random() > keep) continue;
    if (p.k === 'tree') { p.w *= 2.8; p.h *= 1.4; }
    p.x = fx(p.x); p.cy *= k; p.w *= k; p.d *= k; p.h *= k;
    ch.props[n++] = p;
  }
  ch.props.length = n;
}

/* ---------------- biome masks ---------------- */
/** True when (x, cy) belongs to biome b (with a little dither so the edge frays instead of cutting). */
export function inBiome(b: Biome, x: number, cy: number) {
  if (BIO.b < 0) return BIO.a === b;
  const w = weightOf(b, x, cy);
  if (w >= 0.999) return true;
  if (w <= 0.001) return false;
  return w + (hash2(Math.floor(x * 0.37), Math.floor(cy * 0.37)) - 0.5) * 0.3 > 0.5;
}
const clipRoad = (r: Road, alongX: boolean, a: number, b: number): Road => (alongX ? { ...r, x0: r.x0 + a, x1: r.x0 + b } : { ...r, y0: r.y0 + a, y1: r.y0 + b });
/** Remove the night city's rows where the ground belongs to the other biome (rects are clipped along their length). */
function maskCity(ch: Chunk) {
  const keepB = (b: Bldg) => inBiome(Biome.City, b.x, b.cy);
  const gone = new Set<Bldg>();
  ch.bldgs = ch.bldgs.filter((b) => (keepB(b) ? true : (gone.add(b), false)));
  if (gone.size) S.decor = S.decor.filter((d) => !gone.has(d as Bldg));
  ch.pads = ch.pads.filter((p) => inBiome(Biome.City, (p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2));
  ch.props = ch.props.filter((p) => inBiome(Biome.City, p.x, p.cy) && (!p.on || !gone.has(p.on)));
  const roads: Road[] = [];
  for (const r of ch.roads) {
    const alongX = r.x1 - r.x0 > r.y1 - r.y0, len = alongX ? r.x1 - r.x0 : r.y1 - r.y0, step = 12;
    let run0 = -1;
    for (let t = 0; t <= len; t += step) {
      const x = alongX ? r.x0 + t : (r.x0 + r.x1) / 2, cy = alongX ? (r.y0 + r.y1) / 2 : r.y0 + t;
      const ok = weightOf(Biome.City, x, cy) > 0.5;
      if (ok && run0 < 0) run0 = t;
      if (!ok && run0 >= 0) { if (t - run0 > 4) roads.push(clipRoad(r, alongX, run0, t)); run0 = -1; }
    }
    if (run0 >= 0 && len - run0 > 4) roads.push(clipRoad(r, alongX, run0, len));
  }
  ch.roads = roads;
}

/** Fraction range of biome B weight over a band of city y (sampled across the generated width). */
function bandWeight(cy0: number, cy1: number, out: { lo: number; hi: number }) {
  out.lo = 1; out.hi = 0;
  if (BIO.b < 0) { out.lo = out.hi = 0; return out; }
  for (let cy = cy0; cy <= cy1 + 1; cy += Math.max(10, (cy1 - cy0) / 3)) for (let x = X0; x <= X1; x += 60) {
    const w = weightB(x, cy); out.lo = Math.min(out.lo, w); out.hi = Math.max(out.hi, w);
  }
  return out;
}
const bw = { lo: 0, hi: 0 };

/** Generates the next chunk above the world: whole block rows (city) or a fixed band, at least CHUNK_MIN tall. */
function genRow() {
  const ch: Chunk = { id: CITY.nextId++, cy0: 0, cy1: CITY.nextCy, theme: CITY.theme, bldgs: [], pads: [], roads: [], props: [], water: [], segs: [], lights: [], movers: [], zones: [] };
  bandWeight(CITY.nextCy - 220, CITY.nextCy, bw);
  const aHere = bw.lo < 0.999, bHere = bw.hi > 0.001;
  const cityHere = (BIO.a === Biome.City && aHere) || (BIO.b === Biome.City && bHere);
  if (cityHere && CITY.plan) {
    const bottom = CITY.nextCy / CITY_K;
    let top = bottom;
    while ((bottom - top) * CITY_K < CHUNK_MIN) top = genBlockRow(ch, CITY.plan, top);
    shrinkRow(ch);
    ch.cy0 = top * CITY_K;
    if (BIO.b >= 0) maskCity(ch);
  } else ch.cy0 = CITY.nextCy - CHUNK_MIN;
  CITY.nextCy = ch.cy0;
  clearDarkRows(ch.cy0, ch.cy1); clearFireRows(ch.cy0, ch.cy1);
  terrainWant(ch.cy0);
  // The other biomes fill the same band (each masks its own content).
  if (aHere) GEN[BIO.a](ch, ch.cy0, ch.cy1);
  if (bHere && BIO.b >= 0) GEN[BIO.b as Biome](ch, ch.cy0, ch.cy1);
  // Zones for terrain queries: the night city's blocks and streets.
  if (cityHere) {
    for (const r of ch.roads) ch.zones.push({ x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1, s: 'road' });
  }
  CITY.chunks.push(ch);
  return ch;
}

/* ---------------- seeding and scrolling ---------------- */
/** Biome edge for a fight that crosses into a second biome: the boundary reaches the ship about 20 s in. */
const EDGE_CY = -760;
/**
 * Set the biomes on the ground. combat.ts (startCombat) sets S.theme / S.biomeB from the run; debug and screenshots
 * can call this directly (window.__city.setBiome(a, b, edgeCy)).
 */
export function setBiome(a: number, b: number = -1, edge = EDGE_CY) {
  S.theme = a; S.biomeB = b; edgeOnce = edge;
  seedDecor();
}
let edgeOnce: number | null = null;

export function seedDecor() {
  S.scrollY = 0;
  S.decor = [];
  const a = (((S.theme | 0) % BIOME_COUNT) + BIOME_COUNT) % BIOME_COUNT as Biome;
  const b = S.biomeB >= 0 && S.biomeB !== a ? (S.biomeB % BIOME_COUNT) as Biome : -1;
  CITY.gen++; CITY.theme = a; CITY.biomeA = a; CITY.biomeB = b; CITY.crossed = false; CITY.seeded = true;
  CITY.edge = edgeOnce ?? EDGE_CY; edgeOnce = null;
  CITY.chunks = []; CITY.craters = []; CITY.dirty = []; CITY.burning = []; CITY.pending = []; CITY.sinceSet = 3;
  resetBiomeGen();
  CITY.seed = (Math.random() * 1e9) | 0;
  CITY.payK = BIOMES[a].pay;
  setNoiseSeed(CITY.seed);
  BIO.a = a; BIO.b = b; BIO.edge = b >= 0 ? CITY.edge : -1e9;
  for (let i = 0; i < BIO.ph.length; i++) BIO.ph[i] = Math.random() * 100;
  CITY.plan = a === Biome.City || b === Biome.City ? makePlan() : null;
  DARK.data.fill(0); DARK.ver++;
  CITY.nextCy = DROP_BOTTOM + 40;
  resetTerrain(CITY.nextCy); resetFire();
  while (CITY.nextCy > GEN_TOP) genRow();
  bakeTerrain(1e9);
  S.clouds = [];
  for (let i = 0; i < 9; i++) S.clouds.push(makeCloud(rnd(-200, H + 100)));
}
function makeCloud(y: number): Cloud {
  const high = Math.random() < 0.2;
  const alt = high ? rnd(1450, 1700) : rnd(420, 950);
  return { x: rnd(-200, W + 200), y, w: rnd(380, 820) * (high ? 1.3 : 1), h: rnd(200, 380), alt, a: high ? rnd(0.06, 0.12) : rnd(0.28, 0.55), seed: Math.random() * 100 };
}

const proj = { x: 0, y: 0 };
let fireTick = 0;
export function updateBg(dt: number) {
  const dy = S.scroll * dt;
  S.scrollY += dy; CITY.time += dt;
  if (!CITY.seeded || CITY.theme !== S.theme) seedDecor();
  while (CITY.nextCy + S.scrollY > GEN_TOP) genRow();
  // Bake the ground ahead of the view a few rows a frame (all of it if it falls far behind).
  const lag = terrainLag();
  if (lag > 0) bakeTerrain(lag > 45 ? lag - 30 : 4);
  // Drop rows that have scrolled away.
  while (CITY.chunks.length && CITY.chunks[0].cy0 + S.scrollY > DROP_BOTTOM) {
    const gone = CITY.chunks.shift()!;
    S.decor = S.decor.filter((d) => d.type !== 'bldg' || (d as Bldg).chunk !== gone);
    CITY.burning = CITY.burning.filter((b) => b.chunk !== gone);
  }
  if (CITY.craters.length && CITY.craters[0].y > DROP_BOTTOM + 40) {
    CITY.craters = CITY.craters.filter((c) => c.y < DROP_BOTTOM + 40);
    S.decor = S.decor.filter((d) => d.type !== 'crater' || d.y < DROP_BOTTOM + 40);
  }
  // Crossing into the second biome: the grade and the name follow the ship.
  if (CITY.biomeB >= 0 && !CITY.crossed) {
    const py = S.P ? S.P.y : H * 0.7;
    if (weightB(S.P ? S.P.x : W / 2, py - S.scrollY) > 0.5) {
      CITY.crossed = true; CITY.theme = CITY.biomeB; S.theme = CITY.biomeB;
      if (S.active && !S.banner) setBanner(biomeName(CITY.biomeB).toUpperCase(), `Sector ${S.sector} · crossing`, 1.8, '#9fb3c8');
    }
  }
  // Clouds drift with parallax: higher layers slide faster than the ground.
  for (const c of S.clouds as Cloud[]) {
    const par = CITY.camH / Math.max(200, CITY.camH - c.alt * 1);
    c.y += dy * par; c.x += dt * 4;
    if (c.y - c.h > H + 200) Object.assign(c, makeCloud(-c.h - rnd(80, 500)));
  }
  // The city's power dies as the dreadnought approaches.
  if (S.P && S.active) blackout(S.P.x, S.P.y - 40, 300);
  // Chain reactions waiting to go off.
  for (let i = CITY.pending.length - 1; i >= 0; i--) {
    const p = CITY.pending[i]; p.t -= dt;
    if (p.t > 0) continue;
    CITY.pending.splice(i, 1);
    const y = p.cy + S.scrollY;
    if (y < -60 || y > H + 60) continue;
    boomFx(p.x, y, p.r * 0.75, '#ffb347', true);
    V.shake = Math.min(14, V.shake + 5);
    // Through combat so collapses pay scrap (times carnage), count as structures and feed Overdrive once.
    if (S.P && S.active) groundBlast(p.x, y, p.r, p.dmg); else worldBlast(p.x, y, p.r, p.dmg);
  }
  // Fires burn down slowly; smoke and embers rise from the worst of them.
  for (let i = CITY.burning.length - 1; i >= 0; i--) {
    const b = CITY.burning[i];
    if (b.dead) { b.fire = Math.max(0, b.fire - dt * 0.05); } else {
      b.fire = Math.max(0, b.fire - dt * 0.012);
      if (b.hp > b.maxHp * 0.15) b.hp -= b.maxHp * 0.01 * b.fire * dt;
    }
    if (b.fire <= 0.01) { CITY.burning.splice(i, 1); b.fire = 0; CITY.dirty.push(b); continue; }
    if (Math.random() < dt * 2.5 * b.fire) {
      CITY.project(b.x, b.y, b.dead ? 2 : b.hgt, proj);
      addFx({ type: 'spark', x: proj.x + rnd(-b.w, b.w) * 0.3, y: proj.y + rnd(-b.h, b.h) * 0.3, vx: rnd(-30, 30), vy: rnd(-50, -10), life: rnd(0.4, 1), max: 1, size: rnd(0.8, 1.6), drag: 1.5, tint: '#ffb04a', ground: true });
    }
  }
  fireTick += dt;
  if (fireTick >= 0.25) { spreadFire(fireTick); fireTick = 0; }
}

/* ---------------- ground fires: wildfire, burning oil, broken ice ---------------- */
const ts: TerrainSample = { h: 0, water: 0, cover: 0 };
/** Cap on burning cells (each is drawn as flames on the ground plus a sample of smoke columns). */
const FIRE_MAX = 420;
const NB = [1, -1, 0, 0, 1, -1, 1, -1], NBY = [0, 0, 1, -1, 1, 1, -1, -1];
function spreadFire(step: number) {
  const act = FIRE.active, t = CITY.time, n = FIRE.n, refCy = -S.scrollY + H / 2;
  for (let j = act.length - 1; j >= 0; j--) {
    const i = act[j], t0 = FIRE.data[i * 2], k = FIRE.data[i * 2 + 1];
    const age = t - t0, dur = BURN_T[k] ?? 10;
    const cy = fireCellCy(i, refCy), y = cy + S.scrollY;
    if (age > dur || y > DROP_BOTTOM + 40 || y < GEN_TOP - 200) { act[j] = act[act.length - 1]; act.pop(); continue; }
    // Burning cells under a structure set it alight.
    if (k !== Burn.Ice && Math.random() < step * 0.6) for (const ch of CITY.chunks) {
      if (cy < ch.cy0 - 20 || cy > ch.cy1 + 20) continue;
      const x = fireCellX(i);
      for (const b of ch.bldgs) if (!b.dead && Math.abs(b.x - x) < FIRE.cell * 0.6 + b.w / 2 && Math.abs(b.cy - cy) < FIRE.cell * 0.6 + b.h / 2) { ignite(b, 0.25); CITY.dirty.push(b); }
    }
    // Wildfire runs downwind (right and down the screen) through canopy; scrub fires stay small; oil burns in place.
    if (k !== Burn.Forest && k !== Burn.Scrub) continue;
    if (act.length >= FIRE_MAX || age < 1.2 || age > dur * 0.7) continue;
    const gx = i % n, row = Math.floor(i / n);
    for (let d = 0; d < 8; d++) {
      const wind = NB[d] > 0 || NBY[d] > 0 ? 1.4 : 0.7;
      if (Math.random() > step * (k === Burn.Forest ? 0.32 : 0.12) * wind) continue;
      const nx = gx + NB[d]; if (nx < 0 || nx >= n) continue;
      const nrow = (row + NBY[d] + n) % n, ni = nrow * n + nx;
      if (FIRE.data[ni * 2] > 0) continue;
      const ncy = cy + NBY[d] * FIRE.cell, x = fireCellX(ni);
      sampleCy(x, ncy, ts);
      if (ts.water > 0.4) continue;
      if (ts.cover > 0.45) igniteCell(ni, t + Math.random() * 0.3, Burn.Forest);
      else if (ts.cover > 0.2 && k === Burn.Forest && Math.random() < 0.3) igniteCell(ni, t, Burn.Scrub);
    }
  }
}
/** A blast on the ground: start a wildfire in canopy, crack ice, or set a spill burning. */
function groundFire(x: number, cy: number, r: number, spill: number) {
  const t = CITY.time, c = FIRE.cell;
  for (let oy = -r; oy <= r; oy += c) for (let ox = -r; ox <= r; ox += c) {
    if (ox * ox + oy * oy > r * r * 1.1) continue;
    const px = x + ox, pcy = cy + oy, i = fireCell(px, pcy);
    if (i < 0 || FIRE.data[i * 2] > 0) continue;
    sampleCy(px, pcy, ts);
    if (spill) { if (ts.water < 0.5) igniteCell(i, t + Math.random() * 0.2, spill); continue; }
    if (ts.water > 0.5) {
      // Frozen lakes crack open (steam and black water); open water just takes the blast.
      if (frozenAt(px, pcy)) igniteCell(i, t, Burn.Ice);
      continue;
    }
    if (ts.cover > 0.45) igniteCell(i, t + Math.random() * 0.4, Burn.Forest);
    else if (ts.cover > 0.2 && Math.random() < 0.6) igniteCell(i, t, Burn.Scrub);
  }
}
/** Lakes freeze in the mountains. */
const frozenAt = (x: number, cy: number) => biomeAtCy(x, cy) === Biome.Snow;

/* ---------------- destruction ---------------- */
function ignite(b: Bldg, amt: number) {
  if (b.fire <= 0) CITY.burning.push(b);
  if (b.burnT < 0) b.burnT = CITY.time;
  b.fire = Math.min(1, b.fire + amt);
}
function collapse(b: Bldg) {
  b.dead = true; b.hp = 0; b.collapseT = CITY.time;
  ignite(b, 0.5);
  const sz = Math.max(b.w, b.h);
  const big = b.hgt > 60 * CITY_K;
  // Dust plume rolling out from the base, debris and a lingering smoke column.
  for (let i = 0; i < (big ? 7 : sz > 9 ? 3 : 2); i++) {
    const a = Math.random() * 6.28, s = rnd(4, 16) * (big ? 1.5 : 1);
    addFx({ type: 'smoke', x: b.x + Math.cos(a) * sz * 0.3, y: b.y + Math.sin(a) * sz * 0.3, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(1.6, 3), max: 3, size: Math.max(4, sz * rnd(0.5, 0.8)), grow: 1.6, a: 0.5, drag: 0.8, ground: true });
  }
  for (let i = 0; i < (big ? 8 : sz > 9 ? 3 : 2); i++) {
    const a = Math.random() * 6.28, s = rnd(15, 60);
    addFx({ type: 'debris', x: b.x, y: b.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(0.5, 1.1), max: 1.1, size: rnd(0.8, 1.8), rot: rnd(0, 6.28), vr: rnd(-10, 10), drag: 1.8, col: '#4a4540', ground: true });
  }
  if (big) V.shake = Math.min(18, V.shake + 6);
  if (b.fuel > 0) {
    // Fuel goes up: a fireball now and a chain blast that can take the neighbours with it.
    const s = Math.max(b.w, b.h) * b.fuel;
    boomFx(b.x, b.y, Math.max(16, s * 1.8), '#ffb347', true);
    CITY.pending.push({ t: rnd(0.15, 0.45), x: b.x, cy: b.cy, r: Math.max(10, s * 1.3), dmg: 40 });
    ignite(b, 1);
  }
  if (b.spill) groundFire(b.x, b.cy, Math.max(FIRE.cell, Math.max(b.w, b.h) * 1.4), b.spill);
}

/** A ground explosion at field (x, y). Returns scrap to spill from anything it destroyed. */
export function worldBlast(x: number, y: number, r: number, dmg: number): number {
  let scrap = 0;
  const bcy = y - S.scrollY;
  CITY.payK = BIOMES[biomeAtCy(x, bcy)].pay;
  for (const ch of CITY.chunks) {
    const fy0 = ch.cy0 + S.scrollY, fy1 = ch.cy1 + S.scrollY;
    if (fy1 < y - r - 90 || fy0 > y + r + 30) continue;
    for (const b of ch.bldgs) {
      if (b.dead) continue;
      // Cheap reject first: a chunk holds hundreds of small buildings (the roof as seen shifts by < 90).
      if (Math.abs(x - b.x) > r + b.w + 60 || Math.abs(y - b.y) > r + b.h + 90) continue;
      // Distance from the blast to the building, measured to its footprint and to its roof as seen.
      const hw = b.w / 2, hh = b.h / 2;
      let ddx = Math.max(0, Math.abs(x - b.x) - hw), ddy = Math.max(0, Math.abs(y - b.y) - hh);
      let d = Math.hypot(ddx, ddy);
      if (b.hgt > 12 * CITY_K && d > 0) {
        CITY.project(b.x, b.y, b.hgt, proj);
        ddx = Math.max(0, Math.abs(x - proj.x) - hw); ddy = Math.max(0, Math.abs(y - proj.y) - hh);
        d = Math.min(d, Math.hypot(ddx, ddy) * 1.15);
      }
      if (d > r) continue;
      const hit = dmg * (1 - 0.5 * (d / r));
      b.hp -= hit;
      ignite(b, (hit / b.maxHp) * 1.6 + 0.08);
      if (b.hp <= 0) { collapse(b); scrap += b.value; }
      CITY.dirty.push(b);
    }
  }
  // The ground itself: canopy catches, ice cracks, open water swallows the crater.
  sampleCy(x, bcy, ts);
  const onWater = ts.water > 0.5 && !frozenAt(x, bcy);
  if (r >= 8 && y > -60 && y < H + 60 && (ts.cover > 0.2 || ts.water > 0.5)) groundFire(x, bcy, r * 0.7, 0);
  if (onWater && r >= 8 && y > -40 && y < H + 40) {
    // A white column of spray instead of a scorch mark.
    for (let i = 0; i < 4; i++) addFx({ type: 'smoke', x: x + rnd(-r, r) * 0.3, y: y + rnd(-r, r) * 0.3, vx: rnd(-8, 8), vy: rnd(-8, 8), life: rnd(0.8, 1.6), max: 1.6, size: r * rnd(0.4, 0.7), grow: 1.4, a: 0.35, drag: 1, col: '#9fb2c4', ground: true });
    return scrap;
  }
  // Craters: skip one that would land on top of a fresh one (the lance ticks every 50 ms).
  let near = false;
  for (let i = CITY.craters.length - 1; i >= Math.max(0, CITY.craters.length - 6); i--) {
    const o = CITY.craters[i];
    if (Math.abs(o.x - x) < r * 0.5 && Math.abs(o.cy - bcy) < r * 0.5) { near = true; break; }
  }
  if (r >= 10 && !near && y > -40 && y < H + 40) {
    const c: Crater = Object.assign(Object.create(SCROLLED) as Crater, { type: 'crater' as const, x, cy: bcy, w: r, h: r, r: r * rnd(0.55, 0.8), hgt: 0, born: CITY.time });
    CITY.craters.push(c); S.decor.push(c);
    if (CITY.craters.length > 90) { const old = CITY.craters.shift()!; const at = S.decor.indexOf(old); if (at >= 0) S.decor.splice(at, 1); }
  }
  return scrap;
}

/* ---------------- terrain queries (for naval / ground spawns and gameplay) ---------------- */
// All take FIELD coordinates (x, y as on screen now) and only answer for the generated band (about field y -380 to
// 990): outside it they answer from the analytic fields, which are still right for the ground but know nothing of
// structures. None of them allocates unless noted.
const qs: TerrainSample = { h: 0, water: 0, cover: 0 };
function zoneAt(x: number, cy: number): SurfaceKind | null {
  for (const ch of CITY.chunks) {
    if (cy < ch.cy0 || cy > ch.cy1) continue;
    for (let i = ch.zones.length - 1; i >= 0; i--) { const z = ch.zones[i]; if (x >= z.x0 && x <= z.x1 && cy >= z.y0 && cy <= z.y1) return z.s; }
  }
  return null;
}
/** Biome at a field point (the edge between two biomes wanders across the field). */
export const biomeAt = (x: number, y: number): Biome => biomeAtCy(x, y - S.scrollY);
/** Open water (harbour, rivers, lakes that are not frozen). Naval units can sail here. */
export function isWater(x: number, y: number) { const cy = y - S.scrollY; return sampleCy(x, cy, qs).water > 0.5 && !frozenAt(x, cy) && zoneAt(x, cy) !== 'dock'; }
/** Frozen lake: walkable, and it cracks under fire. */
export function isIce(x: number, y: number) { const cy = y - S.scrollY; return sampleCy(x, cy, qs).water > 0.5 && frozenAt(x, cy); }
/** Solid ground (not open water). */
export const isLand = (x: number, y: number) => !isWater(x, y);
/** On a runway (airbase): aircraft can take off along it. */
export const isRunway = (x: number, y: number) => zoneAt(x, y - S.scrollY) === 'runway';
/** On a road, runway, taxiway or quay: wheeled convoys prefer these. */
export function isRoad(x: number, y: number) { const z = zoneAt(x, y - S.scrollY); return z === 'road' || z === 'runway' || z === 'apron' || z === 'dock'; }
/** What the ground is at a field point. */
export function surfaceAt(x: number, y: number): SurfaceKind {
  const cy = y - S.scrollY, z = zoneAt(x, cy);
  if (z) return z;
  const t = sampleCy(x, cy, qs), b = biomeAtCy(x, cy);
  if (t.water > 0.5) return frozenAt(x, cy) ? 'ice' : 'water';
  if (t.cover > 0.5) return 'forest';
  switch (b) {
    case Biome.City: return 'urban';
    case Biome.Port: return 'urban';
    case Biome.Desert: return t.h > 30 ? 'rock' : 'sand';
    case Biome.Snow: return t.h > 95 ? 'rock' : 'snow';
    default: return 'grass';
  }
}
/** Everything at once (allocates one object; pass `out` to reuse). */
export function terrainAt(x: number, y: number, out: TerrainInfo = { biome: Biome.City, surface: 'urban', h: 0, water: 0, cover: 0 }): TerrainInfo {
  const cy = y - S.scrollY;
  sampleCy(x, cy, qs);
  out.biome = biomeAtCy(x, cy); out.h = qs.h; out.water = qs.water; out.cover = qs.cover; out.surface = surfaceAt(x, y);
  return out;
}
/**
 * A random field point of a surface inside a box (default: the top of the screen, where spawns enter), or null
 * after `tries` misses. E.g. findSurface('water') for a gunboat, findSurface('runway') for a jet's take-off roll.
 */
export function findSurface(s: SurfaceKind | ((x: number, y: number) => boolean), x0 = 40, y0 = -60, x1 = W - 40, y1 = 260, tries = 40): { x: number; y: number } | null {
  for (let i = 0; i < tries; i++) {
    const x = rnd(x0, x1), y = rnd(y0, y1);
    if (typeof s === 'function' ? s(x, y) : surfaceAt(x, y) === s) return { x, y };
  }
  return null;
}

// Debug handle for tests and screenshots (window.__city).
if (typeof window !== 'undefined') (window as unknown as { __city: unknown }).__city = { CITY, DARK, TERR, FIRE, BIO, worldBlast, setBiome, surfaceAt, isWater, isRunway, terrainAt, setPieceIn };
