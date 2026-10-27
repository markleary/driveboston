import { projectOnSegment, samplePolyline, type Pt } from './lib/geom.ts';
import { distanceTransform, sampleBilinear, type GridSpec } from './lib/raster.ts';

/** A ground link as the burn sees it: a polyline with per-vertex elevations and a curb-to-curb width. */
export interface BurnLink {
  id: number;
  name: string;
  pts: Pt[];
  elev: ArrayLike<number>;
  width: number;
}

/** Metres beyond the curb that still belong to a road: its sidewalk strip. */
export const SIDEWALK_REACH = 3;
/** Metres beyond the curb at which the ground has blended back to the DEM. */
export const BLEND_REACH = 6;
/** How far a link's influence reaches beyond its curb. */
export const REACH = 12;
/** Roads whose levels differ by more than this are separate corridors with a wall between them. */
export const LEVEL_TOL = 1.0;
export const CURB_HEIGHT = 0.15;
/** A ground link this much above another one it crosses is really a bridge. */
export const CROSSING_TOL = 2.5;

export interface CorridorField {
  /** Signed distance to the nearest curb in metres; 1e9 beyond every link's reach. */
  sdf: Float32Array;
  /** Elevation of the road that owns the cell; NaN beyond reach. */
  elev: Float32Array;
  /** Distance to the owning road's centreline; 1e9 beyond reach. */
  dist: Float32Array;
  /** 1 where roads at different levels meet outside their corridors: a wall, never filled as road. */
  split: Uint8Array;
}

/**
 * Which road owns each ground cell. A cell inside a corridor belongs to that
 * road; where corridors at one level overlap (a junction) their levels blend by
 * how deep the cell sits in each, so the surface is continuous; between
 * corridors a cell belongs to the nearest road. The rules for roads at
 * different levels, a ramp diving beside a street or a street along the edge
 * of the Turnpike cut, are what nearest-centreline-wins got wrong: inside a
 * street's corridor the street keeps its level even when a lower ramp's
 * centreline is closer; where corridors overlap, as at a tunnel portal, the
 * higher road wins; a higher road's sidewalk strip claims the lower corridor's
 * cells beside it, so the wall between them stands SIDEWALK_REACH out from the
 * upper curb rather than at it, where the 2 m physics grid would smear it into
 * the edge lane; and the strip between two such corridors is marked `split` so
 * the closing step leaves a wall there instead of filleting the two into one
 * surface. Levels within LEVEL_TOL of each other are one surface, so ordinary
 * junctions are unchanged.
 */
