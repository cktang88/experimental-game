// Boot sequence: the fire-control computer cold-starts, the targeting uplink locks, the picture tears,
// and the reticle closes on the title. 2.7 s, any key or click skips. Adapted from Dead Air's title-intro.js
// (SMPTE card -> glitch -> title) into a warship's targeting uplink.
//
//   0.00-1.05  amber CRT boot log prints, reticle spins up
//   1.05-1.40  picture tears and rolls
//   1.40-1.70  static
//   1.70-2.70  reticle brackets close on the title lockup, title resolves with a channel split, overlay fades
//
// Skipped under prefers-reduced-motion, for automated browsers (unless ?intro), with ?nointro, and after the
// first run in a browser session.
const TOTAL = 2.7, HANDOFF = 2.2;
let done = false;
const waiters: (() => void)[] = [];
export const bootDone = () => done;
export function onBootDone(fn: () => void) { if (done) fn(); else waiters.push(fn); }
function markDone() { if (done) return; done = true; for (const f of waiters.splice(0)) f(); }

const AMBER = '#ffb347', AMBER_DIM = 'rgba(255,179,71,.45)', PLASMA = '#4fd1e8', HOSTILE = '#ff5a4e';
const LINES: [string, string][] = [
  ['GD-01 FIRE CONTROL', 'COLD START'],
  ['REACTOR', '98%'],
  ['HULL TELEMETRY', 'NOMINAL'],
  ['BROADSIDE BATTERIES', 'ARMED'],
  ['GHOST REGISTRY', 'LINKING'],
  ['TARGETING UPLINK', 'ACQUIRED'],
];

function shouldSkip() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return true;
  const q = location.search;
  if (/[?&]nointro\b/.test(q)) return true;
  if (/[?&]intro\b/.test(q)) return false;
  if (navigator.webdriver) return true;
  if (matchMedia?.('(prefers-reduced-motion: reduce)').matches) return true;
  try { if (sessionStorage.getItem('gd.booted')) return true; sessionStorage.setItem('gd.booted', '1'); } catch { /* ignore */ }
  return false;
}

