"""Parsing + Knowledge Base API endpoints.

Routes:
  POST /ovo/parse              — one-shot file parse (multipart upload)
  GET  /ovo/parse/status       — kordoc install status
  POST /ovo/parse/install      — trigger kordoc + Node install

  POST /ovo/kb                 — create KB
  GET  /ovo/kb                 — list KBs
  GET  /ovo/kb/{kb_id}         — get KB details
  DELETE /ovo/kb/{kb_id}       — delete KB

  POST /ovo/kb/{kb_id}/ingest  — add files to KB (background)
  GET  /ovo/kb/{kb_id}/ingest/{task_id} — ingest progress
  GET  /ovo/kb/{kb_id}/docs    — list documents in KB
  DELETE /ovo/kb/{kb_id}/doc/{doc_id} — delete document

  POST /ovo/kb/{kb_id}/search  — RAG keyword search
"""
from __future__ import annotations

import asyncio
import logging
import tempfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel

from ovo_sidecar.parsing import kordoc_installer
from ovo_sidecar.parsing.dispatcher import parse_file, parse_bytes, is_supported, SUPPORTED_EXTENSIONS
from ovo_sidecar.parsing.kb_store import kb_store
from ovo_sidecar.parsing.chunker import chunk_document
from ovo_sidecar.parsing.models import IngestTask, file_hash

logger = logging.getLogger(__name__)

router = APIRouter(tags=["parsing"])

_ingest_tasks: dict[str, IngestTask] = {}


# ── Parse endpoints ──────────────────────────────────────────

@router.get("/parse/status")
async def parse_status() -> dict:
    return kordoc_installer.status()


@router.post("/parse/install")
async def parse_install() -> dict:
    events: list[dict] = []
    try:
        await kordoc_installer.ensure_ready(on_progress=lambda e: events.append(e))
        return {"success": True, "ready": kordoc_installer.is_ready(), "events": events}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class ParseResponse(BaseModel):
    doc_id: str
    filename: str
    mime: str
    pages: int
    tokens_estimate: int
    full_text: str
    sections: list[dict[str, Any]]
    tables: list[dict[str, Any]]
    warnings: list[str]


@router.post("/parse", response_model=ParseResponse)
async def parse_upload(file: UploadFile = File(...)) -> ParseResponse:
    if not kordoc_installer.is_ready():
        raise HTTPException(status_code=503, detail="kordoc not installed — POST /ovo/parse/install first")

    filename = file.filename or "untitled"
    ext = Path(filename).suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported format: {ext}. Supported: {sorted(SUPPORTED_EXTENSIONS)}")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")

    try:
        doc = await parse_bytes(data, filename)
    except Exception as e:
        logger.exception("Parse failed for %s", filename)
        raise HTTPException(status_code=500, detail=str(e))

    return ParseResponse(
        doc_id=doc.doc_id,
        filename=doc.filename,
        mime=doc.mime,
        pages=doc.pages,
        tokens_estimate=doc.tokens_estimate,
        full_text=doc.full_text,
        sections=[{"title": s.title, "level": s.heading_level, "page": s.page} for s in doc.sections],
        tables=[{"page": t.page, "rows": t.rows, "cols": t.cols} for t in doc.tables],
        warnings=doc.warnings,
    )


# ── KB endpoints ─────────────────────────────────────────────

class CreateKBRequest(BaseModel):
    name: str


class SearchRequest(BaseModel):
    query: str
    top_k: int = 5


@router.post("/kb")
async def create_kb(req: CreateKBRequest) -> dict:
    kb = kb_store.create_kb(req.name)
    return {"kb_id": kb.kb_id, "name": kb.name, "created_at": kb.created_at}


@router.get("/kb")
async def list_kbs() -> list[dict]:
    kbs = kb_store.list_kbs()
    return [
        {
            "kb_id": kb.kb_id, "name": kb.name, "created_at": kb.created_at,
            "doc_count": kb.doc_count, "chunk_count": kb.chunk_count,
            "embedder_model": kb.embedder_model,
        }
        for kb in kbs
    ]


@router.get("/kb/{kb_id}")
async def get_kb(kb_id: str) -> dict:
    kb = kb_store.get_kb(kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="KB not found")
    docs = kb_store.list_documents(kb_id)
    return {
        "kb_id": kb.kb_id, "name": kb.name, "created_at": kb.created_at,
        "doc_count": kb.doc_count, "chunk_count": kb.chunk_count,
        "documents": docs,
    }


