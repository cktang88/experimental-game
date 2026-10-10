// Greebles: the dense micro-detail that makes a 140-unit hull read as a 300 m warship.
// Three scales, all merged into the hull's per-material buckets (no extra draw calls):
//   medium: equipment blocks, heat-sink banks, dish pedestals, PDC blisters, hangar mouths;
//   small:  recursively split "machinery fields" of boxes, pipe runs, lockers, antenna masts;
//   tiny:   hatches, vents, deck lights, portholes, stencils (lights are shader points).
// Everything is seeded per hull section (section type, index and its parts), so the same build always
// looks the same, ghosts included, and refitting one section does not reshuffle the others.
import * as THREE from 'three';
import { Buckets, B, R, block, flatRect, lathe, box, octagon, type V2, type Band } from './mesh';
import type { Livery } from './materials';
import { LightSet, LMode } from './lights';
import type { Rng } from '../../util/rng';

export interface GCtx {
  bk: Buckets; L: Livery; lights: LightSet; occ: [number, number, number, number][];
  /** Deck half width (inner terrace edge) and hull half width at z. */
  de: (z: number) => number; hw: (z: number) => number; z0: number; z1: number;
}
export type Box4 = [number, number, number, number];

const Tm = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
const col = (c: THREE.Color, k: number) => c.clone().multiplyScalar(k);

export function occupied(c: GCtx, x0: number, z0: number, x1: number, z1: number, pad = 0.6) {
  for (const o of c.occ) if (x0 - pad < o[2] && x1 + pad > o[0] && z0 - pad < o[3] && z1 + pad > o[1]) return true;
  return false;
}
export const claim = (c: GCtx, x0: number, z0: number, x1: number, z1: number) => { c.occ.push([x0, z0, x1, z1]); };
/** Inside the deck with a margin? */
export function onDeck(c: GCtx, x0: number, z0: number, x1: number, z1: number, m = 3.5) {
  if (z0 < c.z0 + 2 || z1 > c.z1 - 1) return false;
  const w = Math.min(c.de(z0), c.de(z1), c.de((z0 + z1) / 2)) - m;
  return x0 > -w && x1 < w;
}

const BANDS: Band[] = [B.ribs, B.darkPanel, B.panels, B.brackets, B.grille];

/**
 * A machinery field: split the rectangle recursively into cells and raise a box in most of them, with
 * vents and hatches on the roofs and the odd lit porthole. `hMax` is the tallest box.
 */
