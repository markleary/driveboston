import { describe, expect, it } from 'vitest';
import { distanceTransform, fillPolygon, marchingSquares, sampleBilinear, type GridSpec } from '../../tools/lib/raster.ts';
import { clipPolylineToRect, simplify, polylineLength, samplePolyline } from '../../tools/lib/geom.ts';

describe('raster helpers', () => {
  it('fills a polygon with a hole', () => {
    const spec: GridSpec = { originX: 0, originZ: 0, cell: 1, width: 10, height: 10 };
    const mask = new Uint8Array(100);
    fillPolygon(spec, [[[1, 1], [9, 1], [9, 9], [1, 9]], [[4, 4], [6, 4], [6, 6], [4, 6]]], (k) => (mask[k] = 1));
    expect(mask[5 * 10 + 2]).toBe(1);
    expect(mask[5 * 10 + 5]).toBe(0); // inside the hole
    expect(mask[0]).toBe(0);
    let count = 0;
    for (const v of mask) count += v;
    expect(count).toBe(64 - 4);
  });

  it('computes exact euclidean distances', () => {
    const w = 7;
    const mask = new Uint8Array(w * w);
    mask[3 * w + 3] = 1;
    const d = distanceTransform(mask, w, w);
    expect(d[3 * w + 3]).toBe(0);
    expect(d[3 * w + 0]).toBeCloseTo(3);
    expect(d[0]).toBeCloseTo(Math.hypot(3, 3));
  });

  it('traces a circle with marching squares', () => {
    const w = 41;
    const field = new Float32Array(w * w);
    for (let j = 0; j < w; j += 1) for (let i = 0; i < w; i += 1) field[j * w + i] = Math.hypot(i - 20, j - 20) - 10;
    const lines = marchingSquares(field, w, w, 0);
    expect(lines.length).toBe(1);
    const loop = lines[0];
    expect(loop[0]).toEqual(loop[loop.length - 1]);
    for (const [x, z] of loop) expect(Math.hypot(x - 20, z - 20)).toBeCloseTo(10, 0);
    expect(polylineLength(loop)).toBeCloseTo(2 * Math.PI * 10, -1);
  });

  it('samples bilinearly', () => {
    const spec: GridSpec = { originX: 0, originZ: 0, cell: 2, width: 2, height: 2 };
    const data = new Float32Array([0, 10, 20, 30]);
    expect(sampleBilinear(spec, data, 1, 1)).toBeCloseTo(0);
    expect(sampleBilinear(spec, data, 2, 1)).toBeCloseTo(5);
    expect(sampleBilinear(spec, data, 2, 2)).toBeCloseTo(15);
  });
});

describe('geometry helpers', () => {
  it('simplifies and samples polylines', () => {
    const pts: [number, number][] = [[0, 0], [5, 0.01], [10, 0], [10, 10]];
    expect(simplify(pts, 0.1)).toEqual([[0, 0], [10, 0], [10, 10]]);
    const samples = samplePolyline([[0, 0], [10, 0]], 2);
    expect(samples.length).toBe(6);
    expect(samples[3].x).toBeCloseTo(6);
    expect(samples[3].hx).toBe(1);
  });

  it('clips polylines to a rectangle', () => {
    const r = { minX: 0, minZ: 0, maxX: 10, maxZ: 10 };
    const pieces = clipPolylineToRect([[-5, 5], [5, 5], [15, 5], [15, 8], [5, 8]], r);
    expect(pieces.length).toBe(2);
    expect(pieces[0][0]).toEqual([0, 5]);
    expect(pieces[0][pieces[0].length - 1]).toEqual([10, 5]);
    expect(pieces[1][0]).toEqual([10, 8]);
  });
});
