// Combat HUD: a 2D canvas over the WebGL view, drawn in field units (1600x900). Same instrument language as
// the menus: riveted plates, stencil legends, segmented bars with a damage trail, a split-flap scrap counter,
// battery lamps, a stamped banner, and off-screen threat chevrons (ported from Dead Air's threat-indicators.js).
//
// HOOK for the gameplay workstream: if S.carnage and/or S.overdrive exist, their gauges appear bottom-right.
// Accepted shapes (any of):
//   number in 0..1 (or 0..100)
//   { value | charge | level | t: number, max?: number, mult? | multiplier?: number, ready?: boolean, active?: boolean, key?: string }
// Carnage reads as a VU ladder with the scrap multiplier; overdrive as a needle gauge with a READY lamp and keycap.
import { S, W, H } from '../game/combat';
import { V } from '../game/vfx';
import { clamp } from '../util/rng';
import { EN } from '../data/enemies';
import { WEAPONS, wCd } from '../data/parts';
import { drawIcon } from '../ui/icons';

const F_MONO = '"Share Tech Mono", ui-monospace, monospace';
const F_STEN = '"Saira Stencil One", "Chakra Petch", sans-serif';
const C = { void: '#0a0e13', fg: '#dbe4ec', dim: '#8597a8', faint: '#5d6e7e', hazard: '#f2a541', plasma: '#4fd1e8', hostile: '#ff5a4e', good: '#8fe39a', scrap: '#e0c35c', violet: '#c9a6ff', crt: '#ffb347' };
const LAYER_COL: Record<string, string> = { air: C.plasma, ground: C.hazard, both: C.violet, none: '#b8f2c8' };
const CODE: Record<string, string> = { pulse: 'PLS', spread: 'SCT', flak: 'FLK', missile: 'MSL', bomb: 'BMB', artillery: 'MRT', rail: 'RAIL', tesla: 'ARC', pd: 'PD' };

let VIG: HTMLCanvasElement | null = null, HURT: HTMLCanvasElement | null = null;
function mkV(inner: string, outer: string) {
  const s = document.createElement('canvas'); s.width = W; s.height = H; const g = s.getContext('2d')!;
  const gr = g.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.72); gr.addColorStop(0, inner); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, W, H); return s;
}

/* ---------------- persistent animation state ---------------- */
const st = {
  t: 0, last: 0, enc: null as unknown,
  hpLag: 1, shLag: 1, bossLag: 1, eliteLag: 1,
  scrapShown: 0, digits: [] as { ch: string; flip: number }[], gains: [] as { v: number; t: number }[], lastScrap: -1,
  fired: new Map<number, number>(), lastCd: new Map<number, number>(),
  bannerKey: '',
};

