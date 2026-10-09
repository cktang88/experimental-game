// Screens for the fleet (meta) loop: the launch panel (hull, heat, daily strike), the Admiralty (rank, goals,
// codex, records), the wreck report and the victory screen. Logic and state live here; the markup uses the
// ship's-equipment kit from src/ui (steel plates, lamps, flaps, paper documents, stamps).
import { el, show, relicCard } from '../ui/dom';
import { icon, HULL_ICON, OVERDRIVE_ICON, ENEMY_ICON } from '../ui/icons';
import { flap, lamp, plateK, segBar, stamp, tape } from '../ui/kit';
import { pin } from '../ui/cards';
import { HULLS, HULL_IDS, OVERDRIVES, type HullId } from '../data/hulls';
import { HEAT, MAX_HEAT } from '../data/heat';
import { RANKS, GOALS } from '../data/goals';
import { EN, type EnemyType } from '../data/enemies';
import { WEAPONS, UTILS, TIER, partDef, allParts, derive } from '../data/parts';
import { RELICS } from '../data/relics';
import {
  rankOf, hullUnlocked, maxHeat, saveProfile, dateKey, settleRun, type Profile, type RunSummary, type Settlement,
} from './meta';
import type { RunState } from './run';
import { sfx } from './audio';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const nodes = (...xs: (Node | null | undefined | false)[]) => xs.filter((n): n is Node => !!n);
/** Rank progress as a segmented bar. */
const meter = (k: number, cls = 'hull', n = 24) => segBar(Math.max(0, Math.min(1, k)), n, cls);
const rivets = () => el('i', 'rivets', el('b'), el('b'), el('b'), el('b'));
/** Rank insignia: chevrons by rank (1-5), stars above that. */
function insignia(rank: number) {
  const s = el('span', { class: 'insignia', 'aria-hidden': 'true' });
  if (rank <= 5) for (let i = 0; i < rank; i++) s.append(el('i', 'chev'));
  else for (let i = 0; i < rank - 5; i++) s.append(el('i', 'star'));
  return s;
}

/* ---------------- launch panel (title screen) ---------------- */
/** Hull and heat pickers plus the daily strike button. Mutates and saves the profile on change. */
export function launchPanel(p: Profile, onDaily: () => void, onAdmiralty: () => void): HTMLElement {
  const root = el('div', { class: 'launch' });
  const render = () => {
    const r = rankOf(p.xp);
    const hulls = el('div', { class: 'hulls', role: 'radiogroup', 'aria-label': 'Hull class' }, ...HULL_IDS.map((id) => {
      const h = HULLS[id], ok = hullUnlocked(p, id), sel = p.hull === id;
      return el('button', {
        class: 'hull' + (sel ? ' sel' : '') + (ok ? '' : ' locked'), role: 'radio', 'aria-checked': String(sel), 'data-hull': id, disabled: !ok,
        title: ok ? `${h.name} ${h.cls}. ${h.desc} Overdrive: ${OVERDRIVES[h.overdrive].name}.` : `Reach rank ${h.rank} (${RANKS[h.rank - 1].title}) to fly the ${h.name}.`,
        onclick: () => { p.hull = id; saveProfile(p); sfx('ui'); render(); },
      }, el('span', 'hull-ico', icon(ok ? HULL_ICON[id] ?? 'battleship' : 'padlock')), el('b', null, h.name), el('small', null, ok ? h.cls : `Rank ${h.rank}`), lamp(sel ? 'warn' : 'off'));
    }));
    const h = HULLS[p.hull], od = OVERDRIVES[h.overdrive];
    const mh = maxHeat(p);
    const heat = mh > 0 ? el('div', 'heat-row', plateK('Heat'),
      el('span', 'heat-keys', ...Array.from({ length: mh + 1 }, (_, i) => el('button', {
        class: 'heat-key' + (p.heat === i ? ' sel' : '') + (i ? '' : ' zero'), 'data-heat': i, 'aria-pressed': String(p.heat === i),
        title: i ? HEAT.slice(0, i).map((x) => x.name).join(', ') : 'No modifiers', onclick: () => { p.heat = i; saveProfile(p); sfx('ui'); render(); },
      }, String(i))))) : null;
    const daily = p.daily && p.daily.date === dateKey() ? `Today's best: ${fmt(p.daily.score)} pts` : 'Same route for every pilot today';
    root.replaceChildren(...nodes(
      el('div', 'rank-row',
        insignia(r.rank),
        el('span', 'rank-txt', plateK(`Rank ${r.rank}`), el('b', null, r.title)),
        el('button', { class: 'btn small', id: 'btn-admiralty', onclick: onAdmiralty }, icon('eagle-emblem'), 'Admiralty')),
      r.next ? el('div', 'rank-meter', meter(r.progress, 'xp', 30), el('small', 'mono', `${fmt(p.xp)} / ${fmt(r.next.xp)} XP`)) : null,
      el('div', 'hull-k', plateK('Hull class')), hulls,
      el('p', 'hull-desc', h.desc, ' ', el('span', { class: 'od-tag', style: `--od:${od.col}` }, icon(OVERDRIVE_ICON[h.overdrive] ?? 'laser-burst'), od.name)),
      heat,
      p.heat > 0 ? el('p', 'heat-mods', HEAT.slice(0, p.heat).map((x) => x.name).join(' · ')) : null,
      el('button', { class: 'btn daily', id: 'btn-daily', onclick: onDaily, title: daily }, icon('calendar'), el('span', null, 'Daily strike'), el('small', null, daily)),
    ));
  };
  render();
  return root;
}

