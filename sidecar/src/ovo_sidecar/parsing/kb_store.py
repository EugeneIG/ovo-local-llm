"""Knowledge Base store — All-in-SQLite with LRU memory cache.

Manages documents, chunks, and metadata for RAG retrieval.
Vector operations require sqlite-vec extension (loaded lazily).
"""
from __future__ import annotations

import json
import logging
import sqlite3
from collections import OrderedDict
from pathlib import Path
from threading import Lock

from ovo_sidecar.config import settings
from ovo_sidecar.parsing.models import (
    Chunk,
    KnowledgeBase,
    ParsedDocument,
    _new_id,
    _now_kst,
)

logger = logging.getLogger(__name__)

_LRU_MAX = 50

_SCHEMA_SQL = """
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = -64000;
PRAGMA mmap_size = 268435456;
PRAGMA temp_store = MEMORY;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS kb_meta (
  kb_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  embedder_model TEXT DEFAULT 'BAAI/bge-m3',
  chunk_size INTEGER DEFAULT 512,
  chunk_overlap INTEGER DEFAULT 100,
  doc_count INTEGER DEFAULT 0,
  chunk_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS documents (
  doc_id TEXT PRIMARY KEY,
  kb_id TEXT NOT NULL,
  filename TEXT,
  mime TEXT,
  source_path TEXT,
  file_hash TEXT,
  pages INTEGER DEFAULT 0,
  tokens_estimate INTEGER DEFAULT 0,
  full_text TEXT NOT NULL,
  sections_json TEXT,
  tables_json TEXT,
  parsed_at TEXT,
  last_accessed TEXT,
  FOREIGN KEY (kb_id) REFERENCES kb_meta(kb_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_documents_kb ON documents(kb_id);
CREATE INDEX IF NOT EXISTS idx_documents_hash ON documents(file_hash);

CREATE TABLE IF NOT EXISTS chunks (
  chunk_id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  chunk_index INTEGER,
  text TEXT NOT NULL,
  token_count INTEGER DEFAULT 0,
  section_title TEXT,
  page_from INTEGER,
  page_to INTEGER,
  FOREIGN KEY (doc_id) REFERENCES documents(doc_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(doc_id);
"""


