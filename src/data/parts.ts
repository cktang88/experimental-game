import { has } from '../util/rng';
import { SHIP_SCALE } from '../game/field';

export type Layer = 'air' | 'ground' | 'both' | 'none';
export type SlotKind = 'W' | 'U';
export interface Part { id: string; tier: number; uid: number }
export interface Section { type: SectionType; slots: (Part | null)[] }
export interface Build { sections: Section[] }

export interface WeaponDef { name: string; layer: Layer; cd: number; dmg: number; col: string; cost: number; desc: string }
export interface UtilDef { name: string; col: string; cost: number; desc: (t: number) => string }

export const WEAPONS: Record<string, WeaponDef> = {
  pulse: { name: 'Pulse Cannon', layer: 'air', cd: 0.16, dmg: 7, col: '#4fd1e8', cost: 40, desc: 'Rapid forward bolts.' },
  spread: { name: 'Scatter Laser', layer: 'air', cd: 0.36, dmg: 5, col: '#7ee0ff', cost: 55, desc: 'Fan of 3 bolts, 5 at Mk III and up.' },
  flak: { name: 'Flak Battery', layer: 'air', cd: 0.75, dmg: 16, col: '#ffd27a', cost: 60, desc: 'Shells burst ahead and damage every aircraft in the blast.' },
  missile: { name: 'Seeker Pods', layer: 'both', cd: 1.0, dmg: 16, col: '#ff9f5a', cost: 75, desc: 'Paired homing missiles.' },
  bomb: { name: 'Bomb Bay', layer: 'ground', cd: 0.6, dmg: 22, col: '#f2a541', cost: 45, desc: 'Bombs blast ground targets just ahead of the bow.' },
  artillery: { name: 'Siege Mortar', layer: 'ground', cd: 1.1, dmg: 34, col: '#e88a3c', cost: 70, desc: 'Lobs shells onto the nearest ground target.' },
  rail: { name: 'Rail Spine', layer: 'both', cd: 1.7, dmg: 48, col: '#c9a6ff', cost: 95, desc: 'Charged slug pierces everything in a straight line.' },
  tesla: { name: 'Arc Coil', layer: 'both', cd: 0.5, dmg: 9, col: '#9be7ff', cost: 80, desc: 'Lightning jumps between nearby targets.' },
  pd: { name: 'Point Defense', layer: 'none', cd: 0.3, dmg: 0, col: '#b8f2c8', cost: 65, desc: 'Shoots down enemy shots and missiles near your hull.' },
};
export const droneCount = (t: number) => Math.min(3, 1 + Math.floor((t - 1) / 2));
export const UTILS: Record<string, UtilDef> = {
  plate: { name: 'Armor Plating', col: '#9aa7b4', cost: 40, desc: (t) => `+${35 * t} max hull.` },
  shield: { name: 'Shield Generator', col: '#4fd1e8', cost: 70, desc: (t) => `${30 * t} shield that recharges after 2s without a hit.` },
  thruster: { name: 'Vector Thrusters', col: '#ffb86b', cost: 45, desc: (t) => `+${12 * t}% speed.` },
  reactor: { name: 'Overclock Reactor', col: '#ff7a6b', cost: 75, desc: (t) => `+${10 * t}% fire rate on every weapon.` },
  repair: { name: 'Repair Swarm', col: '#8fe39a', cost: 65, desc: (t) => `Repairs ${(1.2 * t).toFixed(1)} hull per second in combat.` },
  magnet: { name: 'Salvage Magnet', col: '#e0c35c', cost: 35, desc: (t) => `Wider scrap pickup, +${10 * t}% scrap.` },
  drones: { name: 'Drone Bay', col: '#7fb6ff', cost: 85, desc: (t) => `${droneCount(t)} escort drone${droneCount(t) > 1 ? 's' : ''} that shoot aircraft.` },
};

