import { fetchCached } from './download.ts';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
];

export interface OsmNode {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}

export interface OsmWay {
  type: 'way';
  id: number;
  nodes: number[];
  tags?: Record<string, string>;
}

export interface OsmRelation {
  type: 'relation';
  id: number;
  members: { type: string; ref: number; role: string }[];
  tags?: Record<string, string>;
}

export type OsmElement = OsmNode | OsmWay | OsmRelation;

export interface OsmData {
  elements: OsmElement[];
}

function validateOsm(bytes: Uint8Array, contentType: string): string | null {
  if (!/json/i.test(contentType)) return `unexpected content type ${contentType}`;
  const head = new TextDecoder().decode(bytes.subarray(0, 300));
  if (!head.includes('"elements"')) return `not an Overpass result: ${head.slice(0, 120)}`;
  return null;
}

/** Runs one Overpass query, trying the public endpoints in turn, and caches the JSON. */
export async function overpass(key: string, query: string, force = false): Promise<OsmData> {
  let lastError: unknown;
  for (const endpoint of ENDPOINTS) {
    try {
      const bytes = await fetchCached({
        key,
        url: endpoint,
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        source: 'OpenStreetMap via Overpass API',
        licence: 'ODbL 1.0',
        force,
        retries: 2,
        timeoutMs: 300_000,
        validate: validateOsm,
      });
      return JSON.parse(new TextDecoder().decode(bytes)) as OsmData;
    } catch (err) {
      lastError = err;
      console.warn(`  overpass endpoint failed: ${endpoint}`);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
