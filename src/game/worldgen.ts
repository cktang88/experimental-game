// World generation: the night city scrolling beneath the fight, plus the cloud deck.
// Owned by the city/world agent. Combat calls seedDecor() on start, updateBg(dt) every tick and
// worldBlast() for every ground explosion; it returns scrap to spill (destroyed buildings pay out).
//
// COORDINATES
//  Everything here is in FIELD units (see field.ts). The city is generated in rows ("chunks") in a
//  fixed CITY space: field y = cy + S.scrollY, so a building's cy never changes while it scrolls.
//  Decor.x / Decor.y are kept in field space every tick for gameplay code; the renderer works from cy.
//  Rows are generated upward (decreasing cy) and dropped once they scroll past the bottom edge.
//  Heights (hgt, tier.z0, tier.hgt) are field units too; the renderer multiplies everything by
//  engine.groundScale. FLOOR is one storey.
import { rnd, pick, clamp } from '../util/rng';
import { FIELD_W as W, FIELD_H as H } from './field';
import { S, groundBlast } from './combat';
import { addFx, boomFx, V } from './vfx';

export const FLOOR = 4.4;
/** City generated across this x span (wider than the field: the top of the view is wider). */
export const X0 = -330, X1 = W + 330;
const GEN_TOP = -380, DROP_BOTTOM = H + 90;

export type Surface = 'walk' | 'plaza' | 'grass' | 'park' | 'lot' | 'gravel' | 'yard' | 'dock' | 'rail' | 'ash' | 'snow' | 'dirt' | 'bund';
export const SURFACES: Surface[] = ['walk', 'plaza', 'grass', 'park', 'lot', 'gravel', 'yard', 'dock', 'rail', 'ash', 'snow', 'dirt', 'bund'];
export type BKind = 'tower' | 'mid' | 'low' | 'house' | 'warehouse' | 'tank' | 'chimney' | 'flare' | 'cooler' | 'ruin' | 'silo';
export type PropKind = 'tree' | 'container' | 'crane' | 'railcar' | 'loco' | 'pipe' | 'ship' | 'searchlight' | 'lamp' | 'fire' | 'rubble' | 'hulk' | 'pylon';
/** Facade styles (renderer maps to textures and window patterns). */
export const enum Style { Brick = 0, Concrete = 1, Panel = 2, Glass = 3, GlassTeal = 4, Industrial = 5, House = 6, Charred = 7, Metal = 8 }

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
  /** Rotation in radians about the vertical axis (houses, tanks). */
  rot: number;
  /** Renderer bookkeeping: first instance index of its tiers and how many (-1 / 0 when not drawn). */
  ri: number; rn: number;
}
export interface Crater extends Decor { type: 'crater'; born: number }
export interface Pad { x0: number; y0: number; x1: number; y1: number; s: Surface }
/** dir 0: avenue along the scroll (vertical on screen); 1: cross street. */
export interface Road { x0: number; y0: number; x1: number; y1: number; dir: 0 | 1; lanes: number; major: boolean }
export interface Prop { k: PropKind; x: number; cy: number; w: number; d: number; h: number; rot: number; v: number; on?: Bldg }
export interface Water { x0: number; y0: number; x1: number; y1: number }
export interface Chunk {
  id: number; cy0: number; cy1: number; theme: number;
  bldgs: Bldg[]; pads: Pad[]; roads: Road[]; props: Prop[]; water: Water[];
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
  theme: 0,
  chunks: [] as Chunk[],
  craters: [] as Crater[],
  /** Buildings whose state changed since the renderer last looked. */
  dirty: [] as Bldg[],
  /** Buildings currently burning or smouldering (for fx). */
  burning: [] as Bldg[],
  plan: null as Plan | null,
  /** Camera height in world units and ground scale, set by the renderer (parallax of clouds). */
  camH: 3038, groundK: 1.65,
  /**
   * Field point under the same pixel as a point `alt` field units above the ground at (x, y).
   * The renderer installs the real projection; it is used so blasts can hit what the player sees.
   */
  project: (x: number, y: number, _alt: number, out: { x: number; y: number }) => { out.x = x; out.y = y; return out; },
  nextCy: 0, nextId: 1,
  pending: [] as Pending[],
};

