import { describe, it, expect } from 'vitest';
import { decodeQuaternion, decodeClip } from '../src/cs2anim';

// Encoder matching the decoder's layout: the largest component is dropped; the other three are stored in
// [-1/√2, 1/√2] as 15/15/16-bit values, with the dropped index in the top bits of the first two words.
const R = 1 / Math.SQRT2;
function encodeQuat(q: number[]): number[] {
  let big = 0;
  for (let i = 1; i < 4; i++) if (Math.abs(q[i]) > Math.abs(q[big])) big = i;
  const s = q[big] < 0 ? -1 : 1; // q and -q are the same rotation; make the dropped component positive
  const rest = q.map((v) => v * s).filter((_, i) => i !== big);
  const enc = (v: number, max: number) => Math.round(((v + R) / (2 * R)) * max);
  return [enc(rest[0], 0x7fff) | ((big & 2) << 14), enc(rest[1], 0x7fff) | ((big & 1) << 15), enc(rest[2], 0x7fff)];
}

describe('decodeQuaternion', () => {
  it.each([
    [[0, 0, 0, 1]],
    [[0.5, 0.5, 0.5, 0.5]],
    [[0.628, 0.645, -0.365, 0.236]],
    [[0, 0, 0.2, 0.98]],
  ])('round-trips %j', (q) => {
    const n = Math.hypot(...q);
    const unit = q.map((v) => v / n);
    const d = decodeQuaternion(encodeQuat(unit), 0);
    const dot = Math.abs(unit.reduce((s, v, i) => s + v * d[i], 0));
    expect(dot).toBeGreaterThan(0.99999);
  });
});

describe('decodeClip', () => {
  it('decodes animated and static tracks per frame', () => {
    // Track 0 static (constant rotation, range-start translation); track 1 animates rotation + translation.
    const q1 = [0, 0, Math.sin(0.25), Math.cos(0.25)];
    const u16 = [
      ...encodeQuat(q1), 0, 32768, 65535, // frame 0: track 1 rotation + translation (x=start, y≈mid, z=end)
      ...encodeQuat([0, 0, 0, 1]), 65535, 0, 0, // frame 1
    ];
    const data = new Uint8Array(new Uint16Array(u16).buffer);
    const setting = (staticAll: boolean) => ({
      m_translationRangeX: { m_flRangeStart: 1, m_flRangeLength: 10 },
      m_translationRangeY: { m_flRangeStart: 2, m_flRangeLength: 10 },
      m_translationRangeZ: { m_flRangeStart: 3, m_flRangeLength: 10 },
      m_scaleRange: { m_flRangeStart: 1, m_flRangeLength: 0.1 },
      m_constantRotation: [0, 0, 0, 1],
      m_bIsRotationStatic: staticAll,
      m_bIsTranslationStatic: staticAll,
      m_bIsScaleStatic: true,
    });
    const clip = decodeClip({
      m_nNumFrames: 2,
      m_flDuration: 1 / 30,
      m_compressedPoseData: data,
      m_compressedPoseOffsets: [0, 6],
      m_trackCompressionSettings: [setting(true), setting(false)],
    });
    expect(clip.frames).toBe(2);
    expect(clip.tracks).toBe(2);
    const at = (f: number, t: number) => Array.from(clip.poses.subarray((f * 2 + t) * 8, (f * 2 + t) * 8 + 8));
    expect(at(0, 0)).toEqual([1, 2, 3, 1, 0, 0, 0, 1]); // static: range starts, constant rotation, scale start
    const f0 = at(0, 1);
    expect(f0[0]).toBeCloseTo(1, 4);
    expect(f0[1]).toBeCloseTo(7, 3);
    expect(f0[2]).toBeCloseTo(13, 4);
    expect(Math.abs(f0[6] * q1[2] + f0[7] * q1[3])).toBeGreaterThan(0.9999);
    expect(at(1, 1)[0]).toBeCloseTo(11, 4);
  });
});
