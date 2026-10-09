// Heat: stacking difficulty levels unlocked by winning. Heat N applies modifiers 1..N (Ascension style), and
// each victory at your highest heat unlocks the next. Pure data plus a fold into plain numbers.

export interface HeatDef { level: number; name: string; desc: string; fx: Partial<HeatFx> }
export interface HeatFx {
  enemyHp: number; enemyDmg: number; scrap: number; eliteHp: number; bossHp: number; bossFire: number;
  spawn: number; startHp: number; heal: number;
}
export const neutralHeat = (): HeatFx => ({ enemyHp: 1, enemyDmg: 1, scrap: 1, eliteHp: 1, bossHp: 1, bossFire: 1, spawn: 1, startHp: 1, heal: 1 });

export const HEAT: HeatDef[] = [
  { level: 1, name: 'Hardened Garrisons', desc: 'Enemies have 20% more hull.', fx: { enemyHp: 1.2 } },
  { level: 2, name: 'Thin Salvage', desc: '15% less scrap from every source.', fx: { scrap: 0.85 } },
  { level: 3, name: 'Veteran Gunners', desc: 'Enemy fire hits 20% harder.', fx: { enemyDmg: 1.2 } },
  { level: 4, name: 'Elite Escorts', desc: 'Elites have 30% more hull.', fx: { eliteHp: 1.3 } },
  { level: 5, name: 'Swarming Skies', desc: '20% more enemies in every fight.', fx: { spawn: 1.2 } },
  { level: 6, name: 'Battle-Worn', desc: 'Launch at 75% hull.', fx: { startHp: 0.75 } },
  { level: 7, name: 'Vengeful Ghosts', desc: 'Ghost dreadnoughts have 30% more hull and fire 15% faster.', fx: { bossHp: 1.3, bossFire: 1.15 } },
  { level: 8, name: 'No Quarter', desc: 'All repairs restore 30% less.', fx: { heal: 0.7 } },
];
export const MAX_HEAT = HEAT.length;

/** Fold heat levels 1..level into multipliers. */
export function heatFx(level: number): HeatFx {
  const out = neutralHeat();
  for (const h of HEAT) if (h.level <= level) for (const [k, v] of Object.entries(h.fx) as [keyof HeatFx, number][]) out[k] *= v;
  return out;
}
/** Rank XP bonus for flying at a heat level. */
export const heatXpMult = (level: number) => 1 + 0.15 * Math.max(0, Math.min(MAX_HEAT, level));
