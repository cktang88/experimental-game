// Tiny DOM builders shared by every screen. No framework: screens are rebuilt on change.
export type Child = Node | string | number | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, any> | string | null = null, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (typeof props === 'string') e.className = props;
  else if (props) for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'text') e.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k in e && typeof v !== 'string') (e as any)[k] = v;
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids) if (c != null && c !== false) e.append(c instanceof Node ? c : String(c));
  return e;
}

const SVGNS = 'http://www.w3.org/2000/svg';
export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...kids: (SVGElement | null)[]): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) { if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v); else e.setAttribute(k, String(v)); }
  for (const c of kids) if (c) e.append(c);
  return e;
}

export const prefersReducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Zero-padded integer, e.g. pad(7, 3) === '007'. */
export const pad = (n: number, w: number) => String(Math.max(0, Math.floor(n))).padStart(w, '0');

/** Small deterministic hash so the same id always gets the same jitter (slip tilt, serial numbers). */
export function hash(s: string | number) {
  let h = 2166136261;
  for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}

/** Ease-out-cubic integer from `a` to `b` at progress p, always landing exactly on b (split-flap drums). */
export function flapValue(a: number, b: number, p: number) {
  if (p >= 1) return b;
  const e = 1 - (1 - Math.max(0, p)) ** 3;
  return Math.round(a + (b - a) * e);
}
