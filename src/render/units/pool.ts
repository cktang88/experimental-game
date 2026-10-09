// Instanced pools: every unit part is drawn through one InstancedMesh per (geometry, material).
// Each frame: begin(), push(matrix, flash, burn) per visible instance, end(). No per-frame allocation.
import * as THREE from 'three';

export class InstPool {
  mesh: THREE.InstancedMesh; n = 0; private fx: THREE.InstancedBufferAttribute; private fxa: Float32Array;
  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, public cap: number, shadow = true) {
    // Share the source attributes; only the per-instance ones are owned by this pool.
    const g = new THREE.BufferGeometry();
    if (geo.index) g.setIndex(geo.index);
    for (const k of Object.keys(geo.attributes)) g.setAttribute(k, geo.attributes[k]);
    this.fxa = new Float32Array(cap * 2);
    this.fx = new THREE.InstancedBufferAttribute(this.fxa, 2); this.fx.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aFx', this.fx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.mesh = new THREE.InstancedMesh(g, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; this.mesh.castShadow = shadow; this.mesh.receiveShadow = shadow;
    this.mesh.count = 0;
  }
  begin() { this.n = 0; }
  push(m: THREE.Matrix4, flash = 0, burn = 0) {
    if (this.n >= this.cap) return;
    const i = this.n++;
    m.toArray(this.mesh.instanceMatrix.array as Float32Array, i * 16);
    this.fxa[i * 2] = flash; this.fxa[i * 2 + 1] = burn;
  }
  end() {
    this.mesh.count = this.n;
    if (this.n) { this.mesh.instanceMatrix.clearUpdateRanges(); this.mesh.instanceMatrix.addUpdateRange(0, this.n * 16); this.mesh.instanceMatrix.needsUpdate = true; this.fx.clearUpdateRanges(); this.fx.addUpdateRange(0, this.n * 2); this.fx.needsUpdate = true; }
  }
}
