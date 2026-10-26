import { describe, expect, it } from 'vitest';
import { lonLatToLocal, localToLonLat, boxToLocalRect } from '../../tools/lib/frame.ts';
import { FRAME } from '../../src/shared/frame.ts';

describe('world frame', () => {
  it('puts the origin at zero and x east, z south', () => {
    const [x0, z0] = lonLatToLocal(FRAME.originLon, FRAME.originLat);
    expect(Math.abs(x0)).toBeLessThan(1e-6);
    expect(Math.abs(z0)).toBeLessThan(1e-6);
    const [xe] = lonLatToLocal(FRAME.originLon + 0.01, FRAME.originLat);
    const [, zn] = lonLatToLocal(FRAME.originLon, FRAME.originLat + 0.01);
    expect(xe).toBeGreaterThan(800); // 0.01 degrees of longitude is about 822 m here
    expect(xe).toBeLessThan(840);
    expect(zn).toBeLessThan(-1100); // north is negative z
    expect(zn).toBeGreaterThan(-1120);
  });

  it('inverts', () => {
    const [x, z] = lonLatToLocal(-71.08, 42.35);
    const [lon, lat] = localToLonLat(x, z);
    expect(lon).toBeCloseTo(-71.08, 9);
    expect(lat).toBeCloseTo(42.35, 9);
  });

  it('snaps the box rectangle to chunks', () => {
    const rect = boxToLocalRect({ name: 't', south: 42.344, north: 42.357, west: -71.092, east: -71.068 }, 64, 256);
    expect((rect.maxX - rect.minX) % 256).toBe(0);
    expect((rect.maxZ - rect.minZ) % 256).toBe(0);
    expect(rect.maxX - rect.minX).toBeGreaterThan(2000);
  });
});
