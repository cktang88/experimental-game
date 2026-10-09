import { partName, partDesc, partLayer, partSlot, type Part } from '../data/parts';
import { RELICS } from '../data/relics';
import type { RunState } from '../game/run';
import { maxHp } from '../game/run';

type Child = Node | string | number | null | undefined | false;
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, any> | string | null = null, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (typeof props === 'string') e.className = props;
  else if (props) for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'text') e.textContent = v;
    else if (k in e && typeof v !== 'string') (e as any)[k] = v;
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids) if (c != null && c !== false) e.append(c instanceof Node ? c : String(c));
  return e;
}
const SVGNS = 'http://www.w3.org/2000/svg';
export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...kids: (SVGElement | null)[]): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) { if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v); else e.setAttribute(k, String(v)); }
  for (const c of kids) if (c) e.append(c);
  return e;
}
export const ui = () => document.getElementById('ui')!;
export function show(...nodes: Node[]) { const u = ui(); u.replaceChildren(...nodes); u.scrollTop = 0; }

const LAYER_LABEL: Record<string, string> = { air: 'AIR', ground: 'GROUND', both: 'BOTH', none: 'DEFENSE', util: 'UTILITY' };
export const layerTag = (p: Part) => el('em', partLayer(p), LAYER_LABEL[partLayer(p)]);
export function partCard(p: Part, opts: { price?: number; afford?: boolean; onClick?: () => void; sold?: boolean; label?: string } = {}) {
  const b = el('button', { class: 'pcard' + (opts.sold ? ' sold' : '') + (p.tier >= 4 ? ' rare' : ''), disabled: opts.sold || opts.afford === false || !opts.onClick, onclick: opts.onClick });
  const nm = el('span', 'nm', partName(p)); nm.append(layerTag(p));
  b.append(nm, el('span', 'ds', partDesc(p)), el('span', 'meta', el('span', null, partSlot(p.id) === 'W' ? 'Weapon mount' : 'Utility bay'),
    opts.sold ? el('span', null, 'Sold') : opts.price != null ? el('span', 'price', `${opts.price} scrap`) : opts.label ? el('span', 'price', opts.label) : null));
  return b;
}
export function relicCard(id: string, opts: { price?: number; afford?: boolean; onClick?: () => void; sold?: boolean } = {}) {
  const r = RELICS[id];
  const b = el('button', { class: 'pcard' + (r.rarity === 'rare' || r.rarity === 'boss' ? ' rare' : '') + (r.rarity === 'curse' ? ' curse' : '') + (opts.sold ? ' sold' : ''), disabled: opts.sold || opts.afford === false || !opts.onClick, onclick: opts.onClick });
  b.append(el('span', { class: 'nm', style: `color:${r.col}` }, r.name), el('span', 'ds', r.desc),
    el('span', 'meta', el('span', null, `${r.rarity} relic`), opts.sold ? el('span', null, 'Sold') : opts.price != null ? el('span', 'price', `${opts.price} scrap`) : null));
  return b;
}
export function relicChip(id: string) {
  const r = RELICS[id];
  return el('span', { class: 'relic', style: `color:${r.col}`, title: `${r.name}: ${r.desc}`, tabindex: 0 }, r.name);
}
export function topBar(run: RunState, ...right: Child[]) {
  const mh = maxHp(run), k = run.hp / mh;
  const bar = el('div', 'hullbar' + (k < 0.3 ? ' low' : '')); bar.append(el('i', { style: `width:${Math.max(0, Math.min(100, k * 100))}%` }));
  return el('header', 'topbar',
    el('div', 'stat', el('small', null, 'Pilot'), el('span', 'title', run.callsign)),
    el('div', 'stat', el('small', null, 'Sector'), el('b', null, String(run.sector))),
    el('div', 'stat', el('small', null, `Hull ${Math.ceil(run.hp)} / ${mh}`), bar),
    el('div', 'stat', el('small', null, 'Scrap'), el('b', { style: 'color:var(--hazard)', 'data-testid': 'scrap' }, String(Math.floor(run.scrap)))),
    el('div', 'relics', ...run.relics.map(relicChip)),
    el('div', 'spacer'),
    ...right,
  );
}
