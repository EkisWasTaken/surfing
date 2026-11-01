// First-person viewmodel layer: its own scene and camera, drawn over the world so it never clips into walls.
// Holds CS2's own knife model (decoded by the import step from the local CS2 install) when available.
import * as THREE from 'three';
import type { Pose } from './viewmodelPose';
import type { Cs2Mesh } from './cs2model';

const DEG = Math.PI / 180;
const VIEWMODEL_FOV = 68; // CS:GO viewmodel_fov default (horizontal at 4:3)
const INCH = 0.0254; // Source units → viewmodel metres

function knifeObject(mesh: Cs2Mesh, bptc: boolean): THREE.Object3D {
  const p = mesh.positions, pos = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) (pos[i] = p[i]), (pos[i + 1] = p[i + 2]), (pos[i + 2] = -p[i + 1]); // Source → three axes
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(mesh.uvs, 2));
  g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  const materials = mesh.groups.map((gr, i) => {
    g.addGroup(gr.start, gr.count, i);
    const t = gr.texture;
    // BC7 needs EXT_texture_compression_bptc; DXT needs S3TC. Without them the part is drawn untextured.
    const format = t?.format === 'bc7' && bptc ? THREE.RGBA_BPTC_Format : t?.format === 'dxt1' ? THREE.RGB_S3TC_DXT1_Format : t?.format === 'dxt5' ? THREE.RGBA_S3TC_DXT5_Format : null;
    if (!t || format === null) return new THREE.MeshStandardMaterial({ color: 0x9a9da2, metalness: 0.6, roughness: 0.4 });
    const tex = new THREE.CompressedTexture(t.mips as unknown as ImageData[], t.width, t.height, format);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map: tex, metalness: 0.35, roughness: 0.5 });
  });
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, materials);
  m.scale.setScalar(INCH);
  return m;
}

export function createViewmodel() {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff1dc, 0x2a2420, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(-1, 1.5, 1);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
  const rig = new THREE.Group(); // bob/sway
  const hold = new THREE.Group(); // where the knife sits in view
  rig.add(hold);
  scene.add(rig);
  hold.position.set(0.12, -0.13, -0.27); // lower right, angled in like CS's knife idle (arms will refine this)
  hold.rotation.set(-1.35, 0.35, 0.8);

  return {
    scene,
    camera,
    empty: () => hold.children.length === 0,
    setKnife(mesh: Cs2Mesh, bptc: boolean) {
      hold.clear();
      hold.add(knifeObject(mesh, bptc));
    },
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
