// Resolves a texture/material name to its base texture (.vtf bytes) using materials packed in the map.
// Materials with no base texture but a color tint ($color2/$color) resolve to a solid color instead.
export type ResolvedMaterial = { vtf: Uint8Array | null; color?: number[]; alphatest: boolean; translucent: boolean };

const dec = new TextDecoder('latin1');
const norm = (p: string) =>
  p.toLowerCase().replace(/\\/g, '/').replace(/^\/+/, '').replace(/^materials\//, '').replace(/\.(vmt|vtf)$/, '');

// KeyValues lookup tolerant of quoted/unquoted keys and values.
function key(text: string, k: string): string | null {
  const m = text.match(new RegExp(`"?${k.replace('$', '\\$')}"?\\s+"?([^"\\s{}]+)"?`, 'i'));
  return m ? m[1] : null;
}

// "{r g b}" (0–255) or "[r g b]" (0–1) → linear-ish 0–1 triple.
function color(text: string): number[] | null {
  const m = text.match(/"?\$color2?"?\s+"?([{[])\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*[}\]]/i);
  if (!m) return null;
  const s = m[1] === '{' ? 255 : 1;
  return [m[2], m[3], m[4]].map((v) => Math.min(1, Number(v) / s));
}

export function resolveMaterial(name: string, pak: Map<string, Uint8Array>): ResolvedMaterial | null {
  const vmt = (path: string) => {
    const b = pak.get(`materials/${norm(path)}.vmt`);
    return b ? dec.decode(b) : null;
  };
  let text = vmt(name);
  if (!text) return null;
  // vbsp writes cubemap "patch" materials that include the real one; follow up to a few levels.
  let all = text;
  for (let i = 0; i < 3 && !key(text, '$basetexture'); i++) {
    const inc = key(text, 'include');
    const next = inc && vmt(inc);
    if (!next) break;
    text = next;
    all += '\n' + next;
  }
  const flags = { alphatest: key(all, '$alphatest') === '1', translucent: key(all, '$translucent') === '1' };
  const base = key(all, '$basetexture');
  const vtf = base && pak.get(`materials/${norm(base)}.vtf`);
  if (vtf) return { vtf, ...flags };
  const c = color(all);
  return c ? { vtf: null, color: c, ...flags } : null;
}