/**
 * Blackout grid: the city's power dies around the dreadnought as it passes. A ring buffer of
 * DARK.n x DARK.n cells (DARK.cell field units each) over [X0, ...) x city y, holding the CITY.time
 * each cell went dark (0 = still lit). Shaders sample it to switch windows, lamps and signs off.
 */
export const DARK = { cell: 40, n: 64, x0: X0, data: new Float32Array(64 * 64), ver: 0 };
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

/* ---------------- plan: avenues, columns and zones per theme ---------------- */
function makePlan(theme: number): Plan {
  const cols: Col[] = [], aves: Ave[] = [];
  const wide = theme === 1 ? [190, 300] : theme === 3 ? [150, 210] : theme === 4 ? [110, 170] : [130, 200];
  let x = X0 - 40, n = 0;
  const coast = theme === 0 ? rnd(330, 460) : -9999;
  while (x < X1 + 40) {
    const major = n % 3 === 0;
    const aw = major ? (theme === 4 ? 34 : 30) : theme === 3 ? 16 : 20;
    if (!(theme === 0 && x + aw < coast)) aves.push({ x0: x, x1: x + aw, major });
    x += aw;
    const bw = rnd(wide[0], wide[1]);
    cols.push({ x0: x, x1: x + bw, zone: 'down' });
    x += bw; n++;
  }
  // Zones per column.
  const mid = W / 2;
  cols.forEach((c, i) => {
    const cx = (c.x0 + c.x1) / 2, dc = Math.abs(cx - mid) / (W / 2);
    switch (theme) {
      case 0: c.zone = c.x1 < coast ? 'water' : c.x0 < coast + 40 ? 'docks' : cx < coast + 360 ? 'harbor' : dc < 0.45 ? 'core' : 'down'; break;
      case 1: c.zone = i % 3 === 1 ? 'tanks' : dc < 0.25 ? 'refinery' : i % 3 === 2 ? 'works' : 'refinery'; break;
      case 2: c.zone = Math.abs(cx - mid) < 260 ? 'rail' : dc < 0.75 ? 'yard' : 'housing'; break;
      case 3: c.zone = dc < 0.3 ? 'ruins' : 'suburb'; break;
      default: c.zone = dc < 0.55 ? 'neon' : 'core';
    }
  });
  if (theme === 0) {
    // Fill the water: one wide water column ending at the coast.
    const first = cols.findIndex((c) => c.zone !== 'water');
    if (first > 0) { cols.splice(0, first, { x0: X0 - 60, x1: cols[first].x0, zone: 'water' }); }
  }
  if (theme === 2) {
    // The rail yard is one wide corridor without avenues through it.
    const rc = cols.filter((c) => c.zone === 'rail');
    if (rc.length) {
      const x0 = rc[0].x0, x1 = rc[rc.length - 1].x1;
      for (let i = aves.length - 1; i >= 0; i--) if (aves[i].x0 > x0 && aves[i].x1 < x1) aves.splice(i, 1);
      const at = cols.indexOf(rc[0]);
      cols.splice(at, rc.length, { x0, x1, zone: 'rail' });
    }
  }
  return { theme, cols, aves, coast };
}

/* ---------------- block fillers ---------------- */
let seedCounter = 1;
const nextSeed = () => ((seedCounter = (seedCounter * 1103515245 + 12345) >>> 0) % 100000) / 100000 + Math.random() * 1e-3;

