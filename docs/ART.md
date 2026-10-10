# Art Bible

**One sentence:** a carrier-sized warship crosses a city at night, and everything it touches turns to light, fire and smoke.

Every entity, effect and panel must look like it belongs in that sentence. If a new thing would look at home in a cheerful mobile game, it is wrong.

## Scale and camera

- The camera looks down at the **flight plane** with a slight forward tilt (`src/render/engine.ts`). The **city is far below**: `groundScale` is about 1.6, so ground objects are drawn larger in world space to read at their gameplay size, and perspective makes them sit visibly deeper.
- **The dreadnought is an aircraft carrier (~330 m) over a city seen from very high up.** `SHIP_SCALE` is 3.1: the starter hull is about 180 field units long on a 1600×900 field (a fifth of the screen height), a full hull far more. The city is shrunk by `CITY_K` (0.25, `src/game/worldgen.ts`): a block is 25-55 field units, so the hull covers four to six blocks, buildings are tiny lit rectangles (window grids fade to their average glow, no facade detail), and street lamps become faint lines of light. The hull needs detail at three distances:
  - **Silhouette:** stepped superstructure, bridge tower, broadside sponsons, engine block.
  - **Panels:** plate seams, hatches, vents, trims and stripes from the sci-fi trim sheets.
  - **Life:** hundreds of tiny running lights, window strips, deck floodlights, blinking beacons and steam vents. *Thousands of crew* should be implied by thousands of lit portholes.
- **Enemies are small, brave and always legible.** They are not to scale with the city: like the units in a top-down helicopter shooter they are drawn chunky (1.25× their hit size in the air, 1.4× on the ground; an infantry squad is three oversized figures), so a tank is a tank at a glance even though a city block is smaller than it. Aircraft carry navigation lights (red port, green starboard, white strobe).

## Palette (`src/render/palette.ts`, mirrored in `src/styles.css`)

| Token | Use |
| --- | --- |
| `void #0a0e13` | Night, UI ground |
| `gunmetal / steel` | Every friendly hull: blackened metal, worn edges catch the sun |
| `hazard #f2a541` | Friendly accent: stripes, UI, our ordnance tracers |
| `sodium #ffb347` | City light: street lamps, windows, fires |
| `plasma #4fd1e8` | Friendly energy: shields, rail and arc weapons, our engines' core |
| `hostile #ff5a4e` | Enemy units and warnings: unit rims, target brackets, enemy lamps, alert banners |
| `threat #ff2f8e` / `threatHot #ff9ad5` | Enemy fire only: bullets, missiles, shells, beams, wind-up glints and lane markers |
| `good #8fe39a` | Repair only |
| `scrap #e0c35c` | Salvage only |

Rules:
- Hostile red is never used for decoration. If it is red, it is an enemy (or a warning about one).
- Threat magenta is never used for anything but enemy fire. If it is pink and glowing, it can hit you.
- Emissive colors exceed 1.0 only for things that should bloom (muzzles, engines, explosions, beams, window clusters). Matte surfaces never bloom.
- Each sector has one theme (`THEMES`) that changes ground tones, fog and window color, but never the meaning of the palette.

## Readability (the visual hierarchy)

The screen must read at a glance, like a top-down arcade shooter: a calm backdrop, chunky targets, unmistakable fire. From loudest to quietest:

| Layer | Treatment | Where |
| --- | --- | --- |
| Enemy fire | **Threat magenta** family, drawn on top of everything with dark rims. Bullets: round magenta cores with white-hot centres and a short smear, no wide haze. Missiles: long pale darts with a magenta exhaust ribbon and a blinking seeker ring. Flak orbs and mines: larger pulsing rounds with a ring. Ground-to-air shells: a dashed reticle on the target plus the climbing shell. Beams: magenta warning line, then a white-cored beam. Wind-ups: a magenta star glint and a closing ring. | `src/render/fx/fxLayer.ts` (`enemyShot`, `glints`), `PAL.threat` |
| Player fire | Plasma cyan and white (bolts, rails, arcs, the Lance); our shells and bombs are hazard amber. | `fxLayer.ts` |
| Scrap | Gold diamonds and gold-rimmed salvage, gold brackets on caches and wrecks. | `fxLayer.ts`, unit liveries |
| Enemy units | Dark, matte military paint with a moonlit fill so the shape stays legible, a thin **hostile red silhouette rim** (fresnel, below the bloom threshold: an outline, not a glow), red lamps and nav lights. Ground units sit on a dark halo that cuts them out of the city and carry thin red **target brackets** (infantry, which come in clumps of squads, get the halo only). Aircraft get a dark halo on the flight plane and a **drop shadow** on the city far below (offset down-right, away from the moon), which sells their altitude. | `src/render/units/livery.ts`, `unitLayer.ts` (`draw`), `Shape.Bracket` in `src/render/fx/quads.ts` |
| The city | The quietest layer: near-black blocks, windows at 70% of their old glow, dim road glows instead of individual lamps, a sample of trees and fires, few refinery flares, faint searchlights. Nothing in the city is magenta, and nothing in it is as bright as a bullet. | `src/render/world/*`, `src/game/worldgen.ts` |

