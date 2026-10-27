import { readFileSync } from 'node:fs';
import { lonLatToLocal } from './lib/frame.ts';
import { dist, polylineLength, projectOnSegment, samplePolyline, simplify, type Pt } from './lib/geom.ts';
import { fillPolygon, marchingSquares, type GridSpec } from './lib/raster.ts';
import { burnHeights, closeCorners, CROSSING_TOL, findLevelCrossings, rasteriseCorridors, scanRoadSurface, SIDEWALK_REACH } from './roadburn.ts';
import type { GeoJsonCollection } from './lib/arcgis.ts';
import type { LocalDem } from './terrain.ts';
import type { RoadGraph, RoadLink } from './roads.ts';
import { GROUND } from '../src/shared/roads.ts';

export interface CurbLine {
  pts: Pt[];
  elev: Float32Array;
}

export interface GroundResult {
  spec: GridSpec;
  mask: Uint8Array;
  /** 1 m heights after roads, sidewalks and water are burned in. */
  burned: Float32Array;
  curbs: CurbLine[];
  report: string[];
}

/** Fillet radius applied to concave corners of the road surface (metres). */
const FILLET_R = 4;

/** Converts GeoJSON polygon features to local rings. */
export function geoJsonToLocalRings(fc: GeoJsonCollection): { rings: Pt[][]; properties: Record<string, unknown> }[] {
  const out: { rings: Pt[][]; properties: Record<string, unknown> }[] = [];
  const toRing = (coords: number[][]): Pt[] => {
    const ring = coords.map(([lon, lat]) => lonLatToLocal(lon, lat));
    if (ring.length > 1 && dist(ring[0], ring[ring.length - 1]) < 1e-6) ring.pop();
    return ring;
  };
  for (const f of fc.features) {
    if (!f.geometry) continue;
    if (f.geometry.type === 'Polygon') {
      out.push({ rings: (f.geometry.coordinates as number[][][]).map(toRing), properties: f.properties });
    } else if (f.geometry.type === 'MultiPolygon') {
      for (const poly of f.geometry.coordinates as number[][][][]) out.push({ rings: poly.map(toRing), properties: f.properties });
    }
  }
  return out;
}

function paintBand(spec: GridSpec, pts: Pt[], halfWidth: number, paint: (k: number) => void): void {
  for (let s = 0; s < pts.length - 1; s += 1) {
    const a = pts[s];
    const b = pts[s + 1];
    const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - halfWidth - spec.originX) / spec.cell));
    const i1 = Math.min(spec.width - 1, Math.ceil((Math.max(a[0], b[0]) + halfWidth - spec.originX) / spec.cell));
    const j0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - halfWidth - spec.originZ) / spec.cell));
    const j1 = Math.min(spec.height - 1, Math.ceil((Math.max(a[1], b[1]) + halfWidth - spec.originZ) / spec.cell));
    for (let j = j0; j <= j1; j += 1) {
      const z = spec.originZ + (j + 0.5) * spec.cell;
      for (let i = i0; i <= i1; i += 1) {
        const x = spec.originX + (i + 0.5) * spec.cell;
        if (projectOnSegment([x, z], a, b).d2 <= halfWidth * halfWidth) paint(j * spec.width + i);
      }
    }
  }
}

