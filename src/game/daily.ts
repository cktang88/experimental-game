// Client for the daily strike duty roster (server/daily.mjs). Filings that cannot reach the registry are queued on
// this device and retried the next time a roster is opened, while their date is still open (today or yesterday, UTC).
import type { HullId } from '../data/hulls';
import { sanitizeName } from './ghosts';
import type { Settlement } from './meta';

export interface DailyFiling { callsign: string; date: string; score: number; sector: number; floor: number; kills: number; hull: HullId; won: boolean }
export interface DailyRow extends DailyFiling { rank: number; at: number }
export interface DailyBoard {
  date: string; count: number; entries: DailyRow[]; you: DailyRow | null;
  /** False when the registry could not be reached; the board is then empty. */
  online: boolean;
}
export type FilingResult =
  | { status: 'filed' | 'kept'; rank: number; count: number }
  | { status: 'queued' }
  | { status: 'rejected'; error: string };

const PENDING_KEY = 'gd.daily.pending';
const DAY = 86_400_000;
const utc = (t: number) => new Date(t).toISOString().slice(0, 10);
/** Same window the server accepts. */
export const dailyOpen = (date: string, now = Date.now()) => date === utc(now) || date === utc(now - DAY);

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

/** The roster filing for a settled daily run, or null for an ordinary run. */
export function filingFor(callsign: string, st: Settlement): DailyFiling | null {
  const s = st.summary;
  if (!s.daily || st.dailyScore == null) return null;
  return { callsign: sanitizeName(callsign) || 'PILOT', date: s.daily, score: st.dailyScore, sector: s.sector, floor: s.floor, kills: s.kills, hull: s.hull, won: s.won };
}

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
function row(r: any): DailyRow | null {
  if (!r || typeof r !== 'object' || typeof r.callsign !== 'string') return null;
  return {
    rank: Math.max(1, Math.floor(num(r.rank, 1))), callsign: sanitizeName(r.callsign) || '?', date: String(r.date ?? '').slice(0, 10),
    score: Math.max(0, Math.round(num(r.score))), sector: Math.max(1, Math.floor(num(r.sector, 1))), floor: Math.max(0, Math.floor(num(r.floor))),
    kills: Math.max(0, Math.floor(num(r.kills))), hull: (typeof r.hull === 'string' ? r.hull : 'vanguard') as HullId, won: r.won === true, at: num(r.at),
  };
}

export async function fetchDailyBoard(date: string, callsign = ''): Promise<DailyBoard> {
  const cs = sanitizeName(callsign);
  try {
    const r = await withTimeout(fetch(`/api/daily/${encodeURIComponent(date)}${cs ? `?callsign=${encodeURIComponent(cs)}` : ''}`), 3500);
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    const entries = (Array.isArray(j.entries) ? j.entries : []).map(row).filter((x: DailyRow | null): x is DailyRow => !!x).slice(0, 50);
    return { date, count: Math.max(entries.length, Math.floor(num(j.count))), entries, you: row(j.you), online: true };
  } catch {
    return { date, count: 0, entries: [], you: null, online: false };
  }
}

function pending(): DailyFiling[] {
  try { const a = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); return Array.isArray(a) ? a.filter((f) => f && typeof f.date === 'string') : []; } catch { return []; }
}
function setPending(list: DailyFiling[]) {
  try { if (list.length) localStorage.setItem(PENDING_KEY, JSON.stringify(list.slice(-6))); else localStorage.removeItem(PENDING_KEY); } catch { /* storage blocked */ }
}
function queue(f: DailyFiling) {
  // keep only the best queued filing per callsign and day
  const list = pending();
  const same = list.find((p) => p.date === f.date && p.callsign === f.callsign);
  if (same && same.score >= f.score) return;
  setPending([...list.filter((p) => p !== same), f]);
}

async function post(f: DailyFiling): Promise<FilingResult & { retry?: boolean }> {
  try {
    const r = await withTimeout(fetch('/api/daily', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(f) }), 4000);
    const j = await r.json().catch(() => ({}));
    if (r.ok) return { status: j.improved === false ? 'kept' : 'filed', rank: Math.max(1, Math.floor(num(j.rank, 1))), count: Math.max(1, Math.floor(num(j.count, 1))) };
    if (r.status === 400) return { status: 'rejected', error: String(j.error || 'Filing refused.') };
    return { status: 'queued', retry: true }; // 429, 5xx, proxy errors
  } catch { return { status: 'queued', retry: true }; }
}

/** File a daily run with the registry. Unreachable registry: the filing is queued on this device. */
export async function submitDaily(f: DailyFiling): Promise<FilingResult> {
  const res = await post(f);
  if (res.status === 'queued') { if (dailyOpen(f.date)) queue(f); return { status: 'queued' }; }
  return res;
}

/** Retry queued filings (drops any whose day has closed). Returns how many reached the registry. */
export async function flushPendingDaily(now = Date.now()): Promise<number> {
  const list = pending().filter((f) => dailyOpen(f.date, now));
  if (!list.length) { setPending([]); return 0; }
  const keep: DailyFiling[] = [];
  let sent = 0;
  for (const f of list) {
    const r = await post(f);
    if (r.status === 'queued') keep.push(f); else sent++;
    if (r.status === 'queued') break; // registry down or rate-limited: try the rest later
  }
  setPending([...keep, ...list.slice(sent + keep.length)]);
  return sent;
}
export const pendingDaily = () => pending();
