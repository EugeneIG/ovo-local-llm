import logging
import shutil
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ovo_sidecar import hf_scanner
from ovo_sidecar.config import settings
from ovo_sidecar.hf_downloader import DownloadTask, downloader
from ovo_sidecar.mlx_runner import ChatMessage, runner
from ovo_sidecar.mlx_vlm_runner import VlmChatMessage, vlm_runner
from ovo_sidecar.registry import registry
# [START] Phase 6.4 — embedding runner (optional dep)
from ovo_sidecar.embedding_runner import DEFAULT_EMBEDDING_MODEL, embedding_runner
# [END]
# [START] Phase 7 — diffusion runner (optional dep: diffusers + transformers)
from ovo_sidecar.mlx_diffusion_runner import (
    GenerateRequest as DiffusionRequest,
    GenerationStepEvent,
    diffusion_runner,
)
from ovo_sidecar.mlx_upscaler_runner import (
    DEFAULT_UPSCALER_MODEL,
    upscaler_runner,
)
# [END]

logger = logging.getLogger(__name__)

router = APIRouter(tags=["ovo"])


class DownloadRequest(BaseModel):
    repo_id: str


class SettingsUpdate(BaseModel):
    default_model: str | None = None
    expose_to_network: bool | None = None
    claude_integration_enabled: bool | None = None
    default_context_length: int | None = None
    max_tokens_cap: int | None = None


class AliasRequest(BaseModel):
    alias: str
    repo_id: str


def _serialize_model(m: hf_scanner.ScannedModel) -> dict[str, Any]:
    arch = m.config.get("architectures") or []
    quant = m.config.get("quantization")
    return {
        "repo_id": m.repo_id,
        "revision": m.revision,
        "snapshot_path": str(m.snapshot_path),
        "size_bytes": m.size_bytes,
        "is_mlx": m.is_mlx,
        "model_type": m.config.get("model_type"),
        "architecture": arch[0] if arch else None,
        "quantization": quant,
        "hidden_size": m.config.get("hidden_size"),
        # [START] surface cache source so UI can distinguish HF vs LM Studio
        "source": m.source,
        # [END]
        # [START] capabilities gate client-side features (e.g. image attachments)
        "capabilities": list(m.capabilities),
        # [END]
        # [START] max_context — UI denominator for the ContextIndicator; may be
        # overridden per-repo via model_context_overrides table on the frontend.
        "max_context": m.max_context,
        # [END]
    }


def _serialize_task(t: DownloadTask) -> dict[str, Any]:
    return {
        "task_id": t.task_id,
        "repo_id": t.repo_id,
        "status": t.status,
        "error": t.error,
        "snapshot_path": str(t.snapshot_path) if t.snapshot_path else None,
        "started_at": t.started_at,
        "finished_at": t.finished_at,
        # [START] Phase 7 — progress + cancel fields
        "total_bytes": t.total_bytes,
        "downloaded_bytes": t.downloaded_bytes,
        "total_files": t.total_files,
        "downloaded_files": t.downloaded_files,
        "cancel_requested": t.cancel_requested,
        # [END]
    }


@router.get("/models")
async def list_local_models(mlx_only: bool = True) -> dict[str, Any]:
    # [START] use merged HF + LM Studio scan
    # Phase 7 — image-gen diffusion pipelines are Torch (not MLX) but they
    # still belong in the Image tab's picker, so we keep them on the list
    # regardless of the mlx_only flag. The Image tab filters to image_gen
    # models client-side; Chat tab drops them via isChatCapableModel.
    scanned = hf_scanner.scan_all()
    models = [
        _serialize_model(m)
        for m in scanned
        if (not mlx_only or m.is_mlx or "image_gen" in m.capabilities)
    ]
    return {
        "models": models,
        "count": len(models),
        "cache_dirs": {
            "hf": str(settings.hf_cache_dir),
            "lmstudio": str(settings.lmstudio_cache_dir),
        },
    }
    # [END]


@router.get("/models/search")
async def search_models(
    q: str = "",
    limit: int = 25,
    # [START] Phase 7 — kind=image scopes HF search to text-to-image models
    kind: str = "mlx",
    # [END]
) -> dict[str, Any]:
    try:
        kind_arg: Any = kind if kind in {"mlx", "image"} else "mlx"
        results = await downloader.search(q, limit=limit, kind=kind_arg)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"HF search failed: {e}") from e
    return {"query": q, "results": [r.__dict__ for r in results]}


@router.post("/models/download")
async def start_download(req: DownloadRequest) -> dict[str, Any]:
    task = await downloader.start_download(req.repo_id)
    return _serialize_task(task)


@router.get("/download/{task_id}")
async def get_download(task_id: str) -> dict[str, Any]:
    task = downloader.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    return _serialize_task(task)


@router.get("/downloads")
async def list_downloads() -> dict[str, Any]:
    return {"tasks": [_serialize_task(t) for t in downloader.list_tasks()]}