export function machinery(c: GCtx, rnd: Rng, x0: number, z0: number, x1: number, z1: number, y: number, hMax: number, depth = 0) {
  const w = x1 - x0, d = z1 - z0, P = c.L.paint;
  if (depth < 6 && (w > 2.6 || d > 2.6) && !(depth > 1 && rnd() < 0.18)) {
    if (w > d ? rnd() < 0.85 : rnd() < 0.15) { const s = x0 + w * (0.3 + rnd() * 0.4); machinery(c, rnd, x0, z0, s, z1, y, hMax, depth + 1); machinery(c, rnd, s, z0, x1, z1, y, hMax, depth + 1); }
    else { const s = z0 + d * (0.3 + rnd() * 0.4); machinery(c, rnd, x0, z0, x1, s, y, hMax, depth + 1); machinery(c, rnd, x0, s, x1, z1, y, hMax, depth + 1); }
    return;
  }
  if (w < 0.5 || d < 0.5 || rnd() < 0.14) return; // bare deck between machines
  const g = 0.12 + rnd() * 0.12, h = 0.15 + Math.pow(rnd(), 1.6) * hMax, band = BANDS[Math.floor(rnd() * BANDS.length)];
  const tone = 0.7 + rnd() * 0.5, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, bw = w - g * 2, bd = d - g * 2;
  if (h > 0.6 && bw > 1.2 && bd > 1.2) block(c.bk, octagon(x0 + g, z0 + g, x1 - g, z1 - g, Math.min(0.3, h * 0.3)), y, y + h, { side: band, top: rnd() < 0.5 ? B.panels : B.darkPanel, col: col(P.hull, tone * 0.8), topCol: col(P.hull, tone * 1.1), bevel: Math.min(0.12, h * 0.2), tile: 4 });
  else box(c.bk, band, bw, h, bd, col(P.hull, tone), Tm(cx, y + h / 2, cz), 4);
  const top = y + h + 0.02, k = rnd();
  if (bw > 1 && bd > 1) {
    if (k < 0.22) flatRect(c.bk, R.ventSlots, cx - bw * 0.35, cz - bd * 0.3, cx + bw * 0.35, cz + bd * 0.3, top, P.hull, bw < bd);
    else if (k < 0.34) flatRect(c.bk, R.hatchRound, cx - 0.4, cz - 0.4, cx + 0.4, cz + 0.4, top, P.plate);
    else if (k < 0.42) flatRect(c.bk, R.grate, cx - bw * 0.4, cz - bd * 0.4, cx + bw * 0.4, cz + bd * 0.4, top, P.hull);
    else if (k < 0.48 && h > 0.5) { box(c.bk, B.rail, 0.06, 1.2 + rnd() * 1.6, 0.06, P.dark, Tm(cx, top + 0.7, cz)); c.lights.add(cx, top + 1.5 + rnd() * 1.4, cz, c.L.light.port, 1.2, 0.18, LMode.Beacon, rnd()); }
    else if (k < 0.56) { const r = Math.min(bw, bd) * 0.32; lathe(c.bk, B.ribs, [[r, 0], [r, 0.25], [r * 0.7, 0.32]], 8, P.dark, Tm(cx, top, cz)); }
  }
  // Lit portholes along the long side of taller boxes: the crew is in there.
  if (h > 0.55 && rnd() < 0.45) {
    const alongZ = bd > bw, L = alongZ ? bd : bw, sd = rnd() < 0.5 ? -1 : 1, yy = y + h * 0.55;
    if (alongZ) c.lights.row([cx + sd * (bw / 2 + 0.03), yy, cz - L * 0.4], [cx + sd * (bw / 2 + 0.03), yy, cz + L * 0.4], 0.32, c.L.light.window, 0.75, 0.13, 0.6, LMode.Steady, rnd);
    else c.lights.row([cx - L * 0.4, yy, cz + sd * (bd / 2 + 0.03)], [cx + L * 0.4, yy, cz + sd * (bd / 2 + 0.03)], 0.32, c.L.light.window, 0.75, 0.13, 0.6, LMode.Steady, rnd);
  }
}

/** Pipe bundle along z with flanges and supports. */
export function pipes(c: GCtx, x: number, y: number, za: number, zb: number, n: number, r: number, rnd: Rng) {
  const P = c.L.paint;
  for (let i = 0; i < n; i++) {
    const px = x + (i - (n - 1) / 2) * r * 2.4, rr = r * (0.7 + rnd() * 0.5), m = Tm(px, y + rr, za).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
    lathe(c.bk, B.rail, [[rr, 0], [rr, zb - za]], 6, col(P.dark, 0.9 + rnd() * 0.4), m, false, 1);
  }
  for (let z = za + 1.2; z < zb - 0.5; z += 2.6 + rnd() * 1.5) box(c.bk, B.ribs, n * r * 2.4 + 0.3, r * 2 + 0.2, 0.22, P.hull, Tm(x, y + r, z));
}

/** Antenna mast: lattice stub, crossbars, whips and a beacon. */
export function antenna(c: GCtx, x: number, y: number, z: number, h: number, rnd: Rng) {
  const P = c.L.paint;
  box(c.bk, B.rail, 0.14, h, 0.14, P.dark, Tm(x, y + h / 2, z));
  const nb = 1 + Math.floor(rnd() * 3);
  for (let k = 0; k < nb; k++) { const yy = y + h * (0.45 + k * 0.18), w = (1.6 - k * 0.4) * (0.6 + rnd() * 0.6); box(c.bk, B.rail, w, 0.07, 0.07, P.dark, Tm(x, yy, z)); for (const s of [-1, 1]) box(c.bk, B.rail, 0.04, 0.5, 0.04, P.dark, Tm(x + s * w / 2, yy + 0.25, z)); }
  c.lights.add(x, y + h + 0.1, z, c.L.light.port, 1.6, 0.22, LMode.Beacon, rnd());
}

