/**
 * Real building meshes from the Boston Planning Department's citywide 3D
 * model. Each tile archive carries a catalogue and one OBJ per model in
 * State Plane feet shifted by a city offset. The offset is measured from the
 * catalogue (lon/lat centroid versus shifted centroid) instead of assumed, the
 * vertical datum is measured against the lidar terrain the same way, and every
 * kept model is quantised about its own origin for the world file. Footprint
 * parts that a model covers are flagged so the runtime draws the model and
 * keeps the extrusion only as a collider.
 */
import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync, type Unzipped } from 'fflate';
import { parseCsv } from './lib/csv.ts';
import { parseObj } from './lib/obj.ts';
import { rawPath } from './lib/download.ts';
import { lonLatToLocal } from './lib/frame.ts';
import { lonLatToStatePlaneFt, statePlaneFtToLocal, US_FT } from './lib/bos3d.ts';
import { signedArea, type Pt } from './lib/geom.ts';
import { sampleBilinear, type GridSpec } from './lib/raster.ts';
import { pickStyle, type BuildingPart } from './buildings.ts';
import { PART_FLAG, STYLE, styleName } from '../src/shared/buildings.ts';
import { GROUND } from '../src/shared/roads.ts';
import type { LocalRect } from '../src/shared/frame.ts';

/** Built or being built today; demolished, approved and proposed models are left to the footprint extrusions. */
const KEEP_STATUS = new Set(['Current', 'Complete', 'Under Construction']);
const KEEP_TYPES = new Set(['Building', 'Structure', 'Wall', '']);

/** Facade styles chosen from the catalogue name; everything else inherits the style of the footprint it covers. */
const NAME_STYLES: [RegExp, number][] = [
  [/christian science/i, STYLE.limestone],
  [/church|chapel|cathedral|temple|synagogue/i, STYLE.brownstone],
  [/library/i, STYLE.granite],
  [/hancock|prudential|dalton|liberty mutual/i, STYLE.glass],
];

/** Metres per quantised position unit in the world file. */
export const POSITION_UNIT_M = 0.02;
/** Freestanding walls this low get no windows. */
const WINDOWLESS_WALL_M = 4.5;
/** Anything this low gets no windows. */
const WINDOWLESS_ANY_M = 3;
/** A footprint is covered when this share of its probes falls under a model. */
const COVER_SHARE = 0.6;
/** A model with this share of its footprint on road cells stands on the flattened roadway and is dropped. */
const ROAD_SHARE = 0.6;
const CELL_M = 32;

export interface PackedModel {
  id: string;
  name: string;
  lod: string;
  struct: string;
  /** x, ground y, z in local metres. */
  origin: [number, number, number];
  /** Vertex positions relative to the origin in units of `POSITION_UNIT_M`. */
  xyz: Int16Array;
  /** Triangle vertex indices local to the model. */
  index: Uint16Array;
  style: number;
  seed: number;
  heightM: number;
}

export interface ModelsResult {
  models: PackedModel[];
  /** `PART_FLAG` bits per footprint part. */
  partFlags: Uint8Array;
  shift: { eastFt: number; northFt: number; verticalM: number };
  report: string[];
}

interface Candidate {
  row: Record<string, string>;
  zip: Unzipped;
  x: number;
  z: number;
}