@router.delete("/models/{repo_id:path}")
async def delete_model(repo_id: str, force: bool = False) -> dict[str, Any]:
    # [START] Phase 7 — HF cache delete (default) + force=true wipes the
    # matching LM Studio cache entry too so the UI can force-uninstall any
    # model regardless of origin.
    deleted: list[str] = []

    target_name = f"models--{repo_id.replace('/', '--')}"
    hf_dir = settings.hf_cache_dir / target_name
    if hf_dir.exists():
        shutil.rmtree(hf_dir)
        deleted.append(str(hf_dir))

    # LM Studio layout: <lmstudio>/<org>/<repo>/
    if "/" in repo_id:
        org, repo = repo_id.split("/", 1)
        lm_dir = settings.lmstudio_cache_dir / org / repo
        if lm_dir.exists() and force:
            shutil.rmtree(lm_dir)
            deleted.append(str(lm_dir))
        elif lm_dir.exists() and not force:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"{repo_id} lives in LM Studio cache ({lm_dir}); "
                    "pass force=true to remove it anyway"
                ),
            )

    if not deleted:
        raise HTTPException(status_code=404, detail=f"model not found: {repo_id}")

    # [START] Invalidate scan cache so the next list call reflects the deletion.
    from ovo_sidecar.hf_scanner import invalidate_scan_cache
    invalidate_scan_cache()
    # [END]

    return {"deleted": repo_id, "paths": deleted}
    # [END]


# [START] Phase 7 — Cancel a running download by task id.
@router.delete("/download/{task_id}")
async def cancel_download(task_id: str) -> dict[str, Any]:
    ok = downloader.cancel(task_id)
    if not ok:
        raise HTTPException(status_code=404, detail="task not found or already finished")
    return {"cancelled": task_id}
# [END]


@router.get("/settings")
async def get_settings() -> dict[str, Any]:
    return {
        "default_model": registry.default_model,
        "aliases": registry.aliases,
        "ports": {
            "ollama": settings.ollama_port,
            "openai": settings.openai_port,
            "native": settings.native_port,
        },
        "hf_cache_dir": str(settings.hf_cache_dir),
        "lmstudio_cache_dir": str(settings.lmstudio_cache_dir),
        "data_dir": str(settings.data_dir),
        "default_context_length": settings.default_context_length,
        "max_tokens_cap": settings.max_tokens_cap,
        "expose_to_network": settings.expose_to_network,
        "claude_integration": {
            "enabled": settings.claude_integration_enabled,
            "read_claude_md": settings.claude_read_claude_md,
            "read_settings": settings.claude_read_settings,
            "read_plugins": settings.claude_read_plugins,
        },
    }


@router.put("/settings")
async def update_settings(patch: SettingsUpdate) -> dict[str, Any]:
    if patch.default_model is not None:
        registry.default_model = patch.default_model or None
    if patch.expose_to_network is not None:
        settings.expose_to_network = patch.expose_to_network
    if patch.claude_integration_enabled is not None:
        settings.claude_integration_enabled = patch.claude_integration_enabled
    if patch.default_context_length is not None:
        settings.default_context_length = patch.default_context_length
    if patch.max_tokens_cap is not None:
        settings.max_tokens_cap = patch.max_tokens_cap
    return await get_settings()


@router.post("/aliases")
async def add_alias(req: AliasRequest) -> dict[str, Any]:
    registry.set_alias(req.alias, req.repo_id)
    return {"alias": req.alias, "repo_id": req.repo_id}


@router.get("/audit")
async def audit() -> dict[str, Any]:
    return registry.snapshot()


# [START] Context management endpoints — used by the frontend's session store
# and auto-compact engine. Both accept the same OpenAI-ish message shape so
# the UI can reuse the same serializer.
class CountMessage(BaseModel):
    role: str
    content: str
    images: list[str] | None = None
    audios: list[str] | None = None


class CountTokensRequest(BaseModel):
    model: str
    messages: list[CountMessage]


def _resolve_ref_for_ovo(name: str):
    repo_id = registry.resolve(name)
    local = hf_scanner.resolve_path(repo_id)
    return local if local is not None else repo_id


@router.post("/count_tokens")
async def count_tokens(req: CountTokensRequest) -> dict[str, Any]:
    """Return the exact prompt token count for the given conversation.

    Routes through the VLM runner when the model declares vision capability
    so chat-template formatting (including image placeholders) matches what
    the OpenAI endpoint would eventually send.
    """
    model_id = _resolve_ref_for_ovo(req.model)
    repo_id = registry.resolve(req.model)
    caps = hf_scanner.resolve_capabilities(repo_id)
    use_vlm = "vision" in caps or "audio" in caps

    if use_vlm:
        vlm_messages = [
            VlmChatMessage(
                role=m.role,
                content=m.content,
                images=m.images or [],
                audios=m.audios or [],
            )
            for m in req.messages
        ]
        count = await vlm_runner.count_tokens(model_id, vlm_messages)
    else:
        text_messages = [ChatMessage(role=m.role, content=m.content) for m in req.messages]
        count = await runner.count_tokens(model_id, text_messages)

    return {"model": req.model, "prompt_tokens": count}


class SummarizeRequest(BaseModel):
    model: str
    messages: list[CountMessage]
    max_tokens: int = 512
    instruction: str | None = None


_DEFAULT_SUMMARY_INSTRUCTION = (
    "You are a summarization assistant. Produce a concise third-person summary "
    "of the conversation turns above in under 200 words. Preserve: user goals, "
    "key facts, decisions made, open questions, code references. Omit small talk. "
    "Start immediately with the summary — no preamble."
)


