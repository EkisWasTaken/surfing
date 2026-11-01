// Paints a CS2 finish onto a knife material, after CS:GO's customweapon shader: the paint kit's colours and pattern,
// laid on where the knife's mask (red) allows, with wear scratching paint off and grunge creeping in as the float rises.
import * as THREE from 'three';
import type { Vtex } from './cs2';
import { Finish, seededVectors } from './cs2finish';

export type PaintInputs = { masks: Vtex; ao: Vtex; pos: Vtex; uvScale: number; weaponLength: number };
export type FinishShared = { wear: Vtex | null; grunge: Vtex | null };

export function texture(t: Vtex, bptc: boolean, wrap: THREE.Wrapping = THREE.RepeatWrapping): THREE.Texture | null {
  const m = t.mips[0];
  let tex: THREE.Texture;
  if (t.format === 'r8') tex = new THREE.DataTexture(m.data, m.width, m.height, THREE.RedFormat);
  else if (t.format === 'rgba8') tex = new THREE.DataTexture(m.data, m.width, m.height, THREE.RGBAFormat);
  else if (t.format === 'rgba16f') tex = new THREE.DataTexture(new Uint16Array(m.data.buffer, m.data.byteOffset, m.data.byteLength / 2), m.width, m.height, THREE.RGBAFormat, THREE.HalfFloatType);
  else {
    const format = t.format === 'bc7' ? (bptc ? THREE.RGBA_BPTC_Format : null) : t.format === 'dxt1' ? THREE.RGB_S3TC_DXT1_Format : THREE.RGBA_S3TC_DXT5_Format;
    if (format === null) return null;
    tex = new THREE.CompressedTexture(t.mips as unknown as ImageData[], t.width, t.height, format);
  }
  // Single-level textures can't use mipmap filtering (they'd sample as incomplete → black).
  tex.minFilter = t.mips.length > 1 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = wrap;
  tex.needsUpdate = true;
  return tex;
}

const GLSL = /* glsl */ `
uniform sampler2D fMasks, fAO, fPos, fPattern, fWear, fGrunge;
uniform int fStyle;
uniform vec3 fColor0, fColor1, fColor2, fColor3;
uniform float fBrightness, fPatternScale, fPatternRot, fUvScale, fWearAmount, fPaintRough, fWearScale, fWearRot, fGrungeScale, fGrungeRot;
uniform vec2 fPatternOffset, fWearOffset, fGrungeOffset;
uniform bool fIgnoreSize, fHasGrunge;
float finishMetal, finishRough;
vec3 srgbToLinear(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }
vec2 rot2(vec2 p, float deg) { float a = radians(deg), c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
// Pattern transform in -1..1 space: rotate and scale about the centre, offset, then back to 0..1.
// (Matches Fade's numbers: offset -0.7 puts the blade on the orange-to-pink part of the gradient.)
vec2 patternUv(vec2 p) { return 0.5 * (rot2(p * 2.0 - 1.0, fPatternRot) * fPatternScale + fPatternOffset) + 0.5; }
`;

// Fragment: replaces three's base-map sampling.
const PAINT = /* glsl */ `
vec4 base = texture2D(map, vMapUv);
vec4 masks = texture2D(fMasks, vMapUv);
float ao = texture2D(fAO, vMapUv).g;
vec2 uvP;
if (fStyle == 2 || fStyle == 5) {
  // Spray / airbrushed: projected from the side through the knife's object-space position map.
  vec3 pos = texture2D(fPos, vMapUv).rgb;
  uvP = patternUv((pos.yz - 0.5) / fUvScale + 0.5); // position is normalised to the knife; uvScale brings it to paint scale
} else if (fStyle == 6 || fStyle == 8) {
  uvP = vMapUv; // custom paints are drawn on this knife's own UV sheet
} else {
  uvP = patternUv(vMapUv * (fIgnoreSize ? 1.0 : fUvScale));
}
vec4 pat = texture2D(fPattern, uvP);
vec3 c0 = srgbToLinear(fColor0), c1 = srgbToLinear(fColor1), c2 = srgbToLinear(fColor2), c3 = srgbToLinear(fColor3);
vec3 paint = c0;
if (fStyle == 1 || fStyle == 2 || fStyle == 4 || fStyle == 5) paint = mix(mix(mix(c0, c1, pat.r), c2, pat.g), c3, pat.b);
else if (fStyle >= 6) paint = srgbToLinear(pat.rgb);
paint *= fBrightness;
bool metal = fStyle == 3 || fStyle == 4 || fStyle == 5 || fStyle == 8;
// Wear: the brightest wear texels lose their paint first; grunge darkens as the float rises.
float wearTex = texture2D(fWear, rot2(vMapUv * fWearScale, fWearRot) + fWearOffset).r;
float edge = 1.0 - fWearAmount * 0.45; // shortcut: tuned by eye against CS2 previews, not Valve's exact curve
float keep = 1.0 - smoothstep(edge - 0.03, edge + 0.03, wearTex);
float paintAmt = masks.r * keep * (fStyle >= 6 ? max(pat.a, 0.0) : 1.0);
vec3 col = mix(base.rgb, paint, paintAmt) * mix(1.0, ao, paintAmt);
if (fHasGrunge) col *= mix(vec3(1.0), srgbToLinear(texture2D(fGrunge, rot2(vMapUv * fGrungeScale, fGrungeRot) + fGrungeOffset).rgb), fWearAmount * paintAmt);
diffuseColor.rgb *= col;
finishMetal = mix(metalness, metal ? 1.0 : 0.0, paintAmt);
finishRough = mix(roughness, fPaintRough + fWearAmount * 0.3, paintAmt);
`;

