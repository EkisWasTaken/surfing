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
};
type Get = (path: string) => Uint8Array | undefined;
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

// DXGI formats seen in CS2 vertex layouts.
const R32G32B32_FLOAT = 6, R32G32_FLOAT = 16, R16G16_FLOAT = 34, R16G16_SNORM = 37;

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
  const pos = field('POSITION'), uv = field('TEXCOORD');
  if (!pos || pos.m_Format !== R32G32B32_FLOAT) throw new Error('cs2model: unsupported position format');
  const positions = new Float32Array(n * 3), uvs = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const o = i * stride;
    for (let k = 0; k < 3; k++) positions[i * 3 + k] = dv.getFloat32(o + pos.m_nOffset + k * 4, true);
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
  return { positions, uvs, count: n };
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

export async function readCs2Mesh(vmdl: Uint8Array, get: Get): Promise<Cs2Mesh> {
  await MeshoptDecoder.ready;
  const blocks = resourceBlocks(vmdl);
  const ctrlBlock = blocks.find((b) => b.type === 'CTRL');
  if (!ctrlBlock) throw new Error('cs2model: no CTRL block (not an embedded-mesh model)');
  const ctrl = parseKV3(ctrlBlock.data) as Any;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const groups: Cs2Mesh['groups'] = [];
  for (const em of ctrl.embedded_meshes as Any[]) {
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
        }
        const ib = ibs[dc.m_indexBuffer.m_hBuffer];
        const first = dc.m_indexBuffer.m_nBindOffsetBytes / ib.BYTES_PER_ELEMENT + dc.m_nStartIndex;
        const vbOffset = dc.m_vertexBuffers[0].m_nBindOffsetBytes / vb.d.m_nElementSizeInBytes;
        const start = idx.length;
        for (let i = 0; i < dc.m_nIndexCount; i++) idx.push(vb.base + vbOffset + dc.m_nBaseVertex + ib[first + i]);
        groups.push({ start, count: dc.m_nIndexCount, material: String(dc.m_material), texture: colorTexture(String(dc.m_material), get) });
      }
  }
  return { positions: new Float32Array(pos), uvs: new Float32Array(uv), indices: new Uint32Array(idx), groups };
}
