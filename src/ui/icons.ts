// Icon library: single-colour game-icons.net glyphs (CC BY 3.0, see CREDITS.md) inlined as path data,
// so nothing is fetched at runtime. Works for DOM (icon()) and Canvas2D (drawIcon()).
import { ICON_DATA } from './icons-data';
import { svg } from './h';

const has = (id: string) => Object.prototype.hasOwnProperty.call(ICON_DATA, id);

export const NODE_ICON: Record<string, string> = {
  fight: 'crosshair', elite: 'crowned-skull', merchant: 'trade', event: 'aerial-signal', derelict: 'sinking-ship', drydock: 'auto-repair', boss: 'spectre',
};
export const PART_ICON: Record<string, string> = {
  pulse: 'plasma-bolt', spread: 'laser-burst', flak: 'spiky-explosion', missile: 'missile-pod', bomb: 'falling-bomb', artillery: 'mortar',
  rail: 'hypersonic-bolt', tesla: 'lightning-arc', pd: 'laser-turret',
  plate: 'metal-plate', shield: 'energy-shield', thruster: 'rocket-thruster', reactor: 'reactor', repair: 'auto-repair', magnet: 'magnet', drones: 'delivery-drone',
};
export const SECTION_ICON: Record<string, string> = {
  bridge: 'control-tower', gundeck: 'cannon', battery: 'battleship', armor: 'metal-plate', spine: 'gears', engine: 'rocket-thruster',
};
export const RELIC_ICON: Record<string, string> = {
  scrap_siphon: 'coins-pile', heavy_keel: 'anchor', afterburner: 'thrust', flak_lattice: 'shieldcomb', bunker_buster: 'cluster-bomb',
  capacitor_bank: 'bottled-bolt', magnetic_hull: 'magnet-blast', nanite_vats: 'chemical-tank', haggler_chip: 'two-coins', overclock_bus: 'cogsplosion',
  rail_capacitors: 'power-lightning', reactive_plating: 'layered-armor', emergency_jump: 'star-gate', chain_reactor: 'nuclear', salvage_drone: 'satellite',
  bounty_ledger: 'target-poster', repair_cradle: 'lightning-spanner', ghost_lens: 'eye-target', war_engine: 'gears', titan_frame: 'iron-hulled-warship',
  parasitic_ai: 'tentacles-skull', leaking_core: 'radioactive',
};

export const HULL_ICON: Record<string, string> = { vanguard: 'battleship', leviathan: 'delivery-drone', lance: 'hypersonic-bolt', bastion: 'layered-armor' };
export const OVERDRIVE_ICON: Record<string, string> = { lance: 'laser-burst', wing: 'jet-fighter', spear: 'hypersonic-bolt', bulwark: 'energy-shield' };
export const ENEMY_ICON: Record<string, string> = {
  heli: 'helicopter', jet: 'jet-fighter', drone: 'delivery-drone', gunship: 'helicopter', bomber: 'stealth-bomber', tank: 'battle-tank', infantry: 'person',
  turret: 'laser-turret', sam: 'missile-launcher', bunker: 'guarded-tower', cache: 'cargo-crate', wreck: 'sinking-ship', canister: 'chemical-tank',
  ace: 'jet-fighter', crawler: 'great-war-tank', carrier: 'battleship',
};

/** Resolve any game id (part, relic, section, node) or raw icon id to a drawable icon id. */
export function iconId(id: string, fallback = 'medal') {
  if (has(id)) return id;
  const m = PART_ICON[id] || RELIC_ICON[id] || SECTION_ICON[id] || NODE_ICON[id] || HULL_ICON[id] || ENEMY_ICON[id];
  return m && has(m) ? m : fallback;
}

/** Inline SVG icon tinted with currentColor. Decorative unless a title is given. */
export function icon(id: string, cls = 'ico', title = ''): SVGSVGElement {
  const s = svg('svg', { class: cls, viewBox: '0 0 512 512', fill: 'currentColor', 'aria-hidden': title ? null : 'true', role: title ? 'img' : null, 'aria-label': title || null, focusable: 'false' });
  s.append(svg('path', { d: ICON_DATA[iconId(id)] }));
  return s;
}

/** SVG <g> with the icon centred on (0,0) inside a size x size box: for composing into other SVGs. */
export function iconG(id: string, size: number, attrs: Record<string, any> = {}): SVGGElement {
  const k = size / 512;
  const g = svg('g', { ...attrs, transform: `${attrs.transform ? attrs.transform + ' ' : ''}translate(${-size / 2} ${-size / 2}) scale(${k})` });
  g.append(svg('path', { d: ICON_DATA[iconId(id)] }));
  return g;
}

const cache = new Map<string, Path2D>();
/** Draw an icon on a canvas, centred on (x, y) in a size x size box. */
export function drawIcon(c: CanvasRenderingContext2D, id: string, x: number, y: number, size: number, color: string) {
  const key = iconId(id);
  let p = cache.get(key);
  if (!p) { p = new Path2D(ICON_DATA[key]); cache.set(key, p); }
  const k = size / 512;
  c.save(); c.translate(x - size / 2, y - size / 2); c.scale(k, k); c.fillStyle = color; c.fill(p); c.restore();
}