export type SectionType = 'bridge' | 'gundeck' | 'battery' | 'armor' | 'spine' | 'engine';
export interface SectionDef { name: string; w: number; h: number; hp: number; mass: number; thrust: number; slots: SlotKind[]; cost: number }
export const SECTIONS: Record<SectionType, SectionDef> = {
  bridge: { name: 'Command Bridge', w: 34, h: 24, hp: 60, mass: 2, thrust: 4, slots: ['W'], cost: 0 },
  gundeck: { name: 'Gun Deck', w: 42, h: 16, hp: 30, mass: 2, thrust: 0, slots: ['W', 'W'], cost: 70 },
  battery: { name: 'Broadside Battery', w: 60, h: 15, hp: 35, mass: 3, thrust: 0, slots: ['W', 'W', 'W'], cost: 140 },
  armor: { name: 'Armored Hull', w: 40, h: 16, hp: 90, mass: 3, thrust: 0, slots: ['U'], cost: 60 },
  spine: { name: 'Utility Spine', w: 32, h: 16, hp: 30, mass: 1.5, thrust: 0, slots: ['U', 'U'], cost: 80 },
  engine: { name: 'Engine Block', w: 34, h: 16, hp: 25, mass: 1, thrust: 8, slots: ['U'], cost: 55 },
};
export const MAX_SECTIONS = 8;
export const TIER = ['', 'I', 'II', 'III', 'IV', 'V'];

let UID = 1;
export const mkPart = (id: string, tier: number): Part => ({ id, tier, uid: UID++ });
export const isPart = (id: unknown): id is string => has(WEAPONS, id) || has(UTILS, id);
export const isWeapon = (id: string) => has(WEAPONS, id);
export const partDef = (id: string): WeaponDef | UtilDef => (has(WEAPONS, id) ? WEAPONS[id] : UTILS[id]);
export const partSlot = (id: string): SlotKind => (has(WEAPONS, id) ? 'W' : 'U');
export const partName = (p: Part) => `${partDef(p.id).name} Mk ${TIER[p.tier]}`;
export const partDesc = (p: Part) => { const d = partDef(p.id); return typeof d.desc === 'function' ? d.desc(p.tier) : d.desc; };
export const partCost = (p: Part) => Math.round(partDef(p.id).cost * Math.pow(p.tier, 1.35));
export const partLayer = (p: Part): Layer | 'util' => (has(WEAPONS, p.id) ? WEAPONS[p.id].layer : 'util');
export const wDmg = (p: Part) => WEAPONS[p.id].dmg * (1 + 0.45 * (p.tier - 1));
export const wCd = (p: Part) => WEAPONS[p.id].cd * (1 - 0.07 * (p.tier - 1));
export const sectionCost = (t: SectionType, count: number) => Math.round(SECTIONS[t].cost * (1 + 0.15 * count));

/** Stat modifiers granted by relics. Everything defaults to neutral. */
export interface Mods {
  hullAdd: number; hullMul: number; speedMul: number; fireMul: number; shieldAdd: number; magnetAdd: number;
  scrapMul: number; dmgAir: number; dmgGround: number; regen: number; priceMul: number; railCdMul: number; bossHpMul: number;
}
export const neutralMods = (): Mods => ({ hullAdd: 0, hullMul: 1, speedMul: 1, fireMul: 1, shieldAdd: 0, magnetAdd: 0, scrapMul: 1, dmgAir: 1, dmgGround: 1, regen: 0, priceMul: 1, railCdMul: 1, bossHpMul: 1 });

export interface Rect { x: number; y: number; w: number; h: number; type: SectionType }
export interface Mount { ox: number; oy: number; kind: SlotKind; part: Part | null; si: number; i: number }
export interface Derived {
  maxHp: number; speed: number; shieldMax: number; shieldRegen: number; regen: number; fireMult: number; magnet: number;
  scrapMult: number; drones: number; droneTier: number; rects: Rect[]; mounts: Mount[]; len: number; width: number; mass: number; thrust: number;
  u: Record<string, number>; mods: Mods;
}

