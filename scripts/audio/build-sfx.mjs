#!/usr/bin/env node
// Builds the sampled SFX layers: cut, mono, trim silence, fade, peak-normalise to -3 dBFS, encode small mono MP3s into
// public/assets/audio/sfx/. Synthesis does most of the work at runtime; these samples give it real-world body.
//
//   node scripts/audio/build-sfx.mjs <sourceDir>
//
// <sourceDir> holds the downloads, laid out as:
//   kenney-scifi/   kenney_sci-fi-sounds.zip unzipped          (Kenney, CC0)
//   kenney-impact/  kenney_impact-sounds.zip unzipped          (Kenney, CC0)
//   kenney-ui/      kenney_interface-sounds.zip unzipped       (Kenney, CC0)
//   oga/            OpenGameArt CC0 files named as in SOURCES below
// Every file's page, author and licence is listed in CREDITS.md.
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { decode, encode, peak, scale, dbToGain, firstAbove, lastAbove, fade, SR } from './lib.mjs';

const PEAK_DB = -3;
const KBPS = 80;

/** id -> { src (relative to sourceDir, found recursively by basename), from/to seconds, fadeOut seconds, loop (crossfade wrap seconds), peakDb } */
export const SFX = {
  // explosions
  boom_mech: { src: 'oga/mechanical_explosion.wav', fadeOut: 0.3 },
  boom_chunky: { src: 'oga/chunky.mp3', to: 4.2, fadeOut: 1.2 },
  boom_crunch1: { src: 'explosionCrunch_000.ogg', fadeOut: 0.15 },
  boom_crunch2: { src: 'explosionCrunch_001.ogg', fadeOut: 0.25 },
  boom_crunch3: { src: 'explosionCrunch_002.ogg', fadeOut: 0.25 },
  boom_low1: { src: 'lowFrequency_explosion_000.ogg', fadeOut: 0.4 },
  boom_low2: { src: 'lowFrequency_explosion_001.ogg', fadeOut: 0.3 },
  boom_far: { src: 'oga/muffled.wav', to: 4.0, fadeOut: 1.4 },
  boom_a: { src: 'oga/explosions.ogg', from: 1.1, to: 2.4, fadeOut: 0.4 },
  boom_b: { src: 'oga/explosions.ogg', from: 3.9, to: 5.4, fadeOut: 0.5 },
  boom_c: { src: 'oga/explosions.ogg', from: 8.9, to: 11.6, fadeOut: 1.2 },
  boom_d: { src: 'oga/explosions.ogg', from: 15.4, to: 16.8, fadeOut: 0.5 },
  // guns
  cannon: { src: 'oga/cannon_fire.ogg', to: 1.9, fadeOut: 0.7 },
  lance: { src: 'oga/doomsday.wav', from: 10.35, to: 16.4, fadeOut: 1.6 },
  railburst: { src: 'oga/doomsday.wav', from: 0.5, to: 2.2, fadeOut: 0.6 },
  thruster: { src: 'thrusterFire_000.ogg', from: 0.0, to: 1.4, fadeOut: 0.6 },
  laser: { src: 'laserLarge_000.ogg', fadeOut: 0.2 },
  // ship and hull
  rumble: { src: 'oga/deep_rumble.ogg', from: 20, to: 32, loop: 1.0 },
  engine: { src: 'spaceEngineLarge_000.ogg', from: 0.2, to: 4.8, loop: 0.6 },
  shield: { src: 'forceField_001.ogg', fadeOut: 0.3 },
  hull1: { src: 'impactMetal_heavy_000.ogg', fadeOut: 0.2 },
  hull2: { src: 'impactMetal_heavy_002.ogg', fadeOut: 0.2 },
  hull3: { src: 'impactPlate_heavy_001.ogg', fadeOut: 0.2 },
  bell: { src: 'impactBell_heavy_001.ogg', fadeOut: 0.8 },
  // ui (equipment-style panel)
  ui_relay: { src: 'click_002.ogg', fadeOut: 0.02 },
  ui_switch: { src: 'switch_002.ogg', fadeOut: 0.03 },
  ui_toggle: { src: 'toggle_001.ogg', fadeOut: 0.03 },
  ui_tick: { src: 'tick_002.ogg', fadeOut: 0.01 },
  ui_confirm: { src: 'confirmation_002.ogg', fadeOut: 0.08 },
  ui_error: { src: 'error_004.ogg', fadeOut: 0.06 },
  ui_open: { src: 'maximize_006.ogg', fadeOut: 0.05 },
  ui_close: { src: 'minimize_006.ogg', fadeOut: 0.05 },
};

function findFile(root, rel) {
  const direct = path.join(root, rel);
  try { if (statSync(direct).isFile()) return direct; } catch { /* search */ }
  const base = path.basename(rel);
  const walk = (d) => { for (const n of readdirSync(d)) { const p = path.join(d, n); if (statSync(p).isDirectory()) { const r = walk(p); if (r) return r; } else if (n === base) return p; } return null; };
  const hit = walk(root);
  if (!hit) throw new Error(`source not found: ${rel}`);
  return hit;
}

export function buildOne(srcFile, spec) {
  let [ch] = decode(srcFile, 1);
  const a = Math.floor((spec.from ?? 0) * SR), b = spec.to ? Math.floor(spec.to * SR) : ch.length;
  ch = ch.slice(a, b);
  let chs = [ch];
  if (spec.loop) {
    // seamless loop: crossfade the last `loop` seconds into the head, then drop them
    const xf = Math.floor(spec.loop * SR), n = ch.length - xf, out = ch.slice(0, n);
    for (let i = 0; i < xf; i++) { const k = i / xf; out[i] = ch[i] * Math.sin((k * Math.PI) / 2) + ch[n + i] * Math.cos((k * Math.PI) / 2); }
    chs = [out];
  } else {
    const s = Math.max(0, firstAbove(chs, -48) - Math.floor(0.002 * SR)), e = lastAbove(chs, -64) + 1;
    chs = chs.map((c) => c.slice(s, e));
    fade(chs, Math.floor(0.0015 * SR), Math.floor((spec.fadeOut ?? 0.05) * SR));
  }
  scale(chs, dbToGain(spec.peakDb ?? PEAK_DB) / Math.max(1e-6, peak(chs)));
  return chs;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const root = process.argv[2];
  if (!root) { console.error('usage: node scripts/audio/build-sfx.mjs <sourceDir>'); process.exit(1); }
  const outDir = path.resolve(import.meta.dirname, '../../public/assets/audio/sfx');
  mkdirSync(outDir, { recursive: true });
  for (const [id, spec] of Object.entries(SFX)) {
    const chs = buildOne(findFile(root, spec.src), spec);
    encode(chs, path.join(outDir, `${id}.mp3`), { kbps: spec.kbps ?? KBPS });
    console.log(`${id.padEnd(14)} ${(chs[0].length / SR).toFixed(2)} s`);
  }
}
