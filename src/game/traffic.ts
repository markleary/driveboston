import * as THREE from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { RigidBody } from '@dimforge/rapier3d-compat';
import { ROAD_CLASS } from '../shared/roads.ts';
import { yawFor } from '../shared/furniture.ts';
import type { LocalRect } from '../shared/frame.ts';
import type { WorldData } from '../world/data.ts';
import { COLLISION, type PhysicsWorld, type Rapier } from '../physics/physics.ts';
import { LinkPath, laneOffset, mulberry32, type Pose } from './traffic-paths.ts';

/**
 * Other cars. Traffic cars drive the road graph in their lane, keep a gap to
 * the car ahead and to the player, slow for turns and pick the next street at
 * each junction with a preference for carrying straight on. Each is a
 * dynamic body steered by velocity that collides only with the player, drawn
 * as one instance of a merged low-poly sedan. Parked cars line the curbs of streets that have parking as
 * fixed colliders and instanced meshes grouped by 512 m cell.
 */
const CAR_LENGTH = 4.5;
const CAR_HALF = { x: 2.2, y: 0.45, z: 0.85 } as const;
/** Height of the collider centre over the road surface. */
const BODY_LIFT = 0.78;
const ROAD_LIFT = 0.04;
const MAX_SPEED = 13.4;
const ACCEL = 2.4;
const DECEL = 6;
const FOLLOW_GAP = 9;
/** No traffic car appears closer than this to the player. */
const SPAWN_CLEAR_M = 60;
const GROUP_M = 512;
const EDGE_M = 8;
const CAR_MASS = 1400;
/** Extra speed a car may use to get back to its path. */
const CATCH_UP = 2.5;
/** A body this far ahead of its path pose has been pushed; the path catches up to it. */
const PUSHED_M = 0.05;
/** A body this far behind its path pose is being held; the path waits for it. */
const BLOCKED_M = 2.5;
/** Fastest sideways speed for merging into a lane. */
const MERGE_V = 2;
/** A car stopped this long with the player far away goes somewhere else. */
const STUCK_S = 20;
const PALETTE: [number, number, number][] = [
  [0.85, 0.85, 0.87],
  [0.92, 0.92, 0.9],
  [0.12, 0.12, 0.13],
  [0.35, 0.36, 0.38],
  [0.1, 0.18, 0.42],
  [0.55, 0.08, 0.1],
  [0.16, 0.34, 0.22],
  [0.6, 0.6, 0.62],
  [0.72, 0.52, 0.2],
  [0.2, 0.2, 0.24],
];

type RGB = [number, number, number];

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
  if (flat.hasAttribute('uv')) flat.deleteAttribute('uv');
  return flat;
}

/**
 * A sedan with its wheels on y = 0 and its nose along +x; the body is white so
 * the instance colour tints it. The low-detail version (plain boxes, six-sided
 * wheels, a dark patch for a contact shadow) is for the thousands of parked
 * cars, which cast no shadows.
 */
