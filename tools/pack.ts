import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { lonLatToLocal } from './lib/frame.ts';
import { projectOnSegment, type Pt } from './lib/geom.ts';
import { writeContainer, type TypedArray } from '../src/shared/container.ts';
import { FRAME, type LonLatBox, type LocalRect } from '../src/shared/frame.ts';
import { LINK_FLAG, ROAD_CLASS } from '../src/shared/roads.ts';
import type { RoadGraph } from './roads.ts';
import type { GroundResult } from './groundmask.ts';
import type { BuildingsResult } from './buildings.ts';
import type { ImageryResult } from './imagery.ts';

export interface Spawn {
  name: string;
  x: number;
  y: number;
  z: number;
  headingDeg: number;
  street: string;
}

export interface PackResult {
  gz: Uint8Array;
  rawBytes: number;
  spawns: Spawn[];
  report: string[];
}

interface SpawnSpec {
  name: string;
  heading: number;
  street?: string;
  cross?: string;
  lat?: number;
  lon?: number;
}

const headingVector = (deg: number): [number, number] => [Math.sin((deg * Math.PI) / 180), -Math.cos((deg * Math.PI) / 180)];
const headingOf = (dx: number, dz: number): number => ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;

/**
 * Resolves the authored spawn list. A spawn named by two streets starts 20 m
 * down the first street from the junction, in the lawful direction closest to
 * the requested heading; a spawn given as lon/lat snaps to the nearest street.
 */
export function resolveSpawns(graph: RoadGraph, report: string[]): Spawn[] {
  const list = JSON.parse(readFileSync('tools/spawns.json', 'utf8')) as SpawnSpec[];
  const spawns: Spawn[] = [];
  const OFFSET = 20;
  for (const s of list) {
    const [wx, wz] = headingVector(s.heading);
    if (s.street && s.cross) {
      let best: { score: number; link: RoadLinkLike; fromA: boolean } | null = null;
      for (let nodeIdx = 0; nodeIdx < graph.nodes.length; nodeIdx += 1) {
        const node = graph.nodes[nodeIdx];
        const names = new Set(node.links.map((lid) => graph.links[lid].name));
        if (!names.has(s.street as string) || !names.has(s.cross as string)) continue;
        for (const lid of node.links) {
          const l = graph.links[lid];
          if (l.name !== s.street || !l.drivable) continue;
          const fromA = l.a === nodeIdx;
          if (l.oneway && !fromA) continue; // leaving the junction against the flow
          const p0 = fromA ? l.pts[0] : l.pts[l.pts.length - 1];
          const p1 = fromA ? l.pts[1] : l.pts[l.pts.length - 2];
          const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
          const score = ((p1[0] - p0[0]) / len) * wx + ((p1[1] - p0[1]) / len) * wz;
          if (!best || score > best.score) best = { score, link: l, fromA };
        }
      }
      if (!best) {
        report.push(`spawn "${s.name}": no junction of ${s.street} and ${s.cross} with a lawful exit; dropped`);
        continue;
      }
      const { link: l, fromA } = best;
      const pts = fromA ? l.pts : [...l.pts].reverse();
      const elev = fromA ? Array.from(l.elev) : Array.from(l.elev).reverse();
      let remaining = Math.min(OFFSET, polylineLengthOf(pts) * 0.5);
      let i = 0;
      while (i < pts.length - 2 && remaining > Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])) {
        remaining -= Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
        i += 1;
      }
      const segLen = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) || 1;
      const t = Math.min(1, remaining / segLen);
      const dx = (pts[i + 1][0] - pts[i][0]) / segLen;
      const dz = (pts[i + 1][1] - pts[i][1]) / segLen;
      const px = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t;
      const pz = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t;
      const py = elev[i] + (elev[i + 1] - elev[i]) * t;
      const headingDeg = headingOf(dx, dz);
      spawns.push({ name: s.name, x: px, y: py + 0.6, z: pz, headingDeg, street: l.name });
      report.push(`spawn "${s.name}" -> ${l.name} from ${s.cross} (${l.oneway ? 'one-way' : 'two-way'}), heading ${headingDeg.toFixed(0)}`);
      continue;
    }
    if (s.lat === undefined || s.lon === undefined) continue;
    const [x, z] = lonLatToLocal(s.lon, s.lat);
    let bestSnap: { d2: number; link: RoadLinkLike; seg: number; t: number } | null = null;
    for (const l of graph.links) {
      if (!l.drivable || l.cls === 'service') continue;
      for (let i = 0; i < l.pts.length - 1; i += 1) {
        const pr = projectOnSegment([x, z], l.pts[i], l.pts[i + 1]);
        if (!bestSnap || pr.d2 < bestSnap.d2) bestSnap = { d2: pr.d2, link: l, seg: i, t: pr.t };
      }
    }
    if (!bestSnap || bestSnap.d2 > 40 * 40) {
      report.push(`spawn "${s.name}" has no drivable road within 40 m; dropped`);
      continue;
    }
    const l = bestSnap.link;
    const a = l.pts[bestSnap.seg];
    const b = l.pts[bestSnap.seg + 1];
    const px = a[0] + (b[0] - a[0]) * bestSnap.t;
    const pz = a[1] + (b[1] - a[1]) * bestSnap.t;
    const py = l.elev[bestSnap.seg] + (l.elev[bestSnap.seg + 1] - l.elev[bestSnap.seg]) * bestSnap.t;
    let dx = b[0] - a[0];
    let dz = b[1] - a[1];
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    if (!l.oneway && dx * wx + dz * wz < 0) {
      dx = -dx;
      dz = -dz;
    }
    const headingDeg = headingOf(dx, dz);
    spawns.push({ name: s.name, x: px, y: py + 0.6, z: pz, headingDeg, street: l.name });
    report.push(`spawn "${s.name}" -> ${l.name || l.cls} (${l.oneway ? 'one-way' : 'two-way'}), ${Math.sqrt(bestSnap.d2).toFixed(1)} m from the authored point, heading ${headingDeg.toFixed(0)}`);
  }
  return spawns;
}

