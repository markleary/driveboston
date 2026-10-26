/** Web Mercator tile arithmetic (EPSG:3857, 256 px tiles) for the imagery service. */
export const EARTH_RADIUS = 6378137;
export const MERC_MAX = Math.PI * EARTH_RADIUS;

export function lonLatToMercator(lon: number, lat: number): [number, number] {
  const x = (lon * Math.PI) / 180 * EARTH_RADIUS;
  const y = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * EARTH_RADIUS;
  return [x, y];
}

/** Continuous tile coordinates (x right, y down) at a zoom level. */
export function mercatorToTile(mx: number, my: number, zoom: number): [number, number] {
  const n = 2 ** zoom;
  return [((mx + MERC_MAX) / (2 * MERC_MAX)) * n, ((MERC_MAX - my) / (2 * MERC_MAX)) * n];
}

export interface TileRange {
  zoom: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function tileRangeForBox(box: { west: number; south: number; east: number; north: number }, zoom: number): TileRange {
  const [mx0, my0] = lonLatToMercator(box.west, box.south);
  const [mx1, my1] = lonLatToMercator(box.east, box.north);
  const [tx0, ty1] = mercatorToTile(mx0, my0, zoom);
  const [tx1, ty0] = mercatorToTile(mx1, my1, zoom);
  return { zoom, minX: Math.floor(tx0), maxX: Math.floor(tx1), minY: Math.floor(ty0), maxY: Math.floor(ty1) };
}

/** Metres per pixel at a latitude for a zoom level (256 px tiles). */
export function metresPerPixel(lat: number, zoom: number): number {
  return ((2 * MERC_MAX) / (256 * 2 ** zoom)) * Math.cos((lat * Math.PI) / 180);
}