export function createCarGeometry(detail: 'high' | 'low'): THREE.BufferGeometry {
  const white: RGB = [1, 1, 1];
  const dark: RGB = [0.08, 0.08, 0.09];
  const glass: RGB = [0.06, 0.09, 0.12];
  const lamp: RGB = [1, 0.97, 0.85];
  const tail: RGB = [0.8, 0.05, 0.05];
  const high = detail === 'high';
  const parts: THREE.BufferGeometry[] = [
    paint(high ? new RoundedBoxGeometry(4.4, 0.5, 1.7, 2, 0.12) : new THREE.BoxGeometry(4.4, 0.5, 1.7), white).translate(0, 0.62, 0),
    paint(high ? new RoundedBoxGeometry(2.1, 0.52, 1.42, 2, 0.16) : new THREE.BoxGeometry(2.1, 0.52, 1.42), glass).translate(-0.2, 1.1, 0),
  ];
  if (high) {
    parts.push(
      paint(new THREE.BoxGeometry(1.5, 0.05, 1.3), white).translate(-0.25, 1.37, 0),
      paint(new THREE.BoxGeometry(0.06, 0.12, 0.4), lamp).translate(2.2, 0.62, 0.52),
      paint(new THREE.BoxGeometry(0.06, 0.12, 0.4), lamp).translate(2.2, 0.62, -0.52),
      paint(new THREE.BoxGeometry(0.06, 0.1, 0.45), tail).translate(-2.2, 0.64, 0.5),
      paint(new THREE.BoxGeometry(0.06, 0.1, 0.45), tail).translate(-2.2, 0.64, -0.5),
    );
  } else {
    parts.push(
      paint(new THREE.PlaneGeometry(0.4, 0.12), lamp).rotateY(Math.PI / 2).translate(2.21, 0.62, 0.52),
      paint(new THREE.PlaneGeometry(0.4, 0.12), lamp).rotateY(Math.PI / 2).translate(2.21, 0.62, -0.52),
      paint(new THREE.PlaneGeometry(0.45, 0.1), tail).rotateY(-Math.PI / 2).translate(-2.21, 0.64, 0.5),
      paint(new THREE.PlaneGeometry(0.45, 0.1), tail).rotateY(-Math.PI / 2).translate(-2.21, 0.64, -0.5),
      paint(new THREE.PlaneGeometry(4.7, 2), [0.02, 0.02, 0.03]).rotateX(-Math.PI / 2).translate(0, 0.02, 0),
    );
  }
  const wheel = new THREE.CylinderGeometry(0.33, 0.33, 0.24, high ? 8 : 6);
  wheel.rotateX(Math.PI / 2);
  for (const [x, z] of [
    [1.4, 0.82],
    [1.4, -0.82],
    [-1.4, 0.82],
    [-1.4, -0.82],
  ]) {
    parts.push(paint(wheel.clone(), dark).translate(x, 0.33, z));
  }
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error('traffic car geometry merge failed');
  for (const p of parts) p.dispose();
  return merged;
}

export function createCarPaint(): THREE.MeshStandardNodeMaterial {
  return new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.3 });
}

function inside(rect: LocalRect, x: number, z: number): boolean {
  return x > rect.minX + EDGE_M && x < rect.maxX - EDGE_M && z > rect.minZ + EDGE_M && z < rect.maxZ - EDGE_M;
}

interface NextChoice {
  path: LinkPath;
  dir: 1 | -1;
  /** Cosine of the turn angle: 1 straight on, 0 a right angle. */
  turnCos: number;
}

interface Car {
  path: LinkPath;
  dir: 1 | -1;
  lane: number;
  /** Distance from node a along the link. */
  s: number;
  speed: number;
  /** Where the car goes at the end of its link; 'end' means nowhere, so it respawns. */
  next: NextChoice | 'end' | null;
  body: RigidBody;
  /** Where the path wants the car this step. */
  target: Pose;
  /** Where the body was after the last two steps, for drawing. */
  prev: Pose;
  cur: Pose;
  /** The way the body faces: along its velocity when moving, else along its path. */
  face: { dx: number; dz: number };
  /** Speed along the path set last step, to tell a push from the car's own motion. */
  vAlong: number;
  /** Seconds spent stopped. */
  stuck: number;
}

export interface PlayerState {
  x: number;
  z: number;
  dx: number;
  dz: number;
}

const newPose = (): Pose => ({ x: 0, y: 0, z: 0, dx: 1, dz: 0 });

