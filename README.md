# Ghost Dreadnought

A vertical-scrolling shmup roguelite for the browser. You fly a flying battleship that you build one hull section at a time. You chart a route through each sector the way you would in Slay the Spire. At the end of every sector you fight a **ghost dreadnought**: the wreck of a real pilot who died there. When you die, your ship joins the pool and becomes someone else's boss.

## Run it

```bash
npm install
npm run dev          # Vite client on http://localhost:5173 + ghost registry API on :8787
```

For production, `npm start` builds the client and serves `dist/` and the API from one Node process (`PORT`, default 8787). Ghosts are stored in `data/ghosts.json`. Set `GHOST_DATA_DIR` to store them somewhere else.

## How a run works

- **Sector map.** Each sector has 10 floors of branching paths and ends with the boss. You can only move forward along connected nodes.
  - **Fight**: one of five engagement types (patrol, air wing, armored column, fortress line, drone swarm). You get scrap plus a choice of 1 of 3 parts.
  - **Elite**: an Ace Gunship, a Siege Crawler or a Drone Carrier, with escorts. It drops a relic and better parts.
  - **Merchant**: buy parts, hull sections and a relic; repair; sell spares; purge curses.
  - **Unknown signal**: 11 events with choices, risks and rewards. Some lead to ambush fights. One lets you loot a real dead pilot's wreck.
  - **Derelict**: a relic plus scrap. The middle floor of every sector is all derelicts.
  - **Drydock**: repair, upgrade a part by one tier, or weld on a free hull section. The floor before the boss is all drydocks.
  - **Ghost Dreadnought**: the boss. Its intel (blueprint, weapons, who flew it) is shown on the map before you commit.
- **Scrap** drops from destroyed enemies, supply caches, wreckage and floating salvage canisters. Caches and wreckage sometimes drop repair kits. A magnet radius pulls scrap in.
- **Your ship** is a stack of sections: bridge, gun decks, broadside batteries, armor, utility spines and engines. Each section has weapon mounts or utility bays. More sections mean more guns and more hull, but more mass. You refit freely from the map.
- **Weapons** hit air targets, ground targets, or both: pulse cannon, scatter laser, flak, seeker missiles, bomb bay, siege mortar, rail spine, arc coil and point defense. Parts run from Mk I to Mk V.
- **Relics** are 22 passive modifiers, including curses picked up from risky choices.
- **Death** uploads your exact build to the registry for the sector you died in. Bosses are drawn at random from everyone who died in that sector, preferring other pilots. If nobody has died there yet, a procedurally armed AI defense core holds it.

Controls: WASD or arrow keys to steer. Light guns (point defense, pulse, scatter, flak, arc coils) fire on their own. The mouse aims the heavy weapons: hold the left button to fire the selected group, the right button to salvo every group; 1-9, Q / E or the wheel select a group. Space fires Overdrive. On a touch screen, drag to steer and every gun aims itself. Press P or Esc to pause and M to mute. Runs are saved after every node and can be continued from the title screen.

## Code map

| Path | What it does |
| --- | --- |
| `src/game/combat.ts` | The shmup simulation: player, weapons, enemies, elites, ghost bosses, salvage, pickups |
| `src/game/map.ts` | Sector map generation (seeded, non-crossing paths, floor rules) |
| `src/game/run.ts` | Run state, rewards, save/load |
| `src/game/ghosts.ts` | Ghost registry client, validation, AI fallback bosses |
| `src/data/` | Parts and hull sections, enemies and encounters, relics, events |
| `src/render/renderer.ts` | Three.js renderer: extruded 3D ships, enemy models, instanced glow and smoke quads, shadows, explosion lights, bloom |
| `src/render/hud.ts` | 2D combat HUD overlay |
| `src/ui/` | DOM screens: map, refit, cards |
| `src/main.ts` | Screen flow and node handlers |
| `server/` | Zero-dependency Node ghost registry (`GET/POST /api/ghosts`) with server-side validation |

## Tests

```bash
npm test             # vitest: map invariants, ship stats, ghost validation (client and server), every event choice
npm run e2e          # Playwright: plays the real game in Chromium
```

The end-to-end suite starts the dev servers and plays through the title, map, a fight, salvage, refit, merchant, event, drydock, derelict, elite, boss, next sector, death (checking the ghost reaches the registry and becomes the next boss), save and continue, and the phone layout. It saves screenshots to `test-results/shots/`. To use a preinstalled Chromium, set `CHROMIUM_PATH`.
