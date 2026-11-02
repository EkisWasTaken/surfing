import { sandbox } from './sandbox';
import { spire } from './spire';
import { switchback } from './switchback';
import { cascade } from './cascade';
import { longdrop } from './longdrop';
import { hairpin } from './hairpin';
import type { MapDef } from './build';

export type { MapDef };
export const maps: MapDef[] = [sandbox, cascade, longdrop, hairpin, spire, switchback];
export const findMap = (id: string) => maps.find((m) => m.id === id) ?? maps[0];
