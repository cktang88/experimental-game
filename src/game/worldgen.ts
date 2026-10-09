// World generation: the city and terrain scrolling beneath the fight, plus clouds.
// Owned by the city/world agent. Combat calls seedDecor() on start, updateBg(dt) every tick and
// worldBlast() for every ground explosion; return scrap to spill (destroyed buildings pay out).
import { rnd } from '../util/rng';
import { FIELD_W as W, FIELD_H as H } from './field';
import { S } from './combat';

export interface Decor { type: 'road' | 'crater' | 'block' | 'pad' | 'field'; x: number; y: number; w: number; h: number; r: number; hgt: number; [k: string]: unknown }

function makeDecor(y: number): Decor {
  const r = Math.random();
  const d: Decor = { type: 'crater', x: rnd(0, W), y, w: 0, h: 0, r: rnd(8, 26), hgt: 0 };
  if (r < 0.12) Object.assign(d, { type: 'road', h: rnd(14, 22) });
  else if (r < 0.45) d.type = 'crater';
  else if (r < 0.8) Object.assign(d, { type: 'block', w: rnd(26, 70), h: rnd(22, 60), hgt: rnd(8, 34) });
  else if (r < 0.9) Object.assign(d, { type: 'pad', x: rnd(30, W - 30), r: rnd(14, 20) });
  else Object.assign(d, { type: 'field', w: rnd(80, 180), h: rnd(50, 110) });
  return d;
}
export function seedDecor() {
  S.decor = []; for (let y = -60; y < H + 60; y += 42) for (let i = 0; i < 3; i++) S.decor.push(makeDecor(y + rnd(-15, 15)));
  S.clouds = []; for (let i = 0; i < 6; i++) S.clouds.push({ x: rnd(0, W), y: rnd(0, H), w: rnd(240, 480), h: rnd(80, 160) });
}
let decorAcc = 0;
export function updateBg(dt: number) {
  const dy = S.scroll * dt; S.scrollY += dy; decorAcc += dy;
  while (decorAcc > 42) { decorAcc -= 42; for (let i = 0; i < 3; i++) S.decor.push(makeDecor(-70)); }
  for (const d of S.decor) d.y += dy;
  S.decor = S.decor.filter((d) => d.y < H + 120);
  for (const c of S.clouds) { c.y += dy * 2.6; if (c.y - c.h > H) { c.y = -c.h - rnd(0, 200); c.x = rnd(0, W); } }
}
/** A ground explosion at field (x, y). Returns scrap to spill from anything it destroyed. */
export function worldBlast(_x: number, _y: number, _r: number, _dmg: number): number { return 0; }
