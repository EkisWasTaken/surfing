// CS2 (Source 2) model reader: static geometry + color textures from a .vmdl_c (embedded meshes, meshopt buffers).
// Positions stay in Source model space (inches, Z up).
import { MeshoptDecoder } from 'meshoptimizer';
import { parseKV3, resourceBlocks } from './kv3';
import { readVtex, Vtex } from './cs2';

export type Cs2Mesh = {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  groups: { start: number; count: number; material: string; texture: Vtex | null }[];
  // Skinned models only: 4 joints/weights per vertex, joints indexing `bones` (the model's bind skeleton).
  skin?: { joints: Uint16Array; weights: Float32Array; bones: Cs2Bone[] };
};
export type Cs2Bone = { name: string; parent: number; pos: number[]; rot: number[] }; // parent space, rot [x,y,z,w]
type Get = (path: string) => Uint8Array | undefined;
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

// DXGI formats seen in CS2 vertex layouts.
const R32G32B32_FLOAT = 6, R32G32_FLOAT = 16, R8G8B8A8_UNORM = 28, R8G8B8A8_UINT = 30, R16G16_FLOAT = 34, R16G16_SNORM = 37;

const half = (h: number) => {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, f = h & 1023;
  return e === 0 ? s * 2 ** -14 * (f / 1024) : e === 31 ? 0 : s * 2 ** (e - 15) * (1 + f / 1024);
};

function decodeBuffer(desc: Any, raw: Uint8Array, isIndex: boolean): Uint8Array {
  const count = desc.m_nElementCount, size = desc.m_nElementSizeInBytes;
  if (!desc.m_bMeshoptCompressed) return raw.subarray(0, count * size);
  if (desc.m_bCompressedZSTD) throw new Error('cs2model: zstd-compressed buffers are not supported');
  const out = new Uint8Array(count * size);
  if (!isIndex) MeshoptDecoder.decodeVertexBuffer(out, count, size, raw);
  else if (desc.m_bMeshoptIndexSequence) MeshoptDecoder.decodeIndexSequence(out, count, size, raw);
  else MeshoptDecoder.decodeIndexBuffer(out, count, size, raw);
  return out;
}

function vertices(desc: Any, data: Uint8Array) {
  const n = desc.m_nElementCount, stride = desc.m_nElementSizeInBytes;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const field = (name: string) => (desc.m_inputLayoutFields as Any[]).find((f) => f.m_pSemanticName === name && f.m_nSemanticIndex === 0);
  const pos = field('POSITION'), uv = field('TEXCOORD'), bi = field('BLENDINDICES'), bw = field('blendweight') ?? field('BLENDWEIGHT');
  if (!pos || pos.m_Format !== R32G32B32_FLOAT) throw new Error('cs2model: unsupported position format');
  const positions = new Float32Array(n * 3), uvs = new Float32Array(n * 2);
  const joints = bi?.m_Format === R8G8B8A8_UINT ? new Uint16Array(n * 4) : null, weights = joints && new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * stride;
    for (let k = 0; k < 3; k++) positions[i * 3 + k] = dv.getFloat32(o + pos.m_nOffset + k * 4, true);
    if (joints && weights) {
      for (let k = 0; k < 4; k++) joints[i * 4 + k] = data[o + bi.m_nOffset + k];
      if (bw?.m_Format === R8G8B8A8_UNORM) for (let k = 0; k < 4; k++) weights[i * 4 + k] = data[o + bw.m_nOffset + k] / 255;
      else weights[i * 4] = 1;
    }
    if (!uv) continue;
    const u = o + uv.m_nOffset;
    const read =
      uv.m_Format === R32G32_FLOAT ? (k: number) => dv.getFloat32(u + k * 4, true)
      : uv.m_Format === R16G16_FLOAT ? (k: number) => half(dv.getUint16(u + k * 2, true))
      : uv.m_Format === R16G16_SNORM ? (k: number) => Math.max(-1, dv.getInt16(u + k * 2, true) / 32767)
      : () => 0;
    uvs[i * 2] = read(0);
    uvs[i * 2 + 1] = read(1);
  }
  return { positions, uvs, joints, weights, count: n };
}

// The color (albedo) texture of a .vmat, via its compiled _c resource.
function colorTexture(material: string, get: Get): Vtex | null {
  const vmat = get(material.toLowerCase() + '_c');
  const data = vmat && resourceBlocks(vmat).find((b) => b.type === 'DATA');
  if (!data) return null;
  const mat = parseKV3(data.data) as Any;
  const param = (mat.m_textureParams as Any[] | undefined)?.find((t) => t.m_name === 'g_tColor') ?? (mat.m_textureParams as Any[] | undefined)?.find((t) => /color/i.test(t.m_name));
  const tex = param && get(String(param.m_pValue).toLowerCase() + '_c');
  return tex ? readVtex(tex) : null;
}

