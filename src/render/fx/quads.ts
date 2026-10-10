// Instanced flat quads: the workhorse for glows, streaks, rings, smoke and decals.
// One draw call per batch. Quads lie in the XZ plane (the camera looks down), rotated about Y.
import * as THREE from 'three';

/** Bracket: four corner marks of a square (target brackets on hostile ground units). */
export const enum Shape { Hot = 0, Soft = 1, Ring = 2, Streak = 3, Bracket = 4 }
export const enum DarkShape { Soft = 0, Rect = 1, Ring = 2 }

const VS = `attribute vec3 aPos;attribute vec3 aRs;attribute vec4 aCol;attribute float aShp;
varying vec2 vUv;varying vec4 vCol;varying float vShp;
void main(){vUv=uv;vCol=aCol;vShp=aShp;
  vec2 p=vec2(position.x*aRs.y,position.z*aRs.z);float c=cos(aRs.x),s=sin(aRs.x);
  vec3 w=vec3(aPos.x+p.x*c-p.y*s,aPos.y,aPos.z+p.x*s+p.y*c);
  gl_Position=projectionMatrix*viewMatrix*vec4(w,1.0);}`;
const GLOW_FS = `varying vec2 vUv;varying vec4 vCol;varying float vShp;
void main(){vec2 p=vUv*2.0-1.0;float d=length(p);vec3 col=vCol.rgb;float a=0.0;
  if(vShp<0.5){a=pow(max(0.0,1.0-d),1.5);col=mix(col,vec3(1.0),pow(max(0.0,1.0-d*2.4),2.0));}
  else if(vShp<1.5){a=pow(max(0.0,1.0-d),2.2);}
  else if(vShp<2.5){a=smoothstep(0.62,0.86,d)*(1.0-smoothstep(0.86,1.0,d));}
  else if(vShp<3.5){float ay=abs(p.y),ax=abs(p.x);a=pow(max(0.0,1.0-ay),1.8)*(1.0-smoothstep(0.55,1.0,ax));
    col=mix(col,vec3(1.0),pow(max(0.0,1.0-ay*2.2),3.0)*(1.0-smoothstep(0.3,1.0,ax))*0.9);}
  else{vec2 q=abs(p);float m=max(q.x,q.y);a=smoothstep(0.8,0.87,m)*(1.0-smoothstep(0.95,1.0,m))*step(0.55,min(q.x,q.y));}
  gl_FragColor=vec4(col*a*vCol.a*2.2,1.0);}`;
const DARK_FS = `varying vec2 vUv;varying vec4 vCol;varying float vShp;
void main(){vec2 p=vUv*2.0-1.0;float d=length(p);float a;
  if(vShp<0.5)a=pow(max(0.0,1.0-d),1.4);
  else if(vShp<1.5){vec2 q=abs(p);a=1.0-smoothstep(0.86,1.0,max(q.x,q.y));}
  else a=smoothstep(0.7,0.85,d)*(1.0-smoothstep(0.9,1.0,d));
  gl_FragColor=vec4(vCol.rgb,a*vCol.a);}`;

const C3 = new Map<string, [number, number, number]>();
/** Hex color to linear RGB (cached). */
export function rgb(h: string) { let v = C3.get(h); if (!v) { const c = new THREE.Color(h); v = [c.r, c.g, c.b]; C3.set(h, v); } return v; }

export class QuadBatch {
  g = new THREE.InstancedBufferGeometry(); n = 0; mesh: THREE.Mesh;
  private pos: Float32Array; private rs: Float32Array; private col: Float32Array; private shp: Float32Array; private attrs: THREE.InstancedBufferAttribute[];
  static glow(max: number) { return new QuadBatch(max, new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: GLOW_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }), 3); }
  static dark(max: number) { return new QuadBatch(max, new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: DARK_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide }), 2); }
  constructor(public max: number, material: THREE.Material, order: number) {
    const g = this.g;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5]), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    g.setIndex([0, 2, 1, 0, 3, 2]);
    this.pos = new Float32Array(max * 3); this.rs = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.shp = new Float32Array(max);
    const add = (n: string, arr: Float32Array, sz: number) => { const a = new THREE.InstancedBufferAttribute(arr, sz); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(n, a); return a; };
    this.attrs = [add('aPos', this.pos, 3), add('aRs', this.rs, 3), add('aCol', this.col, 4), add('aShp', this.shp, 1)];
    g.instanceCount = 0;
    this.mesh = new THREE.Mesh(g, material); this.mesh.frustumCulled = false; this.mesh.renderOrder = order;
  }
  begin() { this.n = 0; }
  /** Add a quad at world (x, y, z), rotated by rot about Y, len along its axis and wid across. */
  add(x: number, y: number, z: number, rot: number, len: number, wid: number, c: readonly number[], a: number, shape: number) {
    if (this.n >= this.max || !(a > 0.004)) return;
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.rs[i * 3] = rot; this.rs[i * 3 + 1] = len; this.rs[i * 3 + 2] = wid;
    this.col[i * 4] = c[0]; this.col[i * 4 + 1] = c[1]; this.col[i * 4 + 2] = c[2]; this.col[i * 4 + 3] = Math.min(1.5, a);
    this.shp[i] = shape;
  }
  flush() { this.g.instanceCount = this.n; for (const a of this.attrs) a.needsUpdate = true; }
}
