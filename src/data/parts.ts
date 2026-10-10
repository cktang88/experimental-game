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
  pulse: { name: 'Pulse Cannon', layer: 'air', cd: 0.16, dmg: 7, col: '#4fd1e8', cost: 40, desc: 'Rapid bolts. On the bow it hoses aircraft ahead; on a broadside it rips off twelve-round ripples.' },
  spread: { name: 'Scatter Laser', layer: 'air', cd: 0.36, dmg: 5, col: '#7ee0ff', cost: 55, desc: 'Fan of 3 bolts, 5 at Mk III and up. Broadside fans shell ground targets beside you.' },
  flak: { name: 'Flak Battery', layer: 'air', cd: 0.75, dmg: 16, col: '#ffd27a', cost: 60, desc: 'Shells burst at the target\'s range and damage every aircraft in the blast.' },
  missile: { name: 'Seeker Pods', layer: 'both', cd: 1.0, dmg: 16, col: '#ff9f5a', cost: 75, desc: 'Paired homing missiles, air or ground. Broadside pods launch outward.' },
  bomb: { name: 'Bomb Bay', layer: 'ground', cd: 0.6, dmg: 26, col: '#f2a541', cost: 45, desc: 'Ventral. Carpet-bombs the city and anything on the ground under the hull.' },
  artillery: { name: 'Siege Mortar', layer: 'ground', cd: 1.1, dmg: 34, col: '#e88a3c', cost: 70, desc: 'Ventral. Lobs shells onto ground targets up to 520 away, or into the city when none are near.' },
  rail: { name: 'Rail Spine', layer: 'both', cd: 1.7, dmg: 48, col: '#c9a6ff', cost: 95, desc: 'Charged slug pierces everything in a line: up the field from the bow, across it from a broadside.' },
  tesla: { name: 'Arc Coil', layer: 'both', cd: 0.5, dmg: 9, col: '#9be7ff', cost: 80, desc: 'All-round. Lightning jumps between nearby targets, air or ground.' },
  pd: { name: 'Point Defense', layer: 'none', cd: 0.3, dmg: 0, col: '#b8f2c8', cost: 65, desc: 'All-round. Shoots down enemy shots and missiles near your hull.' },
};
/**
 * Weapon control. AUTO weapons (light guns, flak, arc coils, point defense) pick their own targets in their arc and keep
 * the screen alive with constant fire. HEAVY weapons (rails, missiles, mortars, bombs) are the deliberate layer: they
 * sit in numbered weapon groups by family and fire where the pilot puts the reticle (left mouse: the selected group;
 * right mouse: every heavy group). On touch screens, in the balance harness and on ghosts they aim themselves.
 */
export type WeaponControl = 'auto' | 'heavy';
export type HeavyFamily = 'rail' | 'missile' | 'mortar' | 'bomb';
export interface FamilyDef {
  name: string; short: string; icon: string; col: string;
  /** How the reticle is used: 'line' fires toward it, 'lock' locks the target nearest it, 'ground' hits the ground under it. */
  aim: 'line' | 'lock' | 'ground';
  /** Ground weapons: max distance from the mount to the reticle (0 = no limit). */ reach: number;
}
/** Heavy families in group order: a ship's groups are numbered 1.. in this order, skipping families it does not carry. */
export const HEAVY_FAMILIES: Record<HeavyFamily, FamilyDef> = {
  rail: { name: 'Rail Cannons', short: 'RAIL', icon: 'hypersonic-bolt', col: '#c9a6ff', aim: 'line', reach: 0 },
  missile: { name: 'Seeker Missiles', short: 'MSL', icon: 'missile-pod', col: '#ff9f5a', aim: 'lock', reach: 0 },
  mortar: { name: 'Siege Mortars', short: 'MRT', icon: 'mortar', col: '#e88a3c', aim: 'ground', reach: 640 },
  bomb: { name: 'Bomb Bays', short: 'BMB', icon: 'falling-bomb', col: '#f2a541', aim: 'ground', reach: 420 },
};
export const FAMILY_ORDER: HeavyFamily[] = ['rail', 'missile', 'mortar', 'bomb'];
const PART_FAMILY: Record<string, HeavyFamily> = { rail: 'rail', missile: 'missile', artillery: 'mortar', bomb: 'bomb' };
/** The heavy family of a weapon part, or null for AUTO weapons. */
export const weaponFamily = (id: string): HeavyFamily | null => (has(PART_FAMILY, id) ? PART_FAMILY[id] : null);
export const weaponControl = (id: string): WeaponControl => (weaponFamily(id) ? 'heavy' : 'auto');
export interface WeaponGroup { key: number; family: HeavyFamily; def: FamilyDef; mounts: Mount[] }
/** The ship's heavy weapon groups, keyed 1.. in FAMILY_ORDER (only the families it carries). */
export function weaponGroups(mounts: Mount[]): WeaponGroup[] {
  const out: WeaponGroup[] = [];
  for (const f of FAMILY_ORDER) {
    const ms = mounts.filter((m) => m.part && weaponFamily(m.part.id) === f);
    if (ms.length) out.push({ key: out.length + 1, family: f, def: HEAVY_FAMILIES[f], mounts: ms });
  }
  return out;
}
/** AUTO weapon mounts: they fire on their own. */
export const autoMounts = (mounts: Mount[]) => mounts.filter((m) => m.part && has(WEAPONS, m.part.id) && weaponControl(m.part.id) === 'auto');
/**
 * Scrap magnet (field units): scrap within `base + perTier · magnet tiers + relic magnetAdd` of the hull's edge is pulled
 * in, accelerating; scrap within `collect` of the hull is taken at once. See combat.ts updatePickups.
 */
