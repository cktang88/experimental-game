// Rotor blur discs: a canvas-drawn motion-blurred blade disc (hub, tip ring, four smeared blades).
import * as THREE from 'three';

let mat: THREE.MeshBasicMaterial | null = null, geo: THREE.BufferGeometry | null = null;

function texture() {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d')!, R = S / 2;
  g.translate(R, R);
  // faint full disc (the blur of the blades sweeping)
  const disc = g.createRadialGradient(0, 0, R * 0.08, 0, 0, R);
  disc.addColorStop(0, 'rgba(200,205,210,0.10)'); disc.addColorStop(0.85, 'rgba(200,205,210,0.16)'); disc.addColorStop(0.97, 'rgba(220,225,230,0.32)'); disc.addColorStop(1, 'rgba(220,225,230,0)');
  g.fillStyle = disc; g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.fill();
  // four blades, each smeared over an arc that fades out behind it
  for (let b = 0; b < 4; b++) {
    const a0 = (b * Math.PI) / 2;
    for (let i = 0; i < 24; i++) {
      const a = a0 - i * 0.03, al = 0.2 * Math.pow(1 - i / 24, 2);
      g.strokeStyle = `rgba(30,32,35,${al})`; g.lineWidth = 7 - i * 0.18;
      g.beginPath(); g.moveTo(Math.cos(a) * R * 0.12, Math.sin(a) * R * 0.12); g.lineTo(Math.cos(a) * R * 0.97, Math.sin(a) * R * 0.97); g.stroke();
    }
  }
  g.fillStyle = 'rgba(40,42,45,0.9)'; g.beginPath(); g.arc(0, 0, R * 0.08, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** Shared rotor disc: unit radius, lying in XZ. */
export function rotorDisc() {
  if (!geo) geo = new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2);
  if (!mat) mat = new THREE.MeshBasicMaterial({ map: texture(), transparent: true, depthWrite: false, side: THREE.DoubleSide, color: 0x9aa3ad });
  return { geo, mat };
}
