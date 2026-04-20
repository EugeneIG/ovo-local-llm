// [START] Phase 8 — Claude-Code-style message renderer for the code agent.
// Parses the assistant text into segments (see lib/messageSegments) and
// renders them as a vertical timeline: each tool call and each think block
// becomes its own compact step, and plain prose flows as markdown between
// them. This mirrors the in-app shell the user is already familiar with,
// and keeps the code agent visually consistent with Claude Code.
//
// The main chat still uses ChatMessageBubble for now; that migration lives
// in a follow-up pass. Parsing is already shared via parseSegments so the
// two renderers never diverge on dialect handling.

import { memo, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import { ChevronRight, Check, Loader2 } from "lucide-react";
import {
  parseSegments,
  normalizeReasoning,
  type Segment,
} from "../lib/messageSegments";
import { pickVerb, toolLabel, summarizeToolCall } from "../lib/agentVerbs";

// [START] Phase 5 — helper: pull `<attached_files>…</attached_files>` blocks
// out of a user message. Returns the prose body (block stripped) plus the
// parsed file-path list for chip rendering. Non-user messages route through
// parseSegments, which handles the same block as an `attached_files`
// segment — this function is only used by the user-bubble fast path.
function extractUserAttachments(raw: string): { body: string; paths: string[] } {
  let body = raw;
  const paths: string[] = [];
  const open = "<attached_files>";
  const close = "</attached_files>";
  while (true) {
    const oi = body.indexOf(open);
    if (oi === -1) break;
    const ci = body.indexOf(close, oi + open.length);
    if (ci === -1) break;
    const inner = body.slice(oi + open.length, ci);
    for (const line of inner.split("\n")) {
      const cleaned = line.trim().replace(/^-\s*/, "");
      if (cleaned.length > 0) paths.push(cleaned);
    }
    body = (body.slice(0, oi) + body.slice(ci + close.length)).replace(/\n{3,}/g, "\n\n");
  }
  return { body: body.trim(), paths };
}
// [END]

interface Props {
  /** Raw message content — may include `<think>`, `<tool_use>`, `<tool_result>` blocks. */
  content: string;
  /** True while the stream is still writing to this message. Drives the
   *  in-progress verb on open think blocks and greys the final check. */
  streaming?: boolean;
  /** Stable key used to pick a gerund for think blocks (message id works). */
  messageKey?: string;
  /** Mirror the message role so user/assistant can style differently. */
  role: "user" | "assistant" | "system" | "tool_result";
}

export const MessageRenderer = memo(function MessageRenderer({
  content,
  streaming = false,
  messageKey = "",
  role,
}: Props) {
  // User messages are plain prose in a right-aligned bubble — no segment
  // parsing needed and no timeline markers. Keep them simple so they read
  // like a chat on the right.
  // [START] Phase 5 — strip the composer's `<attached_files>` XML wrapper
  // and render the file list as chips below the prose so the bubble stays
  // clean. The DB row still carries the wrapper verbatim so the model
  // always sees full fidelity context.
  if (role === "user") {
    const { body, paths } = extractUserAttachments(content);
    return (
      <div className="flex flex-col items-end gap-1">
        {body.length > 0 && (
          <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-ovo-user text-ovo-user-ink px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap">
            {body}
          </div>
        )}
        {paths.length > 0 && (
          <div className="max-w-[85%] flex flex-wrap gap-1.5 justify-end">
            {paths.map((p) => {
              const name = p.split("/").pop() ?? p;
              return (
                <span
                  key={p}
                  title={p}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-ovo-chip border border-ovo-chip-border text-[11px] text-ovo-text"
                >
                  <span>📎</span>
                  <span className="truncate max-w-[220px] font-mono">{name}</span>
                </span>
              );
            })}
          </div>
        )}
      </div>
    );
  }
  // [END]

  // [START] Phase 8 — streaming-lite mode.
  // While the assistant is still writing this message, skip the heavy
  // ReactMarkdown + highlight.js pipeline and render a collapsed progress
  // row plus a raw pre tail. Once streaming flips off we swap to the full
  // timeline — by then parseSegments only runs once on the final text.
  // Without this the main thread freezes on long answers because each
  // delta re-parses the entire markdown document.
  if (streaming) {
    return <StreamingPreview content={content} />;
  }
  // [END]

  // Pair tool_use with the tool_result that follows it so they render as a
  // single collapsible card. Standalone tool_result messages (persisted as
  // their own row in code_agent) still fall through as a simple step.
  const segments = useMemo(() => parseSegments(content), [content]);
  const paired = useMemo(() => pairToolUse(segments), [segments]);

  // [START] Phase 8 — Claude-Code-style spine.
  // Each assistant message is a vertical timeline: a continuous thin line
  // runs down the left gutter and each step punches through it with a
  // colour-coded dot. The whole message owns the spine; steps just decide
  // what colour their dot is. `relative` on the outer div + `absolute`
  // left line + per-step dots is the simplest way to get a clean spine
  // without fighting flex-box gap measurements.
  return (
    <div className="relative flex flex-col gap-3 min-w-0 max-w-full pl-5">
      {/* The spine. Stretches the full height of the message; individual
          dots sit on top of it via z-index. */}
      <span
        aria-hidden
        className="absolute left-[7px] top-2 bottom-2 w-px bg-ovo-border/70"
      />
      {paired.map((seg, idx) => (
        <TimelineStep
          key={idx}
          seg={seg}
          streaming={streaming}
          segKey={`${messageKey}:${idx}`}
        />
      ))}
    </div>
  );
});

// [START] StreamingPreview — lightweight view used while the stream is
// still writing. Detects whether we're currently inside a `<think>` block
// via a cheap tail scan and flips between "Cogitating…" and "Writing…"
// labels accordingly. The actual text is rendered inside a collapsed
// `<details>` so the user can peek, but the DOM stays small during the
// hot path. Paint cost is effectively constant no matter how long the
// answer grows, which is the whole point — no O(n²) re-parsing.
function StreamingPreview({ content }: { content: string }) {
  const normalized = normalizeReasoning(content);
  const tail = normalized.slice(Math.max(0, normalized.length - 800));
  const lastOpen = tail.lastIndexOf("<think>");
  const lastClose = tail.lastIndexOf("</think>");
  const insideThink = lastOpen > lastClose;
  const verb = useMemo(() => pickVerb("stream"), []);
  const label = insideThink ? `${verb}…` : "Writing…";
  const visibleLen = content.length;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-[12px] text-ovo-muted">
        <Loader2 className="w-3 h-3 animate-spin text-ovo-accent" />
        <span className="animate-pulse">{label}</span>
        <span className="text-[10px] opacity-70">· {visibleLen.toLocaleString()} chars</span>
      </div>
      <details className="text-[11px] text-ovo-muted/80">
        <summary className="cursor-pointer hover:text-ovo-text transition-colors select-none">
          Show raw output
        </summary>
        <pre className="mt-1 ml-2 pl-2 border-l-2 border-ovo-chip-border whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
          {content}
        </pre>
      </details>
    </div>
  );
}
// [END]

