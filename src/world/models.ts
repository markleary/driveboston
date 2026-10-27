/**
 * Rebuilds the city's building meshes from the world file for the facade
 * shader. Triangles are grouped into planar clusters (edge neighbours whose
 * normals agree within five degrees). Each wall cluster gets metres-along and
 * metres-up texture coordinates from its own tangent and the model's ground
 * level; roof clusters are flagged so the shader colours them from the
 * imagery. Vertices are shared inside a cluster where the triangle lies in the
 * cluster's plane and split with their own normal where it does not, so curved
 * walls stay faceted instead of smeared.
 */
import type { WorldData } from './data.ts';

/** Typed-array form of the facade attributes, one per chunk. */
export interface ModelChunkGeometry {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  style: Float32Array;
  seed: Float32Array;
  roof: Float32Array;
  wallLen: Float32Array;
  height: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  indexCount: number;
  models: number;
}

export interface MeshSource {
  /** World positions, x y z per vertex. */
  xyz: ArrayLike<number>;
  /** Triangle vertex indices. */
  index: ArrayLike<number>;
  /** Ground level the facade's metres-up start from. */
  groundY: number;
  style: number;
  /** 0 to 1. */
  seed: number;
}

/** Faces whose normal has at least this much vertical component are roofs (or hidden bottoms). */
const ROOF_NY = 0.3;
const SAME_PLANE = Math.cos((5 * Math.PI) / 180);
const SHARE_NORMAL = Math.cos((2 * Math.PI) / 180);

/** Appends facade vertices into fixed-capacity typed arrays. */
export class GeometryWriter {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  style: Float32Array;
  seed: Float32Array;
  roof: Float32Array;
  wallLen: Float32Array;
  height: Float32Array;
  indices: Uint32Array;
  vertexCount = 0;
  indexCount = 0;
  models = 0;

  constructor(vertexCapacity: number, indexCapacity: number) {
    this.positions = new Float32Array(vertexCapacity * 3);
    this.normals = new Float32Array(vertexCapacity * 3);
    this.uvs = new Float32Array(vertexCapacity * 2);
    this.style = new Float32Array(vertexCapacity);
    this.seed = new Float32Array(vertexCapacity);
    this.roof = new Float32Array(vertexCapacity);
    this.wallLen = new Float32Array(vertexCapacity);
    this.height = new Float32Array(vertexCapacity);
    this.indices = new Uint32Array(indexCapacity);
  }

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, style: number, seed: number, roof: number, wallLen: number, height: number): number {
    const i = this.vertexCount;
    this.positions[i * 3] = x;
    this.positions[i * 3 + 1] = y;
    this.positions[i * 3 + 2] = z;
    this.normals[i * 3] = nx;
    this.normals[i * 3 + 1] = ny;
    this.normals[i * 3 + 2] = nz;
    this.uvs[i * 2] = u;
    this.uvs[i * 2 + 1] = v;
    this.style[i] = style;
    this.seed[i] = seed;
    this.roof[i] = roof;
    this.wallLen[i] = wallLen;
    this.height[i] = height;
    this.vertexCount += 1;
    return i;
  }

  triangle(a: number, b: number, c: number): void {
    this.indices[this.indexCount] = a;
    this.indices[this.indexCount + 1] = b;
    this.indices[this.indexCount + 2] = c;
    this.indexCount += 3;
  }

  /** Copies the used part of every array so the capacity headroom can be freed. */
  finish(): ModelChunkGeometry {
    const n = this.vertexCount;
    return {
      positions: this.positions.slice(0, n * 3),
      normals: this.normals.slice(0, n * 3),
      uvs: this.uvs.slice(0, n * 2),
      style: this.style.slice(0, n),
      seed: this.seed.slice(0, n),
      roof: this.roof.slice(0, n),
      wallLen: this.wallLen.slice(0, n),
      height: this.height.slice(0, n),
      indices: this.indices.slice(0, this.indexCount),
      vertexCount: n,
      indexCount: this.indexCount,
      models: this.models,
    };
  }
}