interface Placed extends Candidate {
  xyz: Float64Array;
  tris: Uint32Array;
  groundY: number;
  heightM: number;
  box: { minX: number; maxX: number; minZ: number; maxZ: number };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

const percentile = (sorted: number[], f: number): number => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * f))] : 0);

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function pointInTriangleXZ(px: number, pz: number, ax: number, az: number, bx: number, bz: number, cx: number, cz: number): boolean {
  const d1 = (px - bx) * (az - bz) - (ax - bx) * (pz - bz);
  const d2 = (px - cx) * (bz - cz) - (bx - cx) * (pz - cz);
  const d3 = (px - ax) * (cz - az) - (cx - ax) * (pz - az);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

function nameStyle(name: string): number {
  for (const [re, s] of NAME_STYLES) if (re.test(name)) return s;
  return -1;
}

/**
 * Rasterises a mesh's projected triangles over the ground grid and counts the
 * cells it covers and how many of them carry the given ground class.
 */
export function maskShare(spec: GridSpec, mask: Uint8Array, xyz: ArrayLike<number>, tris: ArrayLike<number>, cls: number): { cells: number; hits: number } {
  const covered = new Set<number>();
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3;
    const b = tris[t + 1] * 3;
    const c = tris[t + 2] * 3;
    const ax = xyz[a];
    const az = xyz[a + 2];
    const bx = xyz[b];
    const bz = xyz[b + 2];
    const cx = xyz[c];
    const cz = xyz[c + 2];
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - spec.originX) / spec.cell));
    const i1 = Math.min(spec.width - 1, Math.floor((Math.max(ax, bx, cx) - spec.originX) / spec.cell));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - spec.originZ) / spec.cell));
    const j1 = Math.min(spec.height - 1, Math.floor((Math.max(az, bz, cz) - spec.originZ) / spec.cell));
    for (let j = j0; j <= j1; j += 1) {
      const pz = spec.originZ + (j + 0.5) * spec.cell;
      for (let i = i0; i <= i1; i += 1) {
        const px = spec.originX + (i + 0.5) * spec.cell;
        if (pointInTriangleXZ(px, pz, ax, az, bx, bz, cx, cz)) covered.add(j * spec.width + i);
      }
    }
  }
  let hits = 0;
  for (const k of covered) if (mask[k] === cls) hits += 1;
  return { cells: covered.size, hits };
}

function meshContainsXZ(m: Placed, px: number, pz: number): boolean {
  const v = m.xyz;
  const t = m.tris;
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * 3;
    const b = t[i + 1] * 3;
    const c = t[i + 2] * 3;
    if (pointInTriangleXZ(px, pz, v[a], v[a + 2], v[b], v[b + 2], v[c], v[c + 2])) return true;
  }
  return false;
}

/**
 * Reads the tile archives already fetched for the box and returns the models
 * inside the rectangle, converted to local metres and quantised, together with
 * the footprint parts they cover. `mask` holds the ground class per cell of
 * `terrainSpec`; models standing on the flattened roadway are dropped.
 */
