// Player settings. Stored per device in localStorage under gd.* keys.
//
// Integration hooks for other workstreams:
//   - Audio: read settings.master / music / sfx (0..1) and subscribe with onSettings() to apply live changes.
//     Keys: gd.vol.master, gd.vol.music, gd.vol.sfx.
//   - Renderer: settings.quality is 'high' | 'low' (gd.quality).
//   - Camera / feel: settings.shake is a 0..1 multiplier for screen shake (gd.shake).
import { el } from './h';
import { uiSound } from './sound';

export interface Settings { master: number; music: number; sfx: number; quality: 'high' | 'low'; shake: number }
const KEYS: Record<keyof Settings, string> = { master: 'gd.vol.master', music: 'gd.vol.music', sfx: 'gd.vol.sfx', quality: 'gd.quality', shake: 'gd.shake' };
const DEFAULTS: Settings = { master: 0.8, music: 0.7, sfx: 0.9, quality: 'high', shake: 1 };

function read(): Settings {
  const s = { ...DEFAULTS };
  try {
    for (const k of Object.keys(KEYS) as (keyof Settings)[]) {
      const v = localStorage.getItem(KEYS[k]); if (v == null) continue;
      if (k === 'quality') s.quality = v === 'low' ? 'low' : 'high';
      else { const n = Number(v); if (Number.isFinite(n)) (s[k] as number) = Math.min(1, Math.max(0, n)); }
    }
  } catch { /* storage blocked: defaults */ }
  return s;
}
export const settings: Settings = read();
const subs = new Set<(s: Settings) => void>();
export function onSettings(fn: (s: Settings) => void) { subs.add(fn); return () => subs.delete(fn); }
export function setSetting<K extends keyof Settings>(k: K, v: Settings[K]) {
  settings[k] = v;
  try { localStorage.setItem(KEYS[k], String(v)); } catch { /* ignore */ }
  for (const f of subs) f(settings);
}

/** A detented slider drawn as a fader with a stencilled scale. */
function fader(label: string, key: 'master' | 'music' | 'sfx' | 'shake', id: string) {
  const out = el('output', { class: 'fader-v', for: id }, String(Math.round(settings[key] * 100)).padStart(3, '0'));
  const input = el('input', { type: 'range', id, min: 0, max: 100, step: 5, value: String(Math.round(settings[key] * 100)), 'aria-label': label });
  const paint = () => { input.style.setProperty('--v', `${input.value}%`); out.textContent = input.value.padStart(3, '0'); };
  input.addEventListener('input', () => { paint(); setSetting(key, Number(input.value) / 100); uiSound('flap'); });
  paint();
  return el('label', { class: 'fader', for: id }, el('span', 'plate-k', label), el('span', 'fader-track', input), out);
}

function toggle(label: string, on: boolean, onText: string, offText: string, set: (v: boolean) => void, id: string) {
  const b = el('button', { type: 'button', class: 'toggle' + (on ? ' on' : ''), id, role: 'switch', 'aria-checked': String(on) },
    el('i', 'lamp' + (on ? ' on' : '')), el('span', null, on ? onText : offText));
  b.addEventListener('click', () => {
    on = !on; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on));
    b.querySelector('.lamp')!.classList.toggle('on', on); b.querySelector('span')!.textContent = on ? onText : offText; set(on);
  });
  return el('div', 'setrow', el('span', 'plate-k', label), b);
}

/** The settings bank used in the pause menu and from the title. `sound` reflects the mute switch owned by audio. */
export function settingsPanel(sound: { on: boolean; set: (on: boolean) => void }) {
  return el('section', { class: 'settings', 'aria-label': 'Settings' },
    el('div', 'settings-col',
      el('h3', 'bank-title', 'Audio mix'),
      toggle('Sound', sound.on, 'On', 'Muted', sound.set, 'set-sound'),
      fader('Master', 'master', 'set-master'),
      fader('Music', 'music', 'set-music'),
      fader('Effects', 'sfx', 'set-sfx'),
    ),
    el('div', 'settings-col',
      el('h3', 'bank-title', 'Display'),
      toggle('Quality', settings.quality === 'high', 'High', 'Low', (v) => setSetting('quality', v ? 'high' : 'low'), 'set-quality'),
      fader('Screen shake', 'shake', 'set-shake'),
      el('p', 'settings-note', 'Reduced motion follows your system setting.'),
    ),
  );
}
