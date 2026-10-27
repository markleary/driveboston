import { describe, expect, it } from 'vitest';
import { buildRoadGeometry, END_BIT } from '../../src/world/road-geometry.ts';
import type { RoadLink, WorldData } from '../../src/world/data.ts';

function link(id: number, a: number, b: number, pts: number[][], width: number, name: string, oneway: boolean): RoadLink {
  return {
    id,
    a,
    b,
    name,
    cls: 'residential',
    oneway,
    bridge: false,
    tunnel: false,
    drivable: true,
    width,
    lanes: 2,
    speedMps: 11,
    points: Float32Array.from(pts.flat()),
  };
}

// Main Street runs east through node 1, where Side Street arrives from the north.
const world = {
  rect: { minX: -128, minZ: -128, maxX: 128, maxZ: 128 },
  chunkM: 256,
  chunksX: 1,
  chunksZ: 1,
  links: [
    link(0, 0, 1, [[-60, 0, 0], [0, 0, 0]], 12, 'Main Street', false),
    link(1, 1, 2, [[0, 0, 0], [60, 0, 0]], 12, 'Main Street', false),
    link(2, 3, 1, [[0, 0, -50], [0, 0, 0]], 8, 'Side Street', true),
  ],
  heightAt: () => 0,
} as unknown as WorldData;

describe('road geometry', () => {
  const g = buildRoadGeometry(world).get(0)!;
  const vertices = g.positions.length / 3;
  const find = (pick: (x: number, z: number, across: number) => boolean): number => {
    for (let i = 0; i < vertices; i += 1) if (pick(g.positions[i * 3], g.positions[i * 3 + 2], g.across[i])) return i;
    throw new Error('no such vertex');
  };

  it('puts the right edge on the right of travel', () => {
    const i = find((x, _z, across) => x < -30 && across === 6);
    expect(g.positions[i * 3 + 2]).toBeCloseTo(6);
    // Side Street heads south, so its right edge lies to the west.
    const j = find((_x, z, across) => z < -30 && across === 4);
    expect(g.positions[j * 3]).toBeCloseTo(-4);
  });

  it('trims the through road by the side street and the side street by the through road', () => {
    const main = find((x) => x < -30);
    expect(g.ends[main * 4 + 1]).toBe(0);
    expect(g.ends[main * 4 + 2]).toBe(5);
    expect(g.ends[main * 4 + 3] & END_BIT.crosswalkB).toBeTruthy();
    expect(g.ends[main * 4 + 3] & END_BIT.stopB).toBeFalsy();
    const side = find((_x, z) => z < -30);
    expect(g.ends[side * 4 + 2]).toBe(7);
    expect(g.ends[side * 4 + 3] & END_BIT.crosswalkB).toBeTruthy();
    expect(g.ends[side * 4 + 3] & END_BIT.stopB).toBeTruthy();
    expect(g.ends[side * 4 + 3] & END_BIT.stopA).toBeFalsy();
  });

  it('winds every triangle to face up', () => {
    expect(g.indices.length % 3).toBe(0);
    for (let t = 0; t < g.indices.length; t += 3) {
      const [a, b, c] = [g.indices[t], g.indices[t + 1], g.indices[t + 2]];
      const ux = g.positions[b * 3] - g.positions[a * 3];
      const uz = g.positions[b * 3 + 2] - g.positions[a * 3 + 2];
      const vx = g.positions[c * 3] - g.positions[a * 3];
      const vz = g.positions[c * 3 + 2] - g.positions[a * 3 + 2];
      expect(uz * vx - ux * vz).toBeGreaterThan(0);
    }
  });
});
