// The fleet (meta) loop: a persistent, versioned pilot profile. Admiralty rank from run XP, hull unlocks, goals,
// the codex, heat levels, the daily strike and the best run. Pure functions plus thin localStorage helpers.
// Ported in spirit from dead-air progression.js / goals.js / run-loop.js / best-run.js.
import { RANKS, GOALS, emptyMetaStats, noPerks, type MetaStats, type RankPerks, type GoalDef } from '../data/goals';
import { HULLS, HULL_IDS, isHullId, type HullId } from '../data/hulls';
import { MAX_HEAT, heatXpMult } from '../data/heat';

export const PROFILE_VERSION = 2;
export const PROFILE_KEY = 'gd.profile';

export interface GhostRecord { id: string; name: string; sector: number; ai: boolean; at: number; outcome: 'killed' | 'lost' }
export interface Codex {
  /** Enemy type -> number destroyed. */ enemies: Record<string, number>;
  /** Part id -> highest tier owned. */ parts: Record<string, number>;
  /** Relic id -> times owned. */ relics: Record<string, number>;
  /** Ghost dreadnoughts met, newest first (capped). */ ghosts: GhostRecord[];
}
export interface BestRun { score: number; sector: number; floor: number; hull: HullId; heat: number; won: boolean; kills: number; date: string }
export interface DailyRecord { date: string; score: number; sector: number; floor: number; kills: number; won: boolean; line: string }
export interface Profile {
  version: number;
  xp: number;
  stats: MetaStats;
  goals: Record<string, true>;
  /** Hulls ever flown (for the Whole Fleet goal). */ flown: HullId[];
  /** Launch selections. */ hull: HullId; heat: number;
  codex: Codex;
  best: BestRun | null;
  daily: DailyRecord | null;
  /** The last few run summaries, newest first. */ history: RunSummary[];
}

export const emptyCodex = (): Codex => ({ enemies: {}, parts: {}, relics: {}, ghosts: [] });
export function emptyProfile(): Profile {
  return { version: PROFILE_VERSION, xp: 0, stats: emptyMetaStats(), goals: {}, flown: [], hull: 'vanguard', heat: 0, codex: emptyCodex(), best: null, daily: null, history: [] };
}

/* ---------------- versioning ---------------- */
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});
const counts = (v: unknown) => Object.fromEntries(Object.entries(obj(v)).filter(([, n]) => typeof n === 'number' && Number.isFinite(n) && n > 0).map(([k, n]) => [k, Math.floor(n as number)]));

/**
 * One step per version bump: MIGRATIONS[v] turns a v save into a v+1 save.
 *  v1 -> v2: v1 kept a single `rankXp` number and a flat `codex` list of enemy types; v2 has `xp`, a structured
 *  codex and the daily/best records.
 */
const MIGRATIONS: Record<number, (o: Record<string, any>) => Record<string, any>> = {
  1: (o) => {
    const enemies: Record<string, number> = {};
    for (const t of Array.isArray(o.codex) ? o.codex : []) if (typeof t === 'string') enemies[t] = Math.max(1, enemies[t] || 0);
    return { ...o, version: 2, xp: num(o.rankXp), codex: { enemies, parts: {}, relics: {}, ghosts: [] } };
  },
};

/** Accepts anything (a parsed save, junk, a future version) and returns a valid current profile. */
export function migrateProfile(raw: unknown): Profile {
  let o = obj(raw);
  const v0 = num(o.version, -1);
  if (v0 < 1 || v0 > PROFILE_VERSION) return v0 > PROFILE_VERSION ? sanitize(o) : emptyProfile();
  for (let v = v0; v < PROFILE_VERSION; v++) o = MIGRATIONS[v](o);
  return sanitize(o);
}
function sanitize(o: Record<string, any>): Profile {
  const p = emptyProfile();
  p.xp = Math.max(0, Math.floor(num(o.xp)));
  const st = obj(o.stats);
  for (const k of Object.keys(p.stats) as (keyof MetaStats)[]) p.stats[k] = num(st[k], p.stats[k]);
  for (const [id, done] of Object.entries(obj(o.goals))) if (done === true && GOALS.some((g) => g.id === id)) p.goals[id] = true;
  p.flown = [...new Set((Array.isArray(o.flown) ? o.flown : []).filter(isHullId))] as HullId[];
  p.hull = isHullId(o.hull) ? o.hull : 'vanguard';
  if (!hullUnlocked(p, p.hull)) p.hull = 'vanguard';
  p.heat = Math.max(0, Math.min(maxHeat(p), Math.floor(num(o.heat))));
  const c = obj(o.codex);
  p.codex = {
    enemies: counts(c.enemies), parts: counts(c.parts), relics: counts(c.relics),
    ghosts: (Array.isArray(c.ghosts) ? c.ghosts : []).filter((g: any) => g && typeof g.name === 'string').slice(0, 60)
      .map((g: any) => ({ id: String(g.id ?? ''), name: String(g.name).slice(0, 16), sector: Math.max(1, Math.floor(num(g.sector, 1))), ai: !!g.ai, at: num(g.at), outcome: g.outcome === 'lost' ? 'lost' : 'killed' })),
  };
  const b = obj(o.best);
  p.best = typeof b.score === 'number' ? { score: num(b.score), sector: num(b.sector, 1), floor: num(b.floor), hull: isHullId(b.hull) ? b.hull : 'vanguard', heat: num(b.heat), won: !!b.won, kills: num(b.kills), date: String(b.date ?? '') } : null;
  const d = obj(o.daily);
  p.daily = typeof d.date === 'string' && d.date ? { date: d.date.slice(0, 10), score: num(d.score), sector: num(d.sector, 1), floor: num(d.floor), kills: num(d.kills), won: !!d.won, line: String(d.line ?? '') } : null;
  p.history = (Array.isArray(o.history) ? o.history : []).slice(0, 8);
  return p;
}

