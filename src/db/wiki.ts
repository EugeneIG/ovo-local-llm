// [START] Phase 6.3 — wiki_pages CRUD + FTS5 search helpers.
// Mirrors the db/sessions.ts pattern (getDb singleton, raw SQL, typed rows).
// FTS5 MATCH queries return the top-N pages by keyword relevance; used to
// inject persistent project knowledge into the chat system prompt.
//
// Phase 8 additions:
//   - archived flag (excluded from default queries / chat retrieval)
//   - project_path namespace (NULL = global; otherwise visible only in that
//     project, plus globals)
//   - time-decay weighting in hybrid retrieval (6-month half-life on
//     updated_at)

import { getDb, newId, nowMs } from "./index";

// [START] Phase 6.4 — Wiki tiers. 'note' is raw, 'casebook' is distilled
// patterns / lessons, 'canonical' is vetted project knowledge. Retrieval
// weighs canonical > casebook > note.
export type WikiTier = "note" | "casebook" | "canonical";
export const WIKI_TIERS: ReadonlyArray<WikiTier> = ["note", "casebook", "canonical"];

function isWikiTier(v: unknown): v is WikiTier {
  return v === "note" || v === "casebook" || v === "canonical";
}
// [END]

export interface WikiPageRow {
  id: string;
  title: string;
  slug: string;
  content: string;
  tags_json: string | null;
  category: string | null;
  pinned: number;
  created_at: number;
  updated_at: number;
  tier: string;
  archived: number;
  project_path: string | null;
}

export interface WikiPage {
  id: string;
  title: string;
  slug: string;
  content: string;
  tags: string[];
  category: string | null;
  pinned: boolean;
  tier: WikiTier;
  archived: boolean;
  project_path: string | null;
  created_at: number;
  updated_at: number;
}

function rowToPage(row: WikiPageRow): WikiPage {
  let tags: string[] = [];
  if (row.tags_json) {
    try {
      const parsed: unknown = JSON.parse(row.tags_json);
      if (Array.isArray(parsed)) {
        tags = parsed.filter((t): t is string => typeof t === "string");
      }
    } catch {
      /* invalid tags_json — treat as empty */
    }
  }
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    content: row.content,
    tags,
    category: row.category,
    pinned: row.pinned === 1,
    tier: isWikiTier(row.tier) ? row.tier : "note",
    archived: row.archived === 1,
    project_path: row.project_path,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || `page-${Date.now().toString(36)}`;
}

export interface CreateWikiPageInput {
  title: string;
  content?: string;
  tags?: string[];
  category?: string | null;
  tier?: WikiTier;
  /** Project namespace; NULL/undefined = global. */
  project_path?: string | null;
}

export async function createWikiPage(input: CreateWikiPageInput): Promise<WikiPage> {
  const db = await getDb();
  const id = newId();
  const ts = nowMs();
  const baseSlug = slugify(input.title);

  // Ensure slug uniqueness — if collision, append short id suffix.
  let slug = baseSlug;
  const existing = await db.select<{ id: string }[]>(
    `SELECT id FROM wiki_pages WHERE slug = $1 LIMIT 1`,
    [slug],
  );
  if (existing.length > 0) {
    slug = `${baseSlug}-${id.slice(0, 6)}`;
  }

  const tagsJson = input.tags && input.tags.length > 0 ? JSON.stringify(input.tags) : null;
  const tier: WikiTier = input.tier ?? "note";
  const projectPath = input.project_path ?? null;

  await db.execute(
    `INSERT INTO wiki_pages (id, title, slug, content, tags_json, category, pinned, tier, archived, project_path, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 0, $7, 0, $8, $9, $9)`,
    [id, input.title, slug, input.content ?? "", tagsJson, input.category ?? null, tier, projectPath, ts],
  );
  return {
    id,
    title: input.title,
    slug,
    content: input.content ?? "",
    tags: input.tags ?? [],
    category: input.category ?? null,
    pinned: false,
    tier,
    archived: false,
    project_path: projectPath,
    created_at: ts,
    updated_at: ts,
  };
}