function bldg(ch: Chunk, kind: BKind, x0: number, y0: number, x1: number, y1: number, tiers: Tier[], style: Style, o: Partial<Bldg> = {}): Bldg {
  const w = x1 - x0, h = y1 - y0, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  let top = 0; for (const t of tiers) top = Math.max(top, t.z0 + t.hgt);
  const floors = Math.max(1, Math.round(top / FLOOR));
  const maxHp = kind === 'tank' ? 30 + w * 0.6 : Math.min(140, 12 + floors * 3 + (w * h) / 150);
  const b: Bldg = {
    type: 'bldg', kind, x: cx, y: cy + S.scrollY, cy, w, h, r: Math.hypot(w, h) / 2, hgt: top, tiers, style, seed: nextSeed(), floors,
    lit: rnd(0.25, 0.7), keepLit: Math.random() < 0.12, neon: 0,
    hp: maxHp, maxHp, value: scrapValue(kind, maxHp),
    fire: 0, burnT: -1, collapseT: -1, dead: false, chunk: ch, rot: 0, ri: -1, rn: 0, ...o,
  };
  ch.bldgs.push(b); S.decor.push(b);
  return b;
}
/** Scrap a collapsed building pays (1-4, bigger pays more); combat scales it by carnage. */
export function scrapValue(kind: BKind, maxHp: number) {
  if (kind === 'tank') return 3;
  return clamp(Math.round(1 + (maxHp - 20) / 40), 1, 4);
}
const tier = (w: number, h: number, z0: number, hgt: number, ox = 0, oy = 0): Tier => ({ ox, oy, w, h, z0, hgt });

/** Split [a, b] into pieces of roughly size s (at least 1). */
function splits(a: number, b: number, s0: number, s1: number): number[] {
  const out = [a]; let x = a;
  while (b - x > s1 * 1.4) { x += rnd(s0, s1); out.push(x); }
  out.push(b); return out;
}

