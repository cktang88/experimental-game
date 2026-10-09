// Seeded RNG for map generation and events (combat uses Math.random for feel).
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rnd = (a: number, b: number, r: Rng = Math.random) => a + r() * (b - a);
export const rint = (a: number, b: number, r: Rng = Math.random) => Math.floor(rnd(a, b + 1, r));
export const pick = <T>(arr: readonly T[], r: Rng = Math.random): T => arr[Math.floor(r() * arr.length)];
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const has = (o: object, k: unknown): k is string => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
export function shuffle<T>(arr: T[], r: Rng = Math.random): T[] {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}
export function weighted<T extends string>(w: Partial<Record<T, number>>, r: Rng = Math.random): T {
  const entries = Object.entries(w) as [T, number][];
  const total = entries.reduce((s, [, v]) => s + (v || 0), 0);
  let x = r() * total;
  for (const [k, v] of entries) { x -= v || 0; if (x <= 0) return k; }
  return entries[entries.length - 1][0];
}
export const angDiff = (a: number, b: number) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
