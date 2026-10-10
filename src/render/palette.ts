// The one palette. Every entity, effect and UI element pulls its colors from here (UI mirrors these
// as CSS custom properties in styles.css). See docs/ART.md for the rules on using them.
export const PAL = {
  void: '#0a0e13',
  gunmetal: '#3a434d',
  steel: '#6a7b8e',
  hazard: '#f2a541',
  sodium: '#ffb347',
  plasma: '#4fd1e8',
  hostile: '#ff5a4e',
  hostileHot: '#ff7a5c',
  /** Enemy fire only (bullets, missiles, shells, beams, wind-up glints): magenta-pink, white-hot centres. */
  threat: '#ff2f8e',
  threatHot: '#ff9ad5',
  good: '#8fe39a',
  scrap: '#e0c35c',
  white: '#fff4e0',
} as const;

/** One look per biome (src/game/biomes.ts, indexed by S.theme). Ground tones, fog and window colour set the mood. */
export const THEMES = [
  { name: 'Sodium City', base: '#1d2124', alt: '#2a2f33', line: '#3a3f42', dec: '#121517', acc: '#4a4030', fog: '#0d1114', window: '#ffb347' },
  { name: 'Iron Harbour', base: '#1b2024', alt: '#262c31', line: '#363d43', dec: '#111518', acc: '#3a4148', fog: '#0a0f14', window: '#ffb347' },
  { name: 'Kestrel Airbase', base: '#1c1f1d', alt: '#272b28', line: '#373c38', dec: '#121412', acc: '#3e4540', fog: '#0b0e10', window: '#ffd29a' },
  { name: 'Glass Desert', base: '#2a2219', alt: '#3a2f24', line: '#47392b', dec: '#1a1510', acc: '#5a4630', fog: '#120e0a', window: '#ffa860' },
  { name: 'White Range', base: '#1c242c', alt: '#26313b', line: '#33424f', dec: '#11171d', acc: '#3f5363', fog: '#0b1017', window: '#ffc48a' },
  { name: 'Deepwood', base: '#171c18', alt: '#212821', line: '#2e362e', dec: '#0f130f', acc: '#2f3a2f', fog: '#080c0a', window: '#ffb060' },
] as const;
export type Theme = (typeof THEMES)[number];
