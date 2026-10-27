import RAPIER from '@dimforge/rapier3d-compat';
import type { LocalRect } from '../shared/frame.ts';

export type Rapier = typeof RAPIER;

let initPromise: Promise<Rapier> | undefined;

/** Loads the Rapier WebAssembly module once. */
export function initRapier(): Promise<Rapier> {
  if (!initPromise) initPromise = RAPIER.init().then(() => RAPIER);
  return initPromise;
}

/**
 * Heightfield sample layout Rapier expects for one chunk: `cells` cells on a
 * side, so `cells + 1` samples per row, stored column-major with the column
 * index following x and the row index following z. Heights are metres.
 */
export function chunkHeightfield(
  heightsCm: Int16Array,
  vertsX: number,
  firstI: number,
  firstJ: number,
  cells: number,
): Float32Array {
  const n = cells + 1;
  const out = new Float32Array(n * n);
  for (let col = 0; col < n; col += 1) {
    const i = firstI + col;
    for (let row = 0; row < n; row += 1) {
      const j = firstJ + row;
      out[col * n + row] = heightsCm[j * vertsX + i] / 100;
    }
  }
  return out;
}

export interface PhysicsWorld {
  world: RAPIER.World;
  /** Adds one fixed heightfield collider for a chunk whose minimum corner is (minX, minZ). */
  addHeightfield(samples: Float32Array, cells: number, sizeM: number, minX: number, minZ: number): RAPIER.Collider;
  /** Adds one fixed triangle-mesh collider in world coordinates. */
  addTrimesh(vertices: Float32Array, indices: Uint32Array): RAPIER.Collider;
  /** Adds one fixed vertical cylinder standing on the ground at (x, y, z). */
  addCylinder(x: number, y: number, z: number, radius: number, halfHeight: number): RAPIER.Collider;
  /** Invisible walls around the playable rectangle. */
  addBoundary(rect: LocalRect, height: number): void;
  step(dt: number): void;
  readonly stepMs: number;
}

export function createPhysicsWorld(R: Rapier): PhysicsWorld {
  const world = new R.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  const fixed = world.createRigidBody(R.RigidBodyDesc.fixed());
  const state = { stepMs: 0 };
  const hfFlags = R.HeightFieldFlags.FIX_INTERNAL_EDGES;
  return {
    world,
    addHeightfield(samples, cells, sizeM, minX, minZ) {
      const desc = R.ColliderDesc.heightfield(cells, cells, samples, { x: sizeM, y: 1, z: sizeM }, hfFlags)
        .setTranslation(minX + sizeM / 2, 0, minZ + sizeM / 2)
        .setFriction(1.0);
      return world.createCollider(desc, fixed);
    },
    addTrimesh(vertices, indices) {
      const desc = R.ColliderDesc.trimesh(vertices, indices, R.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(0.6);
      return world.createCollider(desc, fixed);
    },
    addCylinder(x, y, z, radius, halfHeight) {
      const desc = R.ColliderDesc.cylinder(halfHeight, radius).setTranslation(x, y + halfHeight, z).setFriction(0.6);
      return world.createCollider(desc, fixed);
    },
    addBoundary(rect, height) {
      const w = rect.maxX - rect.minX;
      const d = rect.maxZ - rect.minZ;
      const cx = (rect.minX + rect.maxX) / 2;
      const cz = (rect.minZ + rect.maxZ) / 2;
      const t = 1;
      const walls = [
        { x: rect.minX - t, z: cz, hx: t, hz: d / 2 + t },
        { x: rect.maxX + t, z: cz, hx: t, hz: d / 2 + t },
        { x: cx, z: rect.minZ - t, hx: w / 2 + t, hz: t },
        { x: cx, z: rect.maxZ + t, hx: w / 2 + t, hz: t },
      ];
      for (const wall of walls) {
        world.createCollider(
          R.ColliderDesc.cuboid(wall.hx, height, wall.hz).setTranslation(wall.x, 0, wall.z),
          fixed,
        );
      }
    },
    step(dt) {
      const t0 = performance.now();
      world.timestep = dt;
      world.step();
      state.stepMs = performance.now() - t0;
    },
    get stepMs() {
      return state.stepMs;
    },
  };
}