@router.post("/summarize")
async def summarize(req: SummarizeRequest) -> dict[str, Any]:
    """Summarize a slice of messages using the SAME loaded model.

    Non-streaming — auto-compact engine just needs the finished text. VLMs
    summarize text-only (strip attached images; summaries don't need pixels).
    """
    model_id = _resolve_ref_for_ovo(req.model)

    instruction = req.instruction or _DEFAULT_SUMMARY_INSTRUCTION
    text_messages = [ChatMessage(role=m.role, content=m.content) for m in req.messages]
    text_messages.append(ChatMessage(role="user", content=instruction))

    summary = ""
    prompt_tokens = 0
    gen_tokens = 0
    async for chunk in runner.stream_chat(
        model_id,
        text_messages,
        max_tokens=req.max_tokens,
    ):
        summary += chunk.text
        if chunk.done:
            prompt_tokens = chunk.prompt_tokens or 0
            gen_tokens = chunk.generation_tokens or 0

    return {
        "model": req.model,
        "summary": summary.strip(),
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": gen_tokens,
            "total_tokens": prompt_tokens + gen_tokens,
        },
    }


# [START] Phase 8.4 — grammar-constrained tool call.
# The code agent's #1 failure mode is malformed JSON inside a <tool_use>
# block: unescaped quotes, missing braces, template-literal syntax inside
# a string. Free-form text generation with a prompt asking politely for
# valid JSON never hits 100%. This endpoint takes the same chat context
# the streaming endpoint would see PLUS a list of tool schemas, loads the
# model through Outlines, and returns a single JSON object guaranteed to
# match one of the tool signatures. The decoder literally cannot emit an
# invalid token. Frontend uses this when the parser detects that a tool
# call was attempted but couldn't be recovered by jsonrepair.
class ToolSchema(BaseModel):
    name: str
    description: str | None = None
    parameters: dict[str, Any] | None = None
    input_schema: dict[str, Any] | None = None


class ToolCallRequest(BaseModel):
    model: str
    messages: list[CountMessage]
    tools: list[ToolSchema]
    max_tokens: int = 2048


@router.post("/tool_call")
async def generate_tool_call(req: ToolCallRequest) -> dict[str, Any]:
    """Grammar-constrained single tool call generation."""
    from ovo_sidecar.tool_grammar import generate_constrained_tool_call

    model_id = _resolve_ref_for_ovo(req.model)
    loaded = await runner.ensure_loaded(model_id)
    text_messages = [ChatMessage(role=m.role, content=m.content) for m in req.messages]
    prompt = runner._apply_chat_template(loaded.tokenizer, text_messages)
    tool_schemas = [t.model_dump(exclude_none=True) for t in req.tools]

    raw = generate_constrained_tool_call(
        loaded.model,
        loaded.tokenizer,
        prompt,
        tool_schemas,
        max_tokens=req.max_tokens,
    )
    if raw is None:
        raise HTTPException(status_code=503, detail="grammar constraint unavailable")

    import json as _json

    try:
        parsed = _json.loads(raw)
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"constrained output failed to parse: {e}"
        )
    return {"tool_call": parsed, "raw": raw}
# [END]


# [START] Explicit unload — lets the UI drop a loaded model immediately when
# the user swaps in the selector (otherwise unload is lazy and only happens
# when the next request arrives for a different model_ref).
@router.post("/unload")
async def unload_loaded_models() -> dict[str, Any]:
    """Unload every runner's currently-loaded model + clear Metal cache.

    Returns which runner(s) held a model so the caller can log what was
    freed. Never raises — best-effort cleanup.
    """
    from ovo_sidecar import model_lifecycle

    freed: list[str] = []
    if runner._loaded is not None:
        freed.append(f"text:{runner._loaded.ref}")
    if vlm_runner._loaded is not None:
        freed.append(f"vlm:{vlm_runner._loaded.ref}")

    # Signal every registered unloader (text + VLM + future runners).
    model_lifecycle.unload_others(skip=None)
    model_lifecycle.release_gpu_memory()
    return {"freed": freed}
# [END]


# [START] Phase 4 — AI Inline Completion (FIM ghost text).
# Monaco's InlineCompletionsProvider asks for a mid-cursor completion; we
# surface that as a sidecar Fill-In-Middle call against whichever code model
# the user has loaded. The endpoint streams deltas as SSE `{type:'delta',
# text}` frames and a final `{type:'done'}` (or `{type:'error'}`) so the
# frontend can paint ghost text progressively while the user keeps typing.
#
# Before the model is touched we evict every non-llm slot resident (image
# pipelines, embedding encoders) so the completion model gets exclusive
# unified-memory tenancy — otherwise a 14B coder quant + SDXL co-resident
# will OOM mid-suggestion on 16-32 GB Macs. Sibling llm-slot runners (chat
# / agent text runner) are left alone; the text runner's own single-slot
# tenancy handles swapping the active model on demand.
import asyncio as _asyncio_fim
import json as _json_fim


class CodeCompleteRequest(BaseModel):
    model: str
    prefix: str
    suffix: str = ""
    language: str | None = None
    max_tokens: int = 128
    temperature: float = 0.2


