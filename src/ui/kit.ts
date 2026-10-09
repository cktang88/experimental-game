// Ship's-equipment parts for the interface (see docs/ART.md, UI): stencil plates, lamps, split-flap drums,
// segmented bars, needle gauges, rubber stamps, Dymo tape and a teletype printer. Adapted from the
// bunker-equipment kit in the author's Dead Air (ui-art.js / panel-ui.js).
import { el, svg, pad, prefersReducedMotion, flapValue, type Child } from './h';
import { uiSound } from './sound';

/** Stencilled legend plate, e.g. plate('Hull'). */
export const plate = (text: string, cls = '') => el('span', 'plate' + (cls ? ' ' + cls : ''), text);
/** A small engraved key label (for instrument cells). */
export const plateK = (text: string) => el('span', 'plate-k', text);
/** Embossed label-maker tape. */
export const tape = (text: string, cls = '') => el('span', 'tape' + (cls ? ' ' + cls : ''), text);
/** A lamp lens. state: on | off | warn | hostile | plasma | blink. */
export const lamp = (state = 'off', label = '') => el('i', { class: `lamp ${state}`, 'aria-hidden': label ? null : 'true', title: label || null });
export const keycap = (k: string) => el('kbd', null, k);

/* ---------------- split-flap drums ---------------- */
const lastShown = new Map<string, number>();
export { flapValue };
/**
 * Split-flap counter. With a `memo` key the drums roll from the value last shown under that key
 * (so the scrap counter ticks down when you buy something); without one they count up from zero.
 */
