// CS2 AnimGraph 2 clip decoder (.vnmclip_c DATA block), following ValveResourceFormat's AnimationClip.
// Output poses are local (parent-space) bone transforms per frame: [tx, ty, tz, scale, qx, qy, qz, qw].
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const MIN = -1 / Math.SQRT2, STEP = (2 / Math.SQRT2) / 0x7fff;

// Smallest-three quaternion: three stored components, the dropped (largest) one's index in the top bits.
export function decodeQuaternion(d: ArrayLike<number>, at: number): number[] {
  const a = (d[at] & 0x7fff) * STEP + MIN, b = (d[at + 1] & 0x7fff) * STEP + MIN, c = d[at + 2] * STEP + MIN;
  const w = Math.sqrt(Math.max(0, 1 - a * a - b * b - c * c));
  switch (((d[at] >> 14) & 2) | (d[at + 1] >> 15)) {
    case 0: return [w, a, b, c];
    case 1: return [a, w, b, c];
    case 2: return [a, b, w, c];
    default: return [a, b, c, w];
  }
}

export type Cs2Clip = { frames: number; tracks: number; duration: number; poses: Float32Array };

export function decodeClip(clip: Any): Cs2Clip {
  const settings = clip.m_trackCompressionSettings as Any[];
  const frames = Number(clip.m_nNumFrames), tracks = settings.length;
  const bytes = clip.m_compressedPoseData as Uint8Array;
  const data = new Uint16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + (bytes.byteLength & ~1)));
  const poses = new Float32Array(frames * tracks * 8);
  const unorm = (v: number, r: Any) => (v / 65535) * r.m_flRangeLength + r.m_flRangeStart;
  for (let f = 0; f < frames; f++) {
    let at = Number(clip.m_compressedPoseOffsets[f]);
    for (let t = 0; t < tracks; t++) {
      const s = settings[t], o = (f * tracks + t) * 8;
      const q = s.m_bIsRotationStatic ? Array.from(s.m_constantRotation as number[], Number) : decodeQuaternion(data, at);
      if (!s.m_bIsRotationStatic) at += 3;
      const rx = s.m_translationRangeX, ry = s.m_translationRangeY, rz = s.m_translationRangeZ;
      if (s.m_bIsTranslationStatic) poses.set([rx.m_flRangeStart, ry.m_flRangeStart, rz.m_flRangeStart], o);
      else poses.set([unorm(data[at], rx), unorm(data[at + 1], ry), unorm(data[at + 2], rz)], o), (at += 3);
      poses[o + 3] = s.m_bIsScaleStatic ? s.m_scaleRange.m_flRangeStart : unorm(data[at++], s.m_scaleRange);
      poses.set(q, o + 4);
    }
  }
  return { frames, tracks, duration: Number(clip.m_flDuration), poses };
}

export type NmSkeleton = { names: string[]; parents: number[]; ref: number[][] }; // ref: parent space, same layout as poses

export function readNmSkeleton(skel: Any): NmSkeleton {
  return {
    names: (skel.m_boneIDs as string[]).map(String),
    parents: Array.from(skel.m_parentIndices as number[], Number),
    ref: (skel.m_parentSpaceReferencePose as number[][]).map((r) => Array.from(r, Number)),
  };
}
