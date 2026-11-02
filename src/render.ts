import * as THREE from 'three';
import type { Brush } from './brush';
import type { Vec3 } from './math';
import { sandstone, limestone } from './textures';
import { createMaterialSource, skyTexture, FOG_GLSL, Fog } from './mapMaterials';
import { parseModel } from './mdl';
import { createViewmodel } from './viewmodel';
import type { Pose } from './viewmodelPose';
import type { BspMap } from './bsp';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { THEMES, Theme } from './maps/build';

// The only place Source coords (x fwd, y left, z up) become three.js coords (x, y up, z).
const toThree = (v: Vec3) => new THREE.Vector3(v.x, v.z, -v.y);
const DEG = Math.PI / 180;

const SUN = new THREE.Vector3(0.45, 0.42, -0.79).normalize();
const HORIZON = new THREE.Color('#f0d2a0');
const ZENITH = new THREE.Color('#5a8cc2');
const GROUND = new THREE.Color('#c6a273');
// Imported maps without a packed skybox get a neutral sky instead of the desert one.
const NEUTRAL = { horizon: new THREE.Color('#b8c3cc'), zenith: new THREE.Color('#5f86b3'), ground: new THREE.Color('#6b6f72') };
const mapFog: Fog = { fogColor: { value: new THREE.Color() }, fogStart: { value: 0 }, fogEnd: { value: 1 }, fogMax: { value: 0 } };