# FIM prompt templates per model family. Detection is a lowercase substring
# match on the model ref — sufficient because the canonical HF repo names
# all carry the family token somewhere (Qwen2.5-Coder, deepseek-coder,
# starcoder2, CodeLlama). Unknown families fall back to plain prefix which
# is strictly worse than FIM but still produces a valid prompt for any
# causal LM — no silent failure.
_FIM_QWEN = {
    "prefix": "<|fim_prefix|>",
    "suffix": "<|fim_suffix|>",
    "middle": "<|fim_middle|>",
    # Qwen Coder occasionally emits fim_pad or endoftext at completion end.
    "stops": ["<|fim_pad|>", "<|endoftext|>", "<|im_end|>"],
}
_FIM_DEEPSEEK = {
    # Note: DeepSeek uses full-width `｜` (U+FF5C), not ASCII `|`.
    "prefix": "<\uff5cfim\u2581begin\uff5c>",
    "suffix": "<\uff5cfim\u2581hole\uff5c>",
    "middle": "<\uff5cfim\u2581end\uff5c>",
    "stops": ["<\uff5cend\u2581of\u2581sentence\uff5c>", "<|EOT|>"],
}
_FIM_STARCODER = {
    "prefix": "<fim_prefix>",
    "suffix": "<fim_suffix>",
    "middle": "<fim_middle>",
    "stops": ["<|endoftext|>", "<file_sep>"],
}
_FIM_CODELLAMA = {
    # CodeLlama Infilling format — literal tokens with surrounding spaces.
    "prefix": "<PRE> ",
    "suffix": " <SUF>",
    "middle": " <MID>",
    "stops": ["<EOT>"],
}


def _detect_fim_family(model_ref: str) -> dict | None:
    name = model_ref.lower()
    if "qwen" in name and ("coder" in name or "code" in name):
        return _FIM_QWEN
    if "deepseek" in name and "coder" in name:
        return _FIM_DEEPSEEK
    if "starcoder" in name:
        return _FIM_STARCODER
    if "codellama" in name or "code-llama" in name:
        return _FIM_CODELLAMA
    return None


def _build_fim_prompt(model_ref: str, prefix: str, suffix: str) -> tuple[str, list[str]]:
    """Return (prompt, stop_tokens). Falls back to plain prefix for models
    without a known FIM dialect so the endpoint still works (just less well).
    """
    family = _detect_fim_family(model_ref)
    if family is None:
        return prefix, []
    prompt = f"{family['prefix']}{prefix}{family['suffix']}{suffix}{family['middle']}"
    return prompt, list(family["stops"])


@router.post("/code/complete")
async def code_complete(req: CodeCompleteRequest) -> StreamingResponse:
    """SSE FIM completion — yields `{type:'delta'|'done'|'error'}` frames."""
    from ovo_sidecar import model_lifecycle

    # [START] Phase 4 fix — chat/agent priority.
    # Ghost-text is a nice-to-have; a running chat or agent turn is not.
    # The text runner serializes streams behind `_stream_lock`, so a FIM
    # request that blindly queued itself would make the chat turn wait on
    # our completion — that's the "sidecar did not respond within 60s"
    # error users saw when typing in Monaco and then hitting Send in the
    # agent chat. Skip cleanly when the runner is busy; the InlineCompletions
    # provider silently coalesces an empty result into "no suggestion".
    if runner.is_busy():
        async def _skip_busy():
            yield f"data: {_json_fim.dumps({'type': 'done', 'reason': 'busy'})}\n\n"
        return StreamingResponse(
            _skip_busy(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
    # [END]

    # Reclaim non-llm slot residents before the model swaps in. The text
    # runner itself stays in-slot; its ensure_loaded handles the within-slot
    # eviction if a different llm is resident.
    model_lifecycle.unload_all_except_slot("llm")

    model_id = _resolve_ref_for_ovo(req.model)
    # Cap defensively — 256 tokens is plenty for a ghost-text suggestion
    # and prevents a runaway prefix from eating a whole generation budget.
    max_tokens = max(1, min(int(req.max_tokens), 256))
    prompt, stop_tokens = _build_fim_prompt(req.model, req.prefix, req.suffix)

    async def stream():
        emitted = ""
        try:
            async for chunk in runner.stream_generate(
                model_id,
                prompt,
                max_tokens=max_tokens,
                temperature=req.temperature,
                # Tag this stream low-priority so chat/agent requests can
                # preempt it via MlxRunner.interrupt_low_priority().
                is_background=True,
            ):
                text = chunk.text or ""
                # Detect stop tokens embedded in the delta — trim and bail.
                if stop_tokens and text:
                    cut_at: int | None = None
                    for tok in stop_tokens:
                        idx = text.find(tok)
                        if idx != -1 and (cut_at is None or idx < cut_at):
                            cut_at = idx
                    if cut_at is not None:
                        trimmed = text[:cut_at]
                        if trimmed:
                            emitted += trimmed
                            yield f"data: {_json_fim.dumps({'type': 'delta', 'text': trimmed})}\n\n"
                        yield f"data: {_json_fim.dumps({'type': 'done', 'reason': 'stop_token'})}\n\n"
                        return
                if text:
                    emitted += text
                    yield f"data: {_json_fim.dumps({'type': 'delta', 'text': text})}\n\n"
                if chunk.done:
                    yield f"data: {_json_fim.dumps({'type': 'done', 'reason': chunk.finish_reason or 'stop'})}\n\n"
                    return
            # Stream exhausted without a done frame — synthesize one.
            yield f"data: {_json_fim.dumps({'type': 'done', 'reason': 'eof'})}\n\n"
        except _asyncio_fim.CancelledError:
            # Client cancelled (user kept typing) — nothing to emit.
            raise
        except Exception as e:
            logger.exception("code completion failed")
            yield f"data: {_json_fim.dumps({'type': 'error', 'message': str(e) or 'completion failed'})}\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
# [END] Phase 4


# [START] Phase 5 — PDF text extraction via PyMuPDF.
# The frontend's pdfjs-dist integration is unreliable inside the Tauri
# WebView (worker URL resolution, ReadableStream quirks), so we do the
# heavy lifting server-side. Input is a base64-encoded PDF blob; output
# is per-page plain text plus basic document metadata so the caller can
# surface a truncation indicator.
class PdfExtractRequest(BaseModel):
    data_b64: str
    filename: str = "document.pdf"
    max_bytes: int = 80_000  # caller-side text cap to match chat context budget


class PdfExtractResponse(BaseModel):
    filename: str
    num_pages: int
    text: str
    truncated: bool


@router.post("/files/extract_pdf", response_model=PdfExtractResponse)
async def files_extract_pdf(req: PdfExtractRequest) -> PdfExtractResponse:
    try:
        import base64 as _b64
        import fitz  # pymupdf

        raw = _b64.b64decode(req.data_b64)
    except ImportError as e:  # pragma: no cover — signalled if dep missing
        raise HTTPException(
            status_code=501,
            detail=(
                "pymupdf not installed in sidecar venv — run `uv sync` "
                f"under sidecar/ to add it. ({e})"
            ),
        ) from e
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"invalid base64: {e}") from e

    try:
        doc = fitz.open(stream=raw, filetype="pdf")
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"pdf parse failed: {e}") from e

    parts: list[str] = []
    for i, page in enumerate(doc, start=1):
        try:
            text = page.get_text("text") or ""
        except Exception as e:
            text = f"[page {i} extraction failed: {e}]"
        parts.append(f"--- Page {i} ---\n{text}")
    doc.close()

    joined = "\n\n".join(parts)
    max_bytes = max(1000, int(req.max_bytes))
    truncated = False
    if len(joined) > max_bytes:
        joined = joined[:max_bytes] + f"\n… [truncated at {max_bytes} bytes]"
        truncated = True

    return PdfExtractResponse(
        filename=req.filename,
        num_pages=len(doc) if hasattr(doc, "__len__") else len(parts),
        text=joined,
        truncated=truncated,
    )