Rules:
- Background glows never compete with gameplay: chromatic aberration pulses only on big blasts, and city lights stay below the bloom threshold except fires.
- A new enemy type needs a distinct silhouette at its display size, a livery with a rim, and (on the ground) a `mark` size for its halo and brackets (`UnitSpec.mark` in `src/render/units/specs.ts`).
- A new enemy projectile uses the threat family and a shape no other projectile uses.

## Materials

- **One PBR material library.** Hull, turrets, enemy armor and props all use the Quaternius sci-fi trim sheets (`T_Trim_*` BaseColor/Normal/ORM/Emissive), tinted per faction:
  - player: gunmetal plus hazard
  - ghost bosses: blood-oxide red plus hostile edge glow
  - enemy military: olive-drab and desert, with hostile lights
- The city uses the Downtown kit textures (brick, concrete, metal, windows) under the same lighting.
- No flat-colored primitives in the final game. A box is acceptable only as a placeholder in a baseline layer.

## Light

- It is night. Key light is a cold moon (`engine.sun`) for silhouettes. The real lighting comes from emissives and the four explosion point lights.
- Every muzzle flash, impact and explosion lights its surroundings for a few frames.
- Bloom is tuned so only HDR emissives bloom (threshold about 0.8). The ACES tone map is the final grade.

## Motion

- Big things move slowly and settle: the dreadnought eases and banks, and turrets slew instead of snapping.
- Small things are quick and cheap: drones jitter, infantry scatters.
- Nothing pops in or out. Spawn with a fade, a descent or a reveal, and die with an explosion that leaves smoke and a wreck or scorch.

## UI

The interface is the ship's own equipment: stencilled plate labels, split-flap counters, warning lamps, gauge needles and amber CRT telemetry. It is never rounded SaaS cards, gradients or emoji. Fonts: Chakra Petch (UI), Saira Stencil One (titles and stencils), Share Tech Mono (telemetry).

Four materials, one vocabulary (`src/styles.css`, parts in `src/ui/kit.ts` and `src/ui/cards.ts`):

| Material | Used for | Parts |
| --- | --- | --- |
| Steel | Consoles, the status rail, switches, the HUD plates | Riveted panels, stencil plates, steel keys (press travel, no hover lift), heavy hazard-bezel switches, guarded switches, lamps, split-flap drums, segmented bars, needle gauges |
| CRT | Telemetry and comms | Amber phosphor on near-black glass with scanlines: plot readout, quartermaster terminal, intercepted transmissions (teletype), registry line |
| Paper | Orders and documents | Requisition slips (parts), work orders (drydock, derelict), salvage manifest, ghost dossier, wreck report, till roll. Rubber stamps in blue-black (approved) or oxblood (void) ink |
| Enamel | Relics | Insignia pins: steel round (common), brass shield (rare), brass star (boss), tarnished spiked (curse) |

Rules for new UI:
- Icons come from `src/ui/icons.ts` (game-icons.net, CC BY 3.0); map a new id there rather than drawing one-off glyphs.
- Screens are built in `src/ui/screens/*.ts` and shown with `show()`, which transitions automatically. Give each screen a `data-screen` key; re-rendering the same key swaps in place.
- UI sounds go through `uiSound()` in `src/ui/sound.ts` (hooks: press, hover, buy, stamp, flap, type, deny).
- Map node symbols follow military plotting conventions: hostile diamonds (fight, elite, boss), neutral squares (merchant, derelict), unknown quatrefoil (signal), friendly circle (drydock).