// Triplanar world-space texturing (one texture repeat per `scale` units), sun shading, distance haze.
function texture(image: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(image);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Imported maps (`flat` given): steep faces use `image`, floors use `flat`, both tinted by vertex color
// (the original texture's average color from the BSP).
function surfaceMaterial(image: HTMLCanvasElement, scale: number, flat?: HTMLCanvasElement) {
  return new THREE.ShaderMaterial({
    defines: flat ? { BSP: 1 } : {},
    vertexColors: !!flat,
    uniforms: { tint: { value: new THREE.Color(1, 1, 1) }, useTint: { value: 0 }, light: { value: 1 }, map: { value: texture(image) }, flatMap: { value: texture(flat ?? image) }, lightmap: { value: null }, exposure: { value: 1 }, scale: { value: scale }, sun: { value: SUN }, haze: { value: HORIZON }, ...mapFog },
    vertexShader: /* glsl */ `
      varying vec3 vWorld; varying vec3 vNormal; varying vec3 vTint;
      #ifdef BSP
        attribute vec2 lmUv; varying vec2 vLm;
      #endif
      void main() {
        #ifdef BSP
          vLm = lmUv;
        #endif
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz; vNormal = normalize(mat3(modelMatrix) * normal);
        #ifdef USE_COLOR
          vTint = color;
        #else
          vTint = vec3(1.0);
        #endif
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map; uniform sampler2D flatMap; uniform sampler2D lightmap; uniform vec3 tint; uniform float useTint; uniform float light; uniform float exposure; uniform float scale; uniform vec3 sun; uniform vec3 haze;
      ${FOG_GLSL}
      varying vec3 vWorld; varying vec3 vNormal; varying vec3 vTint;
      #ifdef BSP
        varying vec2 vLm;
      #endif
      vec3 tri(sampler2D t, vec3 p, vec3 w) { return texture2D(t, p.zy).rgb * w.x + texture2D(t, p.xz).rgb * w.y + texture2D(t, p.xy).rgb * w.z; }
      void main() {
        vec3 n = normalize(vNormal);
        vec3 w = pow(abs(n), vec3(4.0)); w /= w.x + w.y + w.z;
        vec3 p = vWorld / scale;
        vec3 albedo = tri(map, p, w);
        #ifndef BSP
          albedo = mix(albedo, vec3(dot(albedo, vec3(0.3, 0.6, 0.1))) * tint * 1.7, useTint); // a theme's colour, keeping the stone's detail
        #endif
        #ifdef BSP
          albedo = mix(albedo, tri(flatMap, p, w), smoothstep(0.6, 0.8, n.y)) * clamp(vTint * 2.2, 0.35, 1.6);
        #endif
        #ifdef BSP
          vec3 l = texture2D(lightmap, vLm).rgb; // baked light stored as sqrt(light / 4)
          vec3 color = albedo * l * l * 4.0 * exposure;
        #else
          float diffuse = max(dot(n, sun), 0.0);
          vec3 color = albedo * (vec3(0.42, 0.38, 0.36) + vec3(1.0, 0.9, 0.75) * diffuse * 0.85) * light;
        #endif
        #ifdef BSP
          gl_FragColor = vec4(applyFog(color, vWorld), 1.0); // imported maps: only the map's own fog
        #else
          float fog = 1.0 - exp(-length(vWorld - cameraPosition) / 24000.0);
          gl_FragColor = vec4(mix(color, haze, fog * 0.75), 1.0); // built-in desert maps: warm haze
        #endif
        #include <colorspace_fragment>
      }`,
  });
}

// Sky dome: warm gradient, sun disc + glow, drifting-free procedural clouds.
function skyMesh() {
  return new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { sun: { value: SUN }, horizon: { value: HORIZON }, zenith: { value: ZENITH }, ground: { value: GROUND } },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() { vDir = position; gl_Position = (projectionMatrix * modelViewMatrix * vec4(position, 1.0)).xyww; }`,
      fragmentShader: /* glsl */ `
        uniform vec3 sun; uniform vec3 horizon; uniform vec3 zenith; uniform vec3 ground; varying vec3 vDir;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
        }
        float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
        void main() {
          vec3 d = normalize(vDir);
          vec3 sky = d.y > 0.0 ? mix(horizon, zenith, pow(d.y, 0.55)) : mix(horizon, ground, min(-d.y * 6.0, 1.0));
          if (d.y > 0.02) {
            float c = smoothstep(0.55, 0.85, fbm(d.xz / (d.y + 0.15) * 1.6));
            sky = mix(sky, vec3(1.0, 0.97, 0.92), c * smoothstep(0.02, 0.2, d.y) * 0.8);
          }
          float s = max(dot(d, sun), 0.0);
          sky += vec3(1.0, 0.85, 0.6) * (pow(s, 600.0) * 4.0 + pow(s, 12.0) * 0.25);
          gl_FragColor = vec4(sky, 1.0);
          #include <colorspace_fragment>
        }`,
    }),
  );
}

export function rampGeometry(b: Brush): THREE.BufferGeometry {
  const [a0, a1, a2, b0, b1, b2] = b.corners!.map(toThree);
  const faces = [
    [a0, a2, a1], [b0, b1, b2], // end caps
    [a0, a1, b1], [a0, b1, b0], // wall
    [a1, a2, b2], [a1, b2, b1], // slope
    [a0, b0, b2], [a0, b2, a2], // bottom
  ];
  // Orientation depends on side/axis, so wind each face away from the prism's centre.
  const center = [a0, a1, a2, b0, b1, b2].reduce((s, v) => s.add(v), new THREE.Vector3()).divideScalar(6);
  const wound = faces.map(([p, q, r]) => {
    const n = new THREE.Vector3().subVectors(q, p).cross(new THREE.Vector3().subVectors(r, p));
    const out = new THREE.Vector3().addVectors(p, q).add(r).divideScalar(3).sub(center);
    return n.dot(out) > 0 ? [p, q, r] : [p, r, q];
  });
  const pos = wound.flatMap((f) => f.flatMap((v) => [v.x, v.y, v.z]));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// Source-space triangle soup to three.js space (x, z, -y), flat-shaded.
function bspGeometry({ positions, colors, uvs, lmUvs, groups }: BspMap['mesh']): THREE.BufferGeometry {
  const p = new Float32Array(positions.length);
  for (let i = 0; i < p.length; i += 3) {
    p[i] = positions[i];
    p[i + 1] = positions[i + 2];
    p[i + 2] = -positions[i + 1];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setAttribute('lmUv', new THREE.BufferAttribute(lmUvs, 2));
  groups.forEach((gr, i) => g.addGroup(gr.start, gr.count, i));
  g.computeVertexNormals();
  return g;
}

function boxGeometry(b: Brush): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(b.maxs.x - b.mins.x, b.maxs.z - b.mins.z, b.maxs.y - b.mins.y);
  const c = toThree({ x: (b.mins.x + b.maxs.x) / 2, y: (b.mins.y + b.maxs.y) / 2, z: (b.mins.z + b.maxs.z) / 2 });
  return g.translate(c.x, c.y, c.z);
}

// Source skybox: six faces named rt/bk/lf/ft/up/dn, laid out like Quake's (st_to_vec): for each face,
// which Source axis gets ±s (image across), ±t (image up) or the fixed ±1 side.
const SKY_FACES: [string, number[]][] = [
  ['rt', [3, -1, 2]], ['bk', [-3, 1, 2]], ['lf', [1, 3, 2]], ['ft', [-1, -3, 2]], ['up', [-2, -1, 3]], ['dn', [2, -1, -3]],
];

function skyboxGroup(name: string, pak: Map<string, Uint8Array>, s3tc: boolean): THREE.Group | null {
  const group = new THREE.Group();
  for (const [suffix, axes] of SKY_FACES) {
    const tex = skyTexture(`skybox/${name}${suffix}`, pak, s3tc);
    if (!tex) {
      if (suffix === 'dn') continue; // many skyboxes ship without a bottom face
      group.traverse((o) => o instanceof THREE.Mesh && (o.material.uniforms.map.value.dispose(), o.geometry.dispose()));
      return null;
    }
    const pos: number[] = [], uv: number[] = [];
    for (const [s, t] of [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]]) {
      const v = axes.map((k) => Math.sign(k) * (Math.abs(k) === 1 ? s : Math.abs(k) === 2 ? t : 1));
      const p = toThree({ x: v[0], y: v[1], z: v[2] });
      pos.push(p.x, p.y, p.z);
      uv.push((s + 1) / 2, (1 - t) / 2); // VTF rows start at the top of the image
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const mesh = new THREE.Mesh(
      g,
      new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        depthWrite: false,
        uniforms: { map: { value: tex } },
        vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D map; varying vec2 vUv;
          void main() {
            vec3 c = texture2D(map, vUv).rgb;
            c = mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); // sRGB → linear
            gl_FragColor = vec4(c, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    );
    mesh.renderOrder = -1;
    group.add(mesh);
  }
  group.scale.setScalar(50000);
  return group;
}

// Source → three.js basis (x, y, z) → (x, z, -y), used to move prop transforms into three space.
const SOURCE_TO_THREE = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);
const THREE_TO_SOURCE = SOURCE_TO_THREE.clone().transpose();

// Static props whose models are packed in the map; geometry is decoded once per model+skin and shared.
function propMeshes(props: BspMap['props'], pak: Map<string, Uint8Array>, material: (candidates: string[]) => THREE.Material): THREE.Mesh[] {
  const cache = new Map<string, { geometry: THREE.BufferGeometry; materials: THREE.Material[] } | null>();
  const load = (model: string, skin: number) => {
    const key = `${model}#${skin}`;
    if (!cache.has(key)) {
      const base = model.replace(/\.mdl$/, '');
      const vtx = ['.dx90.vtx', '.vtx', '.dx80.vtx', '.sw.vtx'].map((e) => pak.get(base + e)).find(Boolean);
      const mdl = pak.get(model), vvd = pak.get(base + '.vvd');
      const mesh = mdl && vvd && vtx ? parseModel(mdl, vvd, vtx, skin) : null;
      if (!mesh) cache.set(key, null);
      else {
        const p = mesh.positions, n = mesh.normals;
        const tp = new Float32Array(p.length), tn = new Float32Array(n.length);
        for (let i = 0; i < p.length; i += 3) {
          tp[i] = p[i], tp[i + 1] = p[i + 2], tp[i + 2] = -p[i + 1];
          tn[i] = n[i], tn[i + 1] = n[i + 2], tn[i + 2] = -n[i + 1];
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(tp, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(tn, 3));
        g.setAttribute('uv', new THREE.BufferAttribute(mesh.uvs, 2));
        mesh.groups.forEach((gr, i) => g.addGroup(gr.start, gr.count, i));
        cache.set(key, { geometry: g, materials: mesh.groups.map((gr) => material(gr.materials)) });
      }
    }
    return cache.get(key);
  };
  const out: THREE.Mesh[] = [];
  for (const prop of props) {
    const model = load(prop.model, prop.skin);
    if (!model) continue;
    const { x: pitch, y: yaw, z: roll } = prop.angles;
    // Source AngleMatrix: yaw about Z, then pitch about Y, then roll about X.
    const src = new THREE.Matrix4()
      .makeTranslation(prop.origin.x, prop.origin.y, prop.origin.z)
      .multiply(new THREE.Matrix4().makeRotationZ(yaw * DEG))
      .multiply(new THREE.Matrix4().makeRotationY(pitch * DEG))
      .multiply(new THREE.Matrix4().makeRotationX(roll * DEG))
      .multiply(new THREE.Matrix4().makeScale(prop.scale, prop.scale, prop.scale));
    const mesh = new THREE.Mesh(model.geometry, model.materials);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(SOURCE_TO_THREE).multiply(src).multiply(THREE_TO_SOURCE);
    out.push(mesh);
  }
  return out;
}

