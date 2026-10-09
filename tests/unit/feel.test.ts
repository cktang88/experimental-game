import { describe, it, expect } from 'vitest';
import {
  stepShipVelocity, arriveWish, stepBank, hitstopFor, newStop, requestStop, stepStop, HITSTOP,
  slowSpeedAt, SLOWMO, newSlow, requestSlow, stepSlow, SLOWMO_SHORT, newCarnage, addCarnage, stepCarnage, carnageMult, CARNAGE,
} from '../../src/game/feel';

const tune = { topSpeed: 300, accel: 900, brake: 1100 };
const run = (f: () => void, n: number) => { for (let i = 0; i < n; i++) f(); };

describe('heavy ship movement', () => {
  it('eases up to top speed instead of snapping, and never exceeds it', () => {
    let v = { x: 0, y: 0 };
    v = stepShipVelocity(v, { x: 1, y: 0 }, tune, 1 / 60);
    expect(v.x).toBeCloseTo(15, 5);
    run(() => { v = stepShipVelocity(v, { x: 1, y: 0 }, tune, 1 / 60); }, 120);
    expect(v.x).toBeCloseTo(300, 5);
    v = stepShipVelocity(v, { x: 1, y: 1 }, tune, 1);
    expect(Math.hypot(v.x, v.y)).toBeLessThanOrEqual(300 + 1e-6);
  });
  it('coasts to a stop with brakes, and reverses harder than it accelerates', () => {
    let v = { x: 300, y: 0 };
    v = stepShipVelocity(v, { x: 0, y: 0 }, tune, 0.1);
    expect(v.x).toBeCloseTo(300 - 110, 5);
    const rev = stepShipVelocity({ x: 300, y: 0 }, { x: -1, y: 0 }, tune, 0.1);
    expect(rev.x).toBeCloseTo(300 - 200, 5);
  });
  it('drag steering arrives at the target without overshooting', () => {
    let x = 0, v = { x: 0, y: 0 }, maxX = 0;
    run(() => { const w = arriveWish(x, 0, 500, 0, tune); v = stepShipVelocity(v, w, tune, 1 / 60); x += v.x / 60; maxX = Math.max(maxX, x); }, 400);
    expect(Math.abs(x - 500)).toBeLessThan(3);
    expect(maxX).toBeLessThan(505);
  });
  it('banks toward lateral motion and settles back', () => {
    let b = 0; run(() => { b = stepBank(b, 300, 300, 1 / 60); }, 120);
    expect(b).toBeGreaterThan(0.95);
    run(() => { b = stepBank(b, 0, 300, 1 / 60); }, 120);
    expect(Math.abs(b)).toBeLessThan(0.05);
  });
});

describe('hitstop', () => {
  it('uses the dead-air formula', () => {
    expect(hitstopFor(true, 0)).toBeCloseTo(0.065);
    expect(hitstopFor(true, 800)).toBeCloseTo(0.11);
    expect(hitstopFor(false, 40)).toBeCloseTo(0.019);
  });
  it('caps ordinary freezes and enforces a cooldown, but forced moments always land', () => {
    const s = newStop();
    expect(requestStop(s, 0.11)).toBe(true);
    expect(s.left).toBeCloseTo(HITSTOP.maxS);
    let frames = 0; while (stepStop(s, 1 / 60)) frames++;
    expect(frames).toBeLessThanOrEqual(4);
    expect(requestStop(s, 0.05)).toBe(false); // inside cooldown
    stepStop(s, HITSTOP.cooldownS);
    expect(requestStop(s, 0.05)).toBe(true);
    expect(requestStop(s, HITSTOP.bossDeath, true)).toBe(true);
    expect(s.left).toBeCloseTo(HITSTOP.bossDeath);
  });
});

describe('slow-mo', () => {
  it('follows the tinwar shape', () => {
    expect(slowSpeedAt(0)).toBe(1);
    expect(slowSpeedAt(0.05)).toBeCloseTo(1 + (SLOWMO.rate - 1) * 0.5);
    expect(slowSpeedAt(0.5)).toBe(SLOWMO.rate);
    expect(slowSpeedAt(1.05)).toBeCloseTo(SLOWMO.rate + (1 - SLOWMO.rate) * 0.5);
    expect(slowSpeedAt(1.3)).toBe(1);
  });
  it('a shallow request does not cut a deep one short', () => {
    const s = newSlow(); requestSlow(s, SLOWMO); stepSlow(s, 0.3);
    requestSlow(s, SLOWMO_SHORT);
    expect(s.shape).toBe(SLOWMO);
    let total = 0; for (let i = 0; i < 200; i++) total += stepSlow(s, 1 / 60);
    expect(s.shape).toBeNull();
    expect(total).toBeLessThan(200);
  });
});

describe('carnage', () => {
  it('builds with destruction, caps at x3 and decays after a grace period', () => {
    const c = newCarnage();
    addCarnage(c, CARNAGE.perMult);
    expect(c.mult).toBeCloseTo(2);
    addCarnage(c, 10_000);
    expect(c.mult).toBe(CARNAGE.maxMult);
    stepCarnage(c, CARNAGE.grace * 0.5);
    expect(c.mult).toBe(CARNAGE.maxMult);
    for (let i = 0; i < 600; i++) stepCarnage(c, 1 / 60);
    expect(c.mult).toBeLessThan(1.5);
    expect(c.peak).toBe(CARNAGE.maxMult);
    expect(carnageMult(-5)).toBe(1);
  });
});
