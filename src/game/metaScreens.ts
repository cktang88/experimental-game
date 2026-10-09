// Screens for the fleet (meta) loop: the launch panel (hull, heat, daily strike), the Admiralty (rank, goals,
// codex, records), the wreck report and the victory screen. Logic and state live here; markup uses the shared
// classes from src/styles.css so the UI pass can restyle it. New class hooks: .launch, .hulls, .hull, .meter,
// .goals, .goal, .codex, .wreck, .xp, .unlock (all optional to style; inline styles cover the essentials).
import { el, show, relicCard } from '../ui/dom';
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
function meter(k: number, col = 'var(--hazard)') {
  const bar = el('div', { class: 'meter', style: 'height:6px;background:var(--void);border:1px solid var(--line);position:relative;overflow:hidden' });
  bar.append(el('i', { style: `position:absolute;inset:0 auto 0 0;width:${Math.max(0, Math.min(100, k * 100))}%;background:${col}` }));
  return bar;
}

/* ---------------- launch panel (title screen) ---------------- */
/** Hull and heat pickers plus the daily strike button. Mutates and saves the profile on change. */
export function launchPanel(p: Profile, onDaily: () => void, onAdmiralty: () => void): HTMLElement {
  const root = el('div', { class: 'launch stack', style: 'gap:10px' });
  const render = () => {
    const r = rankOf(p.xp);
    const hulls = el('div', { class: 'hulls chips', role: 'radiogroup', 'aria-label': 'Hull class' }, ...HULL_IDS.map((id) => {
      const h = HULLS[id], ok = hullUnlocked(p, id);
      return el('button', {
        class: 'chip hull' + (p.hull === id ? ' sel' : ''), role: 'radio', 'aria-checked': String(p.hull === id), 'data-hull': id, disabled: !ok,
        title: ok ? `${h.desc} Overdrive: ${OVERDRIVES[h.overdrive].name}.` : `Reach rank ${h.rank} (${RANKS[h.rank - 1].title}) to fly the ${h.name}.`,
        onclick: () => { p.hull = id; saveProfile(p); sfx('ui'); render(); },
      }, `${h.name} ${h.cls}`, ok ? null : el('em', null, `R${h.rank}`));
    }));
    const h = HULLS[p.hull];
    const mh = maxHeat(p);
    const heat = mh > 0 ? el('div', { class: 'row', style: 'gap:6px' }, el('span', 'eyebrow', 'Heat'),
      ...Array.from({ length: mh + 1 }, (_, i) => el('button', { class: 'chip' + (p.heat === i ? ' sel' : ''), 'data-heat': i, title: i ? HEAT.slice(0, i).map((x) => x.name).join(', ') : 'No modifiers', onclick: () => { p.heat = i; saveProfile(p); sfx('ui'); render(); } }, String(i))),
    ) : null;
    const daily = p.daily && p.daily.date === dateKey() ? `Today's best: ${fmt(p.daily.score)} pts` : 'One seeded route for everyone today. Vanguard, heat 0.';
    root.replaceChildren(...nodes(
      el('div', { class: 'row', style: 'justify-content:space-between' },
        el('span', 'eyebrow', `Rank ${r.rank} · ${r.title}`),
        el('button', { class: 'small ghost', id: 'btn-admiralty', onclick: onAdmiralty }, 'Admiralty')),
      r.next ? meter(r.progress) : null,
      el('span', 'eyebrow', 'Hull class'), hulls,
      el('p', { style: 'font-size:13px' }, `${h.desc} Overdrive: `, el('b', { style: `color:${OVERDRIVES[h.overdrive].col}` }, OVERDRIVES[h.overdrive].name), '.'),
      heat,
      p.heat > 0 ? el('p', { style: 'font-size:12px;color:var(--hostile)' }, HEAT.slice(0, p.heat).map((x) => x.name).join(' · ')) : null,
      el('div', { class: 'row' }, el('button', { id: 'btn-daily', onclick: onDaily, title: daily }, 'Daily strike'), el('span', { class: 'keys', style: 'font-size:12px' }, daily)),
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
    const tabs = el('div', { class: 'row', role: 'tablist' }, ...(['service', 'goals', 'codex'] as const).map((t) =>
      el('button', { class: 'chip' + (tab === t ? ' sel' : ''), role: 'tab', 'aria-selected': String(tab === t), 'data-tab': t, onclick: () => { tab = t; render(); } }, t === 'service' ? 'Service record' : t === 'goals' ? 'Goals' : 'Codex')));
    let body: Node;
    if (tab === 'service') {
      body = el('div', 'stack',
        el('div', 'deathstats', ...([['Runs', p.stats.runs], ['Victories', p.stats.wins], ['Kills', p.stats.kills], ['Structures', p.stats.structures], ['Ghosts laid', p.stats.bosses], ['Best sector', p.stats.bestSector]] as const)
          .map(([k, v]) => el('div', null, el('b', null, fmt(v)), el('span', null, k)))),
        p.best ? el('p', null, `Best run: ${fmt(p.best.score)} pts, ${p.best.won ? 'victory' : `sector ${p.best.sector}`}, ${HULLS[p.best.hull].name}, heat ${p.best.heat}.`) : null,
        p.daily ? el('p', { class: 'mono', style: 'font-size:12px' }, p.daily.line) : null,
        el('h3', null, 'Ranks'),
        el('div', { class: 'ranks stack', style: 'gap:6px' }, ...RANKS.map((d) => el('div', { class: 'row', style: `gap:8px;opacity:${d.rank <= r.rank ? 1 : 0.55}` },
          el('b', { class: 'mono', style: 'width:64px' }, `${fmt(d.xp)}`), el('b', { style: `color:${d.rank <= r.rank ? 'var(--hazard)' : 'var(--dim)'}` }, d.title), el('span', { style: 'color:var(--dim);font-size:13px' }, d.reward)))),
        el('h3', null, 'Heat', el('small', null, maxHeat(p) ? `up to ${maxHeat(p)} unlocked` : 'unlocks after your first victory')),
        el('div', { class: 'stack', style: 'gap:4px' }, ...HEAT.map((h) => el('div', { class: 'row', style: `gap:8px;opacity:${h.level <= maxHeat(p) ? 1 : 0.5}` }, el('b', { class: 'mono' }, String(h.level)), el('b', null, h.name), el('span', { style: 'color:var(--dim);font-size:13px' }, h.desc)))),
      );
    } else if (tab === 'goals') {
      body = el('div', { class: 'goals grid3' }, ...GOALS.map((g) => {
        const v = Number(p.stats[g.metric]) || 0, done = !!p.goals[g.id];
        return el('div', { class: 'goal card' + (done ? ' done' : ''), 'data-goal': g.id, style: done ? 'border-color:var(--good)' : '' },
          el('b', { style: done ? 'color:var(--good)' : '' }, g.name), el('span', { style: 'font-size:13px;color:var(--dim)' }, g.desc),
          meter(done ? 1 : Math.max(0, v) / g.goal, done ? 'var(--good)' : 'var(--hazard)'),
          el('span', { class: 'mono', style: 'font-size:11px;color:var(--dim)' }, done ? `Done · +${g.xp} XP` : `${fmt(Math.max(0, v))} / ${fmt(g.goal)} · ${g.xp} XP`));
      }));
    } else body = codexView(p);
    show(el('div', 'screen', el('div', 'panel wide stack',
      el('div', 'eyebrow', 'Admiralty'), el('h2', null, `${r.title}`),
      el('p', null, r.next ? `${fmt(p.xp)} XP. ${fmt(r.next.xp - p.xp)} to ${r.next.title}: ${r.next.reward}` : `${fmt(p.xp)} XP. The fleet has no higher rank.`),
      r.next ? meter(r.progress) : null,
      tabs, body,
      el('div', 'foot', el('button', { class: 'primary', id: 'btn-back', onclick: back }, 'Back')))));
  };
  render();
}
function codexView(p: Profile): HTMLElement {
  const c = p.codex;
  const enemyTypes = Object.keys(EN) as EnemyType[];
  const entry = (known: boolean, name: string, info: string, meta: string, col = 'var(--fg)') =>
    el('div', { class: 'card codex-entry' + (known ? '' : ' unknown'), style: known ? '' : 'opacity:.45' }, el('b', { style: `color:${known ? col : 'var(--dim)'}` }, known ? name : '??????'), el('span', { style: 'font-size:13px;color:var(--dim)' }, known ? info : 'Not yet encountered.'), el('span', { class: 'mono', style: 'font-size:11px;color:var(--dim)' }, known ? meta : ''));
  const partIds = [...Object.keys(WEAPONS), ...Object.keys(UTILS)];
  const count = (o: Record<string, number>, ids: string[]) => ids.filter((i) => o[i]).length;
  return el('div', { class: 'codex stack' },
    el('h3', null, 'Enemies', el('small', null, `${count(c.enemies, enemyTypes)} / ${enemyTypes.length}`)),
    el('div', 'grid3', ...enemyTypes.map((t) => entry(!!c.enemies[t], EN[t].name || t, EN[t].info || '', `${fmt(c.enemies[t] || 0)} destroyed${EN[t].range ? ` · range ${EN[t].range}` : ''}`, EN[t].elite ? 'var(--hostile)' : 'var(--fg)'))),
    el('h3', null, 'Parts', el('small', null, `${count(c.parts, partIds)} / ${partIds.length}`)),
    el('div', 'grid3', ...partIds.map((id) => { const d = partDef(id); return entry(!!c.parts[id], d.name, typeof d.desc === 'function' ? d.desc(1) : d.desc, c.parts[id] ? `best Mk ${TIER[c.parts[id]]}` : '', d.col); })),
    el('h3', null, 'Relics', el('small', null, `${count(c.relics, Object.keys(RELICS))} / ${Object.keys(RELICS).length}`)),
    el('div', 'grid3', ...Object.keys(RELICS).map((id) => entry(!!c.relics[id], RELICS[id].name, RELICS[id].desc, `${RELICS[id].rarity} · held ${c.relics[id] || 0}x`, RELICS[id].col))),
    el('h3', null, 'Ghost ledger', el('small', null, `${c.ghosts.length} met`)),
    c.ghosts.length ? el('div', 'grid3', ...c.ghosts.map((g) => entry(true, g.ai ? `${g.name} (core)` : `Ghost of ${g.name}`, `Fell in sector ${g.sector}.`, g.outcome === 'killed' ? 'Laid to rest' : 'It won', g.outcome === 'killed' ? 'var(--good)' : 'var(--hostile)'))) : el('p', null, 'No ghost dreadnoughts met yet.'),
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
/** The wreck report: totals that feel enormous, then what the Admiralty paid. */
export function wreckReport(run: RunState, st: Settlement | null): HTMLElement {
  const s = run.stats;
  const tons = s.dmgDealt * 0.018, crew = (s.fights * 2400 + s.nodes * 600) / 60;
  const facts: [string, string][] = [
    ['Score', fmt(s.score)], ['Enemies destroyed', fmt(s.kills)], ['Structures levelled', fmt(s.structures)], ['Ordnance delivered', `${fmt(tons)} t`],
    ['Broadsides fired', fmt(s.broadsides)], ['Overdrives', fmt(s.overdrives)], ['Peak carnage', `x${s.peakCarnage.toFixed(1)}`], ['Scrap salvaged', fmt(s.scrapEarned)],
    ['Elites', fmt(s.elites)], ['Ghosts laid to rest', fmt(s.bosses)], ['Crew-hours at stations', fmt(crew)], ['Nodes charted', fmt(s.nodes)],
  ];
  const root = el('div', { class: 'wreck stack' }, el('div', 'deathstats', ...facts.map(([k, v]) => el('div', null, el('b', null, v), el('span', null, k)))));
  if (st) {
    const ranked = st.rankAfter > st.rankBefore;
    root.append(...nodes(
      el('h3', null, 'Admiralty', el('small', { class: 'xp', 'data-testid': 'xp-total' }, `+${fmt(st.xpTotal)} XP`)),
      el('div', { class: 'stack', style: 'gap:4px' }, ...st.xp.map((l) => el('div', { class: 'row mono', style: 'justify-content:space-between;font-size:12px;color:var(--dim)' }, el('span', null, l.label), el('span', null, `${l.xp > 0 ? '+' : ''}${fmt(l.xp)}`))),
        ...st.goals.map((g) => el('div', { class: 'row mono', style: 'justify-content:space-between;font-size:12px;color:var(--good)' }, el('span', null, `Goal: ${g.name}`), el('span', null, `+${fmt(g.xp)}`)))),
      ranked ? el('p', { class: 'unlock', style: 'color:var(--hazard)' }, `Promoted to ${RANKS[st.rankAfter - 1].title}. ${RANKS[st.rankAfter - 1].reward}`) : null,
      ...st.newHulls.map((h) => el('p', { class: 'unlock', style: 'color:var(--good)' }, `New hull class: the ${HULLS[h].name} ${HULLS[h].cls}. ${HULLS[h].desc}`)),
      st.heatUnlocked ? el('p', { class: 'unlock', style: 'color:var(--hostile)' }, `Heat ${st.heatUnlocked} unlocked: ${HEAT[st.heatUnlocked - 1]?.name ?? ''}.`) : null,
      st.newBest ? el('p', { class: 'unlock', style: 'color:var(--hazard)' }, 'A new personal best.') : null,
      st.dailyLine ? el('p', { class: 'mono', style: 'font-size:12px;user-select:all' }, st.dailyLine) : null,
    ));
  }
  return root;
}
/** Shown when sector 3 falls. Retire (bank the run) or push on into endless sectors. */
export function victoryScreen(run: RunState, onRetire: () => void, onEndless: () => void) {
  const b = derive(run.build);
  show(el('div', 'screen center solid', el('div', 'panel wide stack',
    el('div', { class: 'eyebrow', style: 'color:var(--good)' }, 'Campaign complete'),
    el('h2', null, 'Victory'),
    el('p', { style: 'color:var(--fg)' }, `${run.callsign} broke all ${run.sector} sectors in the ${HULLS[run.hull].name}${run.heat ? ` at heat ${run.heat}` : ''}. ${b.rects.length} hull sections, ${allParts(run.build).length} parts, ${run.relics.length} relics. Every city on the route is burning.`),
    wreckReport(run, null),
    el('p', null, 'Return to port to bank the run with the Admiralty, or push on into endless sectors. Endless keeps scaling until something kills you; the run is banked then, victory included.'),
    el('div', 'row', el('button', { class: 'primary', id: 'btn-retire', onclick: onRetire }, 'Return to port'), el('button', { id: 'btn-endless', onclick: onEndless }, `Push on · sector ${run.sector + 1}`)),
  )));
}
/** After retiring from a victory: the full report and the way home. */
export function portScreen(run: RunState, st: Settlement, home: () => void) {
  show(el('div', 'screen center solid', el('div', 'panel wide stack',
    el('div', { class: 'eyebrow', style: 'color:var(--good)' }, 'Returned to port'), el('h2', null, 'Wreck report'),
    wreckReport(run, st),
    run.relics.length ? el('div', 'grid3', ...run.relics.slice(0, 6).map((id) => relicCard(id))) : null,
    el('button', { class: 'primary', id: 'btn-home', onclick: home }, 'Back to the hangar'))));
}
export { MAX_HEAT, type HullId };
