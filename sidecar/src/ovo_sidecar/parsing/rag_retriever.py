"""RAG Retriever — searches KB and formats context for LLM injection.

Two search modes:
  1. Keyword search (always available) — SQLite LIKE queries
  2. Vector search (when embedder + sqlite-vec ready) — ANN + MMR rerank

Results are formatted as a system-prompt block that the chat completion
endpoint can prepend to the conversation.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

from ovo_sidecar.parsing.kb_store import kb_store

logger = logging.getLogger(__name__)

RAG_EMBEDDING_MODEL = "BAAI/bge-m3"


@dataclass
class RetrievedChunk:
    chunk_id: str
    text: str
    source: str
    section: str
    score: float


async def search(
    kb_id: str,
    query: str,
    top_k: int = 5,
    use_vectors: bool = False,
) -> list[RetrievedChunk]:
    """Search KB for relevant chunks. Falls back to keyword search if vectors unavailable."""
    if use_vectors:
        try:
            return await _vector_search(kb_id, query, top_k)
        except Exception as e:
            logger.warning("Vector search failed, falling back to keyword: %s", e)

    return _keyword_search(kb_id, query, top_k)


def _keyword_search(kb_id: str, query: str, top_k: int) -> list[RetrievedChunk]:
    results = kb_store.search_chunks_text(kb_id, query, top_k)
    return [
        RetrievedChunk(
            chunk_id=r["chunk_id"],
            text=r["text"],
            source=f"{r['filename']}:p.{r.get('page_from') or '?'}",
            section=r.get("section_title") or "",
            score=1.0,
        )
        for r in results
    ]


async def _vector_search(kb_id: str, query: str, top_k: int) -> list[RetrievedChunk]:
    """Embed query → ANN search in sqlite-vec → MMR rerank."""
    from ovo_sidecar.embedding_runner import embedding_runner

    vectors, _, dim = await embedding_runner.encode([query], model_ref=RAG_EMBEDDING_MODEL)
    if not vectors:
        return []

    # TODO: sqlite-vec ANN query when extension is loaded
    # For now, fall back to keyword
    raise NotImplementedError("Vector search not yet wired — sqlite-vec integration pending")


def format_rag_context(chunks: list[RetrievedChunk], query: str) -> str:
    """Format retrieved chunks as a system prompt block for LLM context injection."""
    if not chunks:
        return ""

    lines = [
        "The following documents from the user's knowledge base are relevant to this question.",
        "Use them to answer accurately. Cite sources when possible.",
        "",
    ]
    for i, chunk in enumerate(chunks, 1):
        source_tag = f"[{chunk.source}]"
        if chunk.section:
            source_tag += f" ({chunk.section})"
        lines.append(f"--- Document {i} {source_tag} ---")
        lines.append(chunk.text.strip())
        lines.append("")

    return "\n".join(lines)


async def rag_augment_messages(
    messages: list[dict],
    kb_ids: list[str],
    top_k: int = 5,
) -> list[dict]:
    """Augment chat messages with RAG context from specified KBs.

    Extracts the last user message as the query, searches all KBs,
    and prepends a system message with the retrieved context.
    """
    user_query = ""
    for msg in reversed(messages):
        if msg.get("role") == "user":
            content = msg.get("content", "")
            if isinstance(content, str):
                user_query = content
            elif isinstance(content, list):
                user_query = " ".join(
                    p.get("text", "") for p in content if isinstance(p, dict) and p.get("type") == "text"
                )
            break

    if not user_query.strip():
        return messages

    all_chunks: list[RetrievedChunk] = []
    for kb_id in kb_ids:
        try:
            chunks = await search(kb_id, user_query, top_k=top_k)
            all_chunks.extend(chunks)
        except Exception as e:
            logger.warning("RAG search failed for KB %s: %s", kb_id, e)

    if not all_chunks:
        return messages

    all_chunks.sort(key=lambda c: c.score, reverse=True)
    all_chunks = all_chunks[:top_k]

    rag_text = format_rag_context(all_chunks, user_query)

    augmented = list(messages)
    rag_msg = {"role": "system", "content": rag_text}

    sys_idx = next((i for i, m in enumerate(augmented) if m.get("role") == "system"), None)
    if sys_idx is not None:
        augmented.insert(sys_idx + 1, rag_msg)
    else:
        augmented.insert(0, rag_msg)

    return augmented