/** A lot with a building: picks massing from the zone. */
function lotBuilding(ch: Chunk, zone: Zone, x0: number, y0: number, x1: number, y1: number, dens: number) {
  const w = x1 - x0, h = y1 - y0, m = rnd(0.6, 1.8);
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
  void m;
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
  const sz = zone === 'neon' || zone === 'core' ? [38, 70] : [24, 46];
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

function fillDocks(ch: Chunk, plan: Plan, x0: number, y0: number, x1: number, y1: number) {
  // Quay along the coast with cranes; piers reach out over the water.
  ch.pads.push({ x0, y0, x1, y1, s: 'dock' });
  const qx = plan.coast;
  for (let y = y0 + rnd(5, 20); y < y1 - 20; y += rnd(36, 60)) ch.props.push({ k: 'crane', x: qx + 10, cy: y, w: 14, d: 12, h: rnd(36, 46), rot: 0, v: Math.random() });
  // Container stacks on the quay.
  for (let y = y0 + 6; y < y1 - 10; y += 9) for (let x = qx + 26; x < x1 - 12; x += 16) if (Math.random() < 0.7)
    ch.props.push({ k: 'container', x, cy: y, w: 13, d: 5, h: Math.floor(rnd(1, 4.4)) * 2.8, rot: 0, v: Math.random() });
  for (let i = 0; i < 4; i++) ch.props.push({ k: 'lamp', x: rnd(qx + 4, x1 - 4), cy: rnd(y0, y1), w: 0, d: 0, h: 9, rot: 0, v: 1 });
}

function fillWaterRow(ch: Chunk, plan: Plan, y0: number, y1: number) {
  ch.water.push({ x0: X0 - 100, y0, x1: plan.coast, y1 });
  // A pier with a moored ship every few rows.
  if (Math.random() < 0.55) {
    const py = rnd(y0 + 10, y1 - 20), len = rnd(160, 300);
    ch.pads.push({ x0: plan.coast - len, y0: py, x1: plan.coast, y1: py + 14, s: 'dock' });
    for (let x = plan.coast - len + 10; x < plan.coast - 10; x += rnd(40, 70)) ch.props.push({ k: 'lamp', x, cy: py + 7, w: 0, d: 0, h: 6, rot: 0, v: 1 });
    if (Math.random() < 0.8) {
      const sl = rnd(110, Math.min(220, len)), sx = plan.coast - 12 - sl / 2;
      const side = py - 4 - 14 > y0 ? -1 : 1;
      ch.props.push({ k: 'ship', x: sx, cy: side < 0 ? py - 13 : py + 27, w: sl, d: 22, h: 6, rot: 0, v: Math.random() });
    }
  }
}

function fillRefinery(ch: Chunk, zone: Zone, x0: number, y0: number, x1: number, y1: number) {
  if (zone === 'tanks') {
    // Tank farm: big storage tanks inside bunds, chains of secondaries when hit.
    ch.pads.push({ x0, y0, x1, y1, s: 'bund' });
    const s = rnd(30, 44), cnt = Math.floor((x1 - x0) / (s + 8)), cntY = Math.max(1, Math.floor((y1 - y0) / (s + 8)));
    const ox = x0 + ((x1 - x0) - cnt * (s + 8)) / 2 + 4 + s / 2, oy = y0 + ((y1 - y0) - cntY * (s + 8)) / 2 + 4 + s / 2;
    for (let i = 0; i < cnt; i++) for (let j = 0; j < cntY; j++) {
      if (Math.random() < 0.12) continue;
      const d = s * rnd(0.8, 1), cx = ox + i * (s + 8), cy = oy + j * (s + 8);
      const b = bldg(ch, 'tank', cx - d / 2, cy - d / 2, cx + d / 2, cy + d / 2, [tier(d, d, 0, d * rnd(0.35, 0.55))], Style.Metal);
      b.r = d / 2; b.lit = 0;
    }
    return;
  }
  ch.pads.push({ x0, y0, x1, y1, s: zone === 'works' ? 'yard' : 'gravel' });
  const r = Math.random();
  if (zone === 'works' || r < 0.3) {
    const xs = splits(x0 + 4, x1 - 4, 50, 90);
    for (let i = 0; i < xs.length - 1; i++) {
      const hh = rnd(0.45, 0.85) * (y1 - y0);
      const b = bldg(ch, 'warehouse', xs[i] + 3, y0 + 6, xs[i + 1] - 3, y0 + 6 + hh, [tier(xs[i + 1] - xs[i] - 6, hh, 0, Math.round(rnd(2, 4)) * FLOOR)], Style.Industrial);
      b.lit = rnd(0.05, 0.2);
    }
    for (let i = 0; i < 4; i++) ch.props.push({ k: 'lamp', x: rnd(x0, x1), cy: rnd(y0, y1), w: 0, d: 0, h: 10, rot: 0, v: 1 });
    return;
  }
  // Process unit: columns, chimneys, a flare stack, pipe racks.
  const n = Math.floor(rnd(3, 7));
  for (let i = 0; i < n; i++) {
    const cx = rnd(x0 + 14, x1 - 14), cy = rnd(y0 + 14, y1 - 14), d = rnd(6, 12);
    bldg(ch, 'silo', cx - d / 2, cy - d / 2, cx + d / 2, cy + d / 2, [tier(d, d, 0, rnd(18, 50))], Style.Metal, { lit: 0 });
  }
  const nc = Math.floor(rnd(1, 3.5));
  for (let i = 0; i < nc; i++) {
    const cx = rnd(x0 + 20, x1 - 20), cy = rnd(y0 + 20, y1 - 20), d = rnd(7, 11);
    bldg(ch, 'chimney', cx - d / 2, cy - d / 2, cx + d / 2, cy + d / 2, [tier(d, d, 0, rnd(70, 120))], Style.Metal, { lit: 0 });
  }
  if (Math.random() < 0.5) {
    const cx = rnd(x0 + 20, x1 - 20), cy = rnd(y0 + 20, y1 - 20);
    bldg(ch, 'flare', cx - 3, cy - 3, cx + 3, cy + 3, [tier(5, 5, 0, rnd(80, 110))], Style.Metal, { lit: 0, keepLit: true });
  }
  if (Math.random() < 0.35) {
    const cx = rnd(x0 + 30, x1 - 30), cy = rnd(y0 + 30, y1 - 30), d = rnd(36, 50);
    bldg(ch, 'cooler', cx - d / 2, cy - d / 2, cx + d / 2, cy + d / 2, [tier(d, d, 0, d * 1.25)], Style.Concrete, { lit: 0 });
  }
  for (let y = y0 + 8; y < y1 - 4; y += rnd(26, 50)) ch.props.push({ k: 'pipe', x: (x0 + x1) / 2, cy: y, w: x1 - x0 - 10, d: 4, h: 4, rot: 0, v: Math.random() });
  for (let i = 0; i < 6; i++) ch.props.push({ k: 'lamp', x: rnd(x0, x1), cy: rnd(y0, y1), w: 0, d: 0, h: 12, rot: 0, v: 1 });
}

function fillRail(ch: Chunk, x0: number, y0: number, x1: number, y1: number) {
  ch.pads.push({ x0, y0, x1, y1, s: 'rail' });
  // Tracks every 11 units; trains sit on some of them (moving trains are animated by the renderer).
  const tracks = Math.floor((x1 - x0 - 10) / 11);
  for (let i = 0; i < tracks; i++) {
    const tx = x0 + 10 + i * 11;
    if (Math.random() < 0.5) {
      let y = y0 + rnd(0, 30);
      const moving = Math.random() < 0.25;
      while (y < y1 - 18) {
        ch.props.push({ k: 'railcar', x: tx, cy: y + 8, w: 4.6, d: 16, h: 4.2, rot: moving ? 1 : 0, v: Math.random() });
        y += 18.5;
        if (Math.random() < 0.08) break;
      }
    }
  }
  for (let y = y0; y < y1; y += 46) for (let x = x0 + 30; x < x1; x += 120) ch.props.push({ k: 'pylon', x, cy: y, w: 0, d: 0, h: 14, rot: 0, v: 1 });
}

function fillSuburb(ch: Chunk, zone: Zone, x0: number, y0: number, x1: number, y1: number) {
  const burnt = zone === 'ruins' ? 0.75 : 0.4;
  ch.pads.push({ x0, y0, x1, y1, s: 'ash' });
  if (zone === 'ruins') {
    // Burned-out downtown remnants: broken mid-rises, rubble, fires.
    const xs = splits(x0 + 3, x1 - 3, 30, 52), ys = splits(y0 + 3, y1 - 3, 30, 52);
    for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) {
      if (Math.random() < 0.25) { ch.props.push({ k: 'rubble', x: (xs[i] + xs[i + 1]) / 2, cy: (ys[j] + ys[j + 1]) / 2, w: xs[i + 1] - xs[i] - 4, d: ys[j + 1] - ys[j] - 4, h: rnd(3, 7), rot: 0, v: Math.random() }); continue; }
      const g = 2;
      const b = bldg(ch, Math.random() < 0.6 ? 'ruin' : 'mid', xs[i] + g, ys[j] + g, xs[i + 1] - g, ys[j + 1] - g, [tier(xs[i + 1] - xs[i] - 2 * g, ys[j + 1] - ys[j] - 2 * g, 0, Math.round(rnd(2, 9)) * FLOOR)], Math.random() < burnt ? Style.Charred : pick([Style.Brick, Style.Concrete]));
      b.lit = b.style === Style.Charred ? 0 : rnd(0.02, 0.15);
    }
  } else {
    // Rows of houses facing the street, back yards between.
    const rowsY = [y0 + 12, y1 - 12];
    for (const ry of rowsY) for (let x = x0 + 9; x < x1 - 9; x += rnd(19, 25)) {
      if (Math.random() < 0.12) { ch.props.push({ k: 'rubble', x, cy: ry, w: 14, d: 12, h: 2.5, rot: 0, v: Math.random() }); continue; }
      const w = rnd(11, 15), d = rnd(10, 13);
      const b = bldg(ch, 'house', x - w / 2, ry - d / 2, x + w / 2, ry + d / 2, [tier(w, d, 0, FLOOR * (Math.random() < 0.3 ? 2 : 1))], Math.random() < burnt ? Style.Charred : Style.House, { rot: Math.random() < 0.5 ? 0 : Math.PI / 2 });
      b.lit = b.style === Style.Charred ? 0 : rnd(0.1, 0.55);
      for (let t = 0; t < 2; t++) if (Math.random() < 0.6) ch.props.push({ k: 'tree', x: x + rnd(-10, 10), cy: (y0 + y1) / 2 + rnd(-12, 12), w: rnd(4, 7), d: 0, h: rnd(4, 7), rot: 0, v: Math.random() < burnt ? 1 : Math.random() * 0.5 });
    }
  }
  const fires = zone === 'ruins' ? rnd(1, 4) : rnd(0, 1.6);
  for (let i = 0; i < Math.floor(fires); i++) ch.props.push({ k: 'fire', x: rnd(x0 + 5, x1 - 5), cy: rnd(y0 + 5, y1 - 5), w: rnd(5, 10), d: 0, h: 0, rot: 0, v: Math.random() });
  if (Math.random() < 0.3) ch.props.push({ k: 'hulk', x: rnd(x0 + 10, x1 - 10), cy: rnd(y0 + 10, y1 - 10), w: 10, d: 5, h: 3, rot: rnd(0, 6.28), v: Math.random() });
}

