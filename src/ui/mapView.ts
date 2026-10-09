// The sector route as a plotting-table chart: grid paper, floor ticks, grease-pencil route, military-style
// node symbols (hostile diamonds, neutral squares, unknown quatrefoils, friendly circles) with game-icons glyphs.
// Landscape on wide screens (launch at the left, the ghost at the right), portrait on phones.
import { svg, hash } from './h';
import { iconG, NODE_ICON } from './icons';
import { FLOORS, COLS, NODE_INFO, reachable, type NodeType, type SectorMap } from '../game/map';

export const NODE_COL: Record<NodeType, string> = { fight: '#c9d3dc', elite: '#ff5a4e', merchant: '#f2a541', event: '#c9a6ff', derelict: '#4fd1e8', drydock: '#8fe39a', boss: '#ff5a4e' };
type Frame = 'hostile' | 'neutral' | 'unknown' | 'friend';
const FRAME: Record<NodeType, Frame> = { fight: 'hostile', elite: 'hostile', boss: 'hostile', merchant: 'neutral', derelict: 'neutral', event: 'unknown', drydock: 'friend' };

function framePath(f: Frame, r: number) {
  switch (f) {
    case 'hostile': return `M0 ${-r * 1.18}L${r * 1.18} 0 0 ${r * 1.18}${-r * 1.18} 0Z`;
    case 'neutral': return `M${-r * 0.92} ${-r * 0.92}H${r * 0.92}V${r * 0.92}H${-r * 0.92}Z`;
    case 'friend': return `M${r} 0A${r} ${r} 0 1 1 ${-r} 0A${r} ${r} 0 1 1 ${r} 0Z`;
    case 'unknown': { const k = r * 0.52, o = r * 0.5; return `M${-o} ${-o}A${k} ${k} 0 0 1 ${o} ${-o}A${k} ${k} 0 0 1 ${o} ${o}A${k} ${k} 0 0 1 ${-o} ${o}A${k} ${k} 0 0 1 ${-o} ${-o}Z`; }
  }
}

/** A node symbol: frame + glyph, centred on (0,0). Used by the chart and its legend. */
export function glyph(type: NodeType, size = 22): SVGGElement {
  const r = size * 0.62;
  const g = svg('g', { class: `sym ${FRAME[type]}`, style: `--c:${NODE_COL[type]}` });
  g.append(svg('path', { class: 'frame', d: framePath(FRAME[type], r) }));
  g.append(iconG(NODE_ICON[type], size * (FRAME[type] === 'hostile' ? 0.86 : 0.9), { class: 'glyph' }));
  return g;
}

