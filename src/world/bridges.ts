import * as THREE from 'three/webgpu';
import { mx_noise_float, positionWorld, vertexColor } from 'three/tsl';
import { ROAD_CLASS } from '../shared/roads.ts';
import type { RoadLink, WorldData } from './data.ts';
import type { StaticGeometry } from './curbs.ts';

const SIDEWALK = 1.8;
const DECK_DEPTH = 1.0;
const PARAPET_H = 1.0;
const PARAPET_T = 0.35;
const PIER_SPACING = 40;
const ROAD_COLOR: [number, number, number] = [0.13, 0.13, 0.14];
const WALK_COLOR: [number, number, number] = [0.55, 0.54, 0.52];
const CONCRETE: [number, number, number] = [0.6, 0.58, 0.55];

type Vec3 = [number, number, number];

function pushQuad(g: StaticGeometry, a: Vec3, b: Vec3, c: Vec3, d: Vec3, normal: Vec3, color: Vec3): void {
  // a, b, c, d go around the quad; flip the order if the first triangle faces away from `normal`.
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const flip = nx * normal[0] + ny * normal[1] + nz * normal[2] < 0;
  const base = g.positions.length / 3;
  for (const p of [a, b, c, d]) {
    g.positions.push(p[0], p[1], p[2]);
    g.normals.push(normal[0], normal[1], normal[2]);
    g.colors!.push(color[0], color[1], color[2]);
  }
  if (flip) g.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  else g.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function deckHalfWidth(link: RoadLink): number {
  const cap = ROAD_CLASS[link.cls].width * 1.6;
  return Math.min(link.width, cap) / 2 + SIDEWALK;
}

/**
 * Bridge decks for every drivable bridge link: a slab following the link's
 * elevation profile with sidewalk strips, parapets along both edges and piers
 * under long spans. The terrain keeps the real cut or water underneath, so
 * underpasses stay drivable. Geometry is returned per chunk for the mesh and
 * the static collider.
 */
export function buildBridgeGeometry(world: WorldData): Map<number, StaticGeometry> {
  const chunks = new Map<number, StaticGeometry>();
  const chunkKey = (x: number, z: number): number => {
    const cx = Math.max(0, Math.min(world.chunksX - 1, Math.floor((x - world.rect.minX) / world.chunkM)));
    const cz = Math.max(0, Math.min(world.chunksZ - 1, Math.floor((z - world.rect.minZ) / world.chunkM)));
    return cz * world.chunksX + cx;
  };
  const get = (x: number, z: number): StaticGeometry => {
    const key = chunkKey(x, z);
    let g = chunks.get(key);
    if (!g) {
      g = { positions: [], normals: [], indices: [], colors: [] };
      chunks.set(key, g);
    }
    return g;
  };

  for (const link of world.links) {
    if (!link.bridge || !link.drivable) continue;
    const p = link.points;
    const n = p.length / 3;
    if (n < 2) continue;
    const half = deckHalfWidth(link);
    // Per-point lateral unit vectors (to the left of travel), averaged at interior points.
    const lat: [number, number][] = [];
    for (let i = 0; i < n; i += 1) {
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(n - 1, i + 1);
      const dx = p[i1 * 3] - p[i0 * 3];
      const dz = p[i1 * 3 + 2] - p[i0 * 3 + 2];
      const len = Math.hypot(dx, dz) || 1;
      lat.push([-dz / len, dx / len]);
    }
    const at = (i: number, s: number, dy: number): Vec3 => [p[i * 3] + lat[i][0] * s, p[i * 3 + 1] + dy, p[i * 3 + 2] + lat[i][1] * s];
    let along = 0;
    let nextPier = PIER_SPACING / 2;
    const total = (() => {
      let t = 0;
      for (let i = 0; i + 1 < n; i += 1) t += Math.hypot(p[i * 3 + 3] - p[i * 3], p[i * 3 + 5] - p[i * 3 + 2]);
      return t;
    })();
    for (let i = 0; i + 1 < n; i += 1) {
      const mx = (p[i * 3] + p[i * 3 + 3]) / 2;
      const mz = (p[i * 3 + 2] + p[i * 3 + 5]) / 2;
      const g = get(mx, mz);
      const top = 0.02;
      const stations = [-half, -half + SIDEWALK, half - SIDEWALK, half];
      const colors: Vec3[] = [WALK_COLOR, ROAD_COLOR, WALK_COLOR];
      for (let s = 0; s < 3; s += 1) {
        pushQuad(g, at(i, stations[s], top), at(i + 1, stations[s], top), at(i + 1, stations[s + 1], top), at(i, stations[s + 1], top), [0, 1, 0], colors[s]);
      }
      for (const side of [-1, 1]) {
        const outer = side * half;
        const inner = side * (half - PARAPET_T);
        const outward: Vec3 = [lat[i][0] * side, 0, lat[i][1] * side];
        const inward: Vec3 = [-outward[0], 0, -outward[2]];
        // Parapet: inner face, top, outer face.
        pushQuad(g, at(i, inner, top), at(i + 1, inner, top), at(i + 1, inner, top + PARAPET_H), at(i, inner, top + PARAPET_H), inward, CONCRETE);
        pushQuad(g, at(i, inner, top + PARAPET_H), at(i + 1, inner, top + PARAPET_H), at(i + 1, outer, top + PARAPET_H), at(i, outer, top + PARAPET_H), [0, 1, 0], CONCRETE);
        pushQuad(g, at(i, outer, top + PARAPET_H), at(i + 1, outer, top + PARAPET_H), at(i + 1, outer, -DECK_DEPTH), at(i, outer, -DECK_DEPTH), outward, CONCRETE);
      }
      // Underside, visible from the road below.
      pushQuad(g, at(i, -half, -DECK_DEPTH), at(i + 1, -half, -DECK_DEPTH), at(i + 1, half, -DECK_DEPTH), at(i, half, -DECK_DEPTH), [0, -1, 0], [0.42, 0.41, 0.4]);

      // Piers on long spans.
      const segLen = Math.hypot(p[i * 3 + 3] - p[i * 3], p[i * 3 + 5] - p[i * 3 + 2]);
      if (total >= 30) {
        while (nextPier < along + segLen && nextPier < total - 8) {
          const t = (nextPier - along) / segLen;
          const cx = p[i * 3] + (p[i * 3 + 3] - p[i * 3]) * t;
          const cy = p[i * 3 + 1] + (p[i * 3 + 4] - p[i * 3 + 1]) * t;
          const cz = p[i * 3 + 2] + (p[i * 3 + 5] - p[i * 3 + 2]) * t;
          const ground = Math.min(world.heightAt(cx, cz), world.waterLevel) - 1.0;
          const topY = cy - DECK_DEPTH;
          if (topY - ground > 0.5) {
            const hw = half - SIDEWALK - 0.5;
            const ht = 0.8;
            const lx = lat[i][0];
            const lz = lat[i][1];
            const fx = -lz;
            const fz = lx;
            const corner = (s: number, f: number, y: number): Vec3 => [cx + lx * s + fx * f, y, cz + lz * s + fz * f];
            const faces: [Vec3, Vec3, Vec3, Vec3, Vec3][] = [
              [corner(-hw, ht, ground), corner(hw, ht, ground), corner(hw, ht, topY), corner(-hw, ht, topY), [fx, 0, fz]],
              [corner(-hw, -ht, ground), corner(hw, -ht, ground), corner(hw, -ht, topY), corner(-hw, -ht, topY), [-fx, 0, -fz]],
              [corner(hw, -ht, ground), corner(hw, ht, ground), corner(hw, ht, topY), corner(hw, -ht, topY), [lx, 0, lz]],
              [corner(-hw, -ht, ground), corner(-hw, ht, ground), corner(-hw, ht, topY), corner(-hw, -ht, topY), [-lx, 0, -lz]],
            ];
            for (const [a, b, c, d, normal] of faces) pushQuad(g, a, b, c, d, normal, CONCRETE);
          }
          nextPier += PIER_SPACING;
        }
      }
      along += segLen;
    }
  }
  return chunks;
}

export function createBridgeMaterial(): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial();
  const grain = mx_noise_float(positionWorld.mul(1.7)).mul(0.5).add(0.5);
  material.colorNode = vertexColor().rgb.mul(grain.mul(0.25).add(0.88));
  material.roughness = 0.9;
  material.metalness = 0;
  return material;
}
