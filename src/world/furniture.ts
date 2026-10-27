import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FURNITURE, FURNITURE_NAMES } from '../shared/furniture.ts';
import type { WorldData } from './data.ts';

/**
 * Street furniture at runtime: one instanced mesh per kind, each built from a
 * few painted primitives merged into one geometry with vertex colours. Yaw and
 * size come from the world file; trees get a per-instance tint. Trunks and
 * posts report cylinder colliders so the car stops at them.
 */
export interface FurnitureCollider {
  x: number;
  y: number;
  z: number;
  radius: number;
  halfHeight: number;
}

export interface FurnitureScene {
  objects: THREE.Object3D[];
  colliders: FurnitureCollider[];
  counts: Record<string, number>;
}

type RGB = [number, number, number];

const BARK: RGB = [0.33, 0.24, 0.16];
const LEAF_A: RGB = [0.22, 0.42, 0.16];
const LEAF_B: RGB = [0.28, 0.49, 0.19];
const LEAF_C: RGB = [0.19, 0.37, 0.15];
const IRON: RGB = [0.12, 0.14, 0.13];
const GALVANISED: RGB = [0.46, 0.48, 0.5];
const GLOBE: RGB = [1.0, 0.95, 0.82];
const SIGNAL_DARK: RGB = [0.2, 0.21, 0.2];
const SIGN_WHITE: RGB = [0.95, 0.95, 0.93];
const SIGN_RED: RGB = [0.72, 0.08, 0.12];
const WOOD: RGB = [0.42, 0.29, 0.17];
const HYDRANT: RGB = [0.7, 0.1, 0.1];
const RED: RGB = [0.95, 0.12, 0.1];
const AMBER: RGB = [0.95, 0.65, 0.1];
const GREEN: RGB = [0.1, 0.8, 0.3];

/** Paints every vertex of a geometry one colour and drops the index so parts can be merged. */
function paint(g: THREE.BufferGeometry, rgb: RGB): THREE.BufferGeometry {
  const flat = g.index ? g.toNonIndexed() : g;
  const n = flat.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    c[i * 3] = rgb[0];
    c[i * 3 + 1] = rgb[1];
    c[i * 3 + 2] = rgb[2];
  }
  flat.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  return flat;
}

function box(w: number, h: number, d: number, rgb: RGB, x: number, y: number, z: number): THREE.BufferGeometry {
  return paint(new THREE.BoxGeometry(w, h, d), rgb).translate(x, y, z);
}

/** An open-ended cylinder: posts never show their ends. */
function post(rTop: number, rBottom: number, h: number, rgb: RGB, x: number, y: number, z: number, segments = 6): THREE.BufferGeometry {
  return paint(new THREE.CylinderGeometry(rTop, rBottom, h, segments, 1, true), rgb).translate(x, y + h / 2, z);
}

function ball(r: number, rgb: RGB, x: number, y: number, z: number): THREE.BufferGeometry {
  return paint(new THREE.SphereGeometry(r, 6, 4), rgb).translate(x, y, z);
}

/** A lumpy sphere for foliage: an icosahedron with its vertices pushed in and out by a position hash, faceted. */
function blob(radius: number, rgb: RGB, x: number, y: number, z: number, seed: number, detail = 1): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i += 1) {
    const px = p.getX(i);
    const py = p.getY(i);
    const pz = p.getZ(i);
    // Shared corners get the same push, so the faceted surface stays closed.
    const h = Math.sin(px * 12.9898 + py * 78.233 + pz * 37.719 + seed) * 43758.5453;
    const k = 0.84 + (h - Math.floor(h)) * 0.32;
    p.setXYZ(i, px * k, py * k * 0.9, pz * k);
  }
  g.computeVertexNormals();
  return paint(g, rgb).translate(x, y, z);
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error('furniture geometry merge failed');
  for (const p of parts) p.dispose();
  return merged;
}

/** Unit tree, 1 m tall: a trunk and three foliage blobs; scaled by the tree height at runtime. */
function treeGeometry(): THREE.BufferGeometry {
  return merge([
    post(0.035, 0.05, 0.46, BARK, 0, 0, 0),
    blob(0.34, LEAF_A, 0, 0.68, 0, 1),
    blob(0.25, LEAF_B, 0.15, 0.79, 0.09, 2, 0),
    blob(0.23, LEAF_C, -0.15, 0.58, -0.11, 3, 0),
  ]);
}

