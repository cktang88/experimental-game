// Dev tool: renders every model of a kit in a labelled grid.
// /tools/contact.html?kit=city&filter=Building&cols=8&view=top|iso
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const q = new URLSearchParams(location.search);
const kit = q.get('kit') || 'city', filter = new RegExp(q.get('filter') || '.', 'i'), cols = Number(q.get('cols') || 8), view = q.get('view') || 'iso';
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x10161d);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(-3, 6, 4); scene.add(sun);
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
loader.load(`/assets/kits/${kit}.glb`, (gltf) => {
  const models = gltf.scene.children.filter((c) => filter.test(c.name));
  const cell = 1.3, rows = Math.ceil(models.length / cols);
  const labels = document.getElementById('labels')!;
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100);
  const w = cols * cell, h = rows * cell, aspect = innerWidth / innerHeight;
  const half = Math.max(w / 2 / aspect, h / 2) * 1.05;
  Object.assign(cam, { left: -half * aspect, right: half * aspect, top: half, bottom: -half }); cam.updateProjectionMatrix();
  if (view === 'top') { cam.position.set(0, 50, 0); cam.up.set(0, 0, -1); } else cam.position.set(0, 30, 30);
  cam.lookAt(0, 0, 0);
  models.forEach((m, i) => {
    const box = new THREE.Box3().setFromObject(m), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const s = 1 / Math.max(size.x, size.y, size.z, 1e-3);
    const holder = new THREE.Group(); holder.add(m); m.position.sub(c); holder.scale.setScalar(s);
    const x = (i % cols - (cols - 1) / 2) * cell, z = (Math.floor(i / cols) - (rows - 1) / 2) * cell;
    holder.position.set(x, 0, view === 'top' ? z : z); scene.add(holder);
    holder.updateMatrixWorld(true);
    const p = new THREE.Vector3(x, -0.6, z + 0.45).project(cam);
    const d = document.createElement('div'); d.textContent = `${m.name} ${size.x.toFixed(1)}×${size.y.toFixed(1)}×${size.z.toFixed(1)}`;
    d.style.left = `${(p.x * 0.5 + 0.5) * innerWidth}px`; d.style.top = `${(-p.y * 0.5 + 0.5) * innerHeight}px`; labels.append(d);
  });
  renderer.render(scene, cam);
  document.title = 'ready';
});
