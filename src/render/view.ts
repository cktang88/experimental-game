// Field <-> screen mapping.
//
// The HUD canvas and the mouse work in SCREEN units: the 1600x900 stage, linear with CSS pixels. The 3D camera looks
// down at the flight plane with a forward tilt, so field points do NOT land on the same screen units: the field is a
// trapezoid on screen (its top edge is ~110 units narrower each side, its centre ~30 units higher). Because
// engine.toGround puts ground objects under the same pixel as the flight-plane point, ONE homography maps a field
// point (either layer) to the screen. The engine sets it in fitCamera (from the unshaken camera); with no WebGL it
// stays the identity.
//
//   fieldToScreen(x, y): where a unit at field (x, y) is drawn (HUD markers, lock brackets, the reticle).
//   screenToField(x, y): the field point under a screen point (the mouse -> aim).
//   screenScale(x, y): screen units per field unit near that point (for sizes, e.g. ground rings).

const H = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
const Hi = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
const out = { x: 0, y: 0 };

function apply(m: Float64Array, x: number, y: number, o: { x: number; y: number }) {
  const w = m[6] * x + m[7] * y + m[8];
  o.x = (m[0] * x + m[1] * y + m[2]) / w; o.y = (m[3] * x + m[4] * y + m[5]) / w;
  return o;
}

/** Set the homography (row-major 3x3, field -> screen). */
export function setViewHomography(m: ArrayLike<number>) {
  for (let i = 0; i < 9; i++) H[i] = m[i];
  // inverse by adjugate
  const [a, b, c, d, e, f, g, h, i] = H;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return;
  const k = 1 / det;
  Hi[0] = A * k; Hi[1] = -(b * i - c * h) * k; Hi[2] = (b * f - c * e) * k;
  Hi[3] = B * k; Hi[4] = (a * i - c * g) * k; Hi[5] = -(a * f - c * d) * k;
  Hi[6] = C * k; Hi[7] = -(a * h - b * g) * k; Hi[8] = (a * e - b * d) * k;
}

/** Screen position of field point (x, y). Returns a shared object unless `o` is given. */
export const fieldToScreen = (x: number, y: number, o = out) => apply(H, x, y, o);
/** Field point under screen point (x, y). Returns a shared object unless `o` is given. */
export const screenToField = (x: number, y: number, o = out) => apply(Hi, x, y, o);
/** Screen units per field unit around field point (x, y) (the mean of the two axes). */
export function screenScale(x: number, y: number) {
  const ax = apply(H, x - 10, y, out).x, bx = apply(H, x + 10, y, out).x;
  const ay = apply(H, x, y - 10, out).y, by = apply(H, x, y + 10, out).y;
  return ((bx - ax) + (by - ay)) / 40;
}
