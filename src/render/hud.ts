import { S, W, H } from '../game/combat';
import { V } from '../game/vfx';
import { clamp } from '../util/rng';
import { EN } from '../data/enemies';

let VIG: HTMLCanvasElement | null = null, HURT: HTMLCanvasElement | null = null;
function mkV(inner: string, outer: string) {
  const s = document.createElement('canvas'); s.width = W; s.height = H; const g = s.getContext('2d')!;
  const gr = g.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.72); gr.addColorStop(0, inner); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, W, H); return s;
}
function bar(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, k: number, col: string, bg = 'rgba(10,14,19,.75)') {
  c.fillStyle = bg; c.fillRect(x, y, w, h); c.fillStyle = col; c.fillRect(x, y, w * clamp(k, 0, 1), h);
}
export function drawHud(c: CanvasRenderingContext2D, scale: number, dpr: number, totalScrap: number) {
  c.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  c.clearRect(0, 0, W, H);
  VIG ||= mkV('rgba(0,0,0,0)', 'rgba(0,0,0,.5)'); HURT ||= mkV('rgba(255,40,30,0)', 'rgba(255,40,30,.75)');
  c.drawImage(VIG, -10, -10, W + 20, H + 20);
  if (V.hurt > 0) { c.globalAlpha = Math.min(1, V.hurt * 0.75); c.drawImage(HURT, -10, -10, W + 20, H + 20); c.globalAlpha = 1; }
  if (V.flashA > 0) { c.globalCompositeOperation = 'lighter'; c.globalAlpha = V.flashA; c.fillStyle = '#fff1d6'; c.fillRect(0, 0, W, H); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1; }
  const P = S.P; if (!P) return;
  c.fillStyle = 'rgba(10,14,19,.72)'; c.fillRect(0, 0, W, 48);
  c.fillStyle = '#f2a541'; c.fillRect(0, 48, W, 1);
  c.font = '600 10px "IBM Plex Mono",monospace'; c.fillStyle = '#8597a8'; c.textBaseline = 'alphabetic'; c.textAlign = 'left';
  c.fillText('HULL', 12, 15);
  bar(c, 46, 7, 150, 9, P.hp / P.dv.maxHp, P.hp / P.dv.maxHp < 0.3 ? '#ff5a4e' : '#8fe39a');
  c.fillStyle = '#dbe4ec'; c.fillText(`${Math.ceil(Math.max(0, P.hp))}/${Math.round(P.dv.maxHp)}`, 202, 15);
  if (P.dv.shieldMax) { c.fillStyle = '#8597a8'; c.fillText('SHLD', 12, 30); bar(c, 46, 23, 150, 6, P.shield / P.dv.shieldMax, '#4fd1e8'); }
  c.textAlign = 'right';
  c.fillStyle = '#8597a8'; c.fillText('SCRAP', W - 58, 15);
  c.fillStyle = '#f2a541'; c.font = '600 13px "IBM Plex Mono",monospace'; c.fillText(String(Math.floor(totalScrap)), W - 58, 31);
  c.font = '600 10px "IBM Plex Mono",monospace'; c.fillStyle = '#8fe39a'; c.fillText(`+${Math.floor(S.scrap)} this fight`, W - 58, 43);
  c.textAlign = 'left'; c.fillStyle = '#dbe4ec'; c.font = '700 12px "Chakra Petch",sans-serif';
  c.fillText(`SECTOR ${S.sector} · ${S.enc?.name.toUpperCase() ?? ''}`, 12, 43);
  if (S.enc?.kind === 'fight' && S.mode === 'play') bar(c, 220, 38, 70, 4, S.time / S.enc.duration, '#f2a541', 'rgba(255,255,255,.08)');
  // Overdrive and carnage readouts (gameplay agent placeholder: the UI pass owns the final look; see docs/TECH.md)
  { const o = S.overdrive, ready = o.charge >= 1 && !o.active, k = o.active ? o.t / o.dur : o.charge;
    c.fillStyle = '#8597a8'; c.font = '600 10px "IBM Plex Mono",monospace'; c.fillText(o.active ? 'OVERDRIVE ACTIVE' : ready ? 'OVERDRIVE READY · SPACE' : 'OVERDRIVE', 320, 15);
    bar(c, 320, 21, 180, 7, k, ready || o.active ? (S.t * 4 % 1 < 0.5 ? '#ffb347' : '#fff1c1') : '#f2a541');
    const m = S.carnage.mult; c.fillStyle = m > 1.05 ? '#ffb347' : '#8597a8'; c.fillText(`CARNAGE x${m.toFixed(1)}`, 520, 15);
    bar(c, 520, 21, 110, 4, (m - 1) / 2, '#ff8a3d'); }
  c.strokeStyle = '#8597a8'; c.lineWidth = 1; c.strokeRect(W - 40, 8, 30, 30); c.fillStyle = '#dbe4ec'; c.fillRect(W - 30, 15, 4, 16); c.fillRect(W - 23, 15, 4, 16);
  const B = S.boss, E = S.elite && !S.elite.dead ? S.elite : null;
  if ((B && B.alive) || E) {
    const y = 58; c.fillStyle = 'rgba(10,14,19,.72)'; c.fillRect(10, y, W - 20, 26);
    c.font = '700 11px "Chakra Petch",sans-serif'; c.fillStyle = '#ff5a4e';
    if (B && B.alive) {
      c.fillText((B.ghost.ai ? 'DEFENSE CORE · ' : 'GHOST OF ') + B.ghost.name, 18, y + 12);
      c.textAlign = 'right'; c.fillStyle = '#8597a8'; c.font = '600 10px "IBM Plex Mono",monospace';
      c.fillText(B.ghost.ai ? 'no pilot has fallen here yet' : `died on floor ${B.ghost.floor + 1}`, W - 18, y + 12); c.textAlign = 'left';
      bar(c, 18, y + 16, W - 36, 5, B.hp / B.maxHp, '#ff5a4e');
      if (B.shieldMax) bar(c, 18, y + 16, ((W - 36) * B.shield) / B.shieldMax, 2, 1, '#4fd1e8', 'rgba(0,0,0,0)');
    } else if (E) {
      c.fillText(`ELITE · ${(EN[E.type].name || '').toUpperCase()}`, 18, y + 12);
      bar(c, 18, y + 16, W - 36, 5, E.hp / E.maxHp, '#ff5a4e');
    }
  }
  if (S.banner) {
    const b = S.banner, k = b.t / b.max, a = Math.min(1, (1 - k) * 6, k * 4);
    c.globalAlpha = a; c.textAlign = 'center';
    c.fillStyle = 'rgba(10,14,19,.6)'; c.fillRect(0, H * 0.36 - 34, W, 62);
    c.fillStyle = b.col; c.fillRect(0, H * 0.36 - 34, W, 2); c.fillRect(0, H * 0.36 + 26, W, 2);
    c.font = '700 30px "Chakra Petch",sans-serif'; c.fillText(b.text, W / 2, H * 0.36);
    c.font = '600 12px "IBM Plex Mono",monospace'; c.fillStyle = '#dbe4ec'; c.fillText(b.sub || '', W / 2, H * 0.36 + 18);
    c.textAlign = 'left'; c.globalAlpha = 1;
  }
}
