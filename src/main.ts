import './styles.css';
import { Engine, webglAvailable } from './render/engine';
import { TerrainLayer } from './render/world/terrain';
import { ShipLayer } from './render/ship/shipLayer';
import { UnitLayer } from './render/units/unitLayer';
import { FxLayer } from './render/fx/fxLayer';
import { preloadKits } from './render/assets';
import { V } from './game/vfx';
import { drawHud } from './render/hud';
import { drawBlueprint } from './render/shipPreview';
import { S, W, H, keys, startCombat, updateCombat, updateBg, endCombat, seedDecor, setScrapHandler, damagePlayer, damageTarget, triggerOverdrive } from './game/combat';
import { initAudio, sfx, audio, setMuted } from './game/audio';
import {
  newRun, loadRun, saveRun, clearSave, maxHp, dv, mods, level, bossLevel, heal, partChoices, relicChoices, addRelic, addSection,
  nextSectionCost, enterNextSector, deathGhost, changeBuild, runRng, type RunState,
} from './game/run';
import { NODE_INFO, reachable, type NodeType } from './game/map';
import { fetchGhosts, submitGhost, chooseGhost, aiGhost, registryOnline, sanitizeName, type Ghost } from './game/ghosts';
import { FIGHTS, ELITES, BOSS_ENCOUNTER, type Encounter } from './data/enemies';
import { EVENTS, pickEvent, type Outcome } from './data/events';
import { RELICS, hasFlag, relicCost } from './data/relics';
import { SECTIONS, partName, partCost, allParts, ghostToBuild, derive, mkPart, type Part, type SectionType } from './data/parts';
import { el, show, ui, partCard, relicCard, topBar } from './ui/dom';
import { mapView, glyph } from './ui/mapView';
import { refitPanel } from './ui/refit';
import { pick, rint, clamp } from './util/rng';
import { loadProfile, perksFor, dailySeed, dateKey, type Profile } from './game/meta';
import { launchPanel, admiraltyScreen, settle, wreckReport, victoryScreen, portScreen } from './game/metaScreens';
import { HULLS } from './data/hulls';
import { heatFx } from './data/heat';
import { CAMPAIGN_SECTORS } from './game/run';

/* ---------------- canvas + renderer ---------------- */
const glCanvas = document.getElementById('gl') as HTMLCanvasElement;
const hudCanvas = document.getElementById('hud') as HTMLCanvasElement;
const hctx = hudCanvas.getContext('2d')!;
const stageEl = document.getElementById('stage')!;
let renderer: Engine | null = null;
let SCALE = 1, DPR = 1;
function resize() {
  SCALE = Math.min(window.innerWidth / W, window.innerHeight / H);
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  const cw = Math.floor(W * SCALE), ch = Math.floor(H * SCALE);
  hudCanvas.style.width = cw + 'px'; hudCanvas.style.height = ch + 'px';
  hudCanvas.width = Math.round(cw * DPR); hudCanvas.height = Math.round(ch * DPR);
  renderer?.resize(cw, ch);
}
if (webglAvailable()) {
  try {
    const eng = new Engine(glCanvas);
    eng.add(new TerrainLayer(eng)); eng.add(new UnitLayer(eng)); eng.add(new ShipLayer(eng)); eng.add(new FxLayer(eng));
    renderer = eng;
  } catch (e) { console.error(e); renderer = null; }
}
// Kitbash pieces for the ship hulls (the ship layer rebuilds once they arrive).
if (renderer) preloadKits(['scifi']).catch((e) => console.error('kit load failed', e));
window.addEventListener('resize', resize);
resize();
seedDecor();

/* ---------------- state ---------------- */
let run: RunState | null = null;
/** The persistent pilot profile (fleet loop). Settled once per run: death, retiring after victory, or abandoning. */
const profile: Profile = loadProfile();
let mode: 'title' | 'menu' | 'combat' = 'title';
let paused = false;
let onCombatDone: ((o: 'win' | 'dead') => void) | null = null;
let sectorGhosts: Ghost[] = [];
let mapToast = '';
const debug = { timeScale: 1 };

