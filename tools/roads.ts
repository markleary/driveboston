import { readFileSync } from 'node:fs';
import { rawPath } from './lib/download.ts';
import { lonLatToLocal } from './lib/frame.ts';
import { clipPolylineToRect, dist, projectOnSegment, samplePolyline, type Pt } from './lib/geom.ts';
import { sampleBilinear } from './lib/raster.ts';
import type { OsmData, OsmNode, OsmWay, OsmRelation } from './lib/overpass.ts';
import type { LocalDem } from './terrain.ts';
import type { LocalRect } from '../src/shared/frame.ts';
import { ROAD_CLASS, type RoadClassName } from '../src/shared/roads.ts';

export interface RoadLink {
  id: number;
  osmWayId: number;
  a: number;
  b: number;
  name: string;
  cls: RoadClassName;
  oneway: boolean;
  lanes: number;
  /** Curb-to-curb width in metres and how it was decided. */
  width: number;
  widthSource: 'tag' | 'measured' | 'lanes' | 'class';
  bridge: boolean;
  tunnel: boolean;
  layer: number;
  maxSpeedMps: number;
  drivable: boolean;
  /** Polyline in local metres; elevation filled in by `profileLinks`. */
  pts: Pt[];
  elev: Float32Array;
}

export interface RoadNode {
  x: number;
  z: number;
  y: number;
  osmId: number;
  links: number[];
}

export interface PathLine {
  pts: Pt[];
  width: number;
  kind: 'footway' | 'cycleway' | 'steps' | 'pedestrian' | 'path';
}

export interface Polygonal {
  rings: Pt[][];
  kind: 'water' | 'grass' | 'paved' | 'parking' | 'rail';
  name: string;
}

export interface RoadGraph {
  nodes: RoadNode[];
  links: RoadLink[];
  paths: PathLine[];
  polygons: Polygonal[];
  railLines: Pt[][];
  report: string[];
}

const DRIVABLE: Record<string, RoadClassName> = {
  motorway: 'motorway',
  motorway_link: 'motorway_link',
  trunk: 'trunk',
  trunk_link: 'trunk_link',
  primary: 'primary',
  primary_link: 'primary_link',
  secondary: 'secondary',
  secondary_link: 'secondary_link',
  tertiary: 'tertiary',
  tertiary_link: 'tertiary_link',
  unclassified: 'unclassified',
  residential: 'residential',
  living_street: 'living_street',
  service: 'service',
};

const PATH_WIDTHS: Record<string, number> = { footway: 2.2, cycleway: 3, steps: 2, pedestrian: 5, path: 2 };

const MPH = 0.44704;

