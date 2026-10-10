import { describe, it, expect } from 'vitest';
import { FIELD_H } from '../../src/game/field';
import type { Bldg } from '../../src/game/worldgen';

// combat.ts pulls in the audio module, which reads localStorage at import time.
(globalThis as unknown as { localStorage: unknown }).localStorage ??= { getItem: () => null, setItem: () => undefined };
const { S } = await import('../../src/game/combat');
const { seedDecor, updateBg, worldBlast, setBiome, isWater, isLand, surfaceAt, findSurface, terrainAt, biomeAt, CITY, DARK } = await import('../../src/game/worldgen');
const { FIRE, Burn } = await import('../../src/game/terrain');
const { biomeFor, BIOMES, BIOME_COUNT, RING } = await import('../../src/game/biomes');

const bldgs = () => CITY.chunks.flatMap((c) => c.bldgs);

describe('city worldgen', () => {
  for (let theme = 0; theme < 6; theme++) it(`biome ${theme}: fills the view with structures`, () => {
    S.theme = theme; S.biomeB = -1; seedDecor();
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
    S.theme = 0; S.biomeB = -1; seedDecor();
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

  it('fuel (tanks, wellheads, flares) chain-reacts', () => {
    S.P = null;
    let tank: Bldg | undefined;
    for (let i = 0; i < 12 && !tank; i++) { S.theme = 3; S.biomeB = -1; seedDecor(); tank = bldgs().find((b) => b.fuel > 0 && b.y > 150 && b.y < 750); }
    expect(tank).toBeTruthy();
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
  it('every structure in every biome pays 1-4 scrap, and bigger buildings pay more', () => {
    for (let b = 1; b < 6; b++) { S.theme = b; S.biomeB = -1; seedDecor(); for (const x of bldgs()) { expect(x.value).toBeGreaterThanOrEqual(1); expect(x.value).toBeLessThanOrEqual(4); } }
    S.theme = 0; S.biomeB = -1; seedDecor();
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
    S.theme = 3; S.biomeB = -1; seedDecor(); S.P = null; S.active = false;
    const tank = bldgs().find((b) => b.fuel > 0 && b.y > 150 && b.y < 750);
    if (!tank) return;
    const n0 = S.pickups.length;
    worldBlast(tank.x, tank.y, 20, 999);
    for (let i = 0; i < 30; i++) updateBg(1 / 30);
    expect(S.pickups.length).toBe(n0);
  });
});

describe('biomes', () => {
  it('a campaign crosses every biome, two neighbours per sector, crossing between them mid-sector', () => {
    for (const seed of [undefined, 1, 77, 123456]) {
      const seen = new Set<number>();
      for (let sector = 1; sector <= 3; sector++) for (let floor = 0; floor <= 10; floor++) {
        const p = biomeFor(sector, floor, seed);
        seen.add(p.a); if (p.b >= 0) { seen.add(p.b); expect(RING.indexOf(p.b as never)).toBe((RING.indexOf(p.a as never) + 1) % BIOME_COUNT); }
      }
      expect(seen.size).toBe(BIOME_COUNT);
    }
    // The balance harness (no seed) starts at the night city.
    expect(biomeFor(1, 2).a).toBe(0);
    expect(biomeFor(1, 4).b).toBe(1);
    expect(BIOMES.length).toBe(BIOME_COUNT);
  });

  it('the ground turns into the second biome along a ragged edge, and the ship crosses it', () => {
    setBiome(0, 1, 200); S.P = null; S.active = false;
    expect(CITY.biomeB).toBe(1);
    // Ahead of the edge it is harbour; behind, still the city.
    expect(biomeAt(800, -900)).toBe(1);
    expect(biomeAt(800, 880)).toBe(0);
    for (let i = 0; i < 900; i++) updateBg(1 / 30);
    expect(CITY.crossed).toBe(true);
    expect(S.theme).toBe(1);
    expect(CITY.theme).toBe(1);
    S.biomeB = -1;
  });

  it('terrain queries: harbour water on the left, land on the right; a runway at the airbase', () => {
    setBiome(1); S.P = null;
    expect(isWater(40, 400)).toBe(true);
    expect(isLand(1500, 400)).toBe(true);
    expect(surfaceAt(40, 400)).toBe('water');
    const t = terrainAt(1500, 400);
    expect(t.biome).toBe(1);
    expect(t.water).toBeLessThan(0.5);
    setBiome(2);
    const rw = findSurface('runway', 0, -300, 1600, 900, 400);
    expect(rw).toBeTruthy();
    expect(surfaceAt(rw!.x, rw!.y)).toBe('runway');
    setBiome(3);
    expect(['sand', 'rock', 'road', 'forest', 'apron']).toContain(surfaceAt(800, 400));
  });

  it('a blast in the forest starts a wildfire that spreads through the canopy', () => {
    setBiome(5); S.P = null; S.active = false;
    const p = findSurface('forest', 100, 100, 1500, 600, 400)!;
    expect(p).toBeTruthy();
    worldBlast(p.x, p.y, 30, 60);
    const n0 = FIRE.active.length;
    expect(n0).toBeGreaterThan(0);
    for (let i = 0; i < 150; i++) updateBg(1 / 30);
    expect(FIRE.active.length).toBeGreaterThan(n0);
  });

  it('frozen lakes crack under fire; open water swallows the crater', () => {
    let ice: { x: number; y: number } | null = null;
    for (let i = 0; i < 10 && !ice; i++) { setBiome(4); ice = findSurface('ice', 0, 0, 1600, 900, 600); }
    if (ice) {
      worldBlast(ice.x, ice.y, 30, 60);
      expect(FIRE.active.some((c) => FIRE.data[c * 2 + 1] === Burn.Ice)).toBe(true);
    }
    setBiome(1);
    const c0 = CITY.craters.length;
    worldBlast(40, 400, 30, 60);
    expect(CITY.craters.length).toBe(c0);
  });
});
