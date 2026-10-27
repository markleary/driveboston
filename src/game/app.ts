import * as THREE from 'three/webgpu';
import { createRenderer, resizeRenderer } from '../core/renderer.ts';
import { createPostStack, type PostStack } from '../core/post.ts';
import { Loop } from '../core/loop.ts';
import { Input, type DriveIntent } from '../core/input.ts';
import { createDiagnostics, type Diagnostics } from '../core/diagnostics.ts';
import { LoadingScreen } from '../ui/loading.ts';
import { Hud } from '../ui/hud.ts';
import { Minimap } from '../ui/minimap.ts';
import { GameAudio } from '../audio/game-audio.ts';
import { loadWorld, type WorldData } from '../world/data.ts';
import { loadChunkTextures, type ChunkTextures } from '../world/imagery.ts';
import { buildTerrainChunk } from '../world/terrain.ts';
import { buildBuildingGeometry, buildingGeometryToThree, createFacadeMaterial } from '../world/buildings.ts';
import { buildModelGeometry } from '../world/models.ts';
import { buildFurniture } from '../world/furniture.ts';
import { buildCurbGeometry, createCurbMaterial, geometryFromStatic, type StaticGeometry } from '../world/curbs.ts';
import { buildBridgeGeometry, createBridgeMaterial } from '../world/bridges.ts';
import { buildRoadGeometry } from '../world/road-geometry.ts';
import { createRoadMaterial, roadGeometryToThree } from '../world/road-material.ts';
import { createSky, type SkyRig } from '../world/sky.ts';
import { createWater } from '../world/water.ts';
import { createPhysicsWorld, initRapier, type PhysicsWorld } from '../physics/physics.ts';
import { Vehicle } from '../physics/vehicle.ts';
import { createCarMesh, type CarMesh } from './car-mesh.ts';
import { GameCamera, type CameraMode } from './camera.ts';
import { StreetIndex } from './streets.ts';
import { DevTools } from './devtools.ts';
import { Traffic, placeParkedCars, type PlayerState } from './traffic.ts';

const BOX = 'backbay';
const DEFAULT_SPAWN = 'Commonwealth Avenue at Dartmouth Street';
const TRAFFIC_CARS = 140;
const NO_TRAFFIC = new Float32Array(0);

/** Yields to the event loop so the loading bar can paint (a timer rather than rAF so hidden tabs keep loading). */
const nextFrame = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 16));

