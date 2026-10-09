import { el, layerTag } from './dom';
import { SECTIONS, WEAPONS, partName, partDesc, partSlot, partDef } from '../data/parts';
import { has } from '../util/rng';
import { changeBuild, dv, type RunState } from '../game/run';
import { drawBlueprint } from '../render/shipPreview';
import { sfx } from '../game/audio';

/** Ship refit: move parts between mounts and the cargo hold, reorder or cut loose hull sections. */
export function refitPanel(run: RunState, onChange: () => void) {
  let sel: number | null = null, toast = '';
  const root = el('div', 'refit');
  const render = () => {
    const d = dv(run);
    const canvas = el('canvas', { class: 'blueprint', width: 500, height: 625 });
    drawBlueprint(canvas, d);
    const air = d.mounts.filter((m) => m.part && has(WEAPONS, m.part.id) && ['air', 'both'].includes(WEAPONS[m.part.id].layer)).length;
    const gnd = d.mounts.filter((m) => m.part && has(WEAPONS, m.part.id) && ['ground', 'both'].includes(WEAPONS[m.part.id].layer)).length;
    const stats = el('dl', 'stats');
    for (const [k, v] of [['Hull', `${Math.ceil(run.hp)} / ${d.maxHp}`], ['Shield', d.shieldMax ? String(d.shieldMax) : 'none'], ['Speed', String(Math.round(d.speed))], ['Mass · thrust', `${d.mass} · ${d.thrust}`], ['Fire rate', `${Math.round(d.fireMult * 100)}%`], ['Anti-air guns', String(air)], ['Anti-ground guns', String(gnd)], ['Repair', d.regen ? `${d.regen.toFixed(1)}/s` : 'none'], ['Drones', String(d.drones)]] as const)
      stats.append(el('dt', null, k), el('dd', null, v));
    const warn = air === 0 ? el('p', 'fatal', 'No anti-air weapons mounted. Aircraft will be untouchable.') : gnd === 0 ? el('p', 'fatal', 'No anti-ground weapons mounted. Tanks and turrets will be untouchable.') : null;

    const selPart = sel != null ? run.inv[sel] : null;
    const list = el('ol', 'sections');
    run.build.sections.forEach((s, si) => {
      const sd = SECTIONS[s.type];
      const ctl = el('div', 'row');
      if (s.type !== 'bridge') {
        ctl.append(
          el('button', { class: 'small', 'aria-label': `Move ${sd.name} toward bow`, disabled: si <= 1, onclick: () => move(si, -1) }, '↑'),
          el('button', { class: 'small', 'aria-label': `Move ${sd.name} toward stern`, disabled: si >= run.build.sections.length - 1, onclick: () => move(si, 1) }, '↓'),
          el('button', { class: 'small', onclick: () => cut(si) }, 'Cut loose'),
        );
      }
      const slots = el('div', 'slots');
      sd.slots.forEach((k, i) => {
        const p = s.slots[i];
        const b = el('button', { class: 'slot' + (p ? '' : ' empty') + (selPart && partSlot(selPart.id) === k ? ' target' : ''), 'data-slot': `${si}-${i}`, onclick: () => clickSlot(si, i) });
        if (p) { const t = el('span', null, partName(p)); t.append(layerTag(p)); b.append(t, el('small', null, 'Click to unmount')); }
        else b.append(el('span', null, k === 'W' ? 'Weapon mount' : 'Utility bay'), el('small', null, 'Empty'));
        slots.append(b);
      });
      list.append(el('li', null, el('div', 'secname', sd.name, el('small', null, `+${sd.hp} hull · mass ${sd.mass}${sd.thrust ? ` · thrust ${sd.thrust}` : ''}`)), ctl, slots));
    });
    const inv = el('div', 'chips');
    if (!run.inv.length) inv.append(el('span', 'keys', 'Empty. Unmounted and new parts land here.'));
    run.inv.forEach((p, i) => { const b = el('button', { class: 'chip' + (sel === i ? ' sel' : ''), 'data-inv': i, onclick: () => { sel = sel === i ? null : i; sfx('ui'); render(); } }, partName(p)); b.append(layerTag(p)); inv.append(b); });
    const info = selPart ? el('div', 'selinfo', `${partName(selPart)}: ${partDesc(selPart)} Fits a ${partSlot(selPart.id) === 'W' ? 'weapon mount' : 'utility bay'}.`) : null;
    root.replaceChildren(
      el('div', 'col', canvas, stats, warn),
      el('div', 'col', el('h3', null, 'Hull sections', el('small', null, 'bow at top')), list),
      el('div', 'col', el('h3', null, 'Cargo hold', el('small', null, 'pick a part, then a mount')), inv, info, el('div', { class: 'toast', role: 'status' }, toast)),
    );
  };
  const clickSlot = (si: number, i: number) => {
    const sec = run.build.sections[si], kind = SECTIONS[sec.type].slots[i], cur = sec.slots[i];
    if (sel != null) {
      const p = run.inv[sel];
      if (partSlot(p.id) !== kind) { toast = `${partDef(p.id).name} needs a ${partSlot(p.id) === 'W' ? 'weapon mount' : 'utility bay'}.`; render(); return; }
      changeBuild(run, () => { run.inv.splice(sel!, 1); if (cur) run.inv.push(cur); sec.slots[i] = p; });
      toast = `${partName(p)} mounted.`; sel = null; sfx('buy');
    } else if (cur) { changeBuild(run, () => { sec.slots[i] = null; run.inv.push(cur); }); toast = `${partName(cur)} moved to the hold.`; sfx('ui'); }
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
