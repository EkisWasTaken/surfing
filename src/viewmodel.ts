// First-person viewmodel layer: its own scene and camera, drawn over the world so it never clips into walls.
// Empty for now: the placeholder hands were removed; CS:GO's own knife/arms models (from the legacy files) go into `rig`.
import * as THREE from 'three';
import type { Pose } from './viewmodelPose';

const DEG = Math.PI / 180;
const VIEWMODEL_FOV = 68; // CS:GO viewmodel_fov default (horizontal at 4:3)

export function createViewmodel() {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff1dc, 0x2a2420, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(-1, 1.5, 1);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
  const rig = new THREE.Group();
  scene.add(rig);

  return {
    scene,
    camera,
    empty: () => rig.children.length === 0,
    resize(aspect: number) {
      camera.aspect = aspect;
      camera.fov = (2 * Math.atan(Math.tan((VIEWMODEL_FOV * DEG) / 2) * 0.75)) / DEG;
      camera.updateProjectionMatrix();
    },
    apply(p: Pose) {
      rig.position.set(p.x - p.swayX, p.y - p.swayY, 0);
      rig.rotation.set(p.swayY * 2, p.swayX * 2, 0);
    },
  };
}