/* ---------------- input ---------------- */
const KEYMAP: Record<string, string> = { ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r', ArrowUp: 'u', KeyW: 'u', ArrowDown: 'd', KeyS: 'd' };
window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
  if (KEYMAP[e.code]) { keys[KEYMAP[e.code]] = true; if (mode === 'combat') e.preventDefault(); }
  if (e.code === 'Space' && mode === 'combat') { e.preventDefault(); if (!e.repeat && !paused) keys.od = true; }
  if ((e.code === 'KeyP' || e.code === 'Escape') && mode === 'combat') setPaused(!paused);
  if (e.code === 'KeyM') setMuted(audio.on);
});
window.addEventListener('keyup', (e) => { if (KEYMAP[e.code]) keys[KEYMAP[e.code]] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; if (mode === 'combat') setPaused(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden && mode === 'combat') setPaused(true); });
let drag: { px: number; py: number; sx: number; sy: number; id: number } | null = null;
const toLocal = (e: PointerEvent) => { const r = hudCanvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / SCALE, y: (e.clientY - r.top) / SCALE }; };
hudCanvas.addEventListener('pointerdown', (e) => {
  initAudio();
  if (mode !== 'combat' || !S.P) return;
  const p = toLocal(e);
  if (p.x > W - 46 && p.y < 46) { setPaused(true); return; }
  drag = { px: p.x, py: p.y, sx: S.P.x, sy: S.P.y, id: e.pointerId };
  try { hudCanvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
});
hudCanvas.addEventListener('pointermove', (e) => {
  if (!drag || !S.P || e.pointerId !== drag.id) return;
  const p = toLocal(e); S.P.tx = drag.sx + (p.x - drag.px) * 1.25; S.P.ty = drag.sy + (p.y - drag.py) * 1.25;
});
const endDrag = (e: PointerEvent) => { if (drag && e.pointerId === drag.id) drag = null; };
hudCanvas.addEventListener('pointerup', endDrag); hudCanvas.addEventListener('pointercancel', endDrag);

/* ---------------- main loop ---------------- */
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.033, (now - last) / 1000); last = now;
  if (mode === 'combat' && !paused) {
    for (let i = 0; i < debug.timeScale; i++) updateCombat(dt);
    if (S.outcome && onCombatDone) { const cb = onCombatDone; onCombatDone = null; cb(S.outcome); }
  } else if (mode === 'title') updateBg(dt);
  const hideStage = mode === 'menu';
  if (stageEl.hidden !== hideStage) stageEl.hidden = hideStage;
  if (mode === 'combat' || mode === 'title') {
    renderer?.render({ dt, t: S.t, S, V, showPlayer: mode === 'combat' && S.mode !== 'dying' && S.mode !== 'done' });
    if (mode === 'combat') drawHud(hctx, SCALE, DPR, run?.scrap ?? 0); else { hctx.setTransform(1, 0, 0, 1, 0, 0); hctx.clearRect(0, 0, hudCanvas.width, hudCanvas.height); }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function setPaused(v: boolean) {
  paused = v;
  if (!v) { show(); return; }
  const abandon = el('button', { onclick: () => { if (abandon.dataset.armed) { paused = false; abandonRun(); } else { abandon.dataset.armed = '1'; abandon.textContent = 'Confirm: abandon run'; } } }, 'Abandon run');
  const mute = el('button', { onclick: () => { setMuted(audio.on); mute.textContent = `Sound: ${audio.on ? 'on' : 'off'}`; } }, `Sound: ${audio.on ? 'on' : 'off'}`);
  show(el('div', 'screen center dim', el('div', 'panel stack', el('div', 'eyebrow', 'Holding position'), el('h2', null, 'Paused'),
    el('div', 'row', el('button', { class: 'primary', onclick: () => setPaused(false), autofocus: true }, 'Resume'), mute, abandon))));
}

/* ---------------- title ---------------- */
function titleScreen() {
  mode = 'title'; paused = false; S.P = null; S.enemies = []; S.eb = []; S.pb = []; S.pickups = []; S.boss = null; S.theme = 0;
  renderer?.clearLayers();
  const saved = loadRun();
  const input = el('input', { type: 'text', id: 'callsign', maxlength: 16, autocomplete: 'off', spellcheck: false });
  let stored = ''; try { stored = localStorage.getItem('gd.callsign') || ''; } catch { /* ignore */ }
  input.value = stored || `PILOT-${rint(100, 999)}`;
  const reg = el('div', 'keys registry', 'Ghost registry: checking…');
  registryOnline().then(({ online, total }) => {
    reg.replaceChildren('Ghost registry: ', el('b', online ? null : 'off', online ? 'online' : 'offline'),
      online ? `. ${total} fallen pilot${total === 1 ? '' : 's'} on record. Their wrecks become the bosses.` : '. Bosses will come from ghosts on this device only.');
  });
  const launch = (daily: boolean) => {
    initAudio(); sfx('ui');
    const cs = sanitizeName(input.value) || 'PILOT'; try { localStorage.setItem('gd.callsign', cs); } catch { /* ignore */ }
    if (saved) settle(profile, saved, saved.won ? 'victory' : 'abandoned'); // a run left unfinished is banked at half pay
    const key = dateKey();
    run = daily ? newRun(cs, dailySeed(key), { daily: key }) : newRun(cs, undefined, { hull: profile.hull, heat: profile.heat, perks: perksFor(profile.xp) });
    mapToast = daily ? `Daily strike ${key}: the same route for every pilot today.` : 'Choose your first node. Everything on floor one is a fight.';
    mapScreen();
  };
  const start = () => launch(false);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });
  const noGl = !renderer ? el('p', 'fatal', 'WebGL is not available in this browser, so combat cannot be drawn. Try a current Chrome, Edge, Firefox or Safari.') : null;
  show(el('div', 'screen center', el('div', 'panel stack',
    el('div', 'eyebrow', 'Vertical assault · roguelite'),
    el('h1', null, 'Ghost', el('br'), el('span', null, 'Dreadnought')),
    el('p', null, 'Build a flying battleship one hull section at a time. Chart a route through each sector: fights, elites, merchants, derelicts and strange signals. At the end of every sector waits a ghost dreadnought, the wreck of a real pilot who died there. When you die, your ship becomes theirs to fight.'),
    noGl,
    launchPanel(profile, () => launch(true), () => admiraltyScreen(profile, titleScreen)),
    el('label', { for: 'callsign', class: 'eyebrow', style: 'color:var(--dim)' }, 'Callsign'), input,
    el('div', 'row', el('button', { class: 'primary', id: 'btn-new', onclick: start, disabled: !renderer }, saved ? 'New run' : 'Launch'),
      saved ? el('button', { id: 'btn-continue', onclick: () => { initAudio(); run = saved; if (saved.phase === 'victory') { showVictory(); return; } mapToast = 'Run restored.'; mapScreen(); } }, `Continue · sector ${saved.sector}`) : null),
    el('div', 'keys', el('kbd', null, 'WASD'), ' / ', el('kbd', null, 'Arrows'), ' or drag to steer. Batteries fire on their own: bow ahead, broadsides beside, bombs below. ', el('kbd', null, 'Space'), ' Overdrive, ', el('kbd', null, 'P'), ' pause, ', el('kbd', null, 'M'), ' mute.'),
    reg,
  )));
  input.focus(); input.select();
}

