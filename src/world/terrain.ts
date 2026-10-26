import * as THREE from 'three/webgpu';
import type { WorldData } from './data.ts';
import type { ChunkTextures } from './imagery.ts';
import { createGroundMaterial } from './ground-material.ts';
import { chunkHeightfield } from '../physics/physics.ts';

export interface TerrainChunk {
  cx: number;
  cz: number;
  minX: number;
  minZ: number;
  mesh: THREE.Mesh;
  /** Heightfield samples for Rapier, see `chunkHeightfield`. */
  samples: Float32Array;
  cells: number;
}

/**
 * One mesh per 256 m chunk from the shared 2 m vertex grid. Chunks share edge
 * vertices so there are no cracks, and normals come from the global grid so
 * lighting is continuous across chunk borders.
 */
export function buildTerrainChunk(world: WorldData, cx: number, cz: number, textures: ChunkTextures): TerrainChunk {
  const { vertsX, vertsZ, cellM, heights } = world.terrain;
  const cells = Math.round(world.chunkM / cellM);
  const n = cells + 1;
  const firstI = cx * cells;
  const firstJ = cz * cells;
  const minX = world.rect.minX + cx * world.chunkM;
  const minZ = world.rect.minZ + cz * world.chunkM;

  const positions = new Float32Array(n * n * 3);
  const normals = new Float32Array(n * n * 3);
  const uvs = new Float32Array(n * n * 2);
  const h = (i: number, j: number): number => {
    const ii = Math.max(0, Math.min(vertsX - 1, i));
    const jj = Math.max(0, Math.min(vertsZ - 1, j));
    return heights[jj * vertsX + ii] / 100;
  };
  let v = 0;
  for (let row = 0; row < n; row += 1) {
    const j = firstJ + row;
    for (let col = 0; col < n; col += 1) {
      const i = firstI + col;
      positions[v * 3] = minX + col * cellM;
      positions[v * 3 + 1] = h(i, j);
      positions[v * 3 + 2] = minZ + row * cellM;
      // Central differences over the global grid.
      const dx = (h(i + 1, j) - h(i - 1, j)) / (2 * cellM);
      const dz = (h(i, j + 1) - h(i, j - 1)) / (2 * cellM);
      const len = Math.hypot(dx, 1, dz);
      normals[v * 3] = -dx / len;
      normals[v * 3 + 1] = 1 / len;
      normals[v * 3 + 2] = -dz / len;
      uvs[v * 2] = col / cells;
      uvs[v * 2 + 1] = 1 - row / cells;
      v += 1;
    }
  }
  const indices = new Uint32Array(cells * cells * 6);
  let k = 0;
  for (let row = 0; row < cells; row += 1) {
    for (let col = 0; col < cells; col += 1) {
      const a = row * n + col;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      // Counter-clockwise seen from above (+y).
      indices[k++] = a;
      indices[k++] = c;
      indices[k++] = b;
      indices[k++] = b;
      indices[k++] = c;
      indices[k++] = d;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry, createGroundMaterial(textures));
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.matrixAutoUpdate = false;
  mesh.name = `terrain ${cx},${cz}`;

  return { cx, cz, minX, minZ, mesh, samples: chunkHeightfield(heights, vertsX, firstI, firstJ, cells), cells };
}
