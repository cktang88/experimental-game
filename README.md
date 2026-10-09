# Ghost Dreadnought

A vertical-scrolling shmup roguelite in one HTML file. You fly a modular flying battleship up a hostile front.

- **Build your ship.** Bolt hull sections (gun decks, broadside batteries, armor, engines, utility spines) onto the stern. Each section adds hull and mass, plus weapon mounts or utility bays. More sections means more firepower, a bigger target and a slower ship, unless you add engines.
- **Air vs. ground.** Each weapon hits air targets (helis, jets, drones, gunships, bombers), ground targets (tanks, infantry, turrets, SAM sites, bunkers), or both.
- **Every 3 stages there's a boss.** The boss is the **ghost of a pilot who died in that sector**, flying their exact build at boss scale. Beat it and you salvage one of its parts.
- **When you die, you become a boss.** Your build is saved to the wreck registry for that sector. Other pilots who reach that sector may face it.

## Play

Open `index.html` in a browser. Steer with WASD/arrows or drag (touch works). Guns fire on their own. Press `P` to pause and `M` to mute.

## Wreck registry

When the page runs as a claude.ai artifact with the `db` capability, ghosts go to a shared `ghosts` collection, so everyone fights everyone's wrecks. Run locally, ghosts are kept in `localStorage`, so you only fight your own. If a sector has no ghosts yet, a procedurally armed AI "defense core" holds it.
