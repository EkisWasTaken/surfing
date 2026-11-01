import * as THREE from 'three';
import type { Brush } from './brush';
import type { Vec3 } from './math';

// The only place Source coords (x fwd, y left, z up) become three.js coords (x, y up, z).
const toThree = (v: Vec3) => new THREE.Vector3(v.x, v.z, -v.y);
const DEG = Math.PI / 180;

// World-space 64u grid with simple directional shading, so speed and slope read clearly.
const material = new THREE.ShaderMaterial({
  uniforms: { color: { value: new THREE.Color(0x8fa3b8) } },
  vertexShader: /* glsl */ `
    varying vec3 vWorld; varying vec3 vNormal;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWorld = w.xyz; vNormal = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 color; varying vec3 vWorld; varying vec3 vNormal;
    float grid(vec2 p) { vec2 g = abs(fract(p / 64.0 - 0.5) - 0.5) / fwidth(p / 64.0); return 1.0 - min(min(g.x, g.y), 1.0); }
    void main() {
      vec3 n = abs(vNormal);
      float line = n.x > n.y && n.x > n.z ? grid(vWorld.yz) : n.y > n.z ? grid(vWorld.xz) : grid(vWorld.xy);
      float light = 0.45 + 0.55 * max(dot(normalize(vNormal), normalize(vec3(0.4, 1.0, 0.3))), 0.0);
      gl_FragColor = vec4(mix(color * light, vec3(0.08, 0.1, 0.14), line * 0.6), 1.0);
    }`,
});

export function rampGeometry(b: Brush): THREE.BufferGeometry {
  const { mins: o, maxs: m } = b;
  const left = b.side === 'left';
  const wallY = left ? o.y : m.y, footY = left ? m.y : o.y;
  // Triangle cross-section: bottom of wall, top of wall, slope foot; extruded along X.
  const tri = (x: number) => [toThree({ x, y: wallY, z: o.z }), toThree({ x, y: wallY, z: m.z }), toThree({ x, y: footY, z: o.z })];
  const [a0, a1, a2] = tri(o.x), [b0, b1, b2] = tri(m.x);
  const faces = [
    [a0, a2, a1], [b0, b1, b2], // end caps
    [a0, a1, b1], [a0, b1, b0], // wall
    [a1, a2, b2], [a1, b2, b1], // slope
    [a0, b0, b2], [a0, b2, a2], // bottom
  ];
  // Mirroring a right ramp into a left one flips handedness, so flip the winding back.
  const wound = left ? faces.map(([a, b, c]) => [a, c, b]) : faces;
  const pos = wound.flatMap((f) => f.flatMap((v) => [v.x, v.y, v.z]));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function boxGeometry(b: Brush): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(b.maxs.x - b.mins.x, b.maxs.z - b.mins.z, b.maxs.y - b.mins.y);
  const c = toThree({ x: (b.mins.x + b.maxs.x) / 2, y: (b.mins.y + b.maxs.y) / 2, z: (b.mins.z + b.maxs.z) / 2 });
  return g.translate(c.x, c.y, c.z);
}

function sky(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#2b4a78');
  grad.addColorStop(1, '#c9d9ea');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createRenderer(canvas: HTMLCanvasElement, brushes: Brush[]) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  const scene = new THREE.Scene();
  scene.background = sky();
  // ~90° horizontal at 4:3, CS:GO default.
  const camera = new THREE.PerspectiveCamera(74, 1, 4, 100000);
  camera.rotation.order = 'YXZ';
  for (const b of brushes) scene.add(new THREE.Mesh(b.kind === 'ramp' ? rampGeometry(b) : boxGeometry(b), material));

  const resize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  resize();

  return {
    draw(eye: Vec3, yaw: number, pitch: number) {
      camera.position.copy(toThree(eye));
      camera.rotation.y = (yaw - 90) * DEG; // Source yaw 0 = +X; three's camera faces -Z
      camera.rotation.x = -pitch * DEG; // Source positive pitch looks down
      renderer.render(scene, camera);
    },
    resize,
  };
}
