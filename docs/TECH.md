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
| Cue names | Our guns: `pew` (bow autocannon), `spread`, `cannon` (a broadside shell lobbed at the ground; dips the music), `mortar`, `broadside` (whole ripple volley: `size` rounds 35 ms apart, panned hard to the `x` side; played from the `broadside` event), `flak`, `missile`, `bombDrop`, `rail`, `zap` (arc), `pd`, `lance` (Overdrive). Overdrive: `od_lance`, `od_spear`, `od_wing`, `od_bulwark` (`size` = duration), `odReady`, `odEnd`. Impacts: `boom` (kill; uses `size` and `ground`), `bossDown`, `carnageTier` (`size` = tier), `groundBoom` (bombs and shells in the city), `big` (elite, boss or our death; ducks and muffles), `collapse` (building), `flakPop`, `hit` (our hull), `shield`. Enemy: `eshot`, `eMissile`, `railCharge`, `jet`. Salvage and state: `pick` (rises a semitone per pickup in a stream), `alarm` (ship klaxon), `clear`. UI: `ui` (relay click), `uiHover`, `uiSwitch`, `uiToggle`, `uiOpen`, `uiClose`, `uiConfirm`, `uiError`, `uiFlap` (split-flap rattle; `size` = number of flaps), `buy` / `uiStamp` (stamp thunk). Full list in `src/audio/cues.ts`. |
| `music.setScene(s)` | `'title' \| 'map' \| 'combat' \| 'elite' \| 'boss' \| 'victory' \| 'death' \| 'silent'`. Changes land on the playing track's next bar line with an equal-power crossfade. Escalations are immediate; calm-downs wait 2.5 s; `victory` plays out, then hands over to `map`; `death` is a tape-stop into a requiem drone. `main.ts` calls this at every screen change. |
| `music.sting(kind)` | `'eliteKill' \| 'bossPhase2' \| 'clear' \| 'sectorClear' \| 'carnage'`: orchestral hit on the next beat, music ducks under it. The per-frame watcher already fires elite kill, boss phase 2, area clear and the carnage drop (8 kills in 3 s, once per 20 s). |
| `music.beat()` | `{ index, phase, bar, beatInBar, bpm }` of the beat audible now, or null. Use it to pulse visuals on the music. |
| `music.setIntensity(0..1)` | War-drum layer on the music's beat. Set automatically from the fight by `updateAudio`. |
| `setShipThrottle(0..1)` | Engine drone swell. When not called for 0.5 s, the watcher derives it from ship motion. `setHullIntegrity(0..1)` makes a damaged engine cough. |
| `updateAudio(dt, combatState \| null, paused)` | Once per frame from `main.ts`, after the sim. Reads the combat state structurally (`CombatView`). It consumes `S.events` by id: `broadside` -> the ripple (and mutes per-round gun cues for its length), `kill` -> an explosion sized and placed (ground or air) from `EN`, `eliteKill` -> blast + sting, `bossDown` -> cascade, `structure` -> collapse, `carnageTier` -> rising swell (tier 3 adds the carnage drop), `overdrive*` -> the kind's signature, a heavy `playerHit` -> muffle. `S.slowFx` closes a low-pass over the whole mix; a hitstop of 90 ms or more ducks the effects for its length; `S.pickStreak.n` (passed as `size` to `pick`) climbs a pentatonic ladder. It also drives the engine, sirens, fires, enemy radio chatter (cut by a squelch when the speaker dies), jet fly-bys, intensity, stings, low-hull muffling and pause ducking. |
| `audioSettings.get() / set(patch) / onChange(f)` | Persisted volumes `{ master, music, sfx, muted }`, 0..1, in `localStorage['gd.audio.v1']` (the old `gd.mute` flag is honoured). Shortcuts: `getVolume(kind)`, `setVolume(kind, v)`, `setMuted(b)`, `isMuted()`, `audio.on`. Sliders map through a perceptual curve. |
| `chatter(id, x)` / `cutChatter(id, x)` | Manual enemy radio burst, and the squelch cut. |

