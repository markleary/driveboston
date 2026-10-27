import { ROAD_CLASS } from '../shared/roads.ts';
import type { RoadLink } from '../world/data.ts';

/** Width kept free along each curb of a street that has parking. */
export const PARKING_LANE_M = 2.2;

export interface Pose {
  x: number;
  y: number;
  z: number;
  dx: number;
  dz: number;
}

/** A small deterministic random source (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A road link with cumulative distances, sampled at a distance along it with a lateral offset. */
export class LinkPath {
  readonly link: RoadLink;
  readonly cum: Float32Array;
  readonly length: number;

  constructor(link: RoadLink) {
    this.link = link;
    const p = link.points;
    const n = p.length / 3;
    this.cum = new Float32Array(n);
    let s = 0;
    for (let i = 1; i < n; i += 1) {
      s += Math.hypot(p[i * 3] - p[(i - 1) * 3], p[i * 3 + 2] - p[(i - 1) * 3 + 2]);
      this.cum[i] = s;
    }
    this.length = s;
  }

  /** Pose at distance `s` from node a; `offset` is metres to the right of the a to b direction. */
  poseAt(s: number, offset: number, out: Pose): Pose {
    const p = this.link.points;
    const n = p.length / 3;
    let i = 1;
    while (i < n - 1 && this.cum[i] < s) i += 1;
    const a = (i - 1) * 3;
    const b = i * 3;
    const segLen = this.cum[i] - this.cum[i - 1] || 1;
    const t = Math.max(0, Math.min(1, (s - this.cum[i - 1]) / segLen));
    let dx = p[b] - p[a];
    let dz = p[b + 2] - p[a + 2];
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    out.dx = dx;
    out.dz = dz;
    out.x = p[a] + (p[b] - p[a]) * t - dz * offset;
    out.y = p[a + 1] + (p[b + 1] - p[a + 1]) * t;
    out.z = p[a + 2] + (p[b + 2] - p[a + 2]) * t + dx * offset;
    return out;
  }

  /** Unit direction leaving node a (or node b) into the link. */
  dirInto(atA: boolean): [number, number] {
    const p = this.link.points;
    const n = p.length / 3;
    const dx = atA ? p[3] - p[0] : p[(n - 2) * 3] - p[(n - 1) * 3];
    const dz = atA ? p[5] - p[2] : p[(n - 2) * 3 + 2] - p[(n - 1) * 3 + 2];
    const len = Math.hypot(dx, dz) || 1;
    return [dx / len, dz / len];
  }
}

/**
 * Lateral offset of a driving lane, metres to the right of the a to b
 * direction. Traffic keeps right; `dir` is 1 when travelling a to b. One-way
 * streets spread their lanes across the width; two-way streets give each side
 * half the width less the parking lane.
 */
export function laneOffset(link: RoadLink, dir: 1 | -1, lane: number): number {
  const parking = ROAD_CLASS[link.cls].parking ? PARKING_LANE_M : 0;
  if (link.oneway) {
    const n = Math.max(1, Math.min(3, link.lanes));
    const laneWidth = Math.min(3.6, Math.max(2.6, (link.width - 2 * parking) / n));
    return (Math.min(lane, n - 1) - (n - 1) / 2) * laneWidth;
  }
  const half = Math.max(2.6, link.width / 2 - parking);
  const perSide = Math.max(1, Math.floor(link.lanes / 2));
  const laneWidth = Math.min(3.6, half / perSide);
  return dir * (Math.min(lane, perSide - 1) + 0.5) * laneWidth;
}