/* ---------------- admiralty ---------------- */
export function admiraltyScreen(p: Profile, back: () => void) {
  let tab: 'service' | 'goals' | 'codex' = 'service';
  const render = () => {
    const r = rankOf(p.xp);
    const tabs = el('div', { class: 'tabs', role: 'tablist' }, ...(['service', 'goals', 'codex'] as const).map((t) =>
      el('button', { class: 'tab' + (tab === t ? ' sel' : ''), role: 'tab', 'aria-selected': String(tab === t), 'data-tab': t, onclick: () => { tab = t; sfx('ui'); render(); } },
        icon(t === 'service' ? 'ribbon-medal' : t === 'goals' ? 'checklist' : 'open-book'), t === 'service' ? 'Service record' : t === 'goals' ? 'Goals' : 'Codex')));
    let body: Node;
    if (tab === 'service') {
      const st = p.stats;
      body = el('div', 'service',
        el('div', 'tally',
          ...([['Runs', st.runs, 'ship-wheel'], ['Victories', st.wins, 'laurel-crown'], ['Kills', st.kills, 'skull-crack'], ['Structures', st.structures, 'modern-city'], ['Ghosts laid', st.bosses, 'spectre'], ['Best sector', st.bestSector, 'compass']] as const)
            .map(([k, v, ic]) => el('div', 'tally-cell', el('span', 'tc-head', icon(ic), plateK(k)), flap(v, k === 'Kills' || k === 'Structures' ? 5 : 2)))),
        p.best ? el('p', 'note', `Best run: ${fmt(p.best.score)} pts, ${p.best.won ? 'victory' : `sector ${p.best.sector}`}, ${HULLS[p.best.hull].name}, heat ${p.best.heat}.`) : null,
        p.daily ? el('p', 'mono note', p.daily.line) : null,
        el('h3', 'legend', el('span', null, 'Ranks')),
        el('ol', 'ranks', ...RANKS.map((d) => el('li', { class: d.rank < r.rank ? 'past' : d.rank === r.rank ? 'now' : 'next' },
          insignia(d.rank), el('b', 'mono', fmt(d.xp)), el('span', 'rk-title', d.title), el('span', 'rk-reward', d.reward), d.rank === r.rank ? tape('Current') : null))),
        el('h3', 'legend', el('span', null, 'Heat'), el('small', null, maxHeat(p) ? `up to ${maxHeat(p)} unlocked` : 'unlocks after your first victory')),
        el('ol', 'heat-list', ...HEAT.map((h) => el('li', { class: h.level <= maxHeat(p) ? 'open' : 'shut' }, el('b', 'mono', String(h.level)), icon(h.level <= maxHeat(p) ? 'flame' : 'padlock'), el('span', 'rk-title', h.name), el('span', 'rk-reward', h.desc)))),
      );
    } else if (tab === 'goals') {
      body = el('div', 'goals', ...GOALS.map((g) => {
        const v = Number(p.stats[g.metric]) || 0, done = !!p.goals[g.id], k = done ? 1 : Math.max(0, v) / g.goal;
        return el('div', { class: 'goal slip' + (done ? ' done' : ''), 'data-goal': g.id },
          el('span', 'slip-head', el('span', null, 'Standing order'), el('span', null, `${fmt(g.xp)} XP`)),
          el('span', 'nm', g.name), el('span', 'ds', g.desc),
          el('span', 'goal-bar', el('i', { style: `width:${Math.min(100, k * 100)}%` })),
          el('span', 'meta', el('span', null, done ? 'Complete' : `${fmt(Math.max(0, v))} / ${fmt(g.goal)}`), el('span', null, `${Math.floor(Math.min(1, k) * 100)}%`)),
          done ? stamp('Done', 'ok') : null);
      }));
    } else body = codexView(p);
    show(el('div', { class: 'page', 'data-screen': `admiralty-${tab}` }, el('div', 'screen', el('section', 'console wide admiralty', rivets(),
      el('div', 'con-head', el('span', 'socket', icon('eagle-emblem')), el('div', 'con-titles', el('div', 'eyebrow', 'Admiralty · fleet records'), el('h2', null, `${r.title}`)),
        el('span', 'spacer'), insignia(r.rank)),
      el('div', 'adm-xp', el('span', 'mono', r.next ? `${fmt(p.xp)} XP · ${fmt(r.next.xp - p.xp)} to ${r.next.title}` : `${fmt(p.xp)} XP · the fleet has no higher rank`),
        r.next ? meter(r.progress, 'xp', 40) : null, r.next ? el('small', null, r.next.reward) : null),
      tabs, body,
      el('div', 'foot', el('button', { class: 'btn primary', id: 'btn-back', onclick: back }, 'Back'))))));
  };
  render();
}
function codexView(p: Profile): HTMLElement {
  const c = p.codex;
  const enemyTypes = Object.keys(EN) as EnemyType[];
  const entry = (known: boolean, ic: string, name: string, info: string, meta: string, col = 'var(--fg)') =>
    el('div', { class: 'codex-entry' + (known ? '' : ' unknown'), style: `--ink:${col}` },
      el('span', 'cx-ico', icon(known ? ic : 'padlock')),
      el('span', 'cx-txt', el('b', null, known ? name : 'Unrecorded'), el('span', null, known ? info : 'Not yet encountered.'), known && meta ? el('small', null, meta) : null));
  const partIds = [...Object.keys(WEAPONS), ...Object.keys(UTILS)];
  const count = (o: Record<string, number>, ids: string[]) => ids.filter((i) => o[i]).length;
  return el('div', 'codex',
    el('h3', 'legend', el('span', null, 'Enemies'), el('small', null, `${count(c.enemies, enemyTypes)} / ${enemyTypes.length}`)),
    el('div', 'cx-grid', ...enemyTypes.map((t) => entry(!!c.enemies[t], ENEMY_ICON[t] ?? 'crosshair', EN[t].name || t, EN[t].info || '', `${fmt(c.enemies[t] || 0)} destroyed${EN[t].range ? ` · range ${EN[t].range}` : ''}`, EN[t].elite ? 'var(--hostile)' : 'var(--fg)'))),
    el('h3', 'legend', el('span', null, 'Parts'), el('small', null, `${count(c.parts, partIds)} / ${partIds.length}`)),
    el('div', 'cx-grid', ...partIds.map((id) => { const d = partDef(id); return entry(!!c.parts[id], id, d.name, typeof d.desc === 'function' ? d.desc(1) : d.desc, c.parts[id] ? `best Mk ${TIER[c.parts[id]]}` : '', d.col); })),
    el('h3', 'legend', el('span', null, 'Relics'), el('small', null, `${count(c.relics, Object.keys(RELICS))} / ${Object.keys(RELICS).length}`)),
    el('div', 'cx-grid', ...Object.keys(RELICS).map((id) => entry(!!c.relics[id], id, RELICS[id].name, RELICS[id].desc, `${RELICS[id].rarity} · held ${c.relics[id] || 0}×`, RELICS[id].col))),
    el('h3', 'legend', el('span', null, 'Ghost ledger'), el('small', null, `${c.ghosts.length} met`)),
    c.ghosts.length ? el('div', 'cx-grid', ...c.ghosts.map((g) => entry(true, 'spectre', g.ai ? `${g.name} (core)` : `Ghost of ${g.name}`, `Fell in sector ${g.sector}.`, g.outcome === 'killed' ? 'Laid to rest' : 'It won', g.outcome === 'killed' ? 'var(--good)' : 'var(--hostile)'))) : el('p', 'note', 'No ghost dreadnoughts met yet.'),
  );
}

