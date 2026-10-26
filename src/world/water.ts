import * as THREE from 'three/webgpu';
import { float, mx_noise_float, positionWorld, time, vec3 } from 'three/tsl';
import { GROUND } from '../shared/roads.ts';
import type { WorldData } from './data.ts';

/**
 * The Charles and the lagoon: flat quads at the surveyed water level covering
 * the water cells of the ground mask (dilated by one cell to hide the shore
 * seam), with a slowly moving ripple pattern. Built as run-length quads per
 * 2 m row so the whole river is a few thousand triangles.
 */
export function createWater(world: WorldData): THREE.Mesh {
  const { width, height, data, cellM } = world.mask;
  const step = 2;
  const isWater = (i: number, j: number): boolean => {
    if (i < 0 || j < 0 || i >= width || j >= height) return false;
    return data[j * width + i] === GROUND.water;
  };
  const wet = (i: number, j: number): boolean => {
    for (let dj = -1; dj <= step; dj += 1) for (let di = -1; di <= step; di += 1) if (isWater(i + di, j + dj)) return true;
    return false;
  };
  const positions: number[] = [];
  const indices: number[] = [];
  const x0 = world.rect.minX;
  const z0 = world.rect.minZ;
  for (let j = 0; j < height; j += step) {
    let runStart = -1;
    for (let i = 0; i <= width; i += step) {
      const w = i < width && wet(i, j);
      if (w && runStart < 0) runStart = i;
      if (!w && runStart >= 0) {
        const ax = x0 + runStart * cellM;
        const bx = x0 + Math.min(i, width) * cellM;
        const az = z0 + j * cellM;
        const bz = z0 + Math.min(j + step, height) * cellM;
        const v = positions.length / 3;
        positions.push(ax, 0, az, bx, 0, az, bx, 0, bz, ax, 0, bz);
        indices.push(v, v + 2, v + 1, v, v + 3, v + 2);
        runStart = -1;
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.Uint32BufferAttribute(indices, 1));
  const normals = new Float32Array(positions.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const material = new THREE.MeshStandardNodeMaterial();
  const p = positionWorld.xz;
  const t = time.mul(0.08);
  const ripple = mx_noise_float(vec3(p.mul(0.35), t)).mul(0.5).add(0.5);
  const ripple2 = mx_noise_float(vec3(p.mul(1.7), t.mul(1.7))).mul(0.5).add(0.5);
  material.colorNode = vec3(0.05, 0.11, 0.12).mul(ripple.mul(0.5).add(0.75));
  material.roughnessNode = float(0.12).add(ripple2.mul(0.1));
  material.metalness = 0.1;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = world.waterLevel;
  mesh.receiveShadow = true;
  mesh.name = 'water';
  return mesh;
}
