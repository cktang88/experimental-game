// The one seam between the interface and audio. Every UI sound goes through uiSound(), so the audio
// workstream can replace the recipes (or the import below) in one place.
//
// Hooks fired by the UI (name -> current fallback):
//   'press'  a button or switch went down      -> sfx('ui')
//   'hover'  pointer entered an actionable item -> (silent until audio defines sfx('hover'))
//   'buy'    a requisition was approved         -> sfx('buy')
//   'stamp'  a rubber stamp hit a slip          -> (silent until audio defines sfx('stamp'))
//   'flap'   a split-flap counter ticked        -> (silent until audio defines sfx('flap'))
//   'type'   a teletype printed a burst         -> (silent until audio defines sfx('type'))
//   'deny'   a disabled control was pressed     -> (silent until audio defines sfx('deny'))
import { sfx } from '../game/audio';

const FALLBACK: Record<string, string> = { press: 'ui', buy: 'buy' };
const GAP: Record<string, number> = { press: 60, hover: 70, flap: 45, type: 55, stamp: 90 };
const last: Record<string, number> = {};

export function uiSound(name: 'press' | 'hover' | 'buy' | 'stamp' | 'flap' | 'type' | 'deny') {
  const now = performance.now();
  if (now - (last[name] ?? -1e9) < (GAP[name] ?? 0)) return;
  last[name] = now;
  sfx(FALLBACK[name] ?? name);
}

let wired = false;
/** Delegated hover and press sounds for every button in the menu layer. */
export function wireUiSounds(root: HTMLElement) {
  if (wired) return; wired = true;
  let hovered: Element | null = null;
  root.addEventListener('pointerover', (e) => {
    const b = (e.target as Element).closest?.('button, [role=button]');
    if (b === hovered) return; hovered = b;
    if (b && !(b as HTMLButtonElement).disabled) uiSound('hover');
  });
  root.addEventListener('pointerdown', (e) => {
    const b = (e.target as Element).closest?.('button, [role=button]');
    if (!b) return;
    uiSound((b as HTMLButtonElement).disabled ? 'deny' : 'press');
  });
}
