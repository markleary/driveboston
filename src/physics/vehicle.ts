import type { Collider, DynamicRayCastVehicleController, RigidBody } from '@dimforge/rapier3d-compat';
import * as THREE from 'three/webgpu';
import type { DriveIntent } from '../core/input.ts';
import { COLLISION, type PhysicsWorld, type Rapier } from './physics.ts';

/**
 * Everything the tuning panel can change at runtime. Engine force is in newtons;
 * the brake values are Rapier's per-step impulse caps (about 50 stops a 1.45 t car
 * at 9 m/s^2); lengths are metres.
 */
export interface VehicleTuning {
  mass: number;
  engineForce: number;
  boostFactor: number;
  brakeForce: number;
  handbrakeForce: number;
  coastBrake: number;
  topSpeedMps: number;
  boostTopSpeedMps: number;
  reverseTopSpeedMps: number;
  maxSteerRad: number;
  steerFalloffMps: number;
  steerRate: number;
  steerReturnRate: number;
  suspensionStiffness: number;
  suspensionCompression: number;
  suspensionRelaxation: number;
  suspensionRest: number;
  suspensionTravel: number;
  maxSuspensionForce: number;
  frictionSlip: number;
  handbrakeSlip: number;
  sideFriction: number;
  wheelRadius: number;
  linearDamping: number;
  angularDamping: number;
}

export const DEFAULT_TUNING: VehicleTuning = {
  mass: 1450,
  engineForce: 3800,
  boostFactor: 1.8,
  brakeForce: 55,
  handbrakeForce: 90,
  coastBrake: 3,
  topSpeedMps: 44,
  boostTopSpeedMps: 60,
  reverseTopSpeedMps: 10,
  maxSteerRad: 0.58,
  steerFalloffMps: 14,
  steerRate: 2.8,
  steerReturnRate: 4.5,
  suspensionStiffness: 34,
  suspensionCompression: 4.2,
  suspensionRelaxation: 5.6,
  suspensionRest: 0.34,
  suspensionTravel: 0.22,
  maxSuspensionForce: 30000,
  frictionSlip: 9,
  handbrakeSlip: 2.2,
  sideFriction: 1,
  wheelRadius: 0.33,
  linearDamping: 0.06,
  angularDamping: 0.9,
};

/** Chassis half extents: the car points along +x, +z is its right side. */
export const CHASSIS = { hx: 2.2, hy: 0.3, hz: 0.9 } as const;
/** Wheel connection points in chassis coordinates: front-left, front-right, rear-left, rear-right. */
export const WHEEL_POINTS: ReadonlyArray<readonly [number, number, number]> = [
  [1.38, -0.12, -0.8],
  [1.38, -0.12, 0.8],
  [-1.38, -0.12, -0.8],
  [-1.38, -0.12, 0.8],
];

const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);

export class Vehicle {
  readonly body: RigidBody;
  readonly collider: Collider;
  readonly controller: DynamicRayCastVehicleController;
  readonly tuning: VehicleTuning;
  steering = 0;
  private flippedFor = 0;
  private readonly R: Rapier;
  private readonly physics: PhysicsWorld;

