import { readFileSync } from 'node:fs';
import { bbox, dist, pointInRing, signedArea, simplify, type Pt } from './lib/geom.ts';
import { sampleBilinear, type GridSpec } from './lib/raster.ts';
import { geoJsonToLocalRings } from './groundmask.ts';
import { rawPath } from './lib/download.ts';
import { lonLatToLocal } from './lib/frame.ts';
import type { GeoJsonCollection } from './lib/arcgis.ts';
import type { OsmData, OsmNode, OsmWay } from './lib/overpass.ts';
import type { LocalRect } from '../src/shared/frame.ts';
import { STYLE } from '../src/shared/buildings.ts';

export interface BuildingPart {
  rings: Pt[][];
  base: number;
  roof: number;
  style: number;
  seed: number;
  heightSource: 'measured' | 'osm' | 'default';
}

interface OsmBuildingHeight {
  ring: Pt[];
  box: ReturnType<typeof bbox>;
  height: number;
}

/** OSM building outlines that carry a height or a storey count, for footprints the city has no height for. */
export function loadOsmBuildingHeights(boxName: string): OsmBuildingHeight[] {
  let osm: OsmData;
  try {
    osm = JSON.parse(readFileSync(rawPath(`${boxName}/osm-buildings.json`), 'utf8')) as OsmData;
  } catch {
    return [];
  }
  const nodes = new Map<number, OsmNode>();
  const ways: OsmWay[] = [];
  for (const e of osm.elements) {
    if (e.type === 'node') nodes.set(e.id, e);
    else if (e.type === 'way') ways.push(e);
  }
  const out: OsmBuildingHeight[] = [];
  for (const w of ways) {
    const t = w.tags ?? {};
    if (!t.building && !t['building:part']) continue;
    if (w.nodes[0] !== w.nodes[w.nodes.length - 1] || w.nodes.length < 4) continue;
    let height: number | null = null;
    const h = /^\s*([\d.]+)\s*(m|ft|')?/.exec(t.height ?? '');
    if (h) height = parseFloat(h[1]) * (h[2] && h[2] !== 'm' ? FT : 1);
    else if (t['building:levels']) {
      const levels = parseFloat(t['building:levels']);
      if (Number.isFinite(levels) && levels > 0) height = levels * 3.4 + (t['roof:levels'] ? parseFloat(t['roof:levels']) * 3 : 0.5);
    }
    if (!height || !Number.isFinite(height)) continue;
    const ring = w.nodes.slice(0, -1).map((id) => nodes.get(id)).filter((n): n is OsmNode => !!n).map((n) => lonLatToLocal(n.lon, n.lat));
    if (ring.length < 3) continue;
    out.push({ ring, box: bbox(ring), height });
  }
  return out;
}

export interface BuildingsResult {
  parts: BuildingPart[];
  /** Metres subtracted from the source elevations (in metres) to land on the DEM datum. */
  datumShift: number;
  report: string[];
}

const FT = 0.3048;
const DEFAULT_HEIGHT_M = 12;

export { STYLE };

function hash32(n: number): number {
  let x = (n ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

function cleanRing(ring: Pt[]): Pt[] | null {
  const dedup: Pt[] = [];
  for (const p of ring) if (dedup.length === 0 || dist(dedup[dedup.length - 1], p) > 0.02) dedup.push(p);
  if (dedup.length > 1 && dist(dedup[0], dedup[dedup.length - 1]) < 0.02) dedup.pop();
  if (dedup.length < 3) return null;
  const closedForSimplify = [...dedup, dedup[0]];
  const simplified = simplify(closedForSimplify, 0.06);
  simplified.pop();
  if (simplified.length < 3) return null;
  return simplified;
}

export function buildBuildings(fc: GeoJsonCollection, rect: LocalRect, terrainSpec: GridSpec, terrain: Float32Array, osmHeights: OsmBuildingHeight[] = []): BuildingsResult {
  const report: string[] = [];
  const features = geoJsonToLocalRings(fc);
  const terrainAt = (x: number, z: number) => sampleBilinear(terrainSpec, terrain, x, z);

  // Source elevations are in feet; measure their datum against the DEM.
  const residuals: number[] = [];
  const inRect = (rings: Pt[][]) => {
    const b = bbox(rings[0]);
    return b.maxX > rect.minX && b.minX < rect.maxX && b.maxZ > rect.minZ && b.minZ < rect.maxZ;
  };
  for (const f of features) {
    const g = f.properties.GRND_ELEV_2010;
    if (typeof g !== 'number' || !inRect(f.rings)) continue;
    const ring = f.rings[0];
    let cx = 0;
    let cz = 0;
    for (const p of ring) {
      cx += p[0];
      cz += p[1];
    }
    cx /= ring.length;
    cz /= ring.length;
    residuals.push(g * FT - terrainAt(cx, cz));
  }
  residuals.sort((a, b) => a - b);
  const datumShift = residuals.length ? residuals[residuals.length >> 1] : 0;
  const spread = residuals.length ? residuals[Math.floor(residuals.length * 0.9)] - residuals[Math.floor(residuals.length * 0.1)] : 0;

  const parts: BuildingPart[] = [];
  let skippedType = 0;
  let skippedSmall = 0;
  let skippedOutside = 0;
  let defaulted = 0;
  let fromOsm = 0;
  const defaultedAreas: number[] = [];
  for (const f of features) {
    const p = f.properties;
    const type = p.IEL_TYPE as string | null;
    if (type && ['OVHD-WALKWAY', 'MOBILE', 'CONSTRUCT'].includes(type)) {
      skippedType += 1;
      continue;
    }
    if (!inRect(f.rings)) {
      skippedOutside += 1;
      continue;
    }
    const rings: Pt[][] = [];
    for (let r = 0; r < f.rings.length; r += 1) {
      const cleaned = cleanRing(f.rings[r]);
      if (!cleaned) continue;
      const area = signedArea(cleaned);
      if (Math.abs(area) < 2) continue;
      // Outer rings positive (clockwise seen from above with north up), holes negative.
      const wantPositive = r === 0;
      if ((area > 0) !== wantPositive) cleaned.reverse();
      rings.push(cleaned);
    }
    if (rings.length === 0 || signedArea(rings[0]) < 4) {
      skippedSmall += 1;
      continue;
    }
    const outer = rings[0];
    let ground = Infinity;
    for (const q of outer) ground = Math.min(ground, terrainAt(q[0], q[1]));
    const base = ground - 0.4;
    const roofFt = p.ROOF_ELEV_2010;
    const heightFt = p.BLDG_HGT_2010;
    let roof: number;
    let heightSource: BuildingPart['heightSource'] = 'measured';
    if (typeof roofFt === 'number' && typeof heightFt === 'number' && heightFt > 0) {
      roof = roofFt * FT - datumShift;
      // Guard against outliers: a roof below ground means a bad elevation; use the height instead.
      if (roof < ground + 1) roof = ground + heightFt * FT;
    } else {
      // No city height: borrow the OSM building that contains the centroid, else a default.
      let cx = 0;
      let cz = 0;
      for (const q of outer) {
        cx += q[0];
        cz += q[1];
      }
      cx /= outer.length;
      cz /= outer.length;
      const osm = osmHeights.find((o) => cx >= o.box.minX && cx <= o.box.maxX && cz >= o.box.minZ && cz <= o.box.maxZ && pointInRing([cx, cz], o.ring));
      if (osm) {
        roof = ground + osm.height;
        heightSource = 'osm';
        fromOsm += 1;
      } else {
        roof = ground + DEFAULT_HEIGHT_M;
        heightSource = 'default';
        defaulted += 1;
        defaultedAreas.push(signedArea(outer));
      }
    }
    if (roof - ground < 2.2) {
      skippedSmall += 1;
      continue;
    }
    const seed = hash32(Number(p.OBJECTID ?? parts.length));
    parts.push({ rings, base, roof, style: pickStyle(roof - ground, signedArea(outer), p, seed), seed: seed & 0xffff, heightSource });
  }
  defaultedAreas.sort((a, b) => b - a);
  report.push(
    `${features.length} source parts: ${parts.length} kept, ${skippedType} skipped by type, ${skippedSmall} too small or low, ${skippedOutside} outside the box`,
    `elevation datum: source ground (feet to metres) minus DEM has median ${datumShift.toFixed(2)} m, 10th to 90th percentile spread ${spread.toFixed(2)} m, over ${residuals.length} parts`,
    `${fromOsm} parts without a city height take OpenStreetMap heights; ${defaulted} use ${DEFAULT_HEIGHT_M} m; largest footprints without any height: ${defaultedAreas.slice(0, 5).map((a) => `${Math.round(a)} m2`).join(', ')}`,
    `styles: ${Object.entries(STYLE).map(([n, id]) => `${n} ${parts.filter((q) => q.style === id).length}`).join(', ')}`,
  );
  return { parts, datumShift, report };
}

/** Facade style from a part's height, footprint area, land use code and seed. */
export function pickStyle(height: number, area: number, p: Record<string, unknown>, seed: number): number {
  const r = (seed % 1000) / 1000;
  const use = String(p.PART_USE ?? '');
  if (height > 60) return r < 0.6 ? STYLE.glass : STYLE.concrete;
  if (height > 30) return r < 0.35 ? STYLE.glass : r < 0.65 ? STYLE.limestone : STYLE.brickRed;
  if (height < 5 && area < 120) return r < 0.5 ? STYLE.concrete : STYLE.painted;
  // Back Bay row houses: narrow footprints of four to five storeys.
  if (area < 400 && height >= 10 && height <= 22) {
    if (r < 0.42) return STYLE.brownstone;
    if (r < 0.8) return STYLE.brickRed;
    if (r < 0.9) return STYLE.brickBrown;
    return STYLE.limestone;
  }
  if (use.startsWith('E') || use === 'A') return r < 0.5 ? STYLE.limestone : STYLE.granite;
  if (r < 0.55) return STYLE.brickRed;
  if (r < 0.75) return STYLE.brickBrown;
  if (r < 0.88) return STYLE.limestone;
  return STYLE.painted;
}

/** True when the point lies inside the polygon (outer ring minus holes). */
export function insidePart(p: Pt, rings: Pt[][]): boolean {
  if (!pointInRing(p, rings[0])) return false;
  for (let r = 1; r < rings.length; r += 1) if (pointInRing(p, rings[r])) return false;
  return true;
}