const BOOST_MAT = new THREE.MeshBasicMaterial({ color: 0xffc14d, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending });

// Non-solid landscape around a built-in map, so speed has something to read against: shapes rising from a ground far
// below, kept clear of the course. Seeded, so a map always looks the same.
function sceneryGeometry(brushes: Brush[], killZ: number, kind: Theme['scenery']) {
  let seed = 4711;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const lo = { x: Math.min(...brushes.map((b) => b.mins.x)), y: Math.min(...brushes.map((b) => b.mins.y)) };
  const hi = { x: Math.max(...brushes.map((b) => b.maxs.x)), y: Math.max(...brushes.map((b) => b.maxs.y)), z: Math.max(...brushes.map((b) => b.maxs.z)) };
  const baseZ = killZ - 500, parts: THREE.BufferGeometry[] = [];
  const clear = (x: number, y: number, r: number) => !brushes.some((b) => x > b.mins.x - r - 500 && x < b.maxs.x + r + 500 && y > b.mins.y - r - 500 && y < b.maxs.y + r + 500);
  for (let tries = 0; tries < 900 && parts.length < 170; tries++) {
    const x = lo.x - 9000 + rand() * (hi.x - lo.x + 18000), y = lo.y - 9000 + rand() * (hi.y - lo.y + 18000);
    const r = 250 + rand() * rand() * 1300, h = (0.25 + rand() * 0.95) * (hi.z - baseZ);
    if (!clear(x, y, r)) continue;
    const g = kind === 'spire' ? new THREE.ConeGeometry(r, h, 6) : kind === 'pillar' ? new THREE.BoxGeometry(r * 1.2, h, r * 1.2) : kind === 'mesa' ? new THREE.CylinderGeometry(r * 0.75, r * 1.15, h * 0.6, 8) : new THREE.IcosahedronGeometry(r * 1.2, 0);
    g.deleteAttribute('uv');
    const flat = g.index ? g.toNonIndexed() : g; // hard facets, and every part the same layout for merging
    flat.computeVertexNormals();
    flat.rotateY(rand() * Math.PI);
    flat.translate(x, kind === 'rock' ? baseZ + rand() * (hi.z - baseZ) * 0.8 : baseZ + (kind === 'mesa' ? h * 0.3 : h / 2), -y);
    parts.push(flat);
  }
  const ground = new THREE.BoxGeometry(hi.x - lo.x + 60000, 40, hi.y - lo.y + 60000).toNonIndexed();
  ground.deleteAttribute('uv');
  ground.translate((lo.x + hi.x) / 2, baseZ - 20, -(lo.y + hi.y) / 2);
  parts.push(ground);
  return mergeGeometries(parts)!;
}

