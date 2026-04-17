-- Phase 6.3 · persistent wiki for long-lived project knowledge.
-- Pages are free-form markdown the user curates (or that gets promoted from
-- chat summaries) and are available to future sessions via keyword retrieval
-- into the system prompt. Full-text search via SQLite FTS5.

CREATE TABLE IF NOT EXISTS wiki_pages (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  content     TEXT NOT NULL DEFAULT '',
  tags_json   TEXT,                -- JSON array of strings, or NULL
  category    TEXT,                -- optional grouping ("project", "note", "cheatsheet"…)
  pinned      INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wiki_updated  ON wiki_pages(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_wiki_pinned   ON wiki_pages(pinned DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_wiki_category ON wiki_pages(category);

-- FTS5 virtual table kept in sync by triggers below. Search hits across
-- title / content / tags; slug is stored unindexed so we can return it
-- without an extra join.
CREATE VIRTUAL TABLE IF NOT EXISTS wiki_fts USING fts5(
  title,
  content,
  tags,
  slug UNINDEXED,
  content='wiki_pages',
  content_rowid='rowid'
);

-- Rebuild-trigger pattern: AFTER INSERT / UPDATE / DELETE on wiki_pages,
-- push the change into wiki_fts. tags_json is serialized to a space-joined
-- string so FTS5 tokenizes each tag independently.
CREATE TRIGGER IF NOT EXISTS wiki_pages_ai AFTER INSERT ON wiki_pages BEGIN
  INSERT INTO wiki_fts(rowid, title, content, tags, slug)
  VALUES (
    new.rowid,
    new.title,
    new.content,
    COALESCE(REPLACE(REPLACE(REPLACE(new.tags_json, '[', ''), ']', ''), ',', ' '), ''),
    new.slug
  );
END;

CREATE TRIGGER IF NOT EXISTS wiki_pages_ad AFTER DELETE ON wiki_pages BEGIN
  INSERT INTO wiki_fts(wiki_fts, rowid, title, content, tags, slug)
  VALUES ('delete', old.rowid, old.title, old.content,
    COALESCE(REPLACE(REPLACE(REPLACE(old.tags_json, '[', ''), ']', ''), ',', ' '), ''),
    old.slug);
END;

CREATE TRIGGER IF NOT EXISTS wiki_pages_au AFTER UPDATE ON wiki_pages BEGIN
  INSERT INTO wiki_fts(wiki_fts, rowid, title, content, tags, slug)
  VALUES ('delete', old.rowid, old.title, old.content,
    COALESCE(REPLACE(REPLACE(REPLACE(old.tags_json, '[', ''), ']', ''), ',', ' '), ''),
    old.slug);
  INSERT INTO wiki_fts(rowid, title, content, tags, slug)
  VALUES (
    new.rowid,
    new.title,
    new.content,
    COALESCE(REPLACE(REPLACE(REPLACE(new.tags_json, '[', ''), ']', ''), ',', ' '), ''),
    new.slug
  );
END;
