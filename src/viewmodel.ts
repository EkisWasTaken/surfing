// First-person viewmodel layer: its own scene and camera, drawn over the world so it never clips into walls.
// Holds CS2's own arms, knife and first-person animations (decoded by the import step from the local CS2 install).
import * as THREE from 'three';
import type { Pose } from './viewmodelPose';
import type { Cs2Mesh } from './cs2model';
import type { Vtex } from './cs2';
import type { NmSkeleton } from './cs2anim';

const DEG = Math.PI / 180;
const VIEWMODEL_FOV = 68; // CS:GO viewmodel_fov default (horizontal at 4:3)
const INCH = 0.0254; // Source units → viewmodel metres

export type ViewmodelClip = { frames: number; duration: number; poses: Float32Array };
export type ViewmodelBundle = { skeleton: NmSkeleton; clips: Record<string, ViewmodelClip>; arms: Cs2Mesh };

function material(t: Vtex | null, bptc: boolean, metal: number) {
  // BC7 needs EXT_texture_compression_bptc; DXT needs S3TC. Without them the part is drawn untextured.
  const format = t?.format === 'bc7' && bptc ? THREE.RGBA_BPTC_Format : t?.format === 'dxt1' ? THREE.RGB_S3TC_DXT1_Format : t?.format === 'dxt5' ? THREE.RGBA_S3TC_DXT5_Format : null;
  if (!t || format === null) return new THREE.MeshStandardMaterial({ color: 0x9a9da2, metalness: metal, roughness: 0.5 });
  const tex = new THREE.CompressedTexture(t.mips as unknown as ImageData[], t.width, t.height, format);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return new THREE.MeshStandardMaterial({ map: tex, metalness: metal, roughness: 0.55 });
}

// Geometry stays in Source model space (inches, Z up); the parent supplies the axis change.
function geometry(mesh: Cs2Mesh) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(mesh.uvs, 2));
  g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  mesh.groups.forEach((gr, i) => g.addGroup(gr.start, gr.count, i));
  g.computeVertexNormals();
  return g;
}

const sourceToThree = (o: THREE.Object3D) => {
  // Source (x forward, y left, z up, inches) → three (x right, y up, z back, metres)
  o.matrix.set(0, -1, 0, 0, 0, 0, 1, 0, -1, 0, 0, 0, 0, 0, 0, 1).multiply(new THREE.Matrix4().makeScale(INCH, INCH, INCH));
  o.matrixAutoUpdate = false;
  return o;
};

function armsObject(b: ViewmodelBundle, bptc: boolean) {
  const { names, parents, ref } = b.skeleton;
  const bones = names.map((n) => Object.assign(new THREE.Bone(), { name: n }));
  const root = new THREE.Group();
  bones.forEach((bone, i) => (parents[i] >= 0 ? bones[parents[i]] : root).add(bone));
  const setPose = (p: ArrayLike<number>, i: number, o = 0) => {
    bones[i].position.set(p[o], p[o + 1], p[o + 2]);
    bones[i].scale.setScalar(p[o + 3]);
    bones[i].quaternion.set(p[o + 4], p[o + 5], p[o + 6], p[o + 7]);
  };
  ref.forEach((r, i) => setPose(r, i));

  // The arms are bound to their own model skeleton; drive each of its bones by the viewmodel bone of the same name
  // (twist bones the viewmodel skeleton lacks follow their nearest named parent, which they match at bind).
  const skin = b.arms.skin!;
  const bind: THREE.Matrix4[] = [];
  skin.bones.forEach((bn, i) => {
    const local = new THREE.Matrix4().compose(new THREE.Vector3(...bn.pos), new THREE.Quaternion(...bn.rot), new THREE.Vector3(1, 1, 1));
    bind[i] = bn.parent >= 0 ? bind[bn.parent].clone().multiply(local) : local;
  });
  const target = skin.bones.map((_, i) => {
    let j = i;
    while (j >= 0 && !names.includes(skin.bones[j].name)) j = skin.bones[j].parent;
    return j;
  });
  const inverses = names.map(() => new THREE.Matrix4());
  target.forEach((j) => j >= 0 && inverses[names.indexOf(skin.bones[j].name)].copy(bind[j]).invert());
  const joints = new Uint16Array(skin.joints.length);
  skin.joints.forEach((j, k) => (joints[k] = Math.max(0, names.indexOf(skin.bones[target[j]]?.name ?? ''))));

  const g = geometry(b.arms);
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(joints, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(skin.weights, 4));
  const mesh = new THREE.SkinnedMesh(g, b.arms.groups.map((gr) => material(gr.texture, bptc, 0)));
  mesh.frustumCulled = false; // bind-pose bounds say nothing about the animated pose
  root.add(mesh);
  mesh.bind(new THREE.Skeleton(bones, inverses), new THREE.Matrix4());

  const lerp = new Float32Array(8), qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
  const sample = (c: ViewmodelClip, t: number) => {
    const x = Math.min(1, Math.max(0, t / c.duration)) * (c.frames - 1), f = Math.min(c.frames - 2, Math.floor(x)), a = x - f;
    for (let i = 0; i < names.length; i++) {
      const o0 = (f * names.length + i) * 8, o1 = o0 + names.length * 8;
      for (let k = 0; k < 4; k++) lerp[k] = c.poses[o0 + k] + (c.poses[o1 + k] - c.poses[o0 + k]) * a;
      qa.fromArray(c.poses, o0 + 4).slerp(qb.fromArray(c.poses, o1 + 4), a).toArray(lerp, 4);
      setPose(lerp, i);
    }
  };
  return { root, sample, wpn: bones[names.indexOf('wpn')] };
}