export function rasteriseCorridors(spec: GridSpec, links: BurnLink[]): CorridorField {
  const W = spec.width;
  const H = spec.height;
  const N = W * H;
  const sdf = new Float32Array(N).fill(1e9);
  // Aggregates over the candidates in the lowest tier present at the cell.
  const tier = new Uint8Array(N).fill(255);
  const nearD = new Float32Array(N).fill(1e9);
  const nearE = new Float32Array(N);
  const maxE = new Float32Array(N).fill(-Infinity);
  const minE = new Float32Array(N).fill(Infinity);
  // Depth-weighted blend over the corridors that contain the cell.
  const sumW = new Float32Array(N);
  const sumWE = new Float32Array(N);
  // The highest road whose corridor or sidewalk strip reaches the cell.
  const maxE1 = new Float32Array(N).fill(-Infinity);
  const sdf1 = new Float32Array(N);
  const dist1 = new Float32Array(N);
  const cellX = (x: number): number => Math.floor((x - spec.originX) / spec.cell);
  const cellZ = (z: number): number => Math.floor((z - spec.originZ) / spec.cell);
  for (const l of links) {
    if (l.pts.length < 2) continue;
    const hw = l.width / 2;
    const r = hw + REACH;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of l.pts) {
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minZ = Math.min(minZ, p[1]);
      maxZ = Math.max(maxZ, p[1]);
    }
    const i0 = Math.max(0, cellX(minX - r));
    const i1 = Math.min(W - 1, cellX(maxX + r) + 1);
    const j0 = Math.max(0, cellZ(minZ - r));
    const j1 = Math.min(H - 1, cellZ(maxZ + r) + 1);
    const bw = i1 - i0 + 1;
    const bh = j1 - j0 + 1;
    if (bw <= 0 || bh <= 0) continue;
    // The link's own nearest segment per cell, so a bend in one link never counts as two roads.
    const ld = new Float32Array(bw * bh).fill(1e9);
    const le = new Float32Array(bw * bh);
    for (let s = 0; s + 1 < l.pts.length; s += 1) {
      const a = l.pts[s];
      const b = l.pts[s + 1];
      const ea = l.elev[s];
      const eb = l.elev[s + 1];
      const si0 = Math.max(i0, cellX(Math.min(a[0], b[0]) - r));
      const si1 = Math.min(i1, cellX(Math.max(a[0], b[0]) + r) + 1);
      const sj0 = Math.max(j0, cellZ(Math.min(a[1], b[1]) - r));
      const sj1 = Math.min(j1, cellZ(Math.max(a[1], b[1]) + r) + 1);
      for (let j = sj0; j <= sj1; j += 1) {
        const z = spec.originZ + (j + 0.5) * spec.cell;
        for (let i = si0; i <= si1; i += 1) {
          const x = spec.originX + (i + 0.5) * spec.cell;
          const pr = projectOnSegment([x, z], a, b);
          const d = Math.sqrt(pr.d2);
          if (d > r) continue;
          const kk = (j - j0) * bw + (i - i0);
          if (d < ld[kk]) {
            ld[kk] = d;
            le[kk] = ea + (eb - ea) * pr.t;
          }
        }
      }
    }
    for (let jj = 0; jj < bh; jj += 1) {
      for (let ii = 0; ii < bw; ii += 1) {
        const kk = jj * bw + ii;
        const d = ld[kk];
        if (d > r) continue;
        const k = (j0 + jj) * W + (i0 + ii);
        const v = d - hw;
        if (v < sdf[k]) sdf[k] = v;
        const t = d < hw ? 0 : d < hw + SIDEWALK_REACH ? 1 : 2;
        const e = le[kk];
        if (t < tier[k]) {
          tier[k] = t;
          nearD[k] = d;
          nearE[k] = e;
          maxE[k] = e;
          minE[k] = e;
        } else if (t === tier[k]) {
          if (d < nearD[k]) {
            nearD[k] = d;
            nearE[k] = e;
          }
          if (e > maxE[k]) maxE[k] = e;
          if (e < minE[k]) minE[k] = e;
        }
        if (t === 0) {
          const w = hw - d;
          sumW[k] += w;
          sumWE[k] += w * e;
        }
        if (t <= 1 && e > maxE1[k]) {
          maxE1[k] = e;
          sdf1[k] = v;
          dist1[k] = d;
        }
      }
    }
  }
  const elev = new Float32Array(N).fill(NaN);
  const split = new Uint8Array(N);
  for (let k = 0; k < N; k += 1) {
    if (tier[k] === 255) continue;
    const levels = maxE[k] - minE[k] > LEVEL_TOL;
    if (tier[k] === 0) {
      if (maxE1[k] - maxE[k] > LEVEL_TOL) {
        // A higher road's sidewalk strip reaches into this lower corridor: wall top, not road.
        elev[k] = maxE1[k];
        nearD[k] = dist1[k];
        sdf[k] = Math.max(0, sdf1[k]);
        split[k] = 1;
      } else {
        elev[k] = levels ? maxE[k] : sumWE[k] / sumW[k];
      }
    } else {
      elev[k] = levels ? maxE[k] : nearE[k];
      if (levels) split[k] = 1;
    }
  }
  return { sdf, elev, dist: nearD, split };
}

export interface ClosedField {
  /** Signed distance to the curb after concave corners are filled; negative is road. */
  finalSdf: Float32Array;
  /** Cells the closing turned into road. */
  filled: number;
  /** Cells between roads at different levels that the closing left alone. */
  splitCells: number;
}

/**
 * Fills concave corners of the road surface (dilate, then erode by the fillet
 * radius) so junctions round off, except across a split, where two roads at
 * different levels keep a wall between them. Filled cells take the elevation of
 * the nearest owned cell.
 */