/* ---------------- run end ---------------- */
export function runSummary(run: RunState, outcome: RunSummary['outcome']): RunSummary {
  const parts: Record<string, number> = {};
  for (const p of [...allParts(run.build), ...run.inv]) parts[p.id] = Math.max(parts[p.id] || 0, p.tier);
  const s = run.stats, floor = run.at ? run.map.nodes[run.at]?.floor ?? 0 : 0;
  return {
    outcome, hull: run.hull, heat: run.heat, daily: run.daily, endless: run.endless, won: run.won, sector: run.sector, floor, nodes: s.nodes, score: Math.round(s.score),
    kills: s.kills, elites: s.elites, bosses: s.bosses, structures: s.structures, broadsides: s.broadsides, maxVolley: s.maxVolley, overdrives: s.overdrives,
    lanceStructures: s.lanceStructures, scrapEarned: s.scrapEarned, peakCarnage: s.peakCarnage, flawless: s.flawless, maxScrapHeld: s.maxScrapHeld, fights: s.fights,
    seen: { enemies: { ...run.seen.enemies }, parts, relics: run.relics.slice(), ghosts: run.seen.ghosts.slice() }, date: dateKey(),
  };
}
/** Settle the run into the profile (mutating it in place) and save. Call exactly once per run. */
export function settle(p: Profile, run: RunState, outcome: RunSummary['outcome']): Settlement {
  const s = settleRun(p, runSummary(run, outcome));
  Object.assign(p, s.profile); saveProfile(p);
  return s;
}
/** The wreck report: totals that feel enormous (a grid of figures on the form), then the Admiralty's pay slip. */
export function wreckReport(run: RunState, st: Settlement | null): HTMLElement {
  const s = run.stats;
  const tons = s.dmgDealt * 0.018, crew = (s.fights * 2400 + s.nodes * 600) / 60;
  const facts: [string, string, string][] = [
    ['Score', fmt(s.score), 'medal'], ['Enemies destroyed', fmt(s.kills), 'skull-crack'], ['Structures levelled', fmt(s.structures), 'modern-city'], ['Ordnance delivered', `${fmt(tons)} t`, 'falling-bomb'],
    ['Broadsides fired', fmt(s.broadsides), 'cannon'], ['Overdrives', fmt(s.overdrives), 'laser-burst'], ['Peak carnage', `×${s.peakCarnage.toFixed(1)}`, 'fire'], ['Scrap salvaged', fmt(s.scrapEarned), 'metal-bar'],
    ['Elites', fmt(s.elites), 'crowned-skull'], ['Ghosts laid to rest', fmt(s.bosses), 'spectre'], ['Crew-hours at stations', fmt(crew), 'sergeant'], ['Nodes charted', fmt(s.nodes), 'compass'],
  ];
  const root = el('div', 'wreck',
    el('div', 'wr-grid', ...facts.map(([k, v, ic]) => el('div', 'wr-cell', el('span', 'wr-ico', icon(ic)), el('span', 'wr-k', k), el('b', 'wr-v', v)))));
  if (st) {
    const ranked = st.rankAfter > st.rankBefore;
    root.append(...nodes(
      el('div', 'payslip',
        el('div', 'ps-head', el('span', null, 'Admiralty pay slip'), el('b', { class: 'xp', 'data-testid': 'xp-total' }, `+${fmt(st.xpTotal)} XP`)),
        el('ol', 'ps-lines', ...st.xp.map((l) => el('li', null, el('span', null, l.label), el('i'), el('b', null, `${l.xp > 0 ? '+' : ''}${fmt(l.xp)}`))),
          ...st.goals.map((g) => el('li', 'goal-line', el('span', null, `Standing order: ${g.name}`), el('i'), el('b', null, `+${fmt(g.xp)}`)))),
        ranked ? stamp('Promoted', 'ok ps-stamp', true, RANKS[st.rankAfter - 1].title) : null),
      ranked ? el('p', 'unlock', icon('ribbon-medal'), `Promoted to ${RANKS[st.rankAfter - 1].title}. ${RANKS[st.rankAfter - 1].reward}`) : null,
      ...st.newHulls.map((h) => el('p', 'unlock good', icon(HULL_ICON[h] ?? 'battleship'), `New hull class: the ${HULLS[h].name} ${HULLS[h].cls}. ${HULLS[h].desc}`)),
      st.heatUnlocked ? el('p', 'unlock hot', icon('flame'), `Heat ${st.heatUnlocked} unlocked: ${HEAT[st.heatUnlocked - 1]?.name ?? ''}.`) : null,
      st.newBest ? el('p', 'unlock', icon('laurel-crown'), 'A new personal best.') : null,
      st.dailyLine ? el('p', { class: 'mono share', style: 'user-select:all' }, st.dailyLine) : null,
    ));
  }
  return root;
}
/** Shown when sector 3 falls. Retire (bank the run) or push on into endless sectors. */
export function victoryScreen(run: RunState, onRetire: () => void, onEndless: () => void) {
  const b = derive(run.build);
  show(el('div', { class: 'page wreck-page victory-page', 'data-screen': 'victory' }, el('div', 'screen center',
    el('section', 'report-sheet victory',
      el('div', 'wr-top', el('div', null, el('div', 'eyebrow', 'Campaign complete · form 1-A after-action'), el('h2', null, 'Victory')), el('span', 'wr-socket', icon('laurel-crown'))),
      el('p', 'wr-lede', `${run.callsign} broke all ${run.sector} sectors in the ${HULLS[run.hull].name}${run.heat ? ` at heat ${run.heat}` : ''}. ${b.rects.length} hull sections, ${allParts(run.build).length} parts, ${run.relics.length} relics. Every city on the route is burning.`),
      wreckReport(run, null),
      run.relics.length ? el('div', 'wr-pins', el('small', null, 'Insignia aboard'), el('span', 'pinrow', ...run.relics.map((id) => pin(id, 34)))) : null,
      el('p', 'order-note', 'Return to port to bank the run with the Admiralty, or push on into endless sectors. Endless keeps scaling until something kills you; the run is banked then, victory included.'),
      el('div', 'foot',
        el('button', { class: 'btn', id: 'btn-endless', onclick: onEndless }, `Push on · sector ${run.sector + 1}`),
        el('button', { class: 'switch primary', id: 'btn-retire', onclick: onRetire }, el('span', 'switch-face', el('i', 'lamp on'), el('span', 'switch-text', el('b', null, 'Return to port'), el('small', null, 'Bank the run with the Admiralty'))))),
      stamp('Victory', 'ok big wr-stamp', true),
    ))));
}
/** After retiring from a victory: the full report and the way home. */
export function portScreen(run: RunState, st: Settlement, home: () => void) {
  show(el('div', { class: 'page wreck-page victory-page', 'data-screen': 'port' }, el('div', 'screen center',
    el('section', 'report-sheet',
      el('div', 'wr-top', el('div', null, el('div', 'eyebrow', 'Returned to port'), el('h2', null, 'Wreck report')), el('span', 'wr-socket', icon('anchor'))),
      wreckReport(run, st),
      run.relics.length ? el('div', 'pins', ...run.relics.slice(0, 6).map((id) => relicCard(id))) : null,
      el('div', 'foot', el('button', { class: 'btn primary', id: 'btn-home', onclick: home }, 'Back to the hangar'))))));
}
export { MAX_HEAT, type HullId };
