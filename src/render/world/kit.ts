// Shared geometries, materials and theme colours for the city (built once per layer).
import * as THREE from 'three';
import * as geo from './geom';
import { buildingMaterial, buildingDepthMaterial, groundMaterial, waterMaterial, propMaterial } from './materials';
import { glowMaterial, trafficMaterial } from './lights';

export interface PropDef { geo: THREE.BufferGeometry; mat: THREE.Material; shadow: boolean }
export interface CityKit {
  k: number; cz: number;
  geo: { box: THREE.BufferGeometry; house: THREE.BufferGeometry; ruin0: THREE.BufferGeometry; ruin1: THREE.BufferGeometry; tank: THREE.BufferGeometry; cyl: THREE.BufferGeometry; chimney: THREE.BufferGeometry; cooler: THREE.BufferGeometry; quad: THREE.BufferGeometry; rubble: THREE.BufferGeometry; beam: THREE.BufferGeometry };
  mat: { bld: THREE.Material; bldRound: THREE.Material; bldDepth: THREE.Material; ground: THREE.Material; water: THREE.Material; rubble: THREE.Material; glow: THREE.Material; traffic: THREE.Material };
  props: Record<string, PropDef>;
  lampCol: THREE.Color; ledCol: THREE.Color; winCol: THREE.Color; beaconCol: THREE.Color; signalGreen: THREE.Color; signalAmber: THREE.Color;
  neonCols: THREE.Color[]; containerCols: THREE.Color[]; railCols: THREE.Color[];
}

const C = (h: string) => new THREE.Color(h);
export function makeKit(k: number, cz: number): CityKit {
  const metal = propMaterial('metal'), container = propMaterial('container');
  const ac = geo.mergeParts([geo.boxPart(1, 0.75, 1), geo.cylPart(0.28, 0.28, 0.12, 10, 0.18, 0.75, 0), geo.boxPart(0.3, 0.2, 0.9, -0.3, 0.75, 0)]);
  return {
    k, cz,
    geo: {
      box: geo.unitBox(), house: geo.unitHouse(), ruin0: geo.unitRuin(11), ruin1: geo.unitRuin(977), tank: geo.unitTank(), cyl: geo.unitCyl(),
      chimney: geo.unitChimney(), cooler: geo.unitCooler(), quad: geo.unitQuad(), rubble: geo.unitRubble(), beam: geo.unitBeam(),
    },
    mat: {
      bld: buildingMaterial(false), bldRound: buildingMaterial(true), bldDepth: buildingDepthMaterial(), ground: groundMaterial(), water: waterMaterial(),
      rubble: propMaterial('rubble'), glow: glowMaterial(), traffic: trafficMaterial(),
    },
    props: {
      tree: { geo: geo.unitTree(), mat: propMaterial('tree'), shadow: true },
      container: { geo: geo.unitBox(), mat: container, shadow: true },
      crane: { geo: geo.unitCrane(), mat: metal, shadow: true },
      pipe: { geo: geo.unitPipe(), mat: metal, shadow: true },
      ac: { geo: ac, mat: metal, shadow: false },
      wtower: { geo: geo.unitWaterTower(), mat: metal, shadow: true },
      mast: { geo: geo.unitMast(), mat: metal, shadow: true },
      ship: { geo: geo.unitShip(), mat: propMaterial('ship'), shadow: true },
    },
    lampCol: C('#ffb04a'), ledCol: C('#d8e6ff'), winCol: C('#ffb347'), beaconCol: C('#ff2a1c'), signalGreen: C('#5dff9a'), signalAmber: C('#ffb020'),
    neonCols: [C('#ff3fc8'), C('#a35bff'), C('#2affc0'), C('#ffa030')],
    containerCols: ['#5a2a1e', '#1f3550', '#2c4a46', '#5c4a24', '#6a6e72', '#3a2f45', '#702e18', '#2a3a2a'].map(C),
    railCols: ['#3a2418', '#2a2a2c', '#4a3a28', '#1f2a33', '#552a1a'].map(C),
  };
}
