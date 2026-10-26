import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import earcut from 'earcut';
import {
  attribute,
  cameraPosition,
  float,
  fract,
  hash,
  mix,
  mx_noise_float,
  positionWorld,
  select,
  smoothstep,
  step,
  texture,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import type { WorldData } from './data.ts';
import type { StaticGeometry } from './curbs.ts';
import type { ChunkTextures } from './imagery.ts';

export interface BuildingChunkGeometry extends StaticGeometry {
  uvs: number[];
  style: number[];
  seed: number[];
  roof: number[];
  wallLen: number[];
  height: number[];
  parts: number;
}

const MIN_HEIGHT = 0.6;

function emptyChunk(): BuildingChunkGeometry {
  return { positions: [], normals: [], indices: [], uvs: [], style: [], seed: [], roof: [], wallLen: [], height: [], parts: 0 };
}

/**
 * Extrudes every building part from its footprint rings: walls from the base to
 * the roof elevation with metres-along and metres-up texture coordinates for
 * the facade shader, and a flat roof triangulated with earcut. Geometry is
 * grouped by the chunk under the part's first vertex.
 */
export function buildBuildingGeometry(world: WorldData): Map<number, BuildingChunkGeometry> {
  const chunks = new Map<number, BuildingChunkGeometry>();
  const b = world.buildings;
  const chunkKey = (x: number, z: number): number => {
    const cx = Math.max(0, Math.min(world.chunksX - 1, Math.floor((x - world.rect.minX) / world.chunkM)));
    const cz = Math.max(0, Math.min(world.chunksZ - 1, Math.floor((z - world.rect.minZ) / world.chunkM)));
    return cz * world.chunksX + cx;
  };
  for (let p = 0; p < b.count; p += 1) {
    const base = b.base[p];
    const roof = b.roof[p];
    const height = roof - base;
    if (!(height >= MIN_HEIGHT)) continue;
    const style = b.style[p];
    const seed = b.seed[p] / 65535;
    const r0 = b.partRingStart[p];
    const r1 = b.partRingStart[p + 1];
    if (r1 <= r0) continue;
    const rings: number[][] = [];
    for (let r = r0; r < r1; r += 1) {
      const v0 = b.ringStart[r];
      const v1 = b.ringStart[r + 1];
      const ring: number[] = [];
      for (let v = v0; v < v1; v += 1) ring.push(b.ringXZ[v * 2], b.ringXZ[v * 2 + 1]);
      // Drop a repeated closing vertex.
      const n = ring.length / 2;
      if (n >= 2 && ring[0] === ring[(n - 1) * 2] && ring[1] === ring[(n - 1) * 2 + 1]) ring.length -= 2;
      if (ring.length >= 6) rings.push(ring);
    }
    if (rings.length === 0) continue;
    const key = chunkKey(rings[0][0], rings[0][1]);
    let g = chunks.get(key);
    if (!g) {
      g = emptyChunk();
      chunks.set(key, g);
    }
    g.parts += 1;

    // Walls.
    for (const ring of rings) {
      const n = ring.length / 2;
      for (let i = 0; i < n; i += 1) {
        const ax = ring[i * 2];
        const az = ring[i * 2 + 1];
        const bx = ring[((i + 1) % n) * 2];
        const bz = ring[((i + 1) % n) * 2 + 1];
        const dx = bx - ax;
        const dz = bz - az;
        const len = Math.hypot(dx, dz);
        if (len < 0.01) continue;
        const nx = dz / len;
        const nz = -dx / len;
        const v = g.positions.length / 3;
        g.positions.push(ax, base, az, bx, base, bz, bx, roof, bz, ax, roof, az);
        for (let k = 0; k < 4; k += 1) {
          g.normals.push(nx, 0, nz);
          g.style.push(style);
          g.seed.push(seed);
          g.roof.push(0);
          g.wallLen.push(len);
          g.height.push(height);
        }
        g.uvs.push(0, 0, len, 0, len, height, 0, height);
        // (a_base, a_roof, b_roof) and (a_base, b_roof, b_base) face outward.
        g.indices.push(v, v + 3, v + 2, v, v + 2, v + 1);
      }
    }

    // Roof.
    const coords: number[] = [];
    const holes: number[] = [];
    for (let r = 0; r < rings.length; r += 1) {
      if (r > 0) holes.push(coords.length / 2);
      for (const c of rings[r]) coords.push(c);
    }
    const tris = earcut(coords, holes.length ? holes : undefined, 2);
    const v0 = g.positions.length / 3;
    for (let i = 0; i < coords.length; i += 2) {
      g.positions.push(coords[i], roof, coords[i + 1]);
      g.normals.push(0, 1, 0);
      g.uvs.push(0, 0);
      g.style.push(style);
      g.seed.push(seed);
      g.roof.push(1);
      g.wallLen.push(1);
      g.height.push(height);
    }
    for (let t = 0; t < tris.length; t += 3) {
      const ia = tris[t];
      const ib = tris[t + 1];
      const ic = tris[t + 2];
      const area =
        (coords[ib * 2] - coords[ia * 2]) * (coords[ic * 2 + 1] - coords[ia * 2 + 1]) -
        (coords[ib * 2 + 1] - coords[ia * 2 + 1]) * (coords[ic * 2] - coords[ia * 2]);
      // Negative signed area in (x, z) faces up.
      if (area < 0) g.indices.push(v0 + ia, v0 + ib, v0 + ic);
      else g.indices.push(v0 + ia, v0 + ic, v0 + ib);
    }
  }
  return chunks;
}

export function buildingGeometryToThree(g: BuildingChunkGeometry): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(g.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(g.normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(g.uvs, 2));
  geometry.setAttribute('aStyle', new THREE.Float32BufferAttribute(g.style, 1));
  geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(g.seed, 1));
  geometry.setAttribute('aRoof', new THREE.Float32BufferAttribute(g.roof, 1));
  geometry.setAttribute('aWallLen', new THREE.Float32BufferAttribute(g.wallLen, 1));
  geometry.setAttribute('aHeight', new THREE.Float32BufferAttribute(g.height, 1));
  geometry.setIndex(new THREE.Uint32BufferAttribute(g.indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Facade palette by style id: red brick, brown brick, brownstone, limestone, granite, painted, glass, concrete. */
const PALETTE = [
  [0.5, 0.24, 0.17],
  [0.38, 0.24, 0.17],
  [0.42, 0.3, 0.23],
  [0.76, 0.7, 0.58],
  [0.56, 0.56, 0.54],
  [0.8, 0.77, 0.7],
  [0.3, 0.36, 0.42],
  [0.6, 0.58, 0.55],
];

/**
 * Procedural facades: a style colour with brick courses up close, a window
 * grid centred on each wall with a taller ground floor, a cornice band under
 * the roof, and roofs coloured from the aerial imagery of their chunk.
 */
export function createFacadeMaterial(textures: ChunkTextures, chunkMinX: number, chunkMinZ: number, chunkM: number): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial();
  const style = attribute('aStyle', 'float');
  const seed = attribute('aSeed', 'float');
  const roofFlag = attribute('aRoof', 'float');
  const wallLen = attribute('aWallLen', 'float');
  const wallHeight = attribute('aHeight', 'float');
  const st = attribute('uv', 'vec2');
  const u = st.x;
  const v = st.y;

  // Base colour per style.
  let baseColor: Node<'vec3'> = vec3(...PALETTE[7]);
  for (let s = PALETTE.length - 2; s >= 0; s -= 1) baseColor = select(style.lessThan(float(s + 0.5)), vec3(...PALETTE[s]), baseColor);
  const tint = hash(seed.mul(977)).mul(0.25).add(0.88);
  const noise = mx_noise_float(positionWorld.mul(0.6)).mul(0.05);
  baseColor = baseColor.mul(tint).add(noise);

  const dist = cameraPosition.sub(positionWorld).length();
  const nearFade = smoothstep(90, 25, dist);

  // Brick courses for the brick and brownstone styles.
  const isBrick = style.lessThan(2.5);
  const course = step(0.9, fract(v.div(0.082)));
  const header = step(0.93, fract(u.div(0.21).add(step(0.5, fract(v.div(0.164))).mul(0.5))));
  const mortar = course.max(header).mul(nearFade).mul(isBrick.select(1, 0));
  baseColor = mix(baseColor, baseColor.mul(0.7), mortar.mul(0.6));

  // Window grid.
  const isGlassTower = style.greaterThan(5.5).and(style.lessThan(6.5));
  const groundFloor = float(4.1);
  const floorH = float(3.3);
  const vg = v.sub(0.4).max(0);
  const upper = vg.greaterThan(groundFloor);
  const floorIdx = select(upper, vg.sub(groundFloor).div(floorH).floor().add(1), float(0));
  const fv = select(upper, fract(vg.sub(groundFloor).div(floorH)), vg.div(groundFloor));
  const bayW = float(2.7);
  const bays = wallLen.div(bayW).floor();
  const margin = wallLen.sub(bays.mul(bayW)).mul(0.5);
  const uu = u.sub(margin);
  const bayIdx = uu.div(bayW).floor();
  const fu = fract(uu.div(bayW));
  const inBays = uu.greaterThanEqual(0).and(uu.lessThan(bays.mul(bayW)));
  const upperWindow = fu.greaterThan(0.3).and(fu.lessThan(0.7)).and(fv.greaterThan(0.24)).and(fv.lessThan(0.76));
  const groundWindow = fu.greaterThan(0.18).and(fu.lessThan(0.82)).and(fv.greaterThan(0.2)).and(fv.lessThan(0.86));
  const belowRoof = v.lessThan(wallHeight.sub(0.9));
  const gridWindow = inBays.and(belowRoof).and(select(upper, upperWindow, groundWindow));
  // Curtain wall: glass bands with mullions.
  const mullion = fract(u.div(1.5)).lessThan(0.05);
  const bandWindow = fv.greaterThan(0.12).and(mullion.not()).and(belowRoof);
  const isWindow = select(isGlassTower, bandWindow, gridWindow);

  const perWindow = hash(bayIdx.add(floorIdx.mul(131)).add(seed.mul(7919)));
  const glassDark = vec3(0.07, 0.09, 0.12);
  const glassLit = vec3(0.3, 0.31, 0.33);
  const glass = mix(glassDark, glassLit, step(0.7, perWindow).mul(0.8));
  const spandrel = vec3(0.22, 0.24, 0.27);
  const towerWall = mix(spandrel, baseColor, 0.3);

  // Cornice band and plinth.
  const cornice = v.greaterThan(wallHeight.sub(0.7)).and(v.lessThan(wallHeight.sub(0.05)));
  const corniceColor = select(isBrick, vec3(0.72, 0.66, 0.55), baseColor.mul(0.8));
  const plinth = vg.lessThan(0.9);
  const plinthColor = vec3(0.42, 0.42, 0.4);

  let wall: Node<'vec3'> = select(isGlassTower, towerWall, baseColor);
  wall = select(cornice, corniceColor, wall);
  wall = select(plinth.and(isGlassTower.not()), plinthColor, wall);
  wall = select(isWindow, glass, wall);

  // Roof from the chunk's imagery.
  const origin = uniform(new THREE.Vector2(chunkMinX, chunkMinZ));
  const roofUv = vec2(positionWorld.x.sub(origin.x).div(chunkM), float(1).sub(positionWorld.z.sub(origin.y).div(chunkM))).clamp(0, 1);
  const roofImg = texture(textures.imagery, roofUv).rgb;
  const roofColor = mix(roofImg, vec3(0.3, 0.29, 0.28), 0.25);

  const isRoof = roofFlag.greaterThan(0.5);
  material.colorNode = select(isRoof, roofColor, wall);
  material.roughnessNode = select(isRoof, float(0.9), select(isWindow, float(0.18), float(0.85)));
  material.metalnessNode = select(isWindow.and(isRoof.not()), float(0.4), float(0));
  return material;
}
