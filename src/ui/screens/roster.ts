// Daily strike duty roster: the registry's ranking printed on fan-fold line-printer paper (pin-feed margins, green
// bars, a line-at-a-time print). The pilot's own row is marked with a highlighter. Used on the wreck report, the
// port report and the daily strike briefing on the title.
import type { DailyBoard, DailyRow, FilingResult } from '../../game/daily';
import { HULLS, type HullId } from '../../data/hulls';
import { el, pad, hash } from '../h';
import { icon } from '../icons';
import { flap, keycap, lamp, stamp, teletype } from '../kit';
import { heavySwitch } from './title';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const reached = (r: Pick<DailyRow, 'won' | 'sector' | 'floor'>) => (r.won ? 'VICTORY' : `S${r.sector} · F${pad(r.floor + 1, 2)}`);
const hullName = (h: string) => (HULLS[h as HullId]?.name ?? h).toUpperCase();
/** Every day's route has its own form serial, so two rosters never look like copies. */
const formNo = (date: string) => `${pad(Math.floor(hash(date) * 900) + 100, 3)}-${date.replace(/-/g, '').slice(2)}`;

export interface RosterOpts { date: string; callsign: string; /** Shown under the title, e.g. "Today" or "Yesterday". */ note?: string }

export function roster(o: RosterOpts) {
  const me = o.callsign.toUpperCase();
  const rows = el('ol', { class: 'rs-rows', 'aria-label': 'Ranking' });
  const foot = el('p', { class: 'rs-foot', 'data-testid': 'roster-status', role: 'status' });
  const filed = el('span', 'rs-filed', flap(0, 3));
  const stampSlot = el('span', 'rs-stamp-slot');
  const node = el('section', { class: 'roster', 'data-testid': 'daily-roster', 'aria-label': `Daily strike duty roster, ${o.date}` },
    el('div', 'rs-sheet',
      el('header', 'rs-head',
        el('div', 'rs-title',
          el('span', 'rs-k', `Admiralty registry · form 12-R/${formNo(o.date)}`),
          el('b', null, 'Daily strike duty roster'),
          el('span', 'rs-k', `Route of ${o.date} UTC${o.note ? ` · ${o.note}` : ''}`)),
        el('div', 'rs-count', el('span', 'rs-k', 'Pilots filed'), filed)),
      el('div', { class: 'rs-cols', 'aria-hidden': 'true' }, el('span', null, 'RK'), el('span', null, 'Callsign'), el('span', 'rs-hull', 'Hull'), el('span', null, 'Reached'), el('span', 'rs-n', 'Kills'), el('span', 'rs-n', 'Score')),
      rows,
      foot,
      stampSlot));
  let tt: { skip: () => void } | null = null;
  const status = (text: string, tone: 'ok' | 'off' | '' = '') => {
    tt?.skip();
    foot.className = 'rs-foot' + (tone ? ` ${tone}` : '');
    const lens = lamp(tone === 'off' ? 'hostile' : tone === 'ok' ? 'on' : 'blink');
    const line = el('span');
    foot.replaceChildren(lens, line);
    tt = teletype(line, text, { cps: 140 });
  };
  const line = (r: DailyRow | null, i: number, cls = '') => {
    const you = !!r && r.callsign === me;
    if (!r) return el('li', { class: 'rs-row rs-gap', 'aria-hidden': 'true', style: `--i:${Math.min(i, 24)}` }, el('span', null, '· · ·'));
    return el('li', { class: `rs-row${you ? ' you' : ''}${r.won ? ' won' : ''}${cls ? ' ' + cls : ''}`, style: `--i:${Math.min(i, 24)}`, 'data-rank': r.rank || null },
      el('span', 'rs-rk', r.rank ? pad(r.rank, 3) : '---'),
      el('span', 'rs-cs', r.callsign, you ? el('em', 'rs-you', '◄ you') : null),
      el('span', 'rs-hull', hullName(r.hull)),
      el('span', 'rs-at', reached(r)),
      el('span', 'rs-n', fmt(r.kills)),
      el('span', 'rs-n rs-sc', fmt(r.score)));
  };
  // a line printer: rows come out one after another; after a moment everything is simply shown
  const printed = () => setTimeout(() => node.classList.add('printed'), 2600);
  status('Requesting roster from the registry…');

  return {
    node,
    status,
    /** Show the registry's board. `local` is this device's own best for the day, shown when the registry is offline. */
    show(b: DailyBoard, local: DailyRow | null = null) {
      node.classList.remove('printed');
      filed.replaceChildren(flap(b.count, 3));
      const list: (DailyRow | null)[] = b.entries.slice();
      if (b.you && !b.entries.some((e) => e.callsign === b.you!.callsign)) list.push(null, b.you);
      if (!b.online && local) list.push(local);
      if (!list.length) rows.replaceChildren(el('li', 'rs-row rs-empty', el('span', null, b.online ? 'No pilot has filed for this route yet. The first line is yours to take.' : 'Roster not received.')));
      else rows.replaceChildren(...list.map((r, i) => line(r, i, !b.online ? 'local' : '')));
      if (!b.online) status(local ? 'No carrier. Registry offline: this is your own copy, unranked. Filings are held on this device and sent when the registry answers.' : 'No carrier. The registry is offline, so the roster cannot be printed.', 'off');
      else status(b.count > b.entries.length ? `End of roster. Top ${b.entries.length} of ${fmt(b.count)} pilots shown.` : `End of roster. ${fmt(b.count)} pilot${b.count === 1 ? '' : 's'} on file for this route.`, 'ok');
      printed();
    },
    /** Stamp the pilot's own filing result onto the sheet. */
    filing(r: FilingResult) {
      const s = r.status === 'filed' || r.status === 'kept'
        ? stamp(r.status === 'filed' ? 'Filed' : 'On file', 'ok rs-stamp', true, `Rank ${r.rank} of ${r.count}`)
        : r.status === 'queued' ? stamp('Held', 'void rs-stamp', true, 'No carrier') : stamp('Refused', 'void rs-stamp', true, 'Not filed');
      stampSlot.replaceChildren(s);
    },
  };
}