function parseWidth(v: string | undefined): number | null {
  if (!v) return null;
  const m = /^\s*([\d.]+)\s*(m|ft|'|feet)?\s*$/.exec(v);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return m[2] && m[2] !== 'm' ? n * 0.3048 : n;
}

function parseSpeed(v: string | undefined, cls: RoadClassName): number {
  if (v) {
    const m = /([\d.]+)\s*(mph)?/.exec(v);
    if (m) return parseFloat(m[1]) * (m[2] || !/km/.test(v) ? MPH : 1 / 3.6);
  }
  return ROAD_CLASS[cls].speedMph * MPH;
}

/** Sides of the street with parking (0 to 2) from the parking tags, falling back to the class. */
function parkingSides(t: Record<string, string | undefined>, cls: RoadClassName): number {
  const no = (v: string | undefined) => v !== undefined && /^(no|no_parking|no_stopping|no_standing|separate)$/.test(v);
  const yes = (v: string | undefined) => v !== undefined && /^(yes|lane|parallel|street_side|on_street|diagonal|perpendicular|marked|half_on_kerb|on_kerb)$/.test(v);
  const both = t['parking:both'] ?? t['parking:lane:both'];
  const left = t['parking:left'] ?? t['parking:lane:left'] ?? both;
  const right = t['parking:right'] ?? t['parking:lane:right'] ?? both;
  const fallback = ROAD_CLASS[cls].parking ? 1 : 0;
  const side = (v: string | undefined) => (no(v) ? 0 : yes(v) ? 1 : fallback);
  return side(left) + side(right);
}

/** Curb-to-curb width from the lane count, a 2.2 m parking lane per side, and the class lane width. */
function classWidth(cls: RoadClassName, lanes: number | null, service: string | undefined, parking: number): { width: number; source: 'lanes' | 'class' } {
  const c = ROAD_CLASS[cls];
  if (cls === 'service') return { width: service === 'alley' ? 5.5 : 6, source: 'class' };
  return { width: (lanes ?? c.lanes) * c.laneWidth + parking * 2.2, source: lanes ? 'lanes' : 'class' };
}

/** Builds the drivable road graph and the ground polygons from the OSM download. */
export function buildRoadGraph(boxName: string, rect: LocalRect, dem: LocalDem): RoadGraph {
  const osm = JSON.parse(readFileSync(rawPath(`${boxName}/osm.json`), 'utf8')) as OsmData;
  const nodesById = new Map<number, OsmNode>();
  const waysById = new Map<number, OsmWay>();
  const relations: OsmRelation[] = [];
  for (const e of osm.elements) {
    if (e.type === 'node') nodesById.set(e.id, e);
    else if (e.type === 'way') waysById.set(e.id, e);
    else relations.push(e);
  }
  const local = new Map<number, Pt>();
  const pt = (id: number): Pt | null => {
    const cached = local.get(id);
    if (cached) return cached;
    const n = nodesById.get(id);
    if (!n) return null;
    const p = lonLatToLocal(n.lon, n.lat);
    local.set(id, p);
    return p;
  };
  const report: string[] = [];

  // Drivable ways and the nodes where they meet.
  const drivableWays: OsmWay[] = [];
  const useCount = new Map<number, number>();
  for (const w of waysById.values()) {
    const t = w.tags ?? {};
    const cls = DRIVABLE[t.highway ?? ''];
    if (!cls) continue;
    if (t.area === 'yes') continue;
    if (cls === 'service' && ['driveway', 'parking_aisle', 'emergency_access', 'drive-through'].includes(t.service ?? '')) continue;
    if (t.access === 'private' && cls === 'service') continue;
    drivableWays.push(w);
    for (const id of w.nodes) useCount.set(id, (useCount.get(id) ?? 0) + 1);
  }

  const nodes: RoadNode[] = [];
  const nodeIndex = new Map<number, number>();
  const nodeFor = (osmId: number, p: Pt): number => {
    const existing = nodeIndex.get(osmId);
    if (existing !== undefined) return existing;
    nodes.push({ x: p[0], z: p[1], y: 0, osmId, links: [] });
    nodeIndex.set(osmId, nodes.length - 1);
    return nodes.length - 1;
  };
  let syntheticId = -1;
  const links: RoadLink[] = [];

  for (const w of drivableWays) {
    const t = w.tags ?? {};
    const cls = DRIVABLE[t.highway];
    let oneway = t.oneway === 'yes' || t.oneway === '-1' || t.oneway === 'true' || t.oneway === '1' || t.junction === 'roundabout';
    const reversed = t.oneway === '-1';
    const lanesTag = t.lanes ? parseInt(t.lanes, 10) : null;
    const lanes = lanesTag && Number.isFinite(lanesTag) ? lanesTag : null;
    const cw = classWidth(cls, lanes, t.service, parkingSides(t, cls));
    // Width tags around here are often a lane or a sidewalk width (Beacon Street carries
    // both 6.5 and 28.7), so a tag only counts when it is near the lane-based estimate.
    const rawTagWidth = parseWidth(t.width);
    const tagWidth = rawTagWidth && rawTagWidth >= 0.6 * cw.width && rawTagWidth <= 1.6 * cw.width ? rawTagWidth : null;
    const bridge = t.bridge !== undefined && t.bridge !== 'no';
    const tunnel = (t.tunnel !== undefined && t.tunnel !== 'no') || t.covered === 'yes';
    const layer = t.layer ? parseInt(t.layer, 10) || 0 : 0;
    const name = t.name ?? (t.ref ? t.ref : '');
    const ids = reversed ? [...w.nodes].reverse() : w.nodes;
    if (t.oneway === 'alternating') oneway = false;

    // Split at junction nodes (shared by two or more drivable ways).
    let run: number[] = [];
    const flush = (): void => {
      if (run.length < 2) {
        run = [];
        return;
      }
      const ptsAll = run.map((id) => pt(id)).filter((p): p is Pt => p !== null);
      if (ptsAll.length < 2) {
        run = [];
        return;
      }
      const pieces = clipPolylineToRect(ptsAll, rect);
      for (const piece of pieces) {
        const startsAtNode = dist(piece[0], ptsAll[0]) < 1e-6;
        const endsAtNode = dist(piece[piece.length - 1], ptsAll[ptsAll.length - 1]) < 1e-6;
        const a = startsAtNode ? nodeFor(run[0], ptsAll[0]) : nodeFor(syntheticId--, piece[0]);
        const b = endsAtNode ? nodeFor(run[run.length - 1], ptsAll[ptsAll.length - 1]) : nodeFor(syntheticId--, piece[piece.length - 1]);
        const link: RoadLink = {
          id: links.length,
          osmWayId: w.id,
          a,
          b,
          name,
          cls,
          oneway,
          lanes: lanes ?? ROAD_CLASS[cls].lanes,
          width: tagWidth ?? cw.width,
          widthSource: tagWidth ? 'tag' : cw.source,
          bridge,
          tunnel,
          layer,
          maxSpeedMps: parseSpeed(t.maxspeed, cls),
          drivable: !tunnel,
          pts: piece,
          elev: new Float32Array(0),
        };
        links.push(link);
        nodes[a].links.push(link.id);
        nodes[b].links.push(link.id);
      }
      run = [];
    };
    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[i];
      run.push(id);
      const junction = (useCount.get(id) ?? 0) >= 2;
      if (junction && i > 0 && i < ids.length - 1) {
        flush();
        run = [id];
      }
    }
    flush();
  }

  // Non-drivable surfaces: paths for the ground mask.
  const paths: PathLine[] = [];
  for (const w of waysById.values()) {
    const t = w.tags ?? {};
    const kind = t.highway;
    if (!kind || !(kind in PATH_WIDTHS) || t.area === 'yes') continue;
    if (t.tunnel && t.tunnel !== 'no') continue;
    if (t.indoor === 'yes' || t.level) continue;
    const pts = w.nodes.map((id) => pt(id)).filter((p): p is Pt => p !== null);
    for (const piece of clipPolylineToRect(pts, rect)) {
      paths.push({ pts: piece, width: parseWidth(t.width) ?? PATH_WIDTHS[kind], kind: kind as PathLine['kind'] });
    }
  }

  // Polygons: closed ways and multipolygon relations.
  const polygons: Polygonal[] = [];
  const kindOf = (t: Record<string, string>): Polygonal['kind'] | null => {
    if (t.natural === 'water' || t.waterway === 'riverbank' || t.waterway === 'dock') return 'water';
    if (t.leisure && ['park', 'garden', 'pitch', 'playground', 'common'].includes(t.leisure)) return 'grass';
    if (t.landuse && ['grass', 'cemetery', 'recreation_ground', 'flowerbed'].includes(t.landuse)) return 'grass';
    if (t.landuse === 'railway') return 'rail';
    if (t.amenity === 'parking') return 'parking';
    if (t.place === 'square' || (t.highway === 'pedestrian' && t.area === 'yes') || t.man_made === 'pier') return 'paved';
    return null;
  };
  const memberWays = new Set<number>();
  for (const r of relations) {
    const t = r.tags ?? {};
    const kind = kindOf(t);
    if (!kind) continue;
    const outers: Pt[][] = [];
    const inners: Pt[][] = [];
    for (const role of ['outer', 'inner'] as const) {
      const ways = r.members.filter((m) => m.type === 'way' && m.role === role).map((m) => waysById.get(m.ref)).filter((w): w is OsmWay => !!w);
      for (const w of ways) memberWays.add(w.id);
      const rings = stitchRings(ways.map((w) => w.nodes.map((id) => pt(id)).filter((p): p is Pt => p !== null)));
      (role === 'outer' ? outers : inners).push(...rings);
    }
    for (const outer of outers) {
      polygons.push({ rings: [outer, ...inners.filter((inner) => inner.length > 2)], kind, name: t.name ?? '' });
    }
    if (outers.length === 0) report.push(`relation ${r.id} (${t.name ?? kind}) has no closed outer ring`);
  }
  for (const w of waysById.values()) {
    const t = w.tags ?? {};
    const kind = kindOf(t);
    if (!kind || memberWays.has(w.id)) continue;
    if (w.nodes[0] !== w.nodes[w.nodes.length - 1]) continue;
    const ring = w.nodes.slice(0, -1).map((id) => pt(id)).filter((p): p is Pt => p !== null);
    if (ring.length >= 3) polygons.push({ rings: [ring], kind, name: t.name ?? '' });
  }

  const railLines: Pt[][] = [];
  for (const w of waysById.values()) {
    const t = w.tags ?? {};
    if (!t.railway || !['rail', 'light_rail', 'tram'].includes(t.railway)) continue;
    if (t.tunnel && t.tunnel !== 'no') continue;
    const pts = w.nodes.map((id) => pt(id)).filter((p): p is Pt => p !== null);
    railLines.push(...clipPolylineToRect(pts, rect));
  }

  profileLinks(nodes, links, dem, report);
  markApproachDecks(nodes, links, report);

  const byClass = new Map<string, number>();
  for (const l of links) byClass.set(l.cls, (byClass.get(l.cls) ?? 0) + 1);
  report.unshift(
    `${drivableWays.length} drivable OSM ways -> ${links.length} links, ${nodes.length} nodes`,
    `links by class: ${[...byClass].map(([k, v]) => `${k} ${v}`).join(', ')}`,
    `bridges ${links.filter((l) => l.bridge).length}, tunnels ${links.filter((l) => l.tunnel).length}, one-way ${links.filter((l) => l.oneway).length}`,
    `width from tag ${links.filter((l) => l.widthSource === 'tag').length}, lanes ${links.filter((l) => l.widthSource === 'lanes').length}, class ${links.filter((l) => l.widthSource === 'class').length}`,
    `${paths.length} paths, ${polygons.length} polygons (${['water', 'grass', 'paved', 'parking', 'rail'].map((k) => `${k} ${polygons.filter((p) => p.kind === k).length}`).join(', ')}), ${railLines.length} rail lines`,
  );
  return { nodes, links, paths, polygons, railLines, report };
}