function start() {
  const cv = document.createElement('canvas');
  cv.id = 'boot'; cv.setAttribute('aria-hidden', 'true');
  const scale = Math.min(1, 1280 / Math.max(1, innerWidth));
  const W = Math.max(2, Math.round(innerWidth * scale)), H = Math.max(2, Math.round(innerHeight * scale));
  cv.width = W; cv.height = H;
  document.body.append(cv);
  const g = cv.getContext('2d')!;
  const src = document.createElement('canvas'); src.width = W; src.height = H; const sg = src.getContext('2d')!;
  const nz = document.createElement('canvas'); nz.width = 160; nz.height = 90; const ng = nz.getContext('2d')!, img = ng.createImageData(160, 90);
  let clock = 0, last = performance.now(), raf = 0, finished = false;
  const U = Math.max(10, Math.round(Math.min(W, H * 1.6) / 68));

  const finish = () => {
    if (finished) return; finished = true; cancelAnimationFrame(raf); markDone();
    for (const n of ['pointerdown', 'keydown', 'touchstart'] as const) window.removeEventListener(n, skip, true);
    cv.remove();
  };
  const skip = (e: Event) => { if (e.type === 'keydown' && ['Shift', 'Control', 'Alt', 'Meta'].includes((e as KeyboardEvent).key)) return; e.preventDefault(); e.stopPropagation(); finish(); };
  for (const n of ['pointerdown', 'keydown', 'touchstart'] as const) window.addEventListener(n, skip, { capture: true });

  const noise = (a: number) => {
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) { const v = (Math.random() * 200) | 0; d[i] = v; d[i + 1] = v * 0.86; d[i + 2] = v * 0.6; d[i + 3] = 255; }
    ng.putImageData(img, 0, 0); g.globalAlpha = a; g.imageSmoothingEnabled = false; g.drawImage(nz, 0, 0, W, H); g.globalAlpha = 1;
  };
  const scan = (c: CanvasRenderingContext2D, a: number) => { c.fillStyle = `rgba(0,0,0,${a})`; for (let y = 0; y < H; y += 3) c.fillRect(0, y, W, 1); };
  const mono = (px: number) => `${Math.round(px)}px "Share Tech Mono", ui-monospace, monospace`;

  const reticle = (c: CanvasRenderingContext2D, x: number, y: number, r: number, t: number, col: string, lock: number) => {
    c.save(); c.translate(x, y); c.strokeStyle = col; c.lineWidth = Math.max(1, U * 0.12);
    c.globalAlpha = 0.9;
    c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.stroke();
    c.save(); c.rotate(t * 1.6); c.setLineDash([U * 0.5, U * 0.35]); c.beginPath(); c.arc(0, 0, r * 0.78, 0, Math.PI * 2); c.stroke(); c.restore();
    c.rotate(-t * 0.7);
    for (let i = 0; i < 4; i++) { c.rotate(Math.PI / 2); c.beginPath(); c.moveTo(r * (1.08 - lock * 0.5), 0); c.lineTo(r * 1.35, 0); c.stroke(); }
    c.restore();
    c.fillStyle = col; c.fillRect(x - 1.5, y - 1.5, 3, 3);
  };

  const bootScreen = (c: CanvasRenderingContext2D, t: number) => {
    c.fillStyle = '#070605'; c.fillRect(0, 0, W, H);
    const x0 = W * 0.08, y0 = H * 0.2, lh = U * 1.55;
    c.textBaseline = 'middle'; c.textAlign = 'left';
    c.font = mono(U * 0.95);
    const shown = Math.min(LINES.length, Math.floor(t / 0.15) + 1);
    for (let i = 0; i < shown; i++) {
      const [k, v] = LINES[i], age = t - i * 0.15, y = y0 + i * lh;
      c.fillStyle = i === 0 ? AMBER : AMBER_DIM; c.fillText(i === 0 ? k : k, x0, y);
      if (i > 0) {
        const dots = Math.floor(Math.min(1, age / 0.1) * 22);
        c.fillText('.'.repeat(dots), x0 + U * 14, y);
        if (age > 0.1) { c.fillStyle = v === 'LINKING' ? (Math.floor(t * 8) % 2 ? AMBER : AMBER_DIM) : v === 'ACQUIRED' ? PLASMA : AMBER; c.fillText(v, x0 + U * 27, y); }
      } else { c.fillStyle = AMBER; c.fillText(` // ${v}`, x0 + c.measureText(k).width, y); }
    }
    if (Math.floor(t * 4) % 2) { c.fillStyle = AMBER; c.fillRect(x0, y0 + shown * lh - U * 0.45, U * 0.6, U * 0.9); }
    const lock = Math.min(1, Math.max(0, (t - 0.75) / 0.25));
    reticle(c, W * 0.72, H * 0.48, Math.min(W, H) * 0.17, t, lock > 0 ? PLASMA : AMBER, lock);
    c.font = mono(U * 0.7); c.fillStyle = AMBER_DIM; c.textAlign = 'center';
    c.fillText(lock >= 1 ? 'UPLINK LOCKED' : `SWEEP ${String(Math.floor(t * 997) % 360).padStart(3, '0')}°`, W * 0.72, H * 0.48 + Math.min(W, H) * 0.24);
    c.textAlign = 'left'; c.fillText('ANY KEY · SKIP', x0, H - U * 2);
    // phosphor bloom
    const gr = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
    gr.addColorStop(0, 'rgba(255,179,71,.06)'); gr.addColorStop(1, 'rgba(0,0,0,.55)');
    c.fillStyle = gr; c.fillRect(0, 0, W, H);
  };

  let slot: { x: number; y: number; w: number; h: number } | null = null;
  const findSlot = () => {
    const h1 = document.querySelector('.title-page h1');
    if (h1) { const r = h1.getBoundingClientRect(); if (r.width > 10) return { x: r.left * scale, y: r.top * scale, w: r.width * scale, h: r.height * scale }; }
    return { x: W * 0.1, y: H * 0.3, w: W * 0.5, h: H * 0.3 };
  };

  const frame = (now: number) => {
    if (finished) return;
    clock += Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
    const t = clock;
    if (t >= HANDOFF) markDone();
    if (t >= TOTAL) { finish(); return; }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    if (t < 1.05) { bootScreen(g, t); scan(g, 0.18); }
    else if (t < 1.4) {
      bootScreen(sg, t); g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
      const k = (t - 1.05) / 0.35, roll = Math.sin(t * 90) * H * 0.05 * k;
      for (let y = 0; y < H;) {
        const h = Math.max(4, Math.round(H * (0.02 + Math.random() * 0.1))), dx = Math.random() < 0.5 + k * 0.4 ? (Math.random() - 0.5) * W * 0.3 * (0.3 + k) : 0;
        g.drawImage(src, 0, y, W, Math.min(h, H - y), dx, y + roll, W, Math.min(h, H - y)); y += h;
      }
      g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.35; g.drawImage(src, U * k, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      noise(0.08 + k * 0.3); scan(g, 0.2);
    } else if (t < 1.7) {
      g.fillStyle = '#000'; g.fillRect(0, 0, W, H); noise(0.85);
      if (Math.random() < 0.5) { g.fillStyle = 'rgba(255,220,180,.5)'; g.fillRect(0, Math.random() * H, W, 2 + Math.random() * 5); }
      scan(g, 0.2);
    } else {
      const p = Math.min(1, (t - 1.7) / 0.5), fade = Math.max(0, Math.min(1, (t - HANDOFF) / (TOTAL - HANDOFF)));
      slot = slot || findSlot();
      g.clearRect(0, 0, W, H);
      g.fillStyle = `rgba(6,8,10,${0.96 * (1 - fade)})`; g.fillRect(0, 0, W, H);
      if (p < 1) noise(0.4 * (1 - p) * (1 - fade));
      // brackets close from the full frame onto the lockup
      const e = 1 - (1 - p) ** 3, s = slot, pad = U * 0.8;
      const bx = s.x - pad + (0 - (s.x - pad)) * (1 - e), by = s.y - pad + (0 - (s.y - pad)) * (1 - e);
      const bw = s.w + pad * 2 + (W - (s.w + pad * 2)) * (1 - e), bh = s.h + pad * 2 + (H - (s.h + pad * 2)) * (1 - e);
      const L = U * 2.2;
      g.strokeStyle = p >= 1 ? HOSTILE : PLASMA; g.lineWidth = Math.max(2, U * 0.18); g.globalAlpha = 1 - fade;
      g.beginPath();
      g.moveTo(bx, by + L); g.lineTo(bx, by); g.lineTo(bx + L, by);
      g.moveTo(bx + bw - L, by); g.lineTo(bx + bw, by); g.lineTo(bx + bw, by + L);
      g.moveTo(bx + bw, by + bh - L); g.lineTo(bx + bw, by + bh); g.lineTo(bx + bw - L, by + bh);
      g.moveTo(bx + L, by + bh); g.lineTo(bx, by + bh); g.lineTo(bx, by + bh - L);
      g.stroke();
      if (p >= 1) { g.font = mono(U * 0.75); g.fillStyle = HOSTILE; g.textBaseline = 'bottom'; g.textAlign = 'left'; g.fillText('TARGET: CITY BELOW', bx, by - U * 0.3); }
      // title resolves with a channel split
      const split = (1 - p) * U * 2.4;
      g.textBaseline = 'top'; g.textAlign = 'left';
      const big = s.h * 0.52;
      g.font = `${Math.round(big)}px "Saira Stencil One", "Chakra Petch", sans-serif`;
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.7 * (1 - fade) * (1 - p * 0.6);
      g.fillStyle = PLASMA; g.fillText('GHOST', s.x - split, s.y);
      g.fillStyle = HOSTILE; g.fillText('GHOST', s.x + split, s.y);
      g.globalCompositeOperation = 'source-over';
      if (p < 0.5 && Math.random() < 0.5) g.drawImage(cv, 0, H * Math.random() * 0.6, W, H * 0.06, (Math.random() - 0.5) * W * 0.06, H * Math.random() * 0.6, W, H * 0.06);
      g.globalAlpha = 1 - fade; scan(g, 0.12 * (1 - fade)); g.globalAlpha = 1;
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
}

if (shouldSkip()) markDone(); else start();
