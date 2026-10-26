import { describe, expect, it } from 'vitest';
import { headingFromDirection } from '../../src/game/streets.ts';
import { simplifyPolyline } from '../../src/world/curbs.ts';

describe('headingFromDirection', () => {
  it('maps the world axes to compass headings', () => {
    expect(headingFromDirection(0, -1)).toBeCloseTo(0);
    expect(headingFromDirection(1, 0)).toBeCloseTo(90);
    expect(headingFromDirection(0, 1)).toBeCloseTo(180);
    expect(headingFromDirection(-1, 0)).toBeCloseTo(270);
  });
});

describe('simplifyPolyline', () => {
  it('keeps the ends and the corner of an L, dropping collinear points', () => {
    const pts = new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0, 3, 0, 1, 3, 0, 2]);
    expect(simplifyPolyline(pts, 0.1)).toEqual([0, 3, 5]);
  });
  it('keeps points that deviate more than the tolerance', () => {
    const pts = new Float32Array([0, 0, 0, 1, 0, 0.3, 2, 0, 0]);
    expect(simplifyPolyline(pts, 0.1)).toEqual([0, 1, 2]);
    expect(simplifyPolyline(pts, 0.5)).toEqual([0, 2]);
  });
});