/** Joins way fragments sharing endpoints into closed rings (for multipolygon relations). */
export function stitchRings(fragments: Pt[][]): Pt[][] {
  const rings: Pt[][] = [];
  const pool = fragments.filter((f) => f.length >= 2).map((f) => f.slice());
  const same = (a: Pt, b: Pt) => dist(a, b) < 0.05;
  while (pool.length) {
    const ring = pool.pop() as Pt[];
    let closed = same(ring[0], ring[ring.length - 1]);
    let progress = true;
    while (!closed && progress) {
      progress = false;
      const end = ring[ring.length - 1];
      for (let i = 0; i < pool.length; i += 1) {
        const f = pool[i];
        if (same(f[0], end)) {
          ring.push(...f.slice(1));
        } else if (same(f[f.length - 1], end)) {
          ring.push(...f.slice(0, -1).reverse());
        } else continue;
        pool.splice(i, 1);
        progress = true;
        closed = same(ring[0], ring[ring.length - 1]);
        break;
      }
    }
    if (closed && ring.length > 3) rings.push(ring.slice(0, -1));
  }
  return rings;
}

/**
 * Elevation along every link: the smoothed DEM for ground links, a harmonic
 * interpolation between ground connections for bridge runs, so decks never
 * dip to the river or the trench the DEM shows beneath them.
 */
