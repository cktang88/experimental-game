// The post chain (pmndrs postprocessing):
//   RenderPass (HDR, half float)
//   -> N8AO ambient occlusion (high tier): contact shadows under the ship, the city blocks and the units
//   -> Distort: screen-space refraction from DistortBatch (shockwaves, heat haze, rail channels) plus a
//      chromatic split that pulses on big hits and follows the strongest bends
//   -> Bloom (mipmap blur) on HDR emissives only: the threshold is on 0.5*(luma+maxRGB), so hostile reds
//      bloom as well as white-hot cores, while lit matte surfaces stay below it
//   -> ACES filmic tone map -> per-sector colour grade, slow-time desaturation, vignette and film grain
//   -> SMAA
// Quality tiers: 'high' (AO, SMAA high, full bloom, half-res distortion) and 'low' (no AO, SMAA low,
// half-res bloom, quarter-res distortion, smaller particle budget). See setQuality().
import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, SMAAEffect, SMAAPreset, EdgeDetectionMode,
  ToneMappingEffect, ToneMappingMode, Effect, EffectAttribute, BlendFunction,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { DistortBatch } from './distort';
import { V } from '../../game/vfx';
import { THEMES } from '../palette';

export type Quality = 'high' | 'low';

const DISTORT_FS = /* glsl */`
uniform sampler2D distMap; uniform float strength; uniform float ca;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor){
  vec2 off = texture2D(distMap, uv).xy * strength;
  vec2 duv = uv + off;
  vec2 dir = uv - 0.5;
  vec2 o = dir * ca * 0.016 * (0.35 + dot(dir, dir) * 2.5) + off * 0.35;
  vec4 c = texture2D(inputBuffer, duv);
  float r = texture2D(inputBuffer, duv + o).r;
  float b = texture2D(inputBuffer, duv - o).b;
  outputColor = vec4(r, c.g, b, c.a);
}`;
class DistortEffect extends Effect {
  constructor(map: THREE.Texture) {
    super('DistortEffect', DISTORT_FS, {
      attributes: EffectAttribute.CONVOLUTION, blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, THREE.Uniform>([['distMap', new THREE.Uniform(map)], ['strength', new THREE.Uniform(1)], ['ca', new THREE.Uniform(0)]]),
    });
  }
}

const GRADE_FS = /* glsl */`
uniform vec3 lift; uniform vec3 gain; uniform float gam; uniform float sat; uniform float slow;
uniform float vig; uniform vec3 vigCol; uniform float bars; uniform float grain; uniform float seed; uniform float expo;
float gdHash(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor){
  vec3 c = inputColor.rgb * expo;
  c = max(c * gain + lift * (1.0 - c), 0.0);
  c = pow(c, vec3(1.0 / gam));
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(mix(vec3(l), c, sat), 0.0);
  // Slow time: drain the world toward cold monochrome, keep hot light (fire, plasma, hostile red).
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
  float keep = smoothstep(0.12, 0.45, mx - mn) * smoothstep(0.18, 0.6, mx);
  vec3 mono = vec3(l) * vec3(0.8, 0.93, 1.12) * 0.9;
  c = mix(c, mix(mono, c * 1.1, keep), slow);
  // Vignette: an oval falloff toward the frame edge, toward the night colour.
  vec2 q = (uv - 0.5) * vec2(1.0, 0.82);
  float v = smoothstep(0.22, 0.72, length(q));
  c = mix(c, c * vigCol, v * vig * (1.0 + slow * 0.9));
  // Cinematic letterbox during slow-mo.
  float bh = bars * 0.085;
  float inBar = (1.0 - smoothstep(bh - 0.004, bh, uv.y)) + (1.0 - smoothstep(bh - 0.004, bh, 1.0 - uv.y));
  c *= 1.0 - clamp(inBar, 0.0, 1.0);
  // Film grain in a perceptual space, weaker on bright areas.
  vec3 g = sqrt(c);
  float n = gdHash(floor(uv * resolution) + seed) - 0.5;
  g += n * grain * (1.0 - 0.7 * sqrt(l));
  outputColor = vec4(g * g, inputColor.a);
}`;
class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', GRADE_FS, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, THREE.Uniform>([
        ['lift', new THREE.Uniform(new THREE.Vector3())], ['gain', new THREE.Uniform(new THREE.Vector3(1, 1, 1))], ['gam', new THREE.Uniform(1)],
        ['sat', new THREE.Uniform(1)], ['slow', new THREE.Uniform(0)], ['vig', new THREE.Uniform(0.55)], ['vigCol', new THREE.Uniform(new THREE.Vector3(0.18, 0.2, 0.26))],
        ['grain', new THREE.Uniform(0.035)], ['bars', new THREE.Uniform(0)], ['seed', new THREE.Uniform(0)], ['expo', new THREE.Uniform(1)],
      ]),
    });
  }
}