/** A hand-drawn feeling stroke between two points: a gentle bow whose side and depth come from the ids. */
function pencil(a: { x: number; y: number }, b: { x: number; y: number }, seed: string) {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  const bow = (hash(seed) - 0.5) * Math.min(14, len * 0.12);
  return `M${a.x.toFixed(1)} ${a.y.toFixed(1)}Q${(mx - (dy / len) * bow).toFixed(1)} ${(my + (dx / len) * bow).toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}
/** A loose grease-pencil ring (two overlapping passes that don't quite close). */
function ring(r: number, seed: string) {
  const a0 = hash(seed) * 6.28, pts: string[] = [];
  for (let i = 0; i <= 26; i++) {
    const a = a0 + (i / 22) * Math.PI * 2, rr = r * (1 + (hash(seed + i) - 0.5) * 0.08) + i * 0.12;
    pts.push(`${(Math.cos(a) * rr).toFixed(1)} ${(Math.sin(a) * rr * 0.94).toFixed(1)}`);
  }
  return 'M' + pts.join('L');
}

export function mapView(map: SectorMap, at: string | null, visited: string[], onTravel: (id: string) => void, onHover: (id: string | null) => void, callsign = ''): SVGSVGElement {
  const wide = typeof window !== 'undefined' && window.innerWidth >= 900 && window.innerWidth / Math.max(1, window.innerHeight) > 1.15;
  const floors = map.floors ?? FLOORS, cols = map.cols ?? COLS;
  const Wv = wide ? 1180 : 700, Hv = wide ? 660 : (floors + 1) * 78 + 110;
  const pos = (id: string) => {
    const n = map.nodes[id];
    if (wide) {
      if (n.type === 'boss') return { x: Wv - 86, y: Hv / 2 };
      return { x: 96 + n.floor * ((Wv - 290) / (floors - 1)) + n.jy * 26, y: 76 + ((n.col + n.jx) * (Hv - 152)) / (cols - 1) };
    }
    if (n.type === 'boss') return { x: Wv / 2, y: 70 };
    return { x: 60 + ((n.col + n.jx) * (Wv - 120)) / (cols - 1), y: Hv - 60 - n.floor * 78 + n.jy * 20 };
  };
  const reach = new Set(reachable(map, at));
  const curFloor = at ? map.nodes[at].floor : -1;
  const root = svg('svg', { class: 'chart-svg' + (wide ? ' wide' : ''), viewBox: `0 0 ${Wv} ${Hv}`, preserveAspectRatio: 'xMidYMid meet', role: 'img', 'aria-label': `Sector ${map.sector} route map` });

  // defs: grease-pencil roughness
  root.append(svg('defs', {},
    svg('filter', { id: 'grease', x: '-5%', y: '-5%', width: '110%', height: '110%' },
      svg('feTurbulence', { type: 'fractalNoise', baseFrequency: 0.9, numOctaves: 2, seed: map.sector, result: 'n' }),
      svg('feDisplacementMap', { in: 'SourceGraphic', in2: 'n', scale: 2.2 })),
  ));
  // chart paper: minor and major grid, floor ticks
  const grid = svg('g', { class: 'grid' });
  for (let x = 0; x <= Wv; x += 20) grid.append(svg('line', { x1: x, y1: 0, x2: x, y2: Hv, class: x % 100 === 0 ? 'major' : null }));
  for (let y = 0; y <= Hv; y += 20) grid.append(svg('line', { x1: 0, y1: y, x2: Wv, y2: y, class: y % 100 === 0 ? 'major' : null }));
  root.append(grid);
  const ticks = svg('g', { class: 'ticks' });
  for (let f = 0; f < floors; f++) {
    const p = wide ? { x: 96 + f * ((Wv - 290) / (floors - 1)), y: 0 } : { x: 0, y: Hv - 60 - f * 78 };
    const label = svg('text', wide ? { x: p.x, y: 22, 'text-anchor': 'middle' } : { x: 10, y: p.y + 4 });
    label.textContent = `FL${String(f + 1).padStart(2, '0')}`;
    ticks.append(wide ? svg('line', { x1: p.x, y1: 30, x2: p.x, y2: 38 }) : svg('line', { x1: 0, y1: p.y, x2: 6, y2: p.y }), label);
    if (f === curFloor + 1) ticks.append(svg('rect', { class: 'tick-now', x: wide ? p.x - 22 : 2, y: wide ? 8 : p.y - 9, width: wide ? 44 : 44, height: 20 }));
  }
  root.append(ticks);
  // compass rose and plot stamp
  const rose = svg('g', { class: 'rose', transform: wide ? `translate(${Wv - 70} ${Hv - 64})` : `translate(${Wv - 54} ${Hv - 40})` });
  rose.append(svg('circle', { r: 22 }), svg('path', { d: 'M0 -30L5 0 0 30-5 0Z' }), svg('path', { class: 'n', d: 'M0 -30L5 0H-5Z' }));
  const nl = svg('text', { y: -34, 'text-anchor': 'middle' }); nl.textContent = 'N'; rose.append(nl);
  root.append(rose);

  // routes
  const edges = svg('g', { class: 'routes' });
  const live = svg('g', { class: 'routes live' });
  const walked = svg('g', { class: 'routes walked', filter: 'url(#grease)' });
  for (const n of Object.values(map.nodes)) for (const to of n.next) {
    const a = pos(n.id), b = pos(to), d = pencil(a, b, n.id + to);
    if (visited.includes(n.id) && visited.includes(to)) walked.append(svg('path', { d }));
    else if (n.id === at && reach.has(to)) live.append(svg('path', { d }));
    else edges.append(svg('path', { d }));
  }
  const launch = wide ? (id: string) => ({ x: 18, y: pos(id).y }) : (id: string) => ({ x: pos(id).x, y: Hv - 8 });
  if (at === null) for (const id of reach) live.append(svg('path', { d: pencil(launch(id), pos(id), 'L' + id) }));
  else if (visited.length) { const f = visited[0]; walked.prepend(svg('path', { d: pencil(launch(f), pos(f), 'L' + f) })); }
  root.append(edges, walked, live);

  // nodes
  for (const n of Object.values(map.nodes)) {
    const { x, y } = pos(n.id), isBoss = n.type === 'boss', size = isBoss ? 50 : 30, r = isBoss ? 42 : 24;
    const cls = ['node', n.type];
    if (reach.has(n.id)) cls.push('reach');
    if (visited.includes(n.id)) cls.push('visited');
    if (n.id === at) cls.push('current');
    if (!reach.has(n.id) && !visited.includes(n.id) && n.floor <= curFloor && !isBoss) cls.push('past');
    const g = svg('g', { class: cls.join(' '), transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})`, 'data-node': n.id, 'data-type': n.type, 'aria-label': `${NODE_INFO[n.type].label}, floor ${n.floor + 1}` });
    if (reach.has(n.id)) {
      g.setAttribute('tabindex', '0'); g.setAttribute('role', 'button');
      g.addEventListener('click', () => onTravel(n.id));
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTravel(n.id); } });
      g.append(svg('circle', { class: 'pulse', r: r + 2 }));
      g.append(svg('path', { class: 'ring', d: ring(r + 9, n.id), filter: 'url(#grease)' }));
    }
    g.addEventListener('pointerenter', () => onHover(n.id)); g.addEventListener('pointerleave', () => onHover(null));
    g.addEventListener('focus', () => onHover(n.id)); g.addEventListener('blur', () => onHover(null));
    g.append(svg('circle', { class: 'base', r }));
    g.append(glyph(n.type, size));
    if (visited.includes(n.id) && n.id !== at) g.append(svg('path', { class: 'strike', d: `M${-r * 0.9} ${r * 0.7}L${r * 0.9} ${-r * 0.7}`, filter: 'url(#grease)' }));
    if (isBoss) { const t = svg('text', { class: 'boss-tag', y: r + 26, 'text-anchor': 'middle' }); t.textContent = 'GHOST'; g.append(t); }
    root.append(g);
  }
  // you-are-here: the dreadnought marker and callsign tag
  const rs = [...reach].map(pos), avg = (k: 'x' | 'y') => rs.reduce((a, p) => a + p[k], 0) / Math.max(1, rs.length);
  const here = at ? pos(at) : wide ? { x: 26, y: rs.length ? avg('y') : Hv / 2 } : { x: rs.length ? avg('x') : Wv / 2, y: Hv - 18 };
  const mk = svg('g', { class: 'here', transform: `translate(${here.x.toFixed(1)} ${here.y.toFixed(1)})` });
  const rot = wide ? 90 : 0;
  mk.append(svg('path', { d: 'M0 -15L8 4 0 0-8 4Z', transform: `rotate(${rot}) translate(0 ${at ? 34 : 0})` }));
  if (callsign) {
    const tx = svg('text', { x: wide ? (at ? 0 : -8) : 14, y: wide ? (at ? -40 : -16) : (at ? -30 : 4), 'text-anchor': wide && at ? 'middle' : 'start' });
    tx.textContent = callsign; mk.append(tx);
  }
  root.append(mk);
  return root;
}
