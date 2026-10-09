#!/usr/bin/env node
// Loudness report for audio files: `node scripts/audio/probe.mjs <file-or-dir>...`
// Prints duration, channels, bitrate, integrated loudness (LUFS), true peak and sample peak for each file. Needs ffmpeg.
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export function measure(file) {
  const o = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true+sample', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const sum = o.slice(o.lastIndexOf('Summary:'));
  const num = (re) => { const m = sum.match(re); return m ? Number(m[1]) : NaN; };
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,bit_rate:stream=channels,sample_rate', '-of', 'json', file], { encoding: 'utf8' }).stdout;
  let info = {}; try { info = JSON.parse(probe); } catch { /* not media */ }
  return {
    file,
    duration: Number(info.format?.duration ?? NaN),
    kbps: Math.round(Number(info.format?.bit_rate ?? NaN) / 1000),
    channels: info.streams?.[0]?.channels,
    bytes: statSync(file).size,
    lufs: num(/I:\s+(-?[\d.]+|-inf) LUFS/),
    truePeak: num(/True peak:\s+Peak:\s+(-?[\d.]+|-inf) dBFS/),
    samplePeak: num(/Sample peak:\s+Peak:\s+(-?[\d.]+|-inf) dBFS/),
  };
}

function files(p) {
  if (statSync(p).isDirectory()) return readdirSync(p).flatMap((n) => files(path.join(p, n)));
  return /\.(mp3|ogg|wav|flac|m4a)$/i.test(p) ? [p] : [];
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  for (const f of process.argv.slice(2).flatMap(files)) {
    const m = measure(f);
    console.log(`${path.relative(process.cwd(), f).padEnd(56)} ${m.duration.toFixed(2).padStart(7)}s ${String(m.channels).padStart(1)}ch ${String(m.kbps).padStart(4)}kbps ${(m.bytes / 1024).toFixed(0).padStart(6)}KB  I ${String(m.lufs).padStart(6)} LUFS  TP ${String(m.truePeak).padStart(6)}  SP ${String(m.samplePeak).padStart(6)} dBFS`);
  }
}
