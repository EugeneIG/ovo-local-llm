// [START] Phase 4 — AI Inline Completion (FIM ghost text) client.
// Talks to the sidecar's /ovo/code/complete endpoint, which streams
// Fill-In-Middle deltas as SSE frames. The Monaco InlineCompletionsProvider
// in MonacoEditor.tsx consumes this to paint ghost text at the cursor.
//
// Two public helpers:
//   streamCodeCompletion — async iterator over {delta | done | error}
//   requestCodeCompletion — collect-all convenience wrapper used by Monaco
//                            (the provider needs a single final string, not
//                            progressive deltas, because it repaints ghost
//                            text wholesale on each provider resolve).
import { DEFAULT_PORTS } from "./api";
import type { SidecarPorts } from "../types/sidecar";

export interface CodeCompletionRequest {
  model: string;
  prefix: string;
  suffix?: string;
  language?: string | null;
  max_tokens?: number;
  temperature?: number;
}

export type CodeCompletionEvent =
  | { type: "delta"; text: string }
  | { type: "done"; reason: string }
  | { type: "error"; message: string };

function nativeBase(ports: SidecarPorts): string {
  return `http://127.0.0.1:${ports.native}`;
}

export async function* streamCodeCompletion(
  req: CodeCompletionRequest,
  signal?: AbortSignal,
  ports: SidecarPorts = DEFAULT_PORTS,
): AsyncGenerator<CodeCompletionEvent, void, void> {
  const resp = await fetch(`${nativeBase(ports)}/ovo/code/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: req.model,
      prefix: req.prefix,
      suffix: req.suffix ?? "",
      language: req.language ?? null,
      max_tokens: req.max_tokens ?? 128,
      temperature: req.temperature ?? 0.2,
    }),
    signal,
  });
  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => "");
    throw new Error(`code completion failed: ${resp.status} ${text}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      try {
        const parsed = JSON.parse(payload) as CodeCompletionEvent;
        yield parsed;
        if (parsed.type === "done" || parsed.type === "error") return;
      } catch {
        // Partial / malformed frame — skip and keep reading.
      }
    }
  }
}

/**
 * Collect a single complete suggestion. Monaco's InlineCompletionsProvider
 * wants one string per resolve, so we accumulate deltas until the stream
 * emits `done` (or `error`). Returns an empty string on any failure mode —
 * ghost text absence is safer than a partial broken suggestion.
 */
export async function requestCodeCompletion(
  req: CodeCompletionRequest,
  signal?: AbortSignal,
  ports: SidecarPorts = DEFAULT_PORTS,
): Promise<string> {
  let acc = "";
  try {
    for await (const ev of streamCodeCompletion(req, signal, ports)) {
      if (ev.type === "delta") acc += ev.text;
      else if (ev.type === "error") return "";
      else if (ev.type === "done") return acc;
    }
  } catch (e) {
    if ((e as { name?: string } | null)?.name === "AbortError") return "";
    // Silent — inline completion must never surface errors in the UI.
    return "";
  }
  return acc;
}
// [END] Phase 4
