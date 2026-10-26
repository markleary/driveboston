import * as THREE from 'three/webgpu';

export type CameraMode = 'chase' | 'first' | 'aerial';

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Chase camera that trails the car's smoothed heading, with mouse-drag orbit
 * that eases back behind the car, wheel zoom, a driver's-seat view and a high
 * aerial view for screenshots.
 */
export class GameCamera {
  mode: CameraMode = 'chase';
  distance = 7.8;
  height = 2.7;
  private orbitYaw = 0;
  private orbitPitch = 0;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private readonly smoothForward = new THREE.Vector3(1, 0, 0);
  private readonly position = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private initialised = false;
  readonly camera: THREE.PerspectiveCamera;

  constructor(camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    this.camera = camera;
    dom.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    window.addEventListener('pointerup', () => (this.dragging = false));
    window.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.orbitYaw -= (e.clientX - this.lastX) * 0.006;
      this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch + (e.clientY - this.lastY) * 0.004, -0.5, 0.9);
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    dom.addEventListener(
      'wheel',
      (e) => {
        this.distance = THREE.MathUtils.clamp(this.distance * Math.exp(e.deltaY * 0.0012), 4, 24);
        e.preventDefault();
      },
      { passive: false },
    );
  }

  cycle(): CameraMode {
    this.mode = this.mode === 'chase' ? 'first' : this.mode === 'first' ? 'aerial' : 'chase';
    this.initialised = false;
    return this.mode;
  }

  setMode(mode: CameraMode): void {
    this.mode = mode;
    this.initialised = false;
  }

  update(dt: number, carPos: THREE.Vector3, carQuat: THREE.Quaternion, speedMps: number): void {
    const forward = tmpV.set(1, 0, 0).applyQuaternion(carQuat);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) forward.set(1, 0, 0);
    forward.normalize();
    const k = 1 - Math.exp(-dt * (speedMps < -1 ? 1.5 : 5));
    this.smoothForward.lerp(forward, this.initialised ? k : 1).normalize();

    if (this.mode === 'first') {
      const seat = tmpV2.set(0.15, 0.52, -0.38).applyQuaternion(carQuat).add(carPos);
      this.camera.position.copy(seat);
      const look = tmpV.set(12, 0.3, -0.38).applyQuaternion(carQuat).add(carPos);
      this.camera.up.set(0, 1, 0).applyQuaternion(carQuat);
      this.camera.lookAt(look);
      this.initialised = true;
      return;
    }
    this.camera.up.set(0, 1, 0);
    if (this.mode === 'aerial') {
      const desired = tmpV2.copy(carPos).addScaledVector(this.smoothForward, -95).add(tmpV.set(0, 150, 0));
      this.position.lerp(desired, this.initialised ? 1 - Math.exp(-dt * 3) : 1);
      this.camera.position.copy(this.position);
      this.camera.lookAt(carPos.x + this.smoothForward.x * 40, carPos.y, carPos.z + this.smoothForward.z * 40);
      this.initialised = true;
      return;
    }

    // Orbit eases back behind the car while driving.
    if (!this.dragging && Math.abs(speedMps) > 1.5) {
      const decay = Math.exp(-dt * 1.2);
      this.orbitYaw *= decay;
      this.orbitPitch *= decay;
    }
    const dist = this.distance * (1 + Math.min(Math.abs(speedMps), 50) / 50 * 0.35);
    const back = tmpV2.copy(this.smoothForward).multiplyScalar(-1).applyAxisAngle(UP, this.orbitYaw);
    const desired = tmpV.copy(carPos).addScaledVector(back, dist * Math.cos(this.orbitPitch));
    desired.y += this.height + dist * Math.sin(this.orbitPitch);
    this.position.lerp(desired, this.initialised ? 1 - Math.exp(-dt * 9) : 1);
    this.lookTarget.lerp(tmpV2.copy(carPos).addScaledVector(this.smoothForward, 2.5).add(tmpV.set(0, 1.1, 0)), this.initialised ? 1 - Math.exp(-dt * 14) : 1);
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.lookTarget);
    this.initialised = true;
  }
}
