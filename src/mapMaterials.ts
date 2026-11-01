// three.js materials for an imported map's own textures (decoded from its pakfile).
import * as THREE from 'three';
import type { Vtf } from './vtf';
import { parseVtf, decodeDxt } from './vtf';
import { resolveMaterial, FileSource } from './materials';

// The map's own fog (env_fog_controller); fogMax 0 = no fog, like CS:GO maps without a controller.
export type Fog = { fogColor: { value: THREE.Color }; fogStart: { value: number }; fogEnd: { value: number }; fogMax: { value: number } };
export const FOG_GLSL = /* glsl */ `
  uniform vec3 fogColor; uniform float fogStart; uniform float fogEnd; uniform float fogMax;
  vec3 applyFog(vec3 c, vec3 world) {
    float f = fogMax * clamp((length(world - cameraPosition) - fogStart) / max(fogEnd - fogStart, 1.0), 0.0, 1.0);
    return mix(c, fogColor, f);
  }`;

const S3TC: Record<string, THREE.CompressedPixelFormat> = {
  dxt1: THREE.RGB_S3TC_DXT1_Format,
  dxt1a: THREE.RGBA_S3TC_DXT1_Format,
  dxt3: THREE.RGBA_S3TC_DXT3_Format,
  dxt5: THREE.RGBA_S3TC_DXT5_Format,
};

// Textures are uploaded as raw (linear-format) data and the shader applies the sRGB curve itself, so nothing
// depends on WEBGL_compressed_texture_s3tc_srgb. Without S3TC at all (e.g. software rendering), DXT is decoded on the CPU.
function toTexture(v: Vtf, s3tc: boolean): { texture: THREE.Texture; cpu: boolean } {
  let t: THREE.Texture;
  const gpu = v.format !== 'rgba' && s3tc && !(v.width % 4) && !(v.height % 4);
  if (gpu) t = new THREE.CompressedTexture(v.mips as unknown as ImageData[], v.width, v.height, S3TC[v.format]);
  else {
    t = new THREE.DataTexture(v.format === 'rgba' ? v.mips[0].data : decodeDxt(v), v.mips[0].width, v.mips[0].height, THREE.RGBAFormat);
    t.generateMipmaps = true;
  }
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return { texture: t, cpu: !gpu && v.format !== 'rgba' };
}

// lightmap: the map's baked light atlas (world faces, which carry an lmUv attribute); null for props.
function texturedMaterial(map: THREE.Texture, alphatest: boolean, translucent: boolean, sun: THREE.Vector3, fog: Fog, lightmap: THREE.Texture | null) {
  const defines: Record<string, number> = {};
  if (alphatest) defines.ALPHATEST = 1;
  if (lightmap) defines.LIGHTMAP = 1;
  return new THREE.ShaderMaterial({
    transparent: translucent,
    depthWrite: !translucent,
    defines,
    uniforms: { map: { value: map }, lightmap: { value: lightmap }, exposure: { value: lightmap?.userData.exposure ?? 1 }, sun: { value: sun }, ...fog },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vNormal; varying vec3 vWorld;
      #ifdef LIGHTMAP
        attribute vec2 lmUv; varying vec2 vLm;
      #endif
      void main() {
        vUv = uv;
        #ifdef LIGHTMAP
          vLm = lmUv;
        #endif
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz; vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map; uniform sampler2D lightmap; uniform float exposure; uniform vec3 sun;
      ${FOG_GLSL}
      varying vec2 vUv; varying vec3 vNormal; varying vec3 vWorld;
      #ifdef LIGHTMAP
        varying vec2 vLm;
      #endif
      void main() {
        vec4 tex = texture2D(map, vUv);
        tex.rgb = mix(tex.rgb / 12.92, pow((tex.rgb + 0.055) / 1.055, vec3(2.4)), step(0.04045, tex.rgb)); // sRGB → linear
        #ifdef ALPHATEST
          if (tex.a < 0.5) discard;
        #endif
        #ifdef LIGHTMAP
          // Baked light (stored as sqrt(light / 4)), multiplied with the albedo like Source's LightmappedGeneric.
          vec3 l = texture2D(lightmap, vLm).rgb;
          vec3 lit = tex.rgb * l * l * 4.0 * exposure;
        #else
          // Props have no lightmap: mostly unlit with a little sun shading for depth.
          vec3 lit = tex.rgb * (0.72 + 0.38 * max(dot(normalize(vNormal), sun), 0.0));
        #endif
        gl_FragColor = vec4(applyFog(lit, vWorld), tex.a);
        #include <colorspace_fragment>
      }`,
  });
}

// One material per texture group; null where the texture isn't packed or can't be decoded.
// Builds materials from a map's pakfile, caching by resolved name so props sharing a texture share a material.
export function createMaterialSource(pak: Map<string, Uint8Array>, s3tc: boolean, sun: THREE.Vector3, fog: Fog, lightmap: THREE.Texture | null) {
  const cache = new Map<string, THREE.Material | null>();
  const stats = { gpu: 0, cpu: 0, missing: 0 };
  const build = (name: string, lit: boolean): THREE.Material | null => {
    const mat = make(name, lit);
    if (!mat) stats.missing++;
    return mat;
  };
  const make = (name: string, lit: boolean): THREE.Material | null => {
    const lm = lit ? lightmap : null;
    const m = resolveMaterial(name, pak);
    if (!m) return null;
    if (!m.vtf) {
      // Texture-less tinted material: a 1×1 texture of its color.
      const c = m.color!.map((v) => Math.round(v * 255));
      const t = new THREE.DataTexture(new Uint8Array([c[0], c[1], c[2], 255]), 1, 1, THREE.RGBAFormat);
      t.needsUpdate = true;
      stats.gpu++;
      return texturedMaterial(t, false, false, sun, fog, lm);
    }
    const v = parseVtf(m.vtf);
    if (!v) return null;
    const { texture, cpu } = toTexture(v, s3tc);
    stats[cpu ? 'cpu' : 'gpu']++;
    return texturedMaterial(texture, m.alphatest, m.translucent, sun, fog, lm);
  };
  return {
    // First candidate path that resolves wins (models list one per cdmaterials dir).
    // lit = world faces (use the lightmap); props pass false.
    get(candidates: string[], lit: boolean): THREE.Material | null {
      for (const name of candidates) {
        const k = name.toLowerCase() + (lit ? '#lit' : '');
        if (!cache.has(k)) cache.set(k, build(name, lit));
        const mat = cache.get(k);
        if (mat) return mat;
      }
      return null;
    },
    // Distinct textures built (world and props counted separately): on the GPU, decoded on the CPU, or not found.
    stats: () => ({ ...stats }),
    dispose() {
      for (const m of cache.values()) {
        if (!m) continue;
        (m as THREE.ShaderMaterial).uniforms.map?.value?.dispose();
        m.dispose();
      }
      cache.clear();
    },
  };
}

// A skybox face texture (materials/skybox/<sky><face>), clamped so the cube's seams don't bleed.
export function skyTexture(name: string, pak: FileSource, s3tc: boolean): THREE.Texture | null {
  const m = resolveMaterial(name, pak);
  const v = m?.vtf && parseVtf(m.vtf);
  if (!v) return null;
  const { texture } = toTexture(v, s3tc);
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}
