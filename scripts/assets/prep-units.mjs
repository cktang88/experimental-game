// Prepares the enemy-unit sources for build-kits.mjs (kit "units").
//
// Every unit model, whatever pack it came from, is converted to ONE encoding so a single livery
// shader (src/render/units/livery.ts) can paint them all in the same military night style:
//
//   colour.r = luminance (panel detail, grime, edge wear)
//   colour.g = paint mask (1 = livery paint: olive drab / desert / charcoal, 0 = bare gunmetal)
//   colour.b = light mask (1 = lit window / lamp, drawn emissive)
//
// Quaternius spaceships keep their painted texture (re-encoded as above, plus a normal map derived
// from it). Kenney models are flat-coloured, so the encoding is baked into vertex colours.
// The Quaternius sci-fi trim sheet's grunge layer is carried along as the shared detail texture.
//
//   node scripts/assets/prep-units.mjs && node scripts/assets/build-kits.mjs units
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const CACHE = process.env.ASSET_CACHE || '/home/user/asset-cache';
const OUT = path.join(CACHE, 'units-src');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

/** Quaternius Ultimate Spaceships (CC0): name -> texture variant. */
const SHIPS = { Omen: 'Orange', Bob: 'Orange', Zenith: 'Red', Spitfire: 'Red', Challenger: 'Green', Executioner: 'Blue', Imperial: 'Red' };
const SPACE = `${CACHE}/kenney_space-kit/Models/GLTF format`;
const CAR = `${CACHE}/kenney_car-kit/Models/GLB format`;
/** Kenney models (CC0): output name -> source file. */
const KENNEY = {
  K_TurretDouble: `${SPACE}/turret_double.glb`, K_HangarRoundGlass: `${SPACE}/hangar_roundGlass.glb`,
  K_TruckFlat: `${CAR}/truck-flat.glb`,
  K_DebrisPlateA: `${CAR}/debris-plate-a.glb`, K_DebrisDrivetrain: `${CAR}/debris-drivetrain.glb`, K_DebrisTire: `${CAR}/debris-tire.glb`, K_DebrisDoor: `${CAR}/debris-door.glb`,
};
/** Kenney space-kit named materials -> [luminance, paint, light]. */
const NAMED = { dark: [0.3, 0, 0], metal: [0.8, 0, 0], metalDark: [0.6, 0, 0], metalRed: [0.75, 1, 0], _defaultMat: [0.85, 0, 0], glass: [0.5, 0, 1], window: [0.5, 0, 1] };

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** Classifies one sRGB colour (0..1) into the unit encoding. */
function encode(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), s = mx > 0.001 ? (mx - mn) / mx : 0;
  const paint = smooth(0.2, 0.42, s) * smooth(0.08, 0.2, mx);
  const lum = paint > 0.5 ? mx : 0.3 * r + 0.55 * g + 0.15 * b;
  return [lum, paint, 0];
}

/** Kenney colormaps are flat toy colours: bodies become livery paint, glass goes dark, dark parts stay metal. */
function encodeKenney(r, g, b) {
  const lum = 0.3 * r + 0.55 * g + 0.15 * b;
  if (b > r + 0.12 && b > g) return [0.22, 0, 0];
  if (lum < 0.25) return [Math.min(0.4, lum * 1.4), 0, 0];
  return [Math.min(0.85, lum), smooth(0.33, 0.5, lum), 0];
}

function parseObj(file) {
  const v = [], vt = [], vn = [], P = [], N = [], U = [], map = new Map(), idx = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const p = line.trim().split(/\s+/);
    if (p[0] === 'v') v.push(p.slice(1, 4).map(Number));
    else if (p[0] === 'vt') vt.push(p.slice(1, 3).map(Number));
    else if (p[0] === 'vn') vn.push(p.slice(1, 4).map(Number));
    else if (p[0] === 'f') {
      const ids = p.slice(1).map((k) => {
        let i = map.get(k); if (i !== undefined) return i;
        const [a, b, c] = k.split('/').map((x) => (x ? Number(x) - 1 : -1));
        i = P.length / 3; map.set(k, i);
        P.push(...v[a]); U.push(...(b >= 0 ? [vt[b][0], 1 - vt[b][1]] : [0, 0])); N.push(...(c >= 0 ? vn[c] : [0, 1, 0]));
        return i;
      });
      for (let i = 1; i + 1 < ids.length; i++) idx.push(ids[0], ids[i], ids[i + 1]);
    }
  }
  return { P: new Float32Array(P), N: new Float32Array(N), U: new Float32Array(U), I: new Uint32Array(idx) };
}

async function shipTextures(file) {
  const { data, info } = await sharp(file).resize(1024, 1024).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height, enc = Buffer.alloc(n * 3), lumF = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const [l, p] = encode(data[i * 3] / 255, data[i * 3 + 1] / 255, data[i * 3 + 2] / 255);
    enc[i * 3] = Math.round(l * 255); enc[i * 3 + 1] = Math.round(p * 255); enc[i * 3 + 2] = 0; lumF[i] = l;
  }
  // Normal map from luminance: painted seams and panel edges catch the moonlight.
  const W = info.width, H = info.height, nrm = Buffer.alloc(n * 3), k = 2.2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const at = (xx, yy) => lumF[Math.min(H - 1, Math.max(0, yy)) * W + Math.min(W - 1, Math.max(0, xx))];
    const dx = (at(x + 1, y) - at(x - 1, y)) * k, dy = (at(x, y + 1) - at(x, y - 1)) * k, l = Math.hypot(dx, dy, 1), i = (y * W + x) * 3;
    nrm[i] = Math.round((-dx / l * 0.5 + 0.5) * 255); nrm[i + 1] = Math.round((dy / l * 0.5 + 0.5) * 255); nrm[i + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
  }
  const color = await sharp(enc, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
  const normal = await sharp(nrm, { raw: { width: W, height: H, channels: 3 } }).resize(512, 512).png().toBuffer();
  return { color, normal };
}

