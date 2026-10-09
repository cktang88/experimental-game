// Admiralty: ranks earned with run XP, and goals (challenges) that pay XP. Pure data; see src/game/meta.ts.
import type { HullId } from './hulls';

export interface RankDef { rank: number; title: string; xp: number; reward: string; hull?: HullId; perk?: Partial<RankPerks> }
/** Bonuses every new run starts with, accumulated from all ranks reached. */
export interface RankPerks { startScrap: number; extraPart: number; odStart: number; hullPct: number; startRelic: number }
export const noPerks = (): RankPerks => ({ startScrap: 0, extraPart: 0, odStart: 0, hullPct: 0, startRelic: 0 });

export const RANKS: RankDef[] = [
  { rank: 1, title: 'Ensign', xp: 0, reward: 'Command of the Vanguard-class dreadnought.', hull: 'vanguard' },
  { rank: 2, title: 'Lieutenant', xp: 300, reward: 'Unlocks the Leviathan carrier.', hull: 'leviathan' },
  { rank: 3, title: 'Lieutenant Commander', xp: 800, reward: 'Quartermaster: every run starts with 25 more scrap.', perk: { startScrap: 25 } },
  { rank: 4, title: 'Commander', xp: 1500, reward: 'Unlocks the Lance destroyer.', hull: 'lance' },
  { rank: 5, title: 'Captain', xp: 2500, reward: 'Requisitions: a spare Mk I part in the hold at launch.', perk: { extraPart: 1 } },
  { rank: 6, title: 'Commodore', xp: 4000, reward: 'Unlocks the Bastion monitor.', hull: 'bastion' },
  { rank: 7, title: 'Rear Admiral', xp: 6000, reward: 'Veteran crews: +8% max hull on every run.', perk: { hullPct: 0.08 } },
  { rank: 8, title: 'Vice Admiral', xp: 8500, reward: 'Hot reactors: Overdrive starts every fight 25% charged.', perk: { odStart: 0.25 } },
  { rank: 9, title: 'Admiral', xp: 12000, reward: 'Flag privileges: launch with a random common relic.', perk: { startRelic: 1 } },
  { rank: 10, title: 'Fleet Admiral', xp: 16500, reward: 'The fleet\'s gold insignia, and 50 more starting scrap.', perk: { startScrap: 50 } },
];

/** Lifetime counters kept in the profile. Goals read these. */
export interface MetaStats {
  runs: number; wins: number; deaths: number; kills: number; elites: number; bosses: number; structures: number;
  broadsides: number; maxVolley: number; overdrives: number; lanceStructures: number; scrapEarned: number;
  bestSector: number; peakCarnage: number; flawlessFights: number; maxScrapHeld: number; dailyRuns: number;
  highestHeatWon: number; hullsFlown: number; endlessSector: number; fights: number;
}
export const emptyMetaStats = (): MetaStats => ({
  runs: 0, wins: 0, deaths: 0, kills: 0, elites: 0, bosses: 0, structures: 0, broadsides: 0, maxVolley: 0, overdrives: 0,
  lanceStructures: 0, scrapEarned: 0, bestSector: 0, peakCarnage: 1, flawlessFights: 0, maxScrapHeld: 0, dailyRuns: 0,
  highestHeatWon: -1, hullsFlown: 0, endlessSector: 0, fights: 0,
});

export interface GoalDef { id: string; name: string; desc: string; metric: keyof MetaStats; goal: number; xp: number }
export const GOALS: GoalDef[] = [
  { id: 'first_blood', name: 'First Blood', desc: 'Destroy 50 enemies.', metric: 'kills', goal: 50, xp: 50 },
  { id: 'full_broadside', name: 'Full Broadside', desc: 'Fire a broadside with three guns on one side.', metric: 'maxVolley', goal: 3, xp: 120 },
  { id: 'overdrive', name: 'Redline', desc: 'Fire Overdrive 10 times.', metric: 'overdrives', goal: 10, xp: 80 },
  { id: 'rampage', name: 'Rampage', desc: 'Push the carnage meter to x3.', metric: 'peakCarnage', goal: 3, xp: 120 },
  { id: 'scorched', name: 'Scorched Earth', desc: 'Level 100 structures with the Ventral Lance.', metric: 'lanceStructures', goal: 100, xp: 150 },
  { id: 'elite', name: 'Ace Hunter', desc: 'Destroy an elite.', metric: 'elites', goal: 1, xp: 60 },
  { id: 'ghost', name: 'Exorcist', desc: 'Lay a ghost dreadnought to rest.', metric: 'bosses', goal: 1, xp: 150 },
  { id: 'sector3', name: 'Deep Strike', desc: 'Reach sector 3.', metric: 'bestSector', goal: 3, xp: 200 },
  { id: 'victory', name: 'Dreadnought Ascendant', desc: 'Win a campaign: clear all three sectors. Unlocks Heat.', metric: 'wins', goal: 1, xp: 500 },
  { id: 'heat3', name: 'Turn Up the Heat', desc: 'Win a campaign at Heat 3 or higher.', metric: 'highestHeatWon', goal: 3, xp: 600 },
  { id: 'heat8', name: 'No Quarter Given', desc: 'Win a campaign at Heat 8.', metric: 'highestHeatWon', goal: 8, xp: 1500 },
  { id: 'flawless', name: 'Untouchable', desc: 'Win 5 fights losing under 5% hull.', metric: 'flawlessFights', goal: 5, xp: 150 },
  { id: 'hoarder', name: 'War Chest', desc: 'Hold 600 scrap at once.', metric: 'maxScrapHeld', goal: 600, xp: 100 },
  { id: 'demolition', name: 'Urban Renewal', desc: 'Destroy 1,000 structures.', metric: 'structures', goal: 1000, xp: 250 },
  { id: 'exterminator', name: 'Exterminator', desc: 'Destroy 5,000 enemies.', metric: 'kills', goal: 5000, xp: 400 },
  { id: 'fleet', name: 'Whole Fleet', desc: 'Fly all four hull classes.', metric: 'hullsFlown', goal: 4, xp: 300 },
  { id: 'daily', name: 'Daily Strike', desc: 'Finish a daily strike.', metric: 'dailyRuns', goal: 1, xp: 80 },
  { id: 'endless', name: 'Beyond the Map', desc: 'Reach sector 5 in endless mode.', metric: 'endlessSector', goal: 5, xp: 600 },
];
