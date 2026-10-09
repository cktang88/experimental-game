// Units kit loader: public/assets/kits/units.glb (built by scripts/assets/prep-units.mjs + build-kits.mjs).
// Each top-level node is a model. A model becomes a list of PARTS: geometry baked to the model's
// root frame, one part per material, grouped by the named child node they hang from (so a turret
// head or a wheel can be animated separately).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface KitPart { node: string; geo: THREE.BufferGeometry; map: THREE.Texture | null; normalMap: THREE.Texture | null; pivot: THREE.Vector3 }
export interface KitModel { name: string; parts: KitPart[]; box: THREE.Box3 }
export interface Detail { grunge: THREE.Texture; grungeN: THREE.Texture; panels: THREE.Texture }

const models = new Map<string, KitModel>();
let detail: Detail | null = null;
let loading: Promise<void> | null = null;

export const unitsKitReady = () => models.size > 0;
export const kitModel = (n: string) => models.get(n) ?? null;
export const kitDetail = () => detail;

/** Starts (once) loading the units kit. Resolves when templates are ready; never rejects. */
export function loadUnitsKit(): Promise<void> {
  if (loading) return loading;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  loading = loader.loadAsync(`${import.meta.env.BASE_URL}assets/kits/units.glb`).then((gltf) => {
    for (const root of [...gltf.scene.children]) {
      if (root.name === '_Detail') {
        const m = (root.getObjectByProperty('isMesh', true) as THREE.Mesh).material as THREE.MeshStandardMaterial;
        const prep = (t: THREE.Texture | null) => { t!.wrapS = t!.wrapT = THREE.RepeatWrapping; t!.colorSpace = THREE.NoColorSpace; t!.needsUpdate = true; return t!; };
        detail = { grunge: prep(m.map), grungeN: prep(m.normalMap), panels: prep(m.aoMap) };
        continue;
      }
      models.set(root.name, bake(root));
    }
  }).catch((e) => { console.warn('units kit failed to load', e); });
  return loading;
}

/** Bakes a model: every mesh into the root frame, grouped by its top-level child (the "node"). */
function bake(root: THREE.Object3D): KitModel {
  root.position.set(0, 0, 0); root.rotation.set(0, 0, 0); root.scale.set(1, 1, 1);
  root.updateMatrixWorld(true);
  const groups = new Map<string, { geos: THREE.BufferGeometry[]; map: THREE.Texture | null; normalMap: THREE.Texture | null; pivot: THREE.Vector3 }>();
  const box = new THREE.Box3();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh; if (!mesh.isMesh) return;
    // The animated "node" is the second level under the model (a turret on its mount, a wheel on a body).
    const chain: THREE.Object3D[] = []; for (let o2: THREE.Object3D | null = mesh; o2 && o2 !== root; o2 = o2.parent) chain.unshift(o2);
    const top = chain.length >= 2 ? chain[1] : chain[0];
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const key = `${top.name}|${mat.map?.uuid ?? ''}`;
    let g = groups.get(key);
    if (!g) {
      const pivot = new THREE.Vector3().setFromMatrixPosition(top.matrixWorld);
      g = { geos: [], map: mat.map ?? null, normalMap: mat.normalMap ?? null, pivot }; groups.set(key, g);
    }
    const geo = mesh.geometry.clone();
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) geo.deleteAttribute(k);
    if (!geo.attributes.color) { const n = geo.attributes.position.count, c = new Float32Array(n * 3).fill(1); geo.setAttribute('color', new THREE.BufferAttribute(c, 3)); }
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    // Normalise attribute formats (meshopt may quantise) so geometries can be merged.
    for (const k of ['position', 'normal', 'uv', 'color']) {
      const a = geo.attributes[k] as THREE.BufferAttribute;
      if (!(a.array instanceof Float32Array) || a.normalized || (a as unknown as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) {
        const f = new Float32Array(a.count * a.itemSize);
        for (let i = 0; i < a.count; i++) for (let j = 0; j < a.itemSize; j++) f[i * a.itemSize + j] = (j === 0 ? a.getX(i) : j === 1 ? a.getY(i) : j === 2 ? a.getZ(i) : a.getW(i));
        geo.setAttribute(k, new THREE.BufferAttribute(f, a.itemSize));
      }
      if (k === 'color' && a.itemSize === 4) {
        const f = new Float32Array(a.count * 3); for (let i = 0; i < a.count; i++) { f[i * 3] = a.getX(i); f[i * 3 + 1] = a.getY(i); f[i * 3 + 2] = a.getZ(i); }
        geo.setAttribute('color', new THREE.BufferAttribute(f, 3));
      }
    }
    geo.applyMatrix4(mesh.matrixWorld);
    g.geos.push(geo);
    box.expandByObject(mesh);
  });
  const parts: KitPart[] = [];
  for (const [key, g] of groups) {
    const geos = g.geos, allIndexed = geos.every((x) => x.index), noneIndexed = geos.every((x) => !x.index);
    const list = allIndexed || noneIndexed ? geos : geos.map((x) => (x.index ? x.toNonIndexed() : x));
    const geo = list.length === 1 ? list[0] : mergeGeometries(list, false)!;
    parts.push({ node: key.split('|')[0], geo, map: g.map, normalMap: g.normalMap, pivot: g.pivot });
  }
  return { name: root.name, parts, box };
}
