import { svg } from './dom';
import { FLOORS, COLS, NODE_INFO, reachable, type NodeType, type SectorMap } from '../game/map';

const COL: Record<NodeType, string> = { fight: '#dbe4ec', elite: '#ff5a4e', merchant: '#f2a541', event: '#c9a6ff', derelict: '#4fd1e8', drydock: '#8fe39a', boss: '#ff5a4e' };

export function glyph(type: NodeType, size = 22): SVGGElement {
  const g = svg('g', { class: 'glyph', fill: 'none', stroke: COL[type], 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  const s = size / 24;
  const inner = svg('g', { transform: `scale(${s}) translate(-12 -12)` });
  const p = (d: string, fill = false) => inner.append(svg('path', { d, fill: fill ? COL[type] : 'none' }));
  switch (type) {
    case 'fight': p('M6 18 L18 6 M15 6 H18 V9 M6 6 L18 18 M6 15 V18 H9'); break;
    case 'elite': p('M4 8 L8 11 L12 4 L16 11 L20 8 L18 18 H6 Z'); p('M9 14 h0.01 M15 14 h0.01'); break;
    case 'merchant': p('M4 8 H20 V19 H4 Z M4 8 L7 4 H17 L20 8 M10 12 H14'); break;
    case 'event': inner.append(svg('text', { x: 12, y: 18, 'text-anchor': 'middle', 'font-size': 18, 'font-weight': 700, fill: COL[type], stroke: 'none', 'font-family': 'Chakra Petch, sans-serif' })); (inner.lastChild as SVGTextElement).textContent = '?'; break;
    case 'derelict': p('M12 3 L20 12 L12 21 L4 12 Z'); p('M12 8 L16 12 L12 16 L8 12 Z', true); break;
    case 'drydock': p('M14.5 4.5 a4 4 0 0 0 5 5 L11 18 a2.1 2.1 0 0 1 -3 -3 Z'); p('M5 19 l2 -2'); break;
    case 'boss': p('M12 3 L17 8 V16 L12 21 L7 16 V8 Z M7 11 H3 M17 11 H21 M10 14 H14'); break;
  }
  g.append(inner);
  return g;
}

export function mapView(map: SectorMap, at: string | null, visited: string[], onTravel: (id: string) => void, onHover: (id: string | null) => void): SVGSVGElement {
  const Wv = 700, rowH = 78, Hv = (FLOORS + 1) * rowH + 90;
  const pos = (id: string) => {
    const n = map.nodes[id];
    if (n.type === 'boss') return { x: Wv / 2, y: 56 };
    return { x: 60 + ((n.col + n.jx) * (Wv - 120)) / (COLS - 1), y: Hv - 50 - n.floor * rowH + n.jy * 20 };
  };
  const reach = new Set(reachable(map, at));
  const curFloor = at ? map.nodes[at].floor : -1;
  const root = svg('svg', { viewBox: `0 0 ${Wv} ${Hv}`, role: 'img', 'aria-label': `Sector ${map.sector} route map` });
  // background grid
  const bg = svg('g', { stroke: '#17212b', 'stroke-width': 1 });
  for (let y = 0; y < Hv; y += 39) bg.append(svg('line', { x1: 0, y1: y, x2: Wv, y2: y }));
  root.append(bg);
  const edges = svg('g');
  for (const n of Object.values(map.nodes)) for (const to of n.next) {
    const a = pos(n.id), b = pos(to);
    const walked = visited.includes(n.id) && visited.includes(to);
    const live = n.id === at && reach.has(to);
    edges.append(svg('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: walked ? '#4fd1e8' : live ? '#f2a541' : '#33424f', 'stroke-width': walked ? 3 : live ? 2.5 : 1.6, 'stroke-dasharray': walked ? null : live ? '7 5' : '3 6' }));
  }
  if (at === null) for (const id of reach) { const b = pos(id); edges.append(svg('line', { x1: b.x, y1: Hv, x2: b.x, y2: b.y, stroke: '#f2a541', 'stroke-width': 2, 'stroke-dasharray': '7 5' })); }
  root.append(edges);
  for (const n of Object.values(map.nodes)) {
    const { x, y } = pos(n.id), isBoss = n.type === 'boss', r = isBoss ? 34 : 19;
    const cls = ['node'];
    if (reach.has(n.id)) cls.push('reach');
    if (visited.includes(n.id)) cls.push('visited');
    if (n.id === at) cls.push('current');
    if (!reach.has(n.id) && !visited.includes(n.id) && n.floor <= curFloor) cls.push('past');
    const g = svg('g', { class: cls.join(' '), transform: `translate(${x} ${y})`, 'data-node': n.id, 'data-type': n.type, 'aria-label': `${NODE_INFO[n.type].label}, floor ${n.floor + 1}` });
    if (reach.has(n.id)) {
      g.setAttribute('tabindex', '0'); g.setAttribute('role', 'button');
      g.addEventListener('click', () => onTravel(n.id));
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTravel(n.id); } });
      g.append(svg('circle', { class: 'pulse', r }));
    }
    g.addEventListener('pointerenter', () => onHover(n.id)); g.addEventListener('pointerleave', () => onHover(null));
    g.addEventListener('focus', () => onHover(n.id));
    g.append(svg('circle', { class: 'base', r }));
    g.append(glyph(n.type, isBoss ? 40 : 22));
    root.append(g);
  }
  return root;
}
