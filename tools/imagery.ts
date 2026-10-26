import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { rawPath } from './lib/download.ts';
import { lonLatToMercator, mercatorToTile, type TileRange } from './lib/tiles.ts';
import { lonLatInterpolator } from './terrain.ts';
import type { GridSpec } from './lib/raster.ts';
import type { LocalRect } from '../src/shared/frame.ts';

export interface ImageryResult {
  files: string[];
  pixelsPerChunk: number;
  bytes: number;
  report: string[];
}

/**
 * Warps the downloaded Web Mercator tiles into one square texture per terrain
 * chunk, axis-aligned with the local frame so the ground shader can sample it
 * with world coordinates alone.
 */
export async function buildImagery(
  boxName: string,
  rect: LocalRect,
  chunkM: number,
  tileRange: TileRange,
  outDir: string,
  pixelsPerChunk = 512,
): Promise<ImageryResult> {
  const cols = tileRange.maxX - tileRange.minX + 1;
  const rows = tileRange.maxY - tileRange.minY + 1;
  const TILE = 256;
  const mosaicW = cols * TILE;
  const mosaicH = rows * TILE;
  const mosaic = new Uint8Array(mosaicW * mosaicH * 3);
  let missing = 0;
  for (let ty = 0; ty < rows; ty += 1) {
    for (let tx = 0; tx < cols; tx += 1) {
      const file = rawPath(`${boxName}/imagery/${tileRange.zoom}/${tileRange.minY + ty}/${tileRange.minX + tx}.bin`);
      let data: Buffer;
      try {
        data = readFileSync(file);
      } catch {
        missing += 1;
        continue;
      }
      const { data: raw, info } = await sharp(data).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
      if (info.width !== TILE || info.height !== TILE || info.channels !== 3) {
        missing += 1;
        continue;
      }
      for (let y = 0; y < TILE; y += 1) {
        const dst = ((ty * TILE + y) * mosaicW + tx * TILE) * 3;
        mosaic.set(raw.subarray(y * TILE * 3, (y + 1) * TILE * 3), dst);
      }
    }
  }

  mkdirSync(outDir, { recursive: true });
  const chunksX = (rect.maxX - rect.minX) / chunkM;
  const chunksZ = (rect.maxZ - rect.minZ) / chunkM;
  const files: string[] = [];
  let bytes = 0;
  const px = pixelsPerChunk;
  const cellM = chunkM / px;
  const n = 2 ** tileRange.zoom;
  for (let cz = 0; cz < chunksZ; cz += 1) {
    for (let cx = 0; cx < chunksX; cx += 1) {
      const spec: GridSpec = { originX: rect.minX + cx * chunkM, originZ: rect.minZ + cz * chunkM, cell: cellM, width: px, height: px };
      const toLonLat = lonLatInterpolator(spec, 32);
      const out = new Uint8Array(px * px * 3);
      for (let j = 0; j < px; j += 1) {
        for (let i = 0; i < px; i += 1) {
          const [lon, lat] = toLonLat(i + 0.5, j + 0.5);
          const [mx, my] = lonLatToMercator(lon, lat);
          const [tx, ty] = mercatorToTile(mx, my, tileRange.zoom);
          const fx = (tx - tileRange.minX) * TILE - 0.5;
          const fy = (ty - tileRange.minY) * TILE - 0.5;
          const x0 = Math.max(0, Math.min(mosaicW - 1, Math.floor(fx)));
          const y0 = Math.max(0, Math.min(mosaicH - 1, Math.floor(fy)));
          const x1 = Math.min(mosaicW - 1, x0 + 1);
          const y1 = Math.min(mosaicH - 1, y0 + 1);
          const ax = Math.max(0, Math.min(1, fx - x0));
          const ay = Math.max(0, Math.min(1, fy - y0));
          const o = (j * px + i) * 3;
          for (let c = 0; c < 3; c += 1) {
            const p00 = mosaic[(y0 * mosaicW + x0) * 3 + c];
            const p10 = mosaic[(y0 * mosaicW + x1) * 3 + c];
            const p01 = mosaic[(y1 * mosaicW + x0) * 3 + c];
            const p11 = mosaic[(y1 * mosaicW + x1) * 3 + c];
            out[o + c] = (p00 * (1 - ax) + p10 * ax) * (1 - ay) + (p01 * (1 - ax) + p11 * ax) * ay;
          }
        }
      }
      const name = `${cx}_${cz}.webp`;
      const webp = await sharp(Buffer.from(out.buffer), { raw: { width: px, height: px, channels: 3 } }).webp({ quality: 80 }).toBuffer();
      writeFileSync(path.join(outDir, name), webp);
      files.push(name);
      bytes += webp.length;
    }
  }
  void n;
  return {
    files,
    pixelsPerChunk: px,
    bytes,
    report: [`${files.length} chunk textures of ${px} px (${cellM.toFixed(2)} m per pixel) from ${cols * rows - missing} tiles at zoom ${tileRange.zoom}, ${missing} missing, ${(bytes / 1e6).toFixed(1)} MB WebP`],
  };
}
