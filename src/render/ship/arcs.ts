// Gun traverse per mount: where a turret may point, where it rests, what it may engage and how it is
// dressed (raised dorsal barbette, bow casemate, broadside sponson, ventral bay).
//
// This is the ONE place the renderer decides it. It mirrors the sim's firing arcs (src/game/combat.ts,
// docs/TECH.md "Firing arcs"): bow guns fire up the field in a narrow cone, broadside guns off their own
// flank, bombs and mortars ventrally, coils and point defence all round. When the game exports a shared
// per-mount traverse helper, swap the body of mountTraverse() for a call to it.
import { WEAPONS, type Mount, type SectionType } from '../../data/parts';
import { has } from '../../util/rng';

export type MountKind = 'dorsal' | 'bow' | 'side' | 'ventral' | 'omni';
export interface Traverse {
  kind: MountKind;
  /** Rest yaw in ship-local turret space: 0 toward the bow, +PI/2 to port (screen left), -PI/2 to starboard. */
  center: number;
  /** Half width of the traverse arc in radians; PI or more is free 360-degree training. */
  half: number;
  /** What the mount may engage: dorsal mounts are anti-air only; bow and side mounts reach the ground in their arcs. */
  layer: 'air' | 'ground' | 'both' | 'none';
  /** Barrel elevation for the look (radians): high-angle AA up, casemate guns depressed toward the city. */
  elev: number;
}

const FREE = Math.PI;

export function mountTraverse(m: Mount, section: SectionType): Traverse {
  const id = m.part?.id ?? '';
  if (!has(WEAPONS, id)) return { kind: 'dorsal', center: 0, half: 0, layer: 'none', elev: 0 };
  if (id === 'bomb') return { kind: 'ventral', center: 0, half: 0, layer: 'ground', elev: 0 };
  if (id === 'artillery') return { kind: 'ventral', center: 0, half: FREE, layer: 'ground', elev: 0.85 };
  if (id === 'pd') return { kind: 'omni', center: 0, half: FREE, layer: 'none', elev: 0.5 };
  if (id === 'tesla') return { kind: 'omni', center: 0, half: FREE, layer: 'both', elev: 0 };
  if (m.arc === 'broadside') {
    // Outer battery guns sit in flank sponsons and train across their own beam only (sim: +-0.5 rad).
    if (m.side) return { kind: 'side', center: -m.side * Math.PI / 2, half: 0.62, layer: 'both', elev: -0.2 };
    // The centreline gun of a battery is a superfiring dorsal mount: all round, sky only.
    return { kind: 'dorsal', center: 0, half: FREE, layer: 'air', elev: 0.55 };
  }
  // Bow arc: the bridge's gun is a forward casemate (sim cone +-0.35 rad); gun-deck mounts are dorsal turrets.
  if (section === 'bridge') return { kind: 'bow', center: 0, half: 0.42, layer: 'both', elev: -0.1 };
  return { kind: 'dorsal', center: 0, half: FREE, layer: 'air', elev: 0.5 };
}

/** Clamp a wanted yaw into a traverse; a target well outside the arc sends the gun back to rest. */
export function clampYaw(t: Traverse, want: number) {
  if (t.half >= FREE) return want;
  let d = want - t.center; d = Math.atan2(Math.sin(d), Math.cos(d));
  if (Math.abs(d) > t.half + 0.5) return t.center;
  return t.center + Math.max(-t.half, Math.min(t.half, d));
}
