// Packs the Quaternius Downtown PBR textures into one atlas for the procedural city shaders.
//
//   node scripts/assets/build-citytex.mjs
//
// Output: public/assets/textures/city-atlas.webp, 4x2 tiles of 512 px. RGB = base color,
// A = roughness (from the ORM map where the pack has one). Tile order is mirrored in
// src/render/world/materials.ts (ATLAS).
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const CACHE = process.env.ASSET_CACHE || '/home/user/asset-cache';
const SRC = path.join(CACHE, 'q-downtown/Textures');
const OUT = path.resolve('public/assets/textures');
const T = 512;
const TILES = [
  ['T_RedBrick_BaseColor.png', 'T_RedBrick_ORM.png'],
  ['T_Concrete_BaseColor.png', 'T_Concrete_ORM.png'],
  ['T_MetalConcrete_BaseColor.png', 'T_MetalConcrete_ORM.png'],
  ['T_Concrete_Asphalt_BaseColor.png', null],
  ['T_Dirt_BaseColor.png', 'T_Dirt_ORM.png'],
  ['T_RoofSlate_BaseColor.png', 'T_RoofSlate_ORM.png'],
  ['T_Noise_Drips.png', null],
  ['T_Trim_BaseColor.png', 'T_Trim_ORM.png'],
];

const atlas = Buffer.alloc(T * 4 * T * 2 * 4);
for (let i = 0; i < TILES.length; i++) {
  const [base, orm] = TILES[i];
  const rgb = await sharp(path.join(SRC, base)).removeAlpha().resize(T, T).raw().toBuffer();
  const rough = orm ? await sharp(path.join(SRC, orm)).removeAlpha().resize(T, T).extractChannel(1).raw().toBuffer() : null;
  const ox = (i % 4) * T, oy = Math.floor(i / 4) * T;
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    const s = y * T + x, d = ((oy + y) * T * 4 + ox + x) * 4;
    atlas[d] = rgb[s * 3]; atlas[d + 1] = rgb[s * 3 + 1]; atlas[d + 2] = rgb[s * 3 + 2];
    atlas[d + 3] = rough ? rough[s] : 230;
  }
}
fs.mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, 'city-atlas.webp');
await sharp(atlas, { raw: { width: T * 4, height: T * 2, channels: 4 } }).webp({ quality: 84, alphaQuality: 70 }).toFile(file);
console.log(`${path.relative(process.cwd(), file)} (${(fs.statSync(file).size / 1e6).toFixed(2)} MB)`);