// `only` picks one embedded mesh by name (e.g. arms models carry both "worldmodel" and "viewmodel").
export async function readCs2Mesh(vmdl: Uint8Array, get: Get, only?: string): Promise<Cs2Mesh> {
  await MeshoptDecoder.ready;
  const blocks = resourceBlocks(vmdl);
  const ctrlBlock = blocks.find((b) => b.type === 'CTRL');
  if (!ctrlBlock) throw new Error('cs2model: no CTRL block (not an embedded-mesh model)');
  const ctrl = parseKV3(ctrlBlock.data) as Any;
  const dataBlock = blocks.find((b) => b.type === 'DATA');
  const model = dataBlock ? (parseKV3(dataBlock.data) as Any) : null;
  const remap = model?.m_remappingTable as ArrayLike<number> | undefined;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [], jt: number[] = [], wt: number[] = [];
  const groups: Cs2Mesh['groups'] = [];
  for (const em of ctrl.embedded_meshes as Any[]) {
    if (only && em.m_Name !== only) continue;
    const remapStart = Number(model?.m_remappingTableStarts?.[em.m_nMeshIndex] ?? 0);
    const vbs = (em.m_vertexBuffers as Any[]).map((d) => ({ d, base: -1, v: vertices(d, decodeBuffer(d, blocks[d.m_nBlockIndex].data, false)) }));
    const ibs = (em.m_indexBuffers as Any[]).map((d) => {
      const bytes = decodeBuffer(d, blocks[d.m_nBlockIndex].data, true);
      return d.m_nElementSizeInBytes === 4 ? new Uint32Array(bytes.buffer, bytes.byteOffset, d.m_nElementCount) : new Uint16Array(bytes.buffer, bytes.byteOffset, d.m_nElementCount);
    });
    const mdat = parseKV3(blocks[em.m_nDataBlock].data) as Any;
    for (const so of mdat.m_sceneObjects as Any[])
      for (const dc of so.m_drawCalls as Any[]) {
        const vb = vbs[dc.m_vertexBuffers[0].m_hBuffer];
        if (vb.base < 0) {
          vb.base = pos.length / 3;
          for (const x of vb.v.positions) pos.push(x);
          for (const x of vb.v.uvs) uv.push(x);
          // Mesh-local joint indices go through the model's remapping table to model skeleton bones.
          if (vb.v.joints && vb.v.weights && remap) for (let k = 0; k < vb.v.joints.length; k++) jt.push(Number(remap[remapStart + vb.v.joints[k]])), wt.push(vb.v.weights[k]);
        }
        const ib = ibs[dc.m_indexBuffer.m_hBuffer];
        const first = dc.m_indexBuffer.m_nBindOffsetBytes / ib.BYTES_PER_ELEMENT + dc.m_nStartIndex;
        const vbOffset = dc.m_vertexBuffers[0].m_nBindOffsetBytes / vb.d.m_nElementSizeInBytes;
        const start = idx.length;
        for (let i = 0; i < dc.m_nIndexCount; i++) idx.push(vb.base + vbOffset + dc.m_nBaseVertex + ib[first + i]);
        groups.push({ start, count: dc.m_nIndexCount, material: String(dc.m_material), texture: colorTexture(String(dc.m_material), get) });
      }
  }
  const sk = model?.m_modelSkeleton;
  const skin = jt.length && jt.length === pos.length / 3 * 4 && sk
    ? {
        joints: new Uint16Array(jt),
        weights: new Float32Array(wt),
        bones: (sk.m_boneName as string[]).map((name, i) => ({ name, parent: Number(sk.m_nParent[i]), pos: Array.from(sk.m_bonePosParent[i] as number[], Number), rot: Array.from(sk.m_boneRotParent[i] as number[], Number) })),
      }
    : undefined;
  return { positions: new Float32Array(pos), uvs: new Float32Array(uv), indices: new Uint32Array(idx), groups, skin };
}

// Compact JSON form (typed arrays as base64) so the import step can hand meshes to the browser.
export const b64 = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
export const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const bytesOf = (a: Float32Array | Uint32Array | Uint16Array) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

export type Cs2MeshJson = ReturnType<typeof meshToJson>;

export function meshToJson(m: Cs2Mesh) {
  return {
    positions: b64(bytesOf(m.positions)),
    uvs: b64(bytesOf(m.uvs)),
    indices: b64(bytesOf(m.indices)),
    skin: m.skin && { joints: b64(bytesOf(m.skin.joints)), weights: b64(bytesOf(m.skin.weights)), bones: m.skin.bones },
    groups: m.groups.map((g) => ({
      start: g.start,
      count: g.count,
      material: g.material,
      texture: g.texture && { width: g.texture.width, height: g.texture.height, format: g.texture.format, mips: g.texture.mips.map((x) => ({ width: x.width, height: x.height, data: b64(x.data) })) },
    })),
  };
}

export function meshFromJson(j: Cs2MeshJson): Cs2Mesh {
  return {
    positions: new Float32Array(unb64(j.positions).buffer),
    uvs: new Float32Array(unb64(j.uvs).buffer),
    indices: new Uint32Array(unb64(j.indices).buffer),
    skin: j.skin && { joints: new Uint16Array(unb64(j.skin.joints).buffer), weights: new Float32Array(unb64(j.skin.weights).buffer), bones: j.skin.bones },
    groups: j.groups.map((g) => ({ ...g, texture: g.texture && { ...g.texture, mips: g.texture.mips.map((x) => ({ ...x, data: unb64(x.data) })) } })),
  };
}