// [START] pairToolUse — if a tool_use segment is immediately followed by a
// tool_result segment, emit a single composite "tool" step so the card can
// show both the call args and the result without cluttering the timeline
// with two adjacent rows.
interface PairedToolStep {
  type: "tool";
  name: string;
  argsJson: string;
  result: string | null;
}
type Paired = Exclude<Segment, { type: "tool_use" } | { type: "tool_result" }> | PairedToolStep;

function pairToolUse(segments: Segment[]): Paired[] {
  const out: Paired[] = [];
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (s.type === "tool_use") {
      const next = segments[i + 1];
      if (next && next.type === "tool_result") {
        out.push({ type: "tool", name: s.name, argsJson: s.argsJson, result: next.content });
        i += 1;
      } else {
        out.push({ type: "tool", name: s.name, argsJson: s.argsJson, result: null });
      }
    } else if (s.type === "tool_result") {
      // Orphaned tool_result — emit as a bare step.
      out.push({ type: "tool", name: "result", argsJson: "", result: s.content });
    } else {
      out.push(s);
    }
  }
  return out;
}
// [END]

interface StepProps {
  seg: Paired;
  streaming: boolean;
  segKey: string;
}

// [START] Phase 8 — dot palette for the spine.
// Colours map to the same semantic meaning across every step kind:
// emerald = success, rose = error, accent = running/thinking, muted = text.
function SpineDot({ tone }: { tone: "text" | "think" | "ok" | "running" | "fail" }) {
  const bg =
    tone === "ok"
      ? "bg-emerald-500"
      : tone === "fail"
        ? "bg-rose-500"
        : tone === "running"
          ? "bg-ovo-accent animate-pulse"
          : tone === "think"
            ? "bg-ovo-muted/60"
            : "bg-ovo-muted/40";
  return (
    <span
      aria-hidden
      className={`absolute -left-5 top-1.5 w-2 h-2 rounded-full ring-2 ring-ovo-bg ${bg}`}
    />
  );
}
// [END]