/** Boots the renderer, loads the Back Bay world and runs the game loop. */
export class App {
  readonly loading = new LoadingScreen();
  readonly hud = new Hud();
  readonly input = new Input();
  private renderer!: THREE.WebGPURenderer;
  private diagnostics!: Diagnostics;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(58, 1, 0.3, 7000);
  private readonly loop = new Loop({
    fixedUpdate: (dt) => this.fixedUpdate(dt),
    frame: (dt, alpha) => this.frame(dt, alpha),
  });
  private readonly canvas: HTMLCanvasElement;
  private world!: WorldData;
  private physics!: PhysicsWorld;
  private vehicle!: Vehicle;
  private carMesh!: CarMesh;
  private gameCamera!: GameCamera;
  private sky!: SkyRig;
  private streets!: StreetIndex;
  private minimap!: Minimap;
  private audio!: GameAudio;
  private throttleNow = 0;
  private steerNow = 0;
  private handbrakeNow = false;
  /** Sideways speed of the chassis, metres per second. */
  private slip = 0;
  /** Physics steps left to ignore velocity jumps after a teleport. */
  private skipImpact = 0;
  private readonly prevVel = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private devTools?: DevTools;
  private traffic: Traffic | null = null;
  private post: PostStack | null = null;
  private readonly playerState: PlayerState = { x: 0, z: 0, dx: 1, dz: 0 };
  private scriptedIntent: DriveIntent | null = null;
  private readonly prevPos = new THREE.Vector3();
  private readonly prevQuat = new THREE.Quaternion();
  private readonly curPos = new THREE.Vector3();
  private readonly curQuat = new THREE.Quaternion();
  private readonly renderPos = new THREE.Vector3();
  private readonly renderQuat = new THREE.Quaternion();
  private readonly wheelPos = new THREE.Vector3();
  private readonly wheelQuat = new THREE.Quaternion();
  private readonly forward = new THREE.Vector3();
  private streetLabel = { street: '', cross: '' };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  async start(): Promise<void> {
    this.loading.set('Starting the renderer', 0.03);
    const { renderer, backend } = await createRenderer(this.canvas);
    this.renderer = renderer;
    this.diagnostics = createDiagnostics(backend);
    this.hud.setBackend(backend === 'webgpu' ? 'WebGPU' : 'WebGL 2');
    this.audio = new GameAudio(`${import.meta.env.BASE_URL}audio/`);

    const base = `${import.meta.env.BASE_URL}data/${BOX}/`;
    this.loading.set('Loading Back Bay', 0.05);
    const [world, R] = await Promise.all([
      loadWorld(`${base}world.bin.gz`, (f) => this.loading.set('Loading Back Bay', 0.05 + f * 0.25)),
      initRapier(),
    ]);
    this.world = world;

    this.loading.set('Loading imagery', 0.32);
    const maxAniso = (renderer as unknown as { getMaxAnisotropy?: () => number }).getMaxAnisotropy?.() ?? 8;
    const textures = await loadChunkTextures(world, base, maxAniso, (f) => this.loading.set('Loading imagery', 0.32 + f * 0.18));

    this.loading.set('Lighting the sky', 0.52);
    await nextFrame();
    this.physics = createPhysicsWorld(R);
    this.sky = createSky(this.scene, renderer);
    this.scene.fog = new THREE.Fog(0xc9d4e2, 350, 2600);
    this.scene.add(createWater(world));

    await this.buildTerrain(textures);
    await this.buildRoads();
    await this.buildStatics(textures);
    this.placeFurniture();
    this.physics.addBoundary(world.rect, 30);

    this.loading.set('Starting the car', 0.97);
    this.vehicle = new Vehicle(R, this.physics);
    this.carMesh = createCarMesh(this.vehicle.tuning.wheelRadius);
    this.scene.add(this.carMesh.group);
    for (const w of this.carMesh.wheels) this.scene.add(w);
    this.gameCamera = new GameCamera(this.camera, this.canvas);
    this.streets = new StreetIndex(world);
    this.minimap = new Minimap(world);
    this.installHooks();
    this.devTools = new DevTools({
      scene: this.scene,
      renderer,
      physics: this.physics,
      vehicle: this.vehicle,
      sky: this.sky,
      camera: this.gameCamera,
      diagnostics: this.diagnostics,
    });

    const params = new URLSearchParams(window.location.search);
    this.teleportTo(params.get('spawn') ?? DEFAULT_SPAWN);
    this.syncCarTransform();
    this.prevPos.copy(this.curPos);
    this.prevQuat.copy(this.curQuat);

    this.loading.set('Filling the streets', 0.98);
    await nextFrame();
    const parkedOccupancy = Math.max(0, Math.min(1, Number(params.get('parked') ?? 0.5)));
    const parked = placeParkedCars(world, this.physics, R, 11, parkedOccupancy);
    for (const mesh of parked.meshes) this.scene.add(mesh);
    const trafficCount = Math.max(0, Math.min(400, Number(params.get('traffic') ?? TRAFFIC_CARS) || 0));
    if (trafficCount > 0) {
      this.traffic = new Traffic(world, this.physics, R, trafficCount, { x: this.curPos.x, z: this.curPos.z });
      this.scene.add(this.traffic.mesh);
      this.diagnostics.traffic.cars = this.traffic.count;
    }
    this.diagnostics.traffic.parked = parked.count;

    // Ambient occlusion needs the WebGPU path's multiple render targets; `?ao=0` turns it off.
    if (backend === 'webgpu' && params.get('ao') !== '0') this.post = createPostStack(renderer, this.scene, this.camera);
    this.loading.set('Ready', 1);
    this.loading.hide();
    window.setTimeout(() => this.hud.fadeHint(), 14000);
    this.diagnostics.ready = true;
    this.loop.start();
  }