/* ---------------- map ---------------- */
async function ensureIntel() {
  if (!run || run.bossGhost) return;
  const sector = run.sector;
  const { ghosts, count } = await fetchGhosts(sector);
  if (!run || run.sector !== sector) return;
  sectorGhosts = ghosts;
  run.bossGhost = chooseGhost(ghosts, sector, run.pilot);
  run.bossGhostCount = count;
  saveRun(run);
}
function intelCard(): HTMLElement {
  const card = el('section', 'card intel', el('div', 'eyebrow', 'Boss intel'));
  if (!run!.bossGhost) { card.append(el('strong', null, 'Scanning wrecks…')); ensureIntel().then(() => { if (mode === 'menu' && document.querySelector('.card.intel')) document.querySelector('.card.intel')!.replaceWith(intelCard()); }); return card; }
  const g = run!.bossGhost, b = ghostToBuild(g.sections), d = derive(b);
  const cv = el('canvas', { width: 400, height: 500 }); drawBlueprint(cv, d, true);
  card.append(el('h3', { style: 'color:var(--fg);font-size:17px;letter-spacing:.02em;text-transform:none' }, g.ai ? `${g.name} (defense core)` : `Ghost of ${g.name}`),
    el('p', null, g.ai ? 'No pilot has died in this sector yet, so an automated core holds it.' : `Died on floor ${g.floor + 1} of sector ${g.sector}. ${run!.bossGhostCount === 1 ? '1 ghost haunts' : `${run!.bossGhostCount} ghosts haunt`} this sector.`),
    cv, el('p', { style: 'font-size:13px' }, 'Armed with: ' + (allParts(b).map(partName).join(', ') || 'nothing')));
  return card;
}
function mapScreen() {
  if (!run) return titleScreen();
  mode = 'menu'; renderer?.clearLayers();
  run.stats.maxScrapHeld = Math.max(run.stats.maxScrapHeld, run.scrap); saveRun(run);
  const r = run;
  const info = el('section', 'card', el('div', 'eyebrow', `Sector ${r.sector} route`), el('p', { 'data-testid': 'node-info' }, 'Hover a node to see what it is. Pick one of the glowing nodes to travel there.'));
  const setInfo = (id: string | null) => {
    const p = info.querySelector('p')!;
    if (!id) { p.textContent = 'Hover a node to see what it is. Pick one of the glowing nodes to travel there.'; return; }
    const n = r.map.nodes[id]; const ni = NODE_INFO[n.type];
    const enc = n.enc ? [...FIGHTS, ...ELITES].find((e) => e.id === n.enc) : null;
    p.textContent = `${ni.label}${enc ? `: ${enc.name}` : ''}. ${ni.desc}`;
  };
  const legend = el('div', 'legend', ...(['fight', 'elite', 'event', 'merchant', 'derelict', 'drydock', 'boss'] as NodeType[]).flatMap((t) => {
    const s = el('span'); s.innerHTML = ''; const sv = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); sv.setAttribute('viewBox', '-14 -14 28 28'); sv.append(glyph(t, 20)); s.append(sv);
    return [s, el('span', null, NODE_INFO[t].label)];
  }));
  const svgMap = mapView(r.map, r.at, r.visited, travel, setInfo);
  const toast = mapToast ? el('div', { class: 'toast', role: 'status', style: 'padding:0 16px' }, mapToast) : null;
  mapToast = '';
  show(el('div', null,
    topBar(r, el('button', { id: 'btn-refit', onclick: refitScreen }, 'Refit ship'), el('button', { class: 'ghost', onclick: () => abandonPrompt() }, 'Menu')),
    toast,
    el('div', 'mapwrap', el('div', 'mapcol', svgMap), el('aside', 'side', info, intelCard(), el('section', 'card', el('div', 'eyebrow', 'Legend'), legend))),
  ));
  const cur = svgMap.querySelector('.node.reach') as SVGGElement | null;
  if (cur) requestAnimationFrame(() => cur.scrollIntoView({ block: 'center' }));
}
function abandonPrompt() {
  show(el('div', 'screen center solid', el('div', 'panel stack', el('h2', null, 'Run menu'), el('p', null, 'Your run is saved after every node. You can leave and continue later from the title screen.'),
    el('div', 'row', el('button', { class: 'primary', onclick: mapScreen }, 'Back to map'), el('button', { onclick: titleScreen }, 'Save and quit'),
      el('button', { onclick: (e: Event) => { const b = e.currentTarget as HTMLButtonElement; if (b.dataset.armed) abandonRun(); else { b.dataset.armed = '1'; b.textContent = 'Confirm: abandon run'; } } }, 'Abandon run')))));
}
function abandonRun() { if (run) settle(profile, run, 'abandoned'); clearSave(); run = null; endCombat(); mode = 'title'; titleScreen(); }
function refitScreen() {
  const r = run!;
  const top = el('div');
  const refreshTop = () => top.replaceChildren(topBar(r, el('button', { class: 'primary', id: 'btn-done', onclick: mapScreen }, 'Done')));
  refreshTop();
  show(el('div', null, top, el('div', { style: 'padding:16px;max-width:1180px;margin:0 auto' }, el('div', 'eyebrow', 'Drydock bay'), el('h2', { style: 'margin:4px 0 16px' }, 'Refit ship'), refitPanel(r, () => { saveRun(r); refreshTop(); }))));
}

