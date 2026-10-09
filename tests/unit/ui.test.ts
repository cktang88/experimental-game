import { describe, it, expect } from 'vitest';
import { WEAPONS, UTILS, SECTIONS } from '../../src/data/parts';
import { RELICS } from '../../src/data/relics';
import { NODE_INFO } from '../../src/game/map';
import { ICON_DATA } from '../../src/ui/icons-data';
import { iconId, PART_ICON, RELIC_ICON, SECTION_ICON, NODE_ICON } from '../../src/ui/icons';
import { flapValue, pad, hash } from '../../src/ui/h';

describe('ui icons', () => {
  it('every part, section, node and relic resolves to a bundled icon', () => {
    for (const id of [...Object.keys(WEAPONS), ...Object.keys(UTILS), ...Object.keys(SECTIONS), ...Object.keys(NODE_INFO), ...Object.keys(RELICS)])
      expect(ICON_DATA[iconId(id)], id).toBeTruthy();
  });
  it('mapping tables only point at bundled icons', () => {
    for (const t of [PART_ICON, RELIC_ICON, SECTION_ICON, NODE_ICON]) for (const [k, v] of Object.entries(t)) expect(ICON_DATA[v], `${k} -> ${v}`).toBeTruthy();
  });
  it('unknown ids fall back instead of throwing', () => {
    expect(ICON_DATA[iconId('definitely-not-a-part')]).toBeTruthy();
  });
});

describe('split-flap easing', () => {
  it('starts at the old value, ends exactly on the new one and never overshoots', () => {
    expect(flapValue(10, 250, 0)).toBe(10);
    expect(flapValue(10, 250, 1)).toBe(250);
    expect(flapValue(300, 120, 1)).toBe(120);
    let prev = 10;
    for (let p = 0; p <= 1; p += 0.05) { const v = flapValue(10, 250, p); expect(v).toBeGreaterThanOrEqual(prev); expect(v).toBeLessThanOrEqual(250); prev = v; }
  });
  it('pads and hashes deterministically', () => {
    expect(pad(7, 3)).toBe('007');
    expect(hash('abc')).toBe(hash('abc'));
    expect(hash('abc')).not.toBe(hash('abd'));
  });
});
