import * as THREE from 'three/webgpu';
import { createRenderer, resizeRenderer } from '../core/renderer.ts';
import { Loop } from '../core/loop.ts';
import { Input } from '../core/input.ts';
import { createDiagnostics, type Diagnostics } from '../core/diagnostics.ts';
import { LoadingScreen } from '../ui/loading.ts';
import { Hud } from '../ui/hud.ts';

/**
 * Boots the renderer and runs the scene. The proof-of-concept skeleton shows a
 * placeholder scene until the Back Bay world modules replace it.
 */
export class App {
  readonly loading = new LoadingScreen();
  readonly hud = new Hud();
  readonly input = new Input();
  private renderer!: THREE.WebGPURenderer;
  private diagnostics!: Diagnostics;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 5000);
  private readonly loop = new Loop({
    fixedUpdate: (dt) => this.fixedUpdate(dt),
    frame: (dt, alpha) => this.frame(dt, alpha),
  });
  private placeholder?: THREE.Mesh;
  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  async start(): Promise<void> {
    this.loading.set('Starting the renderer', 0.05);
    const { renderer, backend } = await createRenderer(this.canvas);
    this.renderer = renderer;
    this.diagnostics = createDiagnostics(backend);
    this.hud.setBackend(backend === 'webgpu' ? 'WebGPU' : 'WebGL 2');

    this.loading.set('Building the scene', 0.4);
    this.buildPlaceholderScene();

    this.loading.set('Ready', 1);
    this.loading.hide();
    this.diagnostics.ready = true;
    this.loop.start();
  }

  private buildPlaceholderScene(): void {
    this.scene.background = new THREE.Color(0x8fb3d9);
    this.scene.fog = new THREE.Fog(0x8fb3d9, 200, 900);
    const sun = new THREE.DirectionalLight(0xfff2e0, 3.0);
    sun.position.set(120, 180, 60);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -60;
    sun.shadow.camera.right = 60;
    sun.shadow.camera.top = 60;
    sun.shadow.camera.bottom = -60;
    sun.shadow.camera.far = 500;
    this.scene.add(sun);
    this.scene.add(new THREE.HemisphereLight(0xbfd4ee, 0x5a5346, 0.9));

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(2000, 2000),
      new THREE.MeshStandardNodeMaterial({ color: 0x4a4d52, roughness: 0.95 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const box = new THREE.Mesh(
      new THREE.BoxGeometry(4.6, 1.4, 1.9),
      new THREE.MeshStandardNodeMaterial({ color: 0xc8553d, roughness: 0.4, metalness: 0.2 }),
    );
    box.position.y = 1.0;
    box.castShadow = true;
    this.scene.add(box);
    this.placeholder = box;

    this.camera.position.set(0, 4, 10);
    this.camera.lookAt(0, 1, 0);
  }

  private fixedUpdate(dt: number): void {
    if (this.placeholder) this.placeholder.rotation.y += dt * 0.6;
  }

  private frame(_dt: number, _alpha: number): void {
    resizeRenderer(this.renderer, this.camera);
    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
    const d = this.diagnostics;
    d.frame = this.loop.frameCount;
    if (d.frame % 30 === 0) {
      d.fps = this.loop.stats();
      d.render.calls = this.renderer.info.render.drawCalls;
      d.render.triangles = this.renderer.info.render.triangles;
    }
    this.hud.update(0, 'Back Bay', '');
  }
}