# [END] Phase 5


# [START] Phase 6.4 — built-in web search (key-less).
# Backed by duckduckgo-search so the OVO frontend can expose a 'web_search'
# tool that works out of the box without the user registering any API key.
# Intentionally kept minimal: title / url / snippet per hit, capped result
# count, no infinite pagination.
class WebSearchRequest(BaseModel):
    query: str
    limit: int = 8


class WebSearchHit(BaseModel):
    title: str
    url: str
    snippet: str


class WebSearchResponse(BaseModel):
    query: str
    results: list[WebSearchHit]


@router.post("/websearch", response_model=WebSearchResponse)
async def websearch(req: WebSearchRequest) -> WebSearchResponse:
    """Return DuckDuckGo text search hits for the given query.

    Runs the (sync) duckduckgo-search client in a worker thread so the
    event loop isn't blocked. Errors bubble up as HTTP 502 — callers
    should treat the tool as best-effort and fall back gracefully.
    """
    import asyncio

    query = req.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="empty query")
    limit = max(1, min(req.limit, 20))

    # [START] Try duckduckgo-search first; fall back to httpx + DDG Lite
    # scraping so web search works even when the pip package hasn't been
    # synced into the sidecar venv yet (user would otherwise hit 501 until
    # they manually run `uv sync`).
    raw: list[dict[str, Any]] = []
    used_fallback = False
    try:
        from duckduckgo_search import DDGS

        def _run() -> list[dict[str, Any]]:
            with DDGS() as ddgs:
                return list(ddgs.text(query, max_results=limit))

        try:
            raw = await asyncio.to_thread(_run)
        except Exception as e:
            logger.warning("duckduckgo-search failed, trying fallback: %s", e)
            used_fallback = True
    except Exception as e:
        logger.info("duckduckgo-search not available, using httpx fallback: %s", e)
        used_fallback = True

    if used_fallback:
        # DDG Lite is a minimal HTML endpoint without JS. Parse the result
        # blocks with a tolerant regex pass — good enough for top-N hits.
        import re

        import httpx

        try:
            async with httpx.AsyncClient(
                timeout=10.0,
                headers={"User-Agent": "OVO/0.0.1 (web search)"},
                follow_redirects=True,
            ) as client:
                resp = await client.get(
                    "https://html.duckduckgo.com/html/",
                    params={"q": query},
                )
                resp.raise_for_status()
                html = resp.text
        except Exception as e:
            logger.warning("DDG fallback fetch failed: %s", e)
            raise HTTPException(status_code=502, detail=f"web search failed: {e}") from e

        pattern = re.compile(
            r'<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)</a>'
            r'[\s\S]*?<a[^>]+class="result__snippet"[^>]*>(.*?)</a>',
            re.IGNORECASE,
        )
        tag_strip = re.compile(r"<[^>]+>")
        for match in pattern.finditer(html):
            href = match.group(1).strip()
            title = tag_strip.sub("", match.group(2) or "").strip()
            snippet = tag_strip.sub("", match.group(3) or "").strip()
            # DDG wraps redirect URLs like //duckduckgo.com/l/?uddg=... — try to
            # unwrap so downstream consumers see the real target.
            m = re.search(r"uddg=([^&]+)", href)
            if m:
                from urllib.parse import unquote

                href = unquote(m.group(1))
            raw.append({"title": title, "href": href, "body": snippet})
            if len(raw) >= limit:
                break
    # [END]

    hits: list[WebSearchHit] = []
    for r in raw:
        if not isinstance(r, dict):
            continue
        hits.append(
            WebSearchHit(
                title=str(r.get("title") or ""),
                url=str(r.get("href") or r.get("url") or ""),
                snippet=str(r.get("body") or r.get("snippet") or ""),
            )
        )
    return WebSearchResponse(query=query, results=hits)
