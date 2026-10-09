import { describe, it, expect, beforeEach } from 'vitest';
import { EVENTS } from '../../src/data/events';
import { newRun, maxHp } from '../../src/game/run';
import { aiGhost } from '../../src/game/ghosts';

beforeEach(() => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
});

describe('events', () => {
  it('every choice of every event resolves without breaking the run', () => {
    for (const ev of EVENTS) {
      for (let ci = 0; ci < 4; ci++) {
        for (let seed = 1; seed <= 5; seed++) {
          const run = newRun('TEST', seed * 101 + ci);
          run.scrap = 200;
          const ctx = { run, ghost: aiGhost(1) };
          const choices = ev.choices(ctx);
          if (ci >= choices.length) continue;
          expect(ev.text(ctx).length, ev.id).toBeGreaterThan(10);
          const c = choices[ci];
          if (c.disabled) continue;
          const out = c.run();
          expect(out.text.length, `${ev.id}#${ci}`).toBeGreaterThan(3);
          expect(run.hp).toBeGreaterThanOrEqual(1);
          expect(run.hp).toBeLessThanOrEqual(maxHp(run));
          expect(run.scrap).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
  it('choices that cost scrap are disabled when broke', () => {
    const run = newRun('TEST', 5); run.scrap = 0;
    const convoy = EVENTS.find((e) => e.id === 'convoy')!;
    expect(convoy.choices({ run })[0].disabled).toBeTruthy();
  });
});