/** The pilot's run as an unranked roster line (offline fallback). */
export const localRow = (r: Omit<DailyRow, 'rank' | 'at'>): DailyRow => ({ ...r, rank: 0, at: 0 });

export interface BriefingOpts {
  today: string; yesterday: string; callsign: () => string;
  /** Loads the board for a date (flushes queued filings first). */
  load: (date: string) => Promise<{ board: DailyBoard; local: DailyRow | null }>;
  onLaunch: () => void; onClose: () => void;
}
/** Title screen: the Daily Strike button opens this briefing with today's roster before committing to the run. */
export function dailyBriefing(o: BriefingOpts) {
  let date = o.today, seq = 0;
  const slot = el('div', 'rs-slot');
  const keys = el('div', { class: 'rs-days', role: 'tablist', 'aria-label': 'Roster day' });
  const render = () => {
    keys.replaceChildren(...([[o.today, 'Today'], [o.yesterday, 'Yesterday']] as const).map(([d, label]) =>
      el('button', { class: 'tab' + (d === date ? ' sel' : ''), role: 'tab', 'aria-selected': String(d === date), 'data-day': label.toLowerCase(), onclick: () => { if (d !== date) { date = d; render(); } } },
        icon('calendar'), label, el('small', 'mono', d))));
    const r = roster({ date, callsign: o.callsign(), note: date === o.today ? 'today' : 'yesterday, closed for new runs' });
    slot.replaceChildren(r.node);
    const mine = ++seq;
    o.load(date).then(({ board, local }) => { if (mine === seq) r.show(board, local); });
  };
  const close = el('button', { class: 'btn', id: 'btn-daily-close', onclick: o.onClose }, 'Back');
  const m = el('div', { class: 'modal daily-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Daily strike' },
    el('div', 'console daily-console', el('i', 'rivets', el('b'), el('b'), el('b'), el('b')),
      el('div', 'con-head', el('span', 'socket', icon('podium-winner')),
        el('div', 'con-titles', el('div', 'eyebrow', 'Daily strike · one route for every pilot'), el('h2', null, 'Duty roster'))),
      el('p', 'rs-brief', 'Vanguard hull, heat 0, no rank perks. The same route and the same seed for everyone until midnight UTC. Your best run of the day is filed with the registry when your ship goes down or returns to port.'),
      keys, slot,
      el('div', 'foot', close, el('span', 'spacer'),
        heavySwitch('btn-daily-launch', 'Launch daily strike', el('span', null, `Route of ${o.today} · `, keycap('↵')), o.onLaunch, { primary: true }))));
  m.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); o.onClose(); }
    else if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') { e.stopPropagation(); o.onLaunch(); }
  });
  m.addEventListener('click', (e) => { if (e.target === m) o.onClose(); });
  render();
  requestAnimationFrame(() => (m.querySelector('#btn-daily-launch') as HTMLElement | null)?.focus());
  return m;
}
