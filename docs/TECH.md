# Technical Map and Ownership

## Run it
- `npm run dev`: Vite client plus ghost API. Set `GD_WEB_PORT` / `GD_API_PORT` to run several checkouts at once.
- `npm test`: vitest. `npm run typecheck`: tsc.
- `npm run e2e`: Playwright in Chromium. Set `CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome` in this sandbox.
- Kit preview: `node scripts/contact-sheet.mjs <kit> [nameRegex] [out.png] [cols] [iso|top]` (dev server running).
- Asset kits: `scripts/assets/fetch-sources.sh`, then `node scripts/assets/build-kits.mjs` writes `public/assets/kits/{city,scifi}.glb` plus a JSON list of model names. Raw sources are cached in `/home/user/asset-cache` (Kenney kits are there too, unzipped).
- The sandbox renders WebGL in software, so it is slow. Use `__gd.debug.timeScale` and `__gd.god()` from the console or Playwright to fast-forward fights. Judge the visuals from screenshots.

## Coordinates (read `src/render/engine.ts` header)
- Gameplay is 2D on a 1600×900 field (`src/game/field.ts`), with y pointing down the screen.
- Flight-plane objects use `engine.toFlight(x, y, alt)`. Ground objects use `engine.toGround(x, y)` and must be scaled by `engine.groundScale`.
- Ship hulls are `SECTIONS` design units × `SHIP_SCALE` (2.6). `derive()` already returns scaled rects and mounts.

## Module ownership (parallel work)
Each workstream owns its files. Edit outside your area only at the integration points listed, and keep those edits small.

| Workstream | Owns | Integration points |
| --- | --- | --- |
| Ship | `src/render/ship/**` | `ShipLayer` API used by `main.ts` |
| City and world | `src/render/world/**`, `src/game/worldgen.ts` | `worldBlast()` called by combat; `S.decor` / `S.clouds` shapes |
| Units | `src/render/units/**` | Reads `S.enemies` (types in `src/data/enemies.ts`) |
| VFX and post | `src/render/fx/**`, `src/game/vfx.ts`, post section of `src/render/engine.ts` | Spawner functions called by combat (`boomFx`, `spark`, `muzzle`, ...) |
| Audio | `src/audio/**` (move `src/game/audio.ts` there), `public/assets/audio/**` | `sfx(name)` calls; a `music.setScene()` call from `main.ts` |
| UI | `src/styles.css`, `src/ui/**`, `src/render/hud.ts`, `index.html` | Screen-building functions in `main.ts` (markup only) |
| Gameplay and meta | `src/game/combat.ts`, `src/game/run.ts`, `src/data/**`, new `src/game/meta*.ts` | Flow in `main.ts` |

Shared files that anyone may read but should change only with care: `src/render/engine.ts` (core), `src/render/palette.ts`, `src/render/assets.ts`, `src/render/fx/quads.ts`.

## Definition of done for any workstream
1. `npm run typecheck` and `npm test` pass, and `npm run e2e` still passes. Fix any e2e step your change breaks.
2. You looked at real screenshots of your work in the running game, at 1600×900, and fixed what looked wrong.
3. New assets are credited in `CREDITS.md` with the exact license.
4. Commit with a clear message.

## Audio API (`src/audio/`)
Import from `src/audio` (`src/game/audio.ts` re-exports it for old callers). Nothing plays until the first user gesture; every call is safe before that and never throws.