export function closeCorners(spec: GridSpec, field: CorridorField, filletR: number): ClosedField {
  const W = spec.width;
  const H = spec.height;
  const N = W * H;
  const roadMask = new Uint8Array(N);
  for (let k = 0; k < N; k += 1) roadMask[k] = field.sdf[k] < 0 ? 1 : 0;
  const dIn = distanceTransform(roadMask, W, H);
  const notDilated = new Uint8Array(N);
  for (let k = 0; k < N; k += 1) notDilated[k] = dIn[k] < filletR ? 0 : 1;
  const dOut = distanceTransform(notDilated, W, H);
  const closed = new Uint8Array(N);
  let splitCells = 0;
  for (let k = 0; k < N; k += 1) {
    const inside = dOut[k] >= filletR;
    if (inside && field.split[k]) splitCells += 1;
    closed[k] = inside && !field.split[k] ? 1 : 0;
  }
  const notClosed = new Uint8Array(N);
  for (let k = 0; k < N; k += 1) notClosed[k] = closed[k] ? 0 : 1;
  const dToEdge = distanceTransform(notClosed, W, H);
  const finalSdf = new Float32Array(N);
  let filled = 0;
  for (let k = 0; k < N; k += 1) {
    if (field.sdf[k] < 0) finalSdf[k] = field.sdf[k];
    else if (closed[k]) {
      finalSdf[k] = -Math.max(0.5, dToEdge[k]);
      filled += 1;
    } else finalSdf[k] = Math.min(field.sdf[k], 50);
  }
  // A filled cell beyond every link's reach still needs a level: the nearest owned cell's.
  for (let k = 0; k < N; k += 1) {
    if (finalSdf[k] >= 0 || !Number.isNaN(field.elev[k])) continue;
    const i = k % W;
    const j = (k - i) / W;
    let best = NaN;
    let bestD = Infinity;
    for (let dj = -6; dj <= 6; dj += 1) {
      for (let di = -6; di <= 6; di += 1) {
        const ii = i + di;
        const jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
        const kk = jj * W + ii;
        const dd = di * di + dj * dj;
        if (!Number.isNaN(field.elev[kk]) && field.dist[kk] < 1e8 && dd < bestD) {
          bestD = dd;
          best = field.elev[kk];
        }
      }
    }
    if (!Number.isNaN(best)) {
      field.elev[k] = best;
      field.dist[k] = Math.sqrt(bestD);
    }
  }
  return { finalSdf, filled, splitCells };
}

/**
 * Heights after the roads are burned in: the owning road's level across the
 * surface, a curb above it on sidewalks and within SIDEWALK_REACH of the curb,
 * a blend back to the DEM out to BLEND_REACH, and water below its plane.
 */
export function burnHeights(
  dem: Float32Array,
  waterLevel: number,
  isWater: (k: number) => boolean,
  sidewalkMask: Uint8Array | null,
  finalSdf: Float32Array,
  field: CorridorField,
): { burned: Float32Array; roadCells: number } {
  const burned = new Float32Array(dem);
  let roadCells = 0;
  for (let k = 0; k < dem.length; k += 1) {
    const f = finalSdf[k];
    const re = field.elev[k];
    const hasRoad = !Number.isNaN(re) && field.dist[k] < 1e8;
    if (f < 0) {
      burned[k] = hasRoad ? re : dem[k];
      roadCells += 1;
    } else if (isWater(k)) {
      burned[k] = waterLevel - 0.4;
    } else if (hasRoad && ((sidewalkMask && sidewalkMask[k]) || f < SIDEWALK_REACH)) {
      burned[k] = re + CURB_HEIGHT;
    } else if (hasRoad && f < BLEND_REACH) {
      const t = (f - SIDEWALK_REACH) / (BLEND_REACH - SIDEWALK_REACH);
      burned[k] = (re + CURB_HEIGHT) * (1 - t) + dem[k] * t;
    }
  }
  return { burned, roadCells };
}

/** Elevation of a link at a distance along it, from its per-vertex profile. */
function elevAlong(l: BurnLink, at: number): number {
  let s = 0;
  for (let i = 0; i + 1 < l.pts.length; i += 1) {
    const seg = Math.hypot(l.pts[i + 1][0] - l.pts[i][0], l.pts[i + 1][1] - l.pts[i][1]);
    if (at <= s + seg || i + 2 === l.pts.length) {
      const t = seg > 0 ? Math.max(0, Math.min(1, (at - s) / seg)) : 0;
      return l.elev[i] + (l.elev[i + 1] - l.elev[i]) * t;
    }
    s += seg;
  }
  return l.elev[0];
}

export interface SurfaceScan {
  /** Ground links checked. */
  links: number;
  /** Links with the ground more than `tol` below the road somewhere across their width. */
  low: number;
  worst: { drop: number; name: string; x: number; z: number } | null;
  /** Links with the ground more than `tol` above the road along their centreline: a lane walled off. */
  high: number;
  worstHigh: { rise: number; name: string; x: number; z: number } | null;
}

/**
 * Checks the burned ground against every link's surface across its full width,
 * every 2 m along, so a pit at a road's edge is reported instead of found by a
 * driver.
 */
