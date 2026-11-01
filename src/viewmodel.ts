// First-person viewmodel layer: its own scene and camera, drawn over the world so it never clips into walls.
// Holds CS2's own arms, knife and first-person animations (decoded by the import step from the local CS2 install).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Pose } from './viewmodelPose';
import type { Cs2Mesh } from './cs2model';
import type { Vtex } from './cs2';
import type { NmSkeleton } from './cs2anim';
import type { Finish } from './cs2finish';
import { finishMaterial, PaintInputs, FinishShared } from './finishMaterial';
import type { Mdl, MdlSequence } from './goldsrcmdl';
import type { GameMode } from './config';

const DEG = Math.PI / 180;
// CS:GO viewmodel_fov default; CS 1.6 draws the viewmodel at fov 90. Horizontal at 4:3.
const VIEWMODEL_FOV: Record<GameMode, number> = { csgo: 68, cs16: 90 };
const INCH = 0.0254; // Source units → viewmodel metres

type Track = { frames: number; duration: number; poses: Float32Array };
// Arms poses (viewmodel skeleton) plus the knife's own bones (its skeleton), sampled on the same clock.
export type ViewmodelClip = Track & { knife: Track | null };
export type ArmsBundle = { skeleton: NmSkeleton; arms: Cs2Mesh };
export type KnifeBundle = { mesh: Cs2Mesh; skeleton: NmSkeleton | null; clips: Record<'draw' | 'idle' | 'lookat01' | 'light1' | 'light2' | 'heavy', ViewmodelClip>; paint: PaintInputs | null };
export type FinishChoice = { finish: Finish & { pattern: Vtex | null }; shared: FinishShared; wear: number; seed: number };

