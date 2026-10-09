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

## Audio

Everything under `public/assets/audio/`. Sources were cut, trimmed, faded, mixed to mono (SFX), loudness-normalised
(music to -18 LUFS integrated, SFX to -3 dBFS peak) and re-encoded to MP3 by `scripts/audio/build-music.mjs` and
`scripts/audio/build-sfx.mjs`. Most of the game's sound is synthesized at runtime (`src/audio/`), with recipes adapted from
*Dead Air* (`audio.js`, `music.js`, `music-core.js`, `ambience.js`) and *Tinwar* (`audio.ts`, `sfx.ts`, `music.ts`) by the same author.
No recording is endorsed by its author.

### Music (`public/assets/audio/music/`)

| File | Track | Author | Licence | Source | Changes |
| --- | --- | --- | --- | --- | --- |
| `title.mp3` | "Lightless Dawn" | Kevin MacLeod (incompetech.com) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) | https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100655 | 19-bar loop from 0:05.3 (91 bpm), loop crossfaded, normalised to -18 LUFS, 112 kbps MP3 |
| `map.mp3` | "Industrial Cinematic" | Kevin MacLeod (incompetech.com) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) | https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1600047 | 16-bar loop from 0:17.5 (110 bpm), loop crossfaded, normalised to -18 LUFS, 112 kbps MP3 |
| `combat.mp3` | "The Complex" | Kevin MacLeod (incompetech.com) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) | https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1300025 | 32-bar loop from 1:52.0 (104 bpm), loop crossfaded, normalised to -18 LUFS, 112 kbps MP3 |
| `elite.mp3` | "Mechanolith" | Kevin MacLeod (incompetech.com) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) | https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100879 | 14-bar loop from 0:09.5 (141 bpm), loop crossfaded, normalised to -18 LUFS, 128 kbps MP3 |
| `boss.mp3` | "Volatile Reaction" | Kevin MacLeod (incompetech.com) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) | https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1400039 | 38-bar (7/4) loop from 0:29.6 (155 bpm), loop crossfaded, normalised to -18 LUFS, 96 kbps MP3 |
| `victory.mp3` | "Five Armies" | Kevin MacLeod (incompetech.com) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) | https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100875 | Last 19 s of the piece, faded out, normalised to -18 LUFS, 112 kbps MP3 |

Required attribution (incompetech's own wording):

> "Lightless Dawn", "Industrial Cinematic", "The Complex", "Mechanolith", "Volatile Reaction", "Five Armies"
> Kevin MacLeod (incompetech.com)
> Licensed under Creative Commons: By Attribution 4.0
> http://creativecommons.org/licenses/by/4.0/
>
> Modified: cut to loops, loudness-normalised and re-encoded for the game.

### Orchestral samples for stings (`public/assets/audio/inst/`)

`timp-38.mp3`, `timp-43.mp3`, `bone-40.mp3`, `bone-46.mp3`, `tuba-34.mp3`, `horn-48.mp3`, `choir-48.mp3`, `choir-54.mp3`
(instrument-MIDI note) are single notes from the **Fluid (R3) General MIDI SoundFont** by Frank Wen, as rendered to MP3 by
[gleitz/midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts) (FluidR3_GM), trimmed, faded, levelled and
re-encoded for *Tinwar* by the same author and copied from it unchanged.

- Fluid (R3) SoundFont, Copyright (c) 2000-2002, 2008 Frank Wen <getfrank@gmail.com>: "I hereby release Fluid under the MIT license."
  MIT licence: Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
  documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to
  use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
  Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice
  shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
  ANY KIND, EXPRESS OR IMPLIED.
- The MP3 renders are credited by gleitz/midi-js-soundfonts as "Fluid Soundfont, generated from FluidR3_GM.sf2, released under
  Creative Commons Attribution 3.0" ([CC BY 3.0 US](https://creativecommons.org/licenses/by/3.0/us/)). Attribution: samples from
  the Fluid R3 GM SoundFont by Frank Wen, via gleitz/midi-js-soundfonts; modified (trimmed, faded, levelled, re-encoded).

### Sound effects (`public/assets/audio/sfx/`)

All CC0 1.0 Universal (public domain dedication, https://creativecommons.org/publicdomain/zero/1.0/); no attribution is
required, credited as a courtesy. Each licence was checked on the source page (OpenGameArt "License(s): CC0") or in the
pack's `License.txt` (Kenney: "License: (Creative Commons Zero, CC0)").

| File(s) | Source file | Author | Source |
| --- | --- | --- | --- |
| `boom_mech.mp3` | `mechanical_explosion.wav` ("Mechanical Explosion") | spring-spring | https://opengameart.org/content/mechanical-explosion |
| `boom_chunky.mp3` | `Chunky Explosion.mp3` ("Chunky Explosion") | joth | https://opengameart.org/content/chunky-explosion |
| `boom_far.mp3` | `NenadSimic - Muffled Distant Explosion.wav` | NenadSimic | https://opengameart.org/content/muffled-distant-explosion |
| `boom_a.mp3`, `boom_b.mp3`, `boom_c.mp3`, `boom_d.mp3` | `explosions.ogg` ("Explosions"), four hits cut from it | ezduzziteh | https://opengameart.org/content/explosions-4 |
| `cannon.mp3` | `cannon_fire.ogg` ("Cannon fire") | thimras | https://opengameart.org/content/cannon-fire |
| `lance.mp3`, `railburst.mp3` | `doomsday_laser_cannon_long.wav` ("Doomsday Laser Cannon Sound Effect"), two sections | tad | https://opengameart.org/content/doomsday-laser-cannon-sound-effect |
| `rumble.mp3` | `deep_rumble.ogg` ("underwater or space engine rumble"), 12 s looped | gmason | https://opengameart.org/content/underwater-or-space-engine-rumble |
| `boom_crunch1..3.mp3`, `boom_low1..2.mp3`, `thruster.mp3`, `laser.mp3`, `engine.mp3`, `shield.mp3` | `explosionCrunch_000/001/002.ogg`, `lowFrequency_explosion_000/001.ogg`, `thrusterFire_000.ogg`, `laserLarge_000.ogg`, `spaceEngineLarge_000.ogg`, `forceField_001.ogg` from **Sci-fi Sounds** 1.0 | Kenney (www.kenney.nl) | https://kenney.nl/assets/sci-fi-sounds |
| `hull1.mp3`, `hull2.mp3`, `hull3.mp3`, `bell.mp3` | `impactMetal_heavy_000/002.ogg`, `impactPlate_heavy_001.ogg`, `impactBell_heavy_001.ogg` from **Impact Sounds** | Kenney (www.kenney.nl) | https://kenney.nl/assets/impact-sounds |
| `ui_relay.mp3`, `ui_switch.mp3`, `ui_toggle.mp3`, `ui_tick.mp3`, `ui_confirm.mp3`, `ui_error.mp3`, `ui_open.mp3`, `ui_close.mp3` | `click_002`, `switch_002`, `toggle_001`, `tick_002`, `confirmation_002`, `error_004`, `maximize_006`, `minimize_006` (.ogg) from **Interface Sounds** | Kenney (www.kenney.nl) | https://kenney.nl/assets/interface-sounds |

Synthesized at runtime (no files): engine sub-drone, turbine whine and thrust roar; every weapon's synthesized layers;
sirens, fire alarm bells, fires, wind, city hum; enemy radio chatter (after Dead Air's `chatterPlan`); war drums; the
death requiem drone; all sting sub-bass and risers.

<!-- Agents: add every new asset here with its exact license and attribution line. -->