Mix: cues -> distance gain, altitude low-pass and pan -> sfx bus (with a generated open-air reverb) and ambience bus -> muffle low-pass -> glue compressor (-14 dB, 8:1) -> tanh soft clip -> master; music has its own bus with ducking; master -> limiter (-1 dB) -> soft ceiling at -0.3 dBFS. Levels: music about -18 LUFS, the engine about -27 LUFS idle to -23 at full ahead, the city bed about -30 to -24 LUFS, single SFX peaks below -3 dBFS, nothing clips under the worst-case barrage.

Assets and tools (`scripts/audio/`, need ffmpeg):
- `build-music.mjs <srcDir>`: cuts each recording to a whole-bar loop that wraps on the music's own repetition, crossfades the seam, normalises to -18 LUFS, writes `public/assets/audio/music/*.mp3` and `src/audio/trackdata.ts`. Helpers: `analyze-track.mjs` (tempo grid, downbeat, per-bar loudness), `find-repeat.mjs` (where a recording repeats), `seam-check.mjs` (waveform and spectrogram of the loop wrap).
- `build-sfx.mjs <srcDir>`: cuts, trims, fades and peak-normalises (-3 dBFS) the sampled layers into mono MP3s.
- `probe.mjs <files>`: duration, bitrate, integrated LUFS, true peak.
- `render-cues.mjs [outDir] [scenario...]`: renders every cue, a worst-case barrage, the music through all scenes, the engine and the city through the real mix graph in headless Chromium (`/src/audio/lab.html` on the dev server), writes WAVs and fails if anything clips.

## Gameplay state

Everything below lives on the combat state `S` (`src/game/combat.ts`) unless noted. Field units, y down, bow points up.
Renderers read it every frame; nothing here needs to be written by them.

### Player ship (`S.P`)
- `x, y` hull centre. `vx, vy` velocity (units/s). `bank` eased roll input in -1..1 (negative rolls left): tilt the hull by it.
- `dv` is `derive(build, mods)`: `speed` (top), `accel`, `brake` (units/s²), `rects`, `mounts`, `maxHp`, ...
- `tx, ty` pointer-steer target (null when keys steer). Movement math: `src/game/feel.ts` (`stepShipVelocity`, `arriveWish`, `stepBank`).
- Bounds: the whole 1600×900 field minus the hull's half size (56 units kept clear at the top for the HUD).

### Firing arcs (`src/data/parts.ts`)
- Every `Mount` has `arc: 'bow' | 'broadside' | 'ventral' | 'omni' | 'internal'` and `side: -1 | 0 | 1` (broadside port/starboard, 0 = either).
  `ARC_INFO[arc]` gives `label`, `short`, `col` and `desc` for the UI. `positionArc(sectionType, slotKind)` is the arc a mount position
  gives; `mountArc(sectionType, slotKind, partId)` the effective arc (bombs and mortars are always ventral, arc coils and PD omni).
- Bridge and gun decks are bow; Broadside Battery sections are broadside (outer mounts port/starboard, centre either side).
- Ranges (`ARC_RANGE` in combat.ts): bow fires at targets within ±300 of the mount's x ahead of it (air only, plus ground for
  `both`-layer weapons); broadside reaches 760 sideways for anything within half a hull length + 90 of the ship's y, air or ground
  (ground targets get lobbed shells); mortars 520 around the ship; bomb bays drop under the hull. A battery with nothing in its arc holds fire.
- Broadside cadence (`BROADSIDE`): each side fires one ripple volley about every 1.7 s, stern to bow, 35 ms between rounds; each gun packs
  `broadsideRounds(part)` rounds (period / cooldown, max 12) at 1.2x damage, +10% per extra gun on the side.
