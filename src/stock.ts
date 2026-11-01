// Collects the stock game files (from CS:GO's own archives) that a map uses but doesn't pack itself:
// surface materials/textures, plus stock prop models and their materials.
import type { BspMap } from './bsp';
import { resolveMaterial, FileSource } from './materials';
import { parseModel } from './mdl';

export function stockFilesFor(bsp: BspMap, lookup: (path: string) => Uint8Array | undefined): Map<string, Uint8Array> {
  const taken = new Map<string, Uint8Array>();
  // The map's own files win; anything read from the archive is recorded for the bundle.
  const source: FileSource = {
    get(path) {
      const own = bsp.pak.get(path);
      if (own) return own;
      const data = taken.get(path) ?? lookup(path);
      if (data) taken.set(path, data);
      return data;
    },
  };
  for (const g of bsp.mesh.groups) resolveMaterial(g.texture, source);
  for (const model of new Set(bsp.props.map((p) => p.model))) {
    const base = model.replace(/\.mdl$/, '');
    const mdl = source.get(model), vvd = source.get(base + '.vvd');
    const vtx = ['.dx90.vtx', '.vtx'].map((e) => source.get(base + e)).find(Boolean);
    const mesh = mdl && vvd && vtx ? parseModel(mdl, vvd, vtx) : null;
    for (const gr of mesh?.groups ?? []) gr.materials.some((c) => resolveMaterial(c, source));
  }
  return taken;
}
