import { fetchCached, type FetchOptions } from './download.ts';

export interface GeoJsonFeature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown } | null;
}

export interface GeoJsonCollection {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
}

export interface ArcgisQueryOptions {
  layerUrl: string;
  keyPrefix: string;
  source: string;
  licence: string;
  bbox: { west: number; south: number; east: number; north: number };
  outFields?: string;
  pageSize?: number;
  force?: boolean;
}

function validateJson(bytes: Uint8Array, contentType: string): string | null {
  if (!/json/i.test(contentType)) return `unexpected content type ${contentType}`;
  const text = new TextDecoder().decode(bytes.subarray(0, 400));
  if (text.includes('"error"')) return `service error: ${text.slice(0, 200)}`;
  return null;
}

/** Pages through an ArcGIS feature query (GeoJSON, WGS84) and merges the results. */
export async function arcgisQueryAll(opts: ArcgisQueryOptions): Promise<GeoJsonCollection> {
  const pageSize = opts.pageSize ?? 2000;
  const features: GeoJsonFeature[] = [];
  const b = opts.bbox;
  for (let page = 0; page < 500; page += 1) {
    const params = new URLSearchParams({
      where: '1=1',
      geometry: `${b.west},${b.south},${b.east},${b.north}`,
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: opts.outFields ?? '*',
      outSR: '4326',
      resultOffset: String(page * pageSize),
      resultRecordCount: String(pageSize),
      f: 'geojson',
    });
    const fetchOpts: FetchOptions = {
      key: `${opts.keyPrefix}/page-${String(page).padStart(3, '0')}.geojson`,
      url: `${opts.layerUrl}/query?${params.toString()}`,
      source: opts.source,
      licence: opts.licence,
      force: opts.force,
      validate: validateJson,
    };
    const bytes = await fetchCached(fetchOpts);
    const json = JSON.parse(new TextDecoder().decode(bytes)) as GeoJsonCollection & {
      properties?: { exceededTransferLimit?: boolean };
    };
    features.push(...json.features);
    const more = json.properties?.exceededTransferLimit === true || json.features.length === pageSize;
    if (!more) break;
  }
  return { type: 'FeatureCollection', features };
}
