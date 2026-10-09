// Shared ghost validation. Mirrors the part/section ids in src/data/parts.ts; the client re-validates on load.
export const SECTION_SLOTS = {
  bridge: ['W'], gundeck: ['W', 'W'], battery: ['W', 'W', 'W'], armor: ['U'], spine: ['U', 'U'], engine: ['U'],
};
export const WEAPON_IDS = ['pulse', 'spread', 'flak', 'missile', 'bomb', 'artillery', 'rail', 'tesla', 'pd'];
export const UTIL_IDS = ['plate', 'shield', 'thruster', 'reactor', 'repair', 'magnet', 'drones'];
const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);

export function validateGhost(g) {
  if (!g || typeof g !== 'object') return null;
  const sector = Number(g.sector);
  if (!Number.isInteger(sector) || sector < 1 || sector > 99) return null;
  if (!Array.isArray(g.sections) || g.sections.length < 1 || g.sections.length > 8) return null;
  const sections = [];
  for (const s of g.sections) {
    if (!s || !own(SECTION_SLOTS, s.type)) return null;
    const kinds = SECTION_SLOTS[s.type];
    const slots = kinds.map((k, i) => {
      const v = Array.isArray(s.slots) ? s.slots[i] : null;
      if (!Array.isArray(v)) return null;
      const id = v[0];
      const ok = k === 'W' ? WEAPON_IDS.includes(id) : UTIL_IDS.includes(id);
      if (!ok) return null;
      return [id, Math.min(5, Math.max(1, Math.round(Number(v[1]) || 1)))];
    });
    sections.push({ type: s.type, slots });
  }
  if (!sections.some((s) => s.type === 'bridge')) return null;
  const name = String(g.name || '').toUpperCase().replace(/[^A-Z0-9 _.\-]/g, '').trim().slice(0, 16) || 'UNKNOWN';
  const pilot = String(g.pilot || '').replace(/[^a-z0-9]/gi, '').slice(0, 24);
  const id = String(g.id || '').replace(/[^a-z0-9\-]/gi, '').slice(0, 48) || `${pilot}-${Date.now().toString(36)}`;
  const relics = Array.isArray(g.relics) ? g.relics.filter((r) => typeof r === 'string' && /^[a-z_]{2,24}$/.test(r)).slice(0, 30) : [];
  return {
    id, pilot, name, sector,
    floor: Math.max(0, Math.min(20, Math.round(Number(g.floor) || 0))),
    sections, relics,
    score: Math.max(0, Math.round(Number(g.score) || 0)),
    at: Number(g.at) || Date.now(),
    v: 2,
  };
}
