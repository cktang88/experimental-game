// "Unknown signal" events. Each choice mutates the run and returns what happened.
import type { RunState } from '../game/run';
import { heal, healAmount, hurt, maxHp, randomPart, runRng, addRelic, relicChoices, changeBuild, dv } from '../game/run';
import { partName, mkPart, allParts, WEAPONS, partCost, type Part, ghostToBuild } from './parts';
import { RELICS } from './relics';
import { AMBUSH, type Encounter } from './enemies';
import { pick, rint } from '../util/rng';
import type { Ghost } from '../game/ghosts';

export interface Outcome { text: string; fight?: Encounter; partChoice?: Part[] }
export interface Choice { label: string; detail: string; disabled?: string; run: () => Outcome }
export interface EventCtx { run: RunState; ghost?: Ghost | null }
export interface EventDef { id: string; title: string; minSector?: number; needsGhost?: boolean; text: (c: EventCtx) => string; choices: (c: EventCtx) => Choice[] }

const pct = (run: RunState, f: number) => Math.round(maxHp(run) * f);
const need = (run: RunState, n: number) => (run.scrap < n ? `Needs ${n} scrap` : undefined);

export const EVENTS: EventDef[] = [
  {
    id: 'distress', title: 'Distress Beacon',
    text: () => 'A crippled freighter drifts in low orbit, broadcasting on an old fleet channel. Its cargo pods are intact. The beacon could be bait.',
    choices: ({ run }) => [
      { label: 'Board it', detail: 'Take a part from the hold. Might be an ambush.', run: () => {
        const r = runRng(run);
        if (r() < 0.4) return { text: 'Raiders were waiting behind the hull. Weapons hot.', fight: AMBUSH, partChoice: [randomPart(run, r, 1)] };
        const p = randomPart(run, r, 1); run.inv.push(p); return { text: `The crew is long gone. You pull a ${partName(p)} from the hold.` };
      } },
      { label: 'Strip the hull from a distance', detail: '+35 scrap', run: () => { run.scrap += 35; return { text: 'Your cutters peel off armor plates without docking. +35 scrap.' }; } },
    ],
  },
  {
    id: 'broker', title: 'Black Market Broker',
    text: () => 'A cloaked tender pings you with a price list and no return address. "Rare hardware. No questions. Scrap only."',
    choices: ({ run }) => {
      const [relic] = relicChoices(run, 1, ['rare']);
      return [
        relic ? { label: `Buy ${RELICS[relic].name}`, detail: `${RELICS[relic].desc} Costs 90 scrap.`, disabled: need(run, 90), run: () => { run.scrap -= 90; addRelic(run, relic); return { text: `The crate docks and seals. ${RELICS[relic].name} is yours.` }; } }
          : { label: 'Browse', detail: 'Nothing you lack.', disabled: 'Sold out', run: () => ({ text: '' }) },
        { label: 'Sell them a part', detail: 'They pay 1.5x the usual sell price for your weakest spare part.', disabled: run.inv.length ? undefined : 'Cargo hold is empty', run: () => {
          const p = run.inv.slice().sort((a, b) => partCost(a) - partCost(b))[0];
          const pay = Math.floor(partCost(p) * 0.6); run.inv.splice(run.inv.indexOf(p), 1); run.scrap += pay;
          return { text: `They take the ${partName(p)} and transfer ${pay} scrap.` };
        } },
        { label: 'Ignore the ping', detail: 'Nothing happens.', run: () => ({ text: 'The tender slips back into the dark.' }) },
      ];
    },
  },
  {
    id: 'reactor', title: 'Unstable Reactor Core',
    text: () => 'A reactor core floats free of a destroyed station, still humming. It would make a fine weapon power source, if it does not cook your crew first.',
    choices: ({ run }) => [
      { label: 'Haul it aboard', detail: `Gain Overclock Reactor Mk II. Lose ${pct(run, 0.15)} hull.`, run: () => { hurt(run, pct(run, 0.15)); const p = mkPart('reactor', 2); run.inv.push(p); return { text: 'Radiation alarms scream for an hour, then settle. The reactor is in your hold.' }; } },
      { label: 'Detonate it for salvage', detail: '+40 scrap', run: () => { run.scrap += 40; return { text: 'The flash lights up the whole sector. You sweep up 40 scrap.' }; } },
    ],
  },
  {
    id: 'ghost_signal', title: 'Ghost Signal', needsGhost: true,
    text: ({ ghost }) => ghost ? `A dead dreadnought hangs in the debris field. Its transponder still reads ${ghost.name}. Another pilot died here, and their guns are still mounted.` : 'A dead dreadnought hangs in the debris field, transponder silent.',
    choices: ({ run, ghost }) => {
      const parts = ghost ? allParts(ghostToBuild(ghost.sections)) : [];
      const best = parts.sort((a, b) => b.tier - a.tier)[0];
      return [
        best ? { label: `Cut out the ${partName(best)}`, detail: `Lose ${pct(run, 0.12)} hull to its dying defenses.`, run: () => { hurt(run, pct(run, 0.12)); run.inv.push(mkPart(best.id, best.tier)); return { text: `Its point defense fires one last time. You leave with the ${partName(best)}.` }; } }
          : { label: 'Search the wreck', detail: 'Nothing usable.', disabled: 'Picked clean', run: () => ({ text: '' }) },
        { label: 'Pay your respects', detail: `Repair ${Math.round(healAmount(run, 0.15))} hull.`, run: () => { heal(run, 0.15); return { text: 'Your crew holds a minute of silence and patches the hull while they are at it.' }; } },
      ];
    },
  },
  {
    id: 'scrapyard', title: 'Scrapyard Moon',
    text: () => 'A moon covered in wreckage from a war nobody remembers. Automated sentries still patrol parts of it.',
    choices: ({ run }) => [
      { label: 'Sweep the outskirts', detail: '+30 scrap, safe', run: () => { run.scrap += 30; return { text: 'Slim pickings, but no trouble. +30 scrap.' }; } },
      { label: 'Raid the core yards', detail: `+70 to 110 scrap. Lose ${pct(run, 0.1)} hull.`, run: () => { const g = rint(70, 110, runRng(run)); hurt(run, pct(run, 0.1)); run.scrap += g; return { text: `Sentries chew up your hull, but you haul out ${g} scrap.` }; } },
    ],
  },
  {
    id: 'rogue_ai', title: 'Rogue AI', minSector: 1,
    text: () => 'Something in your targeting computer starts talking back. It offers to optimize one of your weapons, in exchange for a little space in your hull systems.',
    choices: ({ run }) => {
      const ws = allParts(run.build).filter((p) => WEAPONS[p.id] && p.tier < 5);
      return [
        { label: 'Accept', detail: 'A random mounted weapon gains +1 tier. Gain the curse Parasitic AI (10% less max hull).', disabled: ws.length ? undefined : 'No weapon to improve', run: () => {
          const p = pick(ws, runRng(run)); p.tier++; addRelic(run, 'parasitic_ai');
          return { text: `${partName(p)} now fires with unsettling precision. The AI settles into your hull systems.` };
        } },
        { label: 'Purge it', detail: 'Lose 15 scrap to the reboot.', run: () => { run.scrap = Math.max(0, run.scrap - 15); return { text: 'A hard reboot clears it out. Some cached scrap credits are lost.' }; } },
      ];
    },
  },
  {
    id: 'convoy', title: 'Refugee Convoy',
    text: () => 'Civilian haulers limp past, low on everything. Their engineers wave you over.',
    choices: ({ run }) => [
      { label: 'Give them 40 scrap', detail: 'Their engineers repair you to full hull.', disabled: need(run, 40), run: () => { run.scrap -= 40; run.hp = maxHp(run); return { text: 'They work through the night. Your hull is back to full.' }; } },
      { label: 'Wave them on', detail: 'Nothing happens.', run: () => ({ text: 'The convoy drifts out of sensor range.' }) },
    ],
  },
  {
    id: 'minefield', title: 'Minefield Shortcut',
    text: () => 'A dense minefield guards an old supply depot. Going through is faster and there is loot inside.',
    choices: ({ run }) => [
      { label: 'Thread the minefield', detail: `Lose ${pct(run, 0.18)} hull. +80 scrap.`, run: () => { hurt(run, pct(run, 0.18)); run.scrap += 80; return { text: 'Two mines clip your stern. The depot pays for it: +80 scrap.' }; } },
      { label: 'Go around', detail: 'Nothing happens.', run: () => ({ text: 'The long way is quiet.' }) },
    ],
  },
  {
    id: 'test_range', title: 'Weapons Test Range',
    text: () => 'An abandoned proving ground. Prototype weapons are still racked in the bunkers, and the swap rigs still work.',
    choices: ({ run }) => {
      const ws = allParts(run.build).filter((p) => WEAPONS[p.id]);
      return [
        { label: 'Swap a weapon for a prototype', detail: 'A random mounted weapon becomes a random weapon one tier higher.', disabled: ws.length ? undefined : 'No weapon mounted', run: () => {
          const r = runRng(run), p = pick(ws, r), old = partName(p);
          const ids = Object.keys(WEAPONS).filter((k) => k !== p.id);
          p.id = pick(ids, r); p.tier = Math.min(5, p.tier + 1);
          return { text: `Your ${old} is now a ${partName(p)}.` };
        } },
        { label: 'Take the spare rack', detail: 'Gain a random part.', run: () => { const p = randomPart(run, runRng(run)); run.inv.push(p); return { text: `You load a ${partName(p)} into your hold.` }; } },
      ];
    },
  },
  {
    id: 'smugglers', title: "Smugglers' Cache",
    text: () => 'Sensors pick up a sealed vault on a rocky outcrop, guarded by a small, nervous patrol.',
    choices: ({ run }) => [
      { label: 'Attack the patrol', detail: 'Fight, then choose from three rare parts.', run: () => { const r = runRng(run); return { text: 'You open fire. They answer.', fight: AMBUSH, partChoice: [randomPart(run, r, 1), randomPart(run, r, 1), randomPart(run, r, 1)] }; } },
      { label: 'Leave them be', detail: 'Nothing happens.', run: () => ({ text: 'Not your fight today.' }) },
    ],
  },
  {
    id: 'shrine', title: 'Navigator Shrine', minSector: 1,
    text: () => 'Pilots leave tokens at this buoy for luck. Some of the tokens are quite valuable.',
    choices: ({ run }) => {
      const [relic] = relicChoices(run, 1, ['common']);
      return [
        { label: 'Leave 25 scrap', detail: `Repair ${Math.round(healAmount(run, 0.25))} hull.`, disabled: need(run, 25), run: () => { run.scrap -= 25; heal(run, 0.25); return { text: 'The buoy blinks once. Your crew swears the ship feels sturdier.' }; } },
        relic ? { label: 'Take a token', detail: `Gain ${RELICS[relic].name}, and the curse Leaking Core.`, run: () => { addRelic(run, relic); addRelic(run, 'leaking_core'); return { text: `${RELICS[relic].name} is yours. Your reactor starts to leak soon after.` }; } }
          : { label: 'Take a token', detail: 'Nothing left.', disabled: 'Picked clean', run: () => ({ text: '' }) },
      ];
    },
  },
];
export function pickEvent(run: RunState, hasGhost: boolean): EventDef {
  const r = runRng(run);
  const pool = EVENTS.filter((e) => (e.minSector ?? 1) <= run.sector && (!e.needsGhost || hasGhost));
  return pick(pool, r);
}
export { changeBuild, dv };
