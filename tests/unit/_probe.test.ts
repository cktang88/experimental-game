import { it } from 'vitest';
(globalThis as unknown as { localStorage: unknown }).localStorage ??= { getItem: () => null, setItem: () => undefined };
const { S } = await import('../../src/game/combat');
const { seedDecor, worldBlast, CITY, updateBg } = await import('../../src/game/worldgen');
const { BIOMES } = await import('../../src/game/biomes');

it('probe', () => {
  const names = ['city', 'port', 'air', 'desert', 'snow', 'forest'];
  for (let b = 0; b < 6; b++) {
    let cnt = 0, val = 0, lights = 0, t0 = performance.now(), gens = 0;
    const seeds = 8;
    for (let s = 0; s < seeds; s++) {
      S.theme = b; S.biomeB = -1; S.P = null; S.active = false; seedDecor(); gens++;
      const all = CITY.chunks.flatMap((c) => c.bldgs).filter((x) => x.y > 0 && x.y < 900 && x.x > 0 && x.x < 1600);
      cnt += all.length; lights += CITY.chunks.reduce((n, c) => n + c.lights.length, 0);
      for (let i = 0; i < 40; i++) val += worldBlast(100 + Math.random() * 1400, 100 + Math.random() * 700, 30, 60);
    }
    const tg = performance.now();
    for (let i = 0; i < 300; i++) updateBg(1 / 30);
    const tu = performance.now() - tg;
    const per = val / (seeds * 40);
    console.log(`${names[b]}: bldgs on screen ${Math.round(cnt / seeds)}, lights ${Math.round(lights / seeds)}, scrap/blast ${per.toFixed(2)}, paid ${(per * BIOMES[b].pay).toFixed(3)}, seed ms ${((tg - t0) / seeds).toFixed(0)}, 10s scroll ms ${tu.toFixed(0)}`);
  }
}, 300000);