  constructor(R: Rapier, physics: PhysicsWorld, tuning: VehicleTuning = { ...DEFAULT_TUNING }) {
    this.R = R;
    this.physics = physics;
    this.tuning = tuning;
    const bodyDesc = R.RigidBodyDesc.dynamic().setTranslation(0, 5, 0).setCcdEnabled(true);
    this.body = physics.world.createRigidBody(bodyDesc);
    const { hx, hy, hz } = CHASSIS;
    const m = tuning.mass;
    const inertia = { x: (m / 3) * (hy * hy + hz * hz) * 1.3, y: (m / 3) * (hx * hx + hz * hz) * 1.3, z: (m / 3) * (hx * hx + hy * hy) * 1.3 };
    const colliderDesc = R.ColliderDesc.cuboid(hx, hy, hz)
      .setCollisionGroups(COLLISION.player)
      .setMassProperties(m, { x: 0, y: -0.32, z: 0 }, inertia, { w: 1, x: 0, y: 0, z: 0 })
      .setFriction(0.5)
      .setRestitution(0.05);
    this.collider = physics.world.createCollider(colliderDesc, this.body);
    this.controller = physics.world.createVehicleController(this.body);
    for (const [x, y, z] of WHEEL_POINTS) {
      this.controller.addWheel({ x, y, z }, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }, tuning.suspensionRest, tuning.wheelRadius);
    }
    this.applyTuning();
  }

  applyTuning(): void {
    const t = this.tuning;
    this.body.setLinearDamping(t.linearDamping);
    this.body.setAngularDamping(t.angularDamping);
    for (let i = 0; i < 4; i += 1) {
      this.controller.setWheelSuspensionStiffness(i, t.suspensionStiffness);
      this.controller.setWheelSuspensionCompression(i, t.suspensionCompression);
      this.controller.setWheelSuspensionRelaxation(i, t.suspensionRelaxation);
      this.controller.setWheelSuspensionRestLength(i, t.suspensionRest);
      this.controller.setWheelMaxSuspensionTravel(i, t.suspensionTravel);
      this.controller.setWheelMaxSuspensionForce(i, t.maxSuspensionForce);
      this.controller.setWheelFrictionSlip(i, t.frictionSlip);
      this.controller.setWheelSideFrictionStiffness(i, t.sideFriction);
      this.controller.setWheelRadius(i, t.wheelRadius);
    }
  }

  /** Signed speed along the car's forward axis in m/s. */
  get speedMps(): number {
    return this.controller.currentVehicleSpeed();
  }

  get position(): THREE.Vector3 {
    const p = this.body.translation();
    return new THREE.Vector3(p.x, p.y, p.z);
  }

  get quaternion(): THREE.Quaternion {
    const q = this.body.rotation();
    return new THREE.Quaternion(q.x, q.y, q.z, q.w);
  }

  /** World-space forward unit vector (+x in chassis space). */
  forward(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(1, 0, 0).applyQuaternion(this.quaternion);
  }

  get upY(): number {
    return tmpV.set(0, 1, 0).applyQuaternion(this.quaternion).y;
  }

  /** Compass heading in degrees (north 0, east 90). */
  get headingDeg(): number {
    const f = this.forward(tmpV);
    return ((Math.atan2(f.x, -f.z) * 180) / Math.PI + 360) % 360;
  }

  /** Call once per fixed step before the physics world steps. */
  update(dt: number, intent: DriveIntent): void {
    const t = this.tuning;
    const c = this.controller;
    const speed = c.currentVehicleSpeed();

    const maxSteer = t.maxSteerRad / (1 + Math.abs(speed) / t.steerFalloffMps);
    // Positive steering turns the wheels toward -z, the car's left.
    const target = -intent.steer * maxSteer;
    const rate = intent.steer === 0 ? t.steerReturnRate : t.steerRate;
    const delta = target - this.steering;
    this.steering += Math.sign(delta) * Math.min(Math.abs(delta), rate * dt);
    c.setWheelSteering(0, this.steering);
    c.setWheelSteering(1, this.steering);

    let engine = 0;
    let brake = 0;
    if (intent.throttle > 0) {
      if (speed < -0.5) brake = t.brakeForce;
      else {
        const top = intent.boost ? t.boostTopSpeedMps : t.topSpeedMps;
        const headroom = Math.max(0, 1 - Math.max(0, speed) / top);
        engine = t.engineForce * (intent.boost ? t.boostFactor : 1) * Math.sqrt(headroom);
      }
    } else if (intent.throttle < 0) {
      if (speed > 0.5) brake = t.brakeForce;
      else engine = -t.engineForce * 0.55 * Math.max(0, 1 - Math.max(0, -speed) / t.reverseTopSpeedMps);
    } else {
      brake = t.coastBrake;
    }
    for (let i = 0; i < 4; i += 1) {
      c.setWheelEngineForce(i, engine * 0.5);
      c.setWheelBrake(i, brake);
    }
    if (intent.handbrake) {
      // The brake only acts on a wheel with no engine force, so the rear wheels coast while locked.
      c.setWheelEngineForce(2, 0);
      c.setWheelEngineForce(3, 0);
      c.setWheelBrake(2, t.handbrakeForce);
      c.setWheelBrake(3, t.handbrakeForce);
      c.setWheelFrictionSlip(2, t.handbrakeSlip);
      c.setWheelFrictionSlip(3, t.handbrakeSlip);
    } else {
      c.setWheelFrictionSlip(2, t.frictionSlip);
      c.setWheelFrictionSlip(3, t.frictionSlip);
    }
    c.updateVehicle(dt, undefined, undefined, (collider) => collider.handle !== this.collider.handle);

    // Roll back onto the wheels after lying on the roof for a couple of seconds.
    if (this.upY < 0.15) this.flippedFor += dt;
    else this.flippedFor = 0;
    if (this.flippedFor > 2.5) {
      const p = this.body.translation();
      this.teleport(p.x, p.y + 1.0, p.z, this.headingDeg);
      this.flippedFor = 0;
    }
  }

  teleport(x: number, y: number, z: number, headingDeg: number): void {
    const yaw = Math.PI / 2 - (headingDeg * Math.PI) / 180;
    tmpQ.setFromAxisAngle(AXIS_Y, yaw);
    this.body.setTranslation({ x, y, z }, true);
    this.body.setRotation({ x: tmpQ.x, y: tmpQ.y, z: tmpQ.z, w: tmpQ.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steering = 0;
    void this.R;
    void this.physics;
  }

  /** World transform of wheel i for the visual wheel: suspension travel, steering and spin applied. */
  wheelPose(i: number, bodyPos: THREE.Vector3, bodyQuat: THREE.Quaternion, outPos: THREE.Vector3, outQuat: THREE.Quaternion): void {
    const c = this.controller;
    const [px, py, pz] = WHEEL_POINTS[i];
    const travel = c.wheelSuspensionLength(i) ?? this.tuning.suspensionRest;
    outPos.set(px, py - travel, pz).applyQuaternion(bodyQuat).add(bodyPos);
    tmpQ.setFromAxisAngle(AXIS_Y, c.wheelSteering(i) ?? 0);
    tmpQ2.setFromAxisAngle(AXIS_Z, -(c.wheelRotation(i) ?? 0));
    outQuat.copy(bodyQuat).multiply(tmpQ).multiply(tmpQ2);
  }
}