export function flap(value: number, width = 3, memo = '', attrs: Record<string, any> = {}) {
  const v = Math.max(0, Math.floor(value));
  const from = memo ? (lastShown.get(memo) ?? v) : 0;
  if (memo) lastShown.set(memo, v);
  const w = Math.max(width, String(v).length);
  const row = el('span', { class: 'flaps', role: 'text', 'aria-label': String(v), ...attrs });
  const drums: HTMLElement[] = [];
  for (let i = 0; i < w; i++) { const b = el('b'); drums.push(b); row.append(el('i', { class: 'flap', 'aria-hidden': 'true' }, b)); }
  const paint = (n: number, flip: boolean) => {
    const s = pad(n, w);
    drums.forEach((b, i) => {
      if (b.textContent === s[i]) return;
      b.textContent = s[i];
      if (flip) { const d = b.parentElement!; d.classList.remove('flip'); void d.offsetWidth; d.classList.add('flip'); }
    });
  };
  paint(from, false);
  if (from !== v) {
    if (prefersReducedMotion()) paint(v, false);
    else {
      const dur = Math.min(1100, 380 + Math.abs(v - from) * 6), t0 = performance.now() + 140;
      const step = (now: number) => {
        if (!row.isConnected && now - t0 > 200) { paint(v, false); return; }
        const p = (now - t0) / dur;
        if (p >= 0) { const before = row.textContent; paint(flapValue(from, v, p), true); if (before !== row.textContent) uiSound('flap'); }
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
  }
  return row;
}
/** Forget the remembered value so the next flap with this key counts from its own value (new run). */
export const resetFlap = (memo: string) => lastShown.delete(memo);

/* ---------------- segmented bar ---------------- */
/** A bank of lit segments. `k` is 0..1. Colour comes from the class (hull / shield / hostile / scrap). */
export function segBar(k: number, n = 20, cls = 'hull') {
  const lit = Math.round(Math.max(0, Math.min(1, k)) * n);
  const bar = el('span', { class: `segbar ${cls}${k < 0.3 ? ' low' : ''}`, role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(k * 100) });
  for (let i = 0; i < n; i++) bar.append(el('i', i < lit ? 'on' : null));
  return bar;
}

/* ---------------- needle gauge ---------------- */
/** Small analog gauge (needle sweeps -75..+75 degrees and overshoots into place). */
const lastAngle = new Map<string, number>();
export function gauge(frac: number, label: string, readout: string, opts: { red?: boolean; memo?: string } = {}) {
  const f = Math.max(0, Math.min(1, frac)), ang = -75 + f * 150;
  const from = opts.memo ? lastAngle.get(opts.memo) ?? -75 : -75;
  if (opts.memo) lastAngle.set(opts.memo, ang);
  const ticks = svg('g', { class: 'g-ticks' });
  for (let i = 0; i <= 10; i++) {
    const a = ((-75 + i * 15) - 90) * Math.PI / 180, r0 = i % 5 === 0 ? 16 : 19;
    ticks.append(svg('path', { d: `M${(32 + Math.cos(a) * r0).toFixed(1)} ${(36 + Math.sin(a) * r0).toFixed(1)}L${(32 + Math.cos(a) * 22.5).toFixed(1)} ${(36 + Math.sin(a) * 22.5).toFixed(1)}` }));
  }
  const needle = svg('g', { class: 'g-needle', style: `--a:${ang.toFixed(1)}deg;--from:${from.toFixed(1)}deg` }, svg('path', { d: 'M32 38V13' }));
  const s = svg('svg', { viewBox: '0 0 64 44', 'aria-hidden': 'true', focusable: 'false' },
    svg('path', { class: 'g-face', d: 'M4 38A28 28 0 0 1 60 38z' }),
    opts.red ? svg('path', { class: 'g-red', d: 'M47.9 17.6A22.5 22.5 0 0 1 54.5 34' }) : null,
    ticks, needle, svg('circle', { class: 'g-hub', cx: 32, cy: 36, r: 3 }));
  const g = el('span', { class: 'gauge', role: 'img', 'aria-label': `${label} ${readout}` }, s, el('b', null, readout), el('small', null, label));
  if (prefersReducedMotion()) g.classList.add('live', 'still');
  else requestAnimationFrame(() => requestAnimationFrame(() => g.classList.add('live')));
  return g;
}

/* ---------------- rubber stamps ---------------- */
/** A rubber-stamp impression. `fresh` slams it down with ink spread. */
export function stamp(text: string, cls = '', fresh = false, sub = '') {
  return el('span', { class: `stamp ${cls}${fresh ? ' fresh' : ''}`, 'aria-hidden': 'true' }, el('b', null, text), sub ? el('small', null, sub) : null);
}

/* ---------------- teletype ---------------- */
/**
 * Print `text` into `node` like a teletype: bursts of characters with a block cursor.
 * Returns a skip() that prints the rest at once. Reduced motion prints instantly.
 */
export function teletype(node: HTMLElement, text: string, opts: { cps?: number; delay?: number; done?: () => void } = {}) {
  const cps = opts.cps ?? 190;
  node.setAttribute('aria-label', text);
  const shown = el('span', { 'aria-hidden': 'true' }), cursor = el('i', { class: 'tt-cursor', 'aria-hidden': 'true' });
  node.replaceChildren(shown, cursor);
  let i = 0, finished = false, raf = 0;
  const finish = () => { if (finished) return; finished = true; cancelAnimationFrame(raf); shown.textContent = text; node.classList.add('tt-done'); opts.done?.(); };
  if (prefersReducedMotion() || !text) { finish(); return { skip: finish }; }
  const t0 = performance.now() + (opts.delay ?? 0);
  const step = (now: number) => {
    if (finished) return;
    if (!node.isConnected && now - t0 > 400) { finish(); return; }
    const want = Math.floor(((now - t0) / 1000) * cps);
    if (want > i) {
      // print in word-sized bursts, like a real printer buffering a line
      i = Math.min(text.length, want);
      shown.textContent = text.slice(0, i);
      uiSound('type');
    }
    if (i >= text.length) { finish(); return; }
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return { skip: finish };
}

/* ---------------- frames ---------------- */
/** Section heading inside a console: a stencil legend on a rule, with optional right-hand note. */
export const legend = (text: string, note: Child = null) => el('h3', 'legend', el('span', null, text), note ? el('small', null, note) : null);
