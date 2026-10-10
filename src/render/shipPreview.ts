// 2D blueprint view of a ship, used on menus (refit, merchant, boss intel).
// Drawn at the same proportions as the 3D hull: plating, machinery and portholes at fine scale, and every
// weapon mount as the cluster of small guns it really is (dorsal barbettes, bow casemate, flank sponsons,
// ventral bays) with its traverse arc, so the drawing reads as a warship plan rather than a parts diagram.
import { WEAPONS, partDef, type Derived, type Rect } from '../data/parts';
import { has, mulberry32 } from '../util/rng';
import { mountTraverse, gunCount } from './ship/arcs';

const PTH = { hull: '#4b5968', edge: '#a9bccb', panel: '#33404c', deck: '#5d6e7f', glass: '#4fd1e8', fine: 'rgba(169,188,203,0.16)', light: '#ffcf8a' };
const BTH = { hull: '#3f2226', edge: '#ff6a5c', panel: '#5c2e33', deck: '#56303a', glass: '#ffcf5c', fine: 'rgba(255,106,92,0.16)', light: '#ff7a5c' };
type Theme = typeof PTH;

function hullPath(c: CanvasRenderingContext2D, r: Rect) {
  c.beginPath();
  if (r.type === 'bridge') { c.moveTo(r.x, r.y + r.h); c.lineTo(r.x, r.y + r.h * 0.5); c.lineTo(-r.w * 0.18, r.y); c.lineTo(r.w * 0.18, r.y); c.lineTo(r.x + r.w, r.y + r.h * 0.5); c.lineTo(r.x + r.w, r.y + r.h); }
  else { const k = r.type === 'battery' ? 5 : 3; c.moveTo(r.x + k, r.y); c.lineTo(r.x + r.w - k, r.y); c.lineTo(r.x + r.w, r.y + k); c.lineTo(r.x + r.w, r.y + r.h - k); c.lineTo(r.x + r.w - k, r.y + r.h); c.lineTo(r.x + k, r.y + r.h); c.lineTo(r.x, r.y + r.h - k); c.lineTo(r.x, r.y + k); }
  c.closePath();
}

/** Plating, machinery blocks and portholes inside one section (seeded by section, like the 3D greebles). */
function sectionDetail(c: CanvasRenderingContext2D, r: Rect, si: number, th: Theme, px: number) {
  const rnd = mulberry32(si * 7919 + r.type.length * 104729 + Math.round(r.w));
  c.save(); hullPath(c, r); c.clip();
  // Strakes and plate seams.
  c.strokeStyle = th.fine; c.lineWidth = px;
  for (let x = r.x + 4; x < r.x + r.w - 2; x += 7.5) { c.beginPath(); c.moveTo(x, r.y); c.lineTo(x, r.y + r.h); c.stroke(); }
  for (let x = r.x + 4, k = 0; x < r.x + r.w - 2; x += 7.5, k++) for (let y = r.y + rnd() * 9; y < r.y + r.h; y += 7 + rnd() * 11) { c.beginPath(); c.moveTo(x, y); c.lineTo(x + 7.5, y); c.stroke(); }
  // Inner deck edge (gallery terrace).
  c.strokeStyle = th.panel; c.lineWidth = px * 1.4; c.strokeRect(r.x + 4.5, r.y + 0.5, r.w - 9, r.h - 1);
  // Machinery: small filled blocks with a lit edge here and there.
  // Machinery: drafted as thin outlines (a plan, not a photo), a few filled, the odd lit edge.
  const n = Math.round((r.w * r.h) / 60);
  c.lineWidth = px * 0.8; c.strokeStyle = th.edge;
  for (let i = 0; i < n; i++) {
    const w = 1.2 + rnd() * 4.5, h = 1.2 + rnd() * 4.5, x = r.x + 6 + rnd() * (r.w - 12 - w), y = r.y + 1.5 + rnd() * (r.h - 3 - h);
    if (rnd() < 0.3) { c.fillStyle = th.panel; c.globalAlpha = 0.6; c.fillRect(x, y, w, h); }
    c.globalAlpha = 0.28; c.strokeRect(x, y, w, h);
    if (rnd() < 0.12) { c.fillStyle = th.light; c.globalAlpha = 0.7; c.fillRect(x, y + h - px, w, px); }
  }
  c.globalAlpha = 1; c.restore();
  // Portholes along both sides.
  c.fillStyle = th.light;
  for (let y = r.y + 1; y < r.y + r.h - 0.5; y += 1.3) for (const sx of [-1, 1]) if (rnd() < 0.55) { c.globalAlpha = 0.35 + rnd() * 0.5; c.fillRect(sx * (r.w / 2 - 1.2) - px * 0.6, y, px * 1.2, px * 1.2); }
  c.globalAlpha = 1;
}