# [END]


# [START] Phase 6.4 — Embedding endpoint for local semantic search.
# Accepts a batch of texts, returns their vector representations plus the
# model id + dim so the caller can sanity-check compatibility with previously
# stored vectors. 501 when the optional dep isn't installed so the frontend
# can fall back to FTS-only retrieval without crashing.
class EmbedRequest(BaseModel):
    texts: list[str]
    model: str | None = None
    normalize: bool = True


class EmbedResponse(BaseModel):
    model: str
    dim: int
    embeddings: list[list[float]]


@router.post("/embed", response_model=EmbedResponse)
async def embed(req: EmbedRequest) -> EmbedResponse:
    if not req.texts:
        return EmbedResponse(model=req.model or DEFAULT_EMBEDDING_MODEL, dim=0, embeddings=[])
    # Drop None / empty entries up front but keep the shape predictable by
    # erroring on the empty-after-filter case — caller bug otherwise.
    cleaned = [t if isinstance(t, str) else "" for t in req.texts]
    try:
        vectors, model_ref, dim = await embedding_runner.encode(
            cleaned,
            model_ref=req.model,
            normalize=req.normalize,
        )
    except RuntimeError as e:
        # Optional dep missing — signal 501 so the frontend disables semantic
        # search instead of looping on failures.
        raise HTTPException(status_code=501, detail=str(e)) from e
    return EmbedResponse(model=model_ref, dim=dim, embeddings=vectors)
# [END] Phase 6.4


# [START] Phase 7 — Image generation endpoints.
# Two surfaces, both backed by the same diffusion_runner:
#   1. POST /ovo/images/generate — SSE stream with `progress` frames and a
#      final `image` frame per batch entry. Lets the UI draw a progress
#      bar during long jobs.
#   2. POST /ovo/images/generate_sync — non-streaming JSON for scripts and
#      callers that can't parse SSE.
#
# Both return images as base64 PNGs plus an absolute filesystem path so the
# frontend can display them immediately AND persist gallery entries.
import asyncio as _asyncio_img
import json as _json_img


class LoraEntry(BaseModel):
    path: str
    strength: float = 1.0


class ImagesGenerateRequest(BaseModel):
    prompt: str
    model: str
    negative_prompt: str = ""
    width: int = 1024
    height: int = 1024
    steps: int = 28
    cfg_scale: float = 7.0
    sampler: str = "dpm++_2m_karras"
    seed: int | None = None
    batch: int = 1
    shift: float | None = None
    loras: list[LoraEntry] = []
    control_image_b64: str | None = None
    control_model: str | None = None
    control_strength: float = 1.0


class GeneratedImageOut(BaseModel):
    index: int
    path: str
    base64_png: str
    seed: int
    width: int
    height: int


class ImagesGenerateResponse(BaseModel):
    model: str
    sampler: str
    total_elapsed_ms: int
    images: list[GeneratedImageOut]


def _build_diffusion_request(req: ImagesGenerateRequest) -> DiffusionRequest:
    return DiffusionRequest(
        prompt=req.prompt,
        model=req.model,
        negative_prompt=req.negative_prompt,
        width=req.width,
        height=req.height,
        steps=req.steps,
        cfg_scale=req.cfg_scale,
        sampler=req.sampler,
        seed=req.seed,
        batch=req.batch,
        shift=req.shift,
        loras=[{"path": lora.path, "strength": lora.strength} for lora in req.loras],
        control_image_b64=req.control_image_b64,
        control_model=req.control_model,
        control_strength=req.control_strength,
    )


@router.post("/images/generate")
async def images_generate_stream(req: ImagesGenerateRequest) -> StreamingResponse:
    """SSE: emits `progress` frames followed by one `image` frame per batch
    item, then `done`. Each frame is a JSON payload on a `data:` line.
    """
    diffusion_req = _build_diffusion_request(req)
    queue: _asyncio_img.Queue = _asyncio_img.Queue()
    loop = _asyncio_img.get_running_loop()

    def _emit_progress(event: GenerationStepEvent) -> None:
        # Called from the worker thread — marshal back to the loop.
        try:
            loop.call_soon_threadsafe(queue.put_nowait, {
                "type": "progress",
                "step": event.step,
                "total": event.total,
                "elapsed_ms": event.elapsed_ms,
            })
        except RuntimeError:
            pass  # loop closed — swallow

    async def _produce() -> None:
        # Surface a "loading" frame immediately so the frontend can flip from
        # the 0/N placeholder to a "loading model…" state before the (often
        # long) first-load completes.
        loaded_already = diffusion_runner._loaded is not None and (
            diffusion_runner._loaded.ref == diffusion_req.model
        )
        if not loaded_already:
            await queue.put({"type": "loading", "model": diffusion_req.model})
        try:
            result = await diffusion_runner.generate(diffusion_req, on_progress=_emit_progress)
        except RuntimeError as e:
            await queue.put({"type": "error", "message": str(e)})
            await queue.put(None)
            return
        except Exception as e:  # pragma: no cover — surface anything else
            logger.exception("image generation failed")
            await queue.put({"type": "error", "message": str(e)})
            await queue.put(None)
            return
        for img in result.images:
            await queue.put({
                "type": "image",
                "index": img.index,
                "path": img.path,
                "base64_png": img.base64_png,
                "seed": img.seed,
                "width": img.width,
                "height": img.height,
            })
        await queue.put({
            "type": "done",
            "model": result.model,
            "sampler": result.sampler,
            "total_elapsed_ms": result.total_elapsed_ms,
        })
        await queue.put(None)

    producer_task = _asyncio_img.create_task(_produce())

    async def _stream():
        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield f"data: {_json_img.dumps(item)}\n\n"
        finally:
            if not producer_task.done():
                producer_task.cancel()

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/images/generate_sync", response_model=ImagesGenerateResponse)
async def images_generate_sync(req: ImagesGenerateRequest) -> ImagesGenerateResponse:
    """Blocking JSON variant for non-SSE callers."""
    diffusion_req = _build_diffusion_request(req)
    try:
        result = await diffusion_runner.generate(diffusion_req)
    except RuntimeError as e:
        # Optional dep missing (diffusers not installed).
        raise HTTPException(status_code=501, detail=str(e)) from e
    return ImagesGenerateResponse(
        model=result.model,
        sampler=result.sampler,
        total_elapsed_ms=result.total_elapsed_ms,
        images=[GeneratedImageOut(
            index=i.index,
            path=i.path,
            base64_png=i.base64_png,
            seed=i.seed,
            width=i.width,
            height=i.height,
        ) for i in result.images],
    )


