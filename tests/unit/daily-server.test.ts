import { describe, it, expect } from 'vitest';
import { validateDaily, isDateKey, dailyDateOpen, cleanCallsign, utcDateKey, rateLimiter, validStoredDaily, DAILY_LIMITS } from '../../server/validate.mjs';
import { createBoard, BOARD_TOP } from '../../server/daily.mjs';

const NOW = Date.parse('2026-10-09T12:00:00Z');
const body = (o: Record<string, unknown> = {}) => ({ callsign: 'Ace-1', date: '2026-10-09', score: 48_000, sector: 2, floor: 4, hull: 'vanguard', kills: 210, won: false, ...o });
const entry = (o: Record<string, unknown> = {}) => { const v = validateDaily(body(o), NOW); if (!v.entry) throw new Error(v.error); return v.entry; };

describe('daily validation', () => {
  it('accepts a good filing and normalizes the callsign', () => {
    const v = validateDaily(body({ callsign: '  ace   one ' }), NOW);
    expect(v.error).toBeUndefined();
    expect(v.entry).toMatchObject({ callsign: 'ACE ONE', date: '2026-10-09', score: 48_000, sector: 2, floor: 4, hull: 'vanguard', kills: 210, won: false, at: NOW });
  });
  it('only opens today and yesterday (UTC)', () => {
    expect(utcDateKey(NOW)).toBe('2026-10-09');
    expect(dailyDateOpen('2026-10-09', NOW)).toBe(true);
    expect(dailyDateOpen('2026-10-08', NOW)).toBe(true);
    expect(dailyDateOpen('2026-10-07', NOW)).toBe(false);
    expect(dailyDateOpen('2026-10-10', NOW)).toBe(false);
    // just after midnight UTC, yesterday is still open
    expect(dailyDateOpen('2026-10-08', Date.parse('2026-10-09T00:00:05Z'))).toBe(true);
    expect(validateDaily(body({ date: '2026-10-07' }), NOW).error).toMatch(/today/);
  });
  it('rejects bad dates', () => {
    for (const d of ['2026-02-30', '2026-13-01', '26-10-09', '2026-10-9', '2026-10-09T00:00', '', null, 20261009, '../../etc']) expect(isDateKey(d)).toBe(false);
    expect(isDateKey('2028-02-29')).toBe(true);
    expect(validateDaily(body({ date: '2026-02-30' }), NOW).error).toMatch(/YYYY-MM-DD/);
  });
  it('rejects absurd or malformed numbers', () => {
    for (const o of [{ score: DAILY_LIMITS.score + 1 }, { score: -1 }, { score: 1.5 }, { score: '100' }, { score: NaN }, { score: Infinity },
      { sector: 0 }, { sector: 100 }, { floor: 21 }, { floor: -1 }, { kills: 1e9 }, { kills: null }]) {
      expect(validateDaily(body(o), NOW).error, JSON.stringify(o)).toBeTruthy();
    }
  });
  it('rejects oversized or odd strings and unknown hulls', () => {
    expect(cleanCallsign('X'.repeat(17))).toBe('');
    expect(cleanCallsign('X'.repeat(500))).toBe('');
    expect(cleanCallsign('<script>')).toBe('');
    expect(cleanCallsign('   ')).toBe('');
    expect(cleanCallsign(42)).toBe('');
    expect(validateDaily(body({ callsign: 'A'.repeat(100) }), NOW).error).toMatch(/Callsign/);
    expect(validateDaily(body({ hull: 'battlestar' }), NOW).error).toMatch(/hull/);
    expect(validateDaily(body({ won: 'yes' }), NOW).error).toMatch(/Victory/);
    expect(validateDaily(body({ won: true, sector: 1 }), NOW).error).toMatch(/three/);
    for (const junk of [null, 'x', [], 7]) expect(validateDaily(junk, NOW).error).toBeTruthy();
  });
  it('re-validates stored rows on load', () => {
    expect(validStoredDaily(entry())).toEqual(entry());
    expect(validStoredDaily({ ...entry(), score: 1e12 })).toBeNull();
    expect(validStoredDaily({ ...entry(), date: '2019-01-01' })?.date).toBe('2019-01-01'); // old dates are fine on file
  });
});