/** Clusters one mesh into planar faces and appends it with facade attributes. */
export function appendModel(w: GeometryWriter, m: MeshSource): void {
  const { xyz, index } = m;
  const triCount = Math.floor(index.length / 3);
  const vertexTotal = Math.floor(xyz.length / 3);
  // Unnormalised (area-weighted) and unit normals per triangle.
  const cross = new Float64Array(triCount * 3);
  const unit = new Float64Array(triCount * 3);
  const valid = new Uint8Array(triCount);
  for (let t = 0; t < triCount; t += 1) {
    const a = index[t * 3];
    const b = index[t * 3 + 1];
    const c = index[t * 3 + 2];
    if (a >= vertexTotal || b >= vertexTotal || c >= vertexTotal) continue;
    const ax = xyz[a * 3];
    const ay = xyz[a * 3 + 1];
    const az = xyz[a * 3 + 2];
    const e1x = xyz[b * 3] - ax;
    const e1y = xyz[b * 3 + 1] - ay;
    const e1z = xyz[b * 3 + 2] - az;
    const e2x = xyz[c * 3] - ax;
    const e2y = xyz[c * 3 + 1] - ay;
    const e2z = xyz[c * 3 + 2] - az;
    const cx = e1y * e2z - e1z * e2y;
    const cy = e1z * e2x - e1x * e2z;
    const cz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(cx, cy, cz);
    if (len < 1e-9) continue;
    cross[t * 3] = cx;
    cross[t * 3 + 1] = cy;
    cross[t * 3 + 2] = cz;
    unit[t * 3] = cx / len;
    unit[t * 3 + 1] = cy / len;
    unit[t * 3 + 2] = cz / len;
    valid[t] = 1;
  }

  // Union-find over triangles that share an edge and lie in the same plane.
  const parent = new Int32Array(triCount);
  for (let i = 0; i < triCount; i += 1) parent[i] = i;
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const edges = new Map<number, number>();
  for (let t = 0; t < triCount; t += 1) {
    if (!valid[t]) continue;
    for (let k = 0; k < 3; k += 1) {
      const i0 = index[t * 3 + k];
      const i1 = index[t * 3 + ((k + 1) % 3)];
      const key = i0 < i1 ? i0 * vertexTotal + i1 : i1 * vertexTotal + i0;
      const other = edges.get(key);
      if (other === undefined) edges.set(key, t);
      else if (unit[t * 3] * unit[other * 3] + unit[t * 3 + 1] * unit[other * 3 + 1] + unit[t * 3 + 2] * unit[other * 3 + 2] > SAME_PLANE) {
        const ra = find(t);
        const rb = find(other);
        if (ra !== rb) parent[rb] = ra;
      }
    }
  }
  const clusters = new Map<number, number[]>();
  for (let t = 0; t < triCount; t += 1) {
    if (!valid[t]) continue;
    const root = find(t);
    const list = clusters.get(root);
    if (list) list.push(t);
    else clusters.set(root, [t]);
  }

  const corner = [0, 0, 0];
  for (const tris of clusters.values()) {
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (const t of tris) {
      sx += cross[t * 3];
      sy += cross[t * 3 + 1];
      sz += cross[t * 3 + 2];
    }
    const sl = Math.hypot(sx, sy, sz) || 1;
    const cnx = sx / sl;
    const cny = sy / sl;
    const cnz = sz / sl;
    const roof = Math.abs(cny) > ROOF_NY;
    let tx = 0;
    let tz = 0;
    if (!roof) {
      const hl = Math.hypot(cnx, cnz) || 1;
      tx = cnz / hl;
      tz = -cnx / hl;
    }
    let umin = Infinity;
    let umax = -Infinity;
    let ymax = -Infinity;
    const members = new Set<number>();
    for (const t of tris) for (let k = 0; k < 3; k += 1) members.add(index[t * 3 + k]);
    for (const vi of members) {
      const x = xyz[vi * 3];
      const y = xyz[vi * 3 + 1];
      const z = xyz[vi * 3 + 2];
      if (!roof) {
        const u = x * tx + z * tz;
        umin = Math.min(umin, u);
        umax = Math.max(umax, u);
      }
      ymax = Math.max(ymax, y);
    }
    const wallLen = roof ? 1 : Math.max(0.5, umax - umin);
    const height = Math.max(0.5, ymax - m.groundY);
    const roofFlag = roof ? 1 : 0;
    const shared = new Map<number, number>();
    for (const t of tris) {
      const flat = unit[t * 3] * cnx + unit[t * 3 + 1] * cny + unit[t * 3 + 2] * cnz > SHARE_NORMAL;
      for (let k = 0; k < 3; k += 1) {
        const vi = index[t * 3 + k];
        let oi = flat ? shared.get(vi) : undefined;
        if (oi === undefined) {
          const x = xyz[vi * 3];
          const y = xyz[vi * 3 + 1];
          const z = xyz[vi * 3 + 2];
          const u = roof ? 0 : x * tx + z * tz - umin;
          const v = roof ? 0 : y - m.groundY;
          oi = flat
            ? w.vertex(x, y, z, cnx, cny, cnz, u, v, m.style, m.seed, roofFlag, wallLen, height)
            : w.vertex(x, y, z, unit[t * 3], unit[t * 3 + 1], unit[t * 3 + 2], u, v, m.style, m.seed, roofFlag, wallLen, height);
          if (flat) shared.set(vi, oi);
        }
        corner[k] = oi;
      }
      w.triangle(corner[0], corner[1], corner[2]);
    }
  }
  w.models += 1;
}