export function createViewmodel() {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff1dc, 0x2a2420, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(-1, 1.5, 1);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
  const rig = new THREE.Group(); // bob/sway
  const view = sourceToThree(new THREE.Group()); // viewmodel space: origin at the eye, Source axes
  const hold = new THREE.Group(); // knife without arms: lower right, angled in like CS's knife idle
  hold.position.set(10.6, -4.7, -5.1);
  hold.rotation.set(0.8, 1.35, -0.35, 'ZYX');
  rig.add(view);
  view.add(hold);
  scene.add(rig);

  let knife: THREE.Object3D | null = null;
  let arms: (ReturnType<typeof armsObject> & { clips: Record<string, ViewmodelClip> }) | null = null;
  let anim = { clip: 'draw', start: -1 }; // start < 0: begins on the first drawn frame (after upload/compile stalls)

  return {
    scene,
    camera,
    empty: () => !knife && !arms,
    setKnife(mesh: Cs2Mesh, bptc: boolean) {
      knife?.removeFromParent();
      knife = new THREE.Mesh(geometry(mesh), mesh.groups.map((g) => material(g.texture, bptc, 0.35)));
      (arms?.wpn ?? hold).add(knife); // weapons ride the viewmodel skeleton's wpn bone
    },
    setArms(b: ViewmodelBundle, bptc: boolean) {
      arms = { ...armsObject(b, bptc), clips: b.clips };
      view.add(arms.root);
      if (knife) arms.wpn.add(knife);
      anim = { clip: 'draw', start: -1 };
    },
    inspect() {
      if (arms && anim.clip === 'idle') anim = { clip: 'lookat01', start: performance.now() };
    },
    resize(aspect: number) {
      camera.aspect = aspect;
      camera.fov = (2 * Math.atan(Math.tan((VIEWMODEL_FOV * DEG) / 2) * 0.75)) / DEG;
      camera.updateProjectionMatrix();
    },
    apply(p: Pose) {
      rig.position.set(p.x - p.swayX, p.y - p.swayY, 0);
      rig.rotation.set(p.swayY * 2, p.swayX * 2, 0);
      if (!arms) return;
      if (anim.start < 0) anim.start = performance.now();
      const t = (performance.now() - anim.start) / 1000, d = arms.clips[anim.clip].duration;
      if (anim.clip !== 'idle' && t >= d) anim = { clip: 'idle', start: anim.start + d * 1000 }; // one-shots fall back to idle
      const c = arms.clips[anim.clip];
      arms.sample(c, ((performance.now() - anim.start) / 1000) % c.duration);
    },
  };
}
