// Wreck report: the run's end as a casualty form. Totals and the Admiralty pay slip come from the fleet loop
// (src/game/metaScreens.ts wreckReport); the ghost's fate arrives on the registry teletype.
import type { RunState } from '../../game/run';
import type { Settlement } from '../../game/meta';
import { wreckReport as reportBody } from '../../game/metaScreens';
import { HULLS } from '../../data/hulls';
import { el } from '../h';
import { icon } from '../icons';
import { stamp, teletype } from '../kit';
import { pin } from '../cards';

export interface WreckOpts { run: RunState; floor: number; settlement: Settlement | null; onAgain: () => void }

export function wreckReport(o: WreckOpts) {
  const r = o.run;
  const status = el('p', { class: 'reg-line', 'data-testid': 'ghost-status' }, 'Recording your wreck…');
  const node = el('div', { class: 'page wreck-page', 'data-screen': 'wreck' },
    el('div', 'screen center',
      el('section', 'report-sheet',
        el('div', 'wr-top',
          el('div', null, el('div', 'eyebrow', 'Signal lost · form 7-D wreck report'), el('h2', null, 'Dreadnought down')),
          el('span', 'wr-socket', icon('sinking-ship'))),
        el('div', 'wr-fields',
          el('span', null, el('small', null, 'Commander'), r.callsign),
          el('span', null, el('small', null, 'Lost in'), `Sector ${r.sector}, floor ${o.floor + 1}`),
          el('span', null, el('small', null, 'Hull'), `${HULLS[r.hull]?.name ?? 'Vanguard'}${r.heat ? ` · heat ${r.heat}` : ''}`),
          el('span', null, el('small', null, 'Sections lost'), String(r.build.sections.length))),
        reportBody(r, o.settlement),
        r.relics.length ? el('div', 'wr-pins', el('small', null, 'Insignia recovered from the wreck'), el('span', 'pinrow', ...r.relics.map((id) => pin(id, 34)))) : null,
        el('div', 'wr-reg crt', el('div', 'crt-k', 'Registry transmission'), status),
        el('div', 'foot', el('button', { class: 'switch primary', id: 'btn-again', onclick: o.onAgain },
          el('span', 'switch-face', el('i', 'lamp warn'), el('span', 'switch-text', el('b', null, 'Fly again'), el('small', null, 'A new hull, a new route'))))),
        stamp('Hull lost', 'void big wr-stamp', true),
      )));
  return { node, setStatus: (text: string) => teletype(status, text, { cps: 120 }) };
}
