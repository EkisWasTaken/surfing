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

// A ramp piece between two cross-sections, each [wall bottom, wall top, foot], at any heading. The sections must be
// level and their top and foot edges parallel, so the slope is flat. Used for straight ramps off-axis and for curves.
export function makePrism(a: [Vec3, Vec3, Vec3], b: [Vec3, Vec3, Vec3]): Brush {
  const corners = [...a, ...b];
  const axis = (k: 'x' | 'y' | 'z', f: (...v: number[]) => number) => f(...corners.map((c) => c[k]));
  const mins = vec(axis('x', Math.min), axis('y', Math.min), axis('z', Math.min));
  const maxs = vec(axis('x', Math.max), axis('y', Math.max), axis('z', Math.max));
  const centre = scale(corners.reduce((s, c) => add(s, c), vec()), 1 / 6);
  const face = (p: Vec3, q: Vec3, r: Vec3) => {
    const n = normalize(cross(sub(q, p), sub(r, p)));
    return plane(dot(n, sub(centre, p)) > 0 ? scale(n, -1) : n, p); // pointing out of the piece
  };
  // The bounding box planes double as bevels, as in makeRamp. The slope stays last, for slopeOf.
  return { kind: 'ramp', mins, maxs, corners, planes: [...makeBox(mins, maxs).planes, face(a[0], a[1], b[1]), face(a[0], a[1], a[2]), face(b[0], b[1], b[2]), face(a[1], a[2], b[2])] };
}

// The same brush moved by o.
export function translated(b: Brush, o: Vec3): Brush {
  return {
    ...b,
    mins: add(b.mins, o),
    maxs: add(b.maxs, o),
    corners: b.corners?.map((c) => add(c, o)),
    planes: b.planes.map((p) => ({ normal: p.normal, dist: p.dist + dot(p.normal, o) })),
  };
}

// The slope is always a ramp's last plane.
export const slopeOf = (b: Brush): Plane => b.planes[b.planes.length - 1];
