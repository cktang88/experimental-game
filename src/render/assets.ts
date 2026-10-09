// Kit loader. Each kit is one .glb in /assets/kits/ whose top-level nodes are named models
// (see scripts/assets/build-kits.mjs). Call preloadKits() once at boot, then model() to clone.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

export type KitName = 'city' | 'scifi';
const kits = new Map<KitName, Map<string, THREE.Object3D>>();
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

export async function preloadKits(names: KitName[], onProgress?: (done: number, total: number) => void) {
  let done = 0;
  await Promise.all(names.map(async (n) => {
    if (kits.has(n)) { onProgress?.(++done, names.length); return; }
    const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}assets/kits/${n}.glb`);
    const map = new Map<string, THREE.Object3D>();
    for (const c of [...gltf.scene.children]) map.set(c.name, c);
    kits.set(n, map);
    onProgress?.(++done, names.length);
  }));
}
export const kitLoaded = (n: KitName) => kits.has(n);
export function modelNames(kit: KitName): string[] { return [...(kits.get(kit)?.keys() ?? [])]; }
/** The shared source object (do not mutate). Use model() for an instance. */
export function source(kit: KitName, name: string): THREE.Object3D | null { return kits.get(kit)?.get(name) ?? null; }
/** A clone sharing geometry and materials with the source. */
export function model(kit: KitName, name: string): THREE.Object3D | null {
  const s = source(kit, name); if (!s) return null;
  const c = s.clone(true); c.position.set(0, 0, 0); return c;
}
/** All meshes in a model with their world matrices relative to the model root (for merging/instancing). */
export function meshesOf(obj: THREE.Object3D): { mesh: THREE.Mesh; matrix: THREE.Matrix4 }[] {
  obj.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
  const out: { mesh: THREE.Mesh; matrix: THREE.Matrix4 }[] = [];
  obj.traverse((o) => { if ((o as THREE.Mesh).isMesh) out.push({ mesh: o as THREE.Mesh, matrix: new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld) }); });
  return out;
}
