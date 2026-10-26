import * as THREE from 'three/webgpu';
import { GROUND } from '../shared/roads.ts';
import type { WorldData } from './data.ts';

/** Per-chunk textures: the aerial imagery and the 1 m ground-class mask. */
export interface ChunkTextures {
  imagery: THREE.Texture;
  mask: THREE.DataTexture;
}

/**
 * UV convention shared by every ground texture: u runs east across the chunk,
 * v runs from 1 at the chunk's north edge to 0 at its south edge, matching an
 * image whose first row is north. The mask rows are flipped to agree.
 */
export function chunkUv(world: WorldData, cx: number, cz: number, x: number, z: number): [number, number] {
  const minX = world.rect.minX + cx * world.chunkM;
  const minZ = world.rect.minZ + cz * world.chunkM;
  return [(x - minX) / world.chunkM, 1 - (z - minZ) / world.chunkM];
}

/**
 * The ground classes as four weights (road, sidewalk, grass, water) in an RGBA
 * texture. Linear filtering then blends across class edges over half a metre,
 * where a single class id would stair-step.
 */
export function buildMaskTexture(world: WorldData, cx: number, cz: number): THREE.DataTexture {
  const cells = Math.round(world.chunkM / world.mask.cellM);
  const data = new Uint8Array(cells * cells * 4);
  const x0 = cx * cells;
  const z0 = cz * cells;
  const { width, height, data: mask } = world.mask;
  for (let r = 0; r < cells; r += 1) {
    const j = Math.min(height - 1, z0 + (cells - 1 - r));
    const rowStart = j * width;
    for (let c = 0; c < cells; c += 1) {
      const i = Math.min(width - 1, x0 + c);
      const k = mask[rowStart + i];
      const o = (r * cells + c) * 4;
      data[o] = k === GROUND.road || k === GROUND.parking ? 255 : 0;
      data[o + 1] = k === GROUND.sidewalk || k === GROUND.paved ? 255 : 0;
      data[o + 2] = k === GROUND.grass ? 255 : 0;
      data[o + 3] = k === GROUND.water ? 255 : 0;
    }
  }
  const tex = new THREE.DataTexture(data, cells, cells, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

export async function loadChunkTextures(
  world: WorldData,
  baseUrl: string,
  maxAnisotropy: number,
  onProgress?: (fraction: number) => void,
): Promise<ChunkTextures[]> {
  const loader = new THREE.TextureLoader();
  const total = world.chunksX * world.chunksZ;
  let done = 0;
  const jobs: Promise<ChunkTextures>[] = [];
  for (let cz = 0; cz < world.chunksZ; cz += 1) {
    for (let cx = 0; cx < world.chunksX; cx += 1) {
      const url = `${baseUrl}${world.imagery.dir}/${cx}_${cz}.${world.imagery.format}`;
      jobs.push(
        loader.loadAsync(url).then((imagery) => {
          imagery.colorSpace = THREE.SRGBColorSpace;
          imagery.anisotropy = Math.min(8, maxAnisotropy);
          imagery.wrapS = THREE.ClampToEdgeWrapping;
          imagery.wrapT = THREE.ClampToEdgeWrapping;
          imagery.minFilter = THREE.LinearMipmapLinearFilter;
          imagery.generateMipmaps = true;
          done += 1;
          onProgress?.(done / total);
          return { imagery, mask: buildMaskTexture(world, cx, cz) };
        }),
      );
    }
  }
  return Promise.all(jobs);
}