/** Decodes every packed model and groups the geometry by the chunk under its origin. */
export function buildModelGeometry(world: WorldData): Map<number, ModelChunkGeometry> {
  const md = world.models;
  const chunkKey = (x: number, z: number): number => {
    const cx = Math.max(0, Math.min(world.chunksX - 1, Math.floor((x - world.rect.minX) / world.chunkM)));
    const cz = Math.max(0, Math.min(world.chunksZ - 1, Math.floor((z - world.rect.minZ) / world.chunkM)));
    return cz * world.chunksX + cx;
  };
  // Capacity per chunk: at most three vertices per triangle.
  const indexPerChunk = new Map<number, number>();
  for (let i = 0; i < md.count; i += 1) {
    const key = chunkKey(md.origin[i * 3], md.origin[i * 3 + 2]);
    indexPerChunk.set(key, (indexPerChunk.get(key) ?? 0) + (md.indexStart[i + 1] - md.indexStart[i]));
  }
  const writers = new Map<number, GeometryWriter>();
  for (const [key, count] of indexPerChunk) writers.set(key, new GeometryWriter(count, count));

  for (let i = 0; i < md.count; i += 1) {
    const v0 = md.vertexStart[i];
    const v1 = md.vertexStart[i + 1];
    const n = v1 - v0;
    const ox = md.origin[i * 3];
    const oy = md.origin[i * 3 + 1];
    const oz = md.origin[i * 3 + 2];
    const xyz = new Float64Array(n * 3);
    for (let j = 0; j < n; j += 1) {
      xyz[j * 3] = ox + md.xyz[(v0 + j) * 3] * md.unit;
      xyz[j * 3 + 1] = oy + md.xyz[(v0 + j) * 3 + 1] * md.unit;
      xyz[j * 3 + 2] = oz + md.xyz[(v0 + j) * 3 + 2] * md.unit;
    }
    const index = md.index.subarray(md.indexStart[i], md.indexStart[i + 1]);
    const writer = writers.get(chunkKey(ox, oz)) as GeometryWriter;
    appendModel(writer, { xyz, index, groundY: oy, style: md.style[i], seed: md.seed[i] / 65535 });
  }
  const out = new Map<number, ModelChunkGeometry>();
  for (const [key, w] of writers) out.set(key, w.finish());
  return out;
}
