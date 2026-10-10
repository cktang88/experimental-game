// Running lights: thousands of tiny emissive points along every deck edge, window strip and mast.
// One THREE.Points per ship, animated entirely in the shader (blink, chase, flicker), so the CPU
// never touches them after the build.
import * as THREE from 'three';

export const enum LMode { Steady = 0, Strobe = 1, Chase = 2, Flicker = 3, Beacon = 4 }

export class LightSet {
  p: number[] = []; c: number[] = []; s: number[] = []; ph: number[] = []; md: number[] = [];
  private col = new THREE.Color();
  get count() { return this.s.length; }
  add(x: number, y: number, z: number, hex: string, k: number, size: number, mode: LMode = LMode.Steady, phase = Math.random()) {
    this.col.set(hex);
    this.p.push(x, y, z); this.c.push(this.col.r * k, this.col.g * k, this.col.b * k); this.s.push(size); this.ph.push(phase); this.md.push(mode);
  }
  /** A row of lights from a to b every `step`, with a fraction `fill` lit (rest skipped, like dark cabins). */
  row(a: [number, number, number], b: [number, number, number], step: number, hex: string, k: number, size: number, fill = 1, mode: LMode = LMode.Steady, rnd: () => number = Math.random) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), n = Math.max(1, Math.floor(L / step));
    for (let i = 0; i <= n; i++) {
      if (fill < 1 && rnd() > fill) continue;
      const t = i / n;
      this.add(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, hex, k * (0.75 + rnd() * 0.5), size, mode, mode === LMode.Chase ? t : rnd());
    }
  }
  points(mat: THREE.ShaderMaterial) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('aCol', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(this.s, 1));
    g.setAttribute('aPh', new THREE.Float32BufferAttribute(this.ph, 1));
    g.setAttribute('aMode', new THREE.Float32BufferAttribute(this.md, 1));
    g.computeBoundingSphere();
    const pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.renderOrder = 3; pts.userData.own = true;
    return pts;
  }
}

/** Shared uniforms: time, pixels per world unit at distance 1, ghost flicker. */
export const lightUniforms = { uTime: { value: 0 }, uPx: { value: 900 }, uFlick: { value: 1 } };

export function lightMaterial(hostile: boolean) {
  return new THREE.ShaderMaterial({
    // uDmg 0..1: battle damage knocks out a growing share of the steady lights (dark, burnt-out sections).
    uniforms: { ...lightUniforms, uFlick: hostile ? lightUniforms.uFlick : { value: 1 }, uDmg: { value: 0 } },
    vertexShader: `attribute vec3 aCol;attribute float aSize;attribute float aPh;attribute float aMode;
      uniform float uTime;uniform float uPx;uniform float uDmg;varying vec3 vCol;varying float vA;
      void main(){vec4 mv=modelViewMatrix*vec4(position,1.0);gl_Position=projectionMatrix*mv;
        // modelViewMatrix carries the ship scale: grow lights with it.
        float sc=length(modelViewMatrix[0].xyz);
        float px=aSize*sc*uPx/max(1.0,-mv.z);
        float a=1.0;
        if(aMode>0.5&&aMode<1.5){float t=fract(uTime*0.7+aPh);a=step(t,0.06)*2.5;}
        else if(aMode>1.5&&aMode<2.5){float t=fract(uTime*0.9-aPh);a=0.25+1.6*pow(max(0.0,1.0-t*5.0),2.0);}
        else if(aMode>2.5&&aMode<3.5){a=0.75+0.25*sin(uTime*(3.0+aPh*9.0)+aPh*40.0);}
        else if(aMode>3.5){a=0.35+0.65*pow(0.5+0.5*sin(uTime*3.2+aPh*6.28),3.0);}
        if(aMode<0.5){float k=fract(aPh*7.31+position.x*0.013+position.z*0.017);
          if(k<uDmg){float f=fract(sin(floor(uTime*9.0)+aPh*91.0)*43758.5);a*=step(0.93,f)*1.5;}}
        vA=a*min(1.0,px/1.3);gl_PointSize=max(1.3,px);vCol=aCol;}`,
    fragmentShader: `uniform float uFlick;varying vec3 vCol;varying float vA;
      void main(){vec2 p=gl_PointCoord*2.0-1.0;float d=dot(p,p);if(d>1.0)discard;
        float a=pow(1.0-d,1.5)*vA*uFlick;gl_FragColor=vec4(vCol*a,1.0);}`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  });
}