/** Per-sector grades, indexed like THEMES. Lift tints the shadows, gain the highlights. */
const GRADES: { lift: [number, number, number]; gain: [number, number, number]; gam: number; sat: number }[] = [
  { lift: [0.0, 0.006, 0.016], gain: [1.02, 1.0, 0.96], gam: 1.0, sat: 1.06 }, // Ashport: cold shadows, sodium highlights
  { lift: [0.014, 0.006, 0.0], gain: [1.06, 0.99, 0.88], gam: 1.0, sat: 1.0 }, // Rust Flats: warm dust
  { lift: [0.0, 0.01, 0.022], gain: [0.94, 1.0, 1.08], gam: 1.02, sat: 0.9 }, // Glacier Yard: steel blue
  { lift: [0.01, 0.006, 0.006], gain: [1.03, 0.97, 0.94], gam: 0.98, sat: 0.82 }, // Ash Belt: grey ash
  { lift: [0.012, 0.0, 0.02], gain: [1.02, 0.95, 1.06], gam: 1.0, sat: 1.16 }, // Neon Sprawl
];

/** Auto-pick a tier: low on software GL, phones and very dense small screens. Overridable with ?quality= or localStorage gd.quality. */
export function softwareGL(gl: WebGLRenderingContext | WebGL2RenderingContext): boolean {
  let name = '';
  try { const ext = gl.getExtension('WEBGL_debug_renderer_info'); name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || ''); } catch { /* ignore */ }
  return /swiftshader|llvmpipe|software|basic render/i.test(name);
}
export function detectQuality(gl: WebGLRenderingContext | WebGL2RenderingContext): Quality {
  try {
    const q = new URLSearchParams(location.search).get('quality') || localStorage.getItem('gd.quality');
    if (q === 'high' || q === 'low') return q;
  } catch { /* ignore */ }
  let name = '';
  try { const ext = gl.getExtension('WEBGL_debug_renderer_info'); name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || ''); } catch { /* ignore */ }
  if (/swiftshader|llvmpipe|software|basic render|mali-[4t]|adreno \(tm\) [3-5]\d\d|powervr/i.test(name)) return 'low';
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer:coarse)').matches;
  if (coarse && (window.devicePixelRatio || 1) >= 2.5) return 'low';
  return 'high';
}