export function buildGround(
  dem: LocalDem,
  graph: RoadGraph,
  sidewalkFc: GeoJsonCollection,
  buildingRings: Pt[][][],
): GroundResult {
  const spec = dem.spec;
  const W = spec.width;
  const H = spec.height;
  const N = W * H;
  const report: string[] = [];
  const mask = new Uint8Array(N).fill(GROUND.lot);

  // Base land cover from OSM polygons.
  const order: Record<string, number> = { grass: GROUND.grass, paved: GROUND.paved, parking: GROUND.parking, rail: GROUND.rail, water: GROUND.water };
  for (const kind of ['grass', 'paved', 'parking', 'rail', 'water']) {
    const cls = order[kind];
    for (const poly of graph.polygons) if (poly.kind === kind) fillPolygon(spec, poly.rings, (k) => (mask[k] = cls));
  }
  // Hydro-flattened water in the DEM.
  let demWater = 0;
  const demWaterMask = new Uint8Array(N);
  for (let k = 0; k < N; k += 1) {
    if (mask[k] !== GROUND.water && Math.abs(dem.heights[k] - dem.waterLevel) < 0.06) {
      mask[k] = GROUND.water;
      demWaterMask[k] = 1;
      demWater += 1;
    }
  }
  for (const line of graph.railLines) paintBand(spec, line, 4.5, (k) => { if (mask[k] !== GROUND.water) mask[k] = GROUND.rail; });
  for (const p of graph.paths) paintBand(spec, p.pts, p.width / 2, (k) => { if (mask[k] !== GROUND.water) mask[k] = GROUND.paved; });

  const sidewalkMask = new Uint8Array(N);
  const sidewalks = geoJsonToLocalRings(sidewalkFc);
  for (const s of sidewalks) fillPolygon(spec, s.rings, (k) => { sidewalkMask[k] = 1; mask[k] = GROUND.sidewalk; });
  const buildingMask = new Uint8Array(N);
  for (const rings of buildingRings) fillPolygon(spec, rings, (k) => (buildingMask[k] = 1));

  // Measure curb-to-curb widths against sidewalks and building walls.
  const blocker = (i: number, j: number): boolean => {
    if (i < 0 || j < 0 || i >= W || j >= H) return false;
    const k = j * W + i;
    const c = mask[k];
    return sidewalkMask[k] === 1 || buildingMask[k] === 1 || c === GROUND.water || c === GROUND.grass || c === GROUND.paved || c === GROUND.parking || c === GROUND.rail;
  };
  let measured = 0;
  const shifts: number[] = [];
  for (const l of graph.links) {
    if (!l.drivable || l.bridge) continue;
    // Alleys run between walls and lots, where a perpendicular march finds the wrong edge; keep their tag or default.
    if (l.cls === 'service') continue;
    const result = measureWidth(spec, l, blocker);
    if (result && result.width >= 5) {
      l.width = result.width;
      l.widthSource = 'measured';
      measured += 1;
      // OpenStreetMap centrelines sit a metre or two off the middle of many streets;
      // the curbs say where the middle is, so the line moves there, easing back to
      // its nodes so links still meet.
      if (result.left !== null && result.right !== null) {
        const shift = Math.max(-3, Math.min(3, (result.right - result.left) / 2));
        if (Math.abs(shift) > 0.3) {
          recentre(l.pts, shift);
          shifts.push(Math.abs(shift));
        }
      }
    }
  }
  shifts.sort((a, b) => a - b);

  // Each cell belongs to the road whose corridor holds it. Where roads at
  // different levels meet, the higher one keeps its surface and the join is a
  // wall, not a fillet (docs/decisions.md D20).
  const groundLinks = graph.links.filter((l) => l.drivable && !l.bridge);
  const field = rasteriseCorridors(spec, groundLinks);
  // A ramp trench at the river's level is not water: the hydro-flattening test
  // only counts beyond the roads' sidewalk strips.
  let demotedWater = 0;
  for (let k = 0; k < N; k += 1) {
    if (demWaterMask[k] && field.sdf[k] < SIDEWALK_REACH) {
      mask[k] = GROUND.lot;
      demotedWater += 1;
    }
  }
  const { finalSdf, filled, splitCells } = closeCorners(spec, field, FILLET_R);
  const roadElev = field.elev;

  // Curb lines from the zero level set.
  const lines = marchingSquares(finalSdf, W, H, 0);
  const curbs: CurbLine[] = [];
  let curbLength = 0;
  for (const line of lines) {
    const pts: Pt[] = line.map(([i, j]) => [spec.originX + (i + 0.5) * spec.cell, spec.originZ + (j + 0.5) * spec.cell]);
    if (polylineLength(pts) < 6) continue;
    const simplified = simplify(pts, 0.1);
    const elev = new Float32Array(simplified.length);
    for (let n = 0; n < simplified.length; n += 1) {
      const i = Math.max(0, Math.min(W - 1, Math.floor((simplified[n][0] - spec.originX) / spec.cell)));
      const j = Math.max(0, Math.min(H - 1, Math.floor((simplified[n][1] - spec.originZ) / spec.cell)));
      const k = j * W + i;
      const e = Number.isNaN(roadElev[k]) ? dem.heights[k] : roadElev[k];
      elev[n] = e;
    }
    curbs.push({ pts: simplified, elev });
    curbLength += polylineLength(simplified);
  }

  // Burn the heights: flat road surface, sidewalks a curb above it, water below its plane.
  const { burned, roadCells } = burnHeights(dem.heights, dem.waterLevel, (k) => mask[k] === GROUND.water, sidewalkMask, finalSdf, field);
  const surface = scanRoadSurface(spec, burned, groundLinks);
  const crossings = findLevelCrossings(groundLinks);

  // Final classes: road wins over everything; buildings over the rest.
  for (let k = 0; k < N; k += 1) {
    if (finalSdf[k] < 0) mask[k] = GROUND.road;
    else if (buildingMask[k]) mask[k] = GROUND.building;
  }
  const counts = new Map<number, number>();
  for (let k = 0; k < N; k += 1) counts.set(mask[k], (counts.get(mask[k]) ?? 0) + 1);
  const names = Object.entries(GROUND);
  report.push(
    `widths measured against sidewalks or walls on ${measured} of ${graph.links.filter((l) => l.drivable && !l.bridge).length} ground links`,
    `${shifts.length} centrelines recentred between their curbs, median shift ${(shifts[shifts.length >> 1] ?? 0).toFixed(1)} m, largest ${(shifts[shifts.length - 1] ?? 0).toFixed(1)} m`,
    `${sidewalks.length} sidewalk polygons, ${demWater} DEM water cells at ${dem.waterLevel.toFixed(2)} m, ${demotedWater} of them inside road corridors or sidewalk strips put back to lot`,
    `road cells ${roadCells}, corner fill cells ${filled}, ${splitCells} cells kept as walls between roads at different levels, ${curbs.length} curb lines totalling ${(curbLength / 1000).toFixed(1)} km`,
    `ground under road surfaces: ${surface.low} of ${surface.links} ground links have a drop of more than 0.4 m somewhere across their width` +
      (surface.worst ? `, worst ${surface.worst.drop.toFixed(2)} m on ${surface.worst.name} at (${surface.worst.x.toFixed(0)}, ${surface.worst.z.toFixed(0)})` : '') +
      `; ${surface.high} rise more than 0.4 m above the road along its centreline` +
      (surface.worstHigh ? `, worst ${surface.worstHigh.rise.toFixed(2)} m on ${surface.worstHigh.name} at (${surface.worstHigh.x.toFixed(0)}, ${surface.worstHigh.z.toFixed(0)})` : ''),
    `${crossings.length} ground links pass more than ${CROSSING_TOL} m over another road without a bridge tag, which dams the lower road` +
      (crossings.length ? `: ${crossings.slice(0, 8).map((c) => `${c.upper} over ${c.lower} (${c.drop.toFixed(1)} m)`).join('; ')}` : ''),
    `ground classes: ${names.map(([n, id]) => `${n} ${(((counts.get(id) ?? 0) / N) * 100).toFixed(1)}%`).join(', ')}`,
  );
  return { spec, mask, burned, curbs, report };
}

