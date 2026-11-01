import { sandbox } from './sandbox';
import { spire } from './spire';
import { switchback } from './switchback';
import type { MapDef } from './build';

export type { MapDef };
export const maps: MapDef[] = [sandbox, spire, switchback];
export const findMap = (id: string) => maps.find((m) => m.id === id) ?? maps[0];