  private async buildTerrain(textures: ChunkTextures[]): Promise<void> {
    const { world } = this;
    const total = world.chunksX * world.chunksZ;
    let n = 0;
    for (let cz = 0; cz < world.chunksZ; cz += 1) {
      for (let cx = 0; cx < world.chunksX; cx += 1) {
        const chunk = buildTerrainChunk(world, cx, cz, textures[cz * world.chunksX + cx]);
        this.scene.add(chunk.mesh);
        this.physics.addHeightfield(chunk.samples, chunk.cells, world.chunkM, chunk.minX, chunk.minZ);
        n += 1;
        if (n % 9 === 0) {
          this.loading.set('Laying out the streets', 0.55 + (n / total) * 0.2);
          await nextFrame();
        }
      }
    }
  }

  private async buildRoads(): Promise<void> {
    const { world } = this;
    this.loading.set('Painting the roads', 0.75);
    await nextFrame();
    const material = createRoadMaterial();
    for (const [key, g] of buildRoadGeometry(world)) {
      if (!g.indices.length) continue;
      const mesh = new THREE.Mesh(roadGeometryToThree(g), material);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.name = `roads ${key % world.chunksX},${Math.floor(key / world.chunksX)}`;
      this.scene.add(mesh);
    }
  }

  /** Trees, lamps, signals, signs, benches and hydrants: one instanced mesh per kind, cylinder colliders for trunks and posts. */
  private placeFurniture(): void {
    const furniture = buildFurniture(this.world);
    for (const object of furniture.objects) this.scene.add(object);
    for (const c of furniture.colliders) this.physics.addCylinder(c.x, c.y, c.z, c.radius, c.halfHeight);
  }

  private async buildStatics(textures: ChunkTextures[]): Promise<void> {
    const { world } = this;
    this.loading.set('Raising the buildings', 0.76);
    await nextFrame();
    // Footprints covered by a city model are drawn by the model; every footprint keeps its collider.
    const buildings = buildBuildingGeometry(world, { skipCovered: true });
    const colliders = buildBuildingGeometry(world);
    const models = buildModelGeometry(world);
    const curbs = buildCurbGeometry(world);
    const curbMaterial = createCurbMaterial();
    const bridges = buildBridgeGeometry(world);
    const bridgeMaterial = createBridgeMaterial();
    const total = world.chunksX * world.chunksZ;
    let n = 0;
    for (let cz = 0; cz < world.chunksZ; cz += 1) {
      for (let cx = 0; cx < world.chunksX; cx += 1) {
        const key = cz * world.chunksX + cx;
        const minX = world.rect.minX + cx * world.chunkM;
        const minZ = world.rect.minZ + cz * world.chunkM;
        const statics: StaticGeometry[] = [];
        let facade: THREE.MeshStandardNodeMaterial | null = null;
        const facadeMaterial = () => (facade ??= createFacadeMaterial(textures[key], minX, minZ, world.chunkM));
        const b = buildings.get(key);
        if (b && b.indices.length) {
          const mesh = new THREE.Mesh(buildingGeometryToThree(b), facadeMaterial());
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.matrixAutoUpdate = false;
          mesh.name = `buildings ${cx},${cz}`;
          this.scene.add(mesh);
        }
        const m = models.get(key);
        if (m && m.indexCount) {
          const mesh = new THREE.Mesh(buildingGeometryToThree(m), facadeMaterial());
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.matrixAutoUpdate = false;
          mesh.name = `models ${cx},${cz}`;
          this.scene.add(mesh);
        }
        const col = colliders.get(key);
        if (col && col.indices.length) statics.push(col);
        const c = curbs.get(key);
        if (c && c.indices.length) {
          const mesh = new THREE.Mesh(geometryFromStatic(c), curbMaterial);
          mesh.castShadow = false;
          mesh.receiveShadow = true;
          mesh.matrixAutoUpdate = false;
          mesh.name = `curbs ${cx},${cz}`;
          this.scene.add(mesh);
          statics.push(c);
        }
        const br = bridges.get(key);
        if (br && br.indices.length) {
          const mesh = new THREE.Mesh(geometryFromStatic(br), bridgeMaterial);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.matrixAutoUpdate = false;
          mesh.name = `bridges ${cx},${cz}`;
          this.scene.add(mesh);
          statics.push(br);
        }
        if (statics.length) {
          const vertexCount = statics.reduce((s, g) => s + g.positions.length / 3, 0);
          const indexCount = statics.reduce((s, g) => s + g.indices.length, 0);
          const vertices = new Float32Array(vertexCount * 3);
          const indices = new Uint32Array(indexCount);
          let vo = 0;
          let io = 0;
          for (const g of statics) {
            vertices.set(g.positions, vo * 3);
            for (let i = 0; i < g.indices.length; i += 1) indices[io + i] = g.indices[i] + vo;
            vo += g.positions.length / 3;
            io += g.indices.length;
          }
          this.physics.addTrimesh(vertices, indices);
        }
        n += 1;
        if (n % 9 === 0) {
          this.loading.set('Raising the buildings', 0.76 + (n / total) * 0.2);
          await nextFrame();
        }
      }
    }
  }

