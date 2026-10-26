import GUI from 'lil-gui';
import * as THREE from 'three/webgpu';
import type { PhysicsWorld } from '../physics/physics.ts';
import type { Vehicle } from '../physics/vehicle.ts';
import type { SkyRig } from '../world/sky.ts';
import type { GameCamera } from './camera.ts';
import type { Diagnostics } from '../core/diagnostics.ts';

export interface DevToolsDeps {
  scene: THREE.Scene;
  renderer: THREE.WebGPURenderer;
  physics: PhysicsWorld;
  vehicle: Vehicle;
  sky: SkyRig;
  camera: GameCamera;
  diagnostics: Diagnostics;
}

/** Frame-time overlay, collider wireframes and a lil-gui tuning panel; hidden unless `?dev` or the backquote key. */
export class DevTools {
  private readonly overlay: HTMLDivElement;
  private readonly gui: GUI;
  private readonly deps: DevToolsDeps;
  private debugLines?: THREE.LineSegments;
  private readonly settings = { colliders: false, shadows: true, sunElevation: 42, sunAzimuth: 205, exposure: 1.0 };
  visible = false;

  constructor(deps: DevToolsDeps) {
    this.deps = deps;
    this.overlay = document.createElement('div');
    this.overlay.id = 'dev-overlay';
    Object.assign(this.overlay.style, {
      position: 'fixed',
      left: '12px',
      top: '12px',
      padding: '8px 10px',
      font: '12px/1.4 ui-monospace, Menlo, monospace',
      color: '#dfe6ee',
      background: 'rgba(12, 14, 20, 0.72)',
      borderRadius: '6px',
      whiteSpace: 'pre',
      pointerEvents: 'none',
      zIndex: '20',
      display: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(this.overlay);

    this.gui = new GUI({ title: 'Drive Boston dev', width: 300 });
    this.gui.hide();
    const t = deps.vehicle.tuning;
    const car = this.gui.addFolder('Car');
    const apply = (): void => deps.vehicle.applyTuning();
    car.add(t, 'engineForce', 1000, 9000, 100);
    car.add(t, 'boostFactor', 1, 3, 0.1);
    car.add(t, 'brakeForce', 5, 150, 1);
    car.add(t, 'handbrakeForce', 5, 200, 1);
    car.add(t, 'coastBrake', 0, 15, 0.5);
    car.add(t, 'topSpeedMps', 15, 80, 1);
    car.add(t, 'maxSteerRad', 0.2, 0.9, 0.01);
    car.add(t, 'steerFalloffMps', 4, 40, 1);
    car.add(t, 'suspensionStiffness', 5, 80, 1).onChange(apply);
    car.add(t, 'suspensionCompression', 0.5, 12, 0.1).onChange(apply);
    car.add(t, 'suspensionRelaxation', 0.5, 12, 0.1).onChange(apply);
    car.add(t, 'suspensionRest', 0.15, 0.6, 0.01).onChange(apply);
    car.add(t, 'frictionSlip', 1, 20, 0.1).onChange(apply);
    car.add(t, 'handbrakeSlip', 0.5, 10, 0.1);
    car.add(t, 'linearDamping', 0, 0.5, 0.01).onChange(apply);
    car.add(t, 'angularDamping', 0, 4, 0.05).onChange(apply);
    const cam = this.gui.addFolder('Camera');
    cam.add(deps.camera, 'distance', 4, 24, 0.1);
    cam.add(deps.camera, 'height', 0.5, 10, 0.1);
    const light = this.gui.addFolder('Light');
    light.add(this.settings, 'sunElevation', 5, 85, 1).onChange(() => deps.sky.setSun(this.settings.sunElevation, this.settings.sunAzimuth));
    light.add(this.settings, 'sunAzimuth', 0, 360, 1).onChange(() => deps.sky.setSun(this.settings.sunElevation, this.settings.sunAzimuth));
    light.add(this.settings, 'exposure', 0.3, 2.5, 0.05).onChange((v: number) => (deps.renderer.toneMappingExposure = v));
    light.add(this.settings, 'shadows').onChange((v: boolean) => (deps.sky.sun.castShadow = v));
    const dbg = this.gui.addFolder('Debug');
    dbg.add(this.settings, 'colliders').onChange((v: boolean) => this.setColliderWireframe(v));

    if (new URLSearchParams(window.location.search).has('dev')) this.toggle(true);
  }

  toggle(force?: boolean): void {
    this.visible = force ?? !this.visible;
    this.overlay.style.display = this.visible ? 'block' : 'none';
    if (this.visible) this.gui.show();
    else this.gui.hide();
  }

  private setColliderWireframe(on: boolean): void {
    if (this.debugLines) {
      this.deps.scene.remove(this.debugLines);
      this.debugLines.geometry.dispose();
      this.debugLines = undefined;
    }
    if (!on) return;
    const geometry = new THREE.BufferGeometry();
    const material = new THREE.LineBasicNodeMaterial({ vertexColors: true });
    this.debugLines = new THREE.LineSegments(geometry, material);
    this.debugLines.frustumCulled = false;
    this.deps.scene.add(this.debugLines);
  }

  update(frameTime: { median: number; p95: number }, extra: string): void {
    if (!this.visible) return;
    const d = this.deps.diagnostics;
    const info = this.deps.renderer.info.render;
    const w = this.deps.physics.world;
    this.overlay.textContent =
      `${d.backend}  frame ${frameTime.median.toFixed(1)} ms (p95 ${frameTime.p95.toFixed(1)})\n` +
      `draw calls ${info.drawCalls}  triangles ${(info.triangles / 1e6).toFixed(2)} M\n` +
      `bodies ${w.bodies.len()}  colliders ${w.colliders.len()}  step ${this.deps.physics.stepMs.toFixed(2)} ms\n` +
      `car ${d.car.x.toFixed(1)}, ${d.car.y.toFixed(2)}, ${d.car.z.toFixed(1)}  ${d.car.speedMph.toFixed(0)} mph\n` +
      extra;
    if (this.debugLines) {
      const buffers = w.debugRender();
      this.debugLines.geometry.setAttribute('position', new THREE.BufferAttribute(buffers.vertices, 3));
      this.debugLines.geometry.setAttribute('color', new THREE.BufferAttribute(buffers.colors, 4));
    }
  }
}
