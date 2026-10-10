import { describe, it, expect } from 'vitest';
import '../sim/env';
import { HEAT, heatFx } from '../../src/data/heat';
import { newRun, maxHp, heal, healAmount, repairQuote, buyRepair, repairHullPerScrap, REPAIR } from '../../src/game/run';

// Heat 8 (No Quarter) promises that every repair restores 30% less hull. These tests hold the description, the
// drydock / event heal and the merchant's repair service to that number.
const runAt = (heat: number, sector = 1) => {
  const r = newRun('TEST', 11, { heat });
  r.sector = sector; r.hp = 1; r.scrap = 10_000;
  return r;
};

describe('No Quarter (heat 8) repair penalty', () => {
  it('the description states the factor the modifier applies', () => {
    const nq = HEAT.find((h) => h.level === 8)!;
    const pct = Number(/(\d+)% less/.exec(nq.desc)?.[1]);
    expect(pct).toBe(Math.round((1 - nq.fx.heal!) * 100));
    expect(nq.desc).toMatch(/drydock/i);
    expect(nq.desc).toMatch(/merchant/i);
    expect(heatFx(8).heal).toBeCloseTo(0.7);
    expect(heatFx(7).heal).toBe(1);
  });

  it('drydock and event repairs restore 30% less at heat 8, and the quoted amount is what lands', () => {
    const cool = runAt(7), hot = runAt(8);
    const quoteCool = healAmount(cool, 0.35), quoteHot = healAmount(hot, 0.35);
    expect(quoteCool).toBeCloseTo(maxHp(cool) * 0.35);
    expect(quoteHot).toBeCloseTo(maxHp(hot) * 0.35 * 0.7);
    const before = hot.hp, got = heal(hot, 0.35);
    expect(got).toBeCloseTo(quoteHot);
    expect(hot.hp - before).toBeCloseTo(quoteHot);
  });

  it('a heal never overfills and never quotes more than the missing hull', () => {
    const r = runAt(8); r.hp = maxHp(r) - 5;
    expect(healAmount(r, 0.35)).toBeCloseTo(5);
    heal(r, 0.35);
    expect(r.hp).toBeCloseTo(maxHp(r));
    expect(healAmount(r, 0.35)).toBe(0);
  });

  it('merchant repairs buy 30% less hull per scrap at heat 8', () => {
    const cool = runAt(0), hot = runAt(8);
    expect(repairHullPerScrap(cool)).toBeCloseTo(REPAIR.hullPerScrap);
    expect(repairHullPerScrap(hot)).toBeCloseTo(REPAIR.hullPerScrap * 0.7);
    const qc = repairQuote(cool), qh = repairQuote(hot);
    expect(qh.missing).toBeCloseTo(qc.missing);
    expect(qh.cost / qc.cost).toBeCloseTo(1 / 0.7, 1);
    // the same budget restores 30% less hull
    cool.scrap = hot.scrap = 20;
    const a = buyRepair(cool), b = buyRepair(hot);
    expect(a.cost).toBe(20); expect(b.cost).toBe(20);
    expect(b.fix / a.fix).toBeCloseTo(0.7);
  });

  it('merchant repair never overspends fractional scrap or a discount', () => {
    const r = runAt(8, 3); r.scrap = 10.5;
    const { cost } = buyRepair(r, 0.8);
    expect(cost).toBeLessThanOrEqual(10.5);
    expect(r.scrap).toBeGreaterThanOrEqual(0);
  });

  it('repairs get dearer each sector so late scrap still has to choose', () => {
    expect(repairHullPerScrap(runAt(0, 3))).toBeLessThan(repairHullPerScrap(runAt(0, 2)));
    expect(repairHullPerScrap(runAt(0, 2))).toBeLessThan(repairHullPerScrap(runAt(0, 1)));
  });
});
