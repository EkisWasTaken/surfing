import { Vec3, vec, add, sub, dot, cross, normalize, scale } from './math';

// A point p is inside the brush when dot(normal, p) - dist <= 0 for every plane.
export type Plane = { normal: Vec3; dist: number };
export type Brush = {
  planes: Plane[];
  mins: Vec3;
  maxs: Vec3;
  kind: 'box' | 'ramp' | 'bsp';
  // Ramps only: [wall bottom, wall top, foot] at the start end, then the same at the far end.
  corners?: Vec3[];
};

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

// Triangular prism running `length` along +axis from origin, `width` across, `height` tall.
// side = which way the slope faces relative to travel ('left' of +X is +Y, 'left' of +Y is -X).
export function makeRamp(origin: Vec3, length: number, width: number, height: number, side: 'left' | 'right', axis: 'x' | 'y' = 'x'): Brush {
  // a = distance along travel, l = offset toward the left of travel.
  const at = (a: number, l: number, z: number) =>
    axis === 'x' ? add(origin, vec(a, l, z)) : add(origin, vec(width - l, a, z));
  const wallL = side === 'left' ? 0 : width;
  const footL = width - wallL;
  const corners = [0, length].flatMap((a) => [at(a, wallL, 0), at(a, wallL, height), at(a, footL, 0)]);
  const [, top, foot, , , farFoot] = corners;
  let n = normalize(cross(sub(foot, top), sub(farFoot, top)));
  if (n.z < 0) n = scale(n, -1);
  const maxs = add(origin, axis === 'x' ? vec(length, width, height) : vec(width, length, height));
  // The bounding-box planes double as axial bevels, so the box-expanded slope can't overshoot apex or foot.
  return { kind: 'ramp', mins: origin, maxs, corners, planes: [...makeBox(origin, maxs).planes, plane(n, top)] };
}

// The slope is always a ramp's last plane.
export const slopeOf = (b: Brush): Plane => b.planes[b.planes.length - 1];