- Enemy weapons have `range` (`EN[type].range`, measured to the hull by `hullDist`). Out-ranging them is the positional game.

### Events (`S.events`, `S.eventId`)
Sim to audio/VFX/UI queue, capped at 160. Each `GameEvent` has an increasing `id`; consumers remember the last id they handled
(so `debug.timeScale` multi-steps lose nothing). Types: `broadside` (`side`, `n` guns, `kind` = rounds as a string, x/y at the hull side),
`kill` (`kind` enemy type, `n` max hull), `eliteKill`, `bossDown`, `overdrive` / `overdriveReady` / `overdriveEnd` (`kind`),
`structure` (`n` scrap it paid), `carnageTier` (`n` new whole multiplier), `playerHit` (`n` damage).

### Overdrive (`S.overdrive`)
`{ charge 0..1, active, kind, t (seconds left), dur, beam, trail, allies, radius }`. Space (`keys.od = true`, or `triggerOverdrive()`)
fires it when `charge >= 1`. Charge comes from kills (elites 0.5), structures and damage to a ghost. While active every battery fires 1.5x faster.
Kinds (`OVERDRIVES` in `src/data/hulls.ts`):
- `lance` Ventral Lance (Vanguard, 3.6 s): `beam = { x1, y1, x2, y2, w: 38, ground: true, col }` where (x1, y1) is the keel on the flight
  plane and (x2, y2) the same field point on the ground: draw a vertical column from `toFlight(x1, y1)` down to `toGround(x2, y2)`.
  Every 50 ms it calls `worldBlast(x, y, 44, dmg)` and burns ground units in radius 50. `trail[]` = `{ x, y, life, max }` scorch points
  that scroll with the city (draw burning ground, fade by life / max).
  The camera sees the beam end-on (the ground point under the keel is behind the hull), so the FX layer sells it by what
  spills past the silhouette: a glare disc on the city that backlights the hull, three impact rings racing out to about
  2.4x the hull radius, a molten furrow joining the trail points (white-hot, cooling as it scrolls out from under the
  stern), a halo rim, a screen-wide anamorphic flare and a bloom swell (eased). Combat also throws molten sparks and a
  dust front past the hull every burn tick.
- `spear` Lance Spear (Lance, 2.6 s): `beam = { x1, y1 (bow), x2: x1, y2: -60, w: 54, ground: false }` on the flight plane. Deletes enemy shots in it.
- `wing` Strike Wing (Leviathan, 7 s): `allies[]` = `{ x, y, vx, vy, hdg, cd, tg, t }`, eight strike craft on the flight plane. Their shots are normal `S.pb` bolts.
- `bulwark` Bulwark Aegis (Bastion, 5 s): a 460-radius shockwave on activation, then `radius` > 0: an aegis around the hull that eats enemy shots; damage taken halved.

### Carnage (`S.carnage`) and scrap
`{ value, mult 1..3, since, peak }` (`src/game/feel.ts`, `CARNAGE`). Kills and structures add value; after a 1.6 s grace it decays at
8 + 35% of value per second. `mult = 1 + value / 80`, capped at 3. Every scrap drop is `base * SCRAP_SCALE (0.35) * scrapSectorMul(sector) * carnage.mult *
heat.scrap * dv.scrapMult` (see "Scrap economy" below). Scrap pickups home to the hull on their own after ~0.9 s (sooner with magnets); `S.pickStreak = { n, t }`
counts pickups landing within 0.5 s of each other (rising pitch for audio). City agent: `worldBlast()` should return about 1-4 scrap per
building destroyed; combat applies the scaling and carnage, counts it as a structure and feeds Overdrive.

### City (`src/game/worldgen.ts`, rendering in `src/render/world/`)
- The city is generated in rows (`CITY.chunks`) in a fixed city space: field y = `cy + S.scrollY`. `S.decor` holds every live
  building (`type: 'bldg'`, dead ones stay as rubble) and crater (`type: 'crater'`), with field `x, y` kept in sync with the scroll.
