// Documents and objects the screens are built from: requisition slips (parts), enamel insignia pins (relics),
// and the bridge status rail that sits on top of every node screen.
import { partDesc, partLayer, partSlot, partDef, TIER, type Part } from '../data/parts';
import { RELICS } from '../data/relics';
import type { RunState } from '../game/run';
import { maxHp } from '../game/run';
import { el, svg, hash, pad, type Child } from './h';
import { icon, iconG } from './icons';
import { flap, plateK, segBar, stamp, tape } from './kit';
import { uiSound } from './sound';

const LAYER_LABEL: Record<string, string> = { air: 'AIR', ground: 'GROUND', both: 'AIR + GND', none: 'DEFENSE', util: 'UTILITY' };
export const layerTag = (p: Part) => el('em', 'layer ' + partLayer(p), LAYER_LABEL[partLayer(p)]);

/** Mk rank as a row of lamps: lit up to the tier. */
export function rankPips(tier: number, max = 5) {
  const r = el('span', { class: 'pips', 'aria-label': `Mark ${TIER[tier] ?? tier}` });
  for (let i = 1; i <= max; i++) r.append(el('i', i <= tier ? 'on' : null));
  return r;
}

// The slip the player just approved: when a screen re-renders with that part sold, its stamp lands fresh.
let lastApproved = { uid: -1, t: 0 };
const isFresh = (uid: number) => uid === lastApproved.uid && performance.now() - lastApproved.t < 900;
const approve = (b: HTMLElement, uid: number, word: string) => {
  lastApproved = { uid, t: performance.now() };
  b.querySelector('.stamp')?.remove();
  b.append(stamp(word, 'ok', true));
  b.classList.add('approved');
  uiSound('stamp');
};

const serial = (seed: string | number) => `${pad(Math.floor(hash(seed) * 89) + 10, 2)}-${pad(Math.floor(hash('n' + seed) * 9000) + 1000, 4)}`;
const tilt = (seed: string | number) => ((hash('t' + seed) - 0.5) * 2.4).toFixed(2) + 'deg';

/** A part as a stamped requisition slip. Keeps the .pcard / .nm / .ds / .meta / .price hooks. */
export function partCard(p: Part, opts: { price?: number; afford?: boolean; onClick?: () => void; sold?: boolean; label?: string; stampWord?: string } = {}) {
  const layer = partLayer(p), weapon = partSlot(p.id) === 'W';
  const b = el('button', {
    class: 'pcard slip' + (opts.sold ? ' sold' : '') + (p.tier >= 4 ? ' rare' : '') + (opts.afford === false && !opts.sold ? ' short' : ''),
    disabled: opts.sold || opts.afford === false || !opts.onClick, style: `--tilt:${tilt(p.uid)}`,
  });
  if (opts.onClick) b.addEventListener('click', () => { approve(b, p.uid, opts.stampWord ?? (opts.price != null ? 'Paid' : 'Approved')); opts.onClick!(); });
  const nm = el('span', 'nm', partDef(p.id).name);
  b.append(
    el('span', 'slip-head', el('span', null, `REQ ${serial(p.uid)}`), el('span', null, weapon ? 'Ordnance' : 'Fitting')),
    el('span', 'slip-body',
      el('span', `slip-ico ${layer}`, icon(p.id)),
      el('span', 'slip-txt', nm, el('span', 'slip-tags', layerTag(p), el('span', 'mk', `Mk ${TIER[p.tier]}`), rankPips(p.tier)))),
    el('span', 'ds', partDesc(p)),
    el('span', 'meta', el('span', null, weapon ? 'Weapon mount' : 'Utility bay'),
      opts.sold ? el('span', null, 'Sold') : opts.price != null ? el('span', 'price', icon('metal-bar'), `${opts.price} scrap`) : opts.label ? el('span', 'price', opts.label) : null),
  );
  if (opts.sold) b.append(stamp('Sold', 'ok', isFresh(p.uid)));
  else if (opts.afford === false) b.append(stamp('Insufficient', 'void', false, 'scrap'));
  return b;
}

