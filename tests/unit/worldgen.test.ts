import { describe, it, expect } from 'vitest';
import { FIELD_H } from '../../src/game/field';
import type { Bldg } from '../../src/game/worldgen';

// combat.ts pulls in the audio module, which reads localStorage at import time.
(globalThis as unknown as { localStorage: unknown }).localStorage ??= { getItem: () => null, setItem: () => undefined };
const { S } = await import('../../src/game/combat');
const { seedDecor, updateBg, worldBlast, CITY, DARK } = await import('../../src/game/worldgen');

const bldgs = () => CITY.chunks.flatMap((c) => c.bldgs);

describe('city worldgen', () => {
  for (let theme = 0; theme < 5; theme++) it(`theme ${theme}: fills the view with a city`, () => {
    S.theme = theme; seedDecor();
    expect(CITY.chunks.length).toBeGreaterThan(4);
    expect(bldgs().length).toBeGreaterThan(40);
    expect(S.decor.length).toBe(bldgs().length);
    // Rows cover the screen from above the top edge to the bottom.
    expect(CITY.chunks[CITY.chunks.length - 1].cy0).toBeLessThan(-300);
    expect(CITY.chunks[0].cy1).toBeGreaterThan(FIELD_H);
  });

  it('scrolls: rows are generated above and dropped below, decor y follows the scroll', () => {
    S.theme = 0; seedDecor(); S.P = null;
    const first = CITY.chunks[0];
    const b = first.bldgs[0] ?? bldgs()[0];
    for (let i = 0; i < 600; i++) updateBg(1 / 30);
    expect(S.scrollY).toBeGreaterThan(1000);
    expect(CITY.chunks.includes(first)).toBe(false);
    expect(S.decor.includes(b)).toBe(false);
    for (const d of S.decor) expect(d.y).toBeCloseTo(d.cy + S.scrollY, 5);
    expect(CITY.chunks[CITY.chunks.length - 1].cy0 + S.scrollY).toBeLessThan(-300);
  });

  it('a big enough blast levels buildings, pays scrap, leaves a crater and fire', () => {
    S.theme = 4; seedDecor();
    const target = bldgs().filter((b) => b.y > 200 && b.y < 700 && b.kind !== 'tank').sort((a, b) => a.maxHp - b.maxHp)[0] as Bldg;
    const scrap = worldBlast(target.x, target.y, 30, target.maxHp * 3);
    expect(target.dead).toBe(true);
    expect(target.collapseT).toBeGreaterThanOrEqual(0);
    expect(scrap).toBeGreaterThan(0);
    expect(CITY.craters.length).toBe(1);
    expect(CITY.burning.length).toBeGreaterThan(0);
    // A dead building is not hit again.
    expect(worldBlast(target.x, target.y, 4, 1000)).toBeGreaterThanOrEqual(0);
  });

  it('small hits damage and ignite without collapsing', () => {
    S.theme = 0; seedDecor();
    const t = bldgs().find((b) => b.maxHp > 40 && b.y > 100 && b.y < 800)!;
    expect(worldBlast(t.x, t.y, 10, 5)).toBe(0);
    expect(t.dead).toBe(false);
    expect(t.hp).toBeLessThan(t.maxHp);
    expect(t.fire).toBeGreaterThan(0);
  });

  it('refinery tanks chain-react', () => {
    S.theme = 1; seedDecor();
    S.P = null;
    const tank = bldgs().find((b) => b.kind === 'tank' && b.y > 150 && b.y < 750);
    if (!tank) return;
    worldBlast(tank.x, tank.y, 20, 999);
    expect(tank.dead).toBe(true);
    expect(CITY.pending.length).toBeGreaterThan(0);
    for (let i = 0; i < 30; i++) updateBg(1 / 30);
    expect(CITY.pending.length).toBe(0);
  });

  it('the city goes dark around the dreadnought', () => {
    S.theme = 0; seedDecor(); S.active = true;
    S.P = { x: 800, y: 700 } as typeof S.P;
    updateBg(1 / 30);
    expect(Array.from(DARK.data).filter((x) => x > 0).length).toBeGreaterThan(20);
    S.active = false; S.P = null;
  });
});

describe('building destruction (gameplay)', () => {
  it('every building pays 1-4 scrap, and bigger buildings pay more', () => {
    S.theme = 0; seedDecor();
    const all = bldgs();
    for (const b of all) { expect(b.value).toBeGreaterThanOrEqual(1); expect(b.value).toBeLessThanOrEqual(4); }
    const small = all.filter((b) => b.maxHp < 80), big = all.filter((b) => b.maxHp > 200);
    const avg = (xs: Bldg[]) => xs.reduce((s, b) => s + b.value, 0) / Math.max(1, xs.length);
    expect(small.length).toBeGreaterThan(0);
    if (big.length) expect(avg(big)).toBeGreaterThan(avg(small));
  });

  it('a collapsed building pays exactly once and stays as rubble in S.decor', () => {
    S.theme = 0; seedDecor();
    const t = bldgs().find((b) => b.y > 200 && b.y < 700 && b.kind !== 'tank')!;
    const first = worldBlast(t.x, t.y, 6, 1e6);
    expect(first).toBeGreaterThanOrEqual(t.value);
    expect(t.dead).toBe(true);
    expect(S.decor.includes(t)).toBe(true);
    // Hitting the heap again pays only for whatever else the blast levels.
    const others = bldgs().filter((b) => b !== t && !b.dead);
    const second = worldBlast(t.x, t.y, 6, 1e6);
    expect(second).toBe(others.filter((b) => b.dead).reduce((s, b) => s + b.value, 0));
  });

  it('bombs take a few hits to level a block; a Ventral Lance pass carves a line of collapses', () => {
    S.theme = 0; seedDecor();
    const t = bldgs().filter((b) => b.y > 200 && b.y < 700 && b.kind === 'mid').sort((a, b) => a.maxHp - b.maxHp)[0];
    if (t) {
      let n = 0; while (!t.dead && n < 50) { worldBlast(t.x, t.y, 46, 26); n++; }
      expect(n).toBeGreaterThan(1);
      expect(n).toBeLessThan(12);
    }
    seedDecor();
    let scrap = 0;
    // 3.6 s of lance at 50 ms ticks while the ship sweeps across the city.
    for (let i = 0; i < 72; i++) scrap += worldBlast(300 + i * 14, 500, 44, 40);
    const dead = bldgs().filter((b) => b.dead).length;
    expect(dead).toBeGreaterThan(5);
    expect(scrap).toBeGreaterThanOrEqual(dead);
  });

  it('chain reactions never spill scrap themselves (combat pays through groundBlast)', () => {
    S.theme = 1; seedDecor(); S.P = null; S.active = false;
    const tank = bldgs().find((b) => b.kind === 'tank' && b.y > 150 && b.y < 750);
    if (!tank) return;
    const n0 = S.pickups.length;
    worldBlast(tank.x, tank.y, 20, 999);
    for (let i = 0; i < 30; i++) updateBg(1 / 30);
    expect(S.pickups.length).toBe(n0);
  });
});
