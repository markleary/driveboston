import { describe, expect, it } from 'vitest';
import type { GridSpec } from '../../tools/lib/raster.ts';
import { burnHeights, closeCorners, findLevelCrossings, rasteriseCorridors, scanRoadSurface, type BurnLink } from '../../tools/roadburn.ts';

const spec: GridSpec = { originX: 0, originZ: 0, cell: 1, width: 140, height: 80 };
const N = spec.width * spec.height;
const flat = (h: number): Float32Array => new Float32Array(N).fill(h);
const link = (id: number, name: string, pts: [number, number][], elev: number[], width: number): BurnLink => ({ id, name, pts, elev: Float32Array.from(elev), width });
const burn = (dem: Float32Array, links: BurnLink[]) => {
  const field = rasteriseCorridors(spec, links);
  const closed = closeCorners(spec, field, 4);
  const { burned } = burnHeights(dem, 0, () => false, null, closed.finalSdf, field);
  return { field, closed, burned };
};
const at = (burned: Float32Array, x: number, z: number): number => burned[Math.floor(z) * spec.width + Math.floor(x)];

describe('road burn', () => {
  // A 12 m street along x at z = 40, level 10.
  const street = link(1, 'Main Street', [[0, 40], [140, 40]], [10, 10], 12);

  it('keeps a street whole beside a ramp that dives below it', () => {
    // The ramp runs parallel 12 m away, its curb 3.5 m from the street's, dropping 7 m; the lidar already has its trench.
    const dem = flat(10);
    for (let x = 0; x < 140; x += 1) for (let z = 25; z <= 31; z += 1) dem[z * spec.width + x] = 10 - 7 * Math.max(0, Math.min(1, (x - 10) / 120));
    const ramp = link(2, 'Ramp', [[10, 28], [130, 28]], [10, 3], 5);
    const { burned, closed } = burn(dem, [street, ramp]);
    for (let x = 0; x < 140; x += 1) for (let z = 35; z < 46; z += 1) expect(at(burned, x, z)).toBeCloseTo(10, 2);
    const rampLevel = 10 - 7 * ((120.5 - 10) / 120);
    for (let z = 26; z <= 29; z += 1) expect(at(burned, 120, z)).toBeCloseTo(rampLevel, 1);
    // The strip between them is a wall top at the street's level plus a curb, not a slope down to the ramp.
    expect(at(burned, 120, 31)).toBeCloseTo(10.15, 2);
    expect(at(burned, 120, 32)).toBeCloseTo(10.15, 2);
    expect(closed.splitCells).toBeGreaterThan(0);
    const scan = scanRoadSurface(spec, burned, [street, ramp]);
    expect(scan.low).toBe(0);
    expect(scan.worst).toBeNull();
  });

  it('still rounds the corners of a junction between streets at one level', () => {
    const side = link(3, 'Side Street', [[70, 0], [70, 80]], [10, 10], 12);
    const { burned, closed } = burn(flat(8), [street, side]);
    expect(closed.filled).toBeGreaterThan(0);
    expect(closed.splitCells).toBe(0);
    // The cell tucked into the concave corner is road after the closing, and the fillet
    // arc of radius 4 leaves the cell 1.5 m out from both curbs as sidewalk.
    expect(at(burned, 76, 46)).toBeCloseTo(10, 2);
    expect(at(burned, 77, 47)).toBeCloseTo(10.15, 2);
    for (let x = 55; x < 85; x += 1) for (let z = 35; z < 46; z += 1) expect(at(burned, x, z)).toBeCloseTo(10, 2);
    expect(scanRoadSurface(spec, burned, [street, side]).low).toBe(0);
  });

  it('lets the street win where a ramp ends inside its corridor', () => {
    const ramp = link(4, 'Portal Ramp', [[10, 20], [70, 38]], [10, 3], 5);
    const { burned } = burn(flat(10), [street, ramp]);
    for (let x = 0; x < 140; x += 1) for (let z = 35; z < 46; z += 1) expect(at(burned, x, z)).toBeCloseTo(10, 2);
    expect(scanRoadSurface(spec, burned, [street, ramp]).low).toBe(0);
  });

  it('walls off a ramp that hugs the street instead of leaving a cliff at the curb', () => {
    // The ramp's curb is 0.5 m from the street's, so the street's sidewalk strip claims the ramp's near cells.
    const ramp = link(7, 'Hugging Ramp', [[10, 31], [130, 31]], [10, 3], 5);
    const { burned, field } = burn(flat(10), [street, ramp]);
    for (let x = 0; x < 140; x += 1) for (let z = 35; z < 46; z += 1) expect(at(burned, x, z)).toBeCloseTo(10, 2);
    // Deep into the descent the strip within 3 m of the street's curb is wall top, and the ramp's far edge keeps its level.
    for (let z = 31; z < 34; z += 1) expect(at(burned, 120, z)).toBeCloseTo(10.15, 2);
    expect(field.split[32 * spec.width + 120]).toBe(1);
    expect(at(burned, 120, 29)).toBeCloseTo(10 - 7 * ((120.5 - 10) / 120), 1);
    const scan = scanRoadSurface(spec, burned, [street, ramp]);
    expect(scan.low).toBe(0);
    expect(scan.high).toBe(1);
    expect(scan.worstHigh?.name).toBe('Hugging Ramp');
  });

  it('blends two corridors that overlap at nearly one level instead of stepping between them', () => {
    // A second street overlapping the first, 0.6 m higher: inside the overlap the ground moves smoothly between them.
    const other = link(8, 'Upper Lane', [[0, 46], [140, 46]], [10.6, 10.6], 12);
    const { burned } = burn(flat(10), [street, other]);
    let prev = at(burned, 70, 34);
    for (let z = 35; z <= 52; z += 1) {
      const h = at(burned, 70, z);
      expect(Math.abs(h - prev)).toBeLessThan(0.2);
      prev = h;
    }
    expect(at(burned, 70, 35)).toBeCloseTo(10, 1);
    expect(at(burned, 70, 51)).toBeCloseTo(10.6, 1);
  });

  it('reports the pit the old nearest-centreline rule would leave', () => {
    const dem = flat(10);
    for (let x = 60; x < 80; x += 1) for (let z = 36; z < 44; z += 1) dem[z * spec.width + x] = 4;
    const scan = scanRoadSurface(spec, dem, [street]);
    expect(scan.low).toBe(1);
    expect(scan.worst?.drop).toBeCloseTo(6, 1);
    expect(scan.worst?.name).toBe('Main Street');
  });

  it('finds crossings that are really bridges and ignores shared junction nodes', () => {
    const over = link(5, 'Over Street', [[70, 0], [70, 80]], [15, 15], 10);
    const crossings = findLevelCrossings([street, over]);
    expect(crossings).toHaveLength(1);
    expect(crossings[0]).toMatchObject({ upper: 'Over Street', lower: 'Main Street' });
    expect(crossings[0].drop).toBeCloseTo(5, 3);
    expect(crossings[0].x).toBeCloseTo(70, 3);
    const meets = link(6, 'Side Street', [[70, 40], [70, 80]], [10, 10], 10);
    expect(findLevelCrossings([street, meets])).toHaveLength(0);
  });
});