/* ---------------- travel + nodes ---------------- */
function travel(id: string) {
  const r = run!;
  if (!reachable(r.map, r.at).includes(id)) return;
  sfx('ui');
  r.at = id; r.visited.push(id); r.stats.nodes++;
  saveRun(r);
  const n = r.map.nodes[id];
  switch (n.type) {
    case 'fight': return fight(FIGHTS.find((f) => f.id === n.enc) ?? FIGHTS[0], () => rewardScreen('fight'));
    case 'elite': return fight(ELITES.find((f) => f.id === n.enc) ?? ELITES[0], () => { r.stats.elites++; rewardScreen('elite'); });
    case 'boss': return bossNode();
    case 'merchant': return merchantScreen();
    case 'event': return eventScreen();
    case 'drydock': return drydockScreen();
    case 'derelict': return derelictScreen();
  }
}
function fight(enc: Encounter, after: () => void, ghost?: Ghost) {
  const r = run!;
  show(); mode = 'combat'; paused = false;
  setScrapHandler((v) => { r.scrap += v; r.stats.scrapEarned += v; });
  startCombat({
    enc, level: enc.kind === 'boss' ? bossLevel(r) : level(r, enc.kind === 'elite'), sector: r.sector, build: r.build, hp: r.hp, relics: r.relics, mods: mods(r), ghost, cheatDeathAvailable: !r.jumpUsed,
    overdrive: HULLS[r.hull].overdrive, heat: heatFx(r.heat), odCharge: r.odStart,
  });
  onCombatDone = (o) => {
    const fs = S.stats, rs = r.stats;
    rs.kills += S.kills; rs.score += S.score; rs.fights++;
    rs.structures += fs.structures; rs.broadsides += fs.broadsides; rs.maxVolley = Math.max(rs.maxVolley, fs.maxVolley); rs.overdrives += fs.overdrives;
    rs.lanceStructures += fs.lanceStructures; rs.peakCarnage = Math.max(rs.peakCarnage, fs.peakCarnage); rs.dmgTaken += fs.dmgTaken; rs.dmgDealt += fs.dmgDealt;
    if (o === 'win' && fs.dmgTaken < S.P!.dv.maxHp * 0.05) rs.flawless++;
    for (const [k, n] of Object.entries(S.seen)) r.seen.enemies[k] = (r.seen.enemies[k] || 0) + (n || 0);
    if (ghost) r.seen.ghosts.push({ id: ghost.id, name: ghost.name, sector: ghost.sector, ai: !!ghost.ai, outcome: o === 'win' ? 'killed' : 'lost' });
    if (S.cheatDeathUsed) r.jumpUsed = true;
    endCombat(); mode = 'menu'; renderer?.clearLayers();
    if (o === 'dead') { onDeath(); return; }
    r.hp = clamp(S.P!.hp, 1, maxHp(r));
    if (hasFlag(r.relics, 'heal_after_fight')) heal(r, 0.1);
    rs.maxScrapHeld = Math.max(rs.maxScrapHeld, r.scrap);
    saveRun(r); after();
  };
}
function sectionHeader(eyebrow: string, title: string, hostile = false) { return [el('div', { class: 'eyebrow', style: hostile ? 'color:var(--hostile)' : '' }, eyebrow), el('h2', null, title)]; }
function page(content: (Node | null)[], cls = 'panel mid stack') {
  show(el('div', null, topBar(run!), el('div', 'screen', el('div', cls, ...content))));
}