- Buildings: `hp / maxHp` (about 2-10 bomb hits by size, towers up to 240), `value` 1-4 scrap, `fire` 0..1, `collapseT`, `dead`.
  `worldBlast(x, y, r, dmg)` damages footprints (and roofs as seen, via `CITY.project`), ignites, collapses, leaves a crater and
  returns the scrap of what collapsed. Refinery tanks, silos and flares chain-react: their follow-up blasts go through combat's
  `groundBlast` so they pay like any other. Combat emits `structure` (audio plays `collapse`).
- `DARK`: the blackout grid. The city's power dies around the dreadnought as it passes; shaders sample it.
- Renderer: global instanced batches (blocks, flats, props, lights, traffic, craters) refilled only when a row enters or leaves.
  Window grids, burning floors, collapse and rubble are in the building shader (`src/render/world/shaders.ts`). Debug: `window.__city`
  (`CITY`, `DARK`, `worldBlast`) and, in dev, `window.__cityLayer`.

### Hitstop and slow-mo
- `S.stop = { left, since, total }`: while `left > 0` the simulation is frozen; the renderer keeps drawing (shake keeps decaying).
  Ordinary kills use the dead-air formula capped at 60 ms with a 240 ms cooldown; elite kill 120 ms, boss death 350 ms, heavy player hit 100 ms always land.
- `S.slowmo` timeline (tinwar shape: 0.25x, 100 ms ramp in, 1.2 s total, 300 ms ramp out); `SLOWMO_BOSS` 0.2x for 2 s, `SLOWMO_SHORT` on Overdrive.
  `S.slowK` is this frame's time scale, `S.slowFx` 0..1 intensity for a cinematic look (letterbox, vignette, audio low-pass).

### Enemies
Besides `x, y, r, hp, maxHp, layer, type`: `hdg` heading (aircraft), `ang` turret aim, `tele` 0..1 wind-up before a shot (draw a growing hostile glint),
`vx`. Enemy shots in `S.eb` carry `src` (who fired). Kinds unchanged: `bullet`, `orb`, `mine`, `missile`, `beam` (warn then fire), `strike` (growing ring).

### Ghost bosses (`S.boss`, boss section of combat.ts)
A ghost flies its recorded build (`ghostToBuild`), mirrored: its bow points down the screen, so a mount at design offset
(ox, oy) sits at field (x + ox·s, y − oy·s). Every `BossGun` keeps its mount's `arc` and `side`:
- bow guns fire inside `BOSS_BROADSIDE.bowCone` (±0.6 rad) of straight down, on their own cooldowns (`BOSS_CD`);
- ventral (bombs: mines; mortars: telegraphed strikes) and omni (arc coil rings, point defense) as before;
- broadside guns fire **volleys** per flank (`B.volley[0]` port / screen left, `[1]` starboard): a flank whose arc holds the
  player winds up for `BOSS_BROADSIDE.tele[phase]` s (the FX layer draws `B.glints`: a hostile glint per gun and its lane,
  or the arc it will rake), then ripples stern to bow, `stagger` 75 ms per round. Rounds per gun `bossRounds(part, phase)`.
  Pulse fires twin-barrel pairs, scatter a 3-fan, flak an orb that bursts into 6, seekers a pair, rail a telegraphed beam
  across the field (`eb` beam with `x2, y2`). Centre (either-side) guns join the flank the player is on.
- Phases by hull (`BOSS_PHASES` 66% / 33%, notches on the HUD bar): 1 **lanes** (each gun's rounds on one locked line;
  the ghost sweeps the field), 2 **rake** (rounds sweep ±0.45 rad across the locked line with a 0.34 rad hole; the ghost
  comes about to hold the player on its beam, at about 85 units/s), 3 **full broadside** (both flanks every volley,
  ±0.15 weave plus a slow second layer, 40 units lower). Fire rate ×1 / ×1.25 / ×1.45. Under its bow you face the bow
  guns; beside it, the broadsides. The player's hull is shouldered out of the ghost's bounding box.
