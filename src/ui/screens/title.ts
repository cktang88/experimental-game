// Title: the 3D city keeps rolling behind a cinematic lockup. Callsign plate, heavy launch switches,
// and the ghost registry reported on a lamp and a teletype line.
import { el, pad } from '../h';
import { icon } from '../icons';
import { flap, keycap, lamp, plateK, teletype } from '../kit';
import { settingsPanel } from '../settings';
import { bootDone, onBootDone } from '../intro';

export interface TitleOpts {
  callsign: string;
  saved: { sector: number; floor: number; callsign: string; hp: number; maxHp: number } | null;
  noGl: boolean;
  registry: Promise<{ online: boolean; total: number }>;
  sound: { on: boolean; set: (on: boolean) => void };
  onStart: (callsign: string) => void;
  onContinue: () => void;
}

/** A heavy two-stage switch: hazard bezel, lamp, stencil legend. */
export function heavySwitch(id: string, legend: string, sub: string | Node, onClick: () => void, opts: { primary?: boolean; disabled?: boolean; key?: string } = {}) {
  return el('button', { id, class: 'switch' + (opts.primary ? ' primary' : ''), onclick: onClick, disabled: opts.disabled },
    el('span', 'switch-face',
      el('i', 'lamp' + (opts.primary ? ' warn' : ' plasma')),
      el('span', 'switch-text', el('b', null, legend), el('small', null, sub)),
      opts.key ? el('kbd', null, opts.key) : null));
}

function clock() {
  const c = el('span', 'mono clock');
  const tick = () => { if (!c.isConnected && c.dataset.on) return; c.dataset.on = '1'; const d = new Date(); c.textContent = `${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}:${pad(d.getSeconds(), 2)} LOCAL`; setTimeout(tick, 1000); };
  tick();
  return c;
}

/** Modal settings bank (title screen). */
export function settingsModal(sound: TitleOpts['sound'], onClose: () => void) {
  const close = el('button', { class: 'btn', id: 'btn-settings-close', onclick: onClose }, 'Close');
  const m = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Settings' },
    el('div', 'console settings-console', el('i', 'rivets', el('b'), el('b'), el('b'), el('b')),
      el('div', 'con-head', el('span', 'socket', icon('cog')), el('div', 'con-titles', el('div', 'eyebrow', 'Ship systems'), el('h2', null, 'Settings'))),
      settingsPanel(sound), el('div', 'foot', close)));
  m.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } });
  m.addEventListener('click', (e) => { if (e.target === m) onClose(); });
  requestAnimationFrame(() => close.focus());
  return m;
}

export function titleView(o: TitleOpts) {
  const input = el('input', { type: 'text', id: 'callsign', maxlength: 16, autocomplete: 'off', spellcheck: false, value: o.callsign, 'aria-describedby': 'cs-hint' });
  input.value = o.callsign;
  const start = () => o.onStart(input.value);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });

  const regText = el('span', 'tt');
  const regLamp = lamp('blink');
  const reg = el('div', { class: 'registry', role: 'status' }, regLamp, el('span', 'reg-k', 'Ghost registry'), regText);
  regText.textContent = 'Handshake…';
  o.registry.then(({ online, total }) => {
    regLamp.className = 'lamp ' + (online ? 'on' : 'warn');
    const line = online
      ? `Online. ${total} fallen pilot${total === 1 ? '' : 's'} on record. Their wrecks become the bosses.`
      : 'Offline. Bosses will come from ghosts on this device only.';
    const go = () => { const b = el('b', online ? null : 'off', online ? 'online' : 'offline'); regText.replaceChildren(b, el('span')); teletype(regText.lastChild as HTMLElement, line.replace(/^(Online|Offline)/, ''), { cps: 120 }); };
    if (bootDone()) go(); else onBootDone(go);
  });

  const s = o.saved;
  const launch = heavySwitch('btn-new', s ? 'New run' : 'Launch', s ? 'Scrap the saved run' : 'Cold start · sector 1', start, { primary: true, disabled: o.noGl, key: '↵' });
  const cont = s ? heavySwitch('btn-continue', 'Continue', el('span', null, `${s.callsign} · sector `, flap(s.sector, 2), ` · floor ${Math.max(1, s.floor + 1)}`), o.onContinue) : null;

  let modal: HTMLElement | null = null;
  const openSettings = () => {
    if (modal) return;
    modal = settingsModal(o.sound, () => { modal?.remove(); modal = null; gear.focus(); });
    root.append(modal);
  };
  const gear = el('button', { class: 'btn ghost icon-btn', id: 'btn-settings', onclick: openSettings, 'aria-label': 'Settings', title: 'Settings' }, icon('cog'));

  const root = el('div', { class: 'page title-page' + (bootDone() ? ' booted' : ''), 'data-screen': 'title' },
    el('div', 'letterbox top', el('span', 'mono', 'GD-01 · FIRE CONTROL · NIGHT WATCH'), el('span', 'spacer'), clock(), gear),
    el('div', 'title-body',
      el('div', 'lockup',
        el('div', 'eyebrow b1', 'Vertical assault · roguelite'),
        el('h1', 'b2', el('span', 'l1', 'Ghost'), el('span', 'l2', 'Dreadnought')),
        el('div', 'hazard-rule b3'),
        el('p', 'pitch b3', 'Build a flying battleship one hull section at a time and chart a route across a burning city. At the end of every sector waits a ghost dreadnought: the wreck of a real pilot who died there. When you go down, your ship becomes theirs to fight.'),
      ),
      el('div', 'title-console b4',
        el('i', 'rivets', el('b'), el('b'), el('b'), el('b')),
        el('label', { class: 'cs-plate', for: 'callsign' }, plateK('Callsign'), el('span', 'cs-field', input)),
        el('div', { class: 'cs-hint', id: 'cs-hint' }, 'Stencilled on your hull, and on your ghost.'),
        o.noGl ? el('p', 'fatal', 'WebGL is not available in this browser, so combat cannot be drawn. Try a current Chrome, Edge, Firefox or Safari.') : null,
        el('div', 'switches', launch, cont),
        reg,
      ),
    ),
    el('div', 'letterbox bottom',
      el('span', 'keys', keycap('WASD'), ' / ', keycap('Arrows'), ' or drag to steer · guns fire on their own · ', keycap('P'), ' pause · ', keycap('M'), ' mute'),
      el('span', 'spacer'),
      el('span', 'mono dim', 'BUILD 0.2 · ICONS GAME-ICONS.NET (CC BY 3.0)')),
  );
  // the reveal is decoration: whatever happens to the animations, the controls are fully shown shortly after boot
  const settle = () => setTimeout(() => root.classList.add('settled'), 1500);
  if (!bootDone()) onBootDone(() => { root.classList.add('booted'); settle(); }); else settle();
  requestAnimationFrame(() => { input.focus(); input.select(); });
  return root;
}