function material(t: Vtex | null, bptc: boolean, metal: number) {
  // BC7 needs EXT_texture_compression_bptc; DXT needs S3TC. Without them the part is drawn untextured.
  const format = t?.format === 'bc7' && bptc ? THREE.RGBA_BPTC_Format : t?.format === 'dxt1' ? THREE.RGB_S3TC_DXT1_Format : t?.format === 'dxt5' ? THREE.RGBA_S3TC_DXT5_Format : null;
  if (!t || format === null) return new THREE.MeshStandardMaterial({ color: 0x9a9da2, metalness: metal, roughness: 0.5 });
  const tex = new THREE.CompressedTexture(t.mips as unknown as ImageData[], t.width, t.height, format);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 8;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; // Source 2 samplers wrap; CS2 UVs (SNORM) go negative
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

// A skinned model driven by an animation skeleton. The model is bound to its own skeleton; each of its bones follows
// the animation bone of the same name (bones the animation lacks, like twist bones, follow their nearest named parent).
function skinnedRig(skeleton: NmSkeleton, model: Cs2Mesh, bptc: boolean, metal: number) {
  const { names, parents, ref } = skeleton;
  const bones = names.map((n) => Object.assign(new THREE.Bone(), { name: n }));
  const root = new THREE.Group();
  bones.forEach((bone, i) => (parents[i] >= 0 ? bones[parents[i]] : root).add(bone));
  const setPose = (p: ArrayLike<number>, i: number, o = 0) => {
    bones[i].position.set(p[o], p[o + 1], p[o + 2]);
    bones[i].scale.setScalar(p[o + 3]);
    bones[i].quaternion.set(p[o + 4], p[o + 5], p[o + 6], p[o + 7]);
  };
  ref.forEach((r, i) => setPose(r, i));

  const skin = model.skin!;
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

  const g = geometry(model);
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(joints, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(skin.weights, 4));
  const mesh = new THREE.SkinnedMesh(g, model.groups.map((gr) => material(gr.texture, bptc, metal)));
  mesh.frustumCulled = false; // bind-pose bounds say nothing about the animated pose
  root.add(mesh);
  mesh.bind(new THREE.Skeleton(bones, inverses), new THREE.Matrix4());

  const lerp = new Float32Array(8), qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
  const sample = (c: Track, t: number) => {
    const x = Math.min(1, Math.max(0, t / c.duration)) * (c.frames - 1), f = Math.min(c.frames - 2, Math.floor(x)), a = x - f;
    for (let i = 0; i < names.length; i++) {
      const o0 = (f * names.length + i) * 8, o1 = o0 + names.length * 8;
      for (let k = 0; k < 4; k++) lerp[k] = c.poses[o0 + k] + (c.poses[o1 + k] - c.poses[o0 + k]) * a;
      qa.fromArray(c.poses, o0 + 4).slerp(qb.fromArray(c.poses, o1 + 4), a).toArray(lerp, 4);
      setPose(lerp, i);
    }
  };
  return { root, mesh, sample, bone: (n: string) => bones[names.indexOf(n)] };
}

// A GoldSrc (CS 1.6) viewmodel: vertices sit in their bone's space, so identity inverse-bind matrices pose them.
function goldsrcRig(mdl: Mdl) {
  const bones = mdl.bones.map((b) => Object.assign(new THREE.Bone(), { name: b.name }));
  const root = new THREE.Group();
  bones.forEach((bone, i) => (mdl.bones[i].parent >= 0 ? bones[mdl.bones[i].parent] : root).add(bone));
  const skeleton = new THREE.Skeleton(bones, bones.map(() => new THREE.Matrix4()));
  for (const m of mdl.meshes) {
    const n = m.bones.length, joints = new Uint16Array(n * 4), weights = new Float32Array(n * 4);
    m.bones.forEach((b, i) => ((joints[i * 4] = b), (weights[i * 4] = 1)));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(m.uvs, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(joints, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(weights, 4));
    const t = mdl.textures[m.texture];
    const map = t ? new THREE.DataTexture(t.rgba, t.width, t.height, THREE.RGBAFormat) : null;
    if (map) {
      map.colorSpace = THREE.SRGBColorSpace;
      map.magFilter = THREE.LinearFilter;
      map.minFilter = THREE.LinearMipmapLinearFilter;
      map.generateMipmaps = true;
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.needsUpdate = true;
    }
    // GoldSrc models are lit flat-ish and strips mix windings: matte, both sides.
    const mat = new THREE.MeshStandardMaterial({ map, metalness: 0, roughness: 0.85, side: THREE.DoubleSide, alphaTest: t?.masked ? 0.5 : 0 });
    const mesh = new THREE.SkinnedMesh(g, mat);
    mesh.frustumCulled = false;
    root.add(mesh);
    mesh.bind(skeleton, new THREE.Matrix4());
  }
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
  const sample = (seq: MdlSequence, t: number, loop: boolean) => {
    const nb = bones.length, x = Math.max(0, t * seq.fps), f0 = Math.min(seq.frames - 1, Math.floor(x));
    const f1 = loop ? (f0 + 1) % seq.frames : Math.min(f0 + 1, seq.frames - 1), a = Math.min(1, x - Math.floor(x));
    for (let i = 0; i < nb; i++) {
      const o0 = (f0 * nb + i) * 7, o1 = (f1 * nb + i) * 7, p = seq.poses;
      bones[i].position.set(p[o0] + (p[o1] - p[o0]) * a, p[o0 + 1] + (p[o1 + 1] - p[o0 + 1]) * a, p[o0 + 2] + (p[o1 + 2] - p[o0 + 2]) * a);
      bones[i].quaternion.copy(qa.fromArray(p, o0 + 3).slerp(qb.fromArray(p, o1 + 3), a));
    }
  };
  return { root, sequences: new Map(mdl.sequences.map((q) => [q.label.toLowerCase(), q])), sample };
}

// CS 1.6 v_knife sequences for our clip names (it has no inspect), and each game's miss timing.
const CS16_CLIPS: Partial<Record<keyof KnifeBundle['clips'], string>> = { draw: 'draw', idle: 'idle', light1: 'midslash1', light2: 'midslash2', heavy: 'stab_miss' };
const COOLDOWN: Record<GameMode, { light: number; heavy: number }> = { csgo: { light: 500, heavy: 1000 }, cs16: { light: 350, heavy: 1000 } };

export function createViewmodel(renderer: THREE.WebGLRenderer) {
  const scene = new THREE.Scene();
  // Something for metal to reflect: knife steel and anodized finishes are mostly reflection.
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.6;
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
  const cs2 = new THREE.Group(), cs16 = new THREE.Group(); // one viewmodel per game, the other hidden
  rig.add(view);
  view.add(cs2, cs16);
  cs2.add(hold);
  scene.add(rig);
  let game: GameMode = 'csgo';
  cs16.visible = false;
  let k16: ReturnType<typeof goldsrcRig> | null = null;

  let arms: ReturnType<typeof skinnedRig> | null = null;
  let knife: { root: THREE.Object3D; mesh: THREE.Mesh; base: THREE.MeshStandardMaterial[]; rig: ReturnType<typeof skinnedRig> | null; clips: KnifeBundle['clips']; paint: PaintInputs | null } | null = null;
  let anim = { clip: 'draw' as keyof KnifeBundle['clips'], start: -1 }; // start < 0: begins on the first drawn frame (after upload/compile stalls)
  let nextAttack = 0, slashLeft = false;
  const seq16 = (clip: keyof KnifeBundle['clips']) => (CS16_CLIPS[clip] ? k16?.sequences.get(CS16_CLIPS[clip]!) : undefined);
  const duration = (clip: keyof KnifeBundle['clips']) => {
    if (game !== 'cs16') return knife?.clips[clip].duration ?? 0;
    const q = seq16(clip);
    return q ? q.frames / q.fps : 0;
  };
  const resize = (aspect: number) => {
    camera.aspect = aspect;
    camera.fov = (2 * Math.atan(Math.tan((VIEWMODEL_FOV[game] * DEG) / 2) * 0.75)) / DEG;
    camera.updateProjectionMatrix();
  };
  const mount = () => knife && (arms?.bone('wpn') ?? hold).add(knife.root); // weapons ride the viewmodel skeleton's wpn bone

  return {
    scene,
    camera,
    empty: () => (game === 'cs16' ? !k16 : !knife && !arms),
    setGame(g: GameMode) {
      game = g;
      cs2.visible = g === 'csgo';
      cs16.visible = g === 'cs16';
      anim = { clip: 'draw', start: -1 };
      nextAttack = 0;
      resize(camera.aspect);
    },
    setKnife16(mdl: Mdl) {
      k16?.root.removeFromParent();
      k16 = goldsrcRig(mdl);
      cs16.add(k16.root);
      if (game === 'cs16') anim = { clip: 'draw', start: -1 };
    },
    setKnife(b: KnifeBundle, bptc: boolean) {
      knife?.root.removeFromParent();
      const r = b.skeleton && b.mesh.skin ? skinnedRig(b.skeleton, b.mesh, bptc, 0.35) : null;
      const mesh = r?.mesh ?? new THREE.Mesh(geometry(b.mesh), b.mesh.groups.map((g) => material(g.texture, bptc, 0.35)));
      knife = { root: r?.root ?? mesh, mesh, base: mesh.material as THREE.MeshStandardMaterial[], rig: r, clips: b.clips, paint: b.paint };
      mount();
      anim = { clip: 'draw', start: -1 };
    },
    setArms(b: ArmsBundle, bptc: boolean) {
      arms = skinnedRig(b.skeleton, b.arms, bptc, 0);
      cs2.add(arms.root);
      mount();
      anim = { clip: 'draw', start: -1 };
    },
    // A finish painted over the knife (null = vanilla). False when this knife or browser can't show it.
    setFinish(choice: FinishChoice | null, bptc: boolean) {
      if (!knife) return false;
      for (const m of knife.mesh.material as THREE.Material[]) if (!knife.base.includes(m as THREE.MeshStandardMaterial)) m.dispose();
      knife.mesh.material = knife.base;
      if (!choice || !knife.paint) return !choice;
      const painted = knife.base.map((m) => finishMaterial(m, knife!.paint!, choice.finish, choice.shared, bptc, choice.wear, choice.seed));
      if (painted.some((m) => !m)) return false;
      knife.mesh.material = painted as THREE.MeshStandardMaterial[];
      return true;
    },
    // As in CS: inspect starts once the knife is ready again (attack cooldown over), cutting off the rest of a swing;
    // an attack in turn cuts off the inspect. Not during the draw, and pressing it mid-inspect doesn't restart it.
    inspect() {
      if (game === 'cs16') return; // CS 1.6 has no inspect
      const now = performance.now();
      if (anim.clip !== 'draw' && anim.clip !== 'lookat01' && now >= nextAttack) anim = { clip: 'lookat01', start: now };
    },
    // Knife timing on a miss (slash: CS:GO 0.5 s, 1.6 0.35 s; stab 1 s), slashes alternating sides; interrupts draw/inspect.
    attack(kind: 'light' | 'heavy') {
      const now = performance.now();
      if ((game === 'cs16' ? !k16 : !knife) || now < nextAttack) return;
      const clip = kind === 'heavy' ? 'heavy' : slashLeft ? 'light2' : 'light1';
      if (kind === 'light') slashLeft = !slashLeft;
      nextAttack = now + COOLDOWN[game][kind];
      anim = { clip, start: now };
    },
    resize,
    apply(p: Pose) {
      rig.position.set(p.x - p.swayX, p.y - p.swayY, 0);
      rig.rotation.set(p.swayY * 2, p.swayX * 2, 0);
      if (game === 'cs16' ? !k16 : !arms || !knife) return;
      if (anim.start < 0) anim.start = performance.now();
      const t = (performance.now() - anim.start) / 1000, d = duration(anim.clip);
      if (anim.clip !== 'idle' && t >= d) anim = { clip: 'idle', start: anim.start + d * 1000 }; // one-shots fall back to idle
      const at = (performance.now() - anim.start) / 1000, idle = anim.clip === 'idle';
      if (game === 'cs16') {
        const q = seq16(anim.clip);
        if (q) k16!.sample(q, idle ? at % (q.frames / q.fps) : at, idle);
        return;
      }
      const c = knife!.clips[anim.clip];
      arms!.sample(c, at % c.duration);
      if (c.knife) knife!.rig?.sample(c.knife, at % c.duration);
    },
  };
}
