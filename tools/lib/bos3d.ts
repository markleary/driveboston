/**
 * Where the Boston Planning Department's citywide 3D building models live and
 * how their tiles are addressed. The OBJ release is cut into 5000 ft squares of
 * Massachusetts State Plane feet, named by a column letter and a row number.
 * This module has no heavy imports so the fetch step can use it freely.
 */
import proj4 from 'proj4';
import { localToLonLat } from './frame.ts';
import type { Pt } from './geom.ts';
import { FRAME, type LocalRect } from '../../src/shared/frame.ts';

export const MODEL_SOURCE = {
  release: 'Bos3d_BldgModels_20260624_OBJ',
  base: 'https://maps.bostonplans.org/3d',
  source: 'Boston Planning Department, citywide 3D building models (OBJ release of June 2026)',
  licence: 'PDDL',
} as const;

export const modelTileUrl = (tile: string): string => `${MODEL_SOURCE.base}/${MODEL_SOURCE.release}/${tile}_BldgModels_OBJ.zip`;
export const modelTileKey = (boxName: string, tile: string): string => `${boxName}/bos3d/${tile}_BldgModels_OBJ.zip`;

/** NAD83 Massachusetts Mainland State Plane (EPSG:2249) in US survey feet. */
export const STATE_PLANE_FT =
  '+proj=lcc +lat_1=42.68333333333333 +lat_2=41.71666666666667 +lat_0=41 +lon_0=-71.5 +x_0=200000.0001016002 +y_0=750000 +ellps=GRS80 +datum=NAD83 +to_meter=0.3048006096012192 +no_defs';
export const US_FT = 0.3048006096012192;

/**
 * Tile grid constants derived from the city's tile index service, whose
 * MASP_X/MASP_Y fields are tile centres (G_4 is centred on 768,600, 2,955,400):
 * the west edge of column A and the north edge of row 1.
 */
const TILE_FT = 5000;
const TILE_WEST_FT = 736_100;
const TILE_NORTH_FT = 2_972_900;

const toStatePlane = proj4('EPSG:4326', STATE_PLANE_FT);
const statePlaneToFrame = proj4(STATE_PLANE_FT, FRAME.proj);

/** Tile id for a State Plane point in feet; a tile owns its south and west edges. */
export function tileFor(eastFt: number, northFt: number): string {
  const col = Math.floor((eastFt - TILE_WEST_FT) / TILE_FT);
  const row = Math.ceil((TILE_NORTH_FT - northFt) / TILE_FT);
  return `BOS_${String.fromCharCode(65 + col)}_${row}`;
}

export function lonLatToStatePlaneFt(lon: number, lat: number): Pt {
  const [e, n] = toStatePlane.forward([lon, lat]);
  return [e, n];
}

/** State Plane feet to the local frame (x east, z south) in metres. */
export function statePlaneFtToLocal(eastFt: number, northFt: number): Pt {
  const [e, n] = statePlaneToFrame.forward([eastFt, northFt]);
  return [e, -n];
}

/** Tiles touched by a local rectangle, sampled every 300 m so a rectangle wider than a tile misses none. */
export function tilesForRect(rect: LocalRect): string[] {
  const tiles = new Set<string>();
  const step = 300;
  for (let z = rect.minZ; ; z += step) {
    const zz = Math.min(z, rect.maxZ - 1);
    for (let x = rect.minX; ; x += step) {
      const xx = Math.min(x, rect.maxX - 1);
      const [lon, lat] = localToLonLat(xx, zz);
      const [e, n] = lonLatToStatePlaneFt(lon, lat);
      tiles.add(tileFor(e, n));
      if (xx >= rect.maxX - 1) break;
    }
    if (zz >= rect.maxZ - 1) break;
  }
  return [...tiles].sort();
}
