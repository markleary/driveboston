import type { RoadLink, WorldData } from './data.ts';
import { ROAD_CLASS } from '../shared/roads.ts';

/**
 * Road surfaces as ribbons along the road graph, one merged geometry per chunk.
 * Each vertex carries where it sits on its street (metres across and along) and
 * what the street is (width, lanes, one-way, where its junctions start), so the
 * road material can draw lane paint, crosswalks and stop lines analytically.
 * Ribbons run node to node and overlap at junctions; the asphalt they show is a
 * function of world position, so the overlaps do not fight visibly, and paint
 * is masked inside the junction trims.
 */
export interface RoadGeometry {
  positions: number[];
  normals: number[];
  indices: number[];
  /** Signed metres from the centreline, right of travel positive. */
  across: number[];
  /** Metres along the link from node a. */
  along: number[];
  /** Per vertex: half width, lane width, marked lanes, one-way flag. */
  road: number[];
  /** Per vertex: link length, trim at a, trim at b, end bits. */
  ends: number[];
}

export const END_BIT = { crosswalkA: 1, crosswalkB: 2, stopA: 4, stopB: 8 } as const;

/** Lift above the burned terrain, which is flat under the ribbon. */
const LIFT = 0.03;
/** Lift above a bridge deck, whose top sits 0.02 m over the link elevation. */
const BRIDGE_LIFT = 0.05;
const STATION_STEP = 6;
const EDGE_INSET = 2.5;

interface EndInfo {
  trim: number;
  crosswalk: boolean;
  stop: boolean;
}

/** Unit direction of a link leaving the node at its a or b end. */
function dirAway(l: RoadLink, atA: boolean): [number, number] {
  const p = l.points;
  const n = p.length / 3;
  const dx = atA ? p[3] - p[0] : p[(n - 2) * 3] - p[(n - 1) * 3];
  const dz = atA ? p[5] - p[2] : p[(n - 2) * 3 + 2] - p[(n - 1) * 3 + 2];
  const len = Math.hypot(dx, dz) || 1;
  return [dx / len, dz / len];
}

/**
 * What a link meets at one of its ends. A link of the same name carrying straight
 * on is a continuation; anything else is a crossing. Alleys (service roads)
 * neither get nor cause crosswalks. The through road at a T keeps rolling without
 * a stop line; everything else stops.
 */
export function analyseEnd(l: RoadLink, node: number, atA: boolean, byNode: Map<number, RoadLink[]>): EndInfo {
  const [dx, dz] = dirAway(l, atA);
  const cont: RoadLink[] = [];
  const cross: RoadLink[] = [];
  for (const m of byNode.get(node) ?? []) {
    if (m === l) continue;
    const [mx, mz] = dirAway(m, m.a === node);
    const cos = dx * mx + dz * mz;
    if (cos < -0.866 && m.name === l.name) cont.push(m);
    else cross.push(m);
  }
  const major = cross.filter((m) => m.cls !== 'service');
  if (major.length === 0) return { trim: 0, crosswalk: false, stop: false };
  const trim = Math.max(2.5, Math.max(...major.map((m) => m.width / 2)) + 1);
  const alley = l.cls === 'service';
  return { trim, crosswalk: !alley, stop: !alley && (cont.length === 0 || major.length >= 2) };
}

interface Station {
  x: number;
  y: number;
  z: number;
  s: number;
  nx: number;
  nz: number;
  scale: number;
}

