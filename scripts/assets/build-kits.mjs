// Builds web-ready asset kits from the raw CC0 source packs.
//
// Each source pack (many .gltf files sharing textures) becomes ONE .glb in public/assets/kits/,
// with every model as a named top-level node, deduplicated textures resized and converted to WebP,
// and meshopt-compressed geometry. Run `node scripts/assets/fetch-sources.mjs` first.
//
//   node scripts/assets/build-kits.mjs [kitName ...]
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { mergeDocuments, dedup, prune, textureCompress, meshopt, unpartition, weld, flatten } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

const CACHE = process.env.ASSET_CACHE || '/home/user/asset-cache';
const OUT = path.resolve('public/assets/kits');

/** Each kit: a source folder of .gltf files and an optional name filter. */
export const KITS = {
  city: {
    dir: 'q-downtown/Exports/glTF (Godot)',
    // Whole buildings, streets, sidewalks, roofs and props. Interior-only pieces are skipped.
    include: (n) => !/Interior|DoorFrame|Door_|Stairs_|Decal_Only/.test(n),
    textureSize: 1024,
  },
  scifi: {
    dir: 'q-scifi/Modular SciFi MegaKit[Standard]/glTF',
    recursive: true,
    include: (n) => !/Alien/.test(n),
    textureSize: 1024,
  },
  // Enemy units: run `node scripts/assets/prep-units.mjs` first (re-encodes several CC0 packs).
  units: {
    dir: 'units-src',
    include: () => true,
    // Units are articulated (turret heads, rotors, wheels): keep each model's node hierarchy.
    keepHierarchy: true,
    textureSize: 1024,
  },
};

function listGltf(dir, recursive) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && recursive) out.push(...listGltf(p, true));
    else if (/\.gltf$/i.test(e.name)) out.push(p);
  }
  return out.sort();
}

async function buildKit(name, kit) {
  await MeshoptEncoder.ready; await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
  const src = path.join(CACHE, kit.dir);
  const files = listGltf(src, kit.recursive).filter((f) => kit.include(path.basename(f, '.gltf')));
  if (!files.length) throw new Error(`no source files for ${name} in ${src}`);
  const doc = new Document();
  const scene = doc.createScene(name);
  doc.getRoot().setDefaultScene(scene);
  for (const f of files) {
    let part;
    try { part = await io.read(f); } catch (e) { console.warn(`  skip ${path.basename(f)}: ${e.code || e.message}`); continue; }
    const map = mergeDocuments(doc, part);
    const id = path.basename(f, '.gltf');
    // Wrap each model's roots under one named node so the game can find it by file name.
    const holder = doc.createNode(id);
    for (const s of part.getRoot().listScenes()) {
      const ms = map.get(s);
      for (const child of ms.listChildren()) { ms.removeChild(child); holder.addChild(child); }
      ms.dispose();
    }
    scene.addChild(holder);
  }
  await doc.transform(
    unpartition(),
    dedup(),
    ...(kit.keepHierarchy ? [] : [flatten()]),
    weld(),
    prune({ keepLeaves: true }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [kit.textureSize, kit.textureSize], quality: 82 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `${name}.glb`);
  await io.write(file, doc);
  const nodes = scene.listChildren().map((n) => n.getName());
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ kit: name, models: nodes }, null, 1));
  console.log(`${name}: ${files.length} models -> ${path.relative(process.cwd(), file)} (${(fs.statSync(file).size / 1e6).toFixed(1)} MB)`);
}

const want = process.argv.slice(2);
for (const [name, kit] of Object.entries(KITS)) if (!want.length || want.includes(name)) await buildKit(name, kit);