function rewardScreen(kind: 'fight' | 'elite' | 'event', offered?: Part[]) {
  const r = run!;
  const gained = Math.floor(S.scrap);
  const parts = offered && offered.length ? offered : partChoices(r, 3, kind === 'elite' ? 1 : 0);
  const extras: Node[] = [];
  if (kind === 'elite') {
    const [rel] = relicChoices(r, 1, ['common', 'rare']);
    if (rel) { addRelic(r, rel); extras.push(el('h3', null, 'Relic recovered'), relicCard(rel)); }
    if (hasFlag(r.relics, 'bounty_ledger')) { const p = partChoices(r, 1, 1)[0]; r.inv.push(p); r.scrap += 60; extras.push(el('p', null, `Bounty Ledger pays out: 60 scrap and a ${partName(p)}.`)); }
  }
  saveRun(r);
  const take = (p: Part) => { r.inv.push(p); sfx('buy'); mapToast = `${partName(p)} is in your cargo hold. Open Refit ship to mount it.`; mapScreen(); };
  page([
    ...sectionHeader(kind === 'elite' ? 'Elite destroyed' : 'Engagement won', 'Salvage'),
    el('p', null, `Scrap recovered in the fight: `, el('b', { style: 'color:var(--hazard)' }, String(gained)), `. Hull at ${Math.ceil(r.hp)} / ${maxHp(r)}.`),
    ...extras,
    el('h3', null, 'Choose one part'),
    el('div', 'grid3', ...parts.map((p) => partCard(p, { onClick: () => take(p), label: 'Take' }))),
    el('div', 'foot', el('button', { onclick: () => { r.scrap += 20; mapToast = 'Stripped the parts for 20 scrap.'; mapScreen(); } }, 'Skip · +20 scrap')),
  ]);
}