/**
 * Median distance to the nearest sidewalk, wall, water or green on each side; null
 * when too few samples hit. The march stops a few metres past the lane-based half
 * width and the result stays within 0.6 to 1.5 times that estimate, so a missing
 * sidewalk or the far side of a mall cannot turn a street into a plaza.
 */
function measureWidth(spec: GridSpec, l: RoadLink, blocker: (i: number, j: number) => boolean): { width: number; right: number | null; left: number | null } | null {
  const samples = samplePolyline(l.pts, 4).filter((s) => s.s > 6 && s.s < polylineLength(l.pts) - 6);
  if (samples.length < 2) return null;
  const hw = l.width / 2;
  const maxD = Math.min(30, hw + 6);
  const sides: number[][] = [[], []];
  for (const s of samples) {
    for (let side = 0; side < 2; side += 1) {
      const sign = side === 0 ? 1 : -1;
      const nx = -s.hz * sign;
      const nz = s.hx * sign;
      for (let d = 1.5; d <= maxD; d += 0.5) {
        const x = s.x + nx * d;
        const z = s.z + nz * d;
        const i = Math.floor((x - spec.originX) / spec.cell);
        const j = Math.floor((z - spec.originZ) / spec.cell);
        if (blocker(i, j)) {
          sides[side].push(d);
          break;
        }
      }
    }
  }
  const half = (arr: number[]): number | null => {
    if (arr.length < samples.length * 0.5) return null;
    const sorted = arr.slice().sort((a, b) => a - b);
    return sorted[sorted.length >> 1];
  };
  // Side 0 marches along the right-hand normal of the direction of travel.
  const right = half(sides[0]);
  const left = half(sides[1]);
  if (left === null && right === null) return null;
  const width = (left ?? hw) + (right ?? hw);
  return { width: Math.max(3.5, Math.min(40, Math.max(0.6 * l.width, Math.min(1.5 * l.width + 1, width)))), right, left };
}

/** Moves a polyline sideways (positive to the right of travel), tapering to nothing over the last 15 m at each end. */
function recentre(pts: Pt[], shift: number): void {
  const n = pts.length;
  if (n < 2) return;
  const total = polylineLength(pts);
  const moved: Pt[] = [];
  let s = 0;
  for (let i = 0; i < n; i += 1) {
    if (i > 0) s += dist(pts[i - 1], pts[i]);
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(n - 1, i + 1)];
    let dx = next[0] - prev[0];
    let dz = next[1] - prev[1];
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const w = Math.min(1, s / 15, (total - s) / 15);
    moved.push([pts[i][0] - dz * shift * w, pts[i][1] + dx * shift * w]);
  }
  for (let i = 0; i < n; i += 1) pts[i] = moved[i];
}

export function readGeoJson(path: string): GeoJsonCollection {
  return JSON.parse(readFileSync(path, 'utf8')) as GeoJsonCollection;
}
