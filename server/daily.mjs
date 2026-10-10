// Daily strike duty roster: the best run per callsign per UTC day, ranked. Pure in-memory board; server.mjs
// loads and persists it (GHOST_DATA_DIR/daily.json) and does the HTTP.
import { validStoredDaily } from './validate.mjs';

export const BOARD_TOP = 50;
/** Days kept on file. Older rosters are dropped on load and on every new day's first submission. */
export const KEEP_DAYS = 60;

/** Higher score first; ties go to the deeper run, then the earlier filing. */
export const byRank = (a, b) => b.score - a.score || b.sector - a.sector || b.floor - a.floor || a.at - b.at;

export function createBoard(data = {}) {
  /** date -> Map(callsign -> entry) */
  const days = new Map();
  for (const [date, list] of Object.entries(data && typeof data === 'object' ? data : {})) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const e = validStoredDaily(raw);
      if (!e || e.date !== date) continue;
      put(e);
    }
  }
  function put(e) {
    let day = days.get(e.date);
    if (!day) { day = new Map(); days.set(e.date, day); }
    const prev = day.get(e.callsign);
    if (prev && byRank(prev, e) <= 0) return { improved: false, entry: prev };
    day.set(e.callsign, e);
    return { improved: true, entry: e };
  }
  const ranked = (date) => [...(days.get(date)?.values() ?? [])].sort(byRank);
  return {
    /** Keep the better of the new entry and this callsign's earlier one for that day. */
    submit(e) {
      const r = put(e);
      const list = ranked(e.date);
      return { ...r, rank: list.indexOf(r.entry) + 1, count: list.length };
    },
    /** Top `n` plus the total; with a callsign, that pilot's row and rank even when outside the top. */
    top(date, n = BOARD_TOP, callsign = '') {
      const list = ranked(date);
      const out = { date, count: list.length, entries: list.slice(0, n).map((e, i) => ({ rank: i + 1, ...e })) };
      if (callsign) {
        const i = list.findIndex((e) => e.callsign === callsign);
        if (i >= 0) out.you = { rank: i + 1, ...list[i] };
      }
      return out;
    },
    /** Drop days older than `keep` days before `today` (YYYY-MM-DD strings compare in date order). */
    prune(today, keep = KEEP_DAYS) {
      const cut = new Date(Date.parse(`${today}T00:00:00Z`) - keep * 86_400_000).toISOString().slice(0, 10);
      for (const d of days.keys()) if (d < cut) days.delete(d);
    },
    toJSON() { return Object.fromEntries([...days].map(([d, m]) => [d, [...m.values()]])); },
    get days() { return days.size; },
  };
}