describe('daily board', () => {
  it('keeps the best score per callsign per day', () => {
    const b = createBoard();
    expect(b.submit(entry({ score: 1000 })).improved).toBe(true);
    const worse = b.submit(entry({ score: 500 }));
    expect(worse.improved).toBe(false);
    expect(worse.entry.score).toBe(1000);
    expect(b.submit(entry({ score: 2000, callsign: 'ace-1' })).improved).toBe(true); // same pilot, any case
    expect(b.top('2026-10-09').entries.map((e) => e.score)).toEqual([2000]);
    b.submit(entry({ score: 9000, date: '2026-10-08' }));
    expect(b.top('2026-10-09').count).toBe(1);
    expect(b.top('2026-10-08').count).toBe(1);
  });
  it('ranks by score, then depth, then the earlier filing; returns top 50 and the caller row', () => {
    const b = createBoard();
    for (let i = 0; i < 60; i++) b.submit({ ...entry({ callsign: `P${i}`, score: i * 100 }), at: NOW + i });
    b.submit({ ...entry({ callsign: 'TIE-DEEP', score: 5900, sector: 3 }), at: NOW + 999 });
    const r = b.submit({ ...entry({ callsign: 'LAST', score: 0 }), at: NOW + 1000 });
    expect(r.rank).toBe(62); expect(r.count).toBe(62);
    const t = b.top('2026-10-09', BOARD_TOP, 'LAST');
    expect(t.count).toBe(62);
    expect(t.entries).toHaveLength(50);
    expect(t.entries[0]).toMatchObject({ rank: 1, callsign: 'TIE-DEEP' });
    expect(t.entries[1]).toMatchObject({ rank: 2, callsign: 'P59' });
    expect(t.you).toMatchObject({ rank: 62, callsign: 'LAST' });
    expect(b.top('2026-10-09', 50, 'NOBODY').you).toBeUndefined();
    expect(b.top('2026-01-01')).toEqual({ date: '2026-01-01', count: 0, entries: [] });
  });
  it('round-trips through JSON, drops junk rows and prunes old days', () => {
    const b = createBoard();
    b.submit(entry({ callsign: 'A' })); b.submit(entry({ callsign: 'B', date: '2026-10-08' }));
    const data = JSON.parse(JSON.stringify(b));
    data['2026-10-09'].push({ callsign: '<bad>', score: 1 }, null, { ...entry({ callsign: 'C' }), date: '2026-10-08' });
    data['2026-07-01'] = [{ ...entry({ callsign: 'OLD' }), date: '2026-07-01' }];
    data.junk = 'x';
    const c = createBoard(data);
    expect(c.top('2026-10-09').entries.map((e) => e.callsign)).toEqual(['A']);
    expect(c.days).toBe(3);
    c.prune('2026-10-09', 60);
    expect(c.days).toBe(2);
    expect(createBoard('nonsense').days).toBe(0);
  });
});

describe('rate limit', () => {
  it('enforces a gap between filings and a cap per window, per address', () => {
    const rl = rateLimiter({ max: 3, windowMs: 60_000, gapMs: 5_000 });
    expect(rl.hit('a', 0)).toBe(0);
    expect(rl.hit('a', 1_000)).toBe(4_000);
    expect(rl.hit('b', 1_000)).toBe(0);
    expect(rl.hit('a', 5_000)).toBe(0);
    expect(rl.hit('a', 10_000)).toBe(0);
    expect(rl.hit('a', 20_000)).toBe(40_000);
    expect(rl.hit('a', 60_000)).toBe(0); // new window
  });
});
