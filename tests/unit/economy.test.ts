import { describe, it, expect } from 'vitest';
import { sectorEconomy } from '../sim/economy';
import { FIGHTS, ELITES } from '../../src/data/enemies';

// BALANCE=1 npx vitest run tests/unit/economy.test.ts --disable-console-intercept   prints the full table.
const REPORT = !!process.env.BALANCE;

describe('scrap economy', () => {
  it('sector 3 still forces choices at the merchant', () => {
    const sample = FIGHTS.filter((f) => ['patrol', 'armored_column'].includes(f.id));
    const s1 = sectorEconomy(1, sample, []), s3 = sectorEconomy(3, sample, []);
    // A late fight buys no more of an average part than an early one does...
    expect(s3.partsPerFight).toBeLessThanOrEqual(s1.partsPerFight * 1.15);
    // ...and a whole sector's income buys well under the merchant's full stock.
    expect(s3.stockShare).toBeLessThan(0.85);
    expect(s3.stockShare).toBeGreaterThan(0.35);
  }, 120_000);
  it.runIf(REPORT)('prints the table', () => {
    console.log('\nsector  fight  elite  boss  income | part  stock  repair½ | parts/fight  income/stock');
    for (const s of [1, 2, 3]) {
      const e = sectorEconomy(s, FIGHTS, ELITES);
      console.log(`s${e.sector}      ${String(e.fight).padStart(5)}  ${String(e.elite).padStart(5)}  ${String(e.boss).padStart(4)}  ${String(e.income).padStart(6)} | ${String(e.part).padStart(4)}  ${String(e.stock).padStart(5)}  ${String(e.repairFull).padStart(7)} | ${String(e.partsPerFight).padStart(11)}  ${String(e.stockShare).padStart(12)}`);
    }
  }, 600_000);
});