- Hull: `(1800·sector^1.55 + 2·ghost hull) · max(1, 2.15 − 0.4·sector)` (×1.75 in sector 1, ×1.35 in 2): a ghost that comes
  about to bring its broadsides to bear also takes ours, and early builds are broadside-heavy. Hull damage from its
  broadsides is tallied as `boss:broadside` in `S.stats.dmgBy` (rails `boss:broadside:rail`), bow, ventral and omni as `boss`.
- Defense cores (`aiGhost`, no player ghost available) always carry a Broadside Battery behind the bridge, a second
  from sector 3, with broadside-capable guns on its flanks.

### Scrap economy (`tests/sim/economy.ts`, `tests/unit/economy.test.ts`)
`BALANCE=1 npx vitest run tests/unit/economy.test.ts --disable-console-intercept` prints, per sector, the mean scrap of
every fight (floors 2 and 6), elite and boss (plus the boss strip option) with the harness builds, the income of an
average route (4.3 fights, 0.9 elites, a derelict, a boss), and the price of an average merchant part and a merchant's
whole stock (3 parts, 2 a tier better, 2 sections, a relic, patching half the hull).
Before tuning, sector 3 paid 542 a fight against a 341 average part (1.59 parts per fight vs 0.84 in sector 1) and a
sector's income bought 117% of a merchant's stock. Two levers fix it:
- `SCRAP_SECTOR_TAX = 0.45` (combat.ts): every drop is divided by `1 + 0.45·(sector − 1)` (×0.69 in sector 2, ×0.53 in
  sector 3, ×0.45 in 4); the boss's death scrap too.
- Merchant repairs cost by the hull point: `REPAIR.hullPerScrap = 3` in sector 1, divided by `1 + 0.35·(sector − 1)`
  (3, 2.2, 1.76 hull per scrap), times the heat repair factor.

| Sector | Fight | Elite | Boss + strip | Route income | Avg part | Merchant stock | Half-hull repair | Parts / fight | Income / stock |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 93 | 116 | 265 | 821 | 111 | 1237 | 46 | 0.84 | 0.66 |
| 2 | 187 | 129 | 286 | 1258 | 217 | 1883 | 77 | 0.86 | 0.67 |
| 3 | 286 | 114 | 309 | 1689 | 341 | 2573 | 124 | 0.84 | 0.66 |

A fight now buys the same 0.85 of an average part in every sector, and a whole sector buys about two thirds of one
merchant's stock, so the last shop is a choice between parts, a section, a relic and repairs. The unit test fails if a
sector 3 fight buys more than 15% more than a sector 1 fight, or if sector 3 income leaves the 0.35–0.85 stock band.

### Repairs and heat 8
All out-of-combat repairs go through `run.ts`: `healAmount(run, frac)` (what a heal would restore now, after heat and
capped at the missing hull; screens quote it), `heal(run, frac)` (drydock 35%, signals, boss salvage 30%, Nanite Vats) and
`repairQuote` / `buyRepair` (merchant, by the hull point). Heat 8 *No Quarter* multiplies all of them, and repair kits
picked up in combat, by 0.7; `tests/unit/repair.test.ts` holds the heat description to that number.

### Fight stats (`S.stats`, `S.seen`)
`kills, airKills, groundKills, elites, structures, broadsides, maxVolley, overdrives, lanceStructures, dmgTaken, dmgDealt, dmgToTarget,
peakCarnage, scrapRaw, dmgBy{src: dmg}`. `S.seen` = kills per enemy type this fight (codex). main.ts folds them into `run.stats` / `run.seen`.

