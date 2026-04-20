-- Phase 6.4 · Wiki embedding cache.
-- Stores one vector per wiki page so the frontend can perform local semantic
-- search and blend hits with FTS5 BM25 ranking. Vectors are JSON-encoded as
-- plain text to avoid the Tauri SQL plugin's BLOB-binding quirks; storage
-- overhead is acceptable for the expected page count (<few thousand).
--
-- Schema is decoupled from wiki_pages on purpose: re-embedding on a model
-- change only touches this table, and a page with no row here simply falls
-- back to FTS-only retrieval.

CREATE TABLE IF NOT EXISTS wiki_embeddings (
  wiki_page_id TEXT PRIMARY KEY,
  vector_json  TEXT    NOT NULL,
  dim          INTEGER NOT NULL,
  model        TEXT    NOT NULL,
  updated_at   INTEGER NOT NULL,
  FOREIGN KEY (wiki_page_id) REFERENCES wiki_pages(id) ON DELETE CASCADE
);

-- Index on model lets us cheaply prune stale vectors when the user swaps
-- the default embedding model.
CREATE INDEX IF NOT EXISTS idx_wiki_embeddings_model ON wiki_embeddings(model);