function fillYard(ch: Chunk, zone: Zone, x0: number, y0: number, x1: number, y1: number) {
  ch.pads.push({ x0, y0, x1, y1, s: 'snow' });
  if (zone === 'housing') {
    const xs = splits(x0 + 3, x1 - 3, 26, 40);
    for (let i = 0; i < xs.length - 1; i++) {
      const b = bldg(ch, 'mid', xs[i] + 3, y0 + 8, xs[i + 1] - 3, y0 + 8 + rnd(14, 20), [tier(xs[i + 1] - xs[i] - 6, 16, 0, Math.round(rnd(4, 12)) * FLOOR)], pick([Style.Panel, Style.Concrete]));
      b.h = b.tiers[0].h; b.lit = rnd(0.35, 0.7);
    }
    for (let i = 0; i < 5; i++) ch.props.push({ k: 'tree', x: rnd(x0 + 4, x1 - 4), cy: rnd(y0 + 30, y1 - 4), w: rnd(3, 5), d: 0, h: rnd(5, 9), rot: 0, v: 0.2 });
    return;
  }
  // Freight yard: warehouses with containers stacked in the snow.
  const r = Math.random();
  if (r < 0.55) {
    const xs = splits(x0 + 4, x1 - 4, 50, 90);
    for (let i = 0; i < xs.length - 1; i++) {
      const hh = rnd(0.4, 0.7) * (y1 - y0);
      bldg(ch, 'warehouse', xs[i] + 3, y0 + 6, xs[i + 1] - 3, y0 + 6 + hh, [tier(xs[i + 1] - xs[i] - 6, hh, 0, Math.round(rnd(2, 3)) * FLOOR)], Style.Industrial, { lit: rnd(0.05, 0.3) });
    }
  }
  for (let y = y0 + (r < 0.55 ? (y1 - y0) * 0.75 : 8); y < y1 - 6; y += 8) for (let x = x0 + 12; x < x1 - 12; x += 15) if (Math.random() < 0.6)
    ch.props.push({ k: 'container', x, cy: y, w: 13, d: 5, h: Math.floor(rnd(1, 3.4)) * 2.8, rot: 0, v: Math.random() });
  for (let i = 0; i < 3; i++) ch.props.push({ k: 'lamp', x: rnd(x0, x1), cy: rnd(y0, y1), w: 0, d: 0, h: 12, rot: 0, v: 1 });
}

