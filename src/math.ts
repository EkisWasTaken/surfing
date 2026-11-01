// Source coordinates: x forward, y left, z up, Hammer units.
export type Vec3 = { x: number; y: number; z: number };

export const vec = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const copy = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z });
export const add = (a: Vec3, b: Vec3): Vec3 => vec(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => vec(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a: Vec3, s: number): Vec3 => vec(a.x * s, a.y * s, a.z * s);
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 =>
  vec(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const length = (a: Vec3): number => Math.sqrt(dot(a, a));
export const normalize = (a: Vec3): Vec3 => {
  const l = length(a);
  return l === 0 ? vec() : scale(a, 1 / l);
};

const DEG = Math.PI / 180;

// Source AngleVectors with roll = 0; positive pitch looks down.
export function angleVectors(yawDeg: number, pitchDeg: number): { forward: Vec3; right: Vec3 } {
  const sy = Math.sin(yawDeg * DEG), cy = Math.cos(yawDeg * DEG);
  const sp = Math.sin(pitchDeg * DEG), cp = Math.cos(pitchDeg * DEG);
  return { forward: vec(cp * cy, cp * sy, -sp), right: vec(sy, -cy, 0) };
}
