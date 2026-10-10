// FLIR thermal view state (white-hot), shared by the post grade, the unit livery, the city shaders and the HUD.
// `on` is the pilot's request (hold Shift or toggle T, main.ts); `k` eases 0..1 and is what shaders read.
export const FLIR = { on: false, k: 0 };
/** Shared uniform object: materials that change in the thermal view put this in their uniforms. */
export const flirUniform = { value: 0 };
/** Ease toward the request; call once per rendered frame with real seconds. */
export function stepFlir(dt: number) {
  const target = FLIR.on ? 1 : 0;
  FLIR.k += (target - FLIR.k) * Math.min(1, dt * 9);
  if (Math.abs(target - FLIR.k) < 0.002) FLIR.k = target;
  flirUniform.value = FLIR.k;
}
