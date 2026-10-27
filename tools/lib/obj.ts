/**
 * Minimal Wavefront OBJ reader for the city's building models: vertex
 * positions and faces only. Faces with more than three corners are fanned
 * into triangles; negative indices count from the end as the format allows.
 */
export interface ObjMesh {
  /** x, y, z per vertex in the file's own units and axes. */
  vertices: Float64Array;
  /** Vertex index triples. */
  triangles: Uint32Array;
}

export function parseObj(text: string): ObjMesh {
  const verts: number[] = [];
  const tris: number[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (line.length < 3) continue;
    const c0 = line.charCodeAt(0);
    const c1 = line.charCodeAt(1);
    // "v " lines
    if (c0 === 118 && c1 === 32) {
      const parts = line.split(/\s+/);
      const x = parseFloat(parts[1]);
      const y = parseFloat(parts[2]);
      const z = parseFloat(parts[3]);
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) verts.push(x, y, z);
      else verts.push(0, 0, 0);
      continue;
    }
    // "f " lines
    if (c0 === 102 && c1 === 32) {
      const parts = line.split(/\s+/);
      const count = verts.length / 3;
      const idx: number[] = [];
      for (let i = 1; i < parts.length; i += 1) {
        const token = parts[i];
        if (!token) continue;
        const slash = token.indexOf('/');
        const n = parseInt(slash >= 0 ? token.slice(0, slash) : token, 10);
        if (!Number.isFinite(n) || n === 0) continue;
        const v = n > 0 ? n - 1 : count + n;
        if (v >= 0 && v < count) idx.push(v);
      }
      for (let k = 1; k + 1 < idx.length; k += 1) tris.push(idx[0], idx[k], idx[k + 1]);
    }
  }
  return { vertices: Float64Array.from(verts), triangles: Uint32Array.from(tris) };
}