export interface ListWikiOptions {
  /** Include archived pages in the result. Default: false. */
  includeArchived?: boolean;
  /**
   * Restrict to pages matching the given project_path OR global (NULL) pages.
   * Pass `undefined` (default) to skip the filter entirely.
   */
  projectPath?: string | null;
}

export async function listWikiPages(opts: ListWikiOptions = {}): Promise<WikiPage[]> {
  const db = await getDb();
  const conds: string[] = [];
  const params: (string | number | null)[] = [];
  let p = 1;
  if (!opts.includeArchived) {
    conds.push(`archived = 0`);
  }
  if (opts.projectPath !== undefined) {
    if (opts.projectPath === null) {
      conds.push(`project_path IS NULL`);
    } else {
      conds.push(`(project_path IS NULL OR project_path = $${p++})`);
      params.push(opts.projectPath);
    }
  }
  const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = await db.select<WikiPageRow[]>(
    `SELECT * FROM wiki_pages ${where} ORDER BY pinned DESC, updated_at DESC`,
    params,
  );
  return rows.map(rowToPage);
}

export async function getWikiPage(id: string): Promise<WikiPage | null> {
  const db = await getDb();
  const rows = await db.select<WikiPageRow[]>(
    `SELECT * FROM wiki_pages WHERE id = $1`,
    [id],
  );
  return rows[0] ? rowToPage(rows[0]) : null;
}

export interface UpdateWikiPageInput {
  title?: string;
  content?: string;
  tags?: string[];
  category?: string | null;
  pinned?: boolean;
  tier?: WikiTier;
  archived?: boolean;
  project_path?: string | null;
}

export async function updateWikiPage(id: string, patch: UpdateWikiPageInput): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  let p = 1;
  if (patch.title !== undefined) {
    sets.push(`title = $${p++}`);
    params.push(patch.title);
  }
  if (patch.content !== undefined) {
    sets.push(`content = $${p++}`);
    params.push(patch.content);
  }
  if (patch.tags !== undefined) {
    sets.push(`tags_json = $${p++}`);
    params.push(patch.tags.length > 0 ? JSON.stringify(patch.tags) : null);
  }
  if (patch.category !== undefined) {
    sets.push(`category = $${p++}`);
    params.push(patch.category);
  }
  if (patch.pinned !== undefined) {
    sets.push(`pinned = $${p++}`);
    params.push(patch.pinned ? 1 : 0);
  }
  if (patch.tier !== undefined) {
    sets.push(`tier = $${p++}`);
    params.push(patch.tier);
  }
  if (patch.archived !== undefined) {
    sets.push(`archived = $${p++}`);
    params.push(patch.archived ? 1 : 0);
  }
  if (patch.project_path !== undefined) {
    sets.push(`project_path = $${p++}`);
    params.push(patch.project_path);
  }
  if (sets.length === 0) return;
  sets.push(`updated_at = $${p++}`);
  params.push(nowMs());
  params.push(id);
  await db.execute(
    `UPDATE wiki_pages SET ${sets.join(", ")} WHERE id = $${p}`,
    params,
  );
}

/** One-shot archive toggle. Returns the new archived state. */
export async function archiveWikiPage(id: string, archived: boolean): Promise<void> {
  await updateWikiPage(id, { archived });
}

