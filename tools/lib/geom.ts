/** Small 2-D geometry helpers in local metres (x east, z south). */
export type Pt = [number, number];

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function polylineLength(pts: Pt[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i += 1) s += dist(pts[i - 1], pts[i]);
  return s;
}

/** Closest point on segment ab to p: returns the parameter t in [0,1] and the squared distance. */
export function projectOnSegment(p: Pt, a: Pt, b: Pt): { t: number; d2: number; x: number; z: number } {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = a[0] + t * dx;
  const z = a[1] + t * dz;
  return { t, d2: (p[0] - x) ** 2 + (p[1] - z) ** 2, x, z };
}

/** Points along a polyline every `step` metres (including both ends), with the heading at each. */
export function samplePolyline(pts: Pt[], step: number): { x: number; z: number; s: number; hx: number; hz: number }[] {
  const out: { x: number; z: number; s: number; hx: number; hz: number }[] = [];
  const total = polylineLength(pts);
  if (pts.length < 2 || total === 0) return out;
  const n = Math.max(1, Math.round(total / step));
  let seg = 0;
  let segStart = 0;
  let segLen = dist(pts[0], pts[1]);
  for (let k = 0; k <= n; k += 1) {
    const s = (k / n) * total;
    while (seg < pts.length - 2 && s > segStart + segLen) {
      segStart += segLen;
      seg += 1;
      segLen = dist(pts[seg], pts[seg + 1]);
    }
    const t = segLen > 0 ? (s - segStart) / segLen : 0;
    const a = pts[seg];
    const b = pts[seg + 1];
    const hx = segLen > 0 ? (b[0] - a[0]) / segLen : 1;
    const hz = segLen > 0 ? (b[1] - a[1]) / segLen : 0;
    out.push({ x: a[0] + t * (b[0] - a[0]), z: a[1] + t * (b[1] - a[1]), s, hx, hz });
  }
  return out;
}

/** Signed area (positive when counter-clockwise in a y-up frame; our z points south, so the sign flips). */
export function signedArea(ring: Pt[]): number {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i += 1) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function bbox(pts: Pt[]): { minX: number; minZ: number; maxX: number; maxZ: number } {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, minZ, maxX, maxZ };
}

export function pointInRing(p: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Douglas-Peucker simplification. */
export function simplify(pts: Pt[], tolerance: number): Pt[] {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  const tol2 = tolerance * tolerance;
  while (stack.length) {
    const [i0, i1] = stack.pop() as [number, number];
    let worst = -1;
    let worstD = tol2;
    for (let i = i0 + 1; i < i1; i += 1) {
      const { d2 } = projectOnSegment(pts[i], pts[i0], pts[i1]);
      if (d2 > worstD) {
        worstD = d2;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([i0, worst], [worst, i1]);
    }
  }
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i += 1) if (keep[i]) out.push(pts[i]);
  return out;
}

/** Clips a polyline to an axis-aligned rectangle; returns the pieces that remain inside. */
export function clipPolylineToRect(pts: Pt[], r: { minX: number; minZ: number; maxX: number; maxZ: number }): Pt[][] {
  const pieces: Pt[][] = [];
  let current: Pt[] = [];
  const inside = (p: Pt) => p[0] >= r.minX && p[0] <= r.maxX && p[1] >= r.minZ && p[1] <= r.maxZ;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const seg = clipSegment(pts[i], pts[i + 1], r);
    if (!seg) {
      if (current.length > 1) pieces.push(current);
      current = [];
      continue;
    }
    const [a, b] = seg;
    if (current.length === 0 || dist(current[current.length - 1], a) > 1e-6) {
      if (current.length > 1) pieces.push(current);
      current = [a];
    }
    current.push(b);
    if (!inside(pts[i + 1])) {
      pieces.push(current);
      current = [];
    }
  }
  if (current.length > 1) pieces.push(current);
  return pieces;
}

/** Liang-Barsky segment clip. */
export function clipSegment(a: Pt, b: Pt, r: { minX: number; minZ: number; maxX: number; maxZ: number }): [Pt, Pt] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const checks: [number, number][] = [
    [-dx, a[0] - r.minX],
    [dx, r.maxX - a[0]],
    [-dz, a[1] - r.minZ],
    [dz, r.maxZ - a[1]],
  ];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return null;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return null;
      if (t < t1) t1 = t;
    }
  }
  return [
    [a[0] + t0 * dx, a[1] + t0 * dz],
    [a[0] + t1 * dx, a[1] + t1 * dz],
  ];
}
