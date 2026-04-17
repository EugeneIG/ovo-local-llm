// [START] Phase 6.2c — Tool-use helpers for prompt-engineered MCP tool calls.
// Pure functions — no side effects, no store access.

import type { McpTool } from "./mcp";

// [START] Phase 6.4 — OVO built-in tools.
// These are hosted by the Python sidecar (/ovo/*) and are always available
// regardless of whether any MCP server is registered. The server_id namespace
// 'ovo:builtin' is reserved so the chat dispatcher can route them internally
// instead of through the MCP pool.
export const BUILTIN_SERVER_ID = "ovo:builtin";

export const BUILTIN_TOOLS: McpTool[] = [
  {
    name: "web_search",
    description:
      "OVO 내장 인터넷 검색 (DuckDuckGo 기반, API 키 불필요). 최신 정보가 필요할 때 사용.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "검색어" },
        limit: {
          type: "integer",
          description: "최대 결과 수 (기본 8, 최대 20)",
          default: 8,
        },
      },
      required: ["query"],
    },
  },
];

export function isBuiltinTool(name: string): boolean {
  return BUILTIN_TOOLS.some((tool) => tool.name === name);
}
// [END]

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ParsedToolCall {
  name: string;
  arguments: Record<string, unknown>;
  /** Raw text block including tags so caller can splice it out of the output. */
  raw: string;
}

// ── parseToolUseBlock ─────────────────────────────────────────────────────────

const TOOL_OPEN = "<tool_use>";
const TOOL_CLOSE = "</tool_use>";

/**
 * Scan model output for a complete <tool_use>{JSON}</tool_use> block.
 * Returns null if no complete block is found (e.g. during mid-stream partial).
 *
 * Edge cases handled:
 * - Partial open tag without closing tag → returns null (safe during streaming).
 * - Block inside a <think> section → skipped; caller should strip think blocks
 *   before passing, or we detect the tag is inside a think region (see below).
 * - Multiple blocks → returns the first complete one only (caller recurses).
 * - Nested quotes in JSON → handled by JSON.parse naturally.
 */
export function parseToolUseBlock(text: string): ParsedToolCall | null {
  const openIdx = text.indexOf(TOOL_OPEN);
  if (openIdx === -1) return null;

  // Guard: if the <tool_use> tag appears inside a <think> block, ignore it.
  // We check if there is an unclosed <think> before the openIdx.
  const THINK_OPEN = "<think>";
  const THINK_CLOSE = "</think>";
  const textBefore = text.slice(0, openIdx);
  const lastThinkOpen = textBefore.lastIndexOf(THINK_OPEN);
  const lastThinkClose = textBefore.lastIndexOf(THINK_CLOSE);
  if (lastThinkOpen !== -1 && lastThinkOpen > lastThinkClose) {
    // Inside an unclosed <think> — ignore
    return null;
  }

  const contentStart = openIdx + TOOL_OPEN.length;
  const closeIdx = text.indexOf(TOOL_CLOSE, contentStart);
  if (closeIdx === -1) return null; // incomplete — wait for more tokens

  const raw = text.slice(openIdx, closeIdx + TOOL_CLOSE.length);
  const jsonText = text.slice(contentStart, closeIdx).trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    // Malformed JSON — skip this block
    return null;
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("name" in parsed) ||
    typeof (parsed as Record<string, unknown>).name !== "string"
  ) {
    return null;
  }

  const p = parsed as Record<string, unknown>;
  const args = p.arguments;
  const safeArgs: Record<string, unknown> =
    typeof args === "object" && args !== null && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : {};

  return {
    name: p.name as string,
    arguments: safeArgs,
    raw,
  };
}

// ── buildToolsSystemMessage ───────────────────────────────────────────────────

/**
 * Build a system-prompt section listing available MCP tools and instructing
 * the model to emit <tool_use>{JSON}</tool_use> when it wants to call one.
 *
 * Schema is inlined in compact JSON form from tool.input_schema.
 */
export function buildToolsSystemMessage(tools: McpTool[]): string {
  if (tools.length === 0) return "";

  const toolLines = tools
    .map((tool) => {
      const schemaStr =
        tool.input_schema !== null && tool.input_schema !== undefined
          ? JSON.stringify(tool.input_schema)
          : "{}";
      const desc = tool.description ? ` — ${tool.description}` : "";
      return `- \`${tool.name}\`${desc}. Schema: ${schemaStr}`;
    })
    .join("\n");

  return [
    "You have access to the following tools. To call one, respond with:",
    "",
    "<tool_use>",
    '{"name": "tool_name", "arguments": {"arg1": "value"}}',
    "</tool_use>",
    "",
    "Wait for a <tool_result> message before continuing.",
    "",
    "Tools:",
    toolLines,
  ].join("\n");
}
// [END] Phase 6.2c