function profileLinks(nodes: RoadNode[], links: RoadLink[], dem: LocalDem, report: string[]): void {
  const STEP = 2;
  const WINDOW = 12;
  const demAt = (x: number, z: number) => sampleBilinear(dem.spec, dem.heights, x, z);
  const raw = new Map<number, { s: number[]; h: number[] }>();
  for (const l of links) {
    const samples = samplePolyline(l.pts, STEP);
    if (samples.length === 0) {
      l.elev = new Float32Array(l.pts.map(() => demAt(l.pts[0][0], l.pts[0][1])));
      continue;
    }
    const s = samples.map((p) => p.s);
    const h = samples.map((p) => demAt(p.x, p.z));
    // moving average over the window, in metres along the link
    const sm = h.map((_, i) => {
      let sum = 0;
      let n = 0;
      for (let k = 0; k < h.length; k += 1) {
        if (Math.abs(s[k] - s[i]) <= WINDOW) {
          sum += h[k];
          n += 1;
        }
      }
      return sum / n;
    });
    raw.set(l.id, { s, h: sm });
  }
  // Node elevation: average of the connected ground links' profile ends.
  const nodeGround = new Float64Array(nodes.length);
  const nodeHasGround = new Uint8Array(nodes.length);
  for (let idx = 0; idx < nodes.length; idx += 1) {
    const n = nodes[idx];
    let sum = 0;
    let count = 0;
    for (const lid of n.links) {
      const l = links[lid];
      if (l.bridge || l.tunnel) continue;
      const prof = raw.get(lid);
      if (!prof) continue;
      const atStart = l.a === idx;
      sum += atStart ? prof.h[0] : prof.h[prof.h.length - 1];
      count += 1;
    }
    if (count > 0) {
      nodeGround[idx] = sum / count;
      nodeHasGround[idx] = 1;
    } else {
      nodeGround[idx] = demAt(n.x, n.z);
    }
  }
  // A ground link that ends at a bridge samples the DEM on the abutment slope or in
  // the cut the bridge crosses, which can only pull its end down; a deck never sits
  // below the road leading onto it, so such a node takes the higher of its own
  // estimate and its ground-only neighbours along short links.
  const touchesBridge = (i: number): boolean => nodes[i].links.some((lid) => links[lid].bridge);
  for (let i = 0; i < nodes.length; i += 1) {
    if (!nodeHasGround[i] || !touchesBridge(i)) continue;
    let e = nodeGround[i];
    for (const lid of nodes[i].links) {
      const l = links[lid];
      if (l.bridge || l.tunnel) continue;
      const other = l.a === i ? l.b : l.a;
      if (other === i || !nodeHasGround[other] || touchesBridge(other)) continue;
      if (polylineLen(l.pts) <= 30) e = Math.max(e, nodeGround[other]);
    }
    nodeGround[i] = e;
  }
  // Harmonic interpolation for nodes only touched by bridges.
  const bridgeNodes = nodes.map((_, i) => i).filter((i) => !nodeHasGround[i] && nodes[i].links.some((lid) => links[lid].bridge));
  const nodeElev = Float64Array.from(nodeGround);
  for (let iter = 0; iter < 400; iter += 1) {
    let maxDelta = 0;
    for (const i of bridgeNodes) {
      let sum = 0;
      let wsum = 0;
      for (const lid of nodes[i].links) {
        const l = links[lid];
        if (l.tunnel) continue;
        const other = l.a === i ? l.b : l.a;
        const len = Math.max(1, polylineLen(l.pts));
        sum += nodeElev[other] / len;
        wsum += 1 / len;
      }
      if (wsum === 0) continue;
      const v = sum / wsum;
      maxDelta = Math.max(maxDelta, Math.abs(v - nodeElev[i]));
      nodeElev[i] = v;
    }
    if (maxDelta < 1e-4) break;
  }
  let floatingBridges = 0;
  for (const i of bridgeNodes) {
    const connectedToGround = nodes[i].links.some((lid) => {
      const l = links[lid];
      const other = l.a === i ? l.b : l.a;
      return nodeHasGround[other];
    });
    if (!connectedToGround) floatingBridges += 1;
  }
  if (floatingBridges) report.push(`${floatingBridges} bridge nodes have no ground connection in the box (profile falls back to the DEM)`);

  for (const l of links) {
    const prof = raw.get(l.id);
    const ya = nodeElev[l.a];
    const yb = nodeElev[l.b];
    const total = polylineLen(l.pts);
    const elev = new Float32Array(l.pts.length);
    let s = 0;
    for (let i = 0; i < l.pts.length; i += 1) {
      if (i > 0) s += dist(l.pts[i - 1], l.pts[i]);
      const t = total > 0 ? s / total : 0;
      // Short ground links onto a bridge run straight between their nodes: the DEM
      // under them is the abutment slope or the cut, not the road.
      const approach = total <= 40 && (touchesBridge(l.a) || touchesBridge(l.b));
      if (l.bridge || !prof || approach) {
        elev[i] = ya + (yb - ya) * t;
      } else {
        // smoothed DEM, blended into the node elevations over the last 10 m so links meet exactly
        const h = interpProfile(prof, s);
        const wa = Math.max(0, 1 - s / 10);
        const wb = Math.max(0, 1 - (total - s) / 10);
        elev[i] = h * (1 - wa - wb + wa * wb) + ya * wa * (1 - wb) + yb * wb * (1 - wa) + ((ya + yb) / 2) * wa * wb;
      }
    }
    l.elev = elev;
  }
  for (let i = 0; i < nodes.length; i += 1) nodes[i].y = nodeElev[i];
}

