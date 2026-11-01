import { describe, it, expect } from 'vitest';
import { uniformRandom, seededVectors, compmatInfo, finishParams, readLocalization, Finish } from '../src/cs2finish';

describe('uniformRandom', () => {
  it('is deterministic per seed, stays in range, and differs between seeds', () => {
    const a = uniformRandom(42), b = uniformRandom(42), c = uniformRandom(43);
    const xs = Array.from({ length: 50 }, () => a(-65, -55));
    expect(xs).toEqual(Array.from({ length: 50 }, () => b(-65, -55)));
    expect(xs.every((x) => x >= -65 && x <= -55)).toBe(true);
    expect(c(-65, -55)).not.toBe(xs[0]);
  });
  it('treats seed 0 like 1, as the stream clamps it', () => {
    expect(uniformRandom(0)(0, 1)).toBe(uniformRandom(1)(0, 1));
  });
});

describe('seededVectors', () => {
  const finish: Finish = {
    id: 'x', name: 'X', style: 4, ints: {}, wear: [0, 1],
    floats: { g_flPatternTexCoordRotation: -50 },
    vectors: { g_vPatternTexCoordOffset: [0, 0, 7, 9] },
    ranges: [
      { name: 'g_flPatternTexCoordRotation', min: [-50], max: [-70] },
      { name: 'g_vPatternTexCoordOffset', min: [0, 0], max: [0, 1] },
    ],
  };
  it('replaces ranged values with seeded picks and keeps the rest', () => {
    const { floats, vectors } = seededVectors(finish, 123);
    expect(floats.g_flPatternTexCoordRotation).toBeLessThanOrEqual(-50);
    expect(floats.g_flPatternTexCoordRotation).toBeGreaterThanOrEqual(-70);
    expect(vectors.g_vPatternTexCoordOffset[0]).toBe(0);
    expect(vectors.g_vPatternTexCoordOffset.slice(2)).toEqual([7, 9]);
    expect(seededVectors(finish, 123)).toEqual({ floats, vectors });
    expect(finish.floats.g_flPatternTexCoordRotation).toBe(-50); // the finish itself is untouched
  });
});

describe('finish file parsing', () => {
  it('reads the paint vmat params', () => {
    const p = finishParams({
      m_intParams: [{ m_name: 'F_PAINT_STYLE', m_nValue: 5 }],
      m_floatParams: [{ m_name: 'g_flPatternTexCoordScale', m_flValue: 1.5 }],
      m_vectorParams: [{ m_name: 'g_vColor0', m_value: [1, 0.5, 0, 1] }],
      m_textureParams: [{ m_name: 'g_tPattern', m_pValue: 'a/fade.vtex' }],
    });
    expect(p).toMatchObject({ style: 5, floats: { g_flPatternTexCoordScale: 1.5 }, vectors: { g_vColor0: [1, 0.5, 0, 1] }, textures: { g_tPattern: 'a/fade.vtex' } });
  });
  it('finds the paint material and seed ranges in a vcompmat', () => {
    const info = compmatInfo({
      m_Points: [{ m_vecCompositeMaterialAssemblyProcedures: [{ m_vecCompositeInputContainers: [
        { m_strAlias: 'econ_instance', m_vecLooseVariables: [
          { m_strName: 'g_vPatternTexCoordOffset', m_nVariableType: 'LOOSE_VARIABLE_TYPE_FLOAT2', m_bHasFloatBounds: true, m_flValueFloatX_Min: 0, m_flValueFloatX_Max: 1, m_flValueFloatY_Min: 0, m_flValueFloatY_Max: 0.5 },
          { m_strName: 'unbounded', m_nVariableType: 'LOOSE_VARIABLE_TYPE_FLOAT1', m_bHasFloatBounds: false },
        ] },
        { m_strAlias: 'paint', m_strSpecificContainerMaterial: 'materials/x/hy_ddpat.vmat' },
      ] }] }],
    });
    expect(info).toEqual({ vmat: 'materials/x/hy_ddpat.vmat', ranges: [{ name: 'g_vPatternTexCoordOffset', min: [0, 0], max: [1, 0.5] }] });
  });
  it('reads localization tokens case-insensitively, first one wins', () => {
    const loc = readLocalization('"lang"\r\n{\r\n\t"PaintKit_aa_fade_Tag"\t\t"Fade"\r\n\t"paintkit_aa_fade_tag"\t"Other"\r\n\t"Quoted"\t"Say \\"hi\\""\r\n}');
    expect(loc.get('paintkit_aa_fade_tag')).toBe('Fade');
    expect(loc.get('quoted')).toBe('Say \\"hi\\"');
  });
});
