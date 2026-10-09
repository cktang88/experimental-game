// Screen changes: nothing pops. The outgoing screen is frozen into an inert snapshot (inside a closed
// shadow root, so tests and assistive tech only ever see the live screen) and collapses like a CRT
// channel change while the new screen warms up underneath. Re-rendering the same screen (a purchase
// in the merchant, a mount in the refit bay) swaps in place and keeps the scroll position.
import { prefersReducedMotion } from './h';

const OUT_MS = 300;

function snapshot(from: HTMLElement): HTMLElement | null {
  if (!from.firstChild) return null;
  const host = document.createElement('div');
  host.className = 'ui-ghost';
  host.setAttribute('aria-hidden', 'true');
  (host as any).inert = true;
  let root: ShadowRoot;
  try { root = host.attachShadow({ mode: 'closed' }); } catch { return null; }
  for (const s of document.querySelectorAll('style, link[rel="stylesheet"]')) root.append(s.cloneNode(true));
  const frame = document.createElement('div');
  frame.className = 'ghost-frame';
  frame.style.cssText = `position:absolute;inset:0;overflow:hidden;`;
  const inner = document.createElement('div');
  inner.style.cssText = `position:absolute;left:0;right:0;top:${-from.scrollTop}px;min-height:100%;`;
  const srcCanvases = from.querySelectorAll('canvas');
  for (const n of from.childNodes) inner.append(n.cloneNode(true));
  const dstCanvases = inner.querySelectorAll('canvas');
  srcCanvases.forEach((c, i) => { try { dstCanvases[i].getContext('2d')?.drawImage(c, 0, 0); } catch { /* tainted or 0-size */ } });
  // ids must stay unique in the document even though the shadow tree is closed
  for (const n of inner.querySelectorAll('[id]')) n.removeAttribute('id');
  frame.append(inner);
  root.append(frame);
  return host;
}

let ghost: HTMLElement | null = null;
/** Replace the menu layer's content with a transition. */
export function swapScreen(u: HTMLElement, nodes: Node[]) {
  const first = nodes[0] as HTMLElement | undefined;
  const key = first?.dataset?.screen;
  const cur = u.firstElementChild as HTMLElement | null;
  const same = !!key && cur?.dataset?.screen === key;
  if (same) { const top = u.scrollTop; u.replaceChildren(...nodes); u.scrollTop = top; return; }
  const reduced = prefersReducedMotion();
  if (ghost) { ghost.remove(); ghost = null; }
  const snap = reduced ? null : snapshot(u);
  u.replaceChildren(...nodes);
  u.scrollTop = 0;
  if (!reduced && first instanceof HTMLElement) {
    first.classList.add('enter');
    // Timer, not animationend: if the compositor is starved and the animation never starts, the screen must still appear.
    setTimeout(() => first.classList.remove('enter'), 650);
  }
  if (snap) {
    ghost = snap;
    document.body.append(snap);
    const g = snap;
    setTimeout(() => { g.remove(); if (ghost === g) ghost = null; }, OUT_MS + 40);
  }
}
