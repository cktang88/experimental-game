import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../sim/env';
import { memoryStore } from '../sim/env';
import { dailyScore, DAILY_SCORE, settleRun, emptyProfile, utcDateKey, type RunSummary } from '../../src/game/meta';
import { filingFor, submitDaily, flushPendingDaily, fetchDailyBoard, pendingDaily, dailyOpen, type DailyFiling } from '../../src/game/daily';
import { validateDaily } from '../../server/validate.mjs';

const summary = (o: Partial<RunSummary> = {}): RunSummary => ({
  outcome: 'dead', hull: 'vanguard', heat: 0, daily: '2026-10-09', endless: false, won: false, sector: 2, floor: 3, nodes: 14, score: 52_340,
  kills: 410, elites: 2, bosses: 1, structures: 160, broadsides: 30, maxVolley: 1, overdrives: 3, lanceStructures: 10, scrapEarned: 300,
  peakCarnage: 2.2, flawless: 0, maxScrapHeld: 140, fights: 9, seen: { enemies: {}, parts: {}, relics: [], ghosts: [] }, date: '2026-10-09', ...o,
});
const NOW = Date.parse('2026-10-09T12:00:00Z');
const filing = (o: Partial<DailyFiling> = {}): DailyFiling => ({ callsign: 'ACE', date: '2026-10-09', score: 1000, sector: 1, floor: 2, kills: 10, hull: 'vanguard', won: false, ...o });

beforeEach(() => { memoryStore.clear(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('daily score', () => {
  it('is combat score plus depth, hard targets, structures and victory', () => {
    const k = DAILY_SCORE;
    expect(dailyScore(summary())).toBe(52_340 + 14 * k.node + 2 * k.elite + 1 * k.ghost + 160 * k.structure);
    expect(dailyScore(summary({ won: true, sector: 3 })) - dailyScore(summary())).toBe(k.victory);
    expect(dailyScore(summary({ score: 0, nodes: 0, elites: 0, bosses: 0, structures: 0 }))).toBe(0);
  });
  it('going one node deeper is worth more than a typical fight of farming', () => {
    expect(DAILY_SCORE.node).toBeGreaterThan(2000);
  });
  it('settles daily runs with the daily score and exposes the filing', () => {
    const st = settleRun(emptyProfile(), summary());
    expect(st.dailyScore).toBe(dailyScore(summary()));
    expect(st.profile.daily?.score).toBe(st.dailyScore);
    expect(st.dailyLine).toContain(Math.round(st.dailyScore!).toLocaleString('en-US'));
    const f = filingFor(' ace pilot!', st)!;
    expect(f).toEqual({ callsign: 'ACE PILOT', date: '2026-10-09', score: st.dailyScore, sector: 2, floor: 3, kills: 410, hull: 'vanguard', won: false });
    // what the client files is what the server accepts
    expect(validateDaily(f, NOW).error).toBeUndefined();
    expect(filingFor('ACE', settleRun(emptyProfile(), summary({ daily: null })))).toBeNull();
  });
  it('uses UTC days', () => {
    expect(utcDateKey(new Date('2026-10-09T23:59:59Z'))).toBe('2026-10-09');
    expect(utcDateKey(new Date('2026-10-10T00:00:01Z'))).toBe('2026-10-10');
    expect(dailyOpen('2026-10-08')).toBe(true);
    expect(dailyOpen('2026-10-07')).toBe(false);
  });
});

describe('daily client', () => {
  const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  it('files and reports rank', async () => {
    vi.stubGlobal('fetch', reply(201, { ok: true, improved: true, rank: 3, count: 9 }));
    expect(await submitDaily(filing())).toEqual({ status: 'filed', rank: 3, count: 9 });
    vi.stubGlobal('fetch', reply(200, { ok: true, improved: false, rank: 2, count: 9 }));
    expect((await submitDaily(filing())).status).toBe('kept');
    expect(pendingDaily()).toEqual([]);
  });
  it('queues when the registry is offline or busy, keeps the best per day, and flushes later', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    expect(await submitDaily(filing({ score: 500 }))).toEqual({ status: 'queued' });
    expect(await submitDaily(filing({ score: 900 }))).toEqual({ status: 'queued' });
    expect(await submitDaily(filing({ score: 100 }))).toEqual({ status: 'queued' });
    vi.stubGlobal('fetch', reply(429, { error: 'slow down' }));
    expect(await submitDaily(filing({ callsign: 'B', score: 50 }))).toEqual({ status: 'queued' });
    expect(pendingDaily().map((f) => [f.callsign, f.score])).toEqual([['ACE', 900], ['B', 50]]);
    const ok = reply(201, { ok: true, rank: 1, count: 1 });
    vi.stubGlobal('fetch', ok);
    expect(await flushPendingDaily()).toBe(2);
    expect(ok).toHaveBeenCalledTimes(2);
    expect(pendingDaily()).toEqual([]);
  });
  it('drops refused filings and filings whose day has closed', async () => {
    vi.stubGlobal('fetch', reply(400, { error: 'Score is not a plausible whole number.' }));
    expect(await submitDaily(filing())).toEqual({ status: 'rejected', error: 'Score is not a plausible whole number.' });
    expect(pendingDaily()).toEqual([]);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    await submitDaily(filing());
    expect(pendingDaily()).toHaveLength(1);
    expect(await flushPendingDaily(NOW + 3 * 86_400_000)).toBe(0);
    expect(pendingDaily()).toEqual([]);
  });
  it('reads the board defensively and reports offline', async () => {
    vi.stubGlobal('fetch', reply(200, { count: 70, entries: [{ rank: 1, callsign: 'ace', score: 9e3, sector: 2, floor: 1, kills: 4, hull: 'vanguard', won: false }, null, { nope: 1 }], you: { rank: 61, callsign: 'ME', score: 3, sector: 1, floor: 0, kills: 0, hull: 'vanguard', won: false } }));
    const b = await fetchDailyBoard('2026-10-09', 'me');
    expect(b.online).toBe(true);
    expect(b.count).toBe(70);
    expect(b.entries.map((e) => e.callsign)).toEqual(['ACE']);
    expect(b.you?.rank).toBe(61);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    expect(await fetchDailyBoard('2026-10-09')).toEqual({ date: '2026-10-09', count: 0, entries: [], you: null, online: false });
  });
});