/** Static dish on a pedestal, aimed somewhere. */
export function dish(c: GCtx, x: number, y: number, z: number, r: number, rnd: Rng) {
  const P = c.L.paint;
  box(c.bk, B.rail, 0.18, r * 0.9, 0.18, P.dark, Tm(x, y + r * 0.45, z));
  const m = Tm(x, y + r * 0.95, z).multiply(new THREE.Matrix4().makeRotationY(rnd() * Math.PI * 2)).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2 - 0.2 - rnd() * 0.8));
  lathe(c.bk, B.panels, [[0, 0], [r * 0.5, 0.12 * r], [r, 0.42 * r]], 10, col(P.plate, 1.2), m, false, 1);
  lathe(c.bk, B.rail, [[0.04, 0], [0.03, 0.8 * r], [0, 0.85 * r]], 4, P.dark, m);
}

/** Point-defence blister (decorative). */
export function blister(c: GCtx, x: number, y: number, z: number, r: number, yaw: number) {
  const P = c.L.paint, m = Tm(x, y, z);
  lathe(c.bk, B.panels, [[0, 0], [r, 0], [r * 0.95, r * 0.4], [r * 0.6, r * 0.85], [0, r]], 7, P.plate, m, false, 1);
  box(c.bk, B.rail, 0.07, 0.07, r * 1.6, P.dark, m.clone().multiply(new THREE.Matrix4().makeRotationY(yaw)).multiply(Tm(0, r * 0.55, -r * 0.9)));
}

/** Heat-sink bank: thin fins over a glowing root. */
export function heatsink(c: GCtx, x0: number, z0: number, x1: number, z1: number, y: number, h: number) {
  const P = c.L.paint, alongX = x1 - x0 < z1 - z0;
  if (alongX) for (let x = x0 + 0.2; x < x1 - 0.1; x += 0.42) box(c.bk, B.rail, 0.1, h, z1 - z0, P.dark, Tm(x, y + h / 2, (z0 + z1) / 2));
  else for (let z = z0 + 0.2; z < z1 - 0.1; z += 0.42) box(c.bk, B.rail, x1 - x0, h, 0.1, P.dark, Tm((x0 + x1) / 2, y + h / 2, z));
  c.bk.get('core').quad([x0, y + 0.05, z0], [x1, y + 0.05, z0], [x1, y + 0.05, z1], [x0, y + 0.05, z1], [0, 0], [1, 0], [1, 1], [0, 1], col(P.full, 0.07), [0, 1, 0]);
}

/**
 * Deck clutter for one section: machinery fields, equipment, masts, dishes, edge furniture and lights.
 * `rnd` is the section's own seeded stream.
 */