/* ---------------- primitives ---------------- */
function plate(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, opts: { stripe?: string; alpha?: number } = {}) {
  c.save();
  c.globalAlpha = opts.alpha ?? 0.9;
  const g = c.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, '#19222b'); g.addColorStop(1, '#0e1419');
  c.fillStyle = g; c.fillRect(x, y, w, h);
  c.globalAlpha = 1;
  c.strokeStyle = '#000'; c.lineWidth = 1; c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  c.fillStyle = 'rgba(255,255,255,.07)'; c.fillRect(x + 1, y + 1, w - 2, 1);
  if (opts.stripe) stripe(c, x, y, w, 4, opts.stripe);
  for (const [rx, ry] of [[x + 6, y + (opts.stripe ? 10 : 6)], [x + w - 6, y + (opts.stripe ? 10 : 6)], [x + 6, y + h - 6], [x + w - 6, y + h - 6]]) rivet(c, rx, ry);
  c.restore();
}
function rivet(c: CanvasRenderingContext2D, x: number, y: number) {
  c.fillStyle = '#05080b'; c.beginPath(); c.arc(x, y, 2.4, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#4b5a68'; c.beginPath(); c.arc(x - 0.4, y - 0.5, 1.3, 0, Math.PI * 2); c.fill();
}
function stripe(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, col: string) {
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
  c.fillStyle = '#120e08'; c.fillRect(x, y, w, h);
  c.fillStyle = col;
  for (let i = -h; i < w + h; i += 14) { c.beginPath(); c.moveTo(x + i, y + h); c.lineTo(x + i + 7, y + h); c.lineTo(x + i + 7 + h, y); c.lineTo(x + i + h, y); c.fill(); }
  c.restore();
}
function label(c: CanvasRenderingContext2D, text: string, x: number, y: number, col = C.faint, size = 11, align: CanvasTextAlign = 'left') {
  c.font = `${size}px ${F_MONO}`; c.fillStyle = col; c.textAlign = align; c.textBaseline = 'alphabetic';
  // letter-spacing by hand keeps it portable
  if (align === 'left') { let cx = x; for (const ch of text) { c.fillText(ch, cx, y); cx += c.measureText(ch).width + size * 0.14; } }
  else c.fillText(text, x, y);
}
function lampDot(c: CanvasRenderingContext2D, x: number, y: number, r: number, col: string, k: number) {
  c.fillStyle = '#05080b'; c.beginPath(); c.arc(x, y, r + 1.2, 0, Math.PI * 2); c.fill();
  if (k > 0.05) { c.save(); c.globalAlpha = 0.35 * k; c.fillStyle = col; c.beginPath(); c.arc(x, y, r * 2.4, 0, Math.PI * 2); c.fill(); c.restore(); }
  const g = c.createRadialGradient(x - r * 0.35, y - r * 0.4, 0, x, y, r);
  if (k > 0.05) { g.addColorStop(0, k > 0.99 ? '#ffffff' : col); g.addColorStop(0.25, col); g.addColorStop(1, shade(col, 0.35)); c.globalAlpha = 0.35 + 0.65 * k; }
  else { g.addColorStop(0, '#4b5763'); g.addColorStop(1, '#161c22'); }
  c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); c.globalAlpha = 1;
}
function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * k), g = Math.round(((n >> 8) & 255) * k), b = Math.round((n & 255) * k);
  return `rgb(${r},${g},${b})`;
}

/** Segmented bar with a white damage trail between the current value and the lagging one. */
function segs(c: CanvasRenderingContext2D, x: number, y: number, n: number, sw: number, sh: number, gap: number, k: number, lag: number, col: string, blinkLow = false) {
  c.fillStyle = '#05080b'; c.fillRect(x - 3, y - 3, n * (sw + gap) - gap + 6, sh + 6);
  c.strokeStyle = '#000'; c.strokeRect(x - 2.5, y - 2.5, n * (sw + gap) - gap + 5, sh + 5);
  const lit = k * n, trail = lag * n;
  const blinkOff = blinkLow && Math.floor(st.t * 3) % 2 === 1;
  for (let i = 0; i < n; i++) {
    const sx = x + i * (sw + gap);
    if (i < Math.floor(lit) || (i < lit && lit - i > 0.5)) {
      if (blinkOff) { c.fillStyle = shade(col, 0.45); c.fillRect(sx, y, sw, sh); continue; }
      const g = c.createLinearGradient(0, y, 0, y + sh); g.addColorStop(0, '#ffffff'); g.addColorStop(0.3, col); g.addColorStop(1, shade(col, 0.6));
      c.fillStyle = g; c.fillRect(sx, y, sw, sh);
    } else if (i < trail) { c.fillStyle = 'rgba(255,240,220,.85)'; c.fillRect(sx, y, sw, sh); }
    else { c.fillStyle = '#18212a'; c.fillRect(sx, y, sw, sh); }
  }
}

/* ---------------- clusters ---------------- */
function hullCluster(c: CanvasRenderingContext2D) {
  const P = S.P!, k = clamp(P.hp / P.dv.maxHp, 0, 1);
  const sk = P.dv.shieldMax ? clamp(P.shield / P.dv.shieldMax, 0, 1) : 0;
  const x = 14, y = 12, w = 404, h = P.dv.shieldMax ? 76 : 58;
  plate(c, x, y, w, h);
  const col = k < 0.3 ? C.hostile : k < 0.55 ? C.hazard : C.good;
  c.font = `14px ${F_STEN}`; c.fillStyle = '#9fb0c0'; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  c.fillText('HULL', x + 16, y + 30);
  segs(c, x + 66, y + 16, 24, 8, 16, 2, k, st.hpLag, col, k < 0.3);
  c.font = `20px ${F_MONO}`; c.fillStyle = k < 0.3 ? C.hostile : C.fg; c.textAlign = 'right';
  c.fillText(String(Math.ceil(Math.max(0, P.hp))), x + w - 50, y + 32);
  c.font = `13px ${F_MONO}`; c.fillStyle = C.faint; c.textAlign = 'left'; c.fillText(`/${Math.round(P.dv.maxHp)}`, x + w - 48, y + 32);
  if (k < 0.3) { label(c, 'HULL CRITICAL', x + 70, y + 49, Math.floor(st.t * 3) % 2 ? C.hostile : shade(C.hostile, 0.6), 10); }
  if (P.dv.shieldMax) {
    c.font = `14px ${F_STEN}`; c.fillStyle = '#9fb0c0'; c.textAlign = 'left'; c.fillText('SHLD', x + 16, y + 62);
    segs(c, x + 66, y + 53, 24, 8, 8, 2, sk, st.shLag, C.plasma);
    c.font = `13px ${F_MONO}`; c.fillStyle = C.plasma; c.textAlign = 'right'; c.fillText(String(Math.ceil(P.shield)), x + w - 50, y + 63);
  }
}