@router.get("/images/gallery")
async def images_gallery(limit: int = 100) -> dict[str, Any]:
    """List the most-recent images that the diffusion runner has saved."""
    from pathlib import Path as _Path

    images_dir: _Path = settings.images_dir
    if not images_dir.exists():
        return {"images": []}
    rows: list[dict[str, Any]] = []
    for path in sorted(images_dir.glob("*.png"), key=lambda p: p.stat().st_mtime, reverse=True)[:limit]:
        try:
            rows.append({
                "path": str(path),
                "name": path.name,
                "size_bytes": path.stat().st_size,
                "modified_at": int(path.stat().st_mtime * 1000),
            })
        except OSError:
            continue
    return {"images": rows}


# [START] Phase 7 — raw image bytes route.
# The Tauri webview can't load `file://` URLs without an explicit
# assetProtocol scope; serving through the sidecar HTTP port sidesteps that
# (and keeps the frontend stack uniform — no convertFileSrc required).
# Path is validated to live under settings.images_dir so no traversal is
# possible even though the parameter is user-controlled.
from fastapi.responses import FileResponse as _FileResponse


@router.get("/images/raw")
async def images_raw(path: str) -> _FileResponse:
    from pathlib import Path as _Path

    target = _Path(path).resolve()
    images_dir = settings.images_dir.resolve()
    if images_dir not in target.parents and target.parent != images_dir:
        raise HTTPException(status_code=400, detail="path outside images_dir")
    if not target.is_file():
        raise HTTPException(status_code=404, detail="image not found")
    return _FileResponse(target, media_type="image/png")


# [START] Phase 7 — Upscale endpoint.
# One-shot (non-streaming) upscale via StableDiffusionUpscalePipeline.
# Source image must live under settings.images_dir (same scope guard as /raw
# route) so a rogue caller can't feed arbitrary disk paths into the pipeline.
class UpscaleRequest(BaseModel):
    source_path: str
    prompt: str = ""
    steps: int = 20
    guidance_scale: float = 0.0
    model: str = DEFAULT_UPSCALER_MODEL
    seed: int | None = None


@router.post("/images/upscale")
async def images_upscale(req: UpscaleRequest) -> dict[str, Any]:
    from pathlib import Path as _Path

    target = _Path(req.source_path).resolve()
    images_dir = settings.images_dir.resolve()
    if images_dir not in target.parents and target.parent != images_dir:
        raise HTTPException(status_code=400, detail="source path outside images_dir")
    if not target.is_file():
        raise HTTPException(status_code=404, detail="source image not found")
    try:
        result = await upscaler_runner.upscale(
            source_path=str(target),
            prompt=req.prompt,
            steps=req.steps,
            guidance_scale=req.guidance_scale,
            model=req.model,
            seed=req.seed,
        )
    except RuntimeError as e:
        # diffusers not installed or upscaler model download failure.
        raise HTTPException(status_code=501, detail=str(e)) from e
    return result
# [END] Phase 7


# [START] Phase 8 — Voice I/O: STT via mlx-whisper, TTS via macOS `say`.
class TranscribeRequest(BaseModel):
    audio: str           # base64-encoded audio blob
    format: str = "webm"
    model: str = "mlx-community/whisper-small-mlx"


class TranscribeResponse(BaseModel):
    text: str


@router.post("/audio/transcribe")
async def audio_transcribe(req: TranscribeRequest) -> TranscribeResponse:
    """Transcribe base64 audio to text using mlx-whisper (optional dep)."""
    from ovo_sidecar.whisper_runner import whisper_runner
    try:
        text = await whisper_runner.transcribe(req.audio, req.format, req.model)
    except RuntimeError as exc:
        raise HTTPException(status_code=501, detail=str(exc)) from exc
    return TranscribeResponse(text=text)


class TTSRequest(BaseModel):
    text: str
    # `voice=None` lets the sidecar auto-pick from the script (Hangul→Yuna, etc.)
    voice: str | None = None


class TTSResponse(BaseModel):
    audio: str   # base64 audio blob
    format: str  # "aiff"


@router.post("/audio/tts")
async def audio_tts(req: TTSRequest) -> TTSResponse:
    """Synthesise speech from text using macOS `say` (always available on macOS)."""
    from ovo_sidecar.tts_runner import tts_runner
    try:
        audio_b64, fmt = await tts_runner.synthesize(req.text, req.voice)
    except RuntimeError as exc:
        raise HTTPException(status_code=501, detail=str(exc)) from exc
    return TTSResponse(audio=audio_b64, format=fmt)


