import { readContainer, type Container } from '../shared/container.ts';
import { LINK_FLAG, ROAD_CLASS_BY_ID, type RoadClassName } from '../shared/roads.ts';
import type { LocalRect, FrameDefinition } from '../shared/frame.ts';

export interface SpawnPoint {
  name: string;
  x: number;
  y: number;
  z: number;
  headingDeg: number;
  street: string;
}

export interface RoadLink {
  id: number;
  a: number;
  b: number;
  name: string;
  cls: RoadClassName;
  oneway: boolean;
  bridge: boolean;
  tunnel: boolean;
  drivable: boolean;
  width: number;
  lanes: number;
  speedMps: number;
  /** x y z triples. */
  points: Float32Array;
}

export interface WorldData {
  boxName: string;
  rect: LocalRect;
  chunkM: number;
  chunksX: number;
  chunksZ: number;
  terrain: { vertsX: number; vertsZ: number; cellM: number; heights: Int16Array };
  mask: { width: number; height: number; cellM: number; data: Uint8Array };
  nodes: Float32Array;
  links: RoadLink[];
  curbs: { start: Uint32Array; points: Float32Array };
  buildings: {
    partRingStart: Uint32Array;
    ringStart: Uint32Array;
    ringXZ: Float32Array;
    base: Float32Array;
    roof: Float32Array;
    style: Uint8Array;
    seed: Uint16Array;
    count: number;
  };
  spawns: SpawnPoint[];
  waterLevel: number;
  imagery: { dir: string; pixelsPerChunk: number; format: string };
  frame: FrameDefinition;
  /** Terrain height at a world position (bilinear over the 2 m vertex grid). */
  heightAt(x: number, z: number): number;
  /** Ground class at a world position. */
  classAt(x: number, z: number): number;
}

async function inflate(bytes: ArrayBuffer): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const out = await new Response(stream).arrayBuffer();
  return new Uint8Array(out);
}

export async function loadWorld(url: string, onProgress?: (fraction: number) => void): Promise<WorldData> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`world data: HTTP ${res.status} for ${url}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  let bytes: ArrayBuffer;
  if (res.body && total > 0 && onProgress) {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      onProgress(received / total);
    }
    const joined = new Uint8Array(received);
    let offset = 0;
    for (const c of chunks) {
      joined.set(c, offset);
      offset += c.length;
    }
    bytes = joined.buffer;
  } else {
    bytes = await res.arrayBuffer();
  }
  // Some hosts serve .gz files already decoded; only inflate when the gzip magic is present.
  const head = new Uint8Array(bytes, 0, 2);
  const raw = head[0] === 0x1f && head[1] === 0x8b ? await inflate(bytes) : new Uint8Array(bytes);
  return parseWorld(readContainer(raw));
}

export function parseWorld(c: Container): WorldData {
  const h = c.header;
  if (h.format !== 'driveboston-world' || h.version !== 1) throw new Error(`unsupported world file ${h.format} v${h.version}`);
  const a = c.arrays;
  const rect = h.rect as LocalRect;
  const terrainMeta = h.terrain as { vertsX: number; vertsZ: number; cellM: number };
  const maskMeta = h.maskGrid as { width: number; height: number; cellM: number };
  const names = h.names as string[];
  const heights = a.heights as Int16Array;
  const mask = a.mask as Uint8Array;

  const linkStart = a.linkPointStart as Uint32Array;
  const linkPoints = a.linkPoints as Float32Array;
  const linkNodes = a.linkNodes as Uint32Array;
  const linkClass = a.linkClass as Uint8Array;
  const linkFlags = a.linkFlags as Uint8Array;
  const linkWidth = a.linkWidth as Float32Array;
  const linkLanes = a.linkLanes as Uint8Array;
  const linkName = a.linkName as Uint16Array;
  const linkSpeed = a.linkSpeed as Float32Array;
  const links: RoadLink[] = [];
  for (let i = 0; i < linkStart.length - 1; i += 1) {
    const f = linkFlags[i];
    links.push({
      id: i,
      a: linkNodes[i * 2],
      b: linkNodes[i * 2 + 1],
      name: names[linkName[i]] ?? '',
      cls: ROAD_CLASS_BY_ID[linkClass[i]],
      oneway: (f & LINK_FLAG.oneway) !== 0,
      bridge: (f & LINK_FLAG.bridge) !== 0,
      tunnel: (f & LINK_FLAG.tunnel) !== 0,
      drivable: (f & LINK_FLAG.drivable) !== 0,
      width: linkWidth[i],
      lanes: linkLanes[i],
      speedMps: linkSpeed[i],
      points: linkPoints.subarray(linkStart[i] * 3, linkStart[i + 1] * 3),
    });
  }

  const vertsX = terrainMeta.vertsX;
  const vertsZ = terrainMeta.vertsZ;
  const cellM = terrainMeta.cellM;
  const heightAt = (x: number, z: number): number => {
    const fx = (x - rect.minX) / cellM;
    const fz = (z - rect.minZ) / cellM;
    const i0 = Math.max(0, Math.min(vertsX - 2, Math.floor(fx)));
    const j0 = Math.max(0, Math.min(vertsZ - 2, Math.floor(fz)));
    const tx = Math.max(0, Math.min(1, fx - i0));
    const tz = Math.max(0, Math.min(1, fz - j0));
    const h00 = heights[j0 * vertsX + i0];
    const h10 = heights[j0 * vertsX + i0 + 1];
    const h01 = heights[(j0 + 1) * vertsX + i0];
    const h11 = heights[(j0 + 1) * vertsX + i0 + 1];
    return ((h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz) / 100;
  };
  const classAt = (x: number, z: number): number => {
    const i = Math.floor((x - rect.minX) / maskMeta.cellM);
    const j = Math.floor((z - rect.minZ) / maskMeta.cellM);
    if (i < 0 || j < 0 || i >= maskMeta.width || j >= maskMeta.height) return 0;
    return mask[j * maskMeta.width + i];
  };

  const partRingStart = a.partRingStart as Uint32Array;
  return {
    boxName: (h.box as { name: string }).name,
    rect,
    chunkM: h.chunkM as number,
    chunksX: (h.chunks as { x: number }).x,
    chunksZ: (h.chunks as { z: number }).z,
    terrain: { vertsX, vertsZ, cellM, heights },
    mask: { width: maskMeta.width, height: maskMeta.height, cellM: maskMeta.cellM, data: mask },
    nodes: a.nodeXYZ as Float32Array,
    links,
    curbs: { start: a.curbStart as Uint32Array, points: a.curbPoints as Float32Array },
    buildings: {
      partRingStart,
      ringStart: a.ringStart as Uint32Array,
      ringXZ: a.ringXZ as Float32Array,
      base: a.partBase as Float32Array,
      roof: a.partRoof as Float32Array,
      style: a.partStyle as Uint8Array,
      seed: a.partSeed as Uint16Array,
      count: partRingStart.length - 1,
    },
    spawns: h.spawns as SpawnPoint[],
    waterLevel: h.waterLevel as number,
    imagery: h.imagery as { dir: string; pixelsPerChunk: number; format: string },
    frame: h.frame as FrameDefinition,
    heightAt,
    classAt,
  };
}
