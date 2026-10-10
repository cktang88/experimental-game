import { describe, it, expect } from 'vitest';
import { derive, mkPart, starterBuild } from '../../src/data/parts';
import { mountTraverse, clampYaw, gunCount } from '../../src/render/ship/arcs';

describe('ship gun traverse (render)', () => {
  const dv = derive({ sections: [
    { type: 'bridge', slots: [mkPart('pulse', 1)] },
    { type: 'gundeck', slots: [mkPart('flak', 1), mkPart('missile', 1)] },
    { type: 'battery', slots: [mkPart('pulse', 1), mkPart('pulse', 1), mkPart('rail', 1)] },
    { type: 'battery', slots: [mkPart('tesla', 1), mkPart('artillery', 1), mkPart('bomb', 1)] },
  ] });
  const tr = (si: number, i: number) => { const m = dv.mounts.find((q) => q.si === si && q.i === i)!; return mountTraverse(m, dv.rects[si].type); };

  it('dresses each mount by where it sits', () => {
    expect(tr(0, 0).kind).toBe('bow');
    expect(tr(1, 0).kind).toBe('dorsal');
    expect(tr(2, 0).kind).toBe('side');
    expect(tr(2, 1).kind).toBe('dorsal');
    expect(tr(3, 0).kind).toBe('omni');
    expect(tr(3, 1).kind).toBe('ventral');
    expect(tr(3, 2).kind).toBe('ventral');
  });

  it('dorsal mounts are anti-air only and train all round; bow and side mounts reach the ground in a limited arc', () => {
    expect(tr(1, 0).layer).toBe('air');
    expect(tr(1, 0).half).toBeGreaterThanOrEqual(Math.PI);
    for (const t of [tr(0, 0), tr(2, 0), tr(2, 2)]) { expect(t.layer).toBe('both'); expect(t.half).toBeLessThan(Math.PI); }
  });

  it('broadside guns rest outboard: port to +PI/2, starboard to -PI/2', () => {
    expect(tr(2, 0).center).toBeCloseTo(Math.PI / 2);
    expect(tr(2, 2).center).toBeCloseTo(-Math.PI / 2);
  });

  it('clamps yaw into the arc and returns to rest for targets across the hull', () => {
    const port = tr(2, 0);
    expect(clampYaw(port, Math.PI / 2 + 0.3)).toBeCloseTo(Math.PI / 2 + 0.3);
    expect(clampYaw(port, Math.PI / 2 + 0.9)).toBeCloseTo(Math.PI / 2 + port.half);
    expect(clampYaw(port, -Math.PI / 2)).toBeCloseTo(port.center);
    expect(clampYaw(tr(1, 0), 2.5)).toBeCloseTo(2.5);
  });

  it('heavier tiers field more guns per mount', () => {
    expect(gunCount('pulse', 1)).toBeLessThan(gunCount('pulse', 5));
    expect(starterBuild().sections.length).toBeGreaterThan(0);
  });
});
