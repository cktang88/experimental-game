# Ghost Dreadnought — Design Bible

## The fantasy

You command a dreadnought the size of an aircraft carrier, crewed by thousands. It crosses the sky at the speed of weather. Below, cities go dark as you pass. Everything in the game should say one thing: **the world is afraid of you, and it is right to be.**

## Pillars

1. **Scale you can feel.** The ship is a building-sized object over a city of thousands of lit windows. Enemies are small, numerous and brave. The camera, the parallax, the sound and the pace of the ship all sell mass: it accelerates like a freighter, its broadsides shake the screen, and its shadow covers whole blocks.
2. **Power with weight.** Every weapon has wind-up, recoil, a muzzle event, travel, impact and an aftermath (scorch, fire, smoke, debris, secondary explosions). The player spends their time destroying things in ways that look and sound expensive.
3. **One world, one hand.** Every entity, effect, icon and panel comes from one material language: blackened gunmetal, worn hazard paint, plasma cyan, sodium amber city light, hostile red. No mismatched packs and no SaaS-dashboard UI.
4. **Craft in the basics.** Movement, aiming, readability of threats, menu transitions and saving are smooth, predictable and polished before any feature is added. Nothing appears or disappears without a transition. Nothing important is ever unreadable.

## Loops

### Seconds to minutes: the strike (core loop)
- Glide across the battlefield on the full width of a desktop screen. Movement is heavy but responsive: the ship eases in and out of motion and banks into turns.
- Weapons fire automatically by **battery**. Bow guns hit aircraft, broadside batteries hit whatever is beside you, and ventral bomb bays and mortars hit the ground. Player skill is positioning: which battery covers which threat.
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