class KBStore:
    def __init__(self, db_path: Path | None = None):
        self._db_path = db_path or self._default_db_path()
        self._conn: sqlite3.Connection | None = None
        self._lock = Lock()
        self._text_cache: OrderedDict[str, str] = OrderedDict()

    @staticmethod
    def _default_db_path() -> Path:
        return settings.data_dir / "kb" / "kb.db"

    def _ensure_conn(self) -> sqlite3.Connection:
        if self._conn is None:
            self._db_path.parent.mkdir(parents=True, exist_ok=True)
            self._conn = sqlite3.connect(str(self._db_path), check_same_thread=False)
            self._conn.row_factory = sqlite3.Row
            self._conn.executescript(_SCHEMA_SQL)
            logger.info("KB store opened: %s", self._db_path)
        return self._conn

    def close(self) -> None:
        if self._conn:
            self._conn.close()
            self._conn = None

    # ── KB CRUD ──────────────────────────────────────────────

    def create_kb(self, name: str) -> KnowledgeBase:
        kb = KnowledgeBase(kb_id=_new_id(), name=name, created_at=_now_kst())
        with self._lock:
            conn = self._ensure_conn()
            conn.execute(
                "INSERT INTO kb_meta (kb_id, name, created_at) VALUES (?, ?, ?)",
                (kb.kb_id, kb.name, kb.created_at),
            )
            conn.commit()
        logger.info("Created KB: %s (%s)", kb.name, kb.kb_id)
        return kb

    def list_kbs(self) -> list[KnowledgeBase]:
        with self._lock:
            conn = self._ensure_conn()
            rows = conn.execute("SELECT * FROM kb_meta ORDER BY created_at DESC").fetchall()
        return [
            KnowledgeBase(
                kb_id=r["kb_id"],
                name=r["name"],
                created_at=r["created_at"],
                embedder_model=r["embedder_model"] or "BAAI/bge-m3",
                chunk_size=r["chunk_size"] or 512,
                chunk_overlap=r["chunk_overlap"] or 100,
                doc_count=r["doc_count"] or 0,
                chunk_count=r["chunk_count"] or 0,
            )
            for r in rows
        ]

    def get_kb(self, kb_id: str) -> KnowledgeBase | None:
        with self._lock:
            conn = self._ensure_conn()
            r = conn.execute("SELECT * FROM kb_meta WHERE kb_id = ?", (kb_id,)).fetchone()
        if not r:
            return None
        return KnowledgeBase(
            kb_id=r["kb_id"], name=r["name"], created_at=r["created_at"],
            embedder_model=r["embedder_model"] or "BAAI/bge-m3",
            chunk_size=r["chunk_size"] or 512, chunk_overlap=r["chunk_overlap"] or 100,
            doc_count=r["doc_count"] or 0, chunk_count=r["chunk_count"] or 0,
        )

    def delete_kb(self, kb_id: str) -> bool:
        with self._lock:
            conn = self._ensure_conn()
            cur = conn.execute("DELETE FROM kb_meta WHERE kb_id = ?", (kb_id,))
            conn.commit()
        return cur.rowcount > 0

    # ── Document CRUD ────────────────────────────────────────

    def add_document(self, kb_id: str, doc: ParsedDocument) -> str:
        sections_json = json.dumps(
            [{"title": s.title, "level": s.heading_level, "page": s.page} for s in doc.sections],
            ensure_ascii=False,
        )
        tables_json = json.dumps(
            [{"page": t.page, "rows": t.rows, "cols": t.cols} for t in doc.tables],
            ensure_ascii=False,
        )
        now = _now_kst()
        with self._lock:
            conn = self._ensure_conn()
            conn.execute(
                """INSERT OR REPLACE INTO documents
                   (doc_id, kb_id, filename, mime, source_path, file_hash,
                    pages, tokens_estimate, full_text, sections_json, tables_json,
                    parsed_at, last_accessed)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (doc.doc_id, kb_id, doc.filename, doc.mime, doc.source_path,
                 doc.file_hash, doc.pages, doc.tokens_estimate, doc.full_text,
                 sections_json, tables_json, doc.parsed_at, now),
            )
            conn.execute(
                "UPDATE kb_meta SET doc_count = (SELECT COUNT(*) FROM documents WHERE kb_id = ?) WHERE kb_id = ?",
                (kb_id, kb_id),
            )
            conn.commit()

        self._text_cache[doc.doc_id] = doc.full_text
        self._evict_cache()
        return doc.doc_id

    def get_document_text(self, doc_id: str) -> str | None:
        if doc_id in self._text_cache:
            self._text_cache.move_to_end(doc_id)
            return self._text_cache[doc_id]

        with self._lock:
            conn = self._ensure_conn()
            row = conn.execute(
                "SELECT full_text FROM documents WHERE doc_id = ?", (doc_id,)
            ).fetchone()
            if row:
                conn.execute(
                    "UPDATE documents SET last_accessed = ? WHERE doc_id = ?",
                    (_now_kst(), doc_id),
                )
                conn.commit()

        if not row:
            return None

        text = row["full_text"]
        self._text_cache[doc_id] = text
        self._evict_cache()
        return text

    def find_by_hash(self, kb_id: str, fhash: str) -> str | None:
        """Return doc_id if a document with this hash already exists in KB."""
        with self._lock:
            conn = self._ensure_conn()
            row = conn.execute(
                "SELECT doc_id FROM documents WHERE kb_id = ? AND file_hash = ?",
                (kb_id, fhash),
            ).fetchone()
        return row["doc_id"] if row else None

    def delete_document(self, doc_id: str) -> bool:
        with self._lock:
            conn = self._ensure_conn()
            row = conn.execute("SELECT kb_id FROM documents WHERE doc_id = ?", (doc_id,)).fetchone()
            if not row:
                return False
            kb_id = row["kb_id"]
            conn.execute("DELETE FROM documents WHERE doc_id = ?", (doc_id,))
            conn.execute(
                "UPDATE kb_meta SET doc_count = (SELECT COUNT(*) FROM documents WHERE kb_id = ?), "
                "chunk_count = (SELECT COUNT(*) FROM chunks c JOIN documents d ON c.doc_id = d.doc_id WHERE d.kb_id = ?) "
                "WHERE kb_id = ?",
                (kb_id, kb_id, kb_id),
            )
            conn.commit()
        self._text_cache.pop(doc_id, None)
        return True

    def list_documents(self, kb_id: str) -> list[dict]:
        with self._lock:
            conn = self._ensure_conn()
            rows = conn.execute(
                "SELECT doc_id, filename, mime, pages, tokens_estimate, parsed_at "
                "FROM documents WHERE kb_id = ? ORDER BY parsed_at DESC",
                (kb_id,),
            ).fetchall()
        return [dict(r) for r in rows]

    # ── Chunk CRUD ───────────────────────────────────────────

    def add_chunks(self, chunks: list[Chunk]) -> int:
        if not chunks:
            return 0
        with self._lock:
            conn = self._ensure_conn()
            conn.executemany(
                """INSERT OR REPLACE INTO chunks
                   (chunk_id, doc_id, chunk_index, text, token_count,
                    section_title, page_from, page_to)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                [
                    (c.chunk_id, c.doc_id, c.chunk_index, c.text,
                     c.token_count, c.section_title, c.page_from, c.page_to)
                    for c in chunks
                ],
            )
            if chunks:
                doc_id = chunks[0].doc_id
                row = conn.execute("SELECT kb_id FROM documents WHERE doc_id = ?", (doc_id,)).fetchone()
                if row:
                    kb_id = row["kb_id"]
                    conn.execute(
                        "UPDATE kb_meta SET chunk_count = "
                        "(SELECT COUNT(*) FROM chunks c JOIN documents d ON c.doc_id = d.doc_id WHERE d.kb_id = ?) "
                        "WHERE kb_id = ?",
                        (kb_id, kb_id),
                    )
            conn.commit()
        return len(chunks)

    def get_chunks_for_doc(self, doc_id: str) -> list[Chunk]:
        with self._lock:
            conn = self._ensure_conn()
            rows = conn.execute(
                "SELECT * FROM chunks WHERE doc_id = ? ORDER BY chunk_index", (doc_id,)
            ).fetchall()
        return [
            Chunk(
                chunk_id=r["chunk_id"], doc_id=r["doc_id"],
                chunk_index=r["chunk_index"], text=r["text"],
                token_count=r["token_count"], section_title=r["section_title"] or "",
                page_from=r["page_from"], page_to=r["page_to"],
            )
            for r in rows
        ]

    def search_chunks_text(self, kb_id: str, query: str, top_k: int = 10) -> list[dict]:
        """Keyword fallback search (no embeddings). Uses SQLite FTS if available, else LIKE."""
        words = [w.strip() for w in query.split() if w.strip()]
        if not words:
            return []

        like_clauses = " AND ".join(["c.text LIKE ?"] * len(words))
        params = [f"%{w}%" for w in words]

        with self._lock:
            conn = self._ensure_conn()
            rows = conn.execute(
                f"SELECT c.chunk_id, c.text, c.section_title, c.page_from, c.doc_id, d.filename "
                f"FROM chunks c JOIN documents d ON c.doc_id = d.doc_id "
                f"WHERE d.kb_id = ? AND {like_clauses} "
                f"ORDER BY c.chunk_index LIMIT ?",
                [kb_id, *params, top_k],
            ).fetchall()
        return [dict(r) for r in rows]

    # ── Cache management ─────────────────────────────────────

    def _evict_cache(self) -> None:
        while len(self._text_cache) > _LRU_MAX:
            self._text_cache.popitem(last=False)

    def prewarm(self, kb_id: str, limit: int = 10) -> None:
        with self._lock:
            conn = self._ensure_conn()
            rows = conn.execute(
                "SELECT doc_id, full_text FROM documents WHERE kb_id = ? "
                "ORDER BY last_accessed DESC LIMIT ?",
                (kb_id, limit),
            ).fetchall()
        for r in rows:
            self._text_cache[r["doc_id"]] = r["full_text"]
        self._evict_cache()


kb_store = KBStore()
