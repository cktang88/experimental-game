// Run state: everything that persists between nodes, plus save/load.
import { derive, starterBuild, mkPart, allParts, buildToGhost, ghostToBuild, isPart, partSlot, type Build, type Part, WEAPONS, UTILS, SECTIONS, type SectionType, MAX_SECTIONS, sectionCost } from '../data/parts';
import { RELICS, relicMods, type Rarity } from '../data/relics';
import { generateMap, type SectorMap } from './map';
import { mulberry32, pick, rint, clamp, has, type Rng } from '../util/rng';
import type { Ghost } from './ghosts';

export interface RunState {
  v: 2; seed: number; pilot: string; callsign: string; sector: number; map: SectorMap; at: string | null; visited: string[];
  build: Build; inv: Part[]; scrap: number; hp: number; relics: string[]; jumpUsed: boolean;
  stats: { kills: number; elites: number; bosses: number; scrapEarned: number; nodes: number; score: number };
  rngCalls: number; bossGhost: Ghost | null; bossGhostCount: number;
}

export function getPilotId(): string {
  try {
    let id = localStorage.getItem('gd.pilot');
    if (!id) { id = 'p' + Math.random().toString(36).slice(2, 10); localStorage.setItem('gd.pilot', id); }
    return id;
  } catch { return 'anon'; }
}

export function newRun(callsign: string, seed = (Math.random() * 2 ** 31) | 0): RunState {
  const build = starterBuild();
  const run: RunState = {
    v: 2, seed, pilot: getPilotId(), callsign, sector: 1, map: generateMap(1, seed), at: null, visited: [],
    build, inv: [mkPart('plate', 1)], scrap: 60, hp: 0, relics: [], jumpUsed: false,
    stats: { kills: 0, elites: 0, bosses: 0, scrapEarned: 0, nodes: 0, score: 0 }, rngCalls: 0, bossGhost: null, bossGhostCount: 0,
  };
  run.hp = maxHp(run);
  return run;
}
export const mods = (run: RunState) => relicMods(run.relics);
export const dv = (run: RunState) => derive(run.build, mods(run));
export const maxHp = (run: RunState) => dv(run).maxHp;
export const floorOf = (run: RunState) => (run.at ? run.map.nodes[run.at].floor : -1);
export function level(run: RunState, elite = false) { return 1 + (run.sector - 1) * 3.2 + Math.max(0, floorOf(run)) * 0.28 + (elite ? 1.2 : 0); }
export const bossLevel = (run: RunState) => run.sector * 3 + 0.6;

/** A run-scoped deterministic RNG stream (survives save/load). */
export function runRng(run: RunState): Rng {
  const r = mulberry32(run.seed + 7919 * ++run.rngCalls);
  return r;
}
export function heal(run: RunState, frac: number) { run.hp = Math.min(maxHp(run), run.hp + maxHp(run) * frac); }
export function hurt(run: RunState, amount: number) { run.hp = Math.max(1, run.hp - amount); }
/** Keep missing hull constant when the max changes (adding sections fills them). */
export function rebuildHp(run: RunState, oldMax: number) { const missing = oldMax - run.hp; run.hp = clamp(maxHp(run) - missing, 1, maxHp(run)); }
export function changeBuild(run: RunState, f: () => void) { const old = maxHp(run); f(); rebuildHp(run, old); }

export function maxTierFor(run: RunState) { return Math.min(5, 1 + Math.floor((run.sector - 1) * 1.3 + Math.max(0, floorOf(run)) / 5)); }
export function randomPart(run: RunState, rng: Rng, bonus = 0): Part {
  const ids = [...Object.keys(WEAPONS), ...Object.keys(UTILS)];
  const mt = Math.min(5, maxTierFor(run) + bonus);
  return mkPart(pick(ids, rng), clamp(rint(mt - 1, mt, rng), 1, 5));
}
export function partChoices(run: RunState, n: number, bonus = 0): Part[] {
  const rng = runRng(run), out: Part[] = [];
  while (out.length < n) { const p = randomPart(run, rng, bonus); if (!out.some((o) => o.id === p.id)) out.push(p); }
  return out;
}
export function relicChoices(run: RunState, n: number, rarities: Rarity[]): string[] {
  const rng = runRng(run);
  const pool = Object.keys(RELICS).filter((id) => rarities.includes(RELICS[id].rarity) && !run.relics.includes(id));
  const out: string[] = [];
  while (out.length < n && pool.length) { const i = Math.floor(rng() * pool.length); out.push(pool.splice(i, 1)[0]); }
  return out;
}
export function addRelic(run: RunState, id: string) { changeBuild(run, () => { if (!run.relics.includes(id)) run.relics.push(id); }); }
export function addSection(run: RunState, type: SectionType) {
  if (run.build.sections.length >= MAX_SECTIONS) return false;
  changeBuild(run, () => run.build.sections.push({ type, slots: SECTIONS[type].slots.map(() => null) }));
  return true;
}
export const nextSectionCost = (run: RunState, t: SectionType) => Math.round(sectionCost(t, run.build.sections.length) * mods(run).priceMul);

export function enterNextSector(run: RunState) {
  run.sector++; run.map = generateMap(run.sector, run.seed); run.at = null; run.visited = []; run.bossGhost = null; run.bossGhostCount = 0;
}
export function deathGhost(run: RunState): Ghost {
  return { id: `${run.pilot}-${Date.now().toString(36)}`, pilot: run.pilot, name: run.callsign, sector: run.sector, floor: Math.max(0, floorOf(run)), sections: buildToGhost(run.build), relics: run.relics.slice(), score: Math.round(run.stats.score) };
}

/* ---- save / load ---- */
const SAVE_KEY = 'gd.run.v2';
export function saveRun(run: RunState) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ ...run, build: buildToGhost(run.build), inv: run.inv.map((p) => [p.id, p.tier]) })); } catch { /* storage full or blocked */ }
}
export function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ } }
export function loadRun(): RunState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY); if (!raw) return null;
    const o = JSON.parse(raw);
    if (o?.v !== 2 || !o.map?.nodes) return null;
    const run: RunState = { ...o, build: ghostToBuild(o.build), inv: (Array.isArray(o.inv) ? o.inv : []).filter((v: unknown) => Array.isArray(v) && isPart(v[0])).map((v: [string, number]) => mkPart(v[0], clamp(Number(v[1]) || 1, 1, 5))) };
    run.relics = (run.relics || []).filter((r) => has(RELICS, r));
    run.hp = clamp(Number(run.hp) || 1, 1, maxHp(run));
    return run;
  } catch { return null; }
}
export { allParts, partSlot };