export function buildModels(tileKeys: string[], rect: LocalRect, terrainSpec: GridSpec, terrain: Float32Array, mask: Uint8Array, parts: BuildingPart[]): ModelsResult {
  const report: string[] = [];
  const clampX = (x: number) => Math.min(rect.maxX - 0.5, Math.max(rect.minX, x));
  const clampZ = (z: number) => Math.min(rect.maxZ - 0.5, Math.max(rect.minZ, z));
  const terrainAt = (x: number, z: number) => sampleBilinear(terrainSpec, terrain, clampX(x), clampZ(z));

  // Catalogues: which models stand in the box, and the shift the city applied to State Plane coordinates.
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  const dE: number[] = [];
  const dN: number[] = [];
  const statusCounts = new Map<string, number>();
  const typeCounts = new Map<string, number>();
  let catalogRows = 0;
  let inBox = 0;
  for (const key of tileKeys) {
    const zip = unzipSync(new Uint8Array(readFileSync(rawPath(key))));
    const catalog = zip['catalog.csv'];
    if (!catalog) throw new Error(`${key}: no catalog.csv in the tile archive`);
    for (const row of parseCsv(strFromU8(catalog))) {
      catalogRows += 1;
      const lon = Number(row.Centr_Lon);
      const lat = Number(row.Centr_Lat);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      const [x, z] = lonLatToLocal(lon, lat);
      if (x < rect.minX || x >= rect.maxX || z < rect.minZ || z >= rect.maxZ) continue;
      inBox += 1;
      const [e, n] = lonLatToStatePlaneFt(lon, lat);
      const cx = Number(row.Centr_X_Ft);
      const cy = Number(row.Centr_Y_Ft);
      if (Number.isFinite(cx) && Number.isFinite(cy)) {
        dE.push(e - cx);
        dN.push(n - cy);
      }
      bump(statusCounts, row.Status || '(none)');
      bump(typeCounts, row.StructType || '(none)');
      if (!KEEP_STATUS.has(row.Status) || !KEEP_TYPES.has(row.StructType) || seen.has(row.Model_ID)) continue;
      seen.add(row.Model_ID);
      candidates.push({ row, zip, x, z });
    }
  }
  dE.sort((a, b) => a - b);
  dN.sort((a, b) => a - b);
  const shiftE = percentile(dE, 0.5);
  const shiftN = percentile(dN, 0.5);
  const spreadE = percentile(dE, 0.98) - percentile(dE, 0.02);
  const spreadN = percentile(dN, 0.98) - percentile(dN, 0.02);

  // Geometry: shifted State Plane feet to local metres, then the vertical datum against the terrain.
  interface Converted extends Candidate {
    xyz: Float64Array;
    tris: Uint32Array;
    residual: number;
  }
  const converted: Converted[] = [];
  let missing = 0;
  for (const c of candidates) {
    const inner = c.zip[`objz/${c.row.Model_ID}_OBJ.zip`];
    if (!inner) {
      missing += 1;
      continue;
    }
    const files = unzipSync(inner);
    const objName = Object.keys(files).find((f) => f.toLowerCase().endsWith('.obj'));
    if (!objName) {
      missing += 1;
      continue;
    }
    const mesh = parseObj(strFromU8(files[objName]));
    if (mesh.triangles.length < 3) {
      missing += 1;
      continue;
    }
    const n = mesh.vertices.length / 3;
    const xyz = new Float64Array(n * 3);
    for (let i = 0; i < n; i += 1) {
      const [x, z] = statePlaneFtToLocal(mesh.vertices[i * 3] + shiftE, mesh.vertices[i * 3 + 1] + shiftN);
      xyz[i * 3] = x;
      xyz[i * 3 + 1] = mesh.vertices[i * 3 + 2] * US_FT;
      xyz[i * 3 + 2] = z;
    }
    const gnd = Number(c.row.Gnd_El_Ft);
    converted.push({ ...c, xyz, tris: mesh.triangles, residual: Number.isFinite(gnd) ? gnd * US_FT - terrainAt(c.x, c.z) : NaN });
  }
  const residuals = converted.map((c) => c.residual).filter((r) => Number.isFinite(r)).sort((a, b) => a - b);
  const vShift = percentile(residuals, 0.5);
  const vSpread = percentile(residuals, 0.9) - percentile(residuals, 0.1);

  let lowered = 0;
  const standing: Placed[] = [];
  for (const c of converted) {
    const n = c.xyz.length / 3;
    let minY = Infinity;
    let maxY = -Infinity;
    let ground = Infinity;
    const box = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (let i = 0; i < n; i += 1) {
      const y = c.xyz[i * 3 + 1] - vShift;
      c.xyz[i * 3 + 1] = y;
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      const x = c.xyz[i * 3];
      const z = c.xyz[i * 3 + 2];
      box.minX = Math.min(box.minX, x);
      box.maxX = Math.max(box.maxX, x);
      box.minZ = Math.min(box.minZ, z);
      box.maxZ = Math.max(box.maxZ, z);
      ground = Math.min(ground, terrainAt(x, z));
    }
    // The city extends model bottoms below its ground; one that still floats above the lidar ground is lowered.
    if (minY > ground - 0.3) {
      const drop = minY - (ground - 0.5);
      for (let i = 0; i < n; i += 1) c.xyz[i * 3 + 1] -= drop;
      maxY -= drop;
      lowered += 1;
    }
    standing.push({ row: c.row, zip: c.zip, x: c.x, z: c.z, xyz: c.xyz, tris: c.tris, groundY: ground, heightM: maxY - ground, box });
  }

  // The city's data has ramp walls, barriers and misplaced pieces where the road corridor has been
  // flattened; a model standing mostly on road cells is dropped rather than drawn across the lanes.
  let onRoad = 0;
  let onRoadArea = 0;
  let onRoadTallest = 0;
  const placed = standing.filter((m) => {
    if (nameStyle(m.row.Name ?? '') >= 0) return true;
    const { cells, hits } = maskShare(terrainSpec, mask, m.xyz, m.tris, GROUND.road);
    if (cells === 0 || hits < cells * ROAD_SHARE) return true;
    onRoad += 1;
    onRoadArea += hits * terrainSpec.cell * terrainSpec.cell;
    onRoadTallest = Math.max(onRoadTallest, m.heightM);
    return false;
  });

  // Footprint coverage: probe each part's shrunken outline against the models' projected triangles.
  const gw = Math.ceil((rect.maxX - rect.minX) / CELL_M);
  const gh = Math.ceil((rect.maxZ - rect.minZ) / CELL_M);
  const cells: number[][] = Array.from({ length: gw * gh }, () => []);
  placed.forEach((m, mi) => {
    const i0 = Math.max(0, Math.floor((m.box.minX - rect.minX) / CELL_M));
    const i1 = Math.min(gw - 1, Math.floor((m.box.maxX - rect.minX) / CELL_M));
    const j0 = Math.max(0, Math.floor((m.box.minZ - rect.minZ) / CELL_M));
    const j1 = Math.min(gh - 1, Math.floor((m.box.maxZ - rect.minZ) / CELL_M));
    for (let j = j0; j <= j1; j += 1) for (let i = i0; i <= i1; i += 1) cells[j * gw + i].push(mi);
  });
  const partFlags = new Uint8Array(parts.length);
  const coveredParts: number[][] = placed.map(() => []);
  const hitsBy = new Int32Array(placed.length);
  let covered = 0;
  let partial = 0;
  parts.forEach((part, pi) => {
    const ring = part.rings[0];
    let cx = 0;
    let cz = 0;
    for (const q of ring) {
      cx += q[0];
      cz += q[1];
    }
    cx /= ring.length;
    cz /= ring.length;
    const probes: Pt[] = [[cx, cz], ...ring.map((q): Pt => [cx + (q[0] - cx) * 0.7, cz + (q[1] - cz) * 0.7])];
    const touched: number[] = [];
    let hits = 0;
    for (const [px, pz] of probes) {
      const gi = Math.floor((px - rect.minX) / CELL_M);
      const gj = Math.floor((pz - rect.minZ) / CELL_M);
      if (gi < 0 || gj < 0 || gi >= gw || gj >= gh) continue;
      let hit = -1;
      for (const mi of cells[gj * gw + gi]) {
        const m = placed[mi];
        if (px < m.box.minX || px > m.box.maxX || pz < m.box.minZ || pz > m.box.maxZ) continue;
        if (meshContainsXZ(m, px, pz)) {
          hit = mi;
          break;
        }
      }
      if (hit >= 0) {
        hits += 1;
        if (hitsBy[hit] === 0) touched.push(hit);
        hitsBy[hit] += 1;
      }
    }
    if (hits >= probes.length * COVER_SHARE) {
      partFlags[pi] |= PART_FLAG.covered;
      covered += 1;
      let best = touched[0];
      for (const mi of touched) if (hitsBy[mi] > hitsBy[best]) best = mi;
      coveredParts[best].push(pi);
    } else if (hits >= probes.length * 0.2) partial += 1;
    for (const mi of touched) hitsBy[mi] = 0;
  });

  // Styles, then quantisation about each model's origin.
  const models: PackedModel[] = [];
  const styleCounts = new Map<string, number>();
  const landmarks: string[] = [];
  let outOfRange = 0;
  let uncovering = 0;
  let vertices = 0;
  let triangles = 0;
  placed.forEach((m, mi) => {
    const name = (m.row.Name ?? '').replace(/\s+/g, ' ').trim();
    const seed = hashString(m.row.Model_ID);
    let style = nameStyle(name);
    if (style >= 0) landmarks.push(`${name} (${styleName(style)})`);
    else {
      const mine = coveredParts[mi];
      if (mine.length) {
        let best = mine[0];
        let bestArea = -1;
        for (const pi of mine) {
          const area = Math.abs(signedArea(parts[pi].rings[0]));
          if (area > bestArea) {
            bestArea = area;
            best = pi;
          }
        }
        style = parts[best].style;
      } else {
        uncovering += 1;
        style = pickStyle(m.heightM, (m.box.maxX - m.box.minX) * (m.box.maxZ - m.box.minZ), {}, seed);
      }
    }
    if ((m.row.StructType === 'Wall' && m.heightM < WINDOWLESS_WALL_M) || m.heightM < WINDOWLESS_ANY_M) style = STYLE.plain;

    const origin: [number, number, number] = [Math.round((m.box.minX + m.box.maxX) / 2), Math.round(m.groundY * 100) / 100, Math.round((m.box.minZ + m.box.maxZ) / 2)];
    const n = m.xyz.length / 3;
    const q = new Int16Array(n * 3);
    let ok = n <= 65535;
    for (let i = 0; i < n * 3 && ok; i += 1) {
      const v = Math.round((m.xyz[i] - origin[i % 3]) / POSITION_UNIT_M);
      if (v < -32768 || v > 32767) ok = false;
      q[i] = v;
    }
    if (!ok) {
      outOfRange += 1;
      for (const pi of coveredParts[mi]) partFlags[pi] &= ~PART_FLAG.covered;
      return;
    }
    models.push({
      id: m.row.Model_ID,
      name,
      lod: m.row.Model_LOD,
      struct: m.row.StructType,
      origin,
      xyz: q,
      index: Uint16Array.from(m.tris),
      style,
      seed: seed & 0xffff,
      heightM: m.heightM,
    });
    vertices += n;
    triangles += m.tris.length / 3;
    bump(styleCounts, styleName(style));
  });

  const fmtCounts = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ');
  report.push(
    `${tileKeys.length} tiles, ${catalogRows} catalogue rows, ${inBox} in the box (status: ${fmtCounts(statusCounts)}; type: ${fmtCounts(typeCounts)})`,
    `${candidates.length} models kept (Current, Complete or Under Construction; Building, Structure or Wall), ${missing} without usable geometry`,
    `State Plane shift measured from the catalogue: east ${shiftE.toFixed(1)} ft, north ${shiftN.toFixed(1)} ft (2nd to 98th percentile spread ${spreadE.toFixed(1)} and ${spreadN.toFixed(1)} ft)`,
    `vertical datum: model ground (feet to metres) minus DEM has median ${vShift.toFixed(2)} m, 10th to 90th percentile spread ${vSpread.toFixed(2)} m over ${residuals.length} models; ${lowered} floating models lowered onto the terrain`,
    `${onRoad} models standing mostly on the roadway dropped (${Math.round(ROAD_SHARE * 100)}% or more of their footprint on road cells; ${Math.round(onRoadArea)} m2 of road under them, tallest ${onRoadTallest.toFixed(1)} m)`,
    `${models.length} models packed with ${vertices} vertices and ${triangles} triangles; ${outOfRange} too large to quantise`,
    `${covered} of ${parts.length} footprint parts are covered by a model and will not be drawn (${partial} more are partly covered); ${uncovering} models cover no footprint part`,
    `styles: ${fmtCounts(styleCounts)}`,
    `styled by name: ${landmarks.length ? landmarks.join('; ') : 'none'}`,
  );
  return { models, partFlags, shift: { eastFt: shiftE, northFt: shiftN, verticalM: vShift }, report };
}
