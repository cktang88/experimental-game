// Biomes: what the world below the fight looks like. Owned by the city/world workstream.
//
// A fight flies over one biome (S.theme) and sometimes crosses into a second one part-way through (CITY.biomeB,
// see worldgen.ts): a coastline, a desert edge, a snowline. The run picks them from a ring of neighbours so a
// campaign reads as a journey (city -> harbour -> forest -> mountains -> desert -> airbase -> city ...).
// Pure data and functions: no rendering, no combat state.

export const enum Biome { City = 0, Port = 1, Airfield = 2, Desert = 3, Snow = 4, Forest = 5 }
export const BIOME_COUNT = 6;

export interface BiomeInfo {
  id: Biome;
  /** Banner name ("Sector 2 · White Range"). */
  name: string;
  /** One-word kind, for codex/UI copy. */
  kind: string;
  /** Scrap multiplier for worldBlast() in this biome (cityPay), tuned so every biome pays about the same per fight. */
  pay: number;
}

export const BIOMES: readonly BiomeInfo[] = [
  { id: Biome.City, name: 'Sodium City', kind: 'Night city', pay: 0.11 },
  { id: Biome.Port, name: 'Iron Harbour', kind: 'Port', pay: 0.2 },
  { id: Biome.Airfield, name: 'Kestrel Airbase', kind: 'Airfield', pay: 0.34 },
  { id: Biome.Desert, name: 'Glass Desert', kind: 'Desert', pay: 0.42 },
  { id: Biome.Snow, name: 'White Range', kind: 'Mountains', pay: 0.4 },
  { id: Biome.Forest, name: 'Deepwood', kind: 'Forest', pay: 0.38 },
];

/**
 * Journey order. Neighbours share an edge that blends well: city and harbour (a coastline), harbour and forest
 * (a wooded coast), forest and mountains (the snowline), mountains and desert (a cold desert edge), desert and
 * airbase (a desert airstrip), airbase and city (the city's airport).
 */
export const RING: readonly Biome[] = [Biome.City, Biome.Port, Biome.Forest, Biome.Snow, Biome.Desert, Biome.Airfield];

export interface BiomePick {
  /** Biome at the start of the fight. */
  a: Biome;
  /** Biome the fight crosses into, or -1 for none. */
  b: Biome | -1;
}

/**
 * The biomes of a fight. Each sector covers two neighbours of the ring: the first floors fly over the first,
 * floors 3-5 cross from the first into the second, the rest (and the boss) fly over the second.
 * Without a run seed (the balance harness) the ring starts at the city, so the economy tables stay comparable.
 */
export function biomeFor(sector: number, floor = 2, seed?: number): BiomePick {
  const start = seed === undefined ? 0 : (((seed >>> 0) % 977) * 7) % BIOME_COUNT;
  const i = start + 2 * Math.max(0, sector - 1);
  const p = RING[i % BIOME_COUNT], q = RING[(i + 1) % BIOME_COUNT];
  if (floor <= 2) return { a: p, b: -1 };
  if (floor <= 5) return { a: p, b: q };
  return { a: q, b: -1 };
}

export const biomeName = (b: number) => BIOMES[((b % BIOME_COUNT) + BIOME_COUNT) % BIOME_COUNT].name;