function scrapCluster(c: CanvasRenderingContext2D, total: number) {
  const x = W - 60 - 236, y = 12, w = 236, h = 58;
  plate(c, x, y, w, h);
  drawIcon(c, 'metal-bar', x + 24, y + 30, 26, C.scrap);
  label(c, 'SCRAP', x + 44, y + 22, C.faint, 10);
  const v = Math.max(0, Math.floor(total));
  if (st.lastScrap >= 0 && v > st.lastScrap) st.gains.push({ v: v - st.lastScrap, t: st.t });
  st.lastScrap = v;
  st.scrapShown += (v - st.scrapShown) * 0.18; if (Math.abs(v - st.scrapShown) < 0.6) st.scrapShown = v;
  const s = String(Math.round(st.scrapShown)).padStart(5, '0');
  for (let i = 0; i < s.length; i++) {
    const d = st.digits[i] ??= { ch: s[i], flip: -1 };
    if (d.ch !== s[i]) { d.ch = s[i]; d.flip = st.t; }
    const dx = x + 44 + i * 19, dy = y + 27, dw = 17, dh = 24, p = d.flip < 0 ? 1 : clamp((st.t - d.flip) / 0.12, 0, 1);
    c.fillStyle = '#20252b'; c.fillRect(dx, dy, dw, dh / 2); c.fillStyle = '#15191d'; c.fillRect(dx, dy + dh / 2, dw, dh / 2);
    c.save(); c.beginPath(); c.rect(dx, dy, dw, dh); c.clip();
    c.font = `20px ${F_MONO}`; c.fillStyle = '#f3ede0'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.translate(dx + dw / 2, dy + dh / 2); c.scale(1, 0.25 + 0.75 * p); c.fillText(d.ch, 0, 1);
    c.restore();
    c.fillStyle = '#000'; c.fillRect(dx, dy + dh / 2 - 0.5, dw, 1);
    if (p < 1) { c.fillStyle = `rgba(255,255,255,${0.25 * (1 - p)})`; c.fillRect(dx, dy, dw, dh / 2); }
  }
  // this-fight tally and floating gains
  c.font = `12px ${F_MONO}`; c.fillStyle = C.good; c.textAlign = 'right'; c.textBaseline = 'alphabetic';
  c.fillText(`+${Math.floor(S.scrap)}`, x + w - 12, y + 22);
  st.gains = st.gains.filter((g) => st.t - g.t < 0.9);
  for (const g of st.gains) { const a = st.t - g.t; c.globalAlpha = 1 - a / 0.9; c.fillText(`+${g.v}`, x + w - 12, y + 70 + a * 18); c.globalAlpha = 1; }
}

function pauseKey(c: CanvasRenderingContext2D) {
  const x = W - 50, y = 12, s = 38;
  const g = c.createLinearGradient(0, y, 0, y + s); g.addColorStop(0, '#26313c'); g.addColorStop(1, '#171e26');
  c.fillStyle = '#05080b'; c.fillRect(x, y + 3, s, s);
  c.fillStyle = g; c.fillRect(x, y, s, s);
  c.strokeStyle = '#000'; c.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
  c.fillStyle = 'rgba(255,255,255,.08)'; c.fillRect(x + 1, y + 1, s - 2, 1);
  c.fillStyle = C.fg; c.fillRect(x + 13, y + 11, 4, 16); c.fillRect(x + 21, y + 11, 4, 16);
  label(c, 'ESC', x + s / 2, y + s + 15, C.faint, 9, 'center');
}