function TimelineStep({ seg, streaming, segKey }: StepProps) {
  if (seg.type === "text") {
    return (
      <div className="relative">
        <SpineDot tone="text" />
        <TextSegment content={seg.content} />
      </div>
    );
  }
  // [START] Phase 5 — attached_files chip row renders the compact file
  // list in lieu of the raw <attached_files> XML block the composer added.
  if (seg.type === "attached_files") {
    return (
      <div className="relative">
        <SpineDot tone="text" />
        <div className="flex flex-wrap gap-1.5 my-1">
          {seg.paths.map((p) => {
            const name = p.split("/").pop() ?? p;
            return (
              <span
                key={p}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-ovo-chip border border-ovo-chip-border text-[11px] text-ovo-text"
                title={p}
              >
                <span className="shrink-0">📎</span>
                <span className="truncate max-w-[220px] font-mono">{name}</span>
              </span>
            );
          })}
        </div>
      </div>
    );
  }
  // [END]
  if (seg.type === "think") {
    return (
      <div className="relative">
        <SpineDot tone="think" />
        <ThinkStep
          content={seg.content}
          open={seg.open}
          segKey={segKey}
          streaming={streaming}
        />
      </div>
    );
  }
  // Tool step — dot colour reflects running / success / (no-result-yet).
  const toolTone: "ok" | "running" | "fail" =
    streaming && seg.result === null
      ? "running"
      : seg.result && /"error"/.test(seg.result)
        ? "fail"
        : "ok";
  return (
    <div className="relative">
      <SpineDot tone={toolTone} />
      <ToolStep step={seg} streaming={streaming} />
    </div>
  );
}

// [START] wrapAsciiBoxes — catch ASCII-art boxes the model emits without a
// code fence so they don't bleed past the panel width. We scan line-by-
// line for "+---+" borders and "|…|" body rows; any contiguous run gets
// wrapped in a ``` fence so ReactMarkdown routes it through <pre> (which
// already has `overflow-x-auto`). Indented code blocks don't help because
// MLX models usually emit the box with a single leading space, not four.
function wrapAsciiBoxes(input: string): string {
  const lines = input.split("\n");
  const out: string[] = [];
  let inBox = false;
  const isBoxLine = (l: string) => {
    const t = l.trim();
    if (t.length === 0) return false;
    if (/^\+[-+=]+\+/.test(t)) return true; // +---+ border
    if (/^\|.*\|$/.test(t)) return true;    // |  col  |  col  |
    return false;
  };
  const isCodeFence = (l: string) => /^\s*```/.test(l);

  let insideFence = false;
  for (const line of lines) {
    if (isCodeFence(line)) {
      // Don't touch content already inside the model's own fences.
      insideFence = !insideFence;
      if (inBox) {
        out.push("```");
        inBox = false;
      }
      out.push(line);
      continue;
    }
    if (insideFence) {
      out.push(line);
      continue;
    }
    if (isBoxLine(line)) {
      if (!inBox) {
        out.push("```");
        inBox = true;
      }
      out.push(line);
    } else {
      if (inBox) {
        out.push("```");
        inBox = false;
      }
      out.push(line);
    }
  }
  if (inBox) out.push("```");
  return out.join("\n");
}
// [END]

// [START] TextSegment — markdown body. Empty / whitespace-only is skipped
// so the timeline doesn't render ghost rows between tool cards.
function TextSegment({ content }: { content: string }) {
  const trimmed = wrapAsciiBoxes(content.trim());
  if (trimmed.length === 0) return null;
  return (
    // `break-words` + `min-w-0` are the two ingredients that prevent a long
    // URL / ASCII box / path from pushing the whole agent panel wider than
    // its container. `min-w-0` is needed so flex children actually shrink
    // below their content width; without it, the parent just overflows.
    <div className="prose-agent text-[13px] leading-relaxed text-ovo-text break-words min-w-0 max-w-full">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          // Slim paragraph spacing so the timeline reads as log lines, not essay blocks.
          p: ({ children }) => (
            <p className="my-1 break-words whitespace-pre-wrap">{children}</p>
          ),
          ul: ({ children }) => <ul className="my-1 ml-4 list-disc">{children}</ul>,
          ol: ({ children }) => <ol className="my-1 ml-4 list-decimal">{children}</ol>,
          li: ({ children }) => <li className="my-0.5 break-words">{children}</li>,
          code: ({ className, children, ...rest }) => {
            const isBlock = className?.startsWith("language-");
            if (isBlock) {
              return (
                <code className={`${className} text-[12px]`} {...rest}>
                  {children}
                </code>
              );
            }
            return (
              <code
                className="px-1 py-0.5 rounded bg-ovo-chip text-[12px] text-ovo-text break-words"
                {...rest}
              >
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            // Horizontal scroll for ASCII art / wide log lines so the card
            // never pushes the chat width. `whitespace-pre` preserves
            // column alignment (unlike `whitespace-pre-wrap`, which would
            // break the box drawing characters).
            <pre className="my-2 overflow-x-auto rounded-md bg-ovo-chip p-2 text-[12px] leading-snug whitespace-pre max-w-full">
              {children}
            </pre>
          ),
          a: ({ children, ...rest }) => (
            <a className="text-ovo-accent hover:underline break-all" {...rest}>
              {children}
            </a>
          ),
        }}
      >
        {trimmed}
      </ReactMarkdown>
    </div>
  );
}
// [END]