export class Traffic {
  readonly mesh: THREE.InstancedMesh;
  private readonly cars: Car[] = [];
  private readonly byNode = new Map<number, LinkPath[]>();
  private readonly candidates: LinkPath[];
  private readonly totalLength: number;
  private readonly rect: LocalRect;
  private readonly rand: () => number;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3(1, 1, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(world: WorldData, physics: PhysicsWorld, R: Rapier, count: number, avoid: { x: number; z: number }, seed = 7) {
    this.rand = mulberry32(seed);
    this.rect = world.rect;
    const paths = world.links.map((l) => new LinkPath(l));
    for (const path of paths) {
      if (!path.link.drivable || path.link.tunnel) continue;
      for (const node of [path.link.a, path.link.b]) {
        const list = this.byNode.get(node) ?? [];
        list.push(path);
        this.byNode.set(node, list);
      }
    }
    this.candidates = paths.filter((p) => {
      const pts = p.link.points;
      return (
        p.link.drivable &&
        !p.link.tunnel &&
        p.link.cls !== 'service' &&
        p.length > 25 &&
        inside(this.rect, pts[0], pts[2]) &&
        inside(this.rect, pts[pts.length - 3], pts[pts.length - 1])
      );
    });
    this.totalLength = this.candidates.reduce((s, p) => s + p.length, 0);
    this.mesh = new THREE.InstancedMesh(createCarGeometry('high'), createCarPaint(), count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'traffic';
    const color = new THREE.Color();
    for (let i = 0; i < count && this.candidates.length; i += 1) {
      // A dynamic body driven by velocity: it has mass in a collision with the
      // player, unlike a kinematic body, which would push them through walls.
      const body = physics.world.createRigidBody(R.RigidBodyDesc.dynamic().setGravityScale(0).lockRotations());
      physics.world.createCollider(
        R.ColliderDesc.cuboid(CAR_HALF.x, CAR_HALF.y, CAR_HALF.z).setMass(CAR_MASS).setFriction(0.5).setCollisionGroups(COLLISION.traffic),
        body,
      );
      const car: Car = { path: this.candidates[0], dir: 1, lane: 0, s: 0, speed: 0, next: null, body, target: newPose(), prev: newPose(), cur: newPose(), face: { dx: 1, dz: 0 }, vAlong: 0, stuck: 0 };
      this.respawn(car, avoid);
      this.cars.push(car);
      const rgb = PALETTE[Math.floor(this.rand() * PALETTE.length)];
      color.setRGB(rgb[0], rgb[1], rgb[2]);
      this.mesh.setColorAt(i, color);
    }
    this.mesh.count = this.cars.length;
    this.frame(1);
  }

  get count(): number {
    return this.cars.length;
  }

  /** x, z, dx, dz per car, for the tests. */
  poses(): number[] {
    return this.cars.flatMap((c) => [c.cur.x, c.cur.z, c.cur.dx, c.cur.dz]);
  }

  /** Moves any car within `radius` of a point somewhere else, for teleports. */
  clearAround(x: number, z: number, radius: number): void {
    for (const car of this.cars) {
      if (Math.hypot(car.cur.x - x, car.cur.z - z) < radius) this.respawn(car, { x, z });
    }
  }

  /** Puts a car on a random street, weighted by length, away from `avoid`. */
  private respawn(car: Car, avoid: { x: number; z: number }): void {
    for (let attempt = 0; attempt < 24; attempt += 1) {
      let path = this.candidates[0];
      let pick = this.rand() * this.totalLength;
      for (const p of this.candidates) {
        pick -= p.length;
        if (pick <= 0) {
          path = p;
          break;
        }
      }
      const dir: 1 | -1 = path.link.oneway || this.rand() < 0.5 ? 1 : -1;
      const s = 10 + this.rand() * (path.length - 20);
      path.poseAt(s, laneOffset(path.link, dir, 0), car.target);
      if (attempt < 23 && Math.hypot(car.target.x - avoid.x, car.target.z - avoid.z) < SPAWN_CLEAR_M) continue;
      car.path = path;
      car.dir = dir;
      car.lane = 0;
      car.s = s;
      car.speed = 4 + this.rand() * 4;
      car.next = null;
      car.vAlong = 0;
      car.stuck = 0;
      this.sample(car);
      Object.assign(car.cur, car.target);
      Object.assign(car.prev, car.target);
      car.face.dx = car.target.dx;
      car.face.dz = car.target.dz;
      this.quaternion.setFromAxisAngle(this.up, yawFor(car.target.dx, car.target.dz));
      car.body.setTranslation({ x: car.target.x, y: car.target.y + BODY_LIFT, z: car.target.z }, true);
      car.body.setRotation(this.quaternion, true);
      car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      return;
    }
  }

  /** Writes the car's path pose from its place on its link. */
  private sample(car: Car): void {
    car.path.poseAt(car.s, laneOffset(car.path.link, car.dir, car.lane), car.target);
    car.target.y += ROAD_LIFT;
    car.target.dx *= car.dir;
    car.target.dz *= car.dir;
  }

  /** Chooses where a car goes after the end of its link, preferring to carry straight on. */
  private chooseNext(car: Car): NextChoice | 'end' {
    const endNode = car.dir === 1 ? car.path.link.b : car.path.link.a;
    const [hx, hz] = car.path.dirInto(car.dir !== 1);
    const heading: [number, number] = [-hx, -hz];
    const options: (NextChoice & { weight: number })[] = [];
    for (const path of this.byNode.get(endNode) ?? []) {
      if (path === car.path) continue;
      const atA = path.link.a === endNode;
      if (path.link.oneway && !atA) continue;
      const pts = path.link.points;
      const far = atA ? pts.length - 3 : 0;
      if (!inside(this.rect, pts[far], pts[far + 2])) continue;
      const [ax, az] = path.dirInto(atA);
      const turnCos = heading[0] * ax + heading[1] * az;
      let weight = Math.max(0.05, turnCos + 1) ** 2;
      if (path.link.cls === 'service') weight *= 0.08;
      if (path.link.name === car.path.link.name) weight *= 1.6;
      if (path.link.cls === 'primary' || path.link.cls === 'secondary') weight *= 1.3;
      options.push({ path, dir: atA ? 1 : -1, turnCos, weight });
    }
    if (!options.length) return 'end';
    let pick = this.rand() * options.reduce((s, o) => s + o.weight, 0);
    for (const o of options) {
      pick -= o.weight;
      if (pick <= 0) return o;
    }
    return options[options.length - 1];
  }

  /** Before the physics step: advances every car along its path and sets the velocity that takes its body there. */
  fixedUpdate(dt: number, player: PlayerState): void {
    for (const car of this.cars) {
      const remaining = car.dir === 1 ? car.path.length - car.s : car.s;
      if (!car.next && remaining < 30) car.next = this.chooseNext(car);
      if (car.next === 'end' && remaining < 25) {
        this.respawn(car, player);
        continue;
      }
      // A car stopped for a long time while the player is elsewhere goes somewhere else.
      car.stuck = car.speed < 0.3 ? car.stuck + dt : 0;
      if (car.stuck > STUCK_S && Math.hypot(player.x - car.cur.x, player.z - car.cur.z) > SPAWN_CLEAR_M) {
        this.respawn(car, player);
        continue;
      }
      let target = Math.min(MAX_SPEED, car.path.link.speedMps * 0.95);
      if (car.next && car.next !== 'end' && remaining < 14 && car.next.turnCos < 0.7) {
        target = Math.min(target, car.next.turnCos < -0.5 ? 2 : 4.5);
      }
      // Keep a gap to the car ahead on the same link and side.
      for (const other of this.cars) {
        if (other === car || other.path !== car.path || other.dir !== car.dir) continue;
        const gap = (other.s - car.s) * car.dir - CAR_LENGTH;
        if (gap < 0 || gap > FOLLOW_GAP + 20) continue;
        target = Math.min(target, gap < 3 ? 0 : other.speed * Math.min(1, gap / FOLLOW_GAP));
      }
      // The player: slow when any part of their car is in the lane ahead.
      const playerAhead = this.playerAhead(car, player);
      if (playerAhead < Infinity) target = Math.min(target, Math.max(0, playerAhead - 6) * 0.8);
      car.speed += Math.max(-DECEL * dt, Math.min(ACCEL * dt, target - car.speed));
      car.s += car.dir * car.speed * dt;
      if (car.dir === 1 ? car.s >= car.path.length : car.s <= 0) {
        const over = car.dir === 1 ? car.s - car.path.length : -car.s;
        const next = car.next ?? this.chooseNext(car);
        if (next === 'end') {
          this.respawn(car, player);
          continue;
        }
        car.path = next.path;
        car.dir = next.dir;
        car.s = next.dir === 1 ? Math.min(over, next.path.length) : Math.max(next.path.length - over, 0);
        car.lane = next.path.link.oneway && next.path.link.lanes > 1 && this.rand() < 0.4 ? 1 : 0;
        car.next = null;
      }
      this.sample(car);
      this.drive(car, dt, player, playerAhead < Infinity);
    }
  }

  /** How far ahead of the car the nearest point of the player's car sits in its lane, or Infinity when it is not in the way. */
  private playerAhead(car: Car, player: PlayerState): number {
    let nearest = Infinity;
    for (let i = -1; i <= 1; i += 1) {
      const rx = player.x + player.dx * 2 * i - car.cur.x;
      const rz = player.z + player.dz * 2 * i - car.cur.z;
      const ahead = rx * car.target.dx + rz * car.target.dz;
      const beside = Math.abs(rx * car.target.dz - rz * car.target.dx);
      if (ahead > 1 && ahead < 20 && beside < 2.6) nearest = Math.min(nearest, ahead);
    }
    return nearest;
  }

  /**
   * Sets the body's velocity: along the path at the car's speed, sideways at a
   * capped rate to merge into its lane. Pushed from behind by the player, the
   * car rolls with the push and the path catches up to the body; pushed back
   * or held, the path waits where the body is and the car starts again from
   * rest. It never drives backwards, never catches up into a player in its
   * lane and never corrects sideways into one next to it, so a car the player
   * leans on is a stopped car, not a bulldozer.
   */
  private drive(car: Car, dt: number, player: PlayerState, playerInLane: boolean): void {
    const t = car.target;
    const p = car.body.translation();
    const v = car.body.linvel();
    const pushed = v.x * t.dx + v.z * t.dz;
    if (pushed > car.vAlong + 0.3) car.speed = Math.max(car.speed, Math.min(MAX_SPEED + CATCH_UP, pushed));
    let along = (t.x - p.x) * t.dx + (t.z - p.z) * t.dz;
    if (along < -PUSHED_M || along > BLOCKED_M) {
      if (along > BLOCKED_M) car.speed = 0;
      const atBody = car.s - car.dir * along;
      car.s = Math.max(0, Math.min(car.path.length, atBody + car.dir * car.speed * dt));
      this.sample(car);
      along = (t.x - p.x) * t.dx + (t.z - p.z) * t.dz;
    }
    const across = (t.z - p.z) * t.dx - (t.x - p.x) * t.dz;
    const playerNear = playerInLane || Math.hypot(player.x - p.x, player.z - p.z) < 6;
    const vAlong = Math.max(0, Math.min(car.speed + (playerInLane ? 0 : CATCH_UP), along / dt));
    const vAcross = playerNear ? 0 : Math.max(-MERGE_V, Math.min(MERGE_V, across * 2));
    const vx = t.dx * vAlong - t.dz * vAcross;
    const vz = t.dz * vAlong + t.dx * vAcross;
    const vy = Math.max(-4, Math.min(4, (t.y + BODY_LIFT - p.y) / dt));
    car.body.setLinvel({ x: vx, y: vy, z: vz }, true);
    car.vAlong = vAlong;
    const speed = Math.hypot(vx, vz);
    if (speed > 2) {
      car.face.dx = vx / speed;
      car.face.dz = vz / speed;
    } else {
      car.face.dx = t.dx;
      car.face.dz = t.dz;
    }
    this.quaternion.setFromAxisAngle(this.up, yawFor(car.face.dx, car.face.dz));
    car.body.setRotation(this.quaternion, true);
  }

  /** After the physics step: reads where the bodies ended up, for drawing. */
  afterStep(): void {
    for (const car of this.cars) {
      Object.assign(car.prev, car.cur);
      const p = car.body.translation();
      car.cur.x = p.x;
      car.cur.y = p.y - BODY_LIFT;
      car.cur.z = p.z;
      car.cur.dx = car.face.dx;
      car.cur.dz = car.face.dz;
    }
  }

  /** Writes interpolated instance matrices. */
  frame(alpha: number): void {
    this.cars.forEach((car, i) => {
      const x = car.prev.x + (car.cur.x - car.prev.x) * alpha;
      const y = car.prev.y + (car.cur.y - car.prev.y) * alpha;
      const z = car.prev.z + (car.cur.z - car.prev.z) * alpha;
      const dx = car.prev.dx + (car.cur.dx - car.prev.dx) * alpha;
      const dz = car.prev.dz + (car.cur.dz - car.prev.dz) * alpha;
      this.quaternion.setFromAxisAngle(this.up, yawFor(dx, dz));
      this.matrix.compose(this.position.set(x, y, z), this.quaternion, this.scale);
      this.mesh.setMatrixAt(i, this.matrix);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/**
 * Parks cars along the curbs of streets that have parking, one slot every
 * 6.5 m with random gaps, facing the way traffic flows on that side. Each 512 m
 * cell gets one instanced mesh so the frustum culls distant blocks.
 */
export function placeParkedCars(world: WorldData, physics: PhysicsWorld, R: Rapier, seed = 11, occupancy = 0.5): { meshes: THREE.InstancedMesh[]; count: number } {
  const rand = mulberry32(seed);
  const rect = world.rect;
  interface Slot {
    x: number;
    y: number;
    z: number;
    yaw: number;
    rgb: RGB;
  }
  const groupsX = Math.ceil((rect.maxX - rect.minX) / GROUP_M);
  const groups = new Map<number, Slot[]>();
  let count = 0;
  const pose: Pose = { x: 0, y: 0, z: 0, dx: 1, dz: 0 };
  for (const link of world.links) {
    if (!link.drivable || !ROAD_CLASS[link.cls].parking || link.bridge || link.tunnel || link.width < 9) continue;
    const path = new LinkPath(link);
    if (path.length < 30) continue;
    const curb = link.width / 2 - 1.1;
    for (const side of [1, -1] as const) {
      for (let s = 12 + rand() * 6.5; s < path.length - 12; s += 6.5) {
        if (rand() > occupancy) continue;
        path.poseAt(s, side * curb, pose);
        if (!inside(rect, pose.x, pose.z) || world.classAt(pose.x, pose.z) !== 1) continue;
        // Cars on the right-hand curb face a to b; on the left they face b to a unless the street is one-way.
        const facing = side === 1 || link.oneway ? 1 : -1;
        const slot: Slot = { x: pose.x, y: pose.y + ROAD_LIFT, z: pose.z, yaw: yawFor(pose.dx * facing, pose.dz * facing), rgb: PALETTE[Math.floor(rand() * PALETTE.length)] };
        const key = Math.floor((pose.z - rect.minZ) / GROUP_M) * groupsX + Math.floor((pose.x - rect.minX) / GROUP_M);
        const list = groups.get(key) ?? [];
        list.push(slot);
        groups.set(key, list);
        count += 1;
      }
    }
  }
  const geometry = createCarGeometry('low');
  const material = createCarPaint();
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  const color = new THREE.Color();
  const meshes: THREE.InstancedMesh[] = [];
  for (const slots of groups.values()) {
    const mesh = new THREE.InstancedMesh(geometry, material, slots.length);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.name = 'parked cars';
    slots.forEach((p, i) => {
      quaternion.setFromAxisAngle(up, p.yaw);
      matrix.compose(position.set(p.x, p.y, p.z), quaternion, scale);
      mesh.setMatrixAt(i, matrix);
      color.setRGB(p.rgb[0], p.rgb[1], p.rgb[2]);
      mesh.setColorAt(i, color);
      physics.world.createCollider(
        R.ColliderDesc.cuboid(CAR_HALF.x, CAR_HALF.y, CAR_HALF.z)
          .setTranslation(p.x, p.y + BODY_LIFT, p.z)
          .setRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w })
          .setFriction(0.5)
          .setCollisionGroups(COLLISION.world),
      );
    });
    mesh.computeBoundingSphere();
    meshes.push(mesh);
  }
  return { meshes, count };
}
