// [START] Phase 6.4 — Wiki embedding CRUD layer.
// Stores vectors as JSON text (see migrations/004_embeddings.sql for rationale).
// All ops are keyed by wiki_page_id; cascades on page delete via FK.

import { getDb, nowMs } from "./index";

export interface WikiEmbeddingRow {
  wiki_page_id: string;
  vector_json: string;
  dim: number;
  model: string;
  updated_at: number;
}

export interface WikiEmbedding {
  wiki_page_id: string;
  vector: number[];
  dim: number;
  model: string;
  updated_at: number;
}

function rowToRecord(row: WikiEmbeddingRow): WikiEmbedding | null {
  try {
    const parsed: unknown = JSON.parse(row.vector_json);
    if (!Array.isArray(parsed)) return null;
    const vector = parsed.filter((v): v is number => typeof v === "number");
    if (vector.length !== row.dim) return null;
    return {
      wiki_page_id: row.wiki_page_id,
      vector,
      dim: row.dim,
      model: row.model,
      updated_at: row.updated_at,
    };
  } catch {
    return null;
  }
}

export async function upsertWikiEmbedding(
  wikiPageId: string,
  vector: number[],
  model: string,
): Promise<void> {
  const db = await getDb();
  const dim = vector.length;
  const vectorJson = JSON.stringify(vector);
  const ts = nowMs();
  await db.execute(
    `INSERT INTO wiki_embeddings (wiki_page_id, vector_json, dim, model, updated_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT(wiki_page_id) DO UPDATE SET
       vector_json = excluded.vector_json,
       dim         = excluded.dim,
       model       = excluded.model,
       updated_at  = excluded.updated_at`,
    [wikiPageId, vectorJson, dim, model, ts],
  );
}

export async function deleteWikiEmbedding(wikiPageId: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `DELETE FROM wiki_embeddings WHERE wiki_page_id = $1`,
    [wikiPageId],
  );
}

/** Return every embedding matching the given model (or all, if `model` omitted). */
export async function listWikiEmbeddings(model?: string): Promise<WikiEmbedding[]> {
  const db = await getDb();
  const rows = model
    ? await db.select<WikiEmbeddingRow[]>(
        `SELECT * FROM wiki_embeddings WHERE model = $1`,
        [model],
      )
    : await db.select<WikiEmbeddingRow[]>(`SELECT * FROM wiki_embeddings`);
  const out: WikiEmbedding[] = [];
  for (const row of rows) {
    const rec = rowToRecord(row);
    if (rec) out.push(rec);
  }
  return out;
}

/** Prune vectors that were encoded by a different model than `keepModel`. */
export async function pruneStaleEmbeddings(keepModel: string): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ wiki_page_id: string }[]>(
    `SELECT wiki_page_id FROM wiki_embeddings WHERE model != $1`,
    [keepModel],
  );
  if (rows.length === 0) return 0;
  await db.execute(
    `DELETE FROM wiki_embeddings WHERE model != $1`,
    [keepModel],
  );
  return rows.length;
}
// [END] Phase 6.4
