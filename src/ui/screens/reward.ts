// After-action screens: the salvage requisition (fight / elite), the boss salvage manifest and the trophy case.
import type { RunState } from '../../game/run';
import { maxHp } from '../../game/run';
import type { Ghost } from '../../game/ghosts';
import { RELICS } from '../../data/relics';
import type { Part } from '../../data/parts';
import { el } from '../h';
import { partCard, relicCard, pin } from '../cards';
import { flap, legend, plateK, segBar } from '../kit';
import { frame, foot } from './frame';

/** A relic that was simply awarded (not chosen): the pin presented in a felt-lined case. */
export function relicAward(id: string) {
  const r = RELICS[id];
  return el('div', { class: 'award', style: `--enamel:${r.col}` }, el('span', 'felt', pin(id, 84)),
    el('span', 'citation', el('span', 'rarity', 'Awarded for this action'), el('span', 'nm', r.name), el('span', 'ds', r.desc)));
}

export interface RewardOpts {
  run: RunState; kind: 'fight' | 'elite' | 'event'; gained: number;
  relic?: string | null; bounty?: string | null;
  parts: Part[]; onTake: (p: Part) => void; onSkip: () => void; skipLabel: string;
}
export function rewardView(o: RewardOpts) {
  const r = o.run, mh = maxHp(r);
  const tally = el('div', 'tally',
    el('div', 'tally-cell', plateK('Scrap recovered'), flap(o.gained, 3)),
    el('div', 'tally-cell', plateK('Hull'), el('span', 'hullread', segBar(r.hp / mh, 14, 'hull'), el('b', 'mono', `${Math.ceil(r.hp)}`, el('small', null, ` / ${mh}`)))),
    el('div', 'tally-cell', plateK('Kills this run'), flap(r.stats.kills, 3)),
  );
  return frame(r, { screen: 'reward', kind: 'console', eyebrow: o.kind === 'elite' ? 'Elite destroyed' : 'Engagement won', title: 'Salvage', glyph: o.kind === 'elite' ? 'crowned-skull' : 'cargo-crate', wide: true, cls: 'reward' },
    tally,
    o.relic ? legend('Relic recovered') : null,
    o.relic ? relicAward(o.relic) : null,
    o.bounty ? el('p', 'note', o.bounty) : null,
    legend('Choose one part', 'requisition goes to the cargo hold'),
    el('div', 'slips', ...o.parts.map((p) => partCard(p, { onClick: () => o.onTake(p), label: 'Requisition' }))),
    foot(el('button', { class: 'btn', onclick: o.onSkip }, o.skipLabel)),
  );
}

export interface BossSalvageOpts { run: RunState; ghost: Ghost; parts: Part[]; onTake: (p: Part) => void; strip: number; onStrip: () => void }
export function bossSalvageView(o: BossSalvageOpts) {
  const g = o.ghost;
  return frame(o.run, { screen: 'boss-salvage', kind: 'report', eyebrow: g.ai ? 'Core destroyed' : 'Ghost laid to rest', title: `Salvage: ${g.ai ? g.name : `ghost of ${g.name}`}`, glyph: 'spectre', wide: true, cls: 'manifest' },
    el('div', 'manifest-head',
      el('span', null, el('small', null, 'Wreck'), g.ai ? `${g.name} (core)` : g.name),
      el('span', null, el('small', null, 'Lost in'), `Sector ${g.sector}`),
      el('span', null, el('small', null, 'Recovered by'), o.run.callsign),
      el('span', null, el('small', null, 'Items on manifest'), String(o.parts.length))),
    el('p', 'note', 'Cutting crews can pull one fitting intact before the hulk goes down. Pick it from the manifest.'),
    el('div', 'slips', ...o.parts.map((p) => partCard(p, { label: 'Salvage', stampWord: 'Salvaged', onClick: () => o.onTake(p) }))),
    foot(el('button', { class: 'btn', onclick: o.onStrip }, `Strip it for ${o.strip} scrap`)),
  );
}

export interface TrophyOpts { run: RunState; relics: string[]; onTake: (id: string) => void; onSkip: () => void }
export function trophyView(o: TrophyOpts) {
  return frame(o.run, { screen: 'boss-relic', kind: 'console', eyebrow: 'Sector cleared', title: 'Choose a relic', glyph: 'medal', wide: true, cls: 'trophies' },
    el('p', 'note', 'The admiralty awards one insignia for the kill. It changes the rules for the rest of the run.'),
    el('div', 'pins', ...o.relics.map((id) => relicCard(id, { onClick: () => o.onTake(id) }))),
    foot(el('button', { class: 'btn', onclick: o.onSkip }, 'Take nothing')),
  );
}
