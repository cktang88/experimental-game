#!/usr/bin/env node
// Live smoke test of the audio in the real game: `CHROMIUM_PATH=... node scripts/audio/smoke.mjs [url]`
// Opens the game (dev server must be running), clicks into a run and a fight, and prints the audio state
// (window.__gdAudio): context running, scene, loaded tracks, voices, and any page errors.
import { chromium } from '@playwright/test';

const url = process.argv[2] || `http://localhost:${process.env.GD_WEB_PORT || 5185}/`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
page.on('crash', () => console.log('PAGE CRASHED'));
page.on('console', (m) => { if (m.type() === 'error') console.log('console.error:', m.text()); });
await page.route('https://fonts.googleapis.com/**', (r) => r.abort());
const state = () => page.evaluate(() => { const a = window.__gdAudio; return a ? { running: a.running, voices: a.voices, music: a.music } : null; });
try {
  await page.goto(url);
  await page.mouse.click(10, 10);
  await page.waitForTimeout(3000);
  console.log('title:', JSON.stringify(await state()));
  await page.click('#btn-new').catch((e) => console.log('no #btn-new', e.message));
  await page.waitForTimeout(2000);
  console.log('map:', JSON.stringify(await state()));
  await page.evaluate(() => window.__gd.forceNext('fight'));
  await page.waitForTimeout(6000);
  console.log('fight:', JSON.stringify(await state()));
  await page.evaluate(() => { window.__gd.god(true); window.__gd.overdrive?.(); });
  await page.waitForTimeout(4000);
  console.log('overdrive:', JSON.stringify(await state()));
  console.log('history:', JSON.stringify(await page.evaluate(() => window.__gdAudio.history().slice(-12))));
} finally { await browser.close(); }