export const MAGNET = { base: 240, perTier: 80, collect: 26, accel: 2600, maxSpeed: 1500 } as const;
export const droneCount = (t: number) => Math.min(3, 1 + Math.floor((t - 1) / 2));
export const UTILS: Record<string, UtilDef> = {
  plate: { name: 'Armor Plating', col: '#9aa7b4', cost: 40, desc: (t) => `+${35 * t} max hull.` },
  shield: { name: 'Shield Generator', col: '#4fd1e8', cost: 70, desc: (t) => `${30 * t} shield that recharges after 2s without a hit.` },
  thruster: { name: 'Vector Thrusters', col: '#ffb86b', cost: 45, desc: (t) => `+${12 * t}% speed.` },
  reactor: { name: 'Overclock Reactor', col: '#ff7a6b', cost: 75, desc: (t) => `+${10 * t}% fire rate on every weapon.` },
  repair: { name: 'Repair Swarm', col: '#8fe39a', cost: 65, desc: (t) => `Repairs ${(1.2 * t).toFixed(1)} hull per second in combat.` },
  magnet: { name: 'Salvage Magnet', col: '#e0c35c', cost: 35, desc: (t) => `Scrap magnet reach +${MAGNET.perTier * t}, +${10 * t}% scrap.` },
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

/**
 * Firing arcs. Every weapon mount gets one from where it sits on the hull, and the weapon in it decides how it is used:
 *  - bow: the Command Bridge, at the front. A forward cone; engages air AND ground targets ahead.
 *  - dorsal: Gun Deck turrets on the top deck. Turn all the way round, but cannot depress below the hull, so they
 *    engage AIR targets only (aircraft and ghost dreadnoughts).
 *  - broadside: Broadside Battery sections. The outer mounts fire to port (left) or starboard (right) inside a flank
 *    sector, the centre mount to whichever side has a target. Air AND ground, in synchronized ripple volleys.
 *  - ventral: any bomb bay or mortar, wherever it is mounted. Drops ordnance on the ground only.
 *  - omni: point defense (shoots enemy fire) and arc coils (lightning in every direction; air only from the top deck).
 * mountTraverse() gives the exact sectors and target layers; combat, ghosts, the HUD and the ship renderer all read it.
 */
export type Arc = 'bow' | 'dorsal' | 'broadside' | 'ventral' | 'omni' | 'internal';
export const ARC_INFO: Record<Arc, { label: string; short: string; col: string; desc: string }> = {
  bow: { label: 'Bow', short: 'BOW', col: '#4fd1e8', desc: 'Front mount: a forward cone, air and ground targets ahead of the ship.' },
  dorsal: { label: 'Top deck', short: 'TOP', col: '#7fb6ff', desc: 'Top-deck turret: turns all the way round but cannot depress below the hull, so air targets only.' },
  broadside: { label: 'Broadside', short: 'SIDE', col: '#f2a541', desc: 'Side mount: fires into its flank in ripple volleys at anything level with the hull, air or ground.' },
  ventral: { label: 'Ventral', short: 'BELLY', col: '#e88a3c', desc: 'Drops ordnance on the city and ground targets below and around the ship. Ground only.' },
  omni: { label: 'All-round', short: 'OMNI', col: '#9be7ff', desc: 'Works in every direction around the hull.' },
  internal: { label: 'Internal', short: 'BAY', col: '#9aa7b4', desc: 'Utility bay inside the hull.' },
};
/** The arc a mount position gives, before the weapon in it is considered. */
export function positionArc(type: SectionType, kind: SlotKind): Arc {
  if (kind === 'U') return 'internal';
  return type === 'battery' ? 'broadside' : type === 'gundeck' ? 'dorsal' : 'bow';
}
/** The arc a part actually fires in from a mount: bombs and mortars always drop ventrally, coils and PD are omni. */
export function mountArc(type: SectionType, kind: SlotKind, partId: string | null | undefined): Arc {
  if (kind === 'U') return 'internal';
  if (partId && has(WEAPONS, partId)) {
    if (WEAPONS[partId].layer === 'ground') return 'ventral';
    if (partId === 'tesla' || partId === 'pd') return 'omni';
  }
  return positionArc(type, kind);
}
/** What a mount can engage: 'shots' is point defense (enemy fire), 'none' a utility bay. */
export type TargetLayers = 'air' | 'ground' | 'both' | 'shots' | 'none';
/** One traverse sector in SHIP space: radians, 0 = dead ahead (the bow), +PI/2 = starboard, -PI/2 = port. */
export interface Sector { c: number; h: number }
export interface Traverse {
  arc: Arc;
  /** Sectors the mount can train in (empty for utility bays). A full circle is { c: 0, h: PI }. */ sectors: Sector[];
  /** What it can engage from here. */ layers: TargetLayers;
  /** Ventral ordnance falls; nothing to train. */ down: boolean;
}
/** Traverse half-widths by arc (radians). */
export const TRAVERSE = { bow: 0.75, broadside: 1.0 } as const;
const FULL: Sector[] = [{ c: 0, h: Math.PI }];
/**
 * The traverse of a weapon in a mount: sectors in ship space and the layers it can engage. `side` is the broadside
 * side (-1 port, 1 starboard, 0 either). Ghosts and the player share it; the ship renderer clamps turret yaw to it.
 */
export function mountTraverse(type: SectionType, kind: SlotKind, partId: string | null | undefined, side: -1 | 0 | 1 = 0): Traverse {
  const arc = mountArc(type, kind, partId), pos = positionArc(type, kind);
  switch (arc) {
    case 'internal': return { arc, sectors: [], layers: 'none', down: false };
    case 'bow': return { arc, sectors: [{ c: 0, h: TRAVERSE.bow }], layers: 'both', down: false };
    case 'dorsal': return { arc, sectors: FULL, layers: 'air', down: false };
    case 'broadside': {
      const h = TRAVERSE.broadside;
      return { arc, sectors: side ? [{ c: (side * Math.PI) / 2, h }] : [{ c: -Math.PI / 2, h }, { c: Math.PI / 2, h }], layers: 'both', down: false };
    }
    case 'ventral': return { arc, sectors: FULL, layers: 'ground', down: true };
    case 'omni': return { arc, sectors: FULL, layers: partId === 'pd' ? 'shots' : pos === 'dorsal' ? 'air' : 'both', down: false };
  }
}
/** Field angle of a ship-space angle. The player's bow points up the screen; a ghost's (mirrored: y flipped) down. */
export const shipToField = (a: number, mirrored = false) => (mirrored ? Math.PI / 2 - a : a - Math.PI / 2);
export const fieldToShip = (a: number, mirrored = false) => (mirrored ? Math.PI / 2 - a : a + Math.PI / 2);
const wrapPi = (a: number) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };
/** Is a field-space bearing inside the traverse? */
export function inTraverse(t: Traverse, fieldAngle: number, mirrored = false) {
  const a = fieldToShip(fieldAngle, mirrored);
  return t.sectors.some((s) => Math.abs(wrapPi(a - s.c)) <= s.h + 1e-9);
}
/** Clamp a field-space bearing into the nearest traverse sector (field angle out). */
export function clampTraverse(t: Traverse, fieldAngle: number, mirrored = false) {
  if (!t.sectors.length) return fieldAngle;
  const a = fieldToShip(fieldAngle, mirrored);
  let best = a, bd = Infinity;
  for (const s of t.sectors) {
    const d = wrapPi(a - s.c), k = Math.max(-s.h, Math.min(s.h, d)), off = Math.abs(d - k);
    if (off < bd) { bd = off; best = s.c + k; }
  }
  return shipToField(best, mirrored);
}
/** Can a mount that engages `layers` hit a target on `layer`? Enemy layers are 'air', 'ground', or 'both' for a ghost
 *  dreadnought: a flying ship, so air guns reach it and ground ordnance does not. */
