// Pause ("holding position") with the settings bank, and the between-node run menu.
import type { RunState } from '../../game/run';
import { el } from '../h';
import { icon } from '../icons';
import { settingsPanel } from '../settings';
import { frame, foot } from './frame';

/** A guarded switch: the first press flips the cover up, the second commits. */
export function guardedSwitch(label: string, armed: string, act: () => void, id?: string) {
  const b = el('button', { class: 'btn guarded', id }, el('i', 'cover'), el('span', null, label));
  b.addEventListener('click', () => {
    if (b.dataset.armed) { act(); return; }
    b.dataset.armed = '1'; b.classList.add('armed'); b.querySelector('span')!.textContent = armed;
    setTimeout(() => { if (b.isConnected && b.dataset.armed) { delete b.dataset.armed; b.classList.remove('armed'); b.querySelector('span')!.textContent = label; } }, 4000);
  });
  return b;
}

export interface PauseOpts { onResume: () => void; onAbandon: () => void; sound: { on: boolean; set: (on: boolean) => void } }
export function pauseView(o: PauseOpts) {
  const resume = el('button', { class: 'btn primary', id: 'btn-resume', onclick: o.onResume, autofocus: true }, 'Resume');
  requestAnimationFrame(() => resume.focus());
  return el('div', { class: 'screen center dim pause-screen', 'data-screen': 'pause' },
    el('section', 'console pause',
      el('i', 'rivets', el('b'), el('b'), el('b'), el('b')),
      el('div', 'con-head', el('span', 'socket', icon('pause-button')), el('div', 'con-titles', el('div', 'eyebrow', 'Holding position'), el('h2', null, 'Paused'))),
      settingsPanel(o.sound),
      foot(guardedSwitch('Abandon run', 'Confirm: abandon run', o.onAbandon), el('span', 'spacer'), el('span', 'keys', el('kbd', null, 'Esc'), ' resume'), resume)));
}

export interface RunMenuOpts { run: RunState; onBack: () => void; onQuit: () => void; onAbandon: () => void }
export function runMenuView(o: RunMenuOpts) {
  return frame(o.run, { screen: 'runmenu', eyebrow: 'Bridge', title: 'Run menu', glyph: 'compass' },
    el('p', 'note', 'Your run is saved after every node. You can stand down and continue later from the title screen.'),
    foot(guardedSwitch('Abandon run', 'Confirm: abandon run', o.onAbandon), el('span', 'spacer'),
      el('button', { class: 'btn', onclick: o.onQuit }, 'Save and quit'),
      el('button', { class: 'btn primary', onclick: o.onBack }, 'Back to map')));
}

/** A transient page while something loads (e.g. scanning wrecks before the boss). */
export function holdView(run: RunState, text: string) {
  return frame(run, { screen: 'hold', kind: 'terminal', eyebrow: 'Ghost registry', title: 'Scanning wrecks', glyph: 'radar-sweep' }, el('p', 'note', text));
}