const black = new THREE.DataTexture(new Uint8Array(4), 1, 1);
black.needsUpdate = true;

// A material that paints `finish` over the knife's base texture; null when the textures can't be used here.
export function finishMaterial(base: THREE.MeshStandardMaterial, inputs: PaintInputs, finish: Finish & { pattern: Vtex | null }, shared: FinishShared, bptc: boolean, wear: number, seed: number) {
  const masks = texture(inputs.masks, bptc), ao = texture(inputs.ao, bptc), pos = texture(inputs.pos, bptc, THREE.ClampToEdgeWrapping);
  // Pattern sampling: 0 tiles, 1 clamps, 2 mirrors (airbrushed gradients like Fade sit at a negative offset, mirrored back).
  const sampling = finish.ints.g_nPatternTextureHorizontalSampling ?? 0;
  const pattern = finish.pattern ? texture(finish.pattern, bptc, [THREE.RepeatWrapping, THREE.ClampToEdgeWrapping, THREE.MirroredRepeatWrapping][sampling] ?? THREE.RepeatWrapping) : black;
  const wearTex = shared.wear ? texture(shared.wear, bptc) : null, grunge = shared.grunge ? texture(shared.grunge, bptc) : null;
  if (!masks || !ao || !pos || !pattern || !wearTex || !base.map) return null;
  const { floats, vectors } = seededVectors(finish, seed);
  const v3 = (n: string, d = [1, 1, 1]) => new THREE.Vector3(...(vectors[n] ?? d).slice(0, 3));
  const v2 = (n: string) => new THREE.Vector2(...(vectors[n] ?? [0, 0]).slice(0, 2));
  const uniforms = {
    fMasks: { value: masks }, fAO: { value: ao }, fPos: { value: pos }, fPattern: { value: pattern }, fWear: { value: wearTex }, fGrunge: { value: grunge ?? black },
    fHasGrunge: { value: !!grunge },
    fStyle: { value: finish.style },
    fColor0: { value: v3('g_vColor0') }, fColor1: { value: v3('g_vColor1') }, fColor2: { value: v3('g_vColor2') }, fColor3: { value: v3('g_vColor3') },
    fBrightness: { value: floats.g_flColorBrightness ?? 1 },
    fPatternScale: { value: floats.g_flPatternTexCoordScale ?? 1 },
    fPatternRot: { value: floats.g_flPatternTexCoordRotation ?? 0 },
    fPatternOffset: { value: v2('g_vPatternTexCoordOffset') },
    fUvScale: { value: inputs.uvScale },
    fIgnoreSize: { value: !!finish.ints.g_bIgnoreWeaponSizeScale },
    fPaintRough: { value: floats.g_flPaintRoughness ?? 0.4 },
    // The float only exists inside the finish's range (e.g. Fade 0.00–0.08).
    fWearAmount: { value: Math.min(finish.wear[1], Math.max(finish.wear[0], wear)) },
    fWearScale: { value: floats.g_flWearTexCoordScale ?? 1 }, fWearRot: { value: floats.g_flWearTexCoordRotation ?? 0 }, fWearOffset: { value: v2('g_vWearTexCoordOffset') },
    fGrungeScale: { value: floats.g_flGrungeTexCoordScale ?? 1 }, fGrungeRot: { value: floats.g_flGrungeTexCoordRotation ?? 0 }, fGrungeOffset: { value: v2('g_vGrungeTexCoordOffset') },
  };
  const m = base.clone();
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = GLSL + shader.fragmentShader
      .replace('#include <map_fragment>', PAINT)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = finishMetal;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = finishRough;');
  };
  m.customProgramCacheKey = () => 'cs2finish';
  return m;
}
