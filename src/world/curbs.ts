import * as THREE from 'three/webgpu';
import { mx_noise_float, positionWorld, vec3 } from 'three/tsl';
import { GROUND } from '../shared/roads.ts';
import type { WorldData } from './data.ts';

export const CURB_HEIGHT = 0.15;
const TOP_STRIP = 1.3;
const SIMPLIFY_TOLERANCE = 0.12;

export interface StaticGeometry {
  positions: number[];
  normals: number[];
  indices: number[];
  /** Optional per-vertex rgb. */
  colors?: number[];
}

/** Iterative Douglas-Peucker on x/z, keeping the y of the kept points. */
export function simplifyPolyline(pts: Float32Array, tolerance: number): number[] {
  const n = pts.length / 3;
  if (n <= 2) return Array.from({ length: n }, (_, i) => i);
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  const tol2 = tolerance * tolerance;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = pts[a * 3];
    const az = pts[a * 3 + 2];
    const bx = pts[b * 3];
    const bz = pts[b * 3 + 2];
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    let worst = -1;
    let worstD = tol2;
    for (let i = a + 1; i < b; i += 1) {
      const px = pts[i * 3] - ax;
      const pz = pts[i * 3 + 2] - az;
      let d2: number;
      if (len2 === 0) d2 = px * px + pz * pz;
      else {
        const t = Math.max(0, Math.min(1, (px * dx + pz * dz) / len2));
        const ex = px - t * dx;
        const ez = pz - t * dz;
        d2 = ex * ex + ez * ez;
      }
      if (d2 > worstD) {
        worstD = d2;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) if (keep[i]) out.push(i);
  return out;
}

const roadish = (c: number): boolean => c === GROUND.road || c === GROUND.parking || c === GROUND.lot;

/**
 * Granite curbs along every traced curb line: a vertical face toward the road
 * and a flat top strip over the sidewalk edge, so the 15 cm step reads up close
 * and gives the car something to bump over. Geometry is returned per chunk for
 * both the mesh and the static collider.
 */
export function buildCurbGeometry(world: WorldData): Map<number, StaticGeometry> {
  const chunks = new Map<number, StaticGeometry>();
  const chunkKey = (x: number, z: number): number => {
    const cx = Math.max(0, Math.min(world.chunksX - 1, Math.floor((x - world.rect.minX) / world.chunkM)));
    const cz = Math.max(0, Math.min(world.chunksZ - 1, Math.floor((z - world.rect.minZ) / world.chunkM)));
    return cz * world.chunksX + cx;
  };
  const get = (key: number): StaticGeometry => {
    let g = chunks.get(key);
    if (!g) {
      g = { positions: [], normals: [], indices: [] };
      chunks.set(key, g);
    }
    return g;
  };
  const { start, points } = world.curbs;
  for (let c = 0; c < start.length - 1; c += 1) {
    const pts = points.subarray(start[c] * 3, start[c + 1] * 3);
    const keep = simplifyPolyline(pts, SIMPLIFY_TOLERANCE);
    for (let s = 0; s < keep.length - 1; s += 1) {
      const i0 = keep[s] * 3;
      const i1 = keep[s + 1] * 3;
      const ax = pts[i0];
      const ay = pts[i0 + 1];
      const az = pts[i0 + 2];
      const bx = pts[i1];
      const by = pts[i1 + 1];
      const bz = pts[i1 + 2];
      const dx = bx - ax;
      const dz = bz - az;
      const len = Math.hypot(dx, dz);
      if (len < 0.05) continue;
      // Unit normal to the segment; decide which side is the road from the mask.
      let nx = dz / len;
      let nz = -dx / len;
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      const sideA = world.classAt(mx + nx * 0.9, mz + nz * 0.9);
      const sideB = world.classAt(mx - nx * 0.9, mz - nz * 0.9);
      if (!roadish(sideA) && roadish(sideB)) {
        nx = -nx;
        nz = -nz;
      } else if (roadish(sideA) === roadish(sideB)) {
        // Ambiguous (both or neither): look a little further out.
        const farA = world.classAt(mx + nx * 2, mz + nz * 2);
        const farB = world.classAt(mx - nx * 2, mz - nz * 2);
        if (!roadish(farA) && roadish(farB)) {
          nx = -nx;
          nz = -nz;
        }
      }
      const g = get(chunkKey(mx, mz));
      const base = g.positions.length / 3;
      const top = CURB_HEIGHT + 0.01;
      // Face: toward the road (normal n), from road level to the curb top.
      g.positions.push(ax, ay, az, bx, by, bz, bx, by + top, bz, ax, ay + top, az);
      for (let k = 0; k < 4; k += 1) g.normals.push(nx, 0, nz);
      // Counter-clockwise seen from the road side (the winding flips with n).
      if (nx * dz - nz * dx > 0) g.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
      else g.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      // Top strip: from the line back over the sidewalk.
      const sx = -nx * TOP_STRIP;
      const sz = -nz * TOP_STRIP;
      const t = base + 4;
      g.positions.push(ax, ay + top, az, bx, by + top, bz, bx + sx, by + top, bz + sz, ax + sx, ay + top, az + sz);
      for (let k = 0; k < 4; k += 1) g.normals.push(0, 1, 0);
      // Counter-clockwise seen from above: a, b, b+s is clockwise when n points to the road's side, so flip by test.
      const cross = (bx - ax) * sz - (bz - az) * sx;
      if (cross < 0) g.indices.push(t, t + 1, t + 2, t, t + 2, t + 3);
      else g.indices.push(t, t + 2, t + 1, t, t + 3, t + 2);
    }
  }
  return chunks;
}

export function createCurbMaterial(): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial();
  const grain = mx_noise_float(positionWorld.xz.mul(6)).mul(0.5).add(0.5);
  material.colorNode = vec3(0.47, 0.465, 0.45).mul(grain.mul(0.3).add(0.85));
  material.roughness = 0.75;
  material.metalness = 0;
  return material;
}

export function geometryFromStatic(g: StaticGeometry): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(g.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(g.normals, 3));
  if (g.colors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(g.colors, 3));
  geometry.setIndex(g.indices.length > 65535 ? new THREE.Uint32BufferAttribute(g.indices, 1) : new THREE.Uint16BufferAttribute(g.indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
