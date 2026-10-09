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
  good: '#8fe39a',
  scrap: '#e0c35c',
  white: '#fff4e0',
} as const;

/** One look per sector. Ground tones are the city at night; fog and sky set the mood. */
export const THEMES = [
  { name: 'Ashport', base: '#1d2124', alt: '#2a2f33', line: '#3a3f42', dec: '#121517', acc: '#4a4030', fog: '#0d1114', window: '#ffb347' },
  { name: 'Rust Flats', base: '#2a2219', alt: '#3a2f24', line: '#47392b', dec: '#1a1510', acc: '#5a4630', fog: '#130f0b', window: '#ffa040' },
  { name: 'Glacier Yard', base: '#1c242c', alt: '#26313b', line: '#33424f', dec: '#11171d', acc: '#3f5363', fog: '#0b1015', window: '#bfe6ff' },
  { name: 'Ash Belt', base: '#262224', alt: '#332d30', line: '#3e3639', dec: '#171415', acc: '#4b3f43', fog: '#0f0c0d', window: '#ff9a6a' },
  { name: 'Neon Sprawl', base: '#181a26', alt: '#212536', line: '#2c3245', dec: '#10121b', acc: '#3a3157', fog: '#0a0b12', window: '#ff6ad5' },
] as const;
export type Theme = (typeof THEMES)[number];
