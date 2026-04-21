from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

KST = timezone(offset=__import__("datetime").timedelta(hours=9))


def _now_kst() -> str:
    return datetime.now(KST).isoformat()


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


def file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


@dataclass
class ParsedSection:
    title: str
    heading_level: int
    page: int | None = None
    byte_offset: int = 0


@dataclass
class ParsedTable:
    page: int | None = None
    rows: int = 0
    cols: int = 0


@dataclass
class ParsedDocument:
    doc_id: str = field(default_factory=_new_id)
    filename: str = ""
    mime: str = ""
    source_path: str = ""
    file_hash: str = ""
    pages: int = 0
    full_text: str = ""
    sections: list[ParsedSection] = field(default_factory=list)
    tables: list[ParsedTable] = field(default_factory=list)
    tokens_estimate: int = 0
    parsed_at: str = field(default_factory=_now_kst)
    warnings: list[str] = field(default_factory=list)


@dataclass
class Chunk:
    chunk_id: str = field(default_factory=_new_id)
    doc_id: str = ""
    chunk_index: int = 0
    text: str = ""
    token_count: int = 0
    section_title: str = ""
    page_from: int | None = None
    page_to: int | None = None


@dataclass
class KnowledgeBase:
    kb_id: str = field(default_factory=_new_id)
    name: str = ""
    created_at: str = field(default_factory=_now_kst)
    embedder_model: str = "BAAI/bge-m3"
    chunk_size: int = 512
    chunk_overlap: int = 100
    doc_count: int = 0
    chunk_count: int = 0


@dataclass
class IngestTask:
    task_id: str = field(default_factory=_new_id)
    kb_id: str = ""
    status: str = "pending"
    progress: float = 0.0
    parsed: int = 0
    total: int = 0
    error: str | None = None
    current_file: str = ""