@router.delete("/kb/{kb_id}")
async def delete_kb(kb_id: str) -> dict:
    if not kb_store.delete_kb(kb_id):
        raise HTTPException(status_code=404, detail="KB not found")
    return {"deleted": True}


# ── Ingest endpoints ─────────────────────────────────────────

class IngestRequest(BaseModel):
    paths: list[str]
    recursive: bool = True


@router.post("/kb/{kb_id}/ingest")
async def ingest_files(kb_id: str, req: IngestRequest) -> dict:
    kb = kb_store.get_kb(kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="KB not found")

    if not kordoc_installer.is_ready():
        raise HTTPException(status_code=503, detail="kordoc not installed")

    files: list[Path] = []
    for p in req.paths:
        path = Path(p)
        if path.is_dir():
            if req.recursive:
                files.extend(f for f in path.rglob("*") if f.is_file() and is_supported(f))
            else:
                files.extend(f for f in path.iterdir() if f.is_file() and is_supported(f))
        elif path.is_file() and is_supported(path):
            files.append(path)

    if not files:
        raise HTTPException(status_code=400, detail="No supported files found")

    task = IngestTask(kb_id=kb_id, total=len(files))
    _ingest_tasks[task.task_id] = task

    asyncio.create_task(_run_ingest(task, files, kb))

    return {"task_id": task.task_id, "total": task.total, "status": task.status}


@router.get("/kb/{kb_id}/ingest/{task_id}")
async def ingest_progress(kb_id: str, task_id: str) -> dict:
    task = _ingest_tasks.get(task_id)
    if not task or task.kb_id != kb_id:
        raise HTTPException(status_code=404, detail="Task not found")
    return {
        "task_id": task.task_id,
        "status": task.status,
        "progress": task.progress,
        "parsed": task.parsed,
        "total": task.total,
        "current_file": task.current_file,
        "error": task.error,
    }


async def _run_ingest(task: IngestTask, files: list[Path], kb: Any) -> None:
    """Background ingest worker — parses files, chunks, stores."""
    task.status = "running"
    for i, fpath in enumerate(files):
        task.current_file = fpath.name
        task.progress = i / max(1, task.total)
        try:
            fhash = file_hash(fpath)
            existing = kb_store.find_by_hash(task.kb_id, fhash)
            if existing:
                logger.info("Skipping duplicate: %s (hash match)", fpath.name)
                task.parsed += 1
                continue

            doc = await parse_file(fpath)
            doc.file_hash = fhash
            kb_store.add_document(task.kb_id, doc)

            chunks = chunk_document(
                doc.doc_id, doc.full_text,
                chunk_size=kb.chunk_size, chunk_overlap=kb.chunk_overlap,
            )
            kb_store.add_chunks(chunks)
            task.parsed += 1
            logger.info("Ingested %s: %d chunks", fpath.name, len(chunks))
        except Exception as e:
            logger.exception("Failed to ingest %s", fpath.name)
            task.error = f"{fpath.name}: {e}"

    task.progress = 1.0
    task.status = "done" if not task.error else "done_with_errors"
    task.current_file = ""


# ── Document endpoints ───────────────────────────────────────

@router.get("/kb/{kb_id}/docs")
async def list_docs(kb_id: str) -> list[dict]:
    return kb_store.list_documents(kb_id)


@router.delete("/kb/{kb_id}/doc/{doc_id}")
async def delete_doc(kb_id: str, doc_id: str) -> dict:
    if not kb_store.delete_document(doc_id):
        raise HTTPException(status_code=404, detail="Document not found")
    return {"deleted": True}


@router.get("/kb/{kb_id}/doc/{doc_id}/text")
async def get_doc_text(kb_id: str, doc_id: str) -> dict:
    text = kb_store.get_document_text(doc_id)
    if text is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"doc_id": doc_id, "full_text": text}


# ── Search endpoint ──────────────────────────────────────────

@router.post("/kb/{kb_id}/search")
async def search_kb(kb_id: str, req: SearchRequest) -> dict:
    kb = kb_store.get_kb(kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="KB not found")

    results = kb_store.search_chunks_text(kb_id, req.query, req.top_k)
    return {
        "kb_id": kb_id,
        "query": req.query,
        "results": [
            {
                "chunk_id": r["chunk_id"],
                "text": r["text"],
                "source": f"{r['filename']}:p.{r['page_from'] or '?'}",
                "section": r["section_title"] or "",
            }
            for r in results
        ],
    }
