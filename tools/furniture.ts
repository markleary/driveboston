/**
 * Street furniture: trees, lamps, traffic signals, stop signs, benches and
 * hydrants placed from the city's inventories (trees, street lights, traffic
 * signals) and OpenStreetMap nodes. Every item gets its height from the burned
 * terrain, a yaw and a size. Items that land on the roadway, in a building or
 * in the water are nudged onto the nearest open ground or dropped. Signals are
 * built per approach from the city's intersection points: one pole with a mast
 * arm at the right-hand curb of every road entering the junction.
 */
import { lonLatToLocal } from './lib/frame.ts';
import { projectOnSegment, type Pt } from './lib/geom.ts';
import { sampleBilinear, type GridSpec } from './lib/raster.ts';
import type { GeoJsonCollection } from './lib/arcgis.ts';
import type { OsmData, OsmNode } from './lib/overpass.ts';
import type { RoadGraph, RoadLink } from './roads.ts';
import { FURNITURE, FURNITURE_NAMES, yawFor } from '../src/shared/furniture.ts';
import { GROUND } from '../src/shared/roads.ts';
import type { LocalRect } from '../src/shared/frame.ts';

export interface FurnitureItem {
  kind: number;
  x: number;
  y: number;
  z: number;
  /** Rotation about y; the object's local +x axis faces this way. */
  yaw: number;
  /** Tree height in metres; 1 for everything else. */
  size: number;
  seed: number;
}

export interface FurnitureResult {
  items: FurnitureItem[];
  report: string[];
}

export interface FurnitureInputs {
  trees: GeoJsonCollection;
  streetlights: GeoJsonCollection;
  signals: GeoJsonCollection;
  osm: OsmData;
}

/** How far an item may move to leave the roadway. */
const NUDGE_M = 3;
/** Two sources within this distance describe the same object. */
const DEDUPE_M = 2.5;
/** Signal poles stand this far beyond the junction trim, beside the stop line. */
const STOP_LINE_M = 4.8;
/** Lamps along these classes, or along roads at least `COBRA_WIDTH_M` wide, are tall cobra heads over the road; the rest are pedestal lamps. */
const COBRA_CLASSES = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link']);
const COBRA_WIDTH_M = 13.5;

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Grid index over link segments for nearest-link queries. */
export class LinkIndex {
  private readonly cell = 32;
  private readonly cells = new Map<string, [number, number][]>();
  private readonly links: RoadLink[];

  constructor(links: RoadLink[]) {
    this.links = links;
    links.forEach((l, li) => {
      for (let s = 0; s + 1 < l.pts.length; s += 1) {
        const a = l.pts[s];
        const b = l.pts[s + 1];
        const i0 = Math.floor(Math.min(a[0], b[0]) / this.cell);
        const i1 = Math.floor(Math.max(a[0], b[0]) / this.cell);
        const j0 = Math.floor(Math.min(a[1], b[1]) / this.cell);
        const j1 = Math.floor(Math.max(a[1], b[1]) / this.cell);
        for (let j = j0; j <= j1; j += 1) {
          for (let i = i0; i <= i1; i += 1) {
            const key = `${i},${j}`;
            let list = this.cells.get(key);
            if (!list) {
              list = [];
              this.cells.set(key, list);
            }
            list.push([li, s]);
          }
        }
      }
    });
  }

  /** Nearest point on a link within `maxDist` metres, with the segment's forward direction. */
  nearest(x: number, z: number, maxDist: number, filter?: (l: RoadLink) => boolean): { link: RoadLink; x: number; z: number; d: number; fx: number; fz: number } | null {
    const reach = Math.ceil(maxDist / this.cell);
    const ci = Math.floor(x / this.cell);
    const cj = Math.floor(z / this.cell);
    let best: { link: RoadLink; x: number; z: number; d: number; fx: number; fz: number } | null = null;
    for (let j = cj - reach; j <= cj + reach; j += 1) {
      for (let i = ci - reach; i <= ci + reach; i += 1) {
        for (const [li, s] of this.cells.get(`${i},${j}`) ?? []) {
          const l = this.links[li];
          if (filter && !filter(l)) continue;
          const a = l.pts[s];
          const b = l.pts[s + 1];
          const p = projectOnSegment([x, z], a, b);
          const d = Math.sqrt(p.d2);
          if (d > maxDist || (best && d >= best.d)) continue;
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
          best = { link: l, x: p.x, z: p.z, d, fx: (b[0] - a[0]) / len, fz: (b[1] - a[1]) / len };
        }
      }
    }
    return best;
  }
}

