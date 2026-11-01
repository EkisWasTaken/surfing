// three.js materials for an imported map's own textures (decoded from its pakfile).
import * as THREE from 'three';
import type { Vtf } from './vtf';
import { parseVtf } from './vtf';
import { resolveMaterial } from './materials';

const S3TC: Record<string, THREE.CompressedPixelFormat> = {
  dxt1: THREE.RGB_S3TC_DXT1_Format,
  dxt1a: THREE.RGBA_S3TC_DXT1_Format,
  dxt3: THREE.RGBA_S3TC_DXT3_Format,
  dxt5: THREE.RGBA_S3TC_DXT5_Format,
};

function toTexture(v: Vtf, s3tc: boolean): THREE.Texture | null {
  let t: THREE.Texture;
  if (v.format === 'rgba') {
    t = new THREE.DataTexture(v.mips[0].data, v.width, v.height, THREE.RGBAFormat);
    t.generateMipmaps = true;
  } else {
    // WebGL needs block-aligned DXT dimensions; skip odd ones rather than render garbage.
    if (!s3tc || v.width % 4 || v.height % 4) return null;
    t = new THREE.CompressedTexture(v.mips as unknown as ImageData[], v.width, v.height, S3TC[v.format]);
  }
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

function texturedMaterial(map: THREE.Texture, alphatest: boolean, translucent: boolean, sun: THREE.Vector3, haze: THREE.Color) {
  return new THREE.ShaderMaterial({
    transparent: translucent,
    depthWrite: !translucent,
    defines: alphatest ? { ALPHATEST: 1 } : {},
    uniforms: { map: { value: map }, sun: { value: sun }, haze: { value: haze } },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vNormal; varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz; vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map; uniform vec3 sun; uniform vec3 haze;
      varying vec2 vUv; varying vec3 vNormal; varying vec3 vWorld;
      void main() {
        vec4 tex = texture2D(map, vUv);
        #ifdef ALPHATEST
          if (tex.a < 0.5) discard;
        #endif
        // No lightmaps yet: mostly unlit like a fullbright map, with a little sun shading for depth.
        float shade = 0.72 + 0.38 * max(dot(normalize(vNormal), sun), 0.0);
        float fog = 1.0 - exp(-length(vWorld - cameraPosition) / 30000.0);
        gl_FragColor = vec4(mix(tex.rgb * shade, haze, fog * 0.6), tex.a);
        #include <colorspace_fragment>
      }`,
  });
}

// One material per texture group; null where the texture isn't packed or can't be decoded.
export function mapMaterials(textures: string[], pak: Map<string, Uint8Array>, s3tc: boolean, sun: THREE.Vector3, haze: THREE.Color): (THREE.Material | null)[] {
  return textures.map((name) => {
    const m = resolveMaterial(name, pak);
    const v = m && parseVtf(m.vtf);
    const t = v && toTexture(v, s3tc);
    return t ? texturedMaterial(t, m!.alphatest, m!.translucent, sun, haze) : null;
  });
}