function encounterPlate(c: CanvasRenderingContext2D) {
  const enc = S.enc; if (!enc) return;
  const B = S.boss, E = S.elite && !S.elite.dead ? S.elite : null;
  if ((B && B.alive) || E) return nameplate(c, B && B.alive ? B : null, E);
  const w = 420, x = W / 2 - w / 2, y = 12, h = 46;
  plate(c, x, y, w, h);
  c.font = `15px ${F_STEN}`; c.fillStyle = '#c9d3dc'; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  c.fillText(`SECTOR ${S.sector}  ·  ${enc.name.toUpperCase()}`, W / 2, y + 22);
  if (enc.kind === 'fight') {
    const tx = x + 26, tw = w - 52, ty = y + 31, k = clamp(S.time / enc.duration, 0, 1);
    c.fillStyle = '#05080b'; c.fillRect(tx, ty, tw, 6);
    c.fillStyle = S.mode === 'play' ? C.hazard : C.good; c.fillRect(tx, ty, tw * k, 6);
    c.fillStyle = 'rgba(0,0,0,.6)'; for (let i = 1; i < 10; i++) c.fillRect(tx + (tw * i) / 10, ty, 1, 6);
    c.fillStyle = C.fg; c.fillRect(tx + tw * k - 1, ty - 3, 2, 12);
  }
}

function nameplate(c: CanvasRenderingContext2D, B: NonNullable<typeof S.boss> | null, E: NonNullable<typeof S.elite> | null) {
  const w = 760, x = W / 2 - w / 2, y = 12, h = 66;
  plate(c, x, y, w, h, { stripe: C.hostile });
  const k = B ? clamp(B.hp / B.maxHp, 0, 1) : clamp(E!.hp / E!.maxHp, 0, 1);
  const lag = B ? st.bossLag : st.eliteLag;
  const name = B ? (B.ghost.ai ? `${B.ghost.name}` : `GHOST OF ${B.ghost.name}`) : `${(EN[E!.type].name || 'ELITE').toUpperCase()}`;
  const tag = B ? (B.ghost.ai ? 'DEFENSE CORE' : 'GHOST DREADNOUGHT') : 'ELITE CONTACT';
  drawIcon(c, B ? 'spectre' : 'crowned-skull', x + 30, y + 37, 30, C.hostile);
  c.font = `20px ${F_STEN}`; c.fillStyle = C.hostile; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  c.fillText(name.toUpperCase(), x + 56, y + 32);
  label(c, tag, x + w - 16, y + 30, C.dim, 11, 'right');
  const bx = x + 56, bw = w - 72, by = y + 42, bh = 12;
  c.fillStyle = '#05080b'; c.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
  c.fillStyle = 'rgba(255,240,220,.85)'; c.fillRect(bx, by, bw * lag, bh);
  const g = c.createLinearGradient(0, by, 0, by + bh); g.addColorStop(0, '#ffb3a8'); g.addColorStop(0.35, C.hostile); g.addColorStop(1, '#8c241c');
  c.fillStyle = g; c.fillRect(bx, by, bw * k, bh);
  c.fillStyle = 'rgba(0,0,0,.55)'; for (let i = 1; i < 20; i++) c.fillRect(bx + (bw * i) / 20, by, 1, bh);
  // phase notch at half hull
  c.fillStyle = C.fg; c.fillRect(bx + bw * 0.5 - 1, by - 5, 2, bh + 10);
  if (B && B.shieldMax) { c.fillStyle = C.plasma; c.fillRect(bx, by - 1, (bw * B.shield) / B.shieldMax, 3); }
  if (B && !B.ghost.ai) label(c, `FELL ON FLOOR ${B.ghost.floor + 1}`, x + w - 16, y + 62, C.faint, 9, 'right');
}

