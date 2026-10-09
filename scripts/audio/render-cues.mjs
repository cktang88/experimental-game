#!/usr/bin/env node
// Offline render of the game's audio through the real mix graph, in headless Chromium, so levels can be checked
// without ears:
//
//   CHROMIUM_PATH=... node scripts/audio/render-cues.mjs [outDir] [scenario...]
//
// Starts a Vite dev server (GD_WEB_PORT, default 5185), opens /src/audio/lab.html (no game, no WebGL), renders each scenario with
// window.__gdAudioLab.render (src/audio/lab.ts), writes <outDir>/<name>.wav and prints peak, RMS, loudest 400 ms RMS,
// integrated loudness (ffmpeg ebur128) and the count of clipped samples. Exits non-zero if anything clips.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { measure } from './probe.mjs';

const CUES = ['pew', 'spread', 'cannon', 'flak', 'flakPop', 'missile', 'bombDrop', 'rail', 'railCharge', 'zap', 'pd', 'lance',
  'boom', 'groundBoom', 'big', 'collapse', 'hit', 'shield', 'eshot', 'eMissile', 'jet', 'pick', 'alarm', 'clear',
  'ui', 'uiHover', 'uiSwitch', 'uiToggle', 'uiOpen', 'uiClose', 'uiConfirm', 'uiError', 'uiFlap', 'buy', 'uiStamp'];