function merchantScreen() {
  const r = run!;
  const m = () => mods(r).priceMul;
  const rng = runRng(r);
  const stock = [...partChoices(r, 3), ...partChoices(r, 2, 1)];
  const sold = new Set<number>();
  const secTypes = (Object.keys(SECTIONS) as SectionType[]).filter((k) => k !== 'bridge');
  const secs = [pick(secTypes, rng)]; while (secs.length < 2) { const k = pick(secTypes, rng); if (!secs.includes(k)) secs.push(k); }
  const secSold = new Set<string>();
  const [rel] = relicChoices(r, 1, ['common', 'rare']); let relSold = false;
  let toast = 'The merchant nods at your scrap counter.';
  const render = () => {
    const price = (p: Part) => Math.round(partCost(p) * m());
    const repairCost = Math.ceil(((maxHp(r) - r.hp) / 3) * m());
    const curses = r.relics.filter((id) => RELICS[id].rarity === 'curse');
    page([
      ...sectionHeader('Trading post', 'Merchant'),
      el('div', { class: 'toast', role: 'status' }, toast),
      el('h3', null, 'Parts'),
      el('div', 'grid3', ...stock.map((p, i) => partCard(p, { price: price(p), sold: sold.has(i), afford: r.scrap >= price(p), onClick: () => { r.scrap -= price(p); sold.add(i); r.inv.push(p); sfx('buy'); toast = `${partName(p)} is in your hold.`; saveRun(r); render(); } }))),
      el('h3', null, 'Hull sections', el('small', null, 'welded to the stern')),
      el('div', 'grid3', ...secs.map((k) => {
        const d = SECTIONS[k], cost = nextSectionCost(r, k), full = r.build.sections.length >= 8;
        return el('button', { class: 'pcard' + (secSold.has(k) ? ' sold' : ''), disabled: secSold.has(k) || full || r.scrap < cost, onclick: () => { r.scrap -= cost; addSection(r, k); secSold.add(k); sfx('buy'); toast = `${d.name} welded on.`; saveRun(r); render(); } },
          el('span', 'nm', d.name), el('span', 'ds', `+${d.hp} hull · ${d.slots.length} ${d.slots[0] === 'W' ? 'weapon mount' : 'utility bay'}${d.slots.length > 1 ? 's' : ''} · mass ${d.mass}${d.thrust ? ` · thrust +${d.thrust}` : ''}`),
          el('span', 'meta', el('span', null, full ? 'Hull at 8 sections' : 'Section'), el('span', 'price', secSold.has(k) ? 'Sold' : `${cost} scrap`)));
      })),
      rel ? el('h3', null, 'Relic') : null,
      rel ? relicCard(rel, { price: Math.round(relicCost(rel) * m()), sold: relSold, afford: r.scrap >= Math.round(relicCost(rel) * m()), onClick: () => { r.scrap -= Math.round(relicCost(rel) * m()); addRelic(r, rel); relSold = true; sfx('buy'); toast = `${RELICS[rel].name} installed.`; saveRun(r); render(); } }) : null,
      el('h3', null, 'Services'),
      el('div', 'row',
        el('button', { disabled: r.hp >= maxHp(r) || r.scrap < 1, onclick: () => { const afford = Math.floor(r.scrap / m()) * 3, fix = Math.min(maxHp(r) - r.hp, afford); r.scrap -= Math.ceil((fix / 3) * m()); r.hp += fix; sfx('buy'); toast = `Repaired ${Math.round(fix)} hull.`; saveRun(r); render(); } }, r.hp >= maxHp(r) ? 'Hull at full strength' : `Repair ${Math.ceil(maxHp(r) - r.hp)} hull · ${repairCost} scrap`),
        curses.length ? el('button', { disabled: r.scrap < 75, onclick: () => { r.scrap -= 75; changeBuild(r, () => r.relics.splice(r.relics.indexOf(curses[0]), 1)); toast = `${RELICS[curses[0]].name} purged.`; saveRun(r); render(); } }, `Purge ${RELICS[curses[0]].name} · 75 scrap`) : null,
        el('button', { onclick: refitFromMerchant }, 'Refit ship')),
      el('h3', null, 'Sell from your hold', el('small', null, '40% of value')),
      el('div', 'row', ...(r.inv.length ? r.inv.map((p, i) => el('button', { class: 'chip', onclick: () => { const v = Math.floor(partCost(p) * 0.4); r.scrap += v; r.inv.splice(i, 1); sfx('buy'); toast = `Sold ${partName(p)} for ${v} scrap.`; saveRun(r); render(); } }, `${partName(p)} · +${Math.floor(partCost(p) * 0.4)}`)) : [el('span', 'keys', 'Nothing to sell.')])),
      el('div', 'foot', el('button', { class: 'primary', id: 'btn-leave', onclick: () => { saveRun(r); mapScreen(); } }, 'Leave')),
    ], 'panel wide stack');
  };
  const refitFromMerchant = () => {
    show(el('div', null, topBar(r, el('button', { class: 'primary', onclick: render }, 'Back to merchant')), el('div', { style: 'padding:16px;max-width:1180px;margin:0 auto' }, refitPanel(r, () => saveRun(r)))));
  };
  render();
}

function eventScreen() {
  const r = run!;
  const ghost = sectorGhosts.find((g) => !g.ai && g.id !== r.bossGhost?.id) ?? (r.bossGhost && !r.bossGhost.ai ? r.bossGhost : null);
  const ev = pickEvent(r, !!ghost);
  const ctx = { run: r, ghost };
  const choices = ev.choices(ctx);
  page([
    ...sectionHeader('Unknown signal', ev.title),
    el('p', { style: 'color:var(--fg)' }, ev.text(ctx)),
    ...choices.map((c, i) => el('button', { class: 'choice', 'data-choice': i, disabled: !!c.disabled, onclick: () => resolve(c.run()) }, el('b', null, c.label), el('span', null, c.detail), c.disabled ? el('em', null, c.disabled) : null)),
  ]);
  function resolve(o: Outcome) {
    sfx('ui'); saveRun(r);
    page([
      ...sectionHeader('Unknown signal', ev.title),
      el('p', { class: 'outcome' }, o.text),
      el('div', 'foot', o.fight
        ? el('button', { class: 'primary', onclick: () => fight(o.fight!, () => rewardScreen('event', o.partChoice)) }, 'Engage')
        : el('button', { class: 'primary', id: 'btn-continue', onclick: mapScreen }, 'Continue')),
    ]);
  }
}