  private installHooks(): void {
    window.__DRIVE_BOSTON_HOOKS__ = {
      teleport: (x, z, headingDeg = 0) => {
        this.traffic?.clearAround(x, z, 30);
        this.skipImpact = 10;
        this.vehicle.teleport(x, this.world.heightAt(x, z) + 1.2, z, headingDeg);
      },
      teleportTo: (name) => this.teleportTo(name),
      setCamera: (mode) => this.gameCamera.setMode(mode as CameraMode),
      listSpawns: () => this.world.spawns.map((s) => s.name),
      setIntent: (intent) => {
        this.scriptedIntent = intent ? { throttle: intent.throttle, steer: intent.steer, handbrake: intent.handbrake ?? false, boost: intent.boost ?? false } : null;
      },
      resetToRoad: () => this.resetToRoad(),
      trafficPoses: () => this.traffic?.poses() ?? [],
      groundClassAt: (x, z) => this.world.classAt(x, z),
      pick: (nx, ny) => {
        const ray = new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2(nx, ny), this.gameCamera.camera);
        return ray
          .intersectObjects(this.scene.children, true)
          .slice(0, 4)
          .map((h) => ({ name: h.object.name, distance: h.distance, point: [h.point.x, h.point.y, h.point.z] as [number, number, number], faceIndex: h.faceIndex ?? -1 }));
      },
    };
  }

  private teleportTo(name: string): void {
    const needle = name.toLowerCase();
    const spawn = this.world.spawns.find((s) => s.name.toLowerCase() === needle) ?? this.world.spawns.find((s) => s.name.toLowerCase().includes(needle)) ?? this.world.spawns[0];
    if (!spawn) return;
    this.traffic?.clearAround(spawn.x, spawn.z, 30);
    this.skipImpact = 10;
    this.vehicle.teleport(spawn.x, spawn.y + 1.2, spawn.z, spawn.headingDeg);
  }

  private resetToRoad(): void {
    const p = this.vehicle.position;
    const pose = this.streets.nearestRoadPose(p.x, p.z, this.vehicle.headingDeg);
    if (!pose) return;
    this.traffic?.clearAround(pose.x, pose.z, 12);
    this.skipImpact = 10;
    this.vehicle.teleport(pose.x, pose.y + 1.2, pose.z, pose.headingDeg);
  }

  private syncCarTransform(): void {
    const p = this.vehicle.body.translation();
    const q = this.vehicle.body.rotation();
    this.curPos.set(p.x, p.y, p.z);
    this.curQuat.set(q.x, q.y, q.z, q.w);
  }

  private fixedUpdate(dt: number): void {
    this.prevPos.copy(this.curPos);
    this.prevQuat.copy(this.curQuat);
    const intent = this.scriptedIntent ?? this.input.driveIntent();
    this.vehicle.update(dt, intent);
    this.throttleNow = intent.throttle;
    this.steerNow = intent.steer;
    this.handbrakeNow = intent.handbrake;
    if (this.traffic) {
      this.forward.set(1, 0, 0).applyQuaternion(this.curQuat);
      const flat = Math.hypot(this.forward.x, this.forward.z) || 1;
      this.playerState.x = this.curPos.x;
      this.playerState.z = this.curPos.z;
      this.playerState.dx = this.forward.x / flat;
      this.playerState.dz = this.forward.z / flat;
      this.traffic.fixedUpdate(dt, this.playerState);
    }
    this.physics.step(dt);
    this.traffic?.afterStep();
    this.syncCarTransform();
    const v = this.vehicle.body.linvel();
    const dv = Math.hypot(v.x - this.prevVel.x, v.y - this.prevVel.y, v.z - this.prevVel.z);
    this.prevVel.set(v.x, v.y, v.z);
    if (this.skipImpact > 0) this.skipImpact -= 1;
    else if (dv > 2.5) this.audio.impact(dv);
    this.right.set(0, 0, 1).applyQuaternion(this.curQuat);
    this.slip = Math.abs(v.x * this.right.x + v.z * this.right.z);
  }

  private frame(dt: number, alpha: number): void {
    if (this.input.consume('KeyR')) this.resetToRoad();
    if (this.input.consume('KeyV')) this.gameCamera.cycle();
    if (this.input.consume('KeyM')) this.audio.toggleMute();
    if (this.input.consume('KeyN')) this.audio.horn();
    if (this.input.consume('KeyH')) {
      this.hud.toggle();
      this.minimap.toggle();
    }
    if (this.input.consume('Backquote')) this.devTools?.toggle();
    this.input.endFrame();

    this.renderPos.lerpVectors(this.prevPos, this.curPos, alpha);
    this.renderQuat.slerpQuaternions(this.prevQuat, this.curQuat, alpha);
    this.carMesh.group.position.copy(this.renderPos);
    this.carMesh.group.quaternion.copy(this.renderQuat);
    for (let i = 0; i < 4; i += 1) {
      this.vehicle.wheelPose(i, this.renderPos, this.renderQuat, this.wheelPos, this.wheelQuat);
      this.carMesh.wheels[i].position.copy(this.wheelPos);
      this.carMesh.wheels[i].quaternion.copy(this.wheelQuat);
    }

    const speed = this.vehicle.speedMps;
    this.audio.update(speed, this.throttleNow, { steer: this.steerNow, handbrake: this.handbrakeNow, slip: this.slip });
    this.gameCamera.update(dt, this.renderPos, this.renderQuat, speed);
    // The driver's eye sits inside the cabin; its glass and roof would otherwise fill the top of the view.
    for (const part of this.carMesh.cabin) part.visible = this.gameCamera.mode !== 'first';
    this.traffic?.frame(alpha);
    this.sky.follow(this.renderPos);
    resizeRenderer(this.renderer, this.camera);
    if (this.post) this.post.render();
    else this.renderer.render(this.scene, this.camera);

    const d = this.diagnostics;
    d.frame = this.loop.frameCount;
    const speedMph = Math.abs(speed) * 2.23694;
    if (d.frame % 6 === 0) {
      this.forward.set(1, 0, 0).applyQuaternion(this.curQuat);
      this.streetLabel = this.streets.describe(this.curPos.x, this.curPos.z, this.forward.x, this.forward.z);
    }
    this.hud.update(speedMph, this.streetLabel.street, this.streetLabel.cross);
    if (d.frame % 2 === 0) this.minimap.update(this.curPos.x, this.curPos.z, this.vehicle.headingDeg, this.traffic?.positions ?? NO_TRAFFIC);
    d.car.x = this.curPos.x;
    d.car.y = this.curPos.y;
    d.car.z = this.curPos.z;
    d.car.speedMph = speedMph;
    d.car.headingDeg = this.vehicle.headingDeg;
    d.car.street = this.streetLabel.street;
    if (d.frame % 30 === 0) {
      d.fps = this.loop.stats();
      d.render.calls = this.renderer.info.render.drawCalls;
      d.render.triangles = this.renderer.info.render.triangles;
      d.physics.bodies = this.physics.world.bodies.len();
      d.physics.colliders = this.physics.world.colliders.len();
      d.physics.stepMs = this.physics.stepMs;
      d.audio.ready = this.audio.ready;
      d.audio.muted = this.audio.muted;
      d.audio.context = this.audio.contextState;
      d.audio.loaded = this.audio.loaded;
      d.audio.failed = this.audio.failedCount;
    }
    if (d.frame % 10 === 0) this.devTools?.update(d.fps, `street ${this.streetLabel.street} ${this.streetLabel.cross ? '& ' + this.streetLabel.cross : ''}\ncamera ${this.gameCamera.mode}  heading ${this.vehicle.headingDeg.toFixed(0)}`);
  }
}
