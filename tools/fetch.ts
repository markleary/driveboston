import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { arcgisQueryAll } from './lib/arcgis.ts';
import { fetchCached, mapLimit, rawPath } from './lib/download.ts';
import { boxToLocalRect, localRectToLonLatBox } from './lib/frame.ts';
import { overpass } from './lib/overpass.ts';
import { tileRangeForBox } from './lib/tiles.ts';
import type { LonLatBox } from '../src/shared/frame.ts';

/** Chunk size in metres; the local rectangle snaps to it so chunks tile the box exactly. */
export const CHUNK_M = 256;
/** Extra ground fetched around the box so roads and the DEM continue past the playable edge. */
export const MARGIN_M = 64;
export const IMAGERY_ZOOM = 18;

export const SOURCES = {
  dem: {
    source: 'USGS 3D Elevation Program, 3DEPElevation image service',
    licence: 'US Government work, public domain',
  },
  buildings: {
    source: 'City of Boston, Buildings with Roof Breaks (Boston Planning Department GIS Lab)',
    licence: 'PDDL',
    layer: 'https://gis.bostonplans.org/hosting/rest/services/Boston_Buildings/FeatureServer/9',
  },
  sidewalks: {
    source: 'City of Boston, Sidewalk Inventory (Public Works)',
    licence: 'PDDL',
    layer: 'https://gisportal.boston.gov/arcgis/rest/services/Infrastructure/OpenData/MapServer/0',
  },
  imagery: {
    source: 'MassGIS 2025 Aerial Imagery tile service',
    licence: 'Public records, no restrictions; acknowledgement requested',
    service: 'https://tiles.arcgis.com/tiles/hGdibHYSPO59RG1h/arcgis/rest/services/Massachusetts_Aerial_Imagery_2025/MapServer',
  },
} as const;

export interface FetchResult {
  rect: ReturnType<typeof boxToLocalRect>;
  demKey: string;
  buildingsPath: string;
  sidewalksPath: string;
  osmKey: string;
  osmBuildingsKey: string;
  tileKeys: { x: number; y: number; key: string }[];
  tileRange: ReturnType<typeof tileRangeForBox>;
}

const isTiff = (b: Uint8Array, ct: string): string | null =>
  b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a ? null : `not a little-endian TIFF (${ct})`;
const isImage = (b: Uint8Array, ct: string): string | null =>
  (b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x89 && b[1] === 0x50) ? null : `not a JPEG or PNG tile (${ct})`;

