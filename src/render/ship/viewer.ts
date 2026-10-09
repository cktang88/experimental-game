// Dev tool: the ship layer on its own, through the real engine (lighting, bloom, tone map) with a
// zoomable camera. /tools/ship.html?build=starter|big|max&zoom=0.35&ghost=0|1&hp=1&fire=1&t=4
import { Engine } from '../engine';
import { ShipLayer } from './shipLayer';
import { preloadKits } from '../assets';
import { S, fireLog } from '../../game/combat';
import { V } from '../../game/vfx';
import { derive, ghostToBuild, WEAPONS, type Build } from '../../data/parts';
import type { Ghost } from '../../game/ghosts';
import * as THREE from 'three';

const q = new URLSearchParams(location.search);
const BUILDS: Record<string, [string, (string | null)[]][]> = {
  starter: [['bridge', ['pulse']], ['gundeck', ['pulse', 'bomb']], ['engine', [null]]],
  big: [['bridge', ['pulse']], ['gundeck', ['flak', 'missile']], ['battery', ['spread', 'rail', 'tesla']], ['armor', ['plate']], ['spine', ['shield', 'drones']], ['engine', ['thruster']]],
  max: [['bridge', ['rail']], ['gundeck', ['pulse', 'flak']], ['battery', ['spread', 'artillery', 'missile']], ['battery', ['tesla', 'pd', 'bomb']], ['armor', ['reactor']], ['spine', ['shield', 'magnet']], ['gundeck', ['pulse', 'artillery']], ['engine', ['repair']]],
};
const spec = BUILDS[q.get('build') || 'starter'] ?? JSON.parse(q.get('build')!);
const build: Build = ghostToBuild(spec.map(([type, slots]) => ({ type, slots: slots.map((id) => (id ? [id, Number(q.get('tier') || 3)] : null)) })));
const ghost = q.get('ghost') === '1', zoom = Number(q.get('zoom') || 0.4), hp = Number(q.get('hp') || 1), fire = q.get('fire') !== '0';
const canvas = document.createElement('canvas'); document.body.append(canvas);
document.body.style.cssText = 'margin:0;background:#000;overflow:hidden';
const eng = new Engine(canvas);
eng.resize(innerWidth, innerHeight);
const layer = eng.add(new ShipLayer(eng));
// A dark ground plane so shadows and fog read as they do in game.
const ground = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#1d2124', roughness: 1 }));
ground.receiveShadow = true; eng.scene.add(ground);

const dv = derive(build);
const x = Number(q.get('x') || 800), y = Number(q.get('y') || 520);
if (ghost) {
  const s = Math.min(1.9, 560 / dv.len, 760 / dv.width);
  S.boss = { ghost: { name: 'viewer' } as Ghost, build, dv, s, x, y, homeY: y, halfW: (dv.width * s) / 2, r: (dv.width * s) / 2, layer: 'both', isBoss: true, alive: true, dead: false,
    hp: hp * 1000, maxHp: 1000, shield: 0, shieldMax: 0, shieldHitT: 9, regen: 0, tractor: 0, droneEvery: 0, droneT: 9, speedMul: 1, fireMul: 1, cdMul: 1, t: 0, phase: hp < 0.5 ? 2 : 1, flash: 0, entered: true,
    weps: [] } as unknown as typeof S.boss;
  S.P = null;
} else {
  S.P = { x, y, build, dv, hp: dv.maxHp * hp, shield: 0, cds: {}, lastHit: 9, flash: 0, tx: null, ty: null, droneCd: [] };
}
S.mode = 'play'; S.enemies = []; S.eb = [];
if (q.get('enemies') === '1') S.enemies = [
  { x: x + 260, y: y - 260, layer: 'air', dead: false }, { x: x - 300, y: y - 60, layer: 'ground', dead: false },
] as unknown as typeof S.enemies;
// Zoom: pull the camera toward the ship.
const look = new THREE.Vector3(); eng.toFlight(x, y, 0, look);
const off = eng.camPos.clone().sub(eng.camLook);
eng.camLook.copy(look); eng.camPos.copy(look).addScaledVector(off, zoom);
const yaw = Number(q.get('orbit') || 0); if (yaw) eng.camPos.sub(look).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(look);
const tilt = Number(q.get('tilt') || 0); if (tilt) { const o = eng.camPos.clone().sub(look); const ax = new THREE.Vector3().crossVectors(o, new THREE.Vector3(0, 1, 0)).normalize(); eng.camPos.copy(look).add(o.applyAxisAngle(ax, -tilt)); }

await preloadKits(['scifi']);
let t = 0, frames = 0;
const tEnd = Number(q.get('t') || 3);
function frame() {
  const dt = 1 / 30; t += dt; S.t = t;
  if (fire) for (const sct of build.sections) for (const p of sct.slots) if (p && WEAPONS[p.id] && Math.random() < dt * 1.2) fireLog.set(p.uid, t);
  if (q.get('sway') === '1' && S.P) S.P.x = x + Math.sin(t * 0.8) * 120;
  eng.render({ dt, t, S, V, showPlayer: !ghost });
  frames++;
  if (t >= tEnd && document.title !== 'ready') document.title = 'ready';
  requestAnimationFrame(frame);
}
void layer;
frame();
