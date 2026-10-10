# Ghost Dreadnought — Design Bible

## The fantasy

You command a dreadnought the size of an aircraft carrier, crewed by thousands. It crosses the sky at the speed of weather. Below, cities go dark as you pass. Everything in the game should say one thing: **the world is afraid of you, and it is right to be.**

## Pillars

1. **Scale you can feel.** The ship is a building-sized object over a city of thousands of lit windows. Enemies are true to scale: small, numerous and brave, a tank a speck of light next to the hull, while a flak tower or a siege crawler is big because it is big. The fire-control computer (tactical symbology, the FLIR view) is how a dreadnought's crew sees them. The camera, the parallax, the sound and the pace of the ship all sell mass: it accelerates like a freighter, its broadsides shake the screen, and its shadow covers whole blocks.
2. **Power with weight.** Every weapon has wind-up, recoil, a muzzle event, travel, impact and an aftermath (scorch, fire, smoke, debris, secondary explosions). The player spends their time destroying things in ways that look and sound expensive.
3. **One world, one hand.** Every entity, effect, icon and panel comes from one material language: blackened gunmetal, worn hazard paint, plasma cyan, sodium amber city light, hostile red. No mismatched packs and no SaaS-dashboard UI.
4. **Craft in the basics.** Movement, aiming, readability of threats, menu transitions and saving are smooth, predictable and polished before any feature is added. Nothing appears or disappears without a transition. Nothing important is ever unreadable.

## Loops

### Seconds to minutes: the strike (core loop)
- Glide across the battlefield on the full width of a desktop screen. Movement is heavy but responsive: the ship eases in and out of motion and banks into turns.
- Two layers of fire. **Auto guns** (pulse cannons, scatter lasers, flak, arc coils, point defense) fire on their own at whatever is in their arc, so the screen is never quiet: move and the ship is already fighting. **Heavy weapons** (rail cannons, seeker missiles, siege mortars, bomb bays) are the deliberate, devastating layer: they sit in numbered **weapon groups** and fire where the pilot aims. Zero learning: steer with WASD and hold the left mouse button over anything you want gone. Depth: 1-9 (or Q / E, the wheel) pick a group, the right button salvoes every group at once.
- **Where a gun sits matters.** The bridge gun covers a forward cone and hits air and ground; top-deck (gun deck) turrets turn all the way round but cannot depress below the hull, so they only engage aircraft and ghost dreadnoughts; broadside batteries cover their flank, air and ground; bomb bays and mortars drop from the belly onto the ground only. Building a ship is choosing which threats each placement covers; player skill is positioning plus aim.
- The reticle tells the pilot everything: the selected group, its reload, a ground ring where bombs and shells will land, missile lock brackets, the firing lines of rails that bear, and why a group cannot fire (out of arc, out of reach, air only).
- **Scrap magnet:** wrecks spill scrap that streams into the hull from a generous radius, accelerating as it comes. Nothing you earn is lost off the screen. Salvage Magnets and the Magnetized Hull relic widen the pull.
- On touch screens the ship flies by drag and every gun aims itself.
- **FLIR** (hold Shift, or T to latch): the main view switches to a white-hot thermal camera, like a gunship's sensor turret. The city goes cool and dark, every engine, crew and fire glows, and a 4x zoom inset shows the true-scale target under the reticle. It costs nothing but attention: a way to find the tanks hiding in a lit city, and to feel how small they are.
- **Overdrive** (the active skill, on Space): charge it by destroying things, then unleash it. Each hull class has its own. The first is a *Ventral Lance*, a sustained beam that carves a burning line through the city below.
- **Dopamine beats:**
  - Chains of secondary explosions.
  - Buildings collapsing into dust plumes.
  - A *carnage meter* whose multiplier lifts scrap value, so a rampage pays.
  - Elite kills that freeze time for 80 ms.
  - Scrap streams that whoosh into the hull with a rising pitch.
  - Hull damage that shows on the ship as fires, sparks and venting.

### An hour or two: the campaign run (Spire loop)
- Three sectors. Each is a 10-floor branching route ending in a **ghost dreadnought**: a real fallen player's ship.
- Nodes are strikes, elites, merchants, signals (events), derelicts (relics) and drydocks.
- Build-crafting: hull sections and mounts, part tiers, relics that bend rules, curses taken for power, and synergies such as flak plus magnet, or mortars plus incendiary.
- Every run ends with a **wreck report**: what you destroyed, in totals that feel enormous (tons of ordnance, buildings levelled, hours of crew time), and the ghost you left behind.

### Ten hours and beyond: the fleet (meta loop)
- **Admiralty rank** earned per run unlocks new hull classes (Leviathan carrier, Lance destroyer, Bastion monitor), each with a different Overdrive and starting layout.
- **Codex**: an entry and an illustration for every enemy, part, relic and ghost you have killed.
- **Ghost ledger**: other players' ships you destroyed, and how many players your own ghosts have killed. The asynchronous rivalry is the long-term hook.
- **Heat levels**: harder runs after your first victory, each adding a named modifier.
- Daily strike: one seeded route a day for everyone, with a shared leaderboard.

## Environments (after all mechanics are in)
Owner's direction: **gameplay first.** Environment work that doesn't affect gameplay starts only once every mechanic is in place.
- Stylized, not literal. A night city reads as lit rectangles: building masses with window grids, street-light lines and traffic streams. No need for real building models.
- Many distinct biomes, each with its own silhouette and color story: desert (dunes, convoys, dust), snow-covered mountains (ridges, pass forts), forests (canopy, firebreaks, logging rail), ports (docks, cranes, ships), airfields (runways, hangars, taxiing jets), plus the night city.
- Biomes should be unique and creative. Pick each sector's biome from the route so the run reads as a journey.