export function deckGreebles(c: GCtx, rnd: Rng, za: number, zb: number, type: string) {
  const P = c.L.paint, LL = c.L.light, y = 8; // DECK
  const area = (zb - za) * c.de((za + zb) / 2) * 2;
  // Machinery fields: rectangles of all sizes, biggest first so they find room.
  const nf = Math.round(area / (type === 'armor' ? 160 : 60));
  for (let i = 0; i < nf; i++) {
    const big = i < nf * 0.3, w = big ? 6 + rnd() * 9 : 2.4 + rnd() * 5, d = big ? 5 + rnd() * 10 : 2.4 + rnd() * 5;
    const e = c.de(za + (zb - za) / 2);
    const x = (rnd() * 2 - 1) * (e - w / 2 - 1), z = za + 1 + d / 2 + rnd() * Math.max(0.1, zb - za - d - 2);
    const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2;
    if (!onDeck(c, x0, z0, x1, z1, 1.2) || occupied(c, x0, z0, x1, z1, 0.5)) continue;
    const k = rnd();
    if (type !== 'armor' && k < 0.08 && w > 4 && d > 3) heatsink(c, x0, z0, x1, z1, y, 0.5 + rnd() * 0.4);
    else machinery(c, rnd, x0, z0, x1, z1, y, type === 'armor' ? 0.5 : big ? 1.8 : 1.1);
    claim(c, x0, z0, x1, z1);
  }
  // Masts and dishes on whatever deck is still clear.
  const nm = Math.round(area / 260);
  for (let i = 0; i < nm; i++) {
    const e = c.de((za + zb) / 2), x = (rnd() * 2 - 1) * (e - 3), z = za + 2 + rnd() * (zb - za - 4);
    if (!onDeck(c, x - 1, z - 1, x + 1, z + 1, 1) || occupied(c, x - 1, z - 1, x + 1, z + 1, 0.3)) continue;
    if (rnd() < 0.55) antenna(c, x, y, z, 2 + rnd() * 3.5, rnd); else dish(c, x, y, z, 0.6 + rnd() * 0.8, rnd);
    claim(c, x - 1, z - 1, x + 1, z + 1);
  }
  // Small loose clutter: lockers, bitts, hatches, deck lamps.
  const nl = Math.round(area / 9);
  for (let i = 0; i < nl; i++) {
    const e = c.de((za + zb) / 2), x = (rnd() * 2 - 1) * (e - 1.2), z = za + 1 + rnd() * (zb - za - 2), k = rnd();
    if (!onDeck(c, x - 0.6, z - 0.6, x + 0.6, z + 0.6, 0.6) || occupied(c, x - 0.6, z - 0.6, x + 0.6, z + 0.6, 0.15)) continue;
    if (k < 0.3) box(c.bk, B.ribs, 0.5 + rnd() * 0.6, 0.25 + rnd() * 0.35, 0.35 + rnd() * 0.4, col(P.hull, 0.8 + rnd() * 0.5), Tm(x, y + 0.2, z));
    else if (k < 0.5) flatRect(c.bk, rnd() < 0.5 ? R.hatchRound : R.hatchCross, x - 0.45, z - 0.45, x + 0.45, z + 0.45, y + 0.04, P.plate);
    else if (k < 0.62) flatRect(c.bk, R.ventSlots, x - 0.6, z - 0.25, x + 0.6, z + 0.25, y + 0.04, P.hull);
    else if (k < 0.72) for (const dz of [-0.2, 0.2]) lathe(c.bk, B.rail, [[0.1, 0], [0.1, 0.28], [0.15, 0.3], [0, 0.33]], 5, P.dark, Tm(x, y, z + dz));
    else c.lights.add(x, y + 0.12, z, rnd() < 0.8 ? LL.edge : LL.deck, 0.8, 0.14, LMode.Steady, rnd());
    claim(c, x - 0.6, z - 0.6, x + 0.6, z + 0.6);
  }
  // Deck-edge furniture: lockers and PDC blisters along the terrace, every few units.
  for (const sx of [-1, 1]) {
    for (let z = za + 1.5; z < zb - 1; z += 1.6 + rnd() * 1.2) {
      const x = sx * (c.de(z) - 0.9);
      if (occupied(c, x - 0.5, z - 0.5, x + 0.5, z + 0.5, 0.1) || !onDeck(c, x - 0.5, z - 0.5, x + 0.5, z + 0.5, -0.3)) continue;
      const k = rnd();
      if (k < 0.12) blister(c, x, y, z, 0.55, sx * -Math.PI / 2);
      else if (k < 0.7) box(c.bk, k < 0.4 ? B.ribs : B.darkPanel, 0.7, 0.3 + rnd() * 0.5, 0.8 + rnd() * 0.8, col(P.hull, 0.75 + rnd() * 0.4), Tm(x, y + 0.25, z));
      claim(c, x - 0.5, z - 0.5, x + 0.5, z + 0.5);
    }
  }
}