export function loadProfile(): Profile {
  try { const s = localStorage.getItem(PROFILE_KEY); return s ? migrateProfile(JSON.parse(s)) : emptyProfile(); } catch { return emptyProfile(); }
}
export function saveProfile(p: Profile) { try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch { /* storage blocked */ } }

/* ---------------- rank, unlocks, heat ---------------- */
export function rankOf(xp: number) {
  let i = 0; while (i + 1 < RANKS.length && xp >= RANKS[i + 1].xp) i++;
  const cur = RANKS[i], next = RANKS[i + 1] ?? null;
  return { ...cur, next, progress: next ? (xp - cur.xp) / (next.xp - cur.xp) : 1 };
}
export function perksFor(xp: number): RankPerks {
  const out = noPerks(), r = rankOf(xp).rank;
  for (const def of RANKS) if (def.rank <= r && def.perk) for (const [k, v] of Object.entries(def.perk) as [keyof RankPerks, number][]) out[k] += v;
  return out;
}
export const hullUnlocked = (p: Profile, id: HullId) => rankOf(p.xp).rank >= HULLS[id].rank;
/** Highest heat a pilot may select: none before the first victory, then one above the highest heat won. */
export const maxHeat = (p: Profile) => (p.stats.wins > 0 ? Math.min(MAX_HEAT, Math.max(1, p.stats.highestHeatWon + 1)) : 0);