function drydockScreen() {
  const r = run!;
  const rng = runRng(r);
  const secTypes = (Object.keys(SECTIONS) as SectionType[]).filter((k) => k !== 'bridge');
  const offer: SectionType[] = [pick(secTypes, rng)]; while (offer.length < 2) { const k = pick(secTypes, rng); if (!offer.includes(k)) offer.push(k); }
  const healAmt = Math.round(maxHp(r) * 0.35);
  const done = (msg: string) => { sfx('buy'); mapToast = msg; saveRun(r); mapScreen(); };
  const upgradeList = () => {
    const parts = [...allParts(r.build), ...r.inv].filter((p) => p.tier < 5);
    page([...sectionHeader('Drydock', 'Upgrade a part'), el('p', null, 'The part gains one tier: more damage, faster fire, or a stronger effect.'),
      el('div', 'grid3', ...parts.map((p) => partCard({ ...p, tier: p.tier + 1 }, { label: `From Mk ${p.tier}`, onClick: () => { changeBuild(r, () => { p.tier++; }); done(`${partName(p)} upgraded.`); } }))),
      el('div', 'foot', el('button', { onclick: drydockScreen }, 'Back'))]);
  };
  page([
    ...sectionHeader('Safe harbor', 'Drydock'),
    el('p', null, 'The crews can do one job before you launch.'),
    el('button', { class: 'choice', id: 'dock-repair', disabled: r.hp >= maxHp(r), onclick: () => { heal(r, 0.35); done(`Repaired ${healAmt} hull.`); } }, el('b', null, 'Repair'), el('span', null, `Restore ${healAmt} hull.`)),
    el('button', { class: 'choice', id: 'dock-upgrade', onclick: upgradeList }, el('b', null, 'Upgrade'), el('span', null, 'Raise one part by a tier.')),
    ...offer.map((k) => el('button', { class: 'choice', disabled: r.build.sections.length >= 8, onclick: () => { addSection(r, k); done(`${SECTIONS[k].name} welded to the stern for free.`); } }, el('b', null, `Weld on a ${SECTIONS[k].name}`), el('span', null, `Free. +${SECTIONS[k].hp} hull, ${SECTIONS[k].slots.length} ${SECTIONS[k].slots[0] === 'W' ? 'weapon mount' : 'utility bay'}${SECTIONS[k].slots.length > 1 ? 's' : ''}.`))),
  ]);
}

function derelictScreen() {
  const r = run!;
  const rng = runRng(r);
  const [rel] = relicChoices(r, 1, rng() < 0.7 ? ['common'] : ['rare']);
  const scrap = rint(25, 55, rng);
  page([
    ...sectionHeader('Derelict', 'Abandoned hulk'),
    el('p', null, 'A gutted warship drifts in a slow spin. Its strongroom is still sealed.'),
    el('div', 'foot', el('button', { class: 'primary', id: 'btn-open', onclick: () => {
      if (rel) addRelic(r, rel); r.scrap += scrap; sfx('buy'); saveRun(r);
      page([...sectionHeader('Derelict', 'Strongroom opened'), el('p', null, `You also sweep up ${scrap} scrap.`), rel ? relicCard(rel) : el('p', null, 'The strongroom is empty.'), el('div', 'foot', el('button', { class: 'primary', id: 'btn-continue', onclick: mapScreen }, 'Continue'))]);
    } }, 'Cut it open')),
  ]);
}