# --- Sidecar-side microphone recording (avoids WebView secure-context limits) ---

@router.post("/audio/record/start")
async def audio_record_start() -> dict[str, str]:
    """Start recording from the default microphone via sounddevice/CoreAudio."""
    from ovo_sidecar.audio_recorder import audio_recorder
    try:
        await audio_recorder.start()
    except RuntimeError as exc:
        raise HTTPException(status_code=501, detail=str(exc)) from exc
    return {"status": "recording"}


class RecordStopRequest(BaseModel):
    model: str = "mlx-community/whisper-small-mlx"


@router.post("/audio/record/stop")
async def audio_record_stop(req: RecordStopRequest) -> TranscribeResponse:
    """Stop recording and transcribe with mlx-whisper; returns {text}."""
    from pathlib import Path as _Path
    from ovo_sidecar.audio_recorder import audio_recorder
    from ovo_sidecar.whisper_runner import whisper_runner
    wav_path: str | None = None
    try:
        wav_path = await audio_recorder.stop_and_save()
        text = await whisper_runner.transcribe_file(wav_path, req.model)
    except RuntimeError as exc:
        raise HTTPException(status_code=501, detail=str(exc)) from exc
    finally:
        if wav_path:
            _Path(wav_path).unlink(missing_ok=True)
    return TranscribeResponse(text=text)


@router.post("/audio/record/cancel")
async def audio_record_cancel() -> dict[str, str]:
    """Discard the current recording without transcribing."""
    from ovo_sidecar.audio_recorder import audio_recorder
    await audio_recorder.cancel()
    return {"status": "cancelled"}
# [END] Phase 8


@router.delete("/images/raw")
async def images_delete(path: str) -> dict[str, Any]:
    """Delete a previously-generated image file. Same scope guard as /raw."""
    from pathlib import Path as _Path

    target = _Path(path).resolve()
    images_dir = settings.images_dir.resolve()
    if images_dir not in target.parents and target.parent != images_dir:
        raise HTTPException(status_code=400, detail="path outside images_dir")
    if not target.is_file():
        return {"deleted": path, "missing": True}
    try:
        target.unlink()
    except OSError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    return {"deleted": str(target)}
# [END] Phase 7
# [END] Phase 7


# [START] Phase 8 — /ovo/system/info for llmfit.
# Host hardware snapshot used by the Fit pane to score which models will
# actually run on this machine. RAM is the dominant signal for MLX since
# Apple Silicon shares memory between CPU and GPU; disk free space guards
# against HF cache fill. psutil is already installed in the sidecar venv.
# Cheap enough to fetch on every pane open — no caching needed.
@router.get("/system/info")
def system_info() -> dict[str, Any]:
    import platform
    from pathlib import Path as _Path

    import psutil

    vm = psutil.virtual_memory()
    data_dir = settings.data_dir.resolve()
    # data_dir may not exist on a brand-new install; fall back to home.
    disk_target = data_dir if data_dir.exists() else _Path.home()
    try:
        disk = psutil.disk_usage(str(disk_target))
        disk_free = int(disk.free)
        disk_total = int(disk.total)
    except OSError:
        disk_free = 0
        disk_total = 0

    machine = platform.machine()
    apple_silicon = machine in {"arm64", "aarch64"} and platform.system() == "Darwin"

    # [START] Phase 8 — surface MLX memory discipline numbers.
    # The frontend uses `gpu.mlx_memory_limit_bytes` as the *authoritative*
    # ceiling for fit scoring — it's what MLX can actually allocate without
    # forcing macOS into swap. Falls back to a heuristic when unset.
    from ovo_sidecar.model_lifecycle import get_mlx_limits

    mlx_limits = get_mlx_limits()
    # [END]

    return {
        "platform": platform.system(),
        "arch": machine,
        "os_release": platform.release(),
        "cpu": {
            "brand": platform.processor() or machine,
            "logical_cores": psutil.cpu_count(logical=True) or 0,
            "physical_cores": psutil.cpu_count(logical=False) or 0,
        },
        "memory": {
            "total_bytes": int(vm.total),
            "available_bytes": int(vm.available),
            "used_bytes": int(vm.used),
            "percent": float(vm.percent),
        },
        "disk": {
            "path": str(disk_target),
            "free_bytes": disk_free,
            "total_bytes": disk_total,
        },
        "gpu": {
            # Apple Silicon has a unified-memory GPU — "VRAM" == system RAM.
            # For non-Apple hosts we don't probe nvidia-smi yet; caller treats
            # `unified: false` as unknown and falls back to RAM-only scoring.
            "unified": apple_silicon,
            "kind": "apple-silicon" if apple_silicon else "unknown",
            # Authoritative allocation ceiling MLX will honour (bytes). 0 =
            # unconfigured / non-MLX host.
            "mlx_memory_limit_bytes": mlx_limits["mlx_memory_limit_bytes"],
            "mlx_cache_limit_bytes": mlx_limits["mlx_cache_limit_bytes"],
            # Underlying macOS GPU wired cap (`sysctl iogpu.wired_limit_mb`).
            # 0 means sysctl is unset and macOS uses its default ~70 % cap.
            "gpu_wired_limit_bytes": mlx_limits["gpu_wired_limit_bytes"],
        },
    }
# [END]


