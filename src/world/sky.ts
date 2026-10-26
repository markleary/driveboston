import * as THREE from 'three/webgpu';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';

export interface SkyRig {
  sky: SkyMesh;
  sun: THREE.DirectionalLight;
  sunDirection: THREE.Vector3;
  hemi: THREE.HemisphereLight;
  /** Re-aims the sun and its shadow box at a world position. */
  follow(target: THREE.Vector3): void;
  setSun(elevationDeg: number, azimuthDeg: number): void;
}

/**
 * One daytime sky: a physical sky dome, a shadow-casting sun that follows the
 * car, and the dome baked into the scene's environment so paint and glass
 * reflect it.
 */
export function createSky(scene: THREE.Scene, renderer: THREE.WebGPURenderer, elevationDeg = 42, azimuthDeg = 205): SkyRig {
  const sky = new SkyMesh();
  sky.scale.setScalar(6000);
  sky.turbidity.value = 2.6;
  sky.rayleigh.value = 1.8;
  sky.mieCoefficient.value = 0.004;
  sky.mieDirectionalG.value = 0.8;
  (sky.material as THREE.Material & { fog?: boolean }).fog = false;
  scene.add(sky);

  const sun = new THREE.DirectionalLight(0xfff1dc, 2.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const half = 110;
  sun.shadow.camera.left = -half;
  sun.shadow.camera.right = half;
  sun.shadow.camera.top = half;
  sun.shadow.camera.bottom = -half;
  sun.shadow.camera.near = 50;
  sun.shadow.camera.far = 900;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(0xa9c4e6, 0x55503f, 0.3);
  scene.add(hemi);

  const sunDirection = new THREE.Vector3();
  const setSun = (elevation: number, azimuth: number): void => {
    const phi = THREE.MathUtils.degToRad(elevation);
    const theta = THREE.MathUtils.degToRad(azimuth);
    // Compass azimuth: 0 north (-z), 90 east (+x).
    sunDirection.set(Math.sin(theta) * Math.cos(phi), Math.sin(phi), -Math.cos(theta) * Math.cos(phi));
    sky.sunPosition.value.copy(sunDirection);
    sun.position.copy(sunDirection).multiplyScalar(400).add(sun.target.position);
  };
  setSun(elevationDeg, azimuthDeg);

  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const envSky = new SkyMesh();
    envSky.scale.setScalar(6000);
    envSky.turbidity.value = sky.turbidity.value;
    envSky.rayleigh.value = sky.rayleigh.value;
    // A faint sun halo only: the sun itself lights the scene as a directional light.
    envSky.mieCoefficient.value = 0.0008;
    envSky.mieDirectionalG.value = sky.mieDirectionalG.value;
    envSky.sunPosition.value.copy(sunDirection);
    envScene.add(envSky);
    const target = pmrem.fromScene(envScene, 0.02);
    scene.environment = target.texture;
    scene.environmentIntensity = 0.22;
    pmrem.dispose();
  } catch (err) {
    console.warn('sky environment unavailable, lighting with the hemisphere light only', err);
    hemi.intensity = 0.9;
  }

  return {
    sky,
    sun,
    sunDirection,
    hemi,
    follow(target) {
      // Snap the shadow box to 2 m so the shadow edges do not swim as the car moves.
      const sx = Math.round(target.x / 2) * 2;
      const sz = Math.round(target.z / 2) * 2;
      sun.target.position.set(sx, target.y, sz);
      sun.position.copy(sunDirection).multiplyScalar(400).add(sun.target.position);
      sun.target.updateMatrixWorld();
    },
    setSun,
  };
}
