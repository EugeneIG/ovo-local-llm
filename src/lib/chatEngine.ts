// [START] Phase 8 — Shared chat/agent stream engine.
// Pure, store-agnostic streaming turn: consumes `streamChat`, batches deltas,
// detects <think> transitions for owl UI, runs a line-level repetition guard,
// and stops early on the first complete <tool_use> block. The caller owns
// wire construction, DB persistence, and tool dispatch — this module is
// intentionally narrow so chat.ts (full-featured) and code_agent.ts
// (minimal) can share the hot loop without leaking their concerns at each
// other.
//
// A1 scope: used by code_agent.ts first. chat.ts rewire (A3) is a follow-up.

import { streamChat, type ChatWireMessage, type StreamUsage } from "./api";
import { parseToolUseBlock, type ParsedToolCall } from "./toolUse";
import type { SidecarPorts } from "../types/sidecar";

// [START] Think-transition markers — mirrored from store/chat.ts so the
// engine stays dependency-free. If chat.ts moves to the engine later, these
// stay as the single source of truth.
const THINK_OPEN_MARKERS: ReadonlyArray<string> = [
  "<think>",
  "<thinking>",
  "<reasoning>",
  "<|channel|>analysis",
  "<|channel|>reasoning",
];
const THINK_CLOSE_MARKERS: ReadonlyArray<string> = [
  "</think>",
  "</thinking>",
  "</reasoning>",
  "<|end|>",
];
const THINK_SCAN_WINDOW = 500;

export function detectThinkTransition(accumulated: string): boolean | null {
  const start = Math.max(0, accumulated.length - THINK_SCAN_WINDOW);
  const tail = accumulated.substring(start);
  let lastOpen = -1;
  for (const tag of THINK_OPEN_MARKERS) {
    const idx = tail.lastIndexOf(tag);
    if (idx > lastOpen) lastOpen = idx;
  }
  let lastClose = -1;
  for (const tag of THINK_CLOSE_MARKERS) {
    const idx = tail.lastIndexOf(tag);
    if (idx > lastClose) lastClose = idx;
  }
  if (lastOpen === -1 && lastClose === -1) return null;
  return lastOpen > lastClose;
}
// [END]

export type OwlPhase = "thinking" | "typing";

export interface SamplingParams {
  temperature: number;
  top_p: number;
  repetition_penalty: number;
  max_tokens: number;
}

export interface StreamTurnOptions {
  /** Model id (HF repo or local path). */
  model: string;
  /** Wire messages to send — caller handles system prompt composition. */
  wire: ChatWireMessage[];
  /** Sampling overrides. Undefined fields stay off the wire. */
  sampling?: Partial<SamplingParams>;
  /** Sidecar ports. */
  ports: SidecarPorts;
  /** Abort signal — caller owns the controller. */
  signal: AbortSignal;
  /** Fired on every delta with the full accumulated text (already appended). */
  onDelta: (accumulated: string) => void;
  /** Owl phase transition — only fires when the inside-think flag actually flips. */
  onOwlPhase?: (phase: OwlPhase) => void;
  /** Fired once on the first delta frame. */
  onFirstToken?: () => void;
  /** Set `false` to ignore tool_use blocks (pure chat mode). Default true. */
  detectToolUse?: boolean;
  /** Line-level repetition guard threshold. 0 disables. Default 10. */
  repetitionThreshold?: number;
  /** Stuck-stream guard: ms with no new delta before auto-abort. 0 disables. Default 30000. */
  stuckIdleMs?: number;
  /** First-token guard: ms from stream start to first delta before auto-abort. 0 disables. Default 300000 (5 min).
   * Phase 4 bump: cold-loading a 14B/30B MLX quant can take 60-180s on
   * M-series unified memory before the first token is produced. The prior
   * 60s ceiling tripped every first-load turn. Hot-model turns still emit
   * in <5s so this only kicks in on a genuine sidecar crash.
   */
  firstTokenTimeoutMs?: number;
}