export function scanRoadSurface(spec: GridSpec, burned: Float32Array, links: BurnLink[], tol = 0.4): SurfaceScan {
  let low = 0;
  let high = 0;
  let worst: SurfaceScan['worst'] = null;
  let worstHigh: SurfaceScan['worstHigh'] = null;
  for (const l of links) {
    const hw = l.width / 2;
    let linkWorst = 0;
    let linkHigh = 0;
    let at: [number, number] = [0, 0];
    let atHigh: [number, number] = [0, 0];
    for (const s of samplePolyline(l.pts, 2)) {
      const e = elevAlong(l, s.s);
      for (const off of [-hw + 0.5, -hw / 2, 0, hw / 2, hw - 0.5]) {
        const x = s.x - s.hz * off;
        const z = s.z + s.hx * off;
        const diff = sampleBilinear(spec, burned, x, z) - e;
        if (diff < linkWorst) {
          linkWorst = diff;
          at = [x, z];
        }
        if (off === 0 && diff > linkHigh) {
          linkHigh = diff;
          atHigh = [x, z];
        }
      }
    }
    if (linkWorst < -tol) {
      low += 1;
      if (!worst || linkWorst < -worst.drop) worst = { drop: -linkWorst, name: l.name || '(unnamed)', x: at[0], z: at[1] };
    }
    if (linkHigh > tol) {
      high += 1;
      if (!worstHigh || linkHigh > worstHigh.rise) worstHigh = { rise: linkHigh, name: l.name || '(unnamed)', x: atHigh[0], z: atHigh[1] };
    }
  }
  return { links: links.length, low, worst, high, worstHigh };
}

export interface LevelCrossing {
  upper: string;
  lower: string;
  x: number;
  z: number;
  drop: number;
}

/**
 * Pairs of ground links whose centrelines cross with one far above the other:
 * a crossing OpenStreetMap left without a bridge tag. The burn keeps the upper
 * road's surface whole, which dams the lower one, so these are reported.
 */
export function findLevelCrossings(links: BurnLink[], tol = CROSSING_TOL): LevelCrossing[] {
  const out: LevelCrossing[] = [];
  const boxes = links.map((l) => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of l.pts) {
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minZ = Math.min(minZ, p[1]);
      maxZ = Math.max(maxZ, p[1]);
    }
    return { minX, maxX, minZ, maxZ };
  });
  for (let a = 0; a < links.length; a += 1) {
    for (let b = a + 1; b < links.length; b += 1) {
      const ba = boxes[a];
      const bb = boxes[b];
      if (ba.minX > bb.maxX || bb.minX > ba.maxX || ba.minZ > bb.maxZ || bb.minZ > ba.maxZ) continue;
      const la = links[a];
      const lb = links[b];
      for (let i = 0; i + 1 < la.pts.length; i += 1) {
        for (let j = 0; j + 1 < lb.pts.length; j += 1) {
          const hit = segmentsCross(la.pts[i], la.pts[i + 1], lb.pts[j], lb.pts[j + 1]);
          if (!hit) continue;
          const ea = la.elev[i] + (la.elev[i + 1] - la.elev[i]) * hit.t;
          const eb = lb.elev[j] + (lb.elev[j + 1] - lb.elev[j]) * hit.u;
          if (Math.abs(ea - eb) <= tol) continue;
          const [upper, lower] = ea > eb ? [la, lb] : [lb, la];
          out.push({ upper: upper.name || '(unnamed)', lower: lower.name || '(unnamed)', x: la.pts[i][0] + (la.pts[i + 1][0] - la.pts[i][0]) * hit.t, z: la.pts[i][1] + (la.pts[i + 1][1] - la.pts[i][1]) * hit.t, drop: Math.abs(ea - eb) });
        }
      }
    }
  }
  return out;
}

/** Parameters of the crossing point of two segments, or null when they do not cross inside both. */
function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): { t: number; u: number } | null {
  const rx = b[0] - a[0];
  const rz = b[1] - a[1];
  const sx = d[0] - c[0];
  const sz = d[1] - c[1];
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const qx = c[0] - a[0];
  const qz = c[1] - a[1];
  const t = (qx * sz - qz * sx) / den;
  const u = (qx * rz - qz * rx) / den;
  // Exclude touches at the ends, which are shared junction nodes.
  if (t <= 1e-6 || t >= 1 - 1e-6 || u <= 1e-6 || u >= 1 - 1e-6) return null;
  return { t, u };
}
