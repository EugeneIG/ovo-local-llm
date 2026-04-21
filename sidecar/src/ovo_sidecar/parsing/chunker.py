"""Text chunker for RAG — splits parsed Markdown into overlapping chunks.

Strategy: heading-aware splitting first, then fixed-size fallback.
Preserves section titles for source attribution.
"""
from __future__ import annotations

import re

from ovo_sidecar.parsing.models import Chunk, _new_id


def _estimate_tokens(text: str) -> int:
    if not text:
        return 0
    ascii_chars = sum(1 for c in text if ord(c) < 128)
    non_ascii = len(text) - ascii_chars
    return int(non_ascii * 1.3 + ascii_chars * 0.25)


_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+)$", re.MULTILINE)


def chunk_document(
    doc_id: str,
    text: str,
    chunk_size: int = 512,
    chunk_overlap: int = 100,
) -> list[Chunk]:
    """Split document text into chunks for embedding.

    1. Split by headings (semantic boundaries)
    2. If a section exceeds chunk_size tokens, split by paragraphs
    3. If a paragraph exceeds chunk_size, split by sentences with overlap
    """
    if not text.strip():
        return []

    sections = _split_by_headings(text)
    chunks: list[Chunk] = []
    idx = 0

    for section_title, section_text in sections:
        section_tokens = _estimate_tokens(section_text)

        if section_tokens <= chunk_size:
            if section_text.strip():
                chunks.append(Chunk(
                    chunk_id=_new_id(),
                    doc_id=doc_id,
                    chunk_index=idx,
                    text=section_text.strip(),
                    token_count=section_tokens,
                    section_title=section_title,
                ))
                idx += 1
        else:
            sub_chunks = _split_fixed(section_text, chunk_size, chunk_overlap)
            for sc in sub_chunks:
                chunks.append(Chunk(
                    chunk_id=_new_id(),
                    doc_id=doc_id,
                    chunk_index=idx,
                    text=sc.strip(),
                    token_count=_estimate_tokens(sc),
                    section_title=section_title,
                ))
                idx += 1

    return chunks


def _split_by_headings(text: str) -> list[tuple[str, str]]:
    """Split Markdown by headings. Returns [(heading_title, section_text), ...]."""
    matches = list(_HEADING_RE.finditer(text))

    if not matches:
        return [("", text)]

    sections: list[tuple[str, str]] = []

    if matches[0].start() > 0:
        preamble = text[: matches[0].start()].strip()
        if preamble:
            sections.append(("", preamble))

    for i, m in enumerate(matches):
        title = m.group(2).strip()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[start:end].strip()
        if body:
            sections.append((title, body))

    return sections


def _split_fixed(text: str, chunk_size: int, overlap: int) -> list[str]:
    """Split text into fixed-token-size chunks with overlap using paragraph boundaries."""
    paragraphs = re.split(r"\n\n+", text)
    chunks: list[str] = []
    current: list[str] = []
    current_tokens = 0

    for para in paragraphs:
        para_tokens = _estimate_tokens(para)

        if current_tokens + para_tokens > chunk_size and current:
            chunks.append("\n\n".join(current))

            overlap_paras: list[str] = []
            overlap_tokens = 0
            for p in reversed(current):
                pt = _estimate_tokens(p)
                if overlap_tokens + pt > overlap:
                    break
                overlap_paras.insert(0, p)
                overlap_tokens += pt

            current = overlap_paras
            current_tokens = overlap_tokens

        if para_tokens > chunk_size:
            if current:
                chunks.append("\n\n".join(current))
                current = []
                current_tokens = 0
            sentence_chunks = _split_by_sentences(para, chunk_size, overlap)
            chunks.extend(sentence_chunks)
        else:
            current.append(para)
            current_tokens += para_tokens

    if current:
        chunks.append("\n\n".join(current))

    return [c for c in chunks if c.strip()]


def _split_by_sentences(text: str, chunk_size: int, overlap: int) -> list[str]:
    """Last resort: split long paragraph by sentence boundaries."""
    sentences = re.split(r"(?<=[.!?。！？])\s+", text)
    chunks: list[str] = []
    current: list[str] = []
    current_tokens = 0

    for sent in sentences:
        sent_tokens = _estimate_tokens(sent)
        if current_tokens + sent_tokens > chunk_size and current:
            chunks.append(" ".join(current))
            overlap_sents: list[str] = []
            ot = 0
            for s in reversed(current):
                st = _estimate_tokens(s)
                if ot + st > overlap:
                    break
                overlap_sents.insert(0, s)
                ot += st
            current = overlap_sents
            current_tokens = ot

        current.append(sent)
        current_tokens += sent_tokens

    if current:
        chunks.append(" ".join(current))

    return [c for c in chunks if c.strip()]
