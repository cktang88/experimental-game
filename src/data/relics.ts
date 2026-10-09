import type { Mods } from './parts';
import { neutralMods } from './parts';

export type Rarity = 'common' | 'rare' | 'boss' | 'curse';
export interface RelicDef {
  name: string; rarity: Rarity; col: string; desc: string;
  mods?: (m: Mods) => void;
  /** Flags read by combat/run code. */
  flag?: string;
}

export const RELICS: Record<string, RelicDef> = {
  scrap_siphon: { name: 'Scrap Siphon', rarity: 'common', col: '#e0c35c', desc: '+25% scrap from every source in combat.', mods: (m) => { m.scrapMul *= 1.25; } },
  heavy_keel: { name: 'Heavy Keel', rarity: 'common', col: '#9aa7b4', desc: '+60 max hull, 6% slower.', mods: (m) => { m.hullAdd += 60; m.speedMul *= 0.94; } },
  afterburner: { name: 'Afterburner Kit', rarity: 'common', col: '#ffb86b', desc: '+15% speed.', mods: (m) => { m.speedMul *= 1.15; } },
  flak_lattice: { name: 'Flak Lattice', rarity: 'common', col: '#4fd1e8', desc: '+20% damage to aircraft.', mods: (m) => { m.dmgAir *= 1.2; } },
  bunker_buster: { name: 'Bunker Buster Fuses', rarity: 'common', col: '#f2a541', desc: '+20% damage to ground targets.', mods: (m) => { m.dmgGround *= 1.2; } },
  capacitor_bank: { name: 'Capacitor Bank', rarity: 'common', col: '#4fd1e8', desc: '+35 shield, even without a generator.', mods: (m) => { m.shieldAdd += 35; } },
  magnetic_hull: { name: 'Magnetized Hull', rarity: 'common', col: '#e0c35c', desc: 'Scrap pickup radius +90.', mods: (m) => { m.magnetAdd += 90; } },
  nanite_vats: { name: 'Nanite Vats', rarity: 'common', col: '#8fe39a', desc: 'Repair 10% hull after every fight.', flag: 'heal_after_fight' },
  haggler_chip: { name: "Haggler's Chip", rarity: 'common', col: '#e0c35c', desc: 'Merchants charge 20% less.', mods: (m) => { m.priceMul *= 0.8; } },
  overclock_bus: { name: 'Overclock Bus', rarity: 'rare', col: '#ff7a6b', desc: 'All weapons fire 12% faster.', mods: (m) => { m.fireMul *= 1.12; } },
  rail_capacitors: { name: 'Rail Capacitors', rarity: 'rare', col: '#c9a6ff', desc: 'Rail Spines recharge 35% faster.', mods: (m) => { m.railCdMul *= 0.65; } },
  reactive_plating: { name: 'Reactive Plating', rarity: 'rare', col: '#9aa7b4', desc: 'The first hit in every fight does nothing.', flag: 'first_hit_free' },
  emergency_jump: { name: 'Emergency Jump Drive', rarity: 'rare', col: '#7fb6ff', desc: 'Once per run, a lethal hit leaves you at 30% hull instead.', flag: 'cheat_death' },
  chain_reactor: { name: 'Chain Reactor', rarity: 'rare', col: '#ff9f5a', desc: 'Destroyed enemies explode, damaging anything nearby.', flag: 'kill_explode' },
  salvage_drone: { name: 'Salvage Drone', rarity: 'rare', col: '#e0c35c', desc: 'Scrap anywhere on screen flies to you.', flag: 'vacuum' },
  bounty_ledger: { name: 'Bounty Ledger', rarity: 'rare', col: '#e0c35c', desc: 'Elites drop an extra part and 60 scrap.', flag: 'elite_bounty' },
  repair_cradle: { name: 'Repair Cradle', rarity: 'rare', col: '#8fe39a', desc: '+1.5 hull repaired per second in combat.', mods: (m) => { m.regen += 1.5; } },
  ghost_lens: { name: 'Ghost Lens', rarity: 'boss', col: '#ff5a4e', desc: 'Ghost bosses start with 15% less hull.', mods: (m) => { m.bossHpMul *= 0.85; } },
  war_engine: { name: 'War Engine', rarity: 'boss', col: '#ff7a6b', desc: '+25% fire rate, but merchants charge 25% more.', mods: (m) => { m.fireMul *= 1.25; m.priceMul *= 1.25; } },
  titan_frame: { name: 'Titan Frame', rarity: 'boss', col: '#9aa7b4', desc: '+30% max hull.', mods: (m) => { m.hullMul *= 1.3; } },
  parasitic_ai: { name: 'Parasitic AI', rarity: 'curse', col: '#b05cff', desc: 'Curse: 10% less max hull.', mods: (m) => { m.hullMul *= 0.9; } },
  leaking_core: { name: 'Leaking Core', rarity: 'curse', col: '#b05cff', desc: 'Curse: 8% slower.', mods: (m) => { m.speedMul *= 0.92; } },
};

export function relicMods(ids: string[]): Mods {
  const m = neutralMods();
  for (const id of ids) RELICS[id]?.mods?.(m);
  return m;
}
export const hasFlag = (ids: string[], flag: string) => ids.some((id) => RELICS[id]?.flag === flag);
export const relicCost = (id: string) => ({ common: 110, rare: 170, boss: 260, curse: 0 })[RELICS[id].rarity];
