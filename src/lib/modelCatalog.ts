// [START] Phase 8 — Dynamic MLX model catalog.
// The catalog is loaded at runtime instead of shipped in the bundle so the
// maintainer can add/remove/re-score entries without a new app release:
//
//   1. Remote    — REMOTE_CATALOG_URL (GitHub raw). Cached 24h in
//                  localStorage, falls back silently on any failure.
//   2. Bundled   — /catalog/mlx-models.json is shipped in public/ so the
//                  app always has something to show offline.
//
// The shape below mirrors the JSON schema on disk. Keep backward-compatible
// changes in the schema (new optional fields = ok, renames = bump `version`)
// so older bundles can still read a newer remote file.

import type { OvoModel } from "../types/ovo";

export type ModelKind = "chat" | "code" | "vlm" | "reasoning";

export interface CuratedModel {
  /** HF repo id — passed straight to the download endpoint. */
  repo_id: string;
  /** Short display name for the recommendation row. */
  name: string;
  /** Parameter count in billions (total, not active). */
  paramsB: number;
  /** Active parameters per token, for MoE. Null for dense models. */
  activeParamsB: number | null;
  /** Bytes per parameter for the listed quantization. */
  bytesPerParam: number;
  /** Context window in tokens. */
  contextLength: number;
  /** Author-assigned relative quality (0-100). Calibrate later. */
  qualityScore: number;
  /** Intended role in the catalog. */
  kind: ModelKind;
  /** Short description for the recommendation card. */
  description: string;
  /** Tags for filtering / badges. */
  tags?: string[];
}

// [START] Catalog source paths.
// BUNDLED_CATALOG_URL is served from public/ by Vite, so it's always the
// same origin as the app — no CORS drama. REMOTE_CATALOG_URL is optional;
// set it to a raw github URL once the ovo catalog repo exists, and the
// loader will prefer it over the bundled copy. For now it's null so every
// user gets the bundled list.
const BUNDLED_CATALOG_URL = "/catalog/mlx-models.json";
const REMOTE_CATALOG_URL: string | null = null;
const CACHE_KEY = "ovo:catalog:mlx-models";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
// [END]

interface CatalogFile {
  version: number;
  updated_at?: string;
  models: CuratedModel[];
}

interface CachedCatalog {
  fetched_at: number;
  source: "remote" | "bundled";
  data: CatalogFile;
}

// [START] Cache helpers — localStorage JSON blob with TTL.
function readCache(): CachedCatalog | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedCatalog;
    if (!parsed || typeof parsed !== "object" || !parsed.data) return null;
    if (Date.now() - parsed.fetched_at > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(entry: CachedCatalog): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    /* storage full / private mode — silent */
  }
}
// [END]

// [START] loadCatalog — cache → remote → bundled.
// Always resolves; on total failure it returns an empty array so callers
// can safely `.map()` without null checks. Errors go to console.warn so
// they show up in DevTools without blocking the UI.
export async function loadCatalog(): Promise<CuratedModel[]> {
  const cached = readCache();
  if (cached?.data?.models) {
    return cached.data.models;
  }

  // Try remote first — a successful fetch replaces the cache and wins.
  if (REMOTE_CATALOG_URL) {
    try {
      const resp = await fetch(REMOTE_CATALOG_URL, { cache: "no-store" });
      if (resp.ok) {
        const data = (await resp.json()) as CatalogFile;
        if (Array.isArray(data.models)) {
          writeCache({ fetched_at: Date.now(), source: "remote", data });
          return data.models;
        }
      }
    } catch (e) {
      // Network failure / offline / rate-limited — fall through to bundled.
      console.warn("[catalog] remote fetch failed", e);
    }
  }

  // Bundled copy — always present because public/catalog/mlx-models.json
  // ships with the app.
  try {
    const resp = await fetch(BUNDLED_CATALOG_URL);
    if (resp.ok) {
      const data = (await resp.json()) as CatalogFile;
      if (Array.isArray(data.models)) {
        writeCache({ fetched_at: Date.now(), source: "bundled", data });
        return data.models;
      }
    }
  } catch (e) {
    console.warn("[catalog] bundled fetch failed", e);
  }

  return [];
}

/** Drop the cache so the next loadCatalog() re-fetches. */
export function invalidateCatalogCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* silent */
  }
}
// [END]

// [START] Derived helpers used by the scoring layer.
export function estimateCuratedBytes(c: CuratedModel): number {
  return Math.round(c.paramsB * 1e9 * c.bytesPerParam);
}

export function effectiveParamsB(c: CuratedModel): number {
  return c.activeParamsB ?? c.paramsB;
}

export function isCatalogInstalled(c: CuratedModel, installed: OvoModel[]): boolean {
  return installed.some((m) => m.repo_id === c.repo_id);
}
// [END]
// [END] Phase 8
