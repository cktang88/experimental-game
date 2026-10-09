// Entry point for screen code: DOM builders, the menu layer, and the shared cards.
import { swapScreen } from './transition';
import { wireUiSounds } from './sound';

export { el, svg, type Child } from './h';
export { partCard, relicCard, relicChip, topBar, layerTag, pin, rankPips } from './cards';

export const ui = () => document.getElementById('ui')!;
/** Show a screen in the menu layer (no arguments clears it, e.g. for combat). Transitions are automatic. */
export function show(...nodes: Node[]) {
  const u = ui();
  wireUiSounds(u);
  swapScreen(u, nodes);
}