### Run (`src/game/run.ts`, save v3)
`RunState` adds `hull`, `heat`, `daily` (date key or null), `won`, `endless`, `phase: 'map' | 'victory'`, `odStart`, `seen`, and the wider
`RunStats`. Saved under `gd.run.v3`; a `gd.run.v2` save migrates (`migrateRunSave`) to the Vanguard at heat 0. `CAMPAIGN_SECTORS = 3`:
clearing sector 3 shows the victory screen; the pilot banks the run or pushes on into endless sectors.

### Profile and the fleet loop (`src/game/meta.ts`, `src/data/goals.ts`, `src/data/hulls.ts`, `src/data/heat.ts`)
- `Profile` in localStorage `gd.profile`, `PROFILE_VERSION` 2 with step migrations (`migrateProfile` takes anything).
  Fields: `xp`, `stats` (lifetime `MetaStats`), `goals`, `flown`, selected `hull` and `heat`, `codex { enemies, parts, relics, ghosts }`, `best`, `daily`, `history`.
- Rank: `rankOf(xp)` over `RANKS` (10 ranks, Ensign to Fleet Admiral); hulls unlock at ranks 2 / 4 / 6; `perksFor(xp)` gives launch perks.
- `settleRun(profile, summary)` is pure and returns XP lines, goals completed, rank change, new hulls, heat unlocked, best/daily records.
  main.ts settles exactly once per run: on death, on retiring after victory, or on abandoning (half XP).
- Heat: `maxHeat(profile)` is 0 until the first victory, then one above the highest heat won (max 8). `heatFx(level)` folds the modifiers.
- Daily strike: `dailySeed(utcDateKey())` (UTC days, so every time zone flies the same route), Vanguard, heat 0, no perks; `dailyShareLine` for sharing. Ranked on the duty roster below.
- Screens: `src/game/metaScreens.ts` (launch panel on the title, Admiralty with service record / goals / codex tabs, wreck report, victory, port).

### Daily strike duty roster (leaderboard)
- **Score** (`dailyScore` in `src/game/meta.ts`, constants `DAILY_SCORE`), from the run's existing stats:

  `daily score = combat score + 2500 × nodes charted + 1500 × elites + 6000 × ghosts laid to rest + 5 × structures + 25000 if victory`

  Combat score (`run.stats.score`) already carries enemy value, enemy level and the carnage multiplier. The route terms make depth
  count: one more node is worth more than a typical fight's kills, so a pilot who reaches sector 3 outranks one who farms sector 1.
  Endless sectors after a victory keep adding. The profile's `daily` record and the share line use this score.
- **API** (`server/server.mjs`, validation in `server/validate.mjs`, the board in `server/daily.mjs`, stored in `GHOST_DATA_DIR/daily.json`, 60 days kept):
  - `GET /api/daily/:date[?callsign=X&limit=N]` -> `{ today, date, count, entries: top 50 [{ rank, callsign, date, score, sector, floor, kills, hull, won, at }], you? }`. `you` is that callsign's row and rank, even outside the top 50. Bad dates are a 400.
  - `POST /api/daily` with `{ callsign, date, score, sector, floor, kills, hull, won }` -> `201 { ok, improved: true, rank, count, entry }`, or `200 { improved: false, ... }` when the callsign already has a better run that day (the best run per callsign per day is kept). Strict validation, no clamping: `date` must be a real `YYYY-MM-DD` equal to today's or yesterday's UTC date; integers only, `score` 0..20,000,000, `sector` 1..99, `floor` 0..20, `kills` 0..100,000; `hull` a known class; `won` a boolean (and needs sector 3+); callsign 1-16 of `A-Z 0-9 space _ . -` (case-folded; raw strings over 40 chars refused); body under 2 KB. Rate limit per IP: 12 filings an hour, 5 s apart (429 with `retry-after`; `DAILY_RATE_MAX` raises the hourly cap, the e2e server sets it).
  - Ranking: score, then sector, then floor, then the earlier filing.