export const layersHit = (layers: TargetLayers, layer: string) =>
  layers === 'both' || layers === layer || (layer === 'both' && layers === 'air');
/** Short HUD/refit tag for target layers. */
export const LAYERS_TAG: Record<TargetLayers, string> = { air: 'AIR', ground: 'GND', both: 'ALL', shots: 'PD', none: '' };
/** Where a weapon works, for part cards: what each placement lets it engage. */
export function placementNote(id: string): string {
  if (!has(WEAPONS, id)) return 'Utility bay.';
  if (id === 'pd') return 'Any weapon mount: shoots down enemy fire all round.';
  if (WEAPONS[id].layer === 'ground') return 'Any weapon mount: drops from the belly, ground only.';
  if (id === 'tesla') return 'All round. Bow or side: air and ground. Top deck: air only.';
  return 'Bow (forward cone) or side (flank): air and ground. Top deck: all round, air only.';
}
export interface Mount {
  ox: number; oy: number; kind: SlotKind; part: Part | null; si: number; i: number;
  /** Arc this mount fires in with its current part (see Arc). */
  arc: Arc;
  /** Broadside side: -1 port (left), 1 starboard (right), 0 either. 0 for other arcs. */
  side: -1 | 0 | 1;
  /** Traverse sectors and target layers (mountTraverse). */
  trav: Traverse;
}
export interface Derived {
  /** Top speed (field units/s), acceleration and braking (units/s²): mass makes all three worse, thrust better. */
  accel: number; brake: number;
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
      const arc = mountArc(s.type, k, p?.id);
      const side: -1 | 0 | 1 = arc === 'broadside' ? (ox < -1 ? -1 : ox > 1 ? 1 : 0) : 0;
      mounts.push({ ox, oy: y + d.h / 2, kind: k, part: p, si, i, arc, side, trav: mountTraverse(s.type, k, p?.id, side) });
      if (p && has(UTILS, p.id)) u[p.id] += p.tier;
    });
    y += d.h; width = Math.max(width, d.w);
  });
  const off = y / 2;
  rects.forEach((r) => (r.y -= off));
  mounts.forEach((m) => (m.oy -= off));
  hp = (hp + 35 * u.plate + mods.hullAdd) * mods.hullMul;
  const speed = (290 * (1 + thrust * 0.05)) / (1 + mass * 0.075) * (1 + 0.12 * u.thruster) * mods.speedMul;
  // Seconds to reach top speed: a starter hull answers in about a third of a second, a full eight-section
  // dreadnought takes most of a second to get going and to stop.
  const accelTime = Math.max(0.24, Math.min(1, 0.22 + mass * 0.032 - thrust * 0.006 - u.thruster * 0.02));
  const accel = speed / accelTime, brake = accel * 1.25;
  const shieldMax = 30 * u.shield + mods.shieldAdd;
  return {
    accel, brake,
    maxHp: Math.round(hp), speed, shieldMax, shieldRegen: shieldMax ? 8 + 4 * u.shield + (u.shield ? 0 : 6) : 0,
    regen: 1.2 * u.repair + mods.regen, fireMult: (1 + 0.1 * u.reactor) * mods.fireMul,
    magnet: MAGNET.base + MAGNET.perTier * u.magnet + mods.magnetAdd, scrapMult: (1 + 0.1 * u.magnet) * mods.scrapMul,
    drones: u.drones ? droneCount(Math.min(5, u.drones)) : 0, droneTier: Math.min(5, u.drones),
    rects, mounts, len: y, width, mass, thrust, u, mods,
  };
}

/** The Vanguard starter: one bow gun, a broadside pair either side of a ventral bomb bay. Other hulls: data/hulls.ts. */
export const starterBuild = (): Build => ({
  sections: [
    { type: 'bridge', slots: [mkPart('pulse', 1)] },
    { type: 'battery', slots: [mkPart('pulse', 1), mkPart('bomb', 1), mkPart('pulse', 1)] },
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
