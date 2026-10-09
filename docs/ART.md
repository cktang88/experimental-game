# Art Bible

**One sentence:** a carrier-sized warship crosses a city at night, and everything it touches turns to light, fire and smoke.

Every entity, effect and panel must look like it belongs in that sentence. If a new thing would look at home in a cheerful mobile game, it is wrong.

## Scale and camera

- The camera looks down at the **flight plane** with a slight forward tilt (`src/render/engine.ts`). The **city is far below**: `groundScale` is about 1.6, so ground objects are drawn larger in world space to read at their gameplay size, and perspective makes them sit visibly deeper.
- **The dreadnought is a building.** The starter hull is about 150 field units long on a 1600×900 field, and a full hull is about 400. It needs detail at three distances:
  - **Silhouette:** stepped superstructure, bridge tower, broadside sponsons, engine block.
  - **Panels:** plate seams, hatches, vents, trims and stripes from the sci-fi trim sheets.
  - **Life:** hundreds of tiny running lights, window strips, deck floodlights, blinking beacons and steam vents. *Thousands of crew* should be implied by thousands of lit portholes.
- **Enemies are small and brave.** Tanks are a few pixels of chassis plus a headlight cone. Aircraft carry navigation lights (red port, green starboard, white strobe).

## Palette (`src/render/palette.ts`, mirrored in `src/styles.css`)

| Token | Use |
| --- | --- |
| `void #0a0e13` | Night, UI ground |
| `gunmetal / steel` | Every friendly hull: blackened metal, worn edges catch the sun |
| `hazard #f2a541` | Friendly accent: stripes, UI, our ordnance tracers |
| `sodium #ffb347` | City light: street lamps, windows, fires |
| `plasma #4fd1e8` | Friendly energy: shields, rail and arc weapons, our engines' core |
| `hostile #ff5a4e` | Everything that wants you dead: enemy fire, enemy lights, warnings |
| `good #8fe39a` | Repair only |
| `scrap #e0c35c` | Salvage only |

Rules:
- Hostile red is never used for decoration. If it is red and glowing, it can hurt you.
- Emissive colors exceed 1.0 only for things that should bloom (muzzles, engines, explosions, beams, window clusters). Matte surfaces never bloom.
- Each sector has one theme (`THEMES`) that changes ground tones, fog and window color, but never the meaning of the palette.

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
