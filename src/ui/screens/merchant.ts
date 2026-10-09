// The quartermaster's requisition terminal: slips for ordnance and fittings, hull sections on work slips,
// one insignia under glass, services on switches, a sell tray, and a till roll of this visit's transactions.
import type { RunState } from '../../game/run';
import type { Part, SectionType } from '../../data/parts';
import { partName } from '../../data/parts';
import { el, hash, pad } from '../h';
import { partCard, relicCard } from '../cards';
import { icon } from '../icons';
import { flap, legend, stamp, teletype } from '../kit';
import { frame } from './frame';

export interface MerchantOpts {
  run: RunState; toast: string;
  stock: { part: Part; price: number; sold: boolean; afford: boolean; buy: () => void }[];
  sections: { type: SectionType; name: string; desc: string; cost: number; sold: boolean; full: boolean; afford: boolean; buy: () => void }[];
  relic: { id: string; price: number; sold: boolean; afford: boolean; buy: () => void } | null;
  services: { label: string; disabled: boolean; act: () => void; icon: string }[];
  sell: { part: Part; value: number; act: () => void }[];
  onLeave: () => void;
}

// till roll: one line per new toast within a visit
let roll: string[] = [], rollFirst = '';
function tillRoll(toast: string, first: boolean) {
  if (first || !roll.length) { roll = []; rollFirst = toast; }
  else if (toast !== roll[roll.length - 1] && toast !== rollFirst) roll.push(toast);
  return roll;
}

let lastWeld = { type: '', t: 0 };
function sectionSlip(s: MerchantOpts['sections'][number]) {
  const b = el('button', { class: 'pcard slip section-slip' + (s.sold ? ' sold' : '') + (!s.afford && !s.sold && !s.full ? ' short' : ''), disabled: s.sold || s.full || !s.afford, style: `--tilt:${((hash(s.type) - 0.5) * 2).toFixed(2)}deg` });
  b.addEventListener('click', () => { lastWeld = { type: s.type, t: performance.now() }; b.append(stamp('Welded', 'ok', true)); s.buy(); });
  b.append(
    el('span', 'slip-head', el('span', null, `WORK ${pad(Math.floor(hash(s.name) * 9000) + 1000, 4)}`), el('span', null, 'Hull section')),
    el('span', 'slip-body', el('span', 'slip-ico util', icon(s.type)), el('span', 'slip-txt', el('span', 'nm', s.name))),
    el('span', 'ds', s.desc),
    el('span', 'meta', el('span', null, s.full ? 'Hull at 8 sections' : 'Welded to the stern'),
      s.sold ? el('span', null, 'Sold') : el('span', 'price', icon('metal-bar'), `${s.cost} scrap`)),
  );
  if (s.sold) b.append(stamp('Welded', 'ok', lastWeld.type === s.type && performance.now() - lastWeld.t < 900));
  else if (s.full) b.append(stamp('No berth', 'void'));
  return b;
}

export function merchantView(o: MerchantOpts, first = false) {
  const r = o.run;
  const lines = tillRoll(o.toast, first);
  const say = el('div', { class: 'toast qm-say', role: 'status' });
  if (first) teletype(say, o.toast, { cps: 110, delay: 300 }); else say.textContent = o.toast;
  const till = el('ol', 'till', ...(lines.length ? lines.map((t) => el('li', null, t)) : [el('li', 'dim', 'No transactions yet.')]));
  const leave = el('button', { class: 'btn primary', id: 'btn-leave', onclick: o.onLeave }, 'Leave');
  return frame(r, { screen: 'merchant', kind: 'terminal', eyebrow: 'Quartermaster · requisitions', title: 'Merchant', glyph: 'trade', wide: true, cls: 'merchant', right: [leave] },
    el('div', 'qm',
      el('div', 'qm-main',
        el('div', 'qm-crt crt', el('div', 'crt-k', 'Quartermaster'), say),
        legend('Ordnance & fittings', 'into the cargo hold'),
        el('div', 'slips', ...o.stock.map((s) => partCard(s.part, { price: s.price, sold: s.sold, afford: s.afford, onClick: s.buy }))),
        legend('Hull sections', 'welded to the stern'),
        el('div', 'slips', ...o.sections.map(sectionSlip)),
      ),
      el('aside', 'qm-side',
        el('div', 'ledger', el('div', 'crt-k', 'Scrap on account'), el('div', 'ledger-v', icon('metal-bar'), flap(r.scrap, 4, `scrap-${r.seed}`))),
        o.relic ? legend('Insignia') : null,
        o.relic ? relicCard(o.relic.id, { price: o.relic.price, sold: o.relic.sold, afford: o.relic.afford, onClick: o.relic.buy }) : null,
        legend('Services'),
        el('div', 'services', ...o.services.map((s) => el('button', { class: 'btn service', disabled: s.disabled, onclick: s.act }, icon(s.icon), s.label))),
        legend('Sell from your hold', '40% of value'),
        el('div', 'tray', ...(o.sell.length ? o.sell.map((s) => el('button', { class: 'chip tag', onclick: s.act, title: `Sell ${partName(s.part)}` }, icon(s.part.id), el('span', null, partName(s.part)), el('b', null, `+${s.value}`))) : [el('span', 'dim', 'Nothing to sell.')])),
        el('div', 'till-wrap', el('div', 'till-head', 'Till roll'), till),
      ),
    ),
  );
}