/** Centreline samples at every vertex and at most STATION_STEP apart, with mitred right-hand normals. */
function stations(l: RoadLink): Station[] {
  const p = l.points;
  const n = p.length / 3;
  const pts: { x: number; y: number; z: number; s: number }[] = [];
  let s = 0;
  for (let i = 0; i < n; i += 1) {
    const x = p[i * 3];
    const y = p[i * 3 + 1];
    const z = p[i * 3 + 2];
    if (i > 0) {
      const px = p[(i - 1) * 3];
      const py = p[(i - 1) * 3 + 1];
      const pz = p[(i - 1) * 3 + 2];
      const len = Math.hypot(x - px, z - pz);
      const k = Math.ceil(len / STATION_STEP);
      for (let j = 1; j < k; j += 1) {
        const t = j / k;
        pts.push({ x: px + (x - px) * t, y: py + (y - py) * t, z: pz + (z - pz) * t, s: s + len * t });
      }
      s += len;
    }
    pts.push({ x, y, z, s });
  }
  const out: Station[] = [];
  for (let i = 0; i < pts.length; i += 1) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    let d0x = pts[i].x - prev.x;
    let d0z = pts[i].z - prev.z;
    let d1x = next.x - pts[i].x;
    let d1z = next.z - pts[i].z;
    const l0 = Math.hypot(d0x, d0z);
    const l1 = Math.hypot(d1x, d1z);
    if (l0 > 0) {
      d0x /= l0;
      d0z /= l0;
    } else {
      d0x = d1x / (l1 || 1);
      d0z = d1z / (l1 || 1);
    }
    if (l1 > 0) {
      d1x /= l1;
      d1z /= l1;
    } else {
      d1x = d0x;
      d1z = d0z;
    }
    // Right-hand normals (x east, z south): (-dz, dx).
    const n0x = -d0z;
    const n0z = d0x;
    const n1x = -d1z;
    const n1z = d1x;
    let nx = n0x + n1x;
    let nz = n0z + n1z;
    const nl = Math.hypot(nx, nz);
    if (nl < 1e-6) {
      nx = n0x;
      nz = n0z;
    } else {
      nx /= nl;
      nz /= nl;
    }
    const cosHalf = Math.max(0.5, nx * n0x + nz * n0z);
    out.push({ x: pts[i].x, y: pts[i].y, z: pts[i].z, s: pts[i].s, nx, nz, scale: 1 / cosHalf });
  }
  return out;
}

export function buildRoadGeometry(world: WorldData): Map<number, RoadGeometry> {
  const byNode = new Map<number, RoadLink[]>();
  const links = world.links.filter((l) => l.drivable && !l.tunnel && l.points.length >= 6);
  for (const l of links) {
    byNode.set(l.a, [...(byNode.get(l.a) ?? []), l]);
    byNode.set(l.b, [...(byNode.get(l.b) ?? []), l]);
  }
  const out = new Map<number, RoadGeometry>();
  const chunkOf = (x: number, z: number): number => {
    const cx = Math.max(0, Math.min(world.chunksX - 1, Math.floor((x - world.rect.minX) / world.chunkM)));
    const cz = Math.max(0, Math.min(world.chunksZ - 1, Math.floor((z - world.rect.minZ) / world.chunkM)));
    return cz * world.chunksX + cx;
  };

  for (const l of links) {
    const st = stations(l);
    if (st.length < 2) continue;
    const endA = analyseEnd(l, l.a, true, byNode);
    const endB = analyseEnd(l, l.b, false, byNode);
    const len = st[st.length - 1].s;
    const hw = l.width / 2;
    const laneW = ROAD_CLASS[l.cls].laneWidth;
    const lanes = l.oneway ? Math.max(1, l.lanes) : Math.max(2, l.lanes - (l.lanes % 2));
    const bits =
      (endA.crosswalk ? END_BIT.crosswalkA : 0) |
      (endB.crosswalk ? END_BIT.crosswalkB : 0) |
      (endA.stop && !l.oneway ? END_BIT.stopA : 0) |
      (endB.stop ? END_BIT.stopB : 0);
    const inset = Math.min(EDGE_INSET, hw * 0.45);
    const offsets = [-hw, -(hw - inset), hw - inset, hw];
    const mid = st[Math.floor(st.length / 2)];
    const key = chunkOf(mid.x, mid.z);
    let g = out.get(key);
    if (!g) {
      g = { positions: [], normals: [], indices: [], across: [], along: [], road: [], ends: [] };
      out.set(key, g);
    }
    const base = g.positions.length / 3;
    for (const s of st) {
      for (const off of offsets) {
        const x = s.x + s.nx * off * s.scale;
        const z = s.z + s.nz * off * s.scale;
        const y = l.bridge ? s.y + BRIDGE_LIFT : Math.max(s.y, world.heightAt(x, z)) + LIFT;
        g.positions.push(x, y, z);
        g.normals.push(0, 1, 0);
        g.across.push(off);
        g.along.push(s.s);
        g.road.push(hw, laneW, lanes, l.oneway ? 1 : 0);
        g.ends.push(len, endA.trim, endB.trim, bits);
      }
    }
    const W = offsets.length;
    for (let i = 0; i + 1 < st.length; i += 1) {
      for (let k = 0; k + 1 < W; k += 1) {
        const p = base + i * W + k;
        const q = p + W;
        const r = p + 1;
        const sIdx = q + 1;
        g.indices.push(p, sIdx, q, p, r, sIdx);
      }
    }
  }
  return out;
}
