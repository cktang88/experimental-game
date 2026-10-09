import { describe, it, expect } from 'vitest';
import { generateMap, reachable, FLOORS } from '../../src/game/map';

const seeds = Array.from({ length: 60 }, (_, i) => 1000 + i * 7919);

describe('sector map', () => {
  it('is deterministic per seed and sector', () => {
    expect(JSON.stringify(generateMap(2, 42))).toBe(JSON.stringify(generateMap(2, 42)));
    expect(JSON.stringify(generateMap(1, 42))).not.toBe(JSON.stringify(generateMap(2, 42)));
  });
  for (const seed of seeds.slice(0, 20)) it(`seed ${seed}: every node is on a path from floor 1 to the boss`, () => {
    const m = generateMap(1 + (seed % 3), seed);
    const fromStart = new Set<string>();
    const stack = reachable(m, null).slice();
    while (stack.length) { const id = stack.pop()!; if (fromStart.has(id)) continue; fromStart.add(id); stack.push(...m.nodes[id].next); }
    for (const id of Object.keys(m.nodes)) expect(fromStart.has(id), `node ${id} unreachable`).toBe(true);
    for (const n of Object.values(m.nodes)) if (n.type !== 'boss') expect(n.next.length, `node ${n.id} is a dead end`).toBeGreaterThan(0);
    expect(fromStart.has('boss')).toBe(true);
  });
  it('follows floor rules', () => {
    for (const seed of seeds) {
      const m = generateMap(1, seed);
      for (const n of Object.values(m.nodes)) {
        if (n.floor === 0) expect(n.type).toBe('fight');
        if (n.floor === 4) expect(n.type).toBe('derelict');
        if (n.floor === FLOORS - 1) expect(n.type).toBe('drydock');
        if (n.type === 'elite') expect(n.floor).toBeGreaterThanOrEqual(3);
        if (n.type === 'fight' || n.type === 'elite') expect(n.enc).toBeTruthy();
        for (const to of n.next) expect(m.nodes[to].floor).toBe(n.floor + 1);
      }
    }
  });
  it('never draws crossing paths between two floors', () => {
    for (const seed of seeds) {
      const m = generateMap(1, seed);
      const edges = Object.values(m.nodes).flatMap((n) => n.next.filter((t) => t !== 'boss').map((t) => [n.floor, n.col, m.nodes[t].col]));
      for (const [f, a, b] of edges) for (const [f2, a2, b2] of edges) if (f === f2) expect((a < a2 && b > b2) || (a > a2 && b < b2)).toBe(false);
    }
  });
  it('offers a mix of node types across a sector', () => {
    const counts: Record<string, number> = {};
    for (const seed of seeds) for (const n of Object.values(generateMap(1, seed).nodes)) counts[n.type] = (counts[n.type] || 0) + 1;
    for (const t of ['fight', 'elite', 'merchant', 'event', 'derelict', 'drydock', 'boss']) expect(counts[t], t).toBeGreaterThan(0);
  });
});