/** Pedestal lamp with an acorn globe, 3.9 m. */
function lampGeometry(): THREE.BufferGeometry {
  return merge([
    post(0.13, 0.16, 0.5, IRON, 0, 0, 0),
    post(0.05, 0.08, 2.9, IRON, 0, 0.5, 0),
    post(0.1, 0.07, 0.12, IRON, 0, 3.4, 0),
    ball(0.21, GLOBE, 0, 3.72, 0),
    paint(new THREE.ConeGeometry(0.09, 0.14, 8), IRON).translate(0, 3.98, 0),
  ]);
}

/** Cobra-head lamp, 8.5 m, with the arm reaching along local +x over the road. */
function cobraGeometry(): THREE.BufferGeometry {
  return merge([
    post(0.07, 0.12, 8.5, GALVANISED, 0, 0, 0),
    box(2.6, 0.08, 0.08, GALVANISED, 1.3, 8.45, 0),
    box(0.75, 0.14, 0.32, SIGNAL_DARK, 2.5, 8.42, 0),
    box(0.5, 0.03, 0.22, GLOBE, 2.5, 8.34, 0),
  ]);
}

/** Traffic signal: a pole with a mast arm along local +z over the road; heads face local +x toward the traffic. */
function signalGeometry(): THREE.BufferGeometry {
  const head = (x: number, y: number, z: number): THREE.BufferGeometry[] => [
    box(0.3, 1.0, 0.36, SIGNAL_DARK, x, y, z),
    ball(0.1, RED, x + 0.17, y + 0.3, z),
    ball(0.1, AMBER, x + 0.17, y, z),
    ball(0.1, GREEN, x + 0.17, y - 0.3, z),
  ];
  return merge([
    post(0.07, 0.1, 5.2, SIGNAL_DARK, 0, 0, 0),
    box(0.09, 0.09, 4.8, SIGNAL_DARK, 0, 5.1, 2.4),
    ...head(0.0, 4.5, 4.5),
    ...head(0.17, 3.4, 0),
  ]);
}

/** Stop sign on a post, the face toward local +x. */
function stopGeometry(): THREE.BufferGeometry {
  const face = (r: number, x: number, rgb: RGB) => {
    const g = new THREE.CylinderGeometry(r, r, 0.02, 8);
    g.rotateY(Math.PI / 8);
    g.rotateZ(Math.PI / 2);
    return paint(g, rgb).translate(x, 2.05, 0);
  };
  return merge([post(0.03, 0.03, 2.25, GALVANISED, 0, 0, 0), face(0.4, 0.0, SIGN_WHITE), face(0.34, 0.02, SIGN_RED)]);
}

/** Park bench facing local +x. */
function benchGeometry(): THREE.BufferGeometry {
  return merge([
    box(0.5, 0.06, 1.8, WOOD, 0, 0.45, 0),
    box(0.05, 0.42, 1.8, WOOD, -0.24, 0.72, 0),
    box(0.48, 0.42, 0.06, IRON, 0, 0.21, 0.82),
    box(0.48, 0.42, 0.06, IRON, 0, 0.21, -0.82),
  ]);
}

function hydrantGeometry(): THREE.BufferGeometry {
  return merge([
    post(0.11, 0.14, 0.7, HYDRANT, 0, 0, 0),
    ball(0.12, HYDRANT, 0, 0.74, 0),
    box(0.32, 0.1, 0.1, HYDRANT, 0, 0.45, 0),
    box(0.1, 0.1, 0.16, HYDRANT, 0.1, 0.45, 0),
  ]);
}

const BUILDERS: Record<number, () => THREE.BufferGeometry> = {
  [FURNITURE.tree]: treeGeometry,
  [FURNITURE.lamp]: lampGeometry,
  [FURNITURE.cobra]: cobraGeometry,
  [FURNITURE.signal]: signalGeometry,
  [FURNITURE.stop]: stopGeometry,
  [FURNITURE.bench]: benchGeometry,
  [FURNITURE.hydrant]: hydrantGeometry,
};