/** Density along the city: a slowly wandering downtown core. */
const densAt = (cy: number) => clamp(0.55 + 0.45 * Math.sin(cy * 0.0021 + CITY.nextId * 0.0) + 0.25 * Math.sin(cy * 0.0057 + 1.7), 0.15, 1.25);

function genRow(plan: Plan) {
  const th = plan.theme;
  const blockD = th === 1 ? rnd(150, 230) : th === 3 ? rnd(64, 80) : th === 4 ? rnd(90, 140) : rnd(100, 160);
  const streetW = th === 1 && Math.random() < 0.3 ? 0 : th === 3 ? 14 : th === 4 ? 20 : 18;
  const cy1 = CITY.nextCy, cy0 = cy1 - blockD - streetW;
  const ch: Chunk = { id: CITY.nextId++, cy0, cy1, theme: th, bldgs: [], pads: [], roads: [], props: [], water: [] };
  const sx0 = th === 0 ? plan.coast : X0 - 60;
  if (streetW > 0) ch.roads.push({ x0: sx0, x1: X1 + 60, y0: cy1 - streetW, y1: cy1, dir: 1, lanes: 2, major: false });
  for (const a of plan.aves) ch.roads.push({ x0: a.x0, x1: a.x1, y0: cy0, y1: cy1, dir: 0, lanes: a.major ? 4 : 2, major: a.major });
  const by0 = cy0, by1 = cy1 - streetW, dens = densAt(cy0);
  for (const c of plan.cols) {
    const s = 4; // sidewalk width
    if (c.zone === 'water') { fillWaterRow(ch, plan, cy0, cy1); continue; }
    if (c.zone === 'rail') { fillRail(ch, c.x0, by0, c.x1, by1); if (streetW) ch.pads.push({ x0: c.x0, y0: by1, x1: c.x1, y1: cy1, s: 'rail' }); continue; }
    ch.pads.push({ x0: c.x0, y0: by0, x1: c.x1, y1: by1, s: th === 2 ? 'snow' : th === 3 ? 'ash' : 'walk' });
    const x0 = c.x0 + s, x1 = c.x1 - s, y0 = by0 + s, y1 = by1 - s;
    switch (c.zone) {
      case 'docks': fillDocks(ch, plan, c.x0, by0, c.x1, by1); break;
      case 'refinery': case 'tanks': case 'works': fillRefinery(ch, c.zone, x0, y0, x1, y1); break;
      case 'yard': case 'housing': fillYard(ch, c.zone, x0, y0, x1, y1); break;
      case 'suburb': case 'ruins': fillSuburb(ch, c.zone, x0, y0, x1, y1); break;
      default: fillDense(ch, c.zone, x0, y0, x1, y1, c.zone === 'core' || c.zone === 'neon' ? dens + 0.2 : dens * 0.8);
    }
  }
  CITY.nextCy = cy0;
  clearDarkRows(cy0, cy1);
  CITY.chunks.push(ch);
  return ch;
}

