import { describe, it, expect } from 'vitest';
import { derive, starterBuild, mkPart, buildToGhost, ghostToBuild, neutralMods, WEAPONS, UTILS, SECTIONS, mountArc, ARC_INFO } from '../../src/data/parts';
import { relicMods, RELICS } from '../../src/data/relics';
import { validGhost, aiGhost } from '../../src/game/ghosts';
// @ts-expect-error plain JS module shared with the server
import { validateGhost, WEAPON_IDS, UTIL_IDS, SECTION_SLOTS } from '../../server/validate.mjs';

describe('ship stats', () => {
  it('starter ship has expected hull and mounts', () => {
    const d = derive(starterBuild());
    expect(d.maxHp).toBe(60 + 35 + 25);
    expect(d.mounts).toHaveLength(5);
    expect(d.mounts.filter((m) => m.part).length).toBe(4);
  });
  it('more mass is slower, engines are faster', () => {
    const b = starterBuild();
    const base = derive(b).speed;
    b.sections.push({ type: 'armor', slots: [null] });
    const heavy = derive(b).speed;
    b.sections.push({ type: 'engine', slots: [null] });
    expect(heavy).toBeLessThan(base);
    expect(derive(b).speed).toBeGreaterThan(heavy);
  });
  it('utilities and relics modify stats', () => {
    const b = starterBuild(); b.sections[2].slots[0] = mkPart('shield', 2);
    expect(derive(b).shieldMax).toBe(60);
    expect(derive(b, relicMods(['heavy_keel'])).maxHp).toBe(derive(b).maxHp + 60);
    expect(derive(b, relicMods(['titan_frame'])).maxHp).toBe(Math.round(derive(b).maxHp * 1.3));
    expect(derive(b, relicMods(['afterburner'])).speed).toBeCloseTo(derive(b).speed * 1.15);
  });
  it('round-trips through the ghost format', () => {
    const b = starterBuild();
    const back = ghostToBuild(buildToGhost(b));
    expect(buildToGhost(back)).toEqual(buildToGhost(b));
  });
  it('every relic has a name, description and known rarity', () => {
    for (const [id, r] of Object.entries(RELICS)) { expect(r.name, id).toBeTruthy(); expect(['common', 'rare', 'boss', 'curse']).toContain(r.rarity); }
    expect(neutralMods().hullMul).toBe(1);
  });
});

describe('ghost validation', () => {
  it('client and server agree on part and section ids', () => {
    expect([...WEAPON_IDS].sort()).toEqual(Object.keys(WEAPONS).sort());
    expect([...UTIL_IDS].sort()).toEqual(Object.keys(UTILS).sort());
    for (const [k, v] of Object.entries(SECTIONS)) expect(SECTION_SLOTS[k]).toEqual(v.slots);
  });
  it('accepts a real ship and rejects junk', () => {
    const g = { id: 'p1-x', pilot: 'p1', name: 'ace', sector: 2, floor: 3, sections: buildToGhost(starterBuild()), relics: ['heavy_keel'], score: 10 };
    expect(validGhost(g)?.name).toBe('ACE');
    expect(validateGhost(g)?.sector).toBe(2);
    for (const bad of [null, {}, { ...g, sector: 0 }, { ...g, sector: 1.5 }, { ...g, sections: [] }, { ...g, sections: [{ type: '__proto__', slots: [] }] }, { ...g, sections: [{ type: 'gundeck', slots: [] }] }]) {
      expect(validGhost(bad)).toBeNull();
      expect(validateGhost(bad)).toBeNull();
    }
  });
  it('strips parts in the wrong slot kind and clamps tiers', () => {
    const g = { sector: 1, sections: [{ type: 'bridge', slots: [['plate', 9]] }, { type: 'armor', slots: [['plate', 9]] }] };
    const v = validateGhost(g);
    expect(v.sections[0].slots[0]).toBeNull();
    expect(v.sections[1].slots[0]).toEqual(['plate', 5]);
    expect(validGhost(g)!.sections[1].slots[0]).toEqual(['plate', 5]);
  });
  it('AI ghosts are valid ships that scale with sector', () => {
    for (let s = 1; s <= 6; s++) { const g = aiGhost(s); expect(validGhost(g)).not.toBeNull(); expect(validateGhost(g)).not.toBeNull(); }
    expect(derive(ghostToBuild(aiGhost(5).sections)).maxHp).toBeGreaterThan(derive(ghostToBuild(aiGhost(1).sections)).maxHp);
  });
});

describe('firing arcs', () => {
  it('assigns arcs by mount position and weapon', () => {
    const d = derive(starterBuild());
    expect(d.mounts.map((m) => [m.arc, m.side])).toEqual([['bow', 0], ['broadside', -1], ['ventral', 0], ['broadside', 1], ['internal', 0]]);
  });
  it('bombs and mortars are always ventral, coils and PD omni, gun decks fire from the bow', () => {
    expect(mountArc('gundeck', 'W', 'artillery')).toBe('ventral');
    expect(mountArc('battery', 'W', 'bomb')).toBe('ventral');
    expect(mountArc('battery', 'W', 'tesla')).toBe('omni');
    expect(mountArc('gundeck', 'W', 'pulse')).toBe('bow');
    expect(mountArc('battery', 'W', null)).toBe('broadside');
    for (const a of ['bow', 'broadside', 'ventral', 'omni', 'internal'] as const) expect(ARC_INFO[a].desc.length).toBeGreaterThan(10);
  });
  it('heavier hulls accelerate and brake more slowly', () => {
    const light = derive(starterBuild());
    const b = starterBuild(); for (let i = 0; i < 4; i++) b.sections.push({ type: 'armor', slots: [null] });
    const heavy = derive(b);
    expect(heavy.accel).toBeLessThan(light.accel);
    expect(heavy.brake).toBeLessThan(light.brake);
    expect(light.speed / light.accel).toBeLessThan(0.4);
  });
});