export function drawBlueprint(canvas: HTMLCanvasElement, dv: Derived, hostile = false, highlight: { si: number; i: number } | null = null) {
  const c = canvas.getContext('2d')!, w = canvas.width, h = canvas.height, th = hostile ? BTH : PTH;
  c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#0a0e13'; c.fillRect(0, 0, w, h);
  c.strokeStyle = '#17212b'; c.lineWidth = 1;
  for (let x = 0; x <= w; x += 32) { c.beginPath(); c.moveTo(x + 0.5, 0); c.lineTo(x + 0.5, h); c.stroke(); }
  for (let y = 0; y <= h; y += 32) { c.beginPath(); c.moveTo(0, y + 0.5); c.lineTo(w, y + 0.5); c.stroke(); }
  const s = Math.min(5, (h - 60) / dv.len, (w - 60) / dv.width), px = 1 / s;
  c.save(); c.translate(w / 2, h / 2); if (hostile) c.scale(s, -s); else c.scale(s, s);
  c.lineWidth = 1.2 * px;
  dv.rects.forEach((r, si) => {
    c.fillStyle = th.hull; c.strokeStyle = th.edge; hullPath(c, r); c.fill(); c.stroke();
    sectionDetail(c, r, si, th, px);
    if (r.type === 'bridge') {
      // Stepped bridge tower with lit window bands.
      const a = Math.min(r.w * 0.27, 26), t0 = r.y + r.h / 2 + 9;
      for (const [k, y0, y1] of [[1, t0, r.y + r.h - 1], [0.72, t0 + 3, r.y + r.h - 3], [0.45, t0 + 5, r.y + r.h - 8]] as const) {
        c.fillStyle = th.panel; c.strokeStyle = th.edge; c.fillRect(-a * k, y0, a * k * 2, y1 - y0); c.strokeRect(-a * k, y0, a * k * 2, y1 - y0);
        c.fillStyle = th.glass; c.globalAlpha = 0.6; c.fillRect(-a * k + 1, y0 + 0.6, a * k * 2 - 2, px * 1.5); c.globalAlpha = 1;
      }
    }
    if (r.type === 'engine') { c.fillStyle = '#ffb347'; for (const sx of [-0.22, 0.22]) c.fillRect(r.w * sx - 2.5, r.y + r.h, 5, 3); }
    if (si > 0) { c.strokeStyle = th.edge; c.globalAlpha = 0.5; c.beginPath(); c.moveTo(r.x + 3, r.y); c.lineTo(r.x + r.w - 3, r.y); c.stroke(); c.globalAlpha = 1; }
  });
  for (const m of dv.mounts) {
    const p = m.part, hl = highlight && highlight.si === m.si && highlight.i === m.i;
    if (!p) { c.strokeStyle = hl ? '#4fd1e8' : th.panel; c.setLineDash([2, 2]); c.beginPath(); c.arc(m.ox, m.oy, 3.8, 0, Math.PI * 2); c.stroke(); c.setLineDash([]); continue; }
    const col = partDef(p.id).col;
    if (has(WEAPONS, p.id)) drawMount(c, dv, m, col, th, px, !!hl);
    else { c.save(); c.translate(m.ox, m.oy); c.rotate(Math.PI / 4); c.fillStyle = col; c.globalAlpha = 0.85; c.fillRect(-3.2, -3.2, 6.4, 6.4); c.globalAlpha = 1; c.strokeStyle = hl ? '#4fd1e8' : th.edge; c.strokeRect(-3.2, -3.2, 6.4, 6.4); c.restore(); }
  }
  c.restore();
}