/** Points on a coarse grid, for "is anything within r metres" checks. */
class PointGrid {
  private readonly cells = new Map<string, Pt[]>();
  private readonly cell: number;
  constructor(cell: number) {
    this.cell = cell;
  }
  add(x: number, z: number): void {
    const key = `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`;
    let list = this.cells.get(key);
    if (!list) {
      list = [];
      this.cells.set(key, list);
    }
    list.push([x, z]);
  }
  near(x: number, z: number, r: number): boolean {
    const reach = Math.ceil(r / this.cell);
    const ci = Math.floor(x / this.cell);
    const cj = Math.floor(z / this.cell);
    for (let j = cj - reach; j <= cj + reach; j += 1) {
      for (let i = ci - reach; i <= ci + reach; i += 1) {
        for (const p of this.cells.get(`${i},${j}`) ?? []) if (Math.hypot(p[0] - x, p[1] - z) <= r) return true;
      }
    }
    return false;
  }
}

/** Ground classes that no furniture stands on. */
export function blocksFurniture(cls: number): boolean {
  return cls === GROUND.road || cls === GROUND.building || cls === GROUND.water || cls === GROUND.rail;
}

/**
 * Returns the point itself when it stands on open ground, else the nearest
 * open cell centre within `NUDGE_M`, else null.
 */
export function nudgeOffRoad(spec: GridSpec, mask: Uint8Array, x: number, z: number, reach = NUDGE_M): Pt | null {
  const classAt = (px: number, pz: number): number => {
    const i = Math.floor((px - spec.originX) / spec.cell);
    const j = Math.floor((pz - spec.originZ) / spec.cell);
    if (i < 0 || j < 0 || i >= spec.width || j >= spec.height) return GROUND.lot;
    return mask[j * spec.width + i];
  };
  if (!blocksFurniture(classAt(x, z))) return [x, z];
  let best: Pt | null = null;
  let bestD = Infinity;
  const i0 = Math.floor((x - reach - spec.originX) / spec.cell);
  const i1 = Math.floor((x + reach - spec.originX) / spec.cell);
  const j0 = Math.floor((z - reach - spec.originZ) / spec.cell);
  const j1 = Math.floor((z + reach - spec.originZ) / spec.cell);
  for (let j = j0; j <= j1; j += 1) {
    for (let i = i0; i <= i1; i += 1) {
      if (i < 0 || j < 0 || i >= spec.width || j >= spec.height) continue;
      if (blocksFurniture(mask[j * spec.width + i])) continue;
      const px = spec.originX + (i + 0.5) * spec.cell;
      const pz = spec.originZ + (j + 0.5) * spec.cell;
      const d = Math.hypot(px - x, pz - z);
      if (d <= reach && d < bestD) {
        best = [px, pz];
        bestD = d;
      }
    }
  }
  return best;
}

/** Unit direction of a link leaving the node at its a or b end. */
function dirAway(l: RoadLink, atA: boolean): [number, number] {
  const p = l.pts;
  const n = p.length;
  const dx = atA ? p[1][0] - p[0][0] : p[n - 2][0] - p[n - 1][0];
  const dz = atA ? p[1][1] - p[0][1] : p[n - 2][1] - p[n - 1][1];
  const len = Math.hypot(dx, dz) || 1;
  return [dx / len, dz / len];
}

/**
 * Pose of the signal pole for one approach: at the right-hand curb of traffic
 * entering the node along the link, `trim` plus the stop-line offset back from
 * the node, with the head facing the approaching traffic.
 */
