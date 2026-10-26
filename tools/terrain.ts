import { readFileSync } from 'node:fs';
import { fromArrayBuffer } from 'geotiff';
import { rawPath } from './lib/download.ts';
import { localToLonLat } from './lib/frame.ts';
import type { GridSpec } from './lib/raster.ts';
import type { LocalRect } from '../src/shared/frame.ts';

export interface LocalDem {
  spec: GridSpec;
  heights: Float32Array;
  /** Elevation of hydro-flattened water in the DEM (the modal height), metres NAVD88. */
  waterLevel: number;
  nodataCells: number;
  min: number;
  max: number;
}

/**
 * A smooth map from local grid positions to lon/lat, evaluated exactly on a
 * coarse lattice and interpolated between, so millions of cells do not each
 * pay for a projection call. The projection is nearly affine at city scale.
 */
export function lonLatInterpolator(spec: GridSpec, stride = 32): (fx: number, fz: number) => [number, number] {
  const cols = Math.ceil(spec.width / stride) + 1;
  const rows = Math.ceil(spec.height / stride) + 1;
  const lon = new Float64Array(cols * rows);
  const lat = new Float64Array(cols * rows);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const x = spec.originX + c * stride * spec.cell;
      const z = spec.originZ + r * stride * spec.cell;
      const [lo, la] = localToLonLat(x, z);
      lon[r * cols + c] = lo;
      lat[r * cols + c] = la;
    }
  }
  // fx, fz are fractional cell coordinates (0 at the grid origin).
  return (fx, fz) => {
    const gx = fx / stride;
    const gz = fz / stride;
    const c0 = Math.max(0, Math.min(cols - 2, Math.floor(gx)));
    const r0 = Math.max(0, Math.min(rows - 2, Math.floor(gz)));
    const tx = gx - c0;
    const tz = gz - r0;
    const i00 = r0 * cols + c0;
    const i10 = i00 + 1;
    const i01 = i00 + cols;
    const i11 = i01 + 1;
    const lo = (lon[i00] * (1 - tx) + lon[i10] * tx) * (1 - tz) + (lon[i01] * (1 - tx) + lon[i11] * tx) * tz;
    const la = (lat[i00] * (1 - tx) + lat[i10] * tx) * (1 - tz) + (lat[i01] * (1 - tx) + lat[i11] * tx) * tz;
    return [lo, la];
  };
}

/** Resamples the downloaded DEM (geographic pixels) onto the local 1 m grid. */
export async function loadLocalDem(boxName: string, rect: LocalRect): Promise<LocalDem> {
  const buf = readFileSync(rawPath(`${boxName}/dem-1m.tif`));
  const tiff = await fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const image = await tiff.getImage();
  const [west, south, east, north] = image.getBoundingBox();
  const srcW = image.getWidth();
  const srcH = image.getHeight();
  const nodata = Number(image.getGDALNoData() ?? -999999);
  const rasters = await image.readRasters();
  const src = rasters[0] as Float32Array;
  const dLon = (east - west) / srcW;
  const dLat = (north - south) / srcH;

  const spec: GridSpec = { originX: rect.minX, originZ: rect.minZ, cell: 1, width: rect.maxX - rect.minX, height: rect.maxZ - rect.minZ };
  const toLonLat = lonLatInterpolator(spec);
  const heights = new Float32Array(spec.width * spec.height);
  let nodataCells = 0;
  let min = Infinity;
  let max = -Infinity;
  const valid = (v: number) => v !== nodata && v > -200 && v < 2000;
  for (let j = 0; j < spec.height; j += 1) {
    for (let i = 0; i < spec.width; i += 1) {
      const [lon, lat] = toLonLat(i + 0.5, j + 0.5);
      const fc = (lon - west) / dLon - 0.5;
      const fr = (north - lat) / dLat - 0.5;
      const c0 = Math.max(0, Math.min(srcW - 1, Math.floor(fc)));
      const r0 = Math.max(0, Math.min(srcH - 1, Math.floor(fr)));
      const c1 = Math.min(srcW - 1, c0 + 1);
      const r1 = Math.min(srcH - 1, r0 + 1);
      const tx = Math.max(0, Math.min(1, fc - c0));
      const tz = Math.max(0, Math.min(1, fr - r0));
      const a = src[r0 * srcW + c0];
      const b = src[r0 * srcW + c1];
      const c = src[r1 * srcW + c0];
      const d = src[r1 * srcW + c1];
      let h: number;
      if (valid(a) && valid(b) && valid(c) && valid(d)) {
        h = (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
      } else {
        const vals = [a, b, c, d].filter(valid);
        h = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : NaN;
      }
      if (Number.isNaN(h)) {
        nodataCells += 1;
        heights[j * spec.width + i] = NaN;
      } else {
        heights[j * spec.width + i] = h;
        if (h < min) min = h;
        if (h > max) max = h;
      }
    }
  }
  // Fill holes from the nearest valid neighbour along the row, then the column.
  if (nodataCells > 0) fillNaN(heights, spec.width, spec.height);

  // Water: the single most common height in 0.05 m bins is the hydro-flattened surface.
  const bins = new Map<number, number>();
  for (let k = 0; k < heights.length; k += 16) {
    const key = Math.round(heights[k] * 20);
    bins.set(key, (bins.get(key) ?? 0) + 1);
  }
  let bestKey = 0;
  let bestCount = -1;
  for (const [key, count] of bins) if (count > bestCount) {
    bestCount = count;
    bestKey = key;
  }
  const waterLevel = bestKey / 20;
  return { spec, heights, waterLevel, nodataCells, min, max };
}

function fillNaN(h: Float32Array, w: number, hgt: number): void {
  for (let j = 0; j < hgt; j += 1) {
    let last = NaN;
    for (let i = 0; i < w; i += 1) {
      const k = j * w + i;
      if (Number.isNaN(h[k])) h[k] = last;
      else last = h[k];
    }
    last = NaN;
    for (let i = w - 1; i >= 0; i -= 1) {
      const k = j * w + i;
      if (Number.isNaN(h[k])) h[k] = last;
      else last = h[k];
    }
  }
  for (let i = 0; i < w; i += 1) {
    let last = NaN;
    for (let j = 0; j < hgt; j += 1) {
      const k = j * w + i;
      if (Number.isNaN(h[k])) h[k] = last;
      else last = h[k];
    }
    last = NaN;
    for (let j = hgt - 1; j >= 0; j -= 1) {
      const k = j * w + i;
      if (Number.isNaN(h[k])) h[k] = last;
      else last = h[k];
    }
  }
  for (let k = 0; k < h.length; k += 1) if (Number.isNaN(h[k])) h[k] = 0;
}
