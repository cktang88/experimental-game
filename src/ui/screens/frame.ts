// Shared page frame for node screens: status rail on top, one console underneath.
import type { RunState } from '../../game/run';
import { el, type Child } from '../h';
import { topBar } from '../cards';
import { icon } from '../icons';

export interface FrameOpts {
  /** Stable key: re-rendering the same key swaps in place (no transition, scroll kept). */
  screen: string;
  /** Visual family: terminal (CRT), order (paper work order), console (riveted steel), report (paper on steel). */
  kind?: 'console' | 'terminal' | 'order' | 'report';
  eyebrow: string;
  title: string;
  glyph?: string;
  hostile?: boolean;
  wide?: boolean;
  right?: Child[];
  /** Extra class on the console. */
  cls?: string;
}

/** Plate header: an icon in a recessed socket, a stencilled eyebrow, and the screen heading. */
export function header(eyebrow: string, title: string, glyph?: string, hostile = false) {
  return el('div', 'con-head' + (hostile ? ' hostile' : ''),
    glyph ? el('span', 'socket', icon(glyph)) : null,
    el('div', 'con-titles', el('div', { class: 'eyebrow' }, eyebrow), el('h2', null, title)));
}

export function frame(run: RunState, o: FrameOpts, ...content: Child[]) {
  const con = el('section', `console ${o.kind ?? 'console'}${o.wide ? ' wide' : ''}${o.hostile ? ' hostile' : ''}${o.cls ? ' ' + o.cls : ''}`,
    el('i', 'rivets', el('b'), el('b'), el('b'), el('b')),
    header(o.eyebrow, o.title, o.glyph, o.hostile),
    ...content);
  return el('div', { class: 'page', 'data-screen': o.screen }, topBar(run, ...(o.right ?? [])), el('div', 'screen', con));
}

/** A row of controls at the foot of a console. */
export const foot = (...kids: Child[]) => el('div', 'foot', ...kids);
