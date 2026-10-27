import { describe, expect, it } from 'vitest';
import { blocksFurniture, nudgeOffRoad, signalPolePose } from '../../tools/furniture.ts';
import { yawFor } from '../../src/shared/furniture.ts';
import { GROUND } from '../../src/shared/roads.ts';

describe('street furniture placement', () => {
  it('moves an item off the roadway onto the nearest open cell or drops it', () => {
    const spec = { originX: 0, originZ: 0, cell: 1, width: 10, height: 10 };
    const mask = new Uint8Array(100).fill(GROUND.road);
    // The column x 8..9 is sidewalk.
    for (let j = 0; j < 10; j += 1) mask[j * 10 + 8] = GROUND.sidewalk;
    expect(nudgeOffRoad(spec, mask, 8.5, 2.5)).toEqual([8.5, 2.5]);
    expect(nudgeOffRoad(spec, mask, 6.2, 2.5)).toEqual([8.5, 2.5]);
    expect(nudgeOffRoad(spec, mask, 1.5, 2.5)).toBeNull();
    expect(blocksFurniture(GROUND.grass)).toBe(false);
    expect(blocksFurniture(GROUND.building)).toBe(true);
  });

  it('points the yaw along a world direction the way three.js rotates about y', () => {
    // A rotation of yaw about y maps local +x to (cos yaw, -sin yaw) in the x, z plane.
    for (const [dx, dz] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0.6, -0.8],
    ]) {
      const yaw = yawFor(dx, dz);
      expect(Math.cos(yaw)).toBeCloseTo(dx, 6);
      expect(-Math.sin(yaw)).toBeCloseTo(dz, 6);
    }
  });

  it('stands the signal pole at the right-hand curb of the approach, facing the traffic', () => {
    // A 10 m wide road enters the node at (100, 50) from the east, so its traffic travels west.
    const pose = signalPolePose([100, 50], [1, 0], 10, 3);
    // Right of westbound traffic is north (negative z); 3 m trim plus 4.8 m to stand beside the stop line.
    expect(pose.x).toBeCloseTo(107.8, 6);
    expect(pose.z).toBeCloseTo(44.1, 6);
    expect(Math.cos(pose.yaw)).toBeCloseTo(1, 6);
  });
});
