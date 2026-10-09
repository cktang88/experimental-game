# Credits

## 3D models and textures
- **Downtown City MegaKit** and **Modular Sci-Fi MegaKit** by Quaternius (https://quaternius.com). CC0 1.0 Universal. Processed (merged, textures resized and converted to WebP, meshopt-compressed) by `scripts/assets/build-kits.mjs`.
- **Ultimate Spaceships Pack** (May 2021) by Quaternius (https://quaternius.com, mirrored at https://opengameart.org/content/ultimate-spaceships-pack). CC0 1.0 Universal. Used for enemy aircraft (Omen, Bob, Zenith, Spitfire, Challenger, Executioner, Imperial); textures re-encoded into the enemy livery format and a normal map derived from them by `scripts/assets/prep-units.mjs`.
- **Space Kit** and **Car Kit** by Kenney (https://kenney.nl). CC0 1.0 Universal. Used for the turret emplacement, bunker dome, SAM truck chassis and wreck debris; re-coloured into the enemy livery by `scripts/assets/prep-units.mjs` and painted at runtime with the shared PBR livery shader and the Modular Sci-Fi MegaKit trim-sheet grunge.
- Tanks, infantry, SAM launcher, bunker revetment, supply crates, salvage canisters and the Siege Crawler's track units are modelled procedurally in `src/render/units/geo.ts` (original work).

## Icons
- **game-icons.net** glyphs, inlined as path data in `src/ui/icons-data.ts` (extracted from the `@iconify-json/game-icons` 1.2.4 package). CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/). Icons by game-icons.net contributors, including Lorc, Delapouite, Skoll, Caro Asercion, Willdabeast, John Colburn, Felbrigg, Sbed, Carl Olsen, Cathelineau and Faithtoken. Used unmodified apart from tinting.

## Fonts (self-hosted through Fontsource npm packages, latin subset)
- **Chakra Petch** by Cadson Demak. SIL Open Font License 1.1. Package `@fontsource/chakra-petch`.
- **Saira Stencil One** by Omnibus-Type. SIL Open Font License 1.1. Package `@fontsource/saira-stencil-one`.
- **Share Tech Mono** by Carrois Apostrophe. SIL Open Font License 1.1. Package `@fontsource/share-tech-mono`.

## Code and design borrowed from the author's earlier games
- Audio mix chain, synthesized SFX recipes, game-feel constants and UI direction adapted from *Dead Air* and *Tinwar* by the same author.
- UI equipment kit (split-flap counters, needle gauges, lamps, scope trace), off-screen threat chevrons and the boot-sequence structure adapted from *Dead Air* (`ui-art.js`, `panel-ui.js`, `threat-indicators.js`, `title-intro.js`).

<!-- Agents: add every new asset here with its exact license and attribution line. -->
