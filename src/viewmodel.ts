// First-person hands holding a knife: an original low-poly model built from primitives (no game assets),
// drawn in its own scene over the world so it never clips into walls.
import * as THREE from 'three';
import type { Pose } from './viewmodelPose';

const DEG = Math.PI / 180;
const VIEWMODEL_FOV = 68; // CS:GO viewmodel_fov default (horizontal at 4:3)

function knife(): THREE.Group {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.65, roughness: 0.3 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.85 });
  // Blade outline in the knife's XY plane: straight spine on top, edge sweeping up to the tip at +X.
  const s = new THREE.Shape();
  s.moveTo(0, 0.014);
  s.lineTo(0.16, 0.014);
  s.quadraticCurveTo(0.2, 0.012, 0.215, 0.002);
  s.quadraticCurveTo(0.17, -0.016, 0.06, -0.017);
  s.lineTo(0, -0.015);
  s.closePath();
  const blade = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.003, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 1 }), steel);
  blade.position.set(0.012, 0, -0.0015);
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.05, 0.016), steel);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.014, 0.11, 10), grip);
  handle.rotation.z = Math.PI / 2;
  handle.position.x = -0.058;
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.015, 10, 8), steel);
  pommel.position.x = -0.115;
  g.add(blade, guard, handle, pommel);
  return g;
}

function arm(): THREE.Group {
  const g = new THREE.Group();
  const sleeve = new THREE.MeshStandardMaterial({ color: 0x3d4434, roughness: 0.95 });
  const glove = new THREE.MeshStandardMaterial({ color: 0x232323, roughness: 0.7 });
  // Forearm runs along local +Y towards the wrist at the origin.
  const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.052, 0.4, 12), sleeve);
  forearm.position.y = -0.24;
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.043, 0.04, 12), glove);
  cuff.position.y = -0.045;
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.09, 0.06), glove);
  palm.position.set(0, 0.02, 0.005);
  g.add(forearm, cuff, palm);
  // Four fingers curled around the grip, plus the thumb on top.
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.0115, 0.035, 4, 8), glove);
    f.position.set(-0.03 + i * 0.02, 0.07, 0.03);
    f.rotation.x = Math.PI / 2.3;
    g.add(f);
  }
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.04, 4, 8), glove);
  thumb.position.set(0.045, 0.05, 0.02);
  thumb.rotation.set(0.6, 0, -0.9);
  g.add(thumb);
  return g;
}

export function createViewmodel() {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff1dc, 0x2a2420, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(-1, 1.5, 1);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);

  // Held low on the right, blade forward and slightly left, like a CS knife idle.
  const rig = new THREE.Group();
  const hand = arm();
  hand.rotation.set(-1.15, 0.35, 0.25);
  const blade = knife();
  blade.position.set(0, 0.06, 0.04);
  blade.rotation.set(0, Math.PI / 2, Math.PI / 2);
  hand.add(blade);
  rig.add(hand);
  scene.add(rig);
  const base = new THREE.Vector3(0.17, -0.17, -0.38);

  return {
    scene,
    camera,
    resize(aspect: number) {
      camera.aspect = aspect;
      camera.fov = (2 * Math.atan(Math.tan((VIEWMODEL_FOV * DEG) / 2) * 0.75)) / DEG;
      camera.updateProjectionMatrix();
    },
    apply(p: Pose) {
      rig.position.set(base.x + p.x - p.swayX, base.y + p.y - p.swayY, base.z);
      rig.rotation.set(p.swayY * 2, p.swayX * 2, 0);
    },
  };
}
