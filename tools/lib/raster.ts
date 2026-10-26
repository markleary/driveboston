import type { Pt } from './geom.ts';

/** A regular grid of cells over local metres. Cell (i, j) is centred at (originX + (i + 0.5) cell, originZ + (j + 0.5) cell). */
export interface GridSpec {
  originX: number;
  originZ: number;
  cell: number;
  width: number;
  height: number;
}

export function cellOf(spec: GridSpec, x: number, z: number): [number, number] {
  return [Math.floor((x - spec.originX) / spec.cell), Math.floor((z - spec.originZ) / spec.cell)];
}

export function inGrid(spec: GridSpec, i: number, j: number): boolean {
  return i >= 0 && j >= 0 && i < spec.width && j < spec.height;
}

/** Bilinear sample of a float grid at a world position, treating values as cell-centre samples. Clamps at the edges. */
export function sampleBilinear(spec: GridSpec, data: ArrayLike<number>, x: number, z: number): number {
  const fx = (x - spec.originX) / spec.cell - 0.5;
  const fz = (z - spec.originZ) / spec.cell - 0.5;
  const i0 = Math.max(0, Math.min(spec.width - 1, Math.floor(fx)));
  const j0 = Math.max(0, Math.min(spec.height - 1, Math.floor(fz)));
  const i1 = Math.min(spec.width - 1, i0 + 1);
  const j1 = Math.min(spec.height - 1, j0 + 1);
  const tx = Math.max(0, Math.min(1, fx - i0));
  const tz = Math.max(0, Math.min(1, fz - j0));
  const a = data[j0 * spec.width + i0];
  const b = data[j0 * spec.width + i1];
  const c = data[j1 * spec.width + i0];
  const d = data[j1 * spec.width + i1];
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

/**
 * Scanline fill of a polygon (outer ring first, holes after, even-odd rule)
 * over the grid's cell centres. `paint` receives the cell index.
 */
export function fillPolygon(spec: GridSpec, rings: Pt[][], paint: (index: number) => void): void {
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const ring of rings) for (const p of ring) {
    if (p[1] < minZ) minZ = p[1];
    if (p[1] > maxZ) maxZ = p[1];
  }
  const j0 = Math.max(0, Math.floor((minZ - spec.originZ) / spec.cell));
  const j1 = Math.min(spec.height - 1, Math.floor((maxZ - spec.originZ) / spec.cell));
  const xs: number[] = [];
  for (let j = j0; j <= j1; j += 1) {
    const zc = spec.originZ + (j + 0.5) * spec.cell;
    xs.length = 0;
    for (const ring of rings) {
      for (let i = 0, n = ring.length; i < n; i += 1) {
        const a = ring[i];
        const b = ring[(i + 1) % n];
        if (a[1] === b[1]) continue;
        if (zc >= Math.min(a[1], b[1]) && zc < Math.max(a[1], b[1])) {
          xs.push(a[0] + ((zc - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
        }
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - spec.originX) / spec.cell - 0.5));
      const i1 = Math.min(spec.width - 1, Math.floor((xs[k + 1] - spec.originX) / spec.cell - 0.5));
      for (let i = i0; i <= i1; i += 1) paint(j * spec.width + i);
    }
  }
}

/**
 * Exact Euclidean distance transform (Felzenszwalb and Huttenlocher): for every
 * cell, the distance in cells to the nearest cell where `mask` is non-zero.
 */
export function distanceTransform(mask: Uint8Array, width: number, height: number): Float32Array {
  const INF = 1e20;
  const f = new Float64Array(Math.max(width, height));
  const d = new Float64Array(Math.max(width, height));
  const v = new Int32Array(Math.max(width, height));
  const z = new Float64Array(Math.max(width, height) + 1);
  const out = new Float32Array(width * height);
  const g = new Float64Array(width * height);

  const dt1d = (n: number): void => {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < n; q += 1) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k -= 1;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k += 1;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q += 1) {
      while (z[k + 1] < q) k += 1;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  };

  // columns
  for (let i = 0; i < width; i += 1) {
    for (let j = 0; j < height; j += 1) f[j] = mask[j * width + i] ? 0 : INF;
    dt1d(height);
    for (let j = 0; j < height; j += 1) g[j * width + i] = d[j];
  }
  // rows
  for (let j = 0; j < height; j += 1) {
    for (let i = 0; i < width; i += 1) f[i] = g[j * width + i];
    dt1d(width);
    for (let i = 0; i < width; i += 1) out[j * width + i] = Math.sqrt(d[i]);
  }
  return out;
}

