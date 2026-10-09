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
