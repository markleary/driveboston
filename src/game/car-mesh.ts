import * as THREE from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CHASSIS } from '../physics/vehicle.ts';

export interface CarMesh {
  group: THREE.Group;
  wheels: THREE.Object3D[];
  /** Glass and roof, hidden in the driver's-seat view so the eye is not inside them. */
  cabin: THREE.Object3D[];
}

/** A generic sedan built from primitives, nose along +x, in chassis coordinates (centre 0.83 m above the ground at rest). */
export function createCarMesh(wheelRadius: number): CarMesh {
  const group = new THREE.Group();
  const paint = new THREE.MeshPhysicalNodeMaterial({ color: 0x8c1d2c, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 });
  const dark = new THREE.MeshStandardNodeMaterial({ color: 0x1a1b1d, roughness: 0.7, metalness: 0.1 });
  const glass = new THREE.MeshPhysicalNodeMaterial({ color: 0x0d1319, metalness: 0.6, roughness: 0.08, clearcoat: 1 });
  const chrome = new THREE.MeshStandardNodeMaterial({ color: 0xc9ccd1, roughness: 0.25, metalness: 0.95 });
  const rubber = new THREE.MeshStandardNodeMaterial({ color: 0x141414, roughness: 0.95 });
  const headlight = new THREE.MeshStandardNodeMaterial({ color: 0xf5f7ff, emissive: 0xdde6ff, emissiveIntensity: 0.6, roughness: 0.2 });
  const taillight = new THREE.MeshStandardNodeMaterial({ color: 0xb01020, emissive: 0xa00f1a, emissiveIntensity: 0.5, roughness: 0.3 });

  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    group.add(mesh);
    return mesh;
  };

  const length = CHASSIS.hx * 2 + 0.1;
  const width = CHASSIS.hz * 2 - 0.14;
  // Lower body and the dark underbody between the wheels.
  add(new RoundedBoxGeometry(length, 0.52, width, 3, 0.14), paint, 0, -0.2, 0);
  add(new RoundedBoxGeometry(length - 0.5, 0.16, width - 0.1, 2, 0.05), dark, 0, -0.5, 0);
  // Hood and trunk.
  add(new RoundedBoxGeometry(1.4, 0.14, width - 0.3, 2, 0.05), paint, 1.35, 0.08, 0);
  add(new RoundedBoxGeometry(1.1, 0.12, width - 0.3, 2, 0.05), paint, -1.55, 0.07, 0);
  // Cabin glass and painted roof.
  const cabin = [
    add(new RoundedBoxGeometry(2.25, 0.56, width - 0.3, 3, 0.2), glass, -0.2, 0.36, 0),
    add(new RoundedBoxGeometry(1.75, 0.06, width - 0.44, 2, 0.02), paint, -0.25, 0.65, 0),
  ];
  // Lights and mirrors.
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(0.08, 0.14, 0.42), headlight, length / 2 - 0.02, -0.1, side * (width / 2 - 0.3));
    add(new THREE.BoxGeometry(0.06, 0.12, 0.5), taillight, -length / 2 + 0.02, -0.08, side * (width / 2 - 0.32));
    add(new THREE.BoxGeometry(0.16, 0.1, 0.22), dark, 0.75, 0.25, side * (width / 2 + 0.1));
  }
  // Grille.
  add(new THREE.BoxGeometry(0.04, 0.16, 0.9), chrome, length / 2, -0.14, 0);

  const wheels: THREE.Object3D[] = [];
  const tyreGeometry = new THREE.CylinderGeometry(wheelRadius, wheelRadius, 0.24, 28);
  tyreGeometry.rotateX(Math.PI / 2);
  const rimGeometry = new THREE.CylinderGeometry(wheelRadius * 0.62, wheelRadius * 0.62, 0.25, 20);
  rimGeometry.rotateX(Math.PI / 2);
  const hubGeometry = new THREE.CylinderGeometry(wheelRadius * 0.18, wheelRadius * 0.18, 0.27, 12);
  hubGeometry.rotateX(Math.PI / 2);
  for (let i = 0; i < 4; i += 1) {
    const wheel = new THREE.Group();
    const tyre = new THREE.Mesh(tyreGeometry, rubber);
    tyre.castShadow = true;
    const rim = new THREE.Mesh(rimGeometry, chrome);
    const hub = new THREE.Mesh(hubGeometry, dark);
    wheel.add(tyre, rim, hub);
    wheels.push(wheel);
  }
  return { group, wheels, cabin };
}
