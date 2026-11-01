// Resolves a BSP texture name to its base texture (.vtf bytes) using materials packed in the map.
export type ResolvedMaterial = { vtf: Uint8Array; alphatest: boolean; translucent: boolean };

const dec = new TextDecoder('latin1');
const norm = (p: string) => p.toLowerCase().replace(/\\/g, '/').replace(/^materials\//, '').replace(/\.(vmt|vtf)$/, '');

// KeyValues lookup tolerant of quoted/unquoted keys and values.
function key(text: string, k: string): string | null {
  const m = text.match(new RegExp(`"?${k.replace('$', '\\$')}"?\\s+"?([^"\\s{}]+)"?`, 'i'));
  return m ? m[1] : null;
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
  const base = key(all, '$basetexture');
  const vtf = base && pak.get(`materials/${norm(base)}.vtf`);
  if (!vtf) return null;
  return { vtf, alphatest: key(all, '$alphatest') === '1', translucent: key(all, '$translucent') === '1' };
}