/* ---------------- enamel insignia pins ---------------- */
let defsReady = false;
function ensureDefs() {
  if (defsReady || typeof document === 'undefined') return; defsReady = true;
  const lin = (id: string, a: string, b: string, c: string) => svg('linearGradient', { id, x1: 0, y1: 0, x2: 0.4, y2: 1 },
    svg('stop', { offset: '0', 'stop-color': a }), svg('stop', { offset: '.5', 'stop-color': b }), svg('stop', { offset: '1', 'stop-color': c }));
  const s = svg('svg', { width: 0, height: 0, style: 'position:absolute', 'aria-hidden': 'true' },
    svg('defs', {},
      lin('pin-steel', '#e3eaf0', '#7d8b98', '#3a4550'),
      lin('pin-brass', '#fff0b8', '#c9a24a', '#6b4f17'),
      lin('pin-rust', '#e3b8ff', '#7a4a9a', '#2c1838'),
      svg('radialGradient', { id: 'pin-gloss', cx: 0.35, cy: 0.25, r: 0.7 }, svg('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': '.55' }), svg('stop', { offset: '.45', 'stop-color': '#fff', 'stop-opacity': '0' })),
    ));
  document.body.append(s);
}
function star(n: number, r0: number, r1: number, cx = 32, cy = 32) {
  let d = '';
  for (let i = 0; i < n * 2; i++) { const a = (Math.PI / n) * i - Math.PI / 2, r = i % 2 ? r1 : r0; d += `${i ? 'L' : 'M'}${(cx + Math.cos(a) * r).toFixed(1)} ${(cy + Math.sin(a) * r).toFixed(1)}`; }
  return d + 'Z';
}
const PIN_SHAPE: Record<string, { rim: string; outer: string; inner: string }> = {
  common: { rim: 'url(#pin-steel)', outer: 'M32 3A29 29 0 1 1 31.9 3Z', inner: 'M32 9A23 23 0 1 1 31.9 9Z' },
  rare: { rim: 'url(#pin-brass)', outer: 'M32 2 58 13V33C58 47 47 56 32 62 17 56 6 47 6 33V13Z', inner: 'M32 8 52 17V33C52 44 44 51 32 56 20 51 12 44 12 33V17Z' },
  boss: { rim: 'url(#pin-brass)', outer: star(8, 31, 23), inner: star(8, 24, 17.5) },
  curse: { rim: 'url(#pin-rust)', outer: star(11, 30, 24), inner: 'M32 11A21 21 0 1 1 31.9 11Z' },
};
/** An enamel insignia pin for a relic: rim shape by rarity, enamel in the relic's colour, its glyph struck in. */
export function pin(id: string, size = 56) {
  ensureDefs();
  const r = RELICS[id], sh = PIN_SHAPE[r?.rarity] ?? PIN_SHAPE.common;
  return svg('svg', { class: 'pin', viewBox: '0 0 64 64', width: size, height: size, 'aria-hidden': 'true', focusable: 'false' },
    svg('path', { d: sh.outer, fill: 'rgba(0,0,0,.55)', transform: 'translate(1.5 2.5)' }),
    svg('path', { d: sh.outer, fill: sh.rim }),
    svg('path', { d: sh.inner, fill: r?.col ?? '#8597a8' }),
    svg('path', { d: sh.inner, fill: 'none', stroke: 'rgba(0,0,0,.45)', 'stroke-width': 1.2 }),
    iconG(id, 30, { transform: 'translate(32 33)', fill: '#0b0f14', 'fill-opacity': '.88' }),
    svg('path', { d: sh.inner, fill: 'url(#pin-gloss)' }),
  );
}

const RARITY: Record<string, string> = { common: 'Service insignia', rare: 'Distinguished', boss: 'Ghost trophy', curse: 'Curse' };
/** A relic offered or shown: the pin on a felt card with its citation. Keeps the .pcard hooks. */
export function relicCard(id: string, opts: { price?: number; afford?: boolean; onClick?: () => void; sold?: boolean } = {}) {
  const r = RELICS[id];
  const b = el('button', {
    class: 'pcard relic-card ' + r.rarity + (opts.sold ? ' sold' : ''),
    disabled: opts.sold || opts.afford === false || !opts.onClick, style: `--enamel:${r.col}`,
  });
  if (opts.onClick) b.addEventListener('click', () => { b.classList.add('approved'); uiSound('stamp'); opts.onClick!(); });
  b.append(
    el('span', 'felt', pin(id, 72)),
    el('span', 'citation',
      el('span', 'rarity', RARITY[r.rarity] ?? r.rarity),
      el('span', 'nm', r.name),
      el('span', 'ds', r.desc),
      el('span', 'meta', el('span', null, `${r.rarity} relic`), opts.sold ? el('span', null, 'Sold') : opts.price != null ? el('span', 'price', icon('metal-bar'), `${opts.price} scrap`) : null)),
  );
  if (opts.sold) b.append(stamp('Sold', 'ok'));
  return b;
}
/** Compact pin with a tooltip, for the status rail. */
export function relicChip(id: string) {
  const r = RELICS[id];
  return el('span', { class: 'relic', title: `${r.name}: ${r.desc}`, tabindex: 0, 'aria-label': `${r.name}: ${r.desc}` }, pin(id, 30),
    el('span', { class: 'tip', role: 'tooltip' }, el('b', null, r.name), el('span', null, r.desc)));
}

/* ---------------- status rail ---------------- */
/** The bridge status rail: pilot, sector, hull, scrap and insignia, with screen controls on the right. */
export function topBar(run: RunState, ...right: Child[]) {
  const mh = maxHp(run), k = run.hp / mh;
  return el('header', 'topbar rail',
    el('div', 'cell pilot', plateK('Commander'), tape(run.callsign)),
    el('div', 'cell', plateK('Sector'), flap(run.sector, 2, `sector-${run.seed}`)),
    el('div', 'cell hullcell', plateK('Hull integrity'),
      el('span', 'hullread', segBar(k, 20, 'hull'), el('b', 'mono', `${Math.ceil(run.hp)}`, el('small', null, ` / ${mh}`)))),
    el('div', 'cell scrapcell', plateK('Scrap'), el('span', 'scrapread', icon('metal-bar'), flap(run.scrap, 4, `scrap-${run.seed}`, { 'data-testid': 'scrap' }))),
    run.relics.length ? el('div', 'cell relics', plateK('Insignia'), el('span', 'pinrow', ...run.relics.map(relicChip))) : null,
    el('div', 'spacer'),
    el('div', 'rail-ctl', ...right),
  );
}