function batteries(c: CanvasRenderingContext2D) {
  const P = S.P!;
  const mounts = P.dv.mounts.filter((m) => m.part && WEAPONS[m.part.id]);
  if (!mounts.length) return;
  const cell = 46, w = 22 + mounts.length * cell, h = 64, x = 14, y = H - 14 - h;
  plate(c, x, y, w, h);
  label(c, 'BATTERIES', x + 12, y + 16, C.faint, 10);
  mounts.forEach((m, i) => {
    const p = m.part!, def = WEAPONS[p.id], col = LAYER_COL[def.layer] ?? C.fg;
    const cd = P.cds[p.uid] ?? 0, full = wCd(p) * (p.id === 'rail' ? P.dv.mods.railCdMul : 1) / Math.max(0.2, P.dv.fireMult);
    const prev = st.lastCd.get(p.uid) ?? cd;
    if (cd > prev + 0.02) st.fired.set(p.uid, st.t);
    st.lastCd.set(p.uid, cd);
    const ready = clamp(1 - cd / Math.max(0.05, full), 0, 1);
    const flash = clamp(1 - (st.t - (st.fired.get(p.uid) ?? -9)) / 0.12, 0, 1);
    const cx = x + 22 + i * cell + cell / 2 - 12, cy = y + 34;
    lampDot(c, cx, cy, 6, flash > 0 ? '#ffffff' : col, flash > 0 ? 1 : 0.2 + 0.7 * ready * ready);
    label(c, CODE[p.id] ?? p.id.slice(0, 3).toUpperCase(), cx, cy + 22, ready > 0.98 ? C.dim : C.faint, 10, 'center');
  });
}

/* ---------------- gameplay hooks: carnage + overdrive ---------------- */
interface Meter { k: number; mult?: number; ready?: boolean; active?: boolean; key?: string }
function readMeter(v: unknown): Meter | null {
  if (v == null) return null;
  if (typeof v === 'number') return { k: clamp(v > 1 ? v / 100 : v, 0, 1) };
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const raw = Number(o.value ?? o.charge ?? o.level ?? o.t ?? 0), max = Number(o.max ?? (raw > 1 ? 100 : 1)) || 1;
    return { k: clamp(raw / max, 0, 1), mult: typeof o.mult === 'number' ? o.mult : typeof o.multiplier === 'number' ? o.multiplier : undefined, ready: !!o.ready, active: !!o.active, key: typeof o.key === 'string' ? o.key : undefined };
  }
  return null;
}
function hooks(c: CanvasRenderingContext2D) {
  const s = S as unknown as Record<string, unknown>;
  const carnage = readMeter(s.carnage), od = readMeter(s.overdrive);
  let x = W - 14;
  if (od) {
    const w = 168, h = 112, y = H - 14 - h; x -= w;
    plate(c, x, y, w, h, { stripe: od.ready || od.active ? C.hazard : undefined });
    label(c, 'OVERDRIVE', x + 14, y + 22, od.ready ? C.hazard : C.faint, 10);
    const gx = x + w / 2, gy = y + 84, r = 46;
    c.fillStyle = '#e9e2cf'; c.beginPath(); c.arc(gx, gy, r, Math.PI, 0); c.closePath(); c.fill();
    c.strokeStyle = '#c43a2c'; c.lineWidth = 4; c.beginPath(); c.arc(gx, gy, r - 7, -Math.PI * 0.18, 0); c.stroke();
    c.strokeStyle = '#2b2a26'; c.lineWidth = 1.4;
    for (let i = 0; i <= 10; i++) { const a = Math.PI + (i / 10) * Math.PI, r0 = i % 5 ? r - 6 : r - 10; c.beginPath(); c.moveTo(gx + Math.cos(a) * r0, gy + Math.sin(a) * r0); c.lineTo(gx + Math.cos(a) * (r - 2), gy + Math.sin(a) * (r - 2)); c.stroke(); }
    const jitter = od.active ? Math.sin(st.t * 60) * 0.02 : 0, a = Math.PI + clamp(od.k + jitter, 0, 1.02) * Math.PI;
    c.strokeStyle = '#b6271b'; c.lineWidth = 2; c.beginPath(); c.moveTo(gx, gy); c.lineTo(gx + Math.cos(a) * (r - 6), gy + Math.sin(a) * (r - 6)); c.stroke();
    c.fillStyle = '#20262c'; c.beginPath(); c.arc(gx, gy, 4, 0, Math.PI * 2); c.fill();
    lampDot(c, x + w - 18, y + 18, 5, C.hazard, od.ready ? (Math.floor(st.t * 4) % 2 ? 1 : 0.4) : 0);
    if (od.ready) label(c, `${od.key ?? 'SPACE'}`, x + w / 2, y + 104, C.hazard, 11, 'center');
    x -= 10;
  }
  if (carnage) {
    const w = 96, h = 112, y = H - 14 - h; x -= w;
    plate(c, x, y, w, h);
    label(c, 'CARNAGE', x + 12, y + 22, C.faint, 10);
    const n = 10, sx = x + 14, sy = y + 32;
    for (let i = 0; i < n; i++) {
      const on = carnage.k * n > i, col = i >= 8 ? C.hostile : i >= 5 ? C.hazard : C.good;
      c.fillStyle = on ? col : '#18212a'; c.fillRect(sx, sy + (n - 1 - i) * 7, 18, 5);
    }
    c.font = `22px ${F_MONO}`; c.fillStyle = carnage.k > 0.8 ? C.hostile : C.crt; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    c.fillText(carnage.mult != null ? `×${carnage.mult.toFixed(1)}` : `${Math.round(carnage.k * 100)}`, x + 62, y + 76);
    label(c, 'SCRAP', x + 62, y + 94, C.faint, 9, 'center');
  }
}