/** Collider per kind: trunk and post radii; benches and hydrants get a stubby cylinder. */
const COLLIDERS: Record<number, { radius: number; halfHeight: number }> = {
  [FURNITURE.tree]: { radius: 0.25, halfHeight: 1.5 },
  [FURNITURE.lamp]: { radius: 0.14, halfHeight: 1.5 },
  [FURNITURE.cobra]: { radius: 0.12, halfHeight: 1.5 },
  [FURNITURE.signal]: { radius: 0.1, halfHeight: 1.5 },
  [FURNITURE.stop]: { radius: 0.04, halfHeight: 1.0 },
  [FURNITURE.bench]: { radius: 0.7, halfHeight: 0.4 },
  [FURNITURE.hydrant]: { radius: 0.15, halfHeight: 0.4 },
};

/** Only the kinds whose shadows read at street level are drawn into the shadow map. */
const CASTS_SHADOW = new Set<number>([FURNITURE.tree, FURNITURE.cobra, FURNITURE.signal]);
/** Instances are grouped into square cells of this size so the frustum culls distant groups. */
const GROUP_M = 512;

export function createFurnitureMaterial(): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05 });
  return material;
}

export function buildFurniture(world: WorldData): FurnitureScene {
  const f = world.furniture;
  const groupsX = Math.ceil((world.rect.maxX - world.rect.minX) / GROUP_M);
  const byGroup = new Map<number, { kind: number; list: number[] }>();
  for (let i = 0; i < f.count; i += 1) {
    const gx = Math.floor((f.xyz[i * 3] - world.rect.minX) / GROUP_M);
    const gz = Math.floor((f.xyz[i * 3 + 2] - world.rect.minZ) / GROUP_M);
    const key = (f.kind[i] * 4096 + gz) * groupsX + gx;
    let group = byGroup.get(key);
    if (!group) {
      group = { kind: f.kind[i], list: [] };
      byGroup.set(key, group);
    }
    group.list.push(i);
  }
  const geometries = new Map<number, THREE.BufferGeometry>();
  const material = createFurnitureMaterial();
  const objects: THREE.Object3D[] = [];
  const colliders: FurnitureCollider[] = [];
  const counts: Record<string, number> = {};
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const tint = new THREE.Color();
  for (const { kind, list } of byGroup.values()) {
    const build = BUILDERS[kind];
    if (!build) continue;
    let geometry = geometries.get(kind);
    if (!geometry) {
      geometry = build();
      geometries.set(kind, geometry);
    }
    const mesh = new THREE.InstancedMesh(geometry, material, list.length);
    const collider = COLLIDERS[kind];
    const isTree = kind === FURNITURE.tree;
    list.forEach((i, k) => {
      const x = f.xyz[i * 3];
      const y = f.xyz[i * 3 + 1];
      const z = f.xyz[i * 3 + 2];
      const size = isTree ? f.size[i] : 1;
      const seed = f.seed[i] / 65535;
      quaternion.setFromAxisAngle(up, f.yaw[i]);
      scale.set(isTree ? size * 0.85 : 1, size, isTree ? size * 0.85 : 1);
      matrix.compose(position.set(x, y, z), quaternion, scale);
      mesh.setMatrixAt(k, matrix);
      if (isTree) {
        tint.setRGB(0.85 + seed * 0.3, 0.85 + ((seed * 7.3) % 1) * 0.3, 0.85 + ((seed * 13.7) % 1) * 0.25);
        mesh.setColorAt(k, tint);
      }
      if (collider) colliders.push({ x, y, z, radius: isTree ? collider.radius * Math.max(0.6, size / 9) : collider.radius, halfHeight: collider.halfHeight });
    });
    mesh.castShadow = CASTS_SHADOW.has(kind);
    mesh.receiveShadow = true;
    mesh.name = `furniture ${FURNITURE_NAMES[kind]}`;
    objects.push(mesh);
    counts[FURNITURE_NAMES[kind]] = (counts[FURNITURE_NAMES[kind]] ?? 0) + list.length;
  }
  return { objects, colliders, counts };
}