async function bossNode() {
  const r = run!;
  if (!r.bossGhost) { page([el('p', null, 'Scanning wrecks…')]); await ensureIntel(); }
  const g = r.bossGhost ?? aiGhost(r.sector);
  fight(BOSS_ENCOUNTER, () => { r.stats.bosses++; bossReward(g); }, g);
}
function bossReward(g: Ghost) {
  const r = run!;
  const seen = new Set<string>();
  const salvage = allParts(ghostToBuild(g.sections)).filter((p) => { const k = p.id + p.tier; if (seen.has(k)) return false; seen.add(k); return true; });
  const relics = relicChoices(r, 3, ['boss', 'rare']);
  let step: 'salvage' | 'relic' = 'salvage';
  const render = () => {
    if (step === 'salvage') page([
      ...sectionHeader(g.ai ? 'Core destroyed' : 'Ghost laid to rest', `Salvage: ${g.ai ? g.name : `ghost of ${g.name}`}`),
      el('p', null, 'Pull one part from the wreck.'),
      el('div', 'grid3', ...salvage.map((p) => partCard(p, { label: 'Salvage', onClick: () => { r.inv.push(mkPart(p.id, p.tier)); sfx('buy'); step = 'relic'; render(); } }))),
      el('div', 'foot', el('button', { onclick: () => { r.scrap += 80 + 30 * r.sector; step = 'relic'; render(); } }, `Strip it for ${80 + 30 * r.sector} scrap`)),
    ], 'panel wide stack');
    else page([
      ...sectionHeader('Sector cleared', 'Choose a relic'),
      el('div', 'grid3', ...relics.map((id) => relicCard(id, { onClick: () => next(id) }))),
      el('div', 'foot', el('button', { onclick: () => next(null) }, 'Take nothing')),
    ], 'panel wide stack');
  };
  const next = (id: string | null) => {
    if (id) addRelic(r, id);
    heal(r, 0.3);
    if (r.sector >= CAMPAIGN_SECTORS && !r.won) { r.won = true; r.phase = 'victory'; saveRun(r); showVictory(); return; }
    enterNextSector(r); sectorGhosts = [];
    mapToast = `Sector ${r.sector}. Crews patched 30% of your hull on the way in.`;
    saveRun(r); mapScreen();
  };
  render();
}

function showVictory() {
  const r = run!;
  mode = 'menu'; sfx('clear');
  victoryScreen(r,
    () => { const st = settle(profile, r, 'victory'); clearSave(); portScreen(r, st, () => { run = null; titleScreen(); }); },
    () => { r.endless = true; r.phase = 'map'; enterNextSector(r); sectorGhosts = []; mapToast = `Endless: sector ${r.sector}. The map keeps going, and so do they.`; saveRun(r); mapScreen(); });
}

async function onDeath() {
  const r = run!;
  clearSave();
  const st = settle(profile, r, 'dead');
  const g = deathGhost(r);
  const status = el('p', { style: 'color:var(--fg)', 'data-testid': 'ghost-status' }, 'Recording your wreck…');
  show(el('div', 'screen center solid', el('div', 'panel hostile stack',
    el('div', { class: 'eyebrow', style: 'color:var(--hostile)' }, 'Signal lost'), el('h2', null, 'Dreadnought down'),
    el('p', null, `${r.callsign} went down in sector ${r.sector}, floor ${g.floor + 1}.`),
    wreckReport(r, st),
    status,
    el('button', { class: 'primary', id: 'btn-again', onclick: () => { run = null; titleScreen(); } }, 'Fly again'),
  )));
  const res = await submitGhost(g);
  status.textContent = res === 'shared'
    ? `Your dreadnought now haunts sector ${r.sector}. Pilots who reach its end may face your ghost, armed exactly as you were.`
    : `Your dreadnought now haunts sector ${r.sector} on this device. The ghost registry is offline, so other pilots won't meet it.`;
}

/* ---------------- debug hooks for automated tests ---------------- */
declare global { interface Window { __gd: unknown } }
window.__gd = {
  get run() { return run; }, get profile() { return profile; }, S, debug, EVENTS,
  travelTo(type: NodeType) { const r = run!; const id = reachable(r.map, r.at).find((i) => r.map.nodes[i].type === type); if (id) travel(id); return !!id; },
  reachableTypes() { const r = run!; return reachable(r.map, r.at).map((i) => r.map.nodes[i].type); },
  forceNext(type: NodeType) { const r = run!; const id = reachable(r.map, r.at)[0]; r.map.nodes[id].type = type; if (type === 'fight') r.map.nodes[id].enc = 'patrol'; if (type === 'elite') r.map.nodes[id].enc = 'ace'; travel(id); },
  god(on = true) { S.god = on; },
  winNow() { if (S.boss?.alive) damageTarget(S.boss, 1e9); if (S.elite && !S.elite.dead) damageTarget(S.elite, 1e9); S.time = 9999; for (const e of S.enemies) e.hp = 0.5; },
  overdrive() { S.overdrive.charge = 1; return triggerOverdrive(); },
  killPlayer() { S.god = false; S.firstHitUsed = true; S.cheatDeath = false; if (S.P) { S.P.shield = 0; S.P.hp = 1; } damagePlayer(9999); },
  addScrap(n: number) { run!.scrap += n; },
};

titleScreen();
