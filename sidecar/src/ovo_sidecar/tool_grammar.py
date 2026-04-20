"""Phase 8.4 — grammar-constrained JSON generation for tool calls.

Uses the Outlines 1.x `Generator` + `json_schema` pipeline against an
mlx-lm model to produce a JSON string that provably conforms to a tool
call schema. This eliminates the silent-failure class where a local
model forgets an escape or closes the wrong brace — the decoder simply
cannot emit invalid tokens.

We import outlines lazily and fail open: if the library isn't available
or the build fails for any reason, the caller should fall back to
unconstrained generation + the frontend jsonrepair fallback, and things
keep working (just without the hard guarantee).
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


def build_tool_call_schema(tool_schemas: list[dict[str, Any]]) -> dict[str, Any]:
    """Compose a `oneOf` schema that accepts any of the tool signatures.

    Shape for each branch:
        {"name": "<literal>", "arguments": {...tool-specific...}}
    """
    branches: list[dict[str, Any]] = []
    for tool in tool_schemas:
        name = tool.get("name")
        if not isinstance(name, str):
            continue
        args_schema = (
            tool.get("parameters")
            or tool.get("input_schema")
            or {"type": "object", "additionalProperties": True}
        )
        branches.append(
            {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "const": name},
                    "arguments": args_schema,
                },
                "required": ["name", "arguments"],
                "additionalProperties": False,
            }
        )
    if not branches:
        return {"type": "object"}
    return {"oneOf": branches}


def generate_constrained_tool_call(
    model: Any,
    tokenizer: Any,
    prompt: str,
    tool_schemas: list[dict[str, Any]],
    max_tokens: int = 4096,
) -> str | None:
    """Return a guaranteed-valid JSON tool call string, or None on failure.

    The returned value parses as JSON and matches one of the declared
    tool schemas — no quotes to escape, no braces to balance, no
    backticks to remember. Caller can JSON.parse it directly.
    """
    try:
        import outlines
    except Exception as e:
        logger.info("outlines unavailable, grammar constraint disabled: %s", e)
        return None

    try:
        schema = build_tool_call_schema(tool_schemas)
        ol_model = outlines.from_mlxlm(model, tokenizer)
        gen = outlines.Generator(ol_model, outlines.json_schema(schema))
        # Outlines Generator is callable; returns a string that matches
        # the schema. mlx-lm generation parameters pass through kwargs.
        raw = gen(prompt, max_tokens=max_tokens)
        if isinstance(raw, str):
            return raw
        # Some outlines backends return a pydantic-ish object — coerce
        # via the canonical `model_dump_json` path.
        dump = getattr(raw, "model_dump_json", None)
        if callable(dump):
            return dump()
        return str(raw)
    except Exception as e:
        logger.warning("constrained tool_call generation failed: %s", e)
        return None