| Call | What it does |
| --- | --- |
| `sfx(name, opts?)` | One-shot cue. `opts`: `x` (0..1600, stereo pan), `y`, `layer` (`'ship'` our hull and guns: close, narrow; `'air'`: aircraft and flak, panned; `'ground'`: the city far below, low-passed, quieter, wetter and 45-105 ms late; `'ui'`: dry, centred), `ground: true` (shorthand for the ground layer), `size` (field radius, scales explosions), `vol`, `pitch`. Each cue has a min gap, a burst cap and a priority; low-priority cues are dropped first when voices run out. |
| Cue names | Our guns: `pew` (bow autocannon), `spread`, `cannon` (broadside or artillery; dips the music), `flak`, `missile`, `bombDrop`, `rail`, `zap` (arc), `pd`, `lance` (Overdrive). Impacts: `boom` (kill; uses `size` and `ground`), `groundBoom` (bombs and shells in the city), `big` (elite, boss or our death; ducks and muffles), `collapse` (building), `flakPop`, `hit` (our hull), `shield`. Enemy: `eshot`, `eMissile`, `railCharge`, `jet`. Salvage and state: `pick` (rises a semitone per pickup in a stream), `alarm` (ship klaxon), `clear`. UI: `ui` (relay click), `uiHover`, `uiSwitch`, `uiToggle`, `uiOpen`, `uiClose`, `uiConfirm`, `uiError`, `uiFlap` (split-flap rattle; `size` = number of flaps), `buy` / `uiStamp` (stamp thunk). Full list in `src/audio/cues.ts`. |
| `music.setScene(s)` | `'title' \| 'map' \| 'combat' \| 'elite' \| 'boss' \| 'victory' \| 'death' \| 'silent'`. Changes land on the playing track's next bar line with an equal-power crossfade. Escalations are immediate; calm-downs wait 2.5 s; `victory` plays out, then hands over to `map`; `death` is a tape-stop into a requiem drone. `main.ts` calls this at every screen change. |
| `music.sting(kind)` | `'eliteKill' \| 'bossPhase2' \| 'clear' \| 'sectorClear' \| 'carnage'`: orchestral hit on the next beat, music ducks under it. The per-frame watcher already fires elite kill, boss phase 2, area clear and the carnage drop (8 kills in 3 s, once per 20 s). |
| `music.beat()` | `{ index, phase, bar, beatInBar, bpm }` of the beat audible now, or null. Use it to pulse visuals on the music. |
| `music.setIntensity(0..1)` | War-drum layer on the music's beat. Set automatically from the fight by `updateAudio`. |
| `setShipThrottle(0..1)` | Engine drone swell. When not called for 0.5 s, the watcher derives it from ship motion. `setHullIntegrity(0..1)` makes a damaged engine cough. |
| `updateAudio(dt, combatState \| null, paused)` | Once per frame from `main.ts`. Reads the combat state structurally (`CombatView`): drives the engine, sirens, fires, enemy radio chatter (cut by a squelch when the speaker dies), jet fly-bys, intensity, stings, low-hull muffling and pause ducking. |
| `audioSettings.get() / set(patch) / onChange(f)` | Persisted volumes `{ master, music, sfx, muted }`, 0..1, in `localStorage['gd.audio.v1']` (the old `gd.mute` flag is honoured). Shortcuts: `getVolume(kind)`, `setVolume(kind, v)`, `setMuted(b)`, `isMuted()`, `audio.on`. Sliders map through a perceptual curve. |
| `chatter(id, x)` / `cutChatter(id, x)` | Manual enemy radio burst, and the squelch cut. |

Mix: cues -> distance gain, altitude low-pass and pan -> sfx bus (with a generated open-air reverb) and ambience bus -> muffle low-pass -> glue compressor (-14 dB, 8:1) -> tanh soft clip -> master; music has its own bus with ducking; master -> limiter (-1 dB) -> soft ceiling at -0.3 dBFS. Levels: music about -18 LUFS, the engine about -27 LUFS idle to -23 at full ahead, the city bed about -30 to -24 LUFS, single SFX peaks below -3 dBFS, nothing clips under the worst-case barrage.

Assets and tools (`scripts/audio/`, need ffmpeg):
- `build-music.mjs <srcDir>`: cuts each recording to a whole-bar loop that wraps on the music's own repetition, crossfades the seam, normalises to -18 LUFS, writes `public/assets/audio/music/*.mp3` and `src/audio/trackdata.ts`. Helpers: `analyze-track.mjs` (tempo grid, downbeat, per-bar loudness), `find-repeat.mjs` (where a recording repeats), `seam-check.mjs` (waveform and spectrogram of the loop wrap).
- `build-sfx.mjs <srcDir>`: cuts, trims, fades and peak-normalises (-3 dBFS) the sampled layers into mono MP3s.
- `probe.mjs <files>`: duration, bitrate, integrated LUFS, true peak.
- `render-cues.mjs [outDir] [scenario...]`: renders every cue, a worst-case barrage, the music through all scenes, the engine and the city through the real mix graph in headless Chromium (`/src/audio/lab.html` on the dev server), writes WAVs and fails if anything clips.
