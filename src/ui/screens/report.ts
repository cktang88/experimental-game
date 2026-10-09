// Wreck report: the run's end as a casualty form, with totals that feel enormous and the ghost's fate
// arriving on the registry teletype.
import type { RunState } from '../../game/run';
import { el } from '../h';
import { icon } from '../icons';
import { flap, stamp, teletype } from '../kit';
import { pin } from '../cards';

export interface WreckOpts { run: RunState; floor: number; crew: number; onAgain: () => void }

export function wreckReport(o: WreckOpts) {
  const r = o.run, s = r.stats;
  const status = el('p', { class: 'reg-line', 'data-testid': 'ghost-status' }, 'Recording your wreck…');
  const row = (k: string, v: number, ic: string, w = 4) => el('div', 'wr-cell', el('span', 'wr-ico', icon(ic)), el('span', 'wr-k', k), flap(v, w));
  const node = el('div', { class: 'page wreck-page', 'data-screen': 'wreck' },
    el('div', 'screen center',
      el('section', 'report-sheet',
        el('div', 'wr-top',
          el('div', null, el('div', 'eyebrow', 'Signal lost · form 7-D wreck report'), el('h2', null, 'Dreadnought down')),
          el('span', 'wr-socket', icon('sinking-ship'))),
        el('div', 'wr-fields',
          el('span', null, el('small', null, 'Commander'), r.callsign),
          el('span', null, el('small', null, 'Lost in'), `Sector ${r.sector}, floor ${o.floor + 1}`),
          el('span', null, el('small', null, 'Hull sections'), String(r.build.sections.length)),
          el('span', null, el('small', null, 'Crew aboard'), o.crew.toLocaleString('en-US'))),
        el('div', 'wr-grid',
          row('Score', Math.floor(s.score), 'medal', 6),
          row('Kills', s.kills, 'skull-crack'),
          row('Elites', s.elites, 'crowned-skull', 2),
          row('Ghosts laid', s.bosses, 'spectre', 2),
          row('Scrap earned', Math.floor(s.scrapEarned), 'metal-bar'),
          row('Nodes charted', s.nodes, 'compass', 2)),
        r.relics.length ? el('div', 'wr-pins', el('small', null, 'Insignia recovered from the wreck'), el('span', 'pinrow', ...r.relics.map((id) => pin(id, 34)))) : null,
        el('div', 'wr-reg crt', el('div', 'crt-k', 'Registry transmission'), status),
        el('div', 'foot', el('button', { class: 'switch primary', id: 'btn-again', onclick: o.onAgain },
          el('span', 'switch-face', el('i', 'lamp warn'), el('span', 'switch-text', el('b', null, 'Fly again'), el('small', null, 'A new hull, a new route'))))),
        stamp('Hull lost', 'void big wr-stamp', true),
      )));
  return { node, setStatus: (text: string) => teletype(status, text, { cps: 120 }) };
}