/**
 * Marching squares: iso-lines of `field` at `level`, returned as polylines in
 * grid coordinates (cell-centre units: cell i is at x = i). Loops repeat their
 * first point at the end.
 */
export function marchingSquares(field: Float32Array, width: number, height: number, level: number): Pt[][] {
  const segs: [Pt, Pt][] = [];
  const lerp = (x0: number, z0: number, x1: number, z1: number, v0: number, v1: number): Pt => {
    const t = v1 === v0 ? 0.5 : (level - v0) / (v1 - v0);
    return [x0 + t * (x1 - x0), z0 + t * (z1 - z0)];
  };
  for (let j = 0; j < height - 1; j += 1) {
    for (let i = 0; i < width - 1; i += 1) {
      const a = field[j * width + i];
      const b = field[j * width + i + 1];
      const c = field[(j + 1) * width + i + 1];
      const d = field[(j + 1) * width + i];
      const code = (a < level ? 1 : 0) | (b < level ? 2 : 0) | (c < level ? 4 : 0) | (d < level ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const top = () => lerp(i, j, i + 1, j, a, b);
      const right = () => lerp(i + 1, j, i + 1, j + 1, b, c);
      const bottom = () => lerp(i, j + 1, i + 1, j + 1, d, c);
      const left = () => lerp(i, j, i, j + 1, a, d);
      switch (code) {
        case 1: case 14: segs.push([left(), top()]); break;
        case 2: case 13: segs.push([top(), right()]); break;
        case 3: case 12: segs.push([left(), right()]); break;
        case 4: case 11: segs.push([right(), bottom()]); break;
        case 5: {
          const centre = (a + b + c + d) / 4;
          if (centre < level) { segs.push([left(), bottom()], [top(), right()]); } else { segs.push([left(), top()], [right(), bottom()]); }
          break;
        }
        case 6: case 9: segs.push([top(), bottom()]); break;
        case 7: case 8: segs.push([left(), bottom()]); break;
        case 10: {
          const centre = (a + b + c + d) / 4;
          if (centre < level) { segs.push([left(), top()], [right(), bottom()]); } else { segs.push([left(), bottom()], [top(), right()]); }
          break;
        }
        default: break;
      }
    }
  }
  return linkSegments(segs);
}

/** Joins segments sharing endpoints into polylines. */
export function linkSegments(allSegs: [Pt, Pt][]): Pt[][] {
  const key = (p: Pt) => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`;
  // Zero-length segments appear where a corner sits exactly on the level; they carry nothing.
  const segs = allSegs.filter(([a, b]) => key(a) !== key(b));
  const byPoint = new Map<string, number[]>();
  segs.forEach((s, idx) => {
    for (const p of s) {
      const k = key(p);
      const list = byPoint.get(k);
      if (list) list.push(idx);
      else byPoint.set(k, [idx]);
    }
  });
  const used = new Uint8Array(segs.length);
  const out: Pt[][] = [];
  const extend = (line: Pt[], fromEnd: boolean): void => {
    for (;;) {
      const p = fromEnd ? line[line.length - 1] : line[0];
      const candidates = byPoint.get(key(p)) ?? [];
      let found = -1;
      for (const idx of candidates) if (!used[idx]) { found = idx; break; }
      if (found < 0) return;
      used[found] = 1;
      const [a, b] = segs[found];
      const next = key(a) === key(p) ? b : a;
      if (fromEnd) line.push(next);
      else line.unshift(next);
    }
  };
  for (let i = 0; i < segs.length; i += 1) {
    if (used[i]) continue;
    used[i] = 1;
    const line: Pt[] = [segs[i][0], segs[i][1]];
    extend(line, true);
    extend(line, false);
    out.push(line);
  }
  return out;
}
