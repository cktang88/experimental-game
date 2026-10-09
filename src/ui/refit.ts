import { el } from './h';
import { layerTag, rankPips } from './cards';
import { icon } from './icons';
import { gauge, lamp, legend } from './kit';
import { guardedSwitch } from './screens/pause';
import { SECTIONS, WEAPONS, ARC_INFO, partName, partDesc, partSlot, partDef, TIER, type Arc } from '../data/parts';
import { has } from '../util/rng';
import { changeBuild, dv, type RunState } from '../game/run';
import { drawBlueprint } from '../render/shipPreview';
import { uiSound } from './sound';

/** Ship refit as an engineering schematic: move parts between mounts and the cargo hold, reorder or cut loose hull sections. */
export function refitPanel(run: RunState, onChange: () => void) {
  let sel: number | null = null, toast = '', hl: { si: number; i: number } | null = null;
  const root = el('div', 'refit');
  const render = () => {
    const d = dv(run);
    const canvas = el('canvas', { class: 'blueprint', width: 500, height: 625 });
    drawBlueprint(canvas, d, false, hl);
    const weps = d.mounts.filter((m) => m.part && has(WEAPONS, m.part.id));
    const air = weps.filter((m) => ['air', 'both'].includes(WEAPONS[m.part!.id].layer)).length;
    const gnd = weps.filter((m) => ['ground', 'both'].includes(WEAPONS[m.part!.id].layer)).length;
    const meters = el('div', 'gauges',
      gauge(d.maxHp / 450, 'Hull', `${Math.ceil(run.hp)}/${d.maxHp}`, { memo: 'rf-hull' }),
      gauge(d.shieldMax / 200, 'Shield', d.shieldMax ? String(d.shieldMax) : 'none', { memo: 'rf-shield' }),
      gauge((d.speed - 120) / 260, 'Speed', String(Math.round(d.speed)), { memo: 'rf-speed', red: true }),
      gauge((d.fireMult - 0.8) / 1.2, 'Fire rate', `${Math.round(d.fireMult * 100)}%`, { memo: 'rf-fire' }));
    const arcCount = (a: Arc) => weps.filter((m) => m.arc === a).length;
    const arcBank = (a: Arc) => el('div', { class: 'bank arc', style: `--arc:${ARC_INFO[a].col}`, title: ARC_INFO[a].desc }, el('span', 'plate-k', ARC_INFO[a].label), el('span', 'lamps', ...Array.from({ length: Math.max(6, arcCount(a)) }, (_, i) => el('i', { class: 'lamp' + (i < arcCount(a) ? ' arc-on' : '') }))), el('b', 'mono', String(arcCount(a))));
    const bank = (label: string, n: number) => el('div', 'bank', el('span', 'plate-k', label), el('span', 'lamps', ...Array.from({ length: Math.max(6, n) }, (_, i) => lamp(i < n ? (label.startsWith('Anti-air') ? 'plasma' : 'warn') : 'off'))), el('b', 'mono', String(n)));
    const stats = el('dl', 'stats');
    for (const [k, v] of [['Mass · thrust', `${d.mass} · ${d.thrust}`], ['Repair', d.regen ? `${d.regen.toFixed(1)}/s` : 'none'], ['Drones', String(d.drones)], ['Length', `${Math.round(d.len * 1.6)} m`]] as const)
      stats.append(el('dt', null, k), el('dd', null, v));
    const warn = air === 0 ? el('p', 'fatal hazard-plate', 'No anti-air weapons mounted. Aircraft will be untouchable.') : gnd === 0 ? el('p', 'fatal hazard-plate', 'No anti-ground weapons mounted. Tanks and turrets will be untouchable.') : null;

    const selPart = sel != null ? run.inv[sel] : null;
    const list = el('ol', 'sections');
    run.build.sections.forEach((s, si) => {
      const sd = SECTIONS[s.type];
      const ctl = el('div', 'sec-ctl');
      if (s.type !== 'bridge') {
        ctl.append(
          el('button', { class: 'btn small', 'aria-label': `Move ${sd.name} toward bow`, title: 'Toward bow', disabled: si <= 1, onclick: () => move(si, -1) }, '▲'),
          el('button', { class: 'btn small', 'aria-label': `Move ${sd.name} toward stern`, title: 'Toward stern', disabled: si >= run.build.sections.length - 1, onclick: () => move(si, 1) }, '▼'),
          guardedSwitch('Cut loose', 'Confirm cut', () => cut(si)),
        );
        (ctl.lastChild as HTMLElement).classList.add('small');
      }
      const slots = el('div', 'slots');
      sd.slots.forEach((k, i) => {
        const p = s.slots[i];
        const target = !!selPart && partSlot(selPart.id) === k;
        const b = el('button', { class: 'slot' + (p ? ' full' : ' empty') + (target ? ' target' : '') + (k === 'W' ? ' w' : ' u'), 'data-slot': `${si}-${i}`, onclick: () => clickSlot(si, i) });
        b.addEventListener('pointerenter', () => { hl = { si, i }; drawBlueprint(canvas, d, false, hl); });
        b.addEventListener('pointerleave', () => { hl = null; drawBlueprint(canvas, d, false, null); });
        const arc = d.mounts.find((m) => m.si === si && m.i === i)?.arc ?? 'internal';
        b.style.setProperty('--arc', ARC_INFO[arc].col);
        b.append(el('em', { class: 'arc-tag', title: ARC_INFO[arc].desc }, ARC_INFO[arc].short));
        const sock = el('span', 'sock', p ? icon(p.id) : el('i', null, k === 'W' ? 'W' : 'U'));
        if (p) b.append(sock, el('span', 'slot-txt', el('span', null, partDef(p.id).name, layerTag(p)), el('small', null, el('span', null, `Mk ${TIER[p.tier]}`), ' · click to unmount')));
        else b.append(sock, el('span', 'slot-txt', el('span', null, k === 'W' ? 'Weapon mount' : 'Utility bay'), el('small', null, target ? 'Click to mount' : 'Empty')));
        slots.append(b);
      });
      list.append(el('li', null,
        el('div', 'secname', el('span', 'sec-no', String(si + 1).padStart(2, '0')), icon(s.type), el('span', null, sd.name, el('small', null, `+${sd.hp} hull · mass ${sd.mass}${sd.thrust ? ` · thrust ${sd.thrust}` : ''}`))),
        ctl, slots));
    });
    const inv = el('div', 'chips hold');
    if (!run.inv.length) inv.append(el('span', 'dim', 'Empty. Unmounted and new parts land here.'));
    run.inv.forEach((p, i) => {
      const b = el('button', { class: 'chip tag' + (sel === i ? ' sel' : ''), 'data-inv': i, 'aria-pressed': String(sel === i), onclick: () => { sel = sel === i ? null : i; uiSound('press'); render(); } },
        icon(p.id), el('span', null, partName(p)), layerTag(p));
      inv.append(b);
    });
    const info = selPart
      ? el('div', 'selinfo', el('div', 'sel-head', icon(selPart.id), el('b', null, partName(selPart)), rankPips(selPart.tier)), el('p', null, partDesc(selPart)), el('small', null, `Fits a ${partSlot(selPart.id) === 'W' ? 'weapon mount' : 'utility bay'}. Highlighted mounts accept it.`))
      : el('div', 'selinfo idle', el('p', null, 'Pick a part from the hold, then a highlighted mount. Click a mounted part to send it back to the hold.'));
    root.replaceChildren(
      el('div', 'col schematic',
        el('div', 'sheet',
          el('div', 'title-block', el('span', null, el('small', null, 'Dwg no.'), `GD-${String(run.seed % 10000).padStart(4, '0')}-${run.build.sections.length}`), el('span', null, el('small', null, 'Vessel'), run.callsign), el('span', null, el('small', null, 'Sections'), String(run.build.sections.length))),
          el('div', 'bp-wrap', canvas, el('span', 'bow', 'Bow'), el('span', 'dim-line', el('i'), `${Math.round(d.len * 1.6)} m`, el('i')))),
        meters,
        el('div', 'banks', arcBank('bow'), arcBank('broadside'), arcBank('ventral'), arcCount('omni') ? arcBank('omni') : null, bank('Anti-air', air), bank('Anti-ground', gnd)),
        stats, warn),
      el('div', 'col', legend('Hull sections', 'bow at top'), list),
      el('div', 'col', legend('Cargo hold', 'pick a part, then a mount'), inv, info, el('div', { class: 'toast', role: 'status' }, toast)),
    );
  };
  const clickSlot = (si: number, i: number) => {
    const sec = run.build.sections[si], kind = SECTIONS[sec.type].slots[i], cur = sec.slots[i];
    if (sel != null) {
      const p = run.inv[sel];
      if (partSlot(p.id) !== kind) { toast = `${partDef(p.id).name} needs a ${partSlot(p.id) === 'W' ? 'weapon mount' : 'utility bay'}.`; uiSound('deny'); render(); return; }
      changeBuild(run, () => { run.inv.splice(sel!, 1); if (cur) run.inv.push(cur); sec.slots[i] = p; });
      toast = `${partName(p)} mounted.`; sel = null; uiSound('buy');
    } else if (cur) { changeBuild(run, () => { sec.slots[i] = null; run.inv.push(cur); }); toast = `${partName(cur)} moved to the hold.`; uiSound('press'); }
    else toast = 'Pick a part from the cargo hold first.';
    onChange(); render();
  };
  const move = (si: number, d: number) => { const a = run.build.sections, j = si + d; if (j < 1 || j >= a.length) return; changeBuild(run, () => { [a[si], a[j]] = [a[j], a[si]]; }); onChange(); render(); };
  const cut = (si: number) => {
    const s = run.build.sections[si];
    changeBuild(run, () => { for (const p of s.slots) if (p) run.inv.push(p); run.build.sections.splice(si, 1); });
    toast = `${SECTIONS[s.type].name} cut loose. Its parts went to the hold.`; onChange(); render();
  };
  render();
  return root;
}
