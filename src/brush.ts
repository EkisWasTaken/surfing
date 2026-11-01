import { Vec3, vec, add, dot, normalize } from './math';

// A point p is inside the brush when dot(normal, p) - dist <= 0 for every plane.
export type Plane = { normal: Vec3; dist: number };
export type Brush = { planes: Plane[]; mins: Vec3; maxs: Vec3; kind: 'box' | 'ramp'; side?: 'left' | 'right' };

const plane = (normal: Vec3, point: Vec3): Plane => ({ normal, dist: dot(normal, point) });

export function makeBox(mins: Vec3, maxs: Vec3): Brush {
  return {
    kind: 'box',
    mins,
    maxs,
    planes: [
      plane(vec(1, 0, 0), maxs), plane(vec(-1, 0, 0), mins),
      plane(vec(0, 1, 0), maxs), plane(vec(0, -1, 0), mins),
      plane(vec(0, 0, 1), maxs), plane(vec(0, 0, -1), mins),
    ],
  };
}

// Triangular prism along +X spanning y ∈ [origin.y, origin.y + width], z ∈ [origin.z, origin.z + height].
// 'left': vertical wall at low Y, slope faces +Y. 'right': wall at high Y, slope faces -Y.
export function makeRamp(origin: Vec3, length: number, width: number, height: number, side: 'left' | 'right'): Brush {
  const maxs = add(origin, vec(length, width, height));
  const left = side === 'left';
  const slopeNormal = normalize(vec(0, left ? height : -height, width));
  const foot = vec(0, left ? maxs.y : origin.y, origin.z); // where the slope meets the floor
  return {
    kind: 'ramp',
    side,
    mins: origin,
    maxs,
    planes: [
      plane(vec(1, 0, 0), maxs), plane(vec(-1, 0, 0), origin),
      plane(vec(0, 0, -1), origin),
      left ? plane(vec(0, -1, 0), origin) : plane(vec(0, 1, 0), maxs),
      plane(slopeNormal, foot),
      // Axial bevels: redundant for the shape, but stop the box-expanded slope overshooting the apex/foot.
      plane(vec(0, 0, 1), maxs),
      left ? plane(vec(0, 1, 0), maxs) : plane(vec(0, -1, 0), origin),
    ],
  };
}