/* ---------------- off-screen threats ---------------- */
function edgeAnchor(ang: number, l: number, t: number, r: number, b: number) {
  const cx = (l + r) / 2, cy = (t + b) / 2, hx = (r - l) / 2, hy = (b - t) / 2;
  const cs = Math.cos(ang), sn = Math.sin(ang);
  const k = Math.min(Math.abs(cs) < 1e-6 ? Infinity : hx / Math.abs(cs), Math.abs(sn) < 1e-6 ? Infinity : hy / Math.abs(sn));
  return { x: cx + cs * k, y: cy + sn * k };
}
function threats(c: CanvasRenderingContext2D) {
  const list: { x: number; y: number; big: boolean }[] = [];
  for (const e of S.enemies) {
    if (e.dead || e.hp <= 0 || EN[e.type]?.salvage) continue;
    if (e.x > -8 && e.x < W + 8 && e.y > -8 && e.y < H + 8) continue;
    if (e.x < -320 || e.x > W + 320 || e.y < -320 || e.y > H + 320) continue;
    list.push({ x: e.x, y: e.y, big: !!EN[e.type]?.elite });
  }
  const B = S.boss;
  if (B && B.alive && (B.y < -20 || B.y > H + 20)) list.push({ x: B.x, y: B.y, big: true });
  if (!list.length) return;
  const cx = W / 2, cy = H / 2;
  c.save();
  for (const t of list.slice(0, 14)) {
    const ang = Math.atan2(t.y - cy, t.x - cx), a = edgeAnchor(ang, 26, 104, W - 26, H - 26);
    const dist = Math.max(0, Math.max(-t.x, t.x - W, -t.y, t.y - H));
    const near = 1 - clamp(dist / 320, 0, 1), pulse = 0.5 + 0.5 * Math.sin(st.t * (t.big ? 14 : 8));
    const s = t.big ? 1.5 : 1;
    c.save(); c.translate(a.x, a.y); c.globalAlpha = 0.45 + 0.55 * near;
    if (t.big) { c.strokeStyle = C.hostile; c.lineWidth = 2; c.beginPath(); c.arc(0, 0, 17 + pulse * 3, 0, Math.PI * 2); c.stroke(); }
    c.rotate(ang); c.scale(s, s);
    c.fillStyle = C.hostile; c.strokeStyle = 'rgba(10,14,19,.9)'; c.lineWidth = 2; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(10 + pulse * 2, 0); c.lineTo(-5, -8); c.lineTo(-1, 0); c.lineTo(-5, 8); c.closePath(); c.stroke(); c.fill();
    c.restore();
  }
  c.restore();
}