function polylineLen(pts: Pt[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i += 1) s += dist(pts[i - 1], pts[i]);
  return s;
}

function interpProfile(prof: { s: number[]; h: number[] }, s: number): number {
  const { s: ss, h } = prof;
  if (s <= ss[0]) return h[0];
  if (s >= ss[ss.length - 1]) return h[h.length - 1];
  let lo = 0;
  let hi = ss.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ss[mid] <= s) lo = mid;
    else hi = mid;
  }
  const t = (s - ss[lo]) / (ss[hi] - ss[lo] || 1);
  return h[lo] + (h[hi] - h[lo]) * t;
}

/** Elevation of a link at a distance along it, from its per-vertex profile. */
function elevAlong(l: RoadLink, at: number): number {
  let s = 0;
  for (let i = 0; i + 1 < l.pts.length; i += 1) {
    const seg = dist(l.pts[i], l.pts[i + 1]);
    if (at <= s + seg || i + 2 === l.pts.length) {
      const t = seg > 0 ? Math.max(0, Math.min(1, (at - s) / seg)) : 0;
      return l.elev[i] + (l.elev[i + 1] - l.elev[i]) * t;
    }
    s += seg;
  }
  return l.elev[0] ?? 0;
}

/**
 * OpenStreetMap often ends a bridge tag at the abutment while the cut below is
 * wider, so a short ground link next to a bridge may still hang over a lower
 * road. Such a link becomes a deck too: the terrain keeps the cut under it and
 * the car crosses on the slab.
 */