export interface StreamTurnResult {
  /** Full accumulated text the stream produced (may include a tool_use block). */
  accumulated: string;
  /** Parsed usage from the terminal frame, or null if the sidecar omitted it. */
  usage: StreamUsage | null;
  /** First complete tool_use block that was detected, or null. */
  toolCall: ParsedToolCall | null;
  /** True when the repetition guard aborted the stream. */
  repetitionDetected: boolean;
  /** True when the stuck-idle watchdog aborted the stream. */
  stuckDetected: boolean;
  /** True when the first-token watchdog aborted the stream (sidecar never responded). */
  firstTokenTimedOut: boolean;
  /** ms from call start to the first delta, or null if no delta arrived. */
  firstTokenMs: number | null;
  /** Count of delta frames — useful as a token-count fallback for perf records. */
  deltaCount: number;
}

// [START] runStreamTurn — the shared hot loop.
// Consumes `streamChat`, invokes onDelta for every frame, tracks think-vs-typing
// state, runs a line-repeat guard, and stops early on the first tool_use block.
// Returns a plain result object — the caller decides what to persist, whether
// to recurse for tool results, and how to react to repetitions. No stores, no
// DB, no awaits beyond the stream itself.
export async function runStreamTurn(opts: StreamTurnOptions): Promise<StreamTurnResult> {
  const {
    model,
    wire,
    sampling,
    ports,
    signal,
    onDelta,
    onOwlPhase,
    onFirstToken,
    detectToolUse = true,
    repetitionThreshold = 10,
    stuckIdleMs = 30_000,
    firstTokenTimeoutMs = 300_000,
  } = opts;

  let accumulated = "";
  let usage: StreamUsage | null = null;
  let toolCall: ParsedToolCall | null = null;
  let firstTokenAt: number | null = null;
  let deltaCount = 0;
  let stuckDetected = false;
  let firstTokenTimedOut = false;

  // Think-transition state — starts true because callers typically pre-set
  // "thinking" before the first token arrives.
  let insideThink = true;
  let receivedAny = false;

  // Repetition guard state — scans newline-completed lines only so partial
  // token spam does not trip it. 0 disables the whole block.
  let lastProcessedNewlineIdx = -1;
  let lastNonEmptyLine = "";
  let repeatCount = 0;
  let repetitionDetected = false;

  const callStart = performance.now();

  // Build request with sampling spread — undefined keys stay absent.
  const request: Parameters<typeof streamChat>[0] = { model, messages: wire };
  if (sampling) {
    if (typeof sampling.temperature === "number") request.temperature = sampling.temperature;
    if (typeof sampling.top_p === "number") request.top_p = sampling.top_p;
    if (typeof sampling.repetition_penalty === "number" && sampling.repetition_penalty > 1) {
      request.repetition_penalty = sampling.repetition_penalty;
    }
    if (typeof sampling.max_tokens === "number" && sampling.max_tokens > 0) {
      request.max_tokens = sampling.max_tokens;
    }
  }

  // [START] Internal abort — fires when the repetition guard trips or a
  // tool_use block completes. We combine it with the caller's signal via a
  // linked controller so neither side has to know about the other.
  const linkedAbort = new AbortController();
  const propagate = () => linkedAbort.abort();
  signal.addEventListener("abort", propagate, { once: true });
  // [END]

  // [START] Phase 8.4 B-track — stuck-stream + first-token watchdog.
  // Two silent-failure modes handled by one timer:
  //   (a) Mid-stream idle: sidecar held the connection open but stopped
  //       emitting deltas for 30+ s (DeepSeek-V2-Lite "silent stop").
  //   (b) First-token never arrives: sidecar crashed / model still loading /
  //       prefill stuck — we never get a single delta, `receivedAny` stays
  //       false, and the prior version of this watchdog waited forever.
  // Separate thresholds because first-token prefill legitimately takes
  // longer than per-token latency (big context, cold model), so 60s default
  // vs 30s mid-stream. Set either to 0 to disable that leg.
  let lastActivityAt = callStart;
  let watchdog: ReturnType<typeof setInterval> | null = null;
  if (stuckIdleMs > 0 || firstTokenTimeoutMs > 0) {
    const tickMs =
      Math.min(
        2_000,
        Math.max(
          500,
          Math.floor(Math.max(stuckIdleMs, firstTokenTimeoutMs) / 4),
        ),
      );
    watchdog = setInterval(() => {
      const now = performance.now();
      if (!receivedAny) {
        if (firstTokenTimeoutMs > 0 && now - callStart >= firstTokenTimeoutMs) {
          firstTokenTimedOut = true;
          linkedAbort.abort();
        }
        return;
      }
      if (stuckIdleMs > 0 && now - lastActivityAt >= stuckIdleMs) {
        stuckDetected = true;
        linkedAbort.abort();
      }
    }, tickMs);
  }
  // [END]

  try {
    try {
      for await (const frame of streamChat(request, linkedAbort.signal, ports)) {
        lastActivityAt = performance.now();
      if (frame.usage) {
        usage = frame.usage;
        continue;
      }
      if (!frame.delta) continue;

      accumulated += frame.delta;
      deltaCount += 1;
      onDelta(accumulated);

      if (!receivedAny) {
        receivedAny = true;
        firstTokenAt = performance.now();
        onFirstToken?.();
      }

      // Repetition guard — scan newly completed lines.
      if (repetitionThreshold > 0) {
        let idx = accumulated.indexOf("\n", lastProcessedNewlineIdx + 1);
        while (idx !== -1) {
          const line = accumulated.substring(lastProcessedNewlineIdx + 1, idx).trim();
          lastProcessedNewlineIdx = idx;
          if (line.length > 0) {
            if (line === lastNonEmptyLine) {
              repeatCount += 1;
              if (repeatCount >= repetitionThreshold) {
                repetitionDetected = true;
                break;
              }
            } else {
              lastNonEmptyLine = line;
              repeatCount = 1;
            }
          }
          idx = accumulated.indexOf("\n", lastProcessedNewlineIdx + 1);
        }
        if (repetitionDetected) {
          linkedAbort.abort();
          break;
        }
      }

      // Owl phase transition — flip only when detection moves.
      const trans = detectThinkTransition(accumulated);
      const target: boolean =
        trans === null ? insideThink : trans;
      if (target !== insideThink) {
        insideThink = target;
        onOwlPhase?.(insideThink ? "thinking" : "typing");
      }

      // Tool-use detection — stop the stream the moment we have a complete
      // <tool_use> block so the caller can dispatch and recurse.
      if (detectToolUse) {
        const parsed = parseToolUseBlock(accumulated);
        if (parsed !== null) {
          toolCall = parsed;
          linkedAbort.abort();
          break;
        }
      }
    }
    } catch (err) {
      // [START] Phase 8.4 — absorb self-aborts.
      // Any of our internal guards (toolCall found, repetition, stuck,
      // first-token timeout) calls linkedAbort.abort(), which makes the
      // underlying fetch reject with AbortError. That's expected — we
      // already captured the reason in a flag. Only rethrow when the abort
      // came from somewhere else (caller signal, network error, etc.).
      const selfAborted =
        linkedAbort.signal.aborted &&
        (toolCall !== null ||
          repetitionDetected ||
          stuckDetected ||
          firstTokenTimedOut);
      // Name-based check: Tauri / Node / browser all surface abort errors
      // with `name === "AbortError"` even when instanceof DOMException fails
      // (e.g. different realms / polyfilled fetch).
      const errName =
        err !== null && typeof err === "object" && "name" in err
          ? (err as { name?: unknown }).name
          : undefined;
      const errMsg =
        err instanceof Error ? err.message : typeof err === "string" ? err : "";
      const isAbortError =
        errName === "AbortError" ||
        /abort/i.test(errMsg);
      if (!selfAborted || !isAbortError) throw err;
      // [END]
    }
  } finally {
    signal.removeEventListener("abort", propagate);
    if (watchdog !== null) clearInterval(watchdog);
  }

  return {
    accumulated,
    usage,
    toolCall,
    repetitionDetected,
    stuckDetected,
    firstTokenTimedOut,
    firstTokenMs: firstTokenAt !== null ? firstTokenAt - callStart : null,
    deltaCount,
  };
}
// [END]
// [END] Phase 8
