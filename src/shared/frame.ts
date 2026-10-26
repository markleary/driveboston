/**
 * The world frame: a transverse Mercator projection centred on Park Street
 * station, x east, z south (so z = -northing), y up in metres NAVD88.
 * The pipeline projects with proj4; this file carries the frozen definition
 * and the small pure helpers both sides share.
 */
export interface FrameDefinition {
  name: string;
  originLat: number;
  originLon: number;
  proj: string;
}

export const FRAME: FrameDefinition = {
  name: 'Park Street station',
  originLat: 42.3564,
  originLon: -71.0625,
  proj: '+proj=tmerc +lat_0=42.3564 +lon_0=-71.0625 +k=1 +x_0=0 +y_0=0 +ellps=GRS80 +units=m +no_defs',
};

/** Local (x, z) from projected (easting, northing). */
export function enToLocal(easting: number, northing: number): [number, number] {
  return [easting, -northing];
}

export function localToEn(x: number, z: number): [number, number] {
  return [x, -z];
}

export interface LonLatBox {
  name: string;
  south: number;
  north: number;
  west: number;
  east: number;
}

/** Rectangle in local metres, x east and z south, inclusive of min and exclusive of max. */
export interface LocalRect {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}