export async function fetchBox(box: LonLatBox, force = false): Promise<FetchResult> {
  const rect = boxToLocalRect(box, MARGIN_M, CHUNK_M);
  const ll = localRectToLonLatBox(rect, 8);
  const widthM = rect.maxX - rect.minX;
  const heightM = rect.maxZ - rect.minZ;
  console.log(`box ${box.name}: local rect x ${rect.minX}..${rect.maxX}, z ${rect.minZ}..${rect.maxZ} (${widthM} x ${heightM} m)`);
  const workDir = rawPath(`${box.name}/work`);
  mkdirSync(workDir, { recursive: true });

  // 1 m elevation export of the padded rectangle. Pixels are in degrees; the
  // terrain step resamples onto the local grid.
  const demParams = new URLSearchParams({
    bbox: `${ll.west},${ll.south},${ll.east},${ll.north}`,
    bboxSR: '4326',
    imageSR: '4326',
    size: `${Math.ceil(widthM + 16)},${Math.ceil(heightM + 16)}`,
    format: 'tiff',
    pixelType: 'F32',
    noData: '-999999',
    interpolation: 'RSP_BilinearInterpolation',
    f: 'image',
  });
  const demKey = `${box.name}/dem-1m.tif`;
  console.log('fetching elevation');
  await fetchCached({
    key: demKey,
    url: `https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?${demParams}`,
    ...SOURCES.dem,
    force,
    validate: isTiff,
    timeoutMs: 600_000,
  });

  console.log('fetching building parts');
  const buildings = await arcgisQueryAll({
    layerUrl: SOURCES.buildings.layer,
    keyPrefix: `${box.name}/buildings`,
    source: SOURCES.buildings.source,
    licence: SOURCES.buildings.licence,
    bbox: ll,
    force,
  });
  const buildingsPath = path.join(workDir, 'buildings.geojson');
  writeFileSync(buildingsPath, JSON.stringify(buildings));
  console.log(`  ${buildings.features.length} building parts`);

  console.log('fetching sidewalk polygons');
  const sidewalks = await arcgisQueryAll({
    layerUrl: SOURCES.sidewalks.layer,
    keyPrefix: `${box.name}/sidewalks`,
    source: SOURCES.sidewalks.source,
    licence: SOURCES.sidewalks.licence,
    bbox: ll,
    force,
  });
  const sidewalksPath = path.join(workDir, 'sidewalks.geojson');
  writeFileSync(sidewalksPath, JSON.stringify(sidewalks));
  console.log(`  ${sidewalks.features.length} sidewalk polygons`);

  console.log('fetching OpenStreetMap');
  const bboxStr = `${ll.south},${ll.west},${ll.north},${ll.east}`;
  const query = `[out:json][timeout:180];
(
  way["highway"](${bboxStr});
  way["railway"~"^(rail|light_rail|tram|subway)$"](${bboxStr});
  way["natural"="water"](${bboxStr});
  relation["natural"="water"](${bboxStr});
  way["waterway"~"^(riverbank|dock)$"](${bboxStr});
  way["leisure"~"^(park|garden|pitch|playground|common)$"](${bboxStr});
  relation["leisure"~"^(park|garden)$"](${bboxStr});
  way["landuse"~"^(grass|railway|cemetery|recreation_ground|flowerbed)$"](${bboxStr});
  way["amenity"="parking"](${bboxStr});
  way["place"="square"](${bboxStr});
  way["man_made"="pier"](${bboxStr});
  way["highway"="pedestrian"]["area"="yes"](${bboxStr});
);
out body;
>;
out skel qt;`;
  const osmKey = `${box.name}/osm.json`;
  const osm = await overpass(osmKey, query, force);
  console.log(`  ${osm.elements.length} OSM elements`);
  const buildingQuery = `[out:json][timeout:180];
(
  way["building"](${bboxStr});
  relation["building"](${bboxStr});
  way["building:part"](${bboxStr});
);
out body;
>;
out skel qt;`;
  const osmBuildingsKey = `${box.name}/osm-buildings.json`;
  const osmBuildings = await overpass(osmBuildingsKey, buildingQuery, force);
  console.log(`  ${osmBuildings.elements.length} OSM building elements`);

  console.log(`fetching imagery tiles at zoom ${IMAGERY_ZOOM}`);
  const tileRange = tileRangeForBox(ll, IMAGERY_ZOOM);
  const tiles: { x: number; y: number; key: string }[] = [];
  for (let y = tileRange.minY; y <= tileRange.maxY; y += 1) {
    for (let x = tileRange.minX; x <= tileRange.maxX; x += 1) {
      tiles.push({ x, y, key: `${box.name}/imagery/${IMAGERY_ZOOM}/${y}/${x}.bin` });
    }
  }
  let done = 0;
  await mapLimit(tiles, 6, async (t) => {
    await fetchCached({
      key: t.key,
      url: `${SOURCES.imagery.service}/tile/${IMAGERY_ZOOM}/${t.y}/${t.x}`,
      source: SOURCES.imagery.source,
      licence: SOURCES.imagery.licence,
      force,
      validate: isImage,
    });
    done += 1;
    if (done % 50 === 0) console.log(`  ${done}/${tiles.length} tiles`);
  });
  console.log(`  ${tiles.length} tiles (${tileRange.maxX - tileRange.minX + 1} x ${tileRange.maxY - tileRange.minY + 1})`);

  return { rect, demKey, buildingsPath, sidewalksPath, osmKey, osmBuildingsKey, tileKeys: tiles, tileRange };
}