type RoadLinkLike = RoadGraph['links'][number];

function polylineLengthOf(pts: Pt[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i += 1) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return s;
}

export function packWorld(
  box: LonLatBox,
  rect: LocalRect,
  chunkM: number,
  dem: { waterLevel: number },
  graph: RoadGraph,
  ground: GroundResult,
  buildings: BuildingsResult,
  imagery: ImageryResult,
  spawns: Spawn[],
  imageryZoom: number,
): PackResult {
  const spec = ground.spec;
  // Terrain vertices every 2 m, averaging the four 1 m cells around each vertex.
  const VW = spec.width / 2 + 1;
  const VH = spec.height / 2 + 1;
  const heights = new Int16Array(VW * VH);
  for (let J = 0; J < VH; J += 1) {
    for (let I = 0; I < VW; I += 1) {
      let sum = 0;
      let n = 0;
      for (let dj = -1; dj <= 0; dj += 1) for (let di = -1; di <= 0; di += 1) {
        const i = 2 * I + di;
        const j = 2 * J + dj;
        if (i < 0 || j < 0 || i >= spec.width || j >= spec.height) continue;
        sum += ground.burned[j * spec.width + i];
        n += 1;
      }
      heights[J * VW + I] = Math.round((sum / n) * 100);
    }
  }

  // Road graph.
  const names: string[] = [''];
  const nameIndex = new Map<string, number>([['', 0]]);
  const nameId = (s: string): number => {
    let id = nameIndex.get(s);
    if (id === undefined) {
      id = names.length;
      names.push(s);
      nameIndex.set(s, id);
    }
    return id;
  };
  const links = graph.links;
  const nodeXYZ = new Float32Array(graph.nodes.length * 3);
  graph.nodes.forEach((n, i) => nodeXYZ.set([n.x, n.y, n.z], i * 3));
  const linkNodes = new Uint32Array(links.length * 2);
  const linkPointStart = new Uint32Array(links.length + 1);
  const linkClass = new Uint8Array(links.length);
  const linkFlags = new Uint8Array(links.length);
  const linkWidth = new Float32Array(links.length);
  const linkLanes = new Uint8Array(links.length);
  const linkName = new Uint16Array(links.length);
  const linkSpeed = new Float32Array(links.length);
  let totalPts = 0;
  links.forEach((l, i) => {
    linkPointStart[i] = totalPts;
    totalPts += l.pts.length;
    linkNodes[i * 2] = l.a;
    linkNodes[i * 2 + 1] = l.b;
    linkClass[i] = ROAD_CLASS[l.cls].id;
    linkFlags[i] = (l.oneway ? LINK_FLAG.oneway : 0) | (l.bridge ? LINK_FLAG.bridge : 0) | (l.tunnel ? LINK_FLAG.tunnel : 0) | (l.drivable ? LINK_FLAG.drivable : 0);
    linkWidth[i] = l.width;
    linkLanes[i] = Math.min(255, l.lanes);
    linkName[i] = nameId(l.name);
    linkSpeed[i] = l.maxSpeedMps;
  });
  linkPointStart[links.length] = totalPts;
  const linkPoints = new Float32Array(totalPts * 3);
  let k = 0;
  for (const l of links) {
    for (let i = 0; i < l.pts.length; i += 1) {
      linkPoints[k++] = l.pts[i][0];
      linkPoints[k++] = l.elev[i];
      linkPoints[k++] = l.pts[i][1];
    }
  }

  // Curbs.
  const curbStart = new Uint32Array(ground.curbs.length + 1);
  let curbTotal = 0;
  ground.curbs.forEach((c, i) => {
    curbStart[i] = curbTotal;
    curbTotal += c.pts.length;
  });
  curbStart[ground.curbs.length] = curbTotal;
  const curbPoints = new Float32Array(curbTotal * 3);
  k = 0;
  for (const c of ground.curbs) {
    for (let i = 0; i < c.pts.length; i += 1) {
      curbPoints[k++] = c.pts[i][0];
      curbPoints[k++] = c.elev[i];
      curbPoints[k++] = c.pts[i][1];
    }
  }

  // Buildings.
  const parts = buildings.parts;
  const partRingStart = new Uint32Array(parts.length + 1);
  let ringCount = 0;
  let ringPts = 0;
  for (const p of parts) {
    ringCount += p.rings.length;
    for (const r of p.rings) ringPts += r.length;
  }
  const ringStart = new Uint32Array(ringCount + 1);
  const ringXZ = new Float32Array(ringPts * 2);
  const partBase = new Float32Array(parts.length);
  const partRoof = new Float32Array(parts.length);
  const partStyle = new Uint8Array(parts.length);
  const partSeed = new Uint16Array(parts.length);
  let ri = 0;
  let pi = 0;
  parts.forEach((p, i) => {
    partRingStart[i] = ri;
    partBase[i] = p.base;
    partRoof[i] = p.roof;
    partStyle[i] = p.style;
    partSeed[i] = p.seed;
    for (const r of p.rings) {
      ringStart[ri] = pi;
      ri += 1;
      for (const q of r) {
        ringXZ[pi * 2] = q[0];
        ringXZ[pi * 2 + 1] = q[1];
        pi += 1;
      }
    }
  });
  partRingStart[parts.length] = ri;
  ringStart[ringCount] = pi;

  const arrays: Record<string, TypedArray> = {
    heights,
    mask: ground.mask,
    nodeXYZ,
    linkNodes,
    linkPointStart,
    linkPoints,
    linkClass,
    linkFlags,
    linkWidth,
    linkLanes,
    linkName,
    linkSpeed,
    curbStart,
    curbPoints,
    partRingStart,
    ringStart,
    ringXZ,
    partBase,
    partRoof,
    partStyle,
    partSeed,
  };
  const raw = writeContainer(
    {
      format: 'driveboston-world',
      version: 1,
      created: new Date().toISOString().slice(0, 10),
      box: { name: box.name, south: box.south, north: box.north, west: box.west, east: box.east },
      frame: FRAME,
      rect,
      chunkM,
      chunks: { x: (rect.maxX - rect.minX) / chunkM, z: (rect.maxZ - rect.minZ) / chunkM },
      terrain: { cellM: 2, vertsX: VW, vertsZ: VH, heightUnit: 'cm' },
      maskGrid: { cellM: 1, width: spec.width, height: spec.height },
      waterLevel: dem.waterLevel,
      datumShift: buildings.datumShift,
      names,
      spawns,
      imagery: { dir: 'img', pixelsPerChunk: imagery.pixelsPerChunk, zoom: imageryZoom, format: 'webp' },
      counts: { nodes: graph.nodes.length, links: links.length, curbs: ground.curbs.length, parts: parts.length },
    },
    arrays,
  );
  const gz = gzipSync(raw, { level: 9 });
  const sizes = Object.entries(arrays).map(([n, a]) => `${n} ${(a.byteLength / 1024).toFixed(0)} kB`).join(', ');
  return {
    gz,
    rawBytes: raw.length,
    spawns,
    report: [`world file ${(raw.length / 1e6).toFixed(2)} MB raw, ${(gz.length / 1e6).toFixed(2)} MB gzipped`, `arrays: ${sizes}`],
  };
}

export function ringsForMask(parts: { rings: Pt[][] }[]): Pt[][][] {
  return parts.map((p) => p.rings);
}
