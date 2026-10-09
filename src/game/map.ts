// Slay-the-Spire-style branching sector map.
import { mulberry32, shuffle, weighted, pick, type Rng } from '../util/rng';
import { FIGHTS, ELITES } from '../data/enemies';

export type NodeType = 'fight' | 'elite' | 'merchant' | 'event' | 'derelict' | 'drydock' | 'boss';
export interface MapNode { id: string; floor: number; col: number; type: NodeType; next: string[]; jx: number; jy: number; enc?: string }
export interface SectorMap { sector: number; floors: number; cols: number; nodes: Record<string, MapNode>; bossId: string }

export const FLOORS = 10;
export const COLS = 7;
export const NODE_INFO: Record<NodeType, { label: string; desc: string }> = {
  fight: { label: 'Fight', desc: 'A standard engagement. Scrap and a part to choose.' },
  elite: { label: 'Elite', desc: 'A heavy unit with escorts. Hard, but drops a relic and better parts.' },
  merchant: { label: 'Merchant', desc: 'Buy parts, hull sections and relics. Sell spare parts. Repair.' },
  event: { label: 'Unknown signal', desc: 'Something is out there. Choices, risks, rewards.' },
  derelict: { label: 'Derelict', desc: 'An abandoned hulk. Holds a relic and loose scrap.' },
  drydock: { label: 'Drydock', desc: 'Repair, upgrade a part, or weld on a free section.' },
  boss: { label: 'Ghost Dreadnought', desc: 'The sector boss: the wreck of a pilot who died here.' },
};
const nid = (f: number, c: number) => `${f}-${c}`;

export function generateMap(sector: number, seed: number): SectorMap {
  const rng = mulberry32(seed ^ (sector * 0x9e3779b1));
  const nodes: Record<string, MapNode> = {};
  const edges: [number, number, number][] = []; // floor, fromCol, toCol
  const ensure = (f: number, c: number) => (nodes[nid(f, c)] ||= { id: nid(f, c), floor: f, col: c, type: 'fight', next: [], jx: (rng() - 0.5) * 0.5, jy: (rng() - 0.5) * 0.35 });
  const crosses = (f: number, a: number, b: number) => edges.some(([ef, ea, eb]) => ef === f && ((ea < a && eb > b) || (ea > a && eb < b)));

  const starts: number[] = [];
  for (let p = 0; p < 6; p++) {
    let c = p < 2 ? pickDistinct(starts, rng) : Math.floor(rng() * COLS);
    starts.push(c);
    ensure(0, c);
    for (let f = 0; f < FLOORS - 1; f++) {
      const cands = shuffle([c - 1, c, c + 1].filter((x) => x >= 0 && x < COLS), rng);
      const nc = cands.find((x) => !crosses(f, c, x)) ?? c;
      const from = ensure(f, c), to = ensure(f + 1, nc);
      if (!from.next.includes(to.id)) { from.next.push(to.id); edges.push([f, c, nc]); }
      c = nc;
    }
  }
  const boss: MapNode = { id: 'boss', floor: FLOORS, col: 3, type: 'boss', next: [], jx: 0, jy: 0 };
  nodes.boss = boss;
  for (const n of Object.values(nodes)) if (n.floor === FLOORS - 1) n.next = ['boss'];

  const parents = (n: MapNode) => Object.values(nodes).filter((p) => p.next.includes(n.id));
  const ordered = Object.values(nodes).filter((n) => n.type !== 'boss').sort((a, b) => a.floor - b.floor || a.col - b.col);
  for (const n of ordered) {
    if (n.floor === 0) { n.type = 'fight'; continue; }
    if (n.floor === 4) { n.type = 'derelict'; continue; }
    if (n.floor === FLOORS - 1) { n.type = 'drydock'; continue; }
    for (let tries = 0; tries < 12; tries++) {
      const w: Partial<Record<NodeType, number>> = { fight: 45, event: 22, merchant: n.floor >= 2 ? 8 : 0, elite: n.floor >= 3 ? 12 : 0, drydock: n.floor >= 3 && n.floor !== FLOORS - 2 ? 9 : 0 };
      const t = weighted(w, rng);
      const ps = parents(n);
      const clash = (t === 'elite' || t === 'merchant' || t === 'drydock') && ps.some((p) => p.type === t);
      const sibClash = ps.some((p) => p.next.some((id) => id !== n.id && nodes[id].type === t && t !== 'fight' && nodes[id].floor === n.floor));
      n.type = t;
      if (!clash && !sibClash) break;
    }
  }
  for (const n of ordered) {
    if (n.type === 'fight') n.enc = n.floor < 2 && sector === 1 ? 'patrol' : pick(FIGHTS, rng).id;
    if (n.type === 'elite') n.enc = pick(ELITES, rng).id;
  }
  return { sector, floors: FLOORS, cols: COLS, nodes, bossId: 'boss' };
}
function pickDistinct(taken: number[], rng: Rng) {
  for (let i = 0; i < 20; i++) { const c = Math.floor(rng() * COLS); if (!taken.includes(c)) return c; }
  return Math.floor(rng() * COLS);
}
export function reachable(map: SectorMap, at: string | null): string[] {
  if (at === null) return Object.values(map.nodes).filter((n) => n.floor === 0).map((n) => n.id);
  return map.nodes[at]?.next ?? [];
}
