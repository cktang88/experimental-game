// Scrap economy: what a sector pays (real fights from the balance harness) against what the merchant asks for
// (prices from the real part, section, relic and repair formulas). Used by tests/unit/economy.test.ts;
// `BALANCE=1 npx vitest run tests/unit/economy.test.ts --disable-console-intercept` prints the table.
import { runFight } from './harness';
import { FIGHTS, ELITES, BOSS_ENCOUNTER } from '../../src/data/enemies';
import { WEAPONS, UTILS, partCost, mkPart, sectionCost, SECTIONS, derive, type SectionType } from '../../src/data/parts';
import { BUILDS } from './harness';
import { REPAIR } from '../../src/game/run';

/** The build each sector is measured with (as the balance table): starter in sector 1, mid in 2, late in 3. */
export const SECTOR_BUILD: Record<number, { build: string; late: string }> = {
  1: { build: 'starter', late: 's1end' }, 2: { build: 'mid', late: 'mid' }, 3: { build: 'late', late: 'late' },
};
/** An average route through a 10-floor sector map (map.ts weights): fights, elites, a derelict, a boss. */
export const ROUTE = { fights: 4.3, elites: 0.9, derelicts: 1, derelictScrap: 40, skips: 0.5, skipScrap: 20 } as const;
const lv = (sector: number, floor: number, elite = false) => 1 + (sector - 1) * 3.2 + floor * 0.28 + (elite ? 1.2 : 0);
/** maxTierFor() in run.ts at a given floor. */
const maxTier = (sector: number, floor: number) => Math.min(5, 1 + Math.floor((sector - 1) * 1.3 + floor / 5));

/** Mean merchant price of a part offered at this sector and floor (tiers mt-1..mt, every part equally likely). */
export function meanPartPrice(sector: number, floor: number, bonus = 0) {
  const mt = Math.min(5, maxTier(sector, floor) + bonus), ids = [...Object.keys(WEAPONS), ...Object.keys(UTILS)];
  let sum = 0, n = 0;
  for (const id of ids) for (const t of [Math.max(1, mt - 1), mt]) { sum += partCost(mkPart(id, t)); n++; }
  return sum / n;
}
export interface SectorEconomy {
  sector: number; fight: number; elite: number; boss: number; income: number;
  part: number; stock: number; repairFull: number; partsPerFight: number; stockShare: number;
}
/** What one sector pays and what its merchant costs. `fights` narrows the encounters sampled (default: all). */
export function sectorEconomy(sector: number, fights = FIGHTS, elites = ELITES): SectorEconomy {
  const sb = SECTOR_BUILD[sector];
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
  const fight = mean(fights.flatMap((f) => [2, 6].map((fl) => runFight({ enc: f, level: lv(sector, fl), sector, build: sb.build, seed: 3 + fl }).scrap)));
  const elite = elites.length ? mean(elites.map((e) => runFight({ enc: e, level: lv(sector, 6, true), sector, build: sb.late, seed: 5 }).scrap)) : fight * 1.2;
  const bossFight = runFight({ enc: BOSS_ENCOUNTER, level: sector * 3 + 0.6, sector, build: sb.late, seed: 7 }).scrap;
  const boss = bossFight + 80 + 30 * sector; // the strip-for-scrap option on the boss salvage screen
  const income = ROUTE.fights * fight + ROUTE.elites * elite + ROUTE.derelicts * ROUTE.derelictScrap + ROUTE.skips * ROUTE.skipScrap + boss;
  // A merchant at floor 5: three parts, two a tier better, two sections, one relic, and patching half the hull.
  const part = meanPartPrice(sector, 5), better = meanPartPrice(sector, 5, 1);
  const nSec = Math.min(7, 3 + 2 * sector), secTypes = Object.keys(SECTIONS).filter((k) => k !== 'bridge') as SectionType[];
  const section = secTypes.reduce((s, k) => s + sectionCost(k, nSec), 0) / secTypes.length;
  const hull = derive(BUILDS[sb.late]()).maxHp, hps = REPAIR.hullPerScrap / (1 + REPAIR.sectorTax * (sector - 1));
  const repairFull = Math.ceil((hull * 0.5) / hps);
  const stock = 3 * part + 2 * better + 2 * section + 140 + repairFull;
  return {
    sector, fight: Math.round(fight), elite: Math.round(elite), boss: Math.round(boss), income: Math.round(income),
    part: Math.round(part), stock: Math.round(stock), repairFull, partsPerFight: +(fight / part).toFixed(2), stockShare: +(income / stock).toFixed(2),
  };
}
