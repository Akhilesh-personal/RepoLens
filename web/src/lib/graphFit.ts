import type { Vec3 } from "./forceLayout";

export type GraphFit = {
  center: Vec3;
  radius: number;
};

export function boundingSphere(positions: Record<string, Vec3>): GraphFit {
  const points: Vec3[] = [];
  for (const p of Object.values(positions)) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) continue;
    points.push(p);
  }
  if (points.length === 0) {
    return { center: { x: 0, y: 0, z: 0 }, radius: 10 };
  }

  const center: Vec3 = { x: 0, y: 0, z: 0 };
  for (const p of points) {
    center.x += p.x;
    center.y += p.y;
    center.z += p.z;
  }
  const n = points.length;
  center.x /= n;
  center.y /= n;
  center.z /= n;

  let radius = 0;
  for (const p of points) {
    radius = Math.max(radius, Math.hypot(p.x - center.x, p.y - center.y, p.z - center.z));
  }
  if (!Number.isFinite(radius) || radius < 10) radius = 10;
  return { center, radius };
}

export function fitDistance(radius: number, fovDeg: number): number {
  const fov = fovDeg * (Math.PI / 180);
  const denom = Math.sin(fov / 2);
  if (!Number.isFinite(denom) || denom <= 1e-6) return radius * 4;
  return (radius / denom) * 1.4;
}