/* ---------------- seeding and scrolling ---------------- */
export function seedDecor() {
  S.scrollY = 0;
  S.decor = [];
  CITY.gen++; CITY.theme = S.theme; CITY.chunks = []; CITY.craters = []; CITY.dirty = []; CITY.burning = []; CITY.pending = [];
  CITY.plan = makePlan(S.theme % 5);
  DARK.data.fill(0); DARK.ver++;
  CITY.nextCy = DROP_BOTTOM + 40;
  while (CITY.nextCy > GEN_TOP) genRow(CITY.plan);
  S.clouds = [];
  for (let i = 0; i < 9; i++) S.clouds.push(makeCloud(rnd(-200, H + 100)));
}
function makeCloud(y: number): Cloud {
  const high = Math.random() < 0.2;
  const alt = high ? rnd(1450, 1700) : rnd(420, 950);
  return { x: rnd(-200, W + 200), y, w: rnd(380, 820) * (high ? 1.3 : 1), h: rnd(200, 380), alt, a: high ? rnd(0.06, 0.12) : rnd(0.28, 0.55), seed: Math.random() * 100 };
}

const proj = { x: 0, y: 0 };
export function updateBg(dt: number) {
  const dy = S.scroll * dt;
  S.scrollY += dy; CITY.time += dt;
  if (!CITY.plan || CITY.theme !== S.theme) seedDecor();
  const plan = CITY.plan!;
  while (CITY.nextCy + S.scrollY > GEN_TOP) genRow(plan);
  // Drop rows that have scrolled away.
  if (CITY.chunks.length && CITY.chunks[0].cy0 + S.scrollY > DROP_BOTTOM) {
    const gone = CITY.chunks.shift()!;
    S.decor = S.decor.filter((d) => d.type !== 'bldg' || (d as Bldg).chunk !== gone);
    CITY.burning = CITY.burning.filter((b) => b.chunk !== gone);
  }
  for (const d of S.decor) d.y = d.cy + S.scrollY;
  if (CITY.craters.length && CITY.craters[0].y > DROP_BOTTOM + 40) {
    CITY.craters = CITY.craters.filter((c) => c.y < DROP_BOTTOM + 40);
    S.decor = S.decor.filter((d) => d.type !== 'crater' || d.y < DROP_BOTTOM + 40);
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
    if (Math.random() < dt * 5 * b.fire) {
      CITY.project(b.x, b.y, b.dead ? 2 : b.hgt, proj);
      addFx({ type: 'spark', x: proj.x + rnd(-b.w, b.w) * 0.3, y: proj.y + rnd(-b.h, b.h) * 0.3, vx: rnd(-30, 30), vy: rnd(-50, -10), life: rnd(0.4, 1), max: 1, size: rnd(0.8, 1.6), drag: 1.5, tint: '#ffb04a', ground: true });
    }
  }
}

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
  const big = b.hgt > 60;
  // Dust plume rolling out from the base, debris and a lingering smoke column.
  for (let i = 0; i < (big ? 9 : 5); i++) {
    const a = Math.random() * 6.28, s = rnd(10, 40) * (big ? 1.5 : 1);
    addFx({ type: 'smoke', x: b.x + Math.cos(a) * sz * 0.3, y: b.y + Math.sin(a) * sz * 0.3, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(1.6, 3), max: 3, size: sz * rnd(0.35, 0.6), grow: 1.6, a: 0.55, drag: 0.8, ground: true });
  }
  for (let i = 0; i < (big ? 10 : 5); i++) {
    const a = Math.random() * 6.28, s = rnd(40, 140);
    addFx({ type: 'debris', x: b.x, y: b.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(0.5, 1.1), max: 1.1, size: rnd(1.5, 3.5), rot: rnd(0, 6.28), vr: rnd(-10, 10), drag: 1.8, col: '#4a4540', ground: true });
  }
  if (big) V.shake = Math.min(18, V.shake + 6);
  if (b.kind === 'tank' || b.kind === 'silo' || b.kind === 'flare') {
    // Fuel goes up: a fireball now and a chain blast that can take the neighbours with it.
    boomFx(b.x, b.y, Math.max(26, b.w * 0.9), '#ffb347', true);
    CITY.pending.push({ t: rnd(0.15, 0.45), x: b.x, cy: b.cy, r: Math.max(36, b.w * 1.25), dmg: 40 });
    ignite(b, 1);
  }
}

