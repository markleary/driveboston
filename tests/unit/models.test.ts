import { describe, expect, it } from 'vitest';
import { parseCsv } from '../../tools/lib/csv.ts';
import { parseObj } from '../../tools/lib/obj.ts';
import { lonLatToStatePlaneFt, statePlaneFtToLocal, tileFor, tilesForRect } from '../../tools/lib/bos3d.ts';
import { lonLatToLocal } from '../../tools/lib/frame.ts';
import { GeometryWriter, appendModel } from '../../src/world/models.ts';
import { maskShare } from '../../tools/models.ts';
import { GROUND } from '../../src/shared/roads.ts';

describe('city model tiles', () => {
  it('addresses tiles like the city grid and converts State Plane feet to the local frame', () => {
    // Tile centres (State Plane feet) and centroids (lon, lat) from the Bos3D tile grid service.
    const tiles = [
      ['BOS_G_4', 768600, 2955400, -71.08402024705359, 42.35702485892327],
      ['BOS_H_4', 773600, 2955400, -71.06552157613139, 42.35695645952956],
      ['BOS_G_5', 768600, 2950400, -71.08411044372247, 42.34330472159731],
      ['BOS_H_5', 773600, 2950400, -71.06561578375054, 42.343236336827566],
    ] as const;
    for (const [name, e, n, lon, lat] of tiles) {
      expect(tileFor(e, n)).toBe(name);
      const [pe, pn] = lonLatToStatePlaneFt(lon, lat);
      // The grid service's lon/lat went through a different datum shift; a metre is close enough to prove the frame.
      expect(Math.abs(pe - e)).toBeLessThan(5);
      expect(Math.abs(pn - n)).toBeLessThan(5);
      const [x, z] = statePlaneFtToLocal(e, n);
      const [lx, lz] = lonLatToLocal(lon, lat);
      expect(Math.abs(x - lx)).toBeLessThan(1);
      expect(Math.abs(z - lz)).toBeLessThan(1);
    }
    // A tile owns its south-west corner.
    expect(tileFor(766100, 2952900)).toBe('BOS_G_4');
    expect(tileFor(766099, 2952899)).toBe('BOS_F_5');
    // 217 Beacon St sits in tile G_4 according to its catalogue row (shifted centroid plus the measured shift).
    expect(tileFor(39280.7 + 731099.8, 51344.6 + 2902903.2)).toBe('BOS_G_4');
  });

  it('lists every tile the Back Bay rectangle touches', () => {
    // The padded rectangle reaches 60 m past the west edge of column G.
    expect(tilesForRect({ minX: -2560, minZ: -256, maxX: -256, maxZ: 1536 })).toEqual(['BOS_F_4', 'BOS_F_5', 'BOS_G_4', 'BOS_G_5', 'BOS_H_4', 'BOS_H_5']);
    expect(tilesForRect({ minX: -1800, minZ: 1400, maxX: -1700, maxZ: 1500 })).toEqual(['BOS_G_5']);
  });
});

describe('catalogue and OBJ readers', () => {
  it('parses quoted CSV fields and drops the byte order mark', () => {
    const rows = parseCsv('﻿a,b,c\r\n1,"x, y","he said ""hi"""\r\n2,,plain\r\n\r\n');
    expect(rows).toEqual([
      { a: '1', b: 'x, y', c: 'he said "hi"' },
      { a: '2', b: '', c: 'plain' },
    ]);
  });

  it('fans polygons into triangles and resolves negative and slashed indices', () => {
    const mesh = parseObj('v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nvn 0 0 1\nf 1//1 2//1 3//1 4//1\nf -1 -2 -3\n');
    expect(mesh.vertices.length).toBe(12);
    expect(Array.from(mesh.triangles)).toEqual([0, 1, 2, 0, 2, 3, 3, 2, 1]);
  });
});

describe('roadway check', () => {
  it('counts the ground cells under a model and those on the road', () => {
    // A 10 by 10 m grid whose western half is road; a 6 by 6 m slab from (2, 2) to (8, 8) as two triangles.
    const spec = { originX: 0, originZ: 0, cell: 1, width: 10, height: 10 };
    const mask = new Uint8Array(100);
    for (let j = 0; j < 10; j += 1) for (let i = 0; i < 5; i += 1) mask[j * 10 + i] = GROUND.road;
    const xyz = [2, 0, 2, 8, 0, 2, 8, 0, 8, 2, 0, 8];
    const share = maskShare(spec, mask, xyz, [0, 1, 2, 0, 2, 3], GROUND.road);
    expect(share.cells).toBe(36);
    expect(share.hits).toBe(18);
    // A vertical wall projects to a line and covers nothing.
    expect(maskShare(spec, mask, [1.2, 0, 1, 1.2, 5, 1, 1.2, 5, 9, 1.2, 0, 9], [0, 1, 2, 0, 2, 3], GROUND.road).cells).toBe(0);
  });
});

describe('model clustering', () => {
  it('turns a box into four walls with wall coordinates and one roof', () => {
    // 10 x 6 x 4 m box standing on y = 2, faces counter-clockwise seen from outside, no bottom.
    const xyz = [0, 2, 0, 10, 2, 0, 10, 2, 6, 0, 2, 6, 0, 6, 0, 10, 6, 0, 10, 6, 6, 0, 6, 6];
    const index = [4, 7, 6, 4, 6, 5, 0, 5, 1, 0, 4, 5, 3, 2, 6, 3, 6, 7, 0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2];
    const w = new GeometryWriter(30, 30);
    appendModel(w, { xyz, index, groundY: 2, style: 1, seed: 0.5 });
    const g = w.finish();
    expect(g.vertexCount).toBe(20);
    expect(g.indexCount).toBe(30);
    let roofs = 0;
    const wallLens = new Map<number, number>();
    for (let i = 0; i < g.vertexCount; i += 1) {
      const nl = Math.hypot(g.normals[i * 3], g.normals[i * 3 + 1], g.normals[i * 3 + 2]);
      expect(nl).toBeCloseTo(1, 6);
      expect(g.height[i]).toBeCloseTo(4, 6);
      expect(g.style[i]).toBe(1);
      if (g.roof[i] === 1) {
        roofs += 1;
        expect(g.normals[i * 3 + 1]).toBeCloseTo(1, 6);
        continue;
      }
      expect(Math.abs(g.normals[i * 3 + 1])).toBeLessThan(1e-6);
      const len = Math.round(g.wallLen[i]);
      wallLens.set(len, (wallLens.get(len) ?? 0) + 1);
      expect(g.uvs[i * 2]).toBeGreaterThanOrEqual(-1e-6);
      expect(g.uvs[i * 2]).toBeLessThanOrEqual(g.wallLen[i] + 1e-6);
      expect([0, 4]).toContain(Math.round(g.uvs[i * 2 + 1] * 1000) / 1000);
    }
    expect(roofs).toBe(4);
    expect(wallLens.get(10)).toBe(8);
    expect(wallLens.get(6)).toBe(8);
    // Every triangle keeps its outward winding: the first roof triangle still faces up.
    const [a, b, c] = [g.indices[0], g.indices[1], g.indices[2]];
    const p = (i: number) => [g.positions[i * 3], g.positions[i * 3 + 1], g.positions[i * 3 + 2]];
    const [pa, pb, pc] = [p(a), p(b), p(c)];
    const ny = (pb[2] - pa[2]) * (pc[0] - pa[0]) - (pb[0] - pa[0]) * (pc[2] - pa[2]);
    expect(ny).toBeGreaterThan(0);
  });
});
