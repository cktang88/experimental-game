// Procedural puff atlas, baked once on the GPU at load: 16 frames (4x4) of a billowing, self-lit
// cloud evolving through 3D simplex noise. Fire and smoke sprites play through the frames over their
// life (blending neighbours), so every fireball rolls and every smoke puff churns without a single
// image file. Channels: R density, G lighting (moon from the upper left), B inner heat detail.
import * as THREE from 'three';

const NOISE = /* glsl */`
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.0-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;vec4 s1=floor(b1)*2.0+1.0;vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p){float a=0.5,s=0.0;for(int i=0;i<5;i++){s+=a*snoise(p);p=p*2.03+vec3(1.7,9.2,3.1);a*=0.5;}return s;}
`;

const FS = /* glsl */`
varying vec2 vUv;
${NOISE}
float dens(vec2 p, float t){
  float r = length(p);
  // Big billows, then fine turbulence, both evolving with t.
  float big = fbm(vec3(p * 1.6, t));
  float fine = fbm(vec3(p * 4.5 + 7.0, t * 1.7));
  float edge = r + (big * 0.55 + fine * 0.18) * (0.55 + r * 0.6);
  return smoothstep(0.92, 0.42, edge);
}
void main(){
  vec2 cell = floor(vUv * 4.0), uv = fract(vUv * 4.0);
  float frame = cell.y * 4.0 + cell.x;
  float t = frame * 0.11;
  vec2 p = uv * 2.0 - 1.0;
  float d = dens(p, t) * smoothstep(1.0, 0.82, length(p));
  // Self-lighting from the gradient of a soft height field.
  float e = 0.03;
  float dx = dens(p + vec2(e, 0.0), t) - dens(p - vec2(e, 0.0), t);
  float dy = dens(p + vec2(0.0, e), t) - dens(p - vec2(0.0, e), t);
  vec3 n = normalize(vec3(-dx, -dy, 0.12 + d * 0.25));
  float lit = clamp(dot(n, normalize(vec3(-0.55, -0.6, 0.6))) * 0.6 + 0.45 + d * 0.15, 0.0, 1.0);
  float core = clamp(smoothstep(0.75, 0.0, length(p)) * (0.6 + 0.6 * fbm(vec3(p * 3.0 - 3.0, t * 2.0))), 0.0, 1.0);
  gl_FragColor = vec4(d, lit, core, 1.0);
}`;

export function bakePuffAtlas(renderer: THREE.WebGLRenderer, size: number): THREE.Texture {
  const rt = new THREE.WebGLRenderTarget(size, size, { depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
  const mat = new THREE.ShaderMaterial({ vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: FS, depthTest: false, depthWrite: false });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  const scene = new THREE.Scene(); scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prev = renderer.getRenderTarget(), tm = renderer.toneMapping;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setRenderTarget(rt); renderer.render(scene, cam); renderer.setRenderTarget(prev);
  renderer.toneMapping = tm;
  mat.dispose(); quad.geometry.dispose();
  return rt.texture;
}