export function derive(build: Build, mods: Mods = neutralMods()): Derived {
  let hp = 0, mass = 0, thrust = 0, y = 0, width = 0;
  const rects: Rect[] = [], mounts: Mount[] = [];
  const u: Record<string, number> = { plate: 0, shield: 0, thruster: 0, reactor: 0, repair: 0, magnet: 0, drones: 0 };
  build.sections.forEach((s, si) => {
    const d0 = SECTIONS[s.type], d = { ...d0, w: d0.w * SHIP_SCALE, h: d0.h * SHIP_SCALE };
    hp += d.hp; mass += d.mass; thrust += d.thrust;
    rects.push({ x: -d.w / 2, y, w: d.w, h: d.h, type: s.type });
    const n = d.slots.length;
    d.slots.forEach((k, i) => {
      const ox = n === 1 ? 0 : n === 2 ? (i ? 1 : -1) * d.w * 0.27 : (i - 1) * d.w * 0.36;
      const p = s.slots[i] ?? null;
      mounts.push({ ox, oy: y + d.h / 2, kind: k, part: p, si, i });
      if (p && has(UTILS, p.id)) u[p.id] += p.tier;
    });
    y += d.h; width = Math.max(width, d.w);
  });
  const off = y / 2;
  rects.forEach((r) => (r.y -= off));
  mounts.forEach((m) => (m.oy -= off));
  hp = (hp + 35 * u.plate + mods.hullAdd) * mods.hullMul;
  const speed = (250 * (1 + thrust * 0.05)) / (1 + mass * 0.075) * (1 + 0.12 * u.thruster) * mods.speedMul;
  const shieldMax = 30 * u.shield + mods.shieldAdd;
  return {
    maxHp: Math.round(hp), speed, shieldMax, shieldRegen: shieldMax ? 8 + 4 * u.shield + (u.shield ? 0 : 6) : 0,
    regen: 1.2 * u.repair + mods.regen, fireMult: (1 + 0.1 * u.reactor) * mods.fireMul,
    magnet: 80 + 45 * u.magnet + mods.magnetAdd, scrapMult: (1 + 0.1 * u.magnet) * mods.scrapMul,
    drones: u.drones ? droneCount(Math.min(5, u.drones)) : 0, droneTier: Math.min(5, u.drones),
    rects, mounts, len: y, width, mass, thrust, u, mods,
  };
}

export const starterBuild = (): Build => ({
  sections: [
    { type: 'bridge', slots: [mkPart('pulse', 1)] },
    { type: 'gundeck', slots: [mkPart('pulse', 1), mkPart('bomb', 1)] },
    { type: 'engine', slots: [null] },
  ],
});

export type GhostSections = { type: string; slots: ([string, number] | null)[] }[];
export const buildToGhost = (b: Build): GhostSections => b.sections.map((s) => ({ type: s.type, slots: s.slots.map((p) => (p ? [p.id, p.tier] as [string, number] : null)) }));
export function ghostToBuild(sections: unknown): Build {
  const secs: Section[] = [];
  const arr = Array.isArray(sections) ? sections.slice(0, MAX_SECTIONS) : [];
  for (const s of arr) {
    if (!s || !has(SECTIONS, s.type)) continue;
    const d = SECTIONS[s.type as SectionType];
    const slots = d.slots.map((k, i) => {
      const v = Array.isArray(s.slots) ? s.slots[i] : null;
      if (!Array.isArray(v)) return null;
      const id = v[0];
      if (!isPart(id) || partSlot(id) !== k) return null;
      return mkPart(id, Math.min(5, Math.max(1, Math.round(Number(v[1]) || 1))));
    });
    secs.push({ type: s.type as SectionType, slots });
  }
  if (!secs.some((s) => s.type === 'bridge')) secs.unshift({ type: 'bridge', slots: [mkPart('pulse', 1)] });
  return { sections: secs };
}
export const allParts = (b: Build) => b.sections.flatMap((s) => s.slots.filter((p): p is Part => !!p));