export async function deleteWikiPage(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM wiki_pages WHERE id = $1`, [id]);
}

// [START] Phase 6.4 — embeddings + hybrid search dependencies.
import { listWikiEmbeddings } from "./embeddings";
import { cosineSimilarity, embedTexts } from "../lib/embeddings";
// [END]

// ── Search options shared across FTS / semantic / hybrid ────────────────────
export interface SearchWikiOptions {
  limit?: number;
  /** Project namespace filter — pages with project_path = this OR NULL. */
  projectPath?: string | null;
  /** Default false — archived pages stay out of retrieval. */
  includeArchived?: boolean;
}

// [START] FTS5 search — ranks by bm25. Empty query returns [] (caller should
// fall back to listWikiPages for the full catalog). Special characters in
// query are escaped by wrapping in double quotes, letting FTS5 treat it as a
// phrase; callers can still pass multi-word keywords.
export async function searchWikiPages(
  query: string,
  opts: SearchWikiOptions | number = {},
): Promise<WikiPage[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const options: SearchWikiOptions =
    typeof opts === "number" ? { limit: opts } : opts;
  const limit = options.limit ?? 10;
  const db = await getDb();
  const escaped = trimmed.replace(/"/g, '""');
  const ftsQuery = `"${escaped}"`;

  const conds: string[] = [`wiki_fts MATCH $1`];
  const params: (string | number | null)[] = [ftsQuery];
  let p = 2;
  if (!options.includeArchived) conds.push(`p.archived = 0`);
  if (options.projectPath !== undefined) {
    if (options.projectPath === null) {
      conds.push(`p.project_path IS NULL`);
    } else {
      conds.push(`(p.project_path IS NULL OR p.project_path = $${p++})`);
      params.push(options.projectPath);
    }
  }
  params.push(limit);

  // Canonical pages rank first, then casebook, then raw notes. Within a
  // tier FTS5's bm25 handles relevance; pinned + recency break ties.
  const rows = await db.select<WikiPageRow[]>(
    `SELECT p.*
       FROM wiki_fts f
       JOIN wiki_pages p ON p.rowid = f.rowid
      WHERE ${conds.join(" AND ")}
      ORDER BY
        CASE p.tier
          WHEN 'canonical' THEN 0
          WHEN 'casebook' THEN 1
          ELSE 2
        END,
        bm25(wiki_fts),
        p.pinned DESC,
        p.updated_at DESC
      LIMIT $${p}`,
    params,
  );
  return rows.map(rowToPage);
}
// [END]

// [START] Phase 6.4 — semantic search: encode the query via the sidecar and
// rank stored page vectors by cosine similarity. Returns [] when the sidecar
// is unavailable (embed endpoint 501 / port not set) so the caller can fall
// back to FTS cleanly.
export interface SemanticHit {
  page: WikiPage;
  score: number;
}

export async function semanticSearchWikiPages(
  query: string,
  opts: SearchWikiOptions | number = {},
): Promise<SemanticHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const options: SearchWikiOptions =
    typeof opts === "number" ? { limit: opts } : opts;
  const limit = options.limit ?? 10;

  const encoded = await embedTexts([trimmed]);
  if (!encoded || encoded.embeddings.length === 0) return [];
  const queryVec = encoded.embeddings[0];

  const stored = await listWikiEmbeddings(encoded.model);
  if (stored.length === 0) return [];

  const scored: { id: string; score: number }[] = [];
  for (const e of stored) {
    if (e.dim !== queryVec.length) continue;
    scored.push({ id: e.wiki_page_id, score: cosineSimilarity(queryVec, e.vector) });
  }
  if (scored.length === 0) return [];
  scored.sort((a, b) => b.score - a.score);
  // Pull a wider candidate window before filtering so namespace/archive cuts
  // don't starve the result set.
  const candidateWindow = Math.max(limit * 4, 32);
  const top = scored.slice(0, candidateWindow);

  const db = await getDb();
  const placeholders = top.map((_, i) => `$${i + 1}`).join(", ");
  const rows = await db.select<WikiPageRow[]>(
    `SELECT * FROM wiki_pages WHERE id IN (${placeholders})`,
    top.map((t) => t.id),
  );
  const byId = new Map<string, WikiPage>();
  for (const row of rows) byId.set(row.id, rowToPage(row));

  const hits: SemanticHit[] = [];
  for (const t of top) {
    const page = byId.get(t.id);
    if (!page) continue;
    if (!options.includeArchived && page.archived) continue;
    if (
      options.projectPath !== undefined &&
      page.project_path !== null &&
      page.project_path !== options.projectPath
    ) {
      continue;
    }
    hits.push({ page, score: t.score });
    if (hits.length >= limit) break;
  }
  return hits;
}

// [START] Phase 8 — Time-decay multiplier. updated_at recency boost with a
// 6-month (180-day) half-life. Pinned pages get a 1.25x kicker so they
// outrank fresher-but-unmarked pages. Used in hybrid scoring only —
// stand-alone FTS / semantic preserve their own ordering.
const HALF_LIFE_MS = 180 * 24 * 60 * 60 * 1000;

function recencyDecay(updatedAt: number, now = nowMs()): number {
  const ageMs = Math.max(0, now - updatedAt);
  return Math.pow(0.5, ageMs / HALF_LIFE_MS);
}

function pinnedKicker(page: WikiPage): number {
  return page.pinned ? 1.25 : 1;
}
// [END]

// Hybrid retrieval: merges BM25 FTS hits with cosine-ranked semantic hits.
// Each candidate gets a normalized score:
//   FTS rank  → linear 1.0 → 0.5 across positions
//   Semantic  → raw cosine similarity (already 0..1 for sentence-transformer)
// The two are summed when a page wins on both lists (so dual-recall pages
// dominate), then multiplied by a recency decay + pinned kicker. Top-N by
// final score wins.
export async function hybridSearchWikiPages(
  query: string,
  opts: SearchWikiOptions | number = {},
): Promise<WikiPage[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const options: SearchWikiOptions =
    typeof opts === "number" ? { limit: opts } : opts;
  const limit = options.limit ?? 10;

  const wide: SearchWikiOptions = { ...options, limit: Math.max(limit * 2, 16) };
  const [ftsHits, semanticHits] = await Promise.all([
    searchWikiPages(trimmed, wide),
    semanticSearchWikiPages(trimmed, wide),
  ]);

  const scoreById = new Map<string, { page: WikiPage; score: number }>();
  ftsHits.forEach((page, i) => {
    const ftsScore = 1 - (i / Math.max(ftsHits.length, 1)) * 0.5;
    scoreById.set(page.id, { page, score: ftsScore });
  });
  for (const hit of semanticHits) {
    const existing = scoreById.get(hit.page.id);
    if (existing) {
      existing.score += Math.max(0, hit.score);
    } else {
      scoreById.set(hit.page.id, { page: hit.page, score: Math.max(0, hit.score) });
    }
  }

  const now = nowMs();
  const ranked = Array.from(scoreById.values()).map(({ page, score }) => ({
    page,
    score: score * recencyDecay(page.updated_at, now) * pinnedKicker(page),
  }));
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, limit).map((r) => r.page);
}
// [END] Phase 6.4

// [START] Phase 8 — Cross-link parser + backlink index.
// Pages can reference each other via `[[slug]]` or `[[Page Title]]` markdown.
// extractBacklinks pulls every reference out of a body; getBacklinks finds
// every page that points at a given target (slug OR exact title match,
// case-insensitive). This powers the backlinks panel in WikiPane and the
// orphan check in lintWiki.
const BACKLINK_RE = /\[\[([^\]\n]+?)\]\]/g;

export function extractBacklinks(content: string): string[] {
  const out = new Set<string>();
  const matches = content.matchAll(BACKLINK_RE);
  for (const m of matches) {
    const target = m[1].trim();
    if (target) out.add(target);
  }
  return [...out];
}

function normalizeBacklinkTarget(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "").trim();
}

export interface BacklinkHit {
  page: WikiPage;
  /** Number of distinct references inside that page (≥1). */
  count: number;
}

export async function getBacklinks(target: string): Promise<BacklinkHit[]> {
  const trimmed = target.trim();
  if (!trimmed) return [];
  const targetSlugNorm = normalizeBacklinkTarget(trimmed);
  // Pull the full catalog (incl. archived — caller decides what to surface).
  const all = await listWikiPages({ includeArchived: true });
  const hits: BacklinkHit[] = [];
  for (const p of all) {
    const refs = extractBacklinks(p.content);
    let count = 0;
    for (const r of refs) {
      if (normalizeBacklinkTarget(r) === targetSlugNorm) count++;
      else if (r === trimmed) count++;
    }
    if (count > 0) hits.push({ page: p, count });
  }
  return hits;
}
// [END]

// [START] Phase 8 — Wiki lint.
// Surfaces four kinds of hygiene issues so the user can curate the knowledge
// base. All thresholds default to handover-spec values but are tunable.
//   orphan    — no other page references this page via [[slug]] / [[title]]
//               (pinned pages are exempt — pins act as intentional roots)
//   stale     — older than `staleDays` since last update (default 180d)
//   oversized — content longer than `oversizedChars` (default 8000)
//   duplicate — title collides with another page after normalization
//
// Archived pages are skipped entirely — they're already triaged.
export type LintCategory = "orphan" | "stale" | "oversized" | "duplicate";

export interface LintIssue {
  category: LintCategory;
  page_id: string;
  page_title: string;
  page_slug: string;
  detail: string;
}

export interface LintOptions {
  now?: number;
  staleDays?: number;
  oversizedChars?: number;
}

export async function lintWiki(opts: LintOptions = {}): Promise<LintIssue[]> {
  const now = opts.now ?? nowMs();
  const staleMs = (opts.staleDays ?? 180) * 24 * 60 * 60 * 1000;
  const oversized = opts.oversizedChars ?? 8000;
  const all = await listWikiPages({ includeArchived: false });

  // Build backlink target → ref count
  const refCount = new Map<string, number>();
  for (const p of all) {
    for (const target of extractBacklinks(p.content)) {
      const key = normalizeBacklinkTarget(target);
      refCount.set(key, (refCount.get(key) ?? 0) + 1);
    }
  }

  const issues: LintIssue[] = [];
  const monthMs = 30 * 24 * 60 * 60 * 1000;

  for (const p of all) {
    const slugKey = normalizeBacklinkTarget(p.slug);
    const titleKey = normalizeBacklinkTarget(p.title);
    const referenced = (refCount.get(slugKey) ?? 0) + (refCount.get(titleKey) ?? 0);
    if (!p.pinned && referenced === 0) {
      issues.push({
        category: "orphan",
        page_id: p.id,
        page_title: p.title,
        page_slug: p.slug,
        detail: "no backlinks",
      });
    }

    const ageMs = Math.max(0, now - p.updated_at);
    if (ageMs > staleMs) {
      const months = Math.max(1, Math.floor(ageMs / monthMs));
      issues.push({
        category: "stale",
        page_id: p.id,
        page_title: p.title,
        page_slug: p.slug,
        detail: `${months}mo since update`,
      });
    }

    if (p.content.length > oversized) {
      issues.push({
        category: "oversized",
        page_id: p.id,
        page_title: p.title,
        page_slug: p.slug,
        detail: `${p.content.length} chars (>${oversized})`,
      });
    }
  }

  // Duplicate titles (after normalization)
  const titleBuckets = new Map<string, WikiPage[]>();
  for (const p of all) {
    const key = normalizeBacklinkTarget(p.title);
    if (!key) continue;
    const arr = titleBuckets.get(key) ?? [];
    arr.push(p);
    titleBuckets.set(key, arr);
  }
  for (const arr of titleBuckets.values()) {
    if (arr.length < 2) continue;
    for (const p of arr) {
      const others = arr.filter((x) => x.id !== p.id).map((x) => x.title).join(", ");
      issues.push({
        category: "duplicate",
        page_id: p.id,
        page_title: p.title,
        page_slug: p.slug,
        detail: `also: ${others}`,
      });
    }
  }

  return issues;
}
// [END]
// [END]
