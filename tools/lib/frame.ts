import proj4 from 'proj4';
import { FRAME, enToLocal, localToEn, type LonLatBox, type LocalRect } from '../../src/shared/frame.ts';

const projector = proj4('EPSG:4326', FRAME.proj);

/** WGS84 longitude and latitude to local metres (x east, z south). */
export function lonLatToLocal(lon: number, lat: number): [number, number] {
  const [e, n] = projector.forward([lon, lat]);
  return enToLocal(e, n);
}

export function localToLonLat(x: number, z: number): [number, number] {
  const [e, n] = localToEn(x, z);
  const [lon, lat] = projector.inverse([e, n]);
  return [lon, lat];
}

/** Bounding rectangle of a lon/lat box in local metres, expanded by a margin and snapped outward to a grid. */
export function boxToLocalRect(box: LonLatBox, marginM: number, snapM: number): LocalRect {
  const corners = [
    lonLatToLocal(box.west, box.south),
    lonLatToLocal(box.east, box.south),
    lonLatToLocal(box.west, box.north),
    lonLatToLocal(box.east, box.north),
  ];
  const xs = corners.map((c) => c[0]);
  const zs = corners.map((c) => c[1]);
  const snapDown = (v: number) => Math.floor(v / snapM) * snapM;
  const snapUp = (v: number) => Math.ceil(v / snapM) * snapM;
  return {
    minX: snapDown(Math.min(...xs) - marginM),
    minZ: snapDown(Math.min(...zs) - marginM),
    maxX: snapUp(Math.max(...xs) + marginM),
    maxZ: snapUp(Math.max(...zs) + marginM),
  };
}

/** Lon/lat bounding box of a local rectangle (for data requests), with a small pad. */
export function localRectToLonLatBox(rect: LocalRect, padM = 0): { south: number; north: number; west: number; east: number } {
  const pts = [
    localToLonLat(rect.minX - padM, rect.minZ - padM),
    localToLonLat(rect.maxX + padM, rect.minZ - padM),
    localToLonLat(rect.minX - padM, rect.maxZ + padM),
    localToLonLat(rect.maxX + padM, rect.maxZ + padM),
  ];
  return {
    west: Math.min(...pts.map((p) => p[0])),
    east: Math.max(...pts.map((p) => p[0])),
    south: Math.min(...pts.map((p) => p[1])),
    north: Math.max(...pts.map((p) => p[1])),
  };
}