/**
 * Hull-side detail on the belt (x = +-hw, between deck and bilge): hangar mouths with lit interiors,
 * external pipes, access doors and rows of portholes.
 */
export function beltGreebles(c: GCtx, rnd: Rng, za: number, zb: number, type: string, deckY: number) {
  const P = c.L.paint, LL = c.L.light;
  for (const sx of [-1, 1]) {
    let z = za + 2 + rnd() * 3;
    while (z < zb - 3) {
      const hw = Math.min(c.hw(z), c.hw(z + 3)), x = sx * (hw + 0.04), k = rnd();
      const yTop = deckY - 3.9, yBot = deckY - 7.6;
      if ((type === 'armor' || type === 'spine' || type === 'battery') && k < 0.3 && zb - z > 8) {
        // Hangar mouth: a dark opening with a warm lit interior and edge lights.
        const L = 4 + rnd() * 3, y0 = yBot + 0.4, y1 = yTop - 0.3;
        c.bk.get('black').quad([x, y0, z], [x, y0, z + L], [x, y1, z + L], [x, y1, z], [0, 0], [1, 0], [1, 1], [0, 1], P.dark, [sx, 0, 0]);
        const xi = x + sx * 0.02;
        c.bk.get('window').quad([xi, y0 + 0.2, z + 0.4], [xi, y0 + 0.2, z + L - 0.4], [xi, y0 + 1.1, z + L - 0.4], [xi, y0 + 1.1, z + 0.4], [0, 0.25], [L / 40, 0.25], [L / 40, 0.5], [0, 0.5], col(P.full, 0.8), [sx, 0, 0]);
        c.lights.row([x + sx * 0.1, y1 + 0.1, z], [x + sx * 0.1, y1 + 0.1, z + L], 0.5, LL.deck, 0.9, 0.16, 1, LMode.Chase, rnd);
        z += L + 2;
      } else if (k < 0.55) {
        // External pipe run along the belt.
        const L = 5 + rnd() * 10, yy = yBot + 0.6 + rnd() * (yTop - yBot - 1.2), m = Tm(x + sx * 0.25, yy, z).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
        lathe(c.bk, B.rail, [[0.18, 0], [0.18, Math.min(L, zb - 1 - z)]], 6, P.dark, m, false, 1);
        z += 1.5 + rnd() * 2;
      } else if (k < 0.8) {
        // Bolted access plate / armour patch.
        const L = 1.2 + rnd() * 2.5, h = 0.8 + rnd() * 1.6, yy = yBot + 0.4 + rnd() * (yTop - yBot - h - 0.6);
        box(c.bk, rnd() < 0.5 ? B.panels : B.brackets, 0.16, h, L, col(P.hull, 0.65 + rnd() * 0.3), Tm(x + sx * 0.06, yy + h / 2, z + L / 2));
        z += L + 0.5 + rnd() * 2;
      } else z += 1 + rnd() * 3;
    }
  }
}

/** Lettering from the stencil atlas laid flat on the deck (reads bow-up from the camera). */
export function stencil(bk: Buckets, text: string, cx: number, z: number, y: number, h: number, colr: THREE.Color, chars: string, cols: number, rows: number) {
  const w = h * 0.72, mb = bk.get('stencil');
  let x = cx - ((text.length - 1) * w) / 2;
  for (const ch of text.toUpperCase()) {
    const i = chars.indexOf(ch);
    if (i >= 0 && ch !== ' ') {
      const u0 = (i % cols) / cols, u1 = u0 + 1 / cols, v0 = Math.floor(i / cols) / rows, v1 = v0 + 1 / rows;
      // Canvas textures are flipped (flipY): v grows upward in the image.
      mb.quad([x - w / 2, y, z - h / 2], [x + w / 2, y, z - h / 2], [x + w / 2, y, z + h / 2], [x - w / 2, y, z + h / 2], [u0, 1 - v0], [u1, 1 - v0], [u1, 1 - v1], [u0, 1 - v1], colr, [0, 1, 0]);
    }
    x += w;
  }
}
void (null as unknown as V2);
