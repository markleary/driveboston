import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Cached downloads with a manifest. Every fetched input is stored under
 * data/raw/<box>/ and recorded with its URL, date, size, hash and licence, so a
 * rebuild is reproducible and the attribution list can be checked.
 */
export const RAW_ROOT = path.resolve('data/raw');
const MANIFEST_PATH = path.join(RAW_ROOT, 'MANIFEST.json');
const USER_AGENT = 'driveboston-pipeline/0.1 (https://github.com/markleary/driveboston)';

export interface ManifestEntry {
  key: string;
  url: string;
  retrieved: string;
  bytes: number;
  sha256: string;
  licence: string;
  source: string;
}

export function readManifest(): Record<string, ManifestEntry> {
  if (!existsSync(MANIFEST_PATH)) return {};
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Record<string, ManifestEntry>;
}

function writeManifest(m: Record<string, ManifestEntry>): void {
  mkdirSync(RAW_ROOT, { recursive: true });
  const sorted = Object.fromEntries(Object.entries(m).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(MANIFEST_PATH, JSON.stringify(sorted, null, 2) + '\n');
}

export interface FetchOptions {
  /** Relative path under data/raw, for example "backbay/dem-1m.tif". */
  key: string;
  url: string;
  source: string;
  licence: string;
  headers?: Record<string, string>;
  method?: 'GET' | 'POST';
  body?: string;
  force?: boolean;
  retries?: number;
  timeoutMs?: number;
  /** Rejects a response body that fails this check (for example an HTML error page). */
  validate?: (bytes: Uint8Array, contentType: string) => string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Returns the cached file if present, else downloads it with retries and records it. */
export async function fetchCached(opts: FetchOptions): Promise<Uint8Array> {
  const file = path.join(RAW_ROOT, opts.key);
  if (!opts.force && existsSync(file)) return new Uint8Array(readFileSync(file));
  const retries = opts.retries ?? 4;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 180_000);
      const res = await fetch(opts.url, {
        method: opts.method ?? 'GET',
        headers: { 'User-Agent': USER_AGENT, ...(opts.headers ?? {}) },
        body: opts.body,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${opts.url}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const problem = opts.validate?.(bytes, res.headers.get('content-type') ?? '');
      if (problem) throw new Error(`${problem} (${opts.url})`);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, bytes);
      const manifest = readManifest();
      manifest[opts.key] = {
        key: opts.key,
        url: opts.url,
        retrieved: new Date().toISOString(),
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        licence: opts.licence,
        source: opts.source,
      };
      writeManifest(manifest);
      return bytes;
    } catch (err) {
      lastError = err;
      const wait = 2000 * 2 ** attempt;
      console.warn(`  retry ${attempt + 1}/${retries} in ${wait} ms: ${err instanceof Error ? err.message : err}`);
      await sleep(wait);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function rawPath(key: string): string {
  return path.join(RAW_ROOT, key);
}

/** Runs tasks with bounded concurrency, preserving order of results. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