async function writeShip(name, variant) {
  const dir = `${CACHE}/q-spaceships/${name}`;
  const o = parseObj(`${dir}/OBJ/${name}.obj`), tex = await shipTextures(`${dir}/Textures/${name}_${variant}.png`);
  const doc = new Document(), buf = doc.createBuffer();
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(o.P).setBuffer(buf))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(o.N).setBuffer(buf))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(o.U).setBuffer(buf))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(o.I).setBuffer(buf));
  const mat = doc.createMaterial('livery_tex')
    .setBaseColorTexture(doc.createTexture(`${name}_enc`).setImage(tex.color).setMimeType('image/png').setURI(`${name}_enc.png`))
    .setNormalTexture(doc.createTexture(`${name}_nrm`).setImage(tex.normal).setMimeType('image/png').setURI(`${name}_nrm.png`));
  prim.setMaterial(mat);
  const node = doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim));
  doc.createScene().addChild(node);
  await io.write(path.join(OUT, `Q_${name}.gltf`), doc);
}

async function writeKenney(name, file) {
  const doc = await io.read(file);
  const cache = new Map();
  const sampler = async (tex) => {
    if (cache.has(tex)) return cache.get(tex);
    const { data, info } = await sharp(Buffer.from(tex.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const f = (u, v) => { const x = Math.min(info.width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * info.width))), y = Math.min(info.height - 1, Math.max(0, Math.floor((v - Math.floor(v)) * info.height))), i = (y * info.width + x) * 3; return [data[i] / 255, data[i + 1] / 255, data[i + 2] / 255]; };
    cache.set(tex, f); return f;
  };
  const mat = doc.createMaterial('livery_vc');
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const m = prim.getMaterial(), pos = prim.getAttribute('POSITION'), n = pos.getCount(), col = new Float32Array(n * 3);
    const tex = m?.getBaseColorTexture(), uv = prim.getAttribute('TEXCOORD_0');
    if (tex && uv) {
      const f = await sampler(tex), t = [0, 0];
      for (let i = 0; i < n; i++) { uv.getElement(i, t); const c = f(t[0], t[1]); col.set(encodeKenney(...c), i * 3); }
    } else {
      const nm = m?.getName() || '', fixed = NAMED[nm];
      const e = fixed || encode(...(m ? m.getBaseColorFactor().slice(0, 3).map((c) => Math.pow(c, 1 / 2.2)) : [0.5, 0.5, 0.5]));
      for (let i = 0; i < n; i++) col.set(e, i * 3);
    }
    prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(col).setBuffer(pos.getBuffer()));
    prim.setAttribute('TEXCOORD_0', null);
    prim.setMaterial(mat);
  }
  for (const m of doc.getRoot().listMaterials()) if (m !== mat) m.dispose();
  for (const t of doc.getRoot().listTextures()) t.dispose();
  // Collapse the scene under one node named after the model.
  const scene = doc.getRoot().listScenes()[0], holder = doc.createNode(name);
  for (const c of scene.listChildren()) { scene.removeChild(c); holder.addChild(c); }
  scene.addChild(holder);
  await io.write(path.join(OUT, `${name}.gltf`), doc);
}

/** Shared detail textures: the sci-fi trim sheet's grunge layer, carried on a stub node. */
async function writeDetail() {
  const T = `${CACHE}/q-scifi/Modular SciFi MegaKit[Standard]/Textures`;
  const doc = new Document(), buf = doc.createBuffer();
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1])).setBuffer(buf))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array([0, 0, 1, 0, 0, 1])).setBuffer(buf));
  const img = async (f, s) => sharp(`${T}/${f}`).resize(s, s).png().toBuffer();
  prim.setMaterial(doc.createMaterial('trim_detail')
    .setBaseColorTexture(doc.createTexture('grunge').setURI('_grunge.png').setImage(await img('T_Trim_03_BaseColor.png', 512)).setMimeType('image/png'))
    .setNormalTexture(doc.createTexture('grunge_n').setURI('_grunge_n.png').setImage(await img('T_Trim_03_Normal.png', 512)).setMimeType('image/png'))
    .setOcclusionTexture(doc.createTexture('panels').setURI('_panels.png').setImage(await img('T_Trim_02_Normal.png', 512)).setMimeType('image/png')));
  doc.createScene().addChild(doc.createNode('_Detail').setMesh(doc.createMesh('_Detail').addPrimitive(prim)));
  await io.write(path.join(OUT, '_Detail.gltf'), doc);
}

fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const only = process.argv[2] ? new RegExp(process.argv[2]) : null;
for (const [n, v] of Object.entries(SHIPS)) if (!only || only.test(n)) { await writeShip(n, v); console.log('ship', n); }
for (const [n, f] of Object.entries(KENNEY)) if (!only || only.test(n)) { await writeKenney(n, f); console.log('kenney', n); }
await writeDetail();
console.log(`units sources -> ${OUT}`);
