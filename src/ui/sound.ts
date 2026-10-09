// The one seam between the interface and audio. Every UI sound goes through uiSound(), so the audio
// workstream can replace the recipes (or the import below) in one place.
//
// Hooks fired by the UI (name -> current fallback):
//   'press'  a button or switch went down      -> sfx('ui')
//   'hover'  pointer entered an actionable item -> sfx('uiHover')
//   'buy'    a requisition was approved         -> sfx('buy')
//   'stamp'  a rubber stamp hit a slip          -> sfx('uiStamp')
//   'flap'   a split-flap counter ticked        -> sfx('uiFlap')
//   'type'   a teletype printed a burst         -> sfx('uiToggle')
//   'deny'   a disabled control was pressed     -> sfx('uiError')
import { sfx } from '../game/audio';

/** UI hook -> audio cue name (cues live in src/audio/cues.ts). */
const FALLBACK: Record<string, string> = { press: 'ui', hover: 'uiHover', buy: 'buy', stamp: 'uiStamp', flap: 'uiFlap', type: 'uiToggle', deny: 'uiError' };
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

/** Applies the interface's volume sliders to the audio engine, now and on every change. */
export function wireAudioSettings(apply: (k: 'master' | 'music' | 'sfx', v: number) => void, read: () => { master: number; music: number; sfx: number }, subscribe: (fn: () => void) => void) {
  const push = () => { const s = read(); apply('master', s.master); apply('music', s.music); apply('sfx', s.sfx); };
  push(); subscribe(push);
}