- **Client** (`src/game/daily.ts`): `filingFor(callsign, settlement)` builds the filing from `Settlement.summary` / `dailyScore`; `submitDaily` returns `filed | kept | queued | rejected`. Offline, 429 or 5xx queue the filing in `localStorage['gd.daily.pending']` (best per callsign and day); `flushPendingDaily()` resends them when the roster is next opened and drops ones whose day has closed. `fetchDailyBoard(date, callsign)` returns `online: false` instead of throwing.
- **UI** (`src/ui/screens/roster.ts`): the roster is fan-fold line-printer paper (pin-feed margins, green bars, line-by-line print), the pilot's row marked with a highlighter, a rubber stamp for the filing result (Filed / On file / Held / Refused). It prints on the wreck report (death) and the port report (retiring after victory) of daily runs, and in the Daily Strike briefing on the title (today / yesterday tabs, then the launch switch, `#btn-daily-launch`). Offline it says "No carrier" and shows this device's own run, unranked.

### Balance harness
`tests/sim/harness.ts` runs real fights headless with a scripted pilot and seeded `Math.random`. `BALANCE=1 npx vitest run
tests/unit/balance.test.ts --disable-console-intercept` prints the table (`ONLY=s2-boss,ace` narrows it).

### Debug hooks (`window.__gd`)
`run`, `profile`, `S`, `debug.timeScale`, `god()`, `winNow()` (kills boss/elite outright), `killPlayer()`, `overdrive()` (charge and fire),
`travelTo(type)`, `forceNext(type)`, `addScrap(n)`.

## VFX API (`src/game/vfx.ts`, rendering in `src/render/fx/`)
Particles live in field coordinates plus a height `h` (ground particles: field units above the city; flight particles: world units above or below the flight plane). They are pooled; `V.cap` (set by the quality tier) bounds the live count.
- Spawners: `boomFx(x, y, r, col, ground)` (fireball, smoke, sparks, embers, debris; ground adds scorch, dust ring, smoke column, lingering fire; flak colour `#ffd27a` gives a flak burst, `#9ff3ff` an energy discharge), `flakFx`, `energyBurst`, `broadsideFx(x, y, side, n, len)`, `railFx(x1, y1, x2, y2, col, hostile)`, `spark(x, y, col, n)` (seeker colour `#ff9f5a` becomes a small warhead blast), `muzzle(x, y, col, size)` (also drives the hull muzzle light), `addFx(spec)` for single particles.
- Feel: `addTrauma(0..1)` (shake = 16 units × trauma^1.5, three-sine noise, small roll, decays in real time so hitstop keeps shaking), `kick(dx, dy)` (recoil shove, springs back in ~120 ms), `pulseCA(0..1)` (chromatic split), `setTimeGrade(0..1)` (slow-time desaturation that keeps hot light). Writing `V.shake` still works: it is converted to trauma (sqrt(shake / 22)) every tick.
- The FX layer reads `S.events` (broadside, overdrive, overdriveReady, carnageTier, playerHit, eliteKill, bossDown), `S.overdrive` (lance pillar, burning trail, spear, strike wing, aegis), enemy `tele` glints and `S.slowFx` (letterbox, vignette and desaturation in post).
- Post (`src/render/fx/post.ts`, `engine.post`): RenderPass (half float) → N8AO (high tier) → distortion + chromatic aberration → bloom (threshold on 0.5·(luma + max RGB)) → ACES → per-sector grade, slow-time, vignette, grain, letterbox → SMAA. `engine.setQuality('high' | 'low')` switches tiers at runtime (saved to `localStorage gd.quality`; `?quality=` overrides). Software GL renders at 0.6 resolution (`?scale=` overrides).
- Draw calls: ground FX batch, ribbon trails, air FX batch, hostile batch (enemy fire, always on top with dark rims), one distortion batch. Debug hook: `window.__gdfx`.
