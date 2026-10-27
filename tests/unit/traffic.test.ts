import { describe, expect, it } from 'vitest';
import { LinkPath, laneOffset } from '../../src/game/traffic-paths.ts';
import type { RoadLink } from '../../src/world/data.ts';

function link(points: number[], extra: Partial<RoadLink> = {}): RoadLink {
  return {
    id: 0,
    a: 0,
    b: 1,
    name: 'Test Street',
    cls: 'residential',
    oneway: false,
    bridge: false,
    tunnel: false,
    drivable: true,
    width: 11,
    lanes: 2,
    speedMps: 11.2,
    points: new Float32Array(points),
    ...extra,
  };
}

describe('traffic paths', () => {
  it('samples a bent link by distance with a right-hand offset', () => {
    const path = new LinkPath(link([0, 0, 0, 10, 0, 0, 10, 0, 10]));
    expect(path.length).toBeCloseTo(20);
    const out = { x: 0, y: 0, z: 0, dx: 0, dz: 0 };
    path.poseAt(5, 0, out);
    expect([out.x, out.z, out.dx, out.dz]).toEqual([5, 0, 1, 0]);
    // Second leg heads +z (south); its right-hand side is -x.
    path.poseAt(15, 1, out);
    expect(out.x).toBeCloseTo(9);
    expect(out.z).toBeCloseTo(5);
    expect(out.dz).toBeCloseTo(1);
    expect(path.dirInto(true)).toEqual([1, 0]);
    expect(path.dirInto(false)).toEqual([0, -1]);
  });

  it('keeps traffic right of the centreline and out of the parking lane', () => {
    const twoWay = link([0, 0, 0, 100, 0, 0]);
    expect(laneOffset(twoWay, 1, 0)).toBeCloseTo(1.65);
    expect(laneOffset(twoWay, -1, 0)).toBeCloseTo(-1.65);
    const primary = link([0, 0, 0, 100, 0, 0], { cls: 'primary', width: 16, lanes: 4 });
    expect(laneOffset(primary, 1, 0)).toBeCloseTo(1.45);
    expect(laneOffset(primary, 1, 1)).toBeCloseTo(4.35);
    // The outer lane's far edge stays clear of the 2.2 m parking lane (centre 4.35 m plus half a lane).
    expect(laneOffset(primary, 1, 1) + 1.45).toBeLessThanOrEqual(16 / 2 - 2.2 + 1e-9);
    const oneWay = link([0, 0, 0, 100, 0, 0], { oneway: true, width: 10, lanes: 2 });
    expect(laneOffset(oneWay, 1, 0)).toBeCloseTo(-1.4);
    expect(laneOffset(oneWay, 1, 1)).toBeCloseTo(1.4);
  });
});