/* ---------------- banner: a stencil stamp ---------------- */
function banner(c: CanvasRenderingContext2D) {
  const b = S.banner; if (!b) { st.bannerKey = ''; return; }
  const key = b.text + b.max;
  if (key !== st.bannerKey) st.bannerKey = key;
  const age = b.max - b.t, out = b.t;
  const slam = clamp(age / 0.16, 0, 1), fade = clamp(out / 0.35, 0, 1);
  const scale = slam < 1 ? 1.6 - 0.6 * (1 - (1 - slam) ** 3) : 1 + (1 - fade) * 0.04;
  const alpha = Math.min(slam * 1.4, fade);
  if (alpha <= 0) return;
  const cy = H * 0.34;
  c.save();
  c.translate(W / 2, cy); c.rotate(-0.035); c.scale(scale, scale); c.globalAlpha = alpha;
  c.font = `52px ${F_STEN}`; c.textAlign = 'center'; c.textBaseline = 'middle';
  const tw = c.measureText(b.text).width, bw = tw + 84, bh = 84;
  c.fillStyle = 'rgba(8,10,13,.55)'; c.fillRect(-bw / 2, -bh / 2, bw, bh);
  c.strokeStyle = b.col; c.lineWidth = 4; c.strokeRect(-bw / 2, -bh / 2, bw, bh);
  c.lineWidth = 1.5; c.strokeRect(-bw / 2 + 8, -bh / 2 + 8, bw - 16, bh - 16);
  c.fillStyle = b.col; c.fillText(b.text, 0, 3);
  // ink voids: a few knocked-out flecks so it reads as a stamp, stable per banner
  c.globalCompositeOperation = 'destination-out';
  let seed = 0; for (const ch of key) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  for (let i = 0; i < 26; i++) { seed = (seed * 1103515245 + 12345) >>> 0; const fx = ((seed % 1000) / 1000 - 0.5) * bw; seed = (seed * 1103515245 + 12345) >>> 0; const fy = ((seed % 1000) / 1000 - 0.5) * bh; c.fillRect(fx, fy, 2 + (seed % 5), 1 + (seed % 2)); }
  c.globalCompositeOperation = 'source-over';
  if (b.sub) {
    c.font = `15px ${F_MONO}`;
    const sw = c.measureText(b.sub).width + 28;
    c.rotate(0.05);
    c.fillStyle = '#1b1c20'; c.fillRect(-sw / 2, bh / 2 + 12, sw, 26);
    c.fillStyle = 'rgba(255,255,255,.08)'; c.fillRect(-sw / 2, bh / 2 + 12, sw, 1);
    c.fillStyle = '#f4efe2'; c.fillText(b.sub.toUpperCase(), 0, bh / 2 + 26);
  }
  c.restore();
}

/* ---------------- entry ---------------- */
export function drawHud(c: CanvasRenderingContext2D, scale: number, dpr: number, totalScrap: number) {
  const now = performance.now() / 1000;
  const dt = st.last ? Math.min(0.1, now - st.last) : 0; st.last = now; st.t += dt;
  c.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  c.clearRect(0, 0, W, H);
  VIG ||= mkV('rgba(0,0,0,0)', 'rgba(0,0,0,.5)'); HURT ||= mkV('rgba(255,40,30,0)', 'rgba(255,40,30,.75)');
  c.drawImage(VIG, -10, -10, W + 20, H + 20);
  if (V.hurt > 0) { c.globalAlpha = Math.min(1, V.hurt * 0.75); c.drawImage(HURT, -10, -10, W + 20, H + 20); c.globalAlpha = 1; }
  if (V.flashA > 0) { c.globalCompositeOperation = 'lighter'; c.globalAlpha = V.flashA; c.fillStyle = '#fff1d6'; c.fillRect(0, 0, W, H); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1; }
  const P = S.P; if (!P) return;
  // new encounter: snap the lagging bars instead of draining from the last fight
  if (st.enc !== S.enc) { st.enc = S.enc; st.hpLag = P.hp / P.dv.maxHp; st.shLag = 1; st.bossLag = 1; st.eliteLag = 1; st.lastScrap = -1; st.gains = []; st.scrapShown = totalScrap; st.fired.clear(); st.lastCd.clear(); }
  const ease = (lag: number, v: number) => (v >= lag ? v : Math.max(v, lag - dt * 0.35 * (lag - v < 0.02 ? 4 : 1)));
  st.hpLag = ease(st.hpLag, clamp(P.hp / P.dv.maxHp, 0, 1));
  st.shLag = ease(st.shLag, P.dv.shieldMax ? clamp(P.shield / P.dv.shieldMax, 0, 1) : 0);
  if (S.boss) st.bossLag = ease(st.bossLag, clamp(S.boss.hp / S.boss.maxHp, 0, 1));
  if (S.elite) st.eliteLag = ease(st.eliteLag, clamp(S.elite.hp / S.elite.maxHp, 0, 1));
  threats(c);
  hullCluster(c);
  encounterPlate(c);
  scrapCluster(c, totalScrap);
  pauseKey(c);
  batteries(c);
  hooks(c);
  banner(c);
}