/** A ground explosion at field (x, y). Returns scrap to spill from anything it destroyed. */
export function worldBlast(x: number, y: number, r: number, dmg: number): number {
  let scrap = 0;
  for (const ch of CITY.chunks) {
    const fy0 = ch.cy0 + S.scrollY, fy1 = ch.cy1 + S.scrollY;
    if (fy1 < y - r - 220 || fy0 > y + r + 40) continue;
    for (const b of ch.bldgs) {
      if (b.dead) continue;
      // Distance from the blast to the building, measured to its footprint and to its roof as seen.
      const hw = b.w / 2, hh = b.h / 2;
      let ddx = Math.max(0, Math.abs(x - b.x) - hw), ddy = Math.max(0, Math.abs(y - b.y) - hh);
      let d = Math.hypot(ddx, ddy);
      if (b.hgt > 12 && d > 0) {
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
  if (r >= 10 && y > -40 && y < H + 40) {
    const c: Crater = { type: 'crater', x, y, cy: y - S.scrollY, w: r, h: r, r: r * rnd(0.55, 0.8), hgt: 0, born: CITY.time };
    CITY.craters.push(c); S.decor.push(c);
    if (CITY.craters.length > 90) { const old = CITY.craters.shift()!; S.decor = S.decor.filter((d) => d !== old); }
  }
  return scrap;
}

// Debug handle for tests and screenshots (window.__city).
if (typeof window !== 'undefined') (window as unknown as { __city: unknown }).__city = { CITY, DARK, worldBlast };