export class PostChain {
  composer: EffectComposer;
  render: RenderPass;
  ao: N8AOPostPass;
  bloom: BloomEffect;
  smaa: SMAAEffect;
  tone: ToneMappingEffect;
  distort: DistortBatch;
  private distortFx: DistortEffect;
  private grade: GradeEffect;
  private smaaPass: EffectPass;
  quality: Quality = 'high';
  /** Extra resolution scale on software rasterisers (they are fill-rate bound). */
  renderScale = 1;
  /** Smoothed slow-time grade; the renderer feeds hints (S.slow) through slowHint. */
  slowHint = 0;
  /** 0..1 cinematic intensity (S.slowFx): letterbox bars and a heavier vignette. */
  cinema = 0;
  private slow = 0; private bars = 0;
  private theme = 0;
  private cur = { lift: new THREE.Vector3(), gain: new THREE.Vector3(1, 1, 1), gam: 1, sat: 1 };
  private w = 1; private h = 1;

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
    this.render = new RenderPass(scene, camera);
    this.composer.addPass(this.render);
    this.ao = new N8AOPostPass(scene, camera, 512, 512);
    Object.assign(this.ao.configuration, { aoRadius: 60, distanceFalloff: 0.6, intensity: 2.2, halfRes: true, aoSamples: 12, denoiseSamples: 8, denoiseRadius: 10, gammaCorrection: false, color: new THREE.Color(0x05070a) });
    this.composer.addPass(this.ao);
    this.distort = new DistortBatch();
    this.distortFx = new DistortEffect(this.distort.target.texture);
    this.composer.addPass(new EffectPass(camera, this.distortFx));
    this.bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 0.92, luminanceSmoothing: 0.35, intensity: 1.15, radius: 0.72, levels: 8 });
    // Threshold on the mean of luma and max channel (tinwar's postfx): saturated reds and blues bloom too.
    const lm = this.bloom.luminanceMaterial;
    lm.fragmentShader = lm.fragmentShader.replace('float l=luminance(texel.rgb);', 'float l=0.5*(luminance(texel.rgb)+max(texel.r,max(texel.g,texel.b)));');
    lm.needsUpdate = true;
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    this.grade = new GradeEffect();
    this.composer.addPass(new EffectPass(camera, this.bloom, this.tone, this.grade));
    this.smaa = new SMAAEffect({ preset: SMAAPreset.HIGH, edgeDetectionMode: EdgeDetectionMode.COLOR });
    this.smaaPass = new EffectPass(camera, this.smaa);
    this.composer.addPass(this.smaaPass);
    if (softwareGL(renderer.getContext())) this.renderScale = 0.6;
    try { const sc = Number(new URLSearchParams(location.search).get('scale')); if (sc > 0.2 && sc <= 2) this.renderScale = sc; } catch { /* ignore */ }
    this.setQuality(detectQuality(renderer.getContext()));
  }

  /** Switch quality tier at runtime (the UI calls this from a settings menu). */
  setQuality(q: Quality) {
    this.quality = q;
    const hi = q === 'high';
    this.ao.enabled = hi;
    this.smaa.applyPreset(hi ? SMAAPreset.HIGH : SMAAPreset.LOW);
    this.bloom.resolution.scale = hi ? 1 : 0.5;
    this.distort.scale = hi ? 0.5 : 0.25;
    V.cap = hi ? 2600 : 1300;
    this.setSize(this.w, this.h);
  }

  setSize(w: number, h: number) {
    this.w = w; this.h = h;
    this.composer.setSize(w, h, false);
    const pr = this.renderer.getPixelRatio();
    this.distort.setSize(w * pr, h * pr);
  }

  setTheme(i: number) { this.theme = ((i % THEMES.length) + THEMES.length) % THEMES.length; }

  /** Render the frame; dt is real seconds. */
  frame(dt: number, cam: THREE.Camera) {
    this.distort.render(this.renderer, cam);
    // Grade eases toward the sector's look, so a sector change dissolves instead of popping.
    const G = GRADES[this.theme], k = Math.min(1, dt * 2), c = this.cur;
    c.lift.x += (G.lift[0] - c.lift.x) * k; c.lift.y += (G.lift[1] - c.lift.y) * k; c.lift.z += (G.lift[2] - c.lift.z) * k;
    c.gain.x += (G.gain[0] - c.gain.x) * k; c.gain.y += (G.gain[1] - c.gain.y) * k; c.gain.z += (G.gain[2] - c.gain.z) * k;
    c.gam += (G.gam - c.gam) * k; c.sat += (G.sat - c.sat) * k;
    const target = Math.max(V.timeGrade, this.slowHint);
    this.slow += (target - this.slow) * Math.min(1, dt * (target > this.slow ? 10 : 3));
    const u = this.grade.uniforms;
    (u.get('lift')!.value as THREE.Vector3).copy(c.lift); (u.get('gain')!.value as THREE.Vector3).copy(c.gain);
    u.get('gam')!.value = c.gam; u.get('sat')!.value = c.sat; u.get('slow')!.value = this.slow;
    this.bars += (this.cinema - this.bars) * Math.min(1, dt * 8);
    u.get('bars')!.value = this.bars;
    u.get('seed')!.value = (performance.now() * 0.06) % 97;
    u.get('expo')!.value = 1 + V.flashA * 0.6;
    this.distortFx.uniforms.get('ca')!.value = V.ca;
    V.ca *= Math.exp(-dt * 5);
    if (V.ca < 0.003) V.ca = 0;
    this.composer.render(dt);
  }
}