/** A weapon mount: its traverse arc, its static dressing and its cluster of small guns. */
function drawMount(c: CanvasRenderingContext2D, dv: Derived, m: Derived['mounts'][number], col: string, th: Theme, px: number, hl: boolean) {
  const p = m.part!, tv = mountTraverse(m, dv.rects[m.si].type), n = gunCount(p.id, p.tier);
  const dir = (a: number): [number, number] => [-Math.sin(a), -Math.cos(a)];
  // Traverse arc, faint (bright when the slot is hovered).
  // Sectors are in ship space (0 = bow, +PI/2 = starboard); on the canvas the bow is up (-y).
  if (tv.half > 0) for (const sec of tv.game.sectors) {
    const R = hl ? 46 : 26, a0 = sec.c - Math.PI / 2;
    c.fillStyle = col; c.globalAlpha = hl ? 0.22 : 0.08; c.beginPath(); c.moveTo(m.ox, m.oy);
    if (sec.h >= Math.PI) c.arc(m.ox, m.oy, R * 0.6, 0, Math.PI * 2); else c.arc(m.ox, m.oy, R, a0 - sec.h, a0 + sec.h);
    c.closePath(); c.fill(); c.globalAlpha = 1;
  }
  const gun = (x: number, y: number, a: number, size: number, barrels: number, len: number) => {
    c.fillStyle = th.panel; c.strokeStyle = hl ? '#4fd1e8' : th.edge; c.lineWidth = px;
    c.beginPath(); c.arc(x, y, size, 0, Math.PI * 2); c.fill(); c.stroke();
    const [dx, dy] = dir(a), nx = -dy, ny = dx;
    c.strokeStyle = col; c.lineWidth = Math.max(px, 0.35);
    for (let b = 0; b < barrels; b++) { const o = (b - (barrels - 1) / 2) * size * 0.55; c.beginPath(); c.moveTo(x + nx * o + dx * size * 0.6, y + ny * o + dy * size * 0.6); c.lineTo(x + nx * o + dx * (size + len), y + ny * o + dy * (size + len)); c.stroke(); }
  };
  const barrels = p.id === 'flak' ? 4 : p.id === 'spread' ? 3 : p.id === 'pd' || p.id === 'rail' || p.id === 'missile' ? 1 : 2;
  const len = p.id === 'rail' ? 12 : p.id === 'missile' ? 1 : 3.5;
  c.lineWidth = px;
  if (p.id === 'bomb') {
    const nb = p.tier >= 3 ? 2 : 1;
    for (let b = 0; b < nb; b++) { const bx = m.ox + (nb > 1 ? (b ? 1 : -1) * 3 : 0); c.fillStyle = '#05070a'; c.fillRect(bx - 2.2, m.oy - 3.2, 4.4, 6.5); c.strokeStyle = col; c.strokeRect(bx - 2.2, m.oy - 3.2, 4.4, 6.5); c.beginPath(); c.moveTo(bx, m.oy - 3.2); c.lineTo(bx, m.oy + 3.3); c.stroke(); }
    if (hl) { c.strokeStyle = '#4fd1e8'; c.strokeRect(m.ox - 7, m.oy - 5, 14, 10); }
    return;
  }
  if (tv.kind === 'side') {
    const sd = m.ox < 0 ? -1 : 1, sp = 4.4, x = sd * (dv.rects[m.si].w / 2 * 0.9 - 0.2), L = (n - 1) * sp + 4.6;
    c.fillStyle = th.deck; c.strokeStyle = th.edge; c.fillRect(Math.min(x - sd * 4, x + sd * 3), m.oy - L / 2, 7, L); c.strokeRect(Math.min(x - sd * 4, x + sd * 3), m.oy - L / 2, 7, L);
    for (let i = 0; i < n; i++) gun(x, m.oy - L / 2 + 2.3 + i * sp, tv.center, 1.5, barrels, len);
  } else if (tv.kind === 'bow') {
    const nn = p.id === 'rail' ? Math.max(1, n) : n + 1, sp = 2.6, W = (nn - 1) * sp / 2 + 2.2;
    c.fillStyle = th.deck; c.strokeStyle = th.edge; c.beginPath(); c.moveTo(m.ox - W * 0.75, m.oy - 3.8); c.lineTo(m.ox + W * 0.75, m.oy - 3.8); c.lineTo(m.ox + W, m.oy - 1); c.lineTo(m.ox + W, m.oy + 3.8); c.lineTo(m.ox - W, m.oy + 3.8); c.lineTo(m.ox - W, m.oy - 1); c.closePath(); c.fill(); c.stroke();
    for (let i = 0; i < nn; i++) gun(m.ox + (i - (nn - 1) / 2) * sp, m.oy - 3.2, 0, 0.9, 1, p.id === 'rail' ? 12 : 3);
  } else if (p.id === 'pd') {
    for (let i = 0; i < n + 1; i++) { const a = (i / (n + 1)) * Math.PI * 2 + 0.4; gun(m.ox + Math.cos(a) * 3.3, m.oy + Math.sin(a) * 3.3, a, 1.1, 1, 1.6); }
  } else if (p.id === 'tesla') {
    gun(m.ox, m.oy, 0, 2.6, 0, 0); c.fillStyle = col; c.beginPath(); c.arc(m.ox, m.oy, 1.1, 0, Math.PI * 2); c.fill();
  } else {
    const sp = p.id === 'rail' ? 9.8 : p.id === 'artillery' ? 6.6 : 5.4, sz = p.id === 'artillery' ? 2.8 : 2.1;
    const pos: [number, number][] = n === 4 ? [[-2.8, -2.8], [2.8, -2.8], [-2.8, 2.8], [2.8, 2.8]] : Array.from({ length: n }, (_, i) => [0, (i - (n - 1) / 2) * sp] as [number, number]);
    for (const [dx, dy] of pos) gun(m.ox + dx, m.oy + dy, tv.center, sz, barrels, len);
  }
}
