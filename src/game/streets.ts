import type { RoadLink, WorldData } from '../world/data.ts';

export interface StreetHit {
  link: RoadLink;
  segment: number;
  /** Closest point on the link. */
  x: number;
  y: number;
  z: number;
  distance: number;
}

export interface RoadPose {
  x: number;
  y: number;
  z: number;
  headingDeg: number;
}

/** Compass heading in degrees from a direction in the world frame (north is -z, east is +x). */
export function headingFromDirection(dx: number, dz: number): number {
  const h = (Math.atan2(dx, -dz) * 180) / Math.PI;
  return (h + 360) % 360;
}

/**
 * Uniform grid over the road links for nearest-street lookups: the HUD street
 * name, the cross street ahead, and the reset-to-road pose.
 */
export class StreetIndex {
  private readonly cellM: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly cells: Int32Array[];
  private readonly nodeLinks = new Map<number, number[]>();
  private readonly world: WorldData;

  constructor(world: WorldData, cellM = 48) {
    this.world = world;
    this.cellM = cellM;
    this.cols = Math.ceil((world.rect.maxX - world.rect.minX) / cellM);
    this.rows = Math.ceil((world.rect.maxZ - world.rect.minZ) / cellM);
    const buckets: number[][] = Array.from({ length: this.cols * this.rows }, () => []);
    for (const link of world.links) {
      const list = this.nodeLinks.get(link.a) ?? [];
      list.push(link.id);
      this.nodeLinks.set(link.a, list);
      const listB = this.nodeLinks.get(link.b) ?? [];
      listB.push(link.id);
      this.nodeLinks.set(link.b, listB);
      const pts = link.points;
      for (let s = 0; s < pts.length / 3 - 1; s += 1) {
        const x0 = Math.min(pts[s * 3], pts[s * 3 + 3]);
        const x1 = Math.max(pts[s * 3], pts[s * 3 + 3]);
        const z0 = Math.min(pts[s * 3 + 2], pts[s * 3 + 5]);
        const z1 = Math.max(pts[s * 3 + 2], pts[s * 3 + 5]);
        const c0 = this.col(x0);
        const c1 = this.col(x1);
        const r0 = this.row(z0);
        const r1 = this.row(z1);
        for (let r = r0; r <= r1; r += 1) for (let c = c0; c <= c1; c += 1) buckets[r * this.cols + c].push(link.id, s);
      }
    }
    this.cells = buckets.map((b) => Int32Array.from(b));
  }

  private col(x: number): number {
    return Math.max(0, Math.min(this.cols - 1, Math.floor((x - this.world.rect.minX) / this.cellM)));
  }

  private row(z: number): number {
    return Math.max(0, Math.min(this.rows - 1, Math.floor((z - this.world.rect.minZ) / this.cellM)));
  }

  nearest(x: number, z: number, maxDistance = 60, filter?: (link: RoadLink) => boolean): StreetHit | null {
    const reach = Math.ceil(maxDistance / this.cellM);
    const c0 = this.col(x);
    const r0 = this.row(z);
    let best: StreetHit | null = null;
    let bestD2 = maxDistance * maxDistance;
    for (let r = Math.max(0, r0 - reach); r <= Math.min(this.rows - 1, r0 + reach); r += 1) {
      for (let c = Math.max(0, c0 - reach); c <= Math.min(this.cols - 1, c0 + reach); c += 1) {
        const cell = this.cells[r * this.cols + c];
        for (let k = 0; k < cell.length; k += 2) {
          const link = this.world.links[cell[k]];
          if (filter && !filter(link)) continue;
          const s = cell[k + 1];
          const p = link.points;
          const ax = p[s * 3];
          const ay = p[s * 3 + 1];
          const az = p[s * 3 + 2];
          const bx = p[s * 3 + 3];
          const by = p[s * 3 + 4];
          const bz = p[s * 3 + 5];
          const dx = bx - ax;
          const dz = bz - az;
          const len2 = dx * dx + dz * dz;
          const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
          const px = ax + dx * t;
          const pz = az + dz * t;
          const d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
          if (d2 < bestD2) {
            bestD2 = d2;
            best = { link, segment: s, x: px, y: ay + (by - ay) * t, z: pz, distance: Math.sqrt(d2) };
          }
        }
      }
    }
    return best;
  }

  /** Street name under the car and the cross street coming up along the heading. */
  describe(x: number, z: number, dirX: number, dirZ: number): { street: string; cross: string } {
    const hit = this.nearest(x, z, 40, (l) => l.drivable && l.name !== '');
    if (!hit) return { street: '', cross: '' };
    const { link } = hit;
    const nodes = this.world.nodes;
    let cross = '';
    let bestD = 75;
    for (const nodeIdx of [link.a, link.b]) {
      const nx = nodes[nodeIdx * 3];
      const nz = nodes[nodeIdx * 3 + 2];
      const vx = nx - x;
      const vz = nz - z;
      const d = Math.hypot(vx, vz);
      if (d > bestD) continue;
      if (d > 12 && vx * dirX + vz * dirZ < 0) continue;
      const others = this.nodeLinks.get(nodeIdx) ?? [];
      for (const id of others) {
        const other = this.world.links[id];
        if (other.name && other.name !== link.name) {
          cross = other.name;
          bestD = d;
          break;
        }
      }
    }
    return { street: link.name, cross };
  }

  /** Closest drivable road point with a lawful heading, preferring the one nearest the current heading. */
  nearestRoadPose(x: number, z: number, headingDeg: number): RoadPose | null {
    const hit = this.nearest(x, z, 150, (l) => l.drivable);
    if (!hit) return null;
    const p = hit.link.points;
    const s = hit.segment;
    const dx = p[s * 3 + 3] - p[s * 3];
    const dz = p[s * 3 + 5] - p[s * 3 + 2];
    let heading = headingFromDirection(dx, dz);
    if (!hit.link.oneway) {
      const diff = Math.abs((((heading - headingDeg) % 360) + 540) % 360 - 180);
      if (diff < 90) heading = (heading + 180) % 360;
    }
    return { x: hit.x, y: hit.y, z: hit.z, headingDeg: heading };
  }
}
