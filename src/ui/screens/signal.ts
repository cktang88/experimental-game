// Unknown signal: an intercepted transmission on the comms CRT. The message prints on the teletype while a
// live scope trace hunts the carrier; replies are numbered transmit keys (1-9 work from the keyboard).
import type { RunState } from '../../game/run';
import { el, hash, prefersReducedMotion } from '../h';
import { lamp, teletype } from '../kit';
import { frame, foot } from './frame';

/** Live oscilloscope trace (adapted from Dead Air's drawScope). Runs only while connected. */
function scope(seed: string, locked: () => boolean) {
  const cv = el('canvas', { class: 'scope', width: 360, height: 72, 'aria-hidden': 'true' });
  const c = cv.getContext('2d')!;
  const f1 = 3 + hash(seed) * 5, f2 = 9 + hash(seed + 'b') * 9;
  let lock = 0, raf = 0, waiting = 0;
  const draw = (now: number) => {
    const t = now / 1000, w = cv.width, h = cv.height, mid = h / 2;
    lock += ((locked() ? 1 : 0) - lock) * 0.06;
    c.fillStyle = '#0b0803'; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(255,179,71,.14)'; c.lineWidth = 1; c.beginPath();
    for (let i = 1; i < 12; i++) { const x = Math.round((w * i) / 12) + 0.5; c.moveTo(x, 0); c.lineTo(x, h); }
    for (let j = 1; j < 4; j++) { const y = Math.round((h * j) / 4) + 0.5; c.moveTo(0, y); c.lineTo(w, y); }
    c.stroke();
    const trace = (alpha: number, width: number) => {
      c.beginPath();
      for (let i = 0; i <= 120; i++) {
        const x = i / 120, clean = Math.sin(x * Math.PI * 2 * f1 - t * 6) * 0.55;
        const noise = (Math.sin(x * 97 + t * 31) * Math.sin(x * 53 - t * 17) + Math.sin(x * f2 * 7 + t * 9) * 0.4) * 0.55;
        const y = clean * (0.4 + lock * 0.6) + noise * (1 - lock);
        const py = mid - y * h * 0.38; i ? c.lineTo(x * w, py) : c.moveTo(0, py);
      }
      c.strokeStyle = `rgba(255,179,71,${alpha})`; c.lineWidth = width; c.stroke();
    };
    trace(0.18, 5); trace(0.95, 1.6);
    if (cv.isConnected || waiting++ < 30) raf = requestAnimationFrame(draw);
  };
  if (prefersReducedMotion()) { lock = 1; draw(0); cancelAnimationFrame(raf); } else raf = requestAnimationFrame(draw);
  return cv;
}

function crtHead(seed: string, status: string, locked: () => boolean) {
  const mhz = (118 + hash(seed) * 30).toFixed(2), bearing = String(Math.floor(hash(seed + 'brg') * 360)).padStart(3, '0');
  return el('div', 'sig-head',
    el('div', 'sig-meta', lamp('blink'), el('span', null, `Intercept · ${mhz} MHz · bearing ${bearing}°`), el('span', 'spacer'), el('span', 'sig-status', status)),
    scope(seed, locked));
}

export interface ChoiceVM { label: string; detail: string; disabled?: string; act: () => void }
export interface SignalOpts { run: RunState; id: string; title: string; text: string; choices: ChoiceVM[] }

let keyHandler: ((e: KeyboardEvent) => void) | null = null;
function bindKeys(buttons: HTMLButtonElement[]) {
  if (keyHandler) window.removeEventListener('keydown', keyHandler);
  keyHandler = (e: KeyboardEvent) => {
    if (!buttons[0]?.isConnected) { window.removeEventListener('keydown', keyHandler!); keyHandler = null; return; }
    const n = Number(e.key);
    if (n >= 1 && n <= buttons.length && !buttons[n - 1].disabled) { e.preventDefault(); buttons[n - 1].click(); }
  };
  window.addEventListener('keydown', keyHandler);
}

export function signalView(o: SignalOpts) {
  let printed = false;
  const msg = el('p', 'transmission');
  const choices = o.choices.map((c, i) => el('button', { class: 'choice', 'data-choice': i, disabled: !!c.disabled, onclick: c.act },
    el('kbd', null, String(i + 1)),
    el('span', 'choice-txt', el('b', null, c.label), el('span', null, c.detail), c.disabled ? el('em', null, c.disabled) : null)));
  const replies = el('div', 'replies', el('div', 'crt-k', 'Transmit reply'), ...choices);
  const tt = teletype(msg, o.text, { cps: 150, delay: 380, done: () => { printed = true; replies.classList.add('ready'); const st = msg.closest('.sig-crt')?.querySelector('.sig-status'); if (st) st.textContent = 'Decoded · awaiting reply'; } });
  msg.addEventListener('click', () => tt.skip());
  bindKeys(choices);
  return frame(o.run, { screen: 'event-' + o.id, kind: 'terminal', eyebrow: 'Unknown signal', title: o.title, glyph: 'aerial-signal', cls: 'signal' },
    el('div', 'crt sig-crt', crtHead(o.id, 'Decoding', () => printed), msg),
    replies,
  );
}

export interface OutcomeOpts { run: RunState; id: string; title: string; text: string; fight: boolean; onEngage: () => void; onContinue: () => void }
export function outcomeView(o: OutcomeOpts) {
  const msg = el('p', 'outcome');
  teletype(msg, o.text, { cps: 150, delay: 200 });
  return frame(o.run, { screen: 'event-out-' + o.id, kind: 'terminal', eyebrow: 'Unknown signal', title: o.title, glyph: 'aerial-signal', cls: 'signal', hostile: o.fight },
    el('div', 'crt sig-crt' + (o.fight ? ' alarm' : ''), crtHead(o.id, o.fight ? 'Contact' : 'Logged', () => true), msg),
    foot(o.fight
      ? el('button', { class: 'btn primary hostile', onclick: o.onEngage }, 'Engage')
      : el('button', { class: 'btn primary', id: 'btn-continue', onclick: o.onContinue }, 'Continue')),
  );
}
