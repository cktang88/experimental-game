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
