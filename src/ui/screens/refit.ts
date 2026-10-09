// Refit bay wrapper: the rail with the exit control, and the engineering schematic below it.
import type { RunState } from '../../game/run';
import { el } from '../h';
import { topBar } from '../cards';
import { icon } from '../icons';
import { refitPanel } from '../refit';

export interface RefitOpts { run: RunState; back: { label: string; id?: string; act: () => void }; onChange: () => void; screen?: string }
export function refitView(o: RefitOpts) {
  const top = el('div', 'rail-slot');
  const refreshTop = () => top.replaceChildren(topBar(o.run, el('button', { class: 'btn primary', id: o.back.id, onclick: o.back.act }, o.back.label)));
  refreshTop();
  return el('div', { class: 'page refit-page', 'data-screen': o.screen ?? 'refit' }, top,
    el('div', 'bay',
      el('div', 'con-head', el('span', 'socket', icon('auto-repair')), el('div', 'con-titles', el('div', 'eyebrow', 'Drydock bay · engineering'), el('h2', null, 'Refit ship'))),
      refitPanel(o.run, () => { o.onChange(); refreshTop(); })));
}