/* ---------------- daily strike ---------------- */
export function dateKey(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** UTC calendar day. The daily strike runs on UTC days so every pilot, in every time zone, flies the same route. */
export const utcDateKey = (d = new Date()) => d.toISOString().slice(0, 10);
/** Everyone flying on the same calendar day gets the same seed (FNV-1a of the date). */
export function dailySeed(key = dateKey()) {
  let h = 2166136261;
  for (const ch of `ghost-dreadnought:${key}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return (h % 2147483646) + 1;
}
export function dailyShareLine(r: { date: string; sector: number; floor: number; kills: number; score: number; won: boolean }) {
  return `GHOST DREADNOUGHT DAILY ${r.date} · ${r.won ? 'VICTORY' : `SECTOR ${r.sector} FLOOR ${r.floor + 1}`} · ${r.kills} KILLS · ${Math.round(r.score).toLocaleString('en-US')} PTS`;
}

/**
 * Daily strike score (the duty roster ranks by it). Combat score already carries enemy value, level and the carnage
 * multiplier; on top of it the route pays for depth and for the hard targets, so a careful pilot who goes further
 * beats one who farms the first sector. Documented in docs/TECH.md.
 */
export const DAILY_SCORE = { node: 2500, elite: 1500, ghost: 6000, structure: 5, victory: 25000 } as const;
export function dailyScore(s: Pick<RunSummary, 'score' | 'nodes' | 'elites' | 'bosses' | 'structures' | 'won'>) {
  const k = DAILY_SCORE;
  return Math.max(0, Math.round(s.score + k.node * s.nodes + k.elite * s.elites + k.ghost * s.bosses + k.structure * s.structures + (s.won ? k.victory : 0)));
}

/* ---------------- settling a run ---------------- */
export interface RunSummary {
  outcome: 'dead' | 'victory' | 'retired' | 'abandoned';
  hull: HullId; heat: number; daily: string | null; endless: boolean; won: boolean;
  sector: number; floor: number; nodes: number; score: number;
  kills: number; elites: number; bosses: number; structures: number; broadsides: number; maxVolley: number; overdrives: number;
  lanceStructures: number; scrapEarned: number; peakCarnage: number; flawless: number; maxScrapHeld: number; fights: number;
  seen: { enemies: Record<string, number>; parts: Record<string, number>; relics: string[]; ghosts: Omit<GhostRecord, 'at'>[] };
  date: string;
}
export interface XpLine { label: string; xp: number }
/** Run XP, itemized for the wreck report. */
export function runXp(s: RunSummary): { lines: XpLine[]; total: number } {
  const lines: XpLine[] = [
    { label: `${s.kills} kills`, xp: s.kills * 0.5 },
    { label: `${s.structures} structures`, xp: s.structures * 0.25 },
    { label: `${s.elites} elites`, xp: s.elites * 30 },
    { label: `${s.bosses} ghosts laid to rest`, xp: s.bosses * 120 },
    { label: `${s.nodes} nodes charted`, xp: s.nodes * 8 },
  ];
  if (s.won) lines.push({ label: 'Campaign victory', xp: 500 });
  const base = lines.reduce((a, l) => a + l.xp, 0);
  const hm = heatXpMult(s.heat);
  if (hm > 1) lines.push({ label: `Heat ${s.heat} bonus`, xp: base * (hm - 1) });
  if (s.outcome === 'abandoned') lines.push({ label: 'Abandoned: half pay', xp: -lines.reduce((a, l) => a + l.xp, 0) / 2 });
  for (const l of lines) l.xp = Math.round(l.xp);
  return { lines: lines.filter((l) => l.xp !== 0), total: Math.max(0, lines.reduce((a, l) => a + l.xp, 0)) };
}

export interface Settlement {
  profile: Profile; xp: XpLine[]; xpTotal: number;
  rankBefore: number; rankAfter: number; goals: GoalDef[]; newHulls: HullId[]; heatUnlocked: number | null;
  newBest: boolean; dailyLine: string | null;
  /** The settled run, and its daily strike score (null unless it was a daily run). */
  summary: RunSummary; dailyScore: number | null;
}
/** Fold a finished run into the profile. Pure: returns a new profile and what changed for the report. */
export function settleRun(prev: Profile, s: RunSummary): Settlement {
  const p: Profile = JSON.parse(JSON.stringify(prev));
  const rankBefore = rankOf(p.xp).rank, heatBefore = maxHeat(p);
  const hullsBefore = HULL_IDS.filter((h) => hullUnlocked(p, h));
  const st = p.stats;
  st.runs++; if (s.outcome === 'dead') st.deaths++;
  if (s.won) { st.wins++; st.highestHeatWon = Math.max(st.highestHeatWon, s.heat); }
  st.kills += s.kills; st.elites += s.elites; st.bosses += s.bosses; st.structures += s.structures; st.broadsides += s.broadsides;
  st.overdrives += s.overdrives; st.lanceStructures += s.lanceStructures; st.scrapEarned += Math.floor(s.scrapEarned); st.fights += s.fights;
  st.maxVolley = Math.max(st.maxVolley, s.maxVolley); st.peakCarnage = Math.max(st.peakCarnage, s.peakCarnage);
  st.bestSector = Math.max(st.bestSector, s.sector); st.flawlessFights += s.flawless; st.maxScrapHeld = Math.max(st.maxScrapHeld, Math.floor(s.maxScrapHeld));
  if (s.endless) st.endlessSector = Math.max(st.endlessSector, s.sector);
  if (s.daily) st.dailyRuns++;
  if (!p.flown.includes(s.hull)) p.flown.push(s.hull);
  st.hullsFlown = p.flown.length;
  mergeCodex(p.codex, s.seen);
  const { lines, total } = runXp(s);
  p.xp += total;
  const goals: GoalDef[] = [];
  for (const g of GOALS) if (!p.goals[g.id] && st[g.metric] >= g.goal) { p.goals[g.id] = true; goals.push(g); p.xp += g.xp; }
  const rankAfter = rankOf(p.xp).rank;
  const newHulls = HULL_IDS.filter((h) => hullUnlocked(p, h) && !hullsBefore.includes(h));
  const heatAfter = maxHeat(p);
  let newBest = false;
  if (!s.daily && (!p.best || s.score > p.best.score)) { p.best = { score: s.score, sector: s.sector, floor: s.floor, hull: s.hull, heat: s.heat, won: s.won, kills: s.kills, date: s.date }; newBest = true; }
  let dailyLine: string | null = null;
  if (s.daily) {
    const score = dailyScore(s);
    dailyLine = dailyShareLine({ date: s.daily, sector: s.sector, floor: s.floor, kills: s.kills, score, won: s.won });
    if (!p.daily || p.daily.date !== s.daily || score > p.daily.score) p.daily = { date: s.daily, score, sector: s.sector, floor: s.floor, kills: s.kills, won: s.won, line: dailyLine };
  }
  p.history = [s, ...p.history].slice(0, 8);
  return { profile: p, xp: lines, xpTotal: total + goals.reduce((a, g) => a + g.xp, 0), rankBefore, rankAfter, goals, newHulls, heatUnlocked: heatAfter > heatBefore ? heatAfter : null, newBest, dailyLine, summary: s, dailyScore: s.daily ? dailyScore(s) : null };
}
export function mergeCodex(c: Codex, seen: RunSummary['seen']) {
  for (const [k, n] of Object.entries(seen.enemies)) c.enemies[k] = (c.enemies[k] || 0) + n;
  for (const [k, t] of Object.entries(seen.parts)) c.parts[k] = Math.max(c.parts[k] || 0, t);
  for (const id of seen.relics) c.relics[id] = (c.relics[id] || 0) + 1;
  for (const g of seen.ghosts) { c.ghosts = [{ ...g, at: Date.now() }, ...c.ghosts.filter((x) => x.id !== g.id || !g.id)].slice(0, 60); }
}