const range = (n, f) => Array.from({ length: n }, (_, i) => f(i));
export const SCENARIOS = {
  // every cue alone, one per 2.5 s, alternating left/right
  cues: { seconds: CUES.length * 2.5 + 1, events: CUES.map((cue, i) => ({ t: 0.2 + i * 2.5, cue, opts: { x: i % 2 ? 1200 : 400, y: 400, size: 18 } })) },
  // worst case: a full broadside battery, flak, bombs and a chain of kills all at once over the engine and city
  barrage: { seconds: 8, events: [
    { t: 0, engine: true, throttle: 1 }, { t: 0, ambience: true, destruction: 0.8 }, { t: 0, scene: 'combat' },
    ...range(60, (i) => ({ t: 0.5 + i * 0.05, cue: 'pew', opts: { x: 700 + (i % 5) * 40, layer: 'ship' } })),
    ...range(12, (i) => ({ t: 0.6 + i * 0.25, cue: 'cannon', opts: { x: 800, layer: 'ship' } })),
    ...range(30, (i) => ({ t: 0.5 + i * 0.1, cue: 'boom', opts: { x: (i * 397) % 1600, y: 300, size: 10 + (i % 4) * 8 } })),
    ...range(20, (i) => ({ t: 0.7 + i * 0.15, cue: 'groundBoom', opts: { x: (i * 211) % 1600, y: 200 + (i % 5) * 120, size: 36 } })),
    ...range(10, (i) => ({ t: 1 + i * 0.3, cue: 'flakPop', opts: { x: 300 + i * 100, y: 200 } })),
    { t: 2, cue: 'big', opts: { x: 800, y: 300 } }, { t: 2.1, cue: 'hit', opts: { x: 800, layer: 'ship' } }, { t: 3, cue: 'collapse', opts: { x: 500, y: 300 } },
    { t: 4, sting: 'carnage' },
  ] },
  // the score through a whole run's worth of scenes, with stings, drums and the death tape-stop
  music: { seconds: 60, events: [
    { t: 0, scene: 'title' }, { t: 6, scene: 'map' }, { t: 14, scene: 'combat' }, { t: 16, intensity: 1 }, { t: 22, scene: 'elite' },
    { t: 27, sting: 'eliteKill' }, { t: 30, scene: 'boss' }, { t: 38, sting: 'bossPhase2' }, { t: 42, scene: 'victory' }, { t: 50, scene: 'combat' }, { t: 55, scene: 'death' },
  ] },
  // a long stretch of each loop, for loudness matching
  'loop-title': { seconds: 20, events: [{ t: 0, scene: 'title' }] },
  'loop-map': { seconds: 20, events: [{ t: 0, scene: 'map' }] },
  'loop-combat': { seconds: 20, events: [{ t: 0, scene: 'combat' }] },
  'loop-elite': { seconds: 20, events: [{ t: 0, scene: 'elite' }] },
  'loop-boss': { seconds: 20, events: [{ t: 0, scene: 'boss' }] },
  engine: { seconds: 16, events: [{ t: 0, engine: true, throttle: 0.3 }, { t: 8, engine: true, throttle: 1 }] },
  city: { seconds: 24, events: [{ t: 0, ambience: true }, { t: 12, ambience: true, destruction: 0.7 }] },
  // the ship and the city: engine at idle then full throttle, sirens winding up, fires, radio chatter
  world: { seconds: 24, events: [
    { t: 0, engine: true, throttle: 0.3 }, { t: 0, ambience: true }, { t: 8, engine: true, throttle: 1 }, { t: 12, ambience: true, destruction: 0.6 },
    { t: 5, chatter: 'a', x: 300 }, { t: 9, chatter: 'b', x: 1300 }, { t: 9.6, chatter: 'b', x: 1300, cut: true }, { t: 16, engine: true, throttle: 0.2, hull: 0.2 },
  ] },
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const out = process.argv[2] || 'test-results/audio';
  const only = process.argv.slice(3);
  mkdirSync(out, { recursive: true });
  const port = Number(process.env.GD_WEB_PORT || 5185);
  const server = await createServer({ root: path.resolve(import.meta.dirname, '../..'), server: { port, strictPort: false }, logLevel: 'error' });
  await server.listen();
  const url = server.resolvedUrls?.local?.[0] ?? `http://localhost:${port}/`;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
  let bad = 0;
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error('page error:', e.message));
    await page.route('https://fonts.googleapis.com/**', (r) => r.abort());
    page.on('console', (m) => { if (process.env.LAB_VERBOSE) console.log('console:', m.text()); });
    console.log('lab:', url);
    await page.goto(url + 'src/audio/lab.html');
    await page.waitForFunction(() => !!window.__gdAudioLab, null, { timeout: 30000 });
    console.log('lab ready');
    for (const [name, sc] of Object.entries(SCENARIOS)) {
      if (only.length && !only.includes(name)) continue;
      const r = await page.evaluate(([ev, s]) => window.__gdAudioLab.render(ev, s, { withWav: true }), [sc.events, sc.seconds]);
      const file = path.join(out, `${name}.wav`);
      writeFileSync(file, Buffer.from(r.wav, 'base64'));
      const m = measure(file);
      if (r.clipped > 0) bad++;
      console.log(`${name.padEnd(12)} ${String(sc.seconds).padStart(5)} s  peak ${String(r.peakDb).padStart(6)} dBFS  rms ${String(r.rmsDb).padStart(6)}  loudest400ms ${String(r.maxShortRmsDb).padStart(6)}  ${String(m.lufs).padStart(6)} LUFS  TP ${m.truePeak}  clipped ${r.clipped}`);
    }
    // each cue alone, peak per cue
    if (!only.length || only.includes('percue')) {
      for (const cue of CUES) {
        const r = await page.evaluate(([c]) => window.__gdAudioLab.render([{ t: 0.05, cue: c, opts: { x: 800, y: 400, size: 18 } }], 3), [cue]);
        console.log(`  cue ${cue.padEnd(11)} peak ${String(r.peakDb).padStart(6)} dBFS  loudest400ms ${String(r.maxShortRmsDb).padStart(6)} dB`);
        if (r.clipped > 0) bad++;
      }
    }
  } finally {
    await browser.close(); await server.close();
  }
  if (bad) { console.error(`${bad} render(s) clipped`); process.exit(1); }
}