export function createRenderer(canvas: HTMLCanvasElement) {
  let showViewmodel = true;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // sharper than this costs far more frame rate than it shows
  const scene = new THREE.Scene();
  const sky = skyMesh();
  sky.scale.setScalar(50000);
  sky.renderOrder = -1;
  scene.add(sky);
  let skybox: THREE.Group | null = null;
  const skyUniforms = (sky.material as THREE.ShaderMaterial).uniforms;
  const setSkyColors = (c: { horizon: THREE.Color; zenith: THREE.Color; ground: THREE.Color }) => {
    skyUniforms.horizon.value = c.horizon;
    skyUniforms.zenith.value = c.zenith;
    skyUniforms.ground.value = c.ground;
  };
  const camera = new THREE.PerspectiveCamera(74, 1, 4, 120000);
  camera.rotation.order = 'YXZ';
  const rampMat = surfaceMaterial(sandstone(), 256);
  const floorMat = surfaceMaterial(limestone(), 256);
  const bspMat = surfaceMaterial(sandstone(), 256, limestone());
  const s3tc = renderer.extensions.has('WEBGL_compressed_texture_s3tc');
  let materials: ReturnType<typeof createMaterialSource> | null = null;
  let lightmap: THREE.DataTexture | null = null;
  const world = new THREE.Group();
  scene.add(world);
  let hfov = 90, fovKick = 0;

  const viewmodel = createViewmodel(renderer);
  // Ghost of your best run: a see-through player-sized capsule (32 wide, 72 tall, like the hull).
  const ghost = new THREE.Mesh(new THREE.CapsuleGeometry(16, 40, 4, 12), new THREE.MeshBasicMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.35, depthWrite: false }));
  ghost.visible = false;
  scene.add(ghost);
  const rival = ghost.clone();
  rival.material = new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.45, depthWrite: false });
  scene.add(rival);
  renderer.autoClear = false; // world, then the knife on top with only depth cleared
  const resize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    viewmodel.resize(camera.aspect);
    // CS:GO fov is horizontal at 4:3; wider screens see more to the sides.
    camera.fov = 2 * Math.atan(Math.tan(((hfov + fovKick) * DEG) / 2) * 0.75) / DEG;
    camera.updateProjectionMatrix();
  };
  resize();

  return {
    setMap(map: { theme?: Theme; pushes?: { brushes: Brush[] }[]; killZ: number; brushes: Brush[]; mesh?: BspMap['mesh']; pak?: BspMap['pak']; props?: BspMap['props']; lightmap?: BspMap['lightmap']; skyName?: string; fog?: BspMap['fog'] }) {
      const geometries = new Set<THREE.BufferGeometry>();
      world.traverse((o) => o instanceof THREE.Mesh && geometries.add(o.geometry));
      geometries.forEach((g) => g.dispose());
      materials?.dispose();
      materials = null;
      lightmap?.dispose();
      lightmap = null;
      world.clear();
      if (skybox) {
        skybox.traverse((o) => o instanceof THREE.Mesh && (o.material.uniforms.map.value.dispose(), o.geometry.dispose(), o.material.dispose()));
        scene.remove(skybox);
        skybox = null;
      }
      sky.visible = true;
      const theme: Theme = map.theme ?? THEMES.desert;
      setSkyColors({ horizon: new THREE.Color(theme.horizon), zenith: new THREE.Color(theme.zenith), ground: new THREE.Color(theme.ground) });
      for (const [mat, colour] of [[rampMat, map.mesh ? null : theme.ramp], [floorMat, map.mesh ? null : theme.floor]] as const) {
        mat.uniforms.useTint.value = colour ? 1 : 0;
        if (colour) mat.uniforms.tint.value.set(colour);
        mat.uniforms.light.value = map.mesh ? 1 : theme.light;
        mat.uniforms.haze.value = new THREE.Color(theme.haze);
      }
      if (map.mesh) {
        // The map's own textures where packed and decodable, desert fallback elsewhere.
        if (map.lightmap) {
          const { width, height, data } = map.lightmap;
          lightmap = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
          lightmap.magFilter = lightmap.minFilter = THREE.LinearFilter; // raw values, no mips (they'd blend neighbouring faces)
          lightmap.userData.exposure = map.lightmap.exposure;
          lightmap.needsUpdate = true;
        }
        bspMat.uniforms.exposure.value = map.lightmap?.exposure ?? 1;
        bspMat.uniforms.lightmap.value = lightmap;
        materials = createMaterialSource(map.pak ?? new Map(), s3tc, SUN, mapFog, lightmap);
        const f = map.fog;
        if (f) mapFog.fogColor.value.setRGB(f.color[0], f.color[1], f.color[2], THREE.SRGBColorSpace);
        mapFog.fogStart.value = f?.start ?? 0;
        mapFog.fogEnd.value = f?.end ?? 1;
        mapFog.fogMax.value = f?.max ?? 0;
        skybox = map.skyName ? skyboxGroup(map.skyName, map.pak ?? new Map(), s3tc) : null;
        if (skybox) scene.add(skybox);
        sky.visible = !skybox;
        setSkyColors(NEUTRAL);
        const src = materials;
        world.add(new THREE.Mesh(bspGeometry(map.mesh), map.mesh.groups.map((g) => src.get([g.texture], true) ?? bspMat)));
        for (const p of propMeshes(map.props ?? [], map.pak ?? new Map(), (c) => src.get(c, false) ?? floorMat)) world.add(p);
        return { ...src.stats(), s3tc };
      }
      world.add(new THREE.Mesh(sceneryGeometry(map.brushes, map.killZ, theme.scenery), floorMat));
      for (const q of map.pushes ?? []) for (const b of q.brushes) world.add(new THREE.Mesh(boxGeometry(b), BOOST_MAT)); // boost pads show as a glow
      for (const b of map.brushes) world.add(new THREE.Mesh(b.kind === 'ramp' ? rampGeometry(b) : boxGeometry(b), b.kind === 'ramp' ? rampMat : floorMat));
      return null;
    },
    setKnife: (mesh: Parameters<typeof viewmodel.setKnife>[0]) => viewmodel.setKnife(mesh, renderer.extensions.has('EXT_texture_compression_bptc')),
    inspect: () => viewmodel.inspect(),
    setGame: (g: Parameters<typeof viewmodel.setGame>[0]) => viewmodel.setGame(g),
    setKnife16: (mdl: Parameters<typeof viewmodel.setKnife16>[0]) => viewmodel.setKnife16(mdl),
    attack: (kind: 'light' | 'heavy') => viewmodel.attack(kind),
    setFinish: (choice: Parameters<typeof viewmodel.setFinish>[0]) => viewmodel.setFinish(choice, renderer.extensions.has('EXT_texture_compression_bptc')),
    setOwn: (...a: Parameters<typeof viewmodel.setOwn>) => viewmodel.setOwn(...a),
    setShowViewmodel: (show: boolean) => (showViewmodel = show),
    setArms: (b: Parameters<typeof viewmodel.setArms>[0]) => viewmodel.setArms(b, renderer.extensions.has('EXT_texture_compression_bptc')),
    setRival(pos: Vec3 | null) {
      rival.visible = !!pos;
      if (pos) rival.position.copy(toThree(pos)).add(new THREE.Vector3(0, 36, 0));
    },
    // Extra field of view at speed, added on top of the player's own.
    setFovKick(k: number) {
      if (Math.abs(k - fovKick) < 0.02) return;
      fovKick = k;
      resize();
    },
    setGhost(pos: Vec3 | null) {
      ghost.visible = !!pos;
      if (pos) ghost.position.copy(toThree(pos)).add(new THREE.Vector3(0, 36, 0));
    },
    setFov(fov: number) {
      hfov = fov;
      resize();
    },
    draw(eye: Vec3, yaw: number, pitch: number, pose: Pose) {
      camera.position.copy(toThree(eye));
      sky.position.copy(camera.position);
      skybox?.position.copy(camera.position);
      camera.rotation.y = (yaw - 90) * DEG; // Source yaw 0 = +X; three's camera faces -Z
      camera.rotation.x = -pitch * DEG; // Source positive pitch looks down
      renderer.clear();
      renderer.render(scene, camera);
      if (showViewmodel && !viewmodel.empty()) {
        renderer.clearDepth();
        viewmodel.apply(pose);
        renderer.render(viewmodel.scene, viewmodel.camera);
      }
    },
    resize,
  };
}
