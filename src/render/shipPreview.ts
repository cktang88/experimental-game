// 2D blueprint view of a ship, used on menus (refit, merchant, boss intel).
import { WEAPONS, partDef, type Derived } from '../data/parts';
import { has } from '../util/rng';

const PTH = { hull: '#4b5968', edge: '#a9bccb', panel: '#33404c', deck: '#5d6e7f', glass: '#4fd1e8' };
const BTH = { hull: '#3f2226', edge: '#ff6a5c', panel: '#5c2e33', deck: '#56303a', glass: '#ffcf5c' };

export function drawBlueprint(canvas: HTMLCanvasElement, dv: Derived, hostile = false, highlight: { si: number; i: number } | null = null) {
  const c = canvas.getContext('2d')!, w = canvas.width, h = canvas.height, th = hostile ? BTH : PTH;
  c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#0a0e13'; c.fillRect(0, 0, w, h);
  c.strokeStyle = '#17212b'; c.lineWidth = 1;
  for (let x = 0; x <= w; x += 32) { c.beginPath(); c.moveTo(x + 0.5, 0); c.lineTo(x + 0.5, h); c.stroke(); }
  for (let y = 0; y <= h; y += 32) { c.beginPath(); c.moveTo(0, y + 0.5); c.lineTo(w, y + 0.5); c.stroke(); }
  const s = Math.min(5, (h - 60) / dv.len, (w - 60) / dv.width);
  c.save(); c.translate(w / 2, h / 2); if (hostile) c.scale(s, -s); else c.scale(s, s);
  c.lineWidth = 1.2 / s;
  for (const r of dv.rects) {
    c.fillStyle = th.hull; c.strokeStyle = th.edge; c.beginPath();
    if (r.type === 'bridge') { c.moveTo(r.x, r.y + r.h); c.lineTo(r.x, r.y + r.h * 0.5); c.lineTo(-r.w * 0.18, r.y); c.lineTo(r.w * 0.18, r.y); c.lineTo(r.x + r.w, r.y + r.h * 0.5); c.lineTo(r.x + r.w, r.y + r.h); }
    else { const k = r.type === 'battery' ? 5 : 3; c.moveTo(r.x + k, r.y); c.lineTo(r.x + r.w - k, r.y); c.lineTo(r.x + r.w, r.y + k); c.lineTo(r.x + r.w, r.y + r.h - k); c.lineTo(r.x + r.w - k, r.y + r.h); c.lineTo(r.x + k, r.y + r.h); c.lineTo(r.x, r.y + r.h - k); c.lineTo(r.x, r.y + k); }
    c.closePath(); c.fill(); c.stroke();
    if (r.type === 'bridge') { c.fillStyle = th.glass; c.fillRect(-5, r.y + r.h * 0.38, 10, 3.5); }
    if (r.type === 'engine') { c.fillStyle = '#ffb347'; for (const sx of [-0.22, 0.22]) c.fillRect(r.w * sx - 2.5, r.y + r.h, 5, 3); }
  }
  for (const m of dv.mounts) {
    const p = m.part, hl = highlight && highlight.si === m.si && highlight.i === m.i;
    if (!p) { c.strokeStyle = hl ? '#4fd1e8' : th.panel; c.setLineDash([2, 2]); c.beginPath(); c.arc(m.ox, m.oy, 3.8, 0, Math.PI * 2); c.stroke(); c.setLineDash([]); continue; }
    const col = partDef(p.id).col;
    if (has(WEAPONS, p.id)) {
      c.strokeStyle = col; c.lineWidth = 2; c.beginPath(); c.moveTo(m.ox, m.oy); c.lineTo(m.ox, m.oy - (p.id === 'rail' ? 13 : 8)); c.stroke(); c.lineWidth = 1.2 / s;
      c.fillStyle = th.panel; c.strokeStyle = hl ? '#4fd1e8' : th.edge; c.beginPath(); c.arc(m.ox, m.oy, 4.2, 0, Math.PI * 2); c.fill(); c.stroke();
      c.fillStyle = col; c.beginPath(); c.arc(m.ox, m.oy, 1.6 + p.tier * 0.25, 0, Math.PI * 2); c.fill();
    } else { c.save(); c.translate(m.ox, m.oy); c.rotate(Math.PI / 4); c.fillStyle = col; c.fillRect(-3.2, -3.2, 6.4, 6.4); c.restore(); }
  }
  c.restore();
}