// [START] ThinkStep — collapsed by default once the block closes. While the
// stream is still open, shows a pulsing gerund ("Cogitating…"). Closed
// blocks show "Thought for Ns" using the content length as a rough proxy
// for duration (we don't track wall-clock per block yet).
function ThinkStep({
  content,
  open,
  segKey,
  streaming,
}: {
  content: string;
  open: boolean;
  segKey: string;
  streaming: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const verb = useMemo(() => pickVerb(segKey), [segKey]);

  // Rough "Thought for Ns" — ~20 chars / sec is a reasonable proxy for MLX
  // streaming on a laptop. Not exposed to the caller since this is only a
  // UX hint; real timing will land when model_perf tracks per-block deltas.
  const seconds = Math.max(1, Math.round(content.length / 20));
  const label = open && streaming ? `${verb}…` : `Thought for ${seconds}s`;

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 text-[11px] text-ovo-muted hover:text-ovo-text transition-colors self-start"
      >
        <ChevronRight
          className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`}
        />
        <span className={open && streaming ? "animate-pulse" : ""}>{label}</span>
      </button>
      {expanded && (
        <div className="mt-1 ml-4 pl-2 border-l-2 border-ovo-chip-border text-[12px] text-ovo-muted leading-relaxed whitespace-pre-wrap">
          {content.trim()}
        </div>
      )}
    </div>
  );
}
// [END]

// [START] ToolStep — compact Claude-Code style timeline row.
// `● Read path.tsx` / `● Bash "npm run build"` / `● Grep "pattern"` with
// a chevron that reveals the raw args JSON and the result body. Orphaned
// rows (no args, just a result) render as plain dim text.
// [START] Phase 8.4 — pretty-print tool args.
// Model emits argsJson as a minified blob from parseToolUseBlock. Re-indent
// it so the IN box reads like a real JSON snippet; fall back to the raw
// string if it somehow isn't parseable.
function prettyArgs(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}
// [END]

function ToolStep({ step, streaming }: { step: PairedToolStep; streaming: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const label = toolLabel(step.name);

  // Parse the args JSON once so the summary helper can introspect the
  // shape. Bad JSON falls back to an empty object — the raw text still
  // renders inside the expanded panel.
  const args = useMemo<Record<string, unknown>>(() => {
    if (!step.argsJson) return {};
    try {
      const parsed: unknown = JSON.parse(step.argsJson);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }, [step.argsJson]);

  const summary = summarizeToolCall(step.name, args);
  const running = streaming && step.result === null;

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 text-[12px] text-ovo-text hover:bg-ovo-surface-solid rounded px-0.5 -mx-0.5 transition-colors self-start text-left"
      >
        {running ? (
          <span className="w-2 h-2 rounded-full bg-ovo-accent animate-pulse" />
        ) : (
          <Check className="w-3 h-3 text-emerald-500 shrink-0" />
        )}
        <span className="font-semibold">{label}</span>
        {summary && (
          <span className="text-ovo-muted truncate max-w-[400px]">{summary}</span>
        )}
        <ChevronRight
          className={`w-3 h-3 text-ovo-muted transition-transform ${expanded ? "rotate-90" : ""}`}
        />
      </button>
      {expanded && (
        <div className="mt-1.5 flex flex-col gap-2 w-full max-w-full">
          {step.argsJson && (
            <div className="rounded-md border border-ovo-chip-border bg-ovo-chip/40 overflow-hidden">
              <div className="px-2 py-0.5 text-[9px] uppercase tracking-widest text-ovo-muted font-mono bg-ovo-surface-solid/60 border-b border-ovo-chip-border">
                IN
              </div>
              <pre className="px-2 py-1.5 text-[11px] leading-snug text-ovo-text/90 whitespace-pre-wrap break-all max-h-64 overflow-auto">
                {prettyArgs(step.argsJson)}
              </pre>
            </div>
          )}
          {step.result !== null && (
            <div className="rounded-md border border-ovo-chip-border bg-ovo-chip/40 overflow-hidden">
              <div className="px-2 py-0.5 text-[9px] uppercase tracking-widest text-ovo-muted font-mono bg-ovo-surface-solid/60 border-b border-ovo-chip-border flex items-center justify-between">
                <span>OUT</span>
                <span className="text-ovo-muted/70 normal-case tracking-normal">
                  {step.result.length.toLocaleString()} chars
                </span>
              </div>
              <pre className="px-2 py-1.5 text-[11px] leading-snug text-ovo-text/80 whitespace-pre-wrap break-all max-h-64 overflow-auto">
                {step.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
// [END]
// [END] Phase 8
