/**
 * Simple file-based cache for Are.na API results.
 * Avoids re-fetching identical queries within a TTL window.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, unlinkSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";

const CACHE_DIR = join(import.meta.dir, "..", "data", "cache");
const DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 minutes

const ensureDir = () => {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
};

const cacheKey = (query: string, params: string = ""): string => {
  const hash = createHash("md5")
    .update(`${query}|${params}`)
    .digest("hex")
    .slice(0, 12);
  return hash;
};

interface CacheEntry {
  query: string;
  params: string;
  timestamp: number;
  data: unknown;
}

export const get = (
  query: string,
  params: string = "",
  ttlMs: number = DEFAULT_TTL_MS
): unknown | null => {
  ensureDir();
  const key = cacheKey(query, params);
  const path = join(CACHE_DIR, `${key}.json`);

  if (!existsSync(path)) return null;

  try {
    const entry: CacheEntry = JSON.parse(readFileSync(path, "utf-8"));
    if (Date.now() - entry.timestamp > ttlMs) {
      unlinkSync(path);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
};

export const set = (
  query: string,
  params: string = "",
  data: unknown
): void => {
  ensureDir();
  const key = cacheKey(query, params);
  const path = join(CACHE_DIR, `${key}.json`);

  const entry: CacheEntry = {
    query,
    params,
    timestamp: Date.now(),
    data,
  };

  writeFileSync(path, JSON.stringify(entry, null, 2));
};

export const prune = (ttlMs: number = DEFAULT_TTL_MS): number => {
  ensureDir();
  let removed = 0;
  const files = readdirSync(CACHE_DIR).filter((f) => f.endsWith(".json"));

  for (const file of files) {
    const path = join(CACHE_DIR, file);
    try {
      const stat = statSync(path);
      if (Date.now() - stat.mtimeMs > ttlMs) {
        unlinkSync(path);
        removed++;
      }
    } catch {}
  }

  return removed;
};

export const clear = (): number => {
  ensureDir();
  const files = readdirSync(CACHE_DIR).filter((f) => f.endsWith(".json"));
  for (const f of files) {
    try {
      unlinkSync(join(CACHE_DIR, f));
    } catch {}
  }
  return files.length;
};