export function signalPolePose(node: Pt, away: [number, number], width: number, trim: number): { x: number; z: number; yaw: number } {
  const back = trim + STOP_LINE_M;
  // Traffic travels along -away; its right-hand side is (away.z, -away.x).
  const rx = away[1];
  const rz = -away[0];
  const side = width / 2 + 0.9;
  return { x: node[0] + away[0] * back + rx * side, z: node[1] + away[1] * back + rz * side, yaw: yawFor(away[0], away[1]) };
}

function pointFeatures(fc: GeoJsonCollection): { x: number; z: number; p: Record<string, unknown> }[] {
  const out: { x: number; z: number; p: Record<string, unknown> }[] = [];
  for (const f of fc.features) {
    if (!f.geometry || f.geometry.type !== 'Point') continue;
    const [lon, lat] = f.geometry.coordinates as [number, number];
    const [x, z] = lonLatToLocal(lon, lat);
    out.push({ x, z, p: f.properties });
  }
  return out;
}

/** Compass bearing in degrees (0 north, 90 east) to a unit world direction. */
function bearingToDir(deg: number): [number, number] {
  const r = (deg * Math.PI) / 180;
  return [Math.sin(r), -Math.cos(r)];
}

export function buildFurniture(inputs: FurnitureInputs, rect: LocalRect, spec: GridSpec, terrain: Float32Array, mask: Uint8Array, graph: RoadGraph): FurnitureResult {
  const items: FurnitureItem[] = [];
  const report: string[] = [];
  const inRect = (x: number, z: number) => x >= rect.minX && x < rect.maxX && z >= rect.minZ && z < rect.maxZ;
  const groundAt = (x: number, z: number) => sampleBilinear(spec, terrain, Math.min(rect.maxX - 0.5, Math.max(rect.minX, x)), Math.min(rect.maxZ - 0.5, Math.max(rect.minZ, z)));
  const index = new LinkIndex(graph.links);
  const counts = new Map<number, number>();
  let nudged = 0;
  let dropped = 0;
  const place = (kind: number, x: number, z: number, yaw: number, size: number, seed: number, nudge = true): boolean => {
    if (!inRect(x, z)) return false;
    let px = x;
    let pz = z;
    if (nudge) {
      const moved = nudgeOffRoad(spec, mask, x, z);
      if (!moved) {
        dropped += 1;
        return false;
      }
      if (moved[0] !== x || moved[1] !== z) nudged += 1;
      [px, pz] = moved;
    }
    items.push({ kind, x: px, y: groundAt(px, pz), z: pz, yaw, size, seed: seed & 0xffff });
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
    return true;
  };
  const osmNodes = (test: (tags: Record<string, string>) => boolean): OsmNode[] =>
    inputs.osm.elements.filter((e): e is OsmNode => e.type === 'node' && !!e.tags && test(e.tags));

  // Trees: the city's inventory (street and park trees), then OpenStreetMap trees it lacks.
  const treeGrid = new PointGrid(8);
  let cityTrees = 0;
  let parkTrees = 0;
  let emptySites = 0;
  for (const t of pointFeatures(inputs.trees)) {
    if (!inRect(t.x, t.z)) continue;
    const species = String(t.p.spp_com ?? t.p.SPP_COM ?? '');
    if (/empty|planting site|stump|vacant|removed|unknown site/i.test(species)) {
      emptySites += 1;
      continue;
    }
    const dbh = Number(t.p.dbh ?? t.p.DBH);
    const height = Number.isFinite(dbh) && dbh > 0 ? Math.min(20, Math.max(4, 4 + 0.45 * dbh)) : 8;
    const seed = hashString(String(t.p.id ?? t.p.ID ?? `${t.x.toFixed(1)},${t.z.toFixed(1)}`));
    if (place(FURNITURE.tree, t.x, t.z, (seed % 628) / 100, height, seed)) {
      treeGrid.add(t.x, t.z);
      cityTrees += 1;
      if (t.p.park ?? t.p.PARK) parkTrees += 1;
    }
  }
  let osmTrees = 0;
  for (const n of osmNodes((t) => t.natural === 'tree')) {
    const [x, z] = lonLatToLocal(n.lon, n.lat);
    if (!inRect(x, z) || treeGrid.near(x, z, DEDUPE_M)) continue;
    const tagged = Number(n.tags?.height);
    const seed = hashString(`tree${n.id}`);
    const height = Number.isFinite(tagged) && tagged > 2 ? Math.min(20, tagged) : 7 + (seed % 5);
    if (place(FURNITURE.tree, x, z, (seed % 628) / 100, height, seed)) {
      treeGrid.add(x, z);
      osmTrees += 1;
    }
  }

  // Lamps: the city's street light inventory, then OpenStreetMap lamps it lacks. Tall cobra heads lean over arterials.
  const lampGrid = new PointGrid(8);
  const placeLamp = (x: number, z: number, seed: number): boolean => {
    const near = index.nearest(x, z, 25, (l) => l.cls !== 'service');
    const cobra = !!near && (COBRA_CLASSES.has(near.link.cls) || near.link.width >= COBRA_WIDTH_M);
    const yaw = near ? yawFor(near.x - x, near.z - z) : (seed % 628) / 100;
    return place(cobra ? FURNITURE.cobra : FURNITURE.lamp, x, z, yaw, 1, seed);
  };
  let cityLamps = 0;
  for (const l of pointFeatures(inputs.streetlights)) {
    if (!inRect(l.x, l.z)) continue;
    if (placeLamp(l.x, l.z, hashString(String(l.p.OBJECTID ?? `${l.x.toFixed(1)},${l.z.toFixed(1)}`)))) {
      lampGrid.add(l.x, l.z);
      cityLamps += 1;
    }
  }
  let osmLamps = 0;
  for (const n of osmNodes((t) => t.highway === 'street_lamp')) {
    const [x, z] = lonLatToLocal(n.lon, n.lat);
    if (!inRect(x, z) || lampGrid.near(x, z, DEDUPE_M)) continue;
    if (placeLamp(x, z, hashString(`lamp${n.id}`))) {
      lampGrid.add(x, z);
      osmLamps += 1;
    }
  }

  // Signals: one pole per approach at every signalised junction. The city's points mark the
  // intersections; OpenStreetMap signal nodes fill in junctions the city layer lacks.
  const junctions = graph.nodes.map((n, i) => ({ i, n })).filter(({ n }) => n.links.length >= 3);
  const nearestJunction = (x: number, z: number, maxDist: number): number => {
    let best = -1;
    let bestD = maxDist;
    for (const { i, n } of junctions) {
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };
  const byOsmId = new Map<number, number>();
  graph.nodes.forEach((n, i) => byOsmId.set(n.osmId, i));
  const signalNodes = new Set<number>();
  const signalGrid = new PointGrid(16);
  let citySignals = 0;
  let unmatchedSignals = 0;
  for (const s of pointFeatures(inputs.signals)) {
    if (!inRect(s.x, s.z)) continue;
    citySignals += 1;
    signalGrid.add(s.x, s.z);
    const node = nearestJunction(s.x, s.z, 30);
    if (node < 0) unmatchedSignals += 1;
    else signalNodes.add(node);
  }
  let osmSignals = 0;
  for (const n of osmNodes((t) => t.highway === 'traffic_signals')) {
    const [x, z] = lonLatToLocal(n.lon, n.lat);
    if (!inRect(x, z) || signalGrid.near(x, z, 25)) continue;
    const known = byOsmId.get(n.id);
    const node = known !== undefined && graph.nodes[known].links.length >= 3 ? known : nearestJunction(x, z, 20);
    if (node < 0) continue;
    osmSignals += 1;
    signalNodes.add(node);
  }
  let heads = 0;
  for (const ni of signalNodes) {
    const node = graph.nodes[ni];
    const links = node.links.map((id) => graph.links[id]);
    for (const l of links) {
      if (!l.drivable || l.cls === 'service') continue;
      const atA = l.a === ni;
      // One-way traffic that leaves the node along this link never faces it.
      if (l.oneway && atA) continue;
      const away = dirAway(l, atA);
      let trim = 2.5;
      for (const m of links) {
        if (m === l) continue;
        const [mx, mz] = dirAway(m, m.a === ni);
        const continues = away[0] * mx + away[1] * mz < -0.866 && m.name === l.name;
        if (!continues) trim = Math.max(trim, m.width / 2 + 1);
      }
      const pose = signalPolePose([node.x, node.z], away, l.width, trim);
      if (place(FURNITURE.signal, pose.x, pose.z, pose.yaw, 1, hashString(`signal${ni}:${l.id}`), false)) heads += 1;
    }
  }

  // Stop signs at the right-hand curb, facing the traffic they stop.
  let stops = 0;
  for (const n of osmNodes((t) => t.highway === 'stop')) {
    const [x, z] = lonLatToLocal(n.lon, n.lat);
    if (!inRect(x, z)) continue;
    const near = index.nearest(x, z, 8, (l) => l.drivable);
    if (!near) continue;
    const dir = n.tags?.direction;
    const travels: [number, number][] = [];
    if (dir === 'forward' || (dir !== 'backward' && near.link.oneway)) travels.push([near.fx, near.fz]);
    else if (dir === 'backward') travels.push([-near.fx, -near.fz]);
    else travels.push([near.fx, near.fz], [-near.fx, -near.fz]);
    for (const [tx, tz] of travels) {
      const side = near.link.width / 2 + 0.8;
      const px = near.x - tz * side;
      const pz = near.z + tx * side;
      if (place(FURNITURE.stop, px, pz, yawFor(-tx, -tz), 1, hashString(`stop${n.id}:${tx > 0 ? 1 : 0}`), false)) stops += 1;
    }
  }

  // Benches face the way they are tagged, else the nearest street; hydrants stand where mapped.
  let benches = 0;
  for (const n of osmNodes((t) => t.amenity === 'bench')) {
    const [x, z] = lonLatToLocal(n.lon, n.lat);
    const tagged = Number(n.tags?.direction);
    let yaw: number;
    if (Number.isFinite(tagged)) {
      const [dx, dz] = bearingToDir(tagged);
      yaw = yawFor(dx, dz);
    } else {
      const near = index.nearest(x, z, 40);
      yaw = near ? yawFor(near.x - x, near.z - z) : 0;
    }
    if (place(FURNITURE.bench, x, z, yaw, 1, hashString(`bench${n.id}`))) benches += 1;
  }
  let hydrants = 0;
  for (const n of osmNodes((t) => t.emergency === 'fire_hydrant')) {
    const [x, z] = lonLatToLocal(n.lon, n.lat);
    const seed = hashString(`hydrant${n.id}`);
    if (place(FURNITURE.hydrant, x, z, (seed % 628) / 100, 1, seed)) hydrants += 1;
  }

  const kindCounts = FURNITURE_NAMES.map((name) => `${name} ${counts.get(FURNITURE[name]) ?? 0}`).join(', ');
  report.push(
    `${items.length} items: ${kindCounts}`,
    `trees: ${cityTrees} from the city inventory (${parkTrees} in parks, ${emptySites} empty or planned sites skipped), ${osmTrees} more from OpenStreetMap`,
    `lamps: ${cityLamps} from the city street light inventory, ${osmLamps} more from OpenStreetMap; cobra heads over ${[...COBRA_CLASSES].join(', ')} and roads at least ${COBRA_WIDTH_M} m wide`,
    `signals: ${citySignals} city intersections (${unmatchedSignals} without a junction within 30 m), ${osmSignals} more from OpenStreetMap; ${signalNodes.size} junctions, ${heads} poles`,
    `${stops} stop signs, ${benches} benches, ${hydrants} hydrants from OpenStreetMap`,
    `${nudged} items moved off the roadway, buildings or water (up to ${NUDGE_M} m), ${dropped} dropped`,
  );
  return { items, report };
}
