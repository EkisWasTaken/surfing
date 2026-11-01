// CS2 weapon finishes (paint kits): parameters from the compiled paint .vmat (csgo_customweapon) and the
// per-item random ranges from the .vcompmat, which the pattern seed picks from with Valve's uniform random stream.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

// One randomized variable: picked in [min, max] per component, in file order (x then y).
export type FinishRange = { name: string; min: number[]; max: number[] };

export type Finish = {
  id: string;
  name: string;
  style: number; // F_PAINT_STYLE: 0 solid, 1 hydrographic, 2 spray, 3 anodized, 4 anodized multicolor, 5 anodized airbrushed, 6 custom, 7 antiqued, 8 gunsmith
  ints: Record<string, number>;
  floats: Record<string, number>;
  vectors: Record<string, number[]>;
  ranges: FinishRange[];
  wear: [number, number]; // the float range this finish exists in
};

export function finishParams(vmat: Any) {
  const ints: Record<string, number> = {}, floats: Record<string, number> = {}, vectors: Record<string, number[]> = {}, textures: Record<string, string> = {};
  for (const p of vmat.m_intParams ?? []) ints[p.m_name] = Number(p.m_nValue);
  for (const p of vmat.m_floatParams ?? []) floats[p.m_name] = Number(p.m_flValue);
  for (const p of vmat.m_vectorParams ?? []) vectors[p.m_name] = Array.from(p.m_value as number[], Number);
  for (const p of vmat.m_textureParams ?? []) textures[p.m_name] = String(p.m_pValue);
  return { style: ints.F_PAINT_STYLE ?? 0, ints, floats, vectors, textures };
}

// The vcompmat names the paint vmat and the seed-driven ranges ("econ_instance" loose variables).
export function compmatInfo(doc: Any): { vmat: string | null; ranges: FinishRange[] } {
  let vmat: string | null = null;
  const ranges: FinishRange[] = [];
  for (const point of doc.m_Points ?? [])
    for (const proc of point.m_vecCompositeMaterialAssemblyProcedures ?? [])
      for (const c of proc.m_vecCompositeInputContainers ?? []) {
        if (c.m_strAlias === 'paint' && c.m_strSpecificContainerMaterial && !vmat) vmat = String(c.m_strSpecificContainerMaterial);
        for (const v of c.m_vecLooseVariables ?? []) {
          if (!v.m_bHasFloatBounds) continue;
          const dims = String(v.m_nVariableType).endsWith('FLOAT2') ? 2 : 1;
          const axes = ['X', 'Y'].slice(0, dims);
          ranges.push({ name: String(v.m_strName), min: axes.map((a) => Number(v[`m_flValueFloat${a}_Min`])), max: axes.map((a) => Number(v[`m_flValueFloat${a}_Max`])) });
        }
      }
  return { vmat, ranges };
}

// Valve's CUniformRandomStream (Numerical Recipes ran1), as used to turn a pattern seed into offsets/rotations.
export function uniformRandom(seed: number) {
  const IA = 16807, IM = 2147483647, IQ = 127773, IR = 2836, NTAB = 32, NDIV = 1 + Math.floor((IM - 1) / NTAB);
  const AM = Math.fround(1 / IM), RNMX = Math.fround(1 - 1.2e-7);
  let idum = seed < 0 ? seed : -seed, iy = 0;
  const iv = new Array<number>(NTAB).fill(0);
  const step = () => {
    const k = Math.trunc(idum / IQ);
    idum = IA * (idum - k * IQ) - IR * k;
    if (idum < 0) idum += IM;
  };
  const next = () => {
    if (idum <= 0 || !iy) {
      idum = -idum < 1 ? 1 : -idum;
      for (let j = NTAB + 7; j >= 0; j--) {
        step();
        if (j < NTAB) iv[j] = idum;
      }
      iy = iv[0];
    }
    step();
    let j = Math.trunc(iy / NDIV);
    if (j >= NTAB || j < 0) j = (j % NTAB) & 0x7fffffff;
    iy = iv[j];
    iv[j] = idum;
    return iy;
  };
  return (lo: number, hi: number) => Math.fround(Math.min(RNMX, Math.fround(AM * next())) * (hi - lo) + lo);
}

// The finish's parameters for one pattern seed: each ranged variable replaced by its seeded pick.
export function seededVectors(f: Finish, seed: number) {
  const rand = uniformRandom(seed);
  const floats = { ...f.floats }, vectors = { ...f.vectors };
  for (const r of f.ranges) {
    const v = r.min.map((lo, i) => rand(lo, r.max[i]));
    if (v.length === 1) floats[r.name] = v[0];
    else vectors[r.name] = [...v, ...(vectors[r.name] ?? [0, 0, 0, 0]).slice(v.length)];
  }
  return { floats, vectors };
}

// "PaintKit_aa_fade" "Fade" lines from csgo_english.txt.
export function readLocalization(text: string) {
  const out = new Map<string, string>();
  for (const m of text.matchAll(/^\s*"([^"]+)"\s+"((?:[^"\\]|\\.)*)"/gm)) if (!out.has(m[1].toLowerCase())) out.set(m[1].toLowerCase(), m[2]);
  return out;
}
