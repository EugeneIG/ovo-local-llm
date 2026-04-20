-- Phase 8 · Wiki archive + project namespace.
-- archived  : exclude archived pages from default listings, search, and chat
--             retrieval — keeps stale knowledge out of the system prompt
--             without losing the page (one-click revive).
-- project_path : optional namespace so pages created inside one project don't
--             leak into another. NULL = global (visible everywhere); pages
--             created via the Wiki UI inherit the current project_path.
--
-- SQLite cannot add a CHECK constraint via ALTER, so `archived` is enforced
-- in application code (db/wiki.ts archiveWikiPage). The plain integer column
-- is enough for indexing.

ALTER TABLE wiki_pages ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
ALTER TABLE wiki_pages ADD COLUMN project_path TEXT;

CREATE INDEX IF NOT EXISTS idx_wiki_archived ON wiki_pages(archived, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_wiki_project ON wiki_pages(project_path);