function markApproachDecks(nodes: RoadNode[], links: RoadLink[], report: string[]): void {
  const bridgeNode = nodes.map((n) => n.links.some((lid) => links[lid].bridge));
  let approaches = 0;
  for (const l of links) {
    if (l.bridge || l.tunnel || !l.drivable) continue;
    if (!(bridgeNode[l.a] || bridgeNode[l.b]) || polylineLen(l.pts) > 40) continue;
    const samples = samplePolyline(l.pts, 2);
    let over = false;
    for (const m of links) {
      if (over) break;
      if (m === l || !m.drivable || m.tunnel || m.a === l.a || m.a === l.b || m.b === l.a || m.b === l.b) continue;
      const reach = (l.width + m.width) / 2 + 2;
      for (const smp of samples) {
        if (over) break;
        for (let k = 0; k + 1 < m.pts.length; k += 1) {
          const pr = projectOnSegment([smp.x, smp.z], m.pts[k], m.pts[k + 1]);
          if (pr.d2 > reach * reach) continue;
          const em = m.elev[k] + (m.elev[k + 1] - m.elev[k]) * pr.t;
          if (elevAlong(l, smp.s) - em > 2.5) {
            over = true;
            break;
          }
        }
      }
    }
    if (over) {
      l.bridge = true;
      approaches += 1;
    }
  }
  if (approaches) report.push(`${approaches} ground links beside bridges cross over a lower road and become decks`);
}
