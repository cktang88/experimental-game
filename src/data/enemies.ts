export type EnemyType =
  | 'heli' | 'jet' | 'drone' | 'gunship' | 'bomber'
  | 'tank' | 'infantry' | 'turret' | 'sam' | 'bunker'
  | 'cache' | 'canister' | 'wreck'
  | 'ace' | 'crawler' | 'carrier';

export interface EnemyDef {
  layer: 'air' | 'ground'; hp: number; r: number; scrap: number; score: number; cost: number; min?: number; salvage?: boolean; elite?: boolean; name?: string;
  /** Weapon range to the player's hull, in field units. Out-range them with broadsides (760) and mortars (520). */
  range?: number;
  /** Codex line. */
  info?: string;
}

export const EN: Record<EnemyType, EnemyDef> = {
  heli: { layer: 'air', hp: 16, r: 13, scrap: 3, score: 50, cost: 2, range: 560, name: 'Attack helicopter', info: 'Takes station beside the hull and plinks at it. Broadside fodder.' },
  jet: { layer: 'air', hp: 9, r: 11, scrap: 2, score: 40, cost: 2, range: 520, name: 'Interceptor', info: 'Dives from ahead or strafes across the beam, fires once and breaks away.' },
  drone: { layer: 'air', hp: 5, r: 8, scrap: 1, score: 15, cost: 3, range: 420, name: 'Swarm drone', info: 'Weaving columns of cheap drones. Bow guns eat them.' },
  gunship: { layer: 'air', hp: 70, r: 22, scrap: 10, score: 200, cost: 6, min: 2, range: 640, name: 'Gunship', info: 'Holds a flank and fires telegraphed fans. Turn a broadside to it.' },
  bomber: { layer: 'air', hp: 140, r: 28, scrap: 16, score: 350, cost: 9, min: 4, range: 320, name: 'Heavy bomber', info: 'Crosses the field level with you, dropping walls of fire.' },
  tank: { layer: 'ground', hp: 26, r: 12, scrap: 3, score: 60, cost: 2, range: 440, name: 'Flak tank', info: 'Platoons of armor firing up at the hull. Bomb them as they pass under.' },
  infantry: { layer: 'ground', hp: 4, r: 5, scrap: 1, score: 10, cost: 2, range: 300, name: 'Infantry squad', info: 'Rifles against a dreadnought. Brave, short-ranged, brief.' },
  turret: { layer: 'ground', hp: 45, r: 14, scrap: 5, score: 90, cost: 3, range: 520, name: 'AA emplacement', info: 'Fixed guns that wind up a three-round burst.' },
  sam: { layer: 'ground', hp: 34, r: 13, scrap: 6, score: 120, cost: 4, min: 2, range: 900, name: 'SAM site', info: 'Launches homing missiles you can shoot down.' },
  bunker: { layer: 'ground', hp: 150, r: 22, scrap: 18, score: 400, cost: 8, min: 4, range: 380, name: 'Flak bunker', info: 'Throws rings of flak. Out-range it with mortars and broadsides.' },
  // scrap sources: they never shoot
  cache: { layer: 'ground', hp: 30, r: 13, scrap: 16, score: 30, cost: 0, salvage: true, name: 'Supply cache', info: 'Crates of salvage. Bomb them open.' },
  wreck: { layer: 'ground', hp: 70, r: 20, scrap: 28, score: 40, cost: 0, salvage: true, name: 'Wreckage', info: 'A downed warship. Rich in scrap, sometimes a repair kit.' },
  canister: { layer: 'air', hp: 12, r: 9, scrap: 10, score: 20, cost: 0, salvage: true, name: 'Salvage canister', info: 'Drifting cargo. Shoot it or ram it.' },
  // elites
  ace: { layer: 'air', hp: 480, r: 30, scrap: 60, score: 2500, cost: 0, elite: true, name: 'Ace Gunship', range: 720, info: 'Circles the dreadnought at broadside range, sighting before each burst.' },
  crawler: { layer: 'ground', hp: 900, r: 40, scrap: 70, score: 3000, cost: 0, elite: true, name: 'Siege Crawler', info: 'A walking fortress that creeps barrages across your path.' },
  carrier: { layer: 'air', hp: 780, r: 44, scrap: 70, score: 3000, cost: 0, elite: true, name: 'Drone Carrier', info: 'Holds the top of the field and launches drone waves.' },
};

export interface Encounter {
  id: string; name: string; kind: 'fight' | 'elite' | 'boss';
  duration: number; rate: number; salvage: number;
  weights: Partial<Record<EnemyType, number>>;
  elite?: EnemyType;
}

const ALL: Partial<Record<EnemyType, number>> = { heli: 3, jet: 3, drone: 2, gunship: 1.5, bomber: 1, tank: 3, infantry: 2, turret: 2, sam: 1.5, bunker: 1 };
export const FIGHTS: Encounter[] = [
  { id: 'patrol', name: 'Border Patrol', kind: 'fight', duration: 34, rate: 1, salvage: 4, weights: ALL },
  { id: 'air_wing', name: 'Air Wing', kind: 'fight', duration: 32, rate: 1.05, salvage: 3, weights: { heli: 4, jet: 5, drone: 4, gunship: 2, bomber: 1.5, sam: 1 } },
  { id: 'armored_column', name: 'Armored Column', kind: 'fight', duration: 34, rate: 1.05, salvage: 5, weights: { tank: 6, infantry: 4, turret: 2, sam: 1.5, heli: 1, bunker: 1 } },
  { id: 'fortress_line', name: 'Fortress Line', kind: 'fight', duration: 36, rate: 0.95, salvage: 4, weights: { turret: 5, bunker: 2.5, sam: 3, infantry: 2, jet: 1.5 } },
  { id: 'swarm', name: 'Drone Swarm', kind: 'fight', duration: 30, rate: 1.15, salvage: 3, weights: { drone: 7, jet: 2, heli: 1, turret: 1 } },
];
export const ELITES: Encounter[] = [
  { id: 'ace', name: 'Ace Squadron', kind: 'elite', duration: 22, rate: 0.45, salvage: 3, weights: { jet: 4, drone: 2, heli: 1 }, elite: 'ace' },
  { id: 'crawler', name: 'Siege Crawler', kind: 'elite', duration: 22, rate: 0.4, salvage: 4, weights: { infantry: 3, tank: 3, turret: 1 }, elite: 'crawler' },
  { id: 'carrier', name: 'Carrier Group', kind: 'elite', duration: 22, rate: 0.4, salvage: 3, weights: { jet: 3, heli: 2, sam: 1 }, elite: 'carrier' },
];
export const BOSS_ENCOUNTER: Encounter = { id: 'boss', name: 'Ghost Dreadnought', kind: 'boss', duration: 9999, rate: 0, salvage: 2, weights: { heli: 1, turret: 1, tank: 1, jet: 1 } };
export const AMBUSH: Encounter = { id: 'ambush', name: 'Ambush', kind: 'fight', duration: 26, rate: 1.35, salvage: 2, weights: ALL };
