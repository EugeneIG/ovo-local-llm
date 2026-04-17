import { memo, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import type { Message } from "../types/ovo";
import { AttachmentChip } from "./AttachmentChip";
// [START] Phase 6.2c — tool-use segment parsing helpers
import { parseToolUseBlock } from "../lib/toolUse";
// [END]

interface Props {
  message: Message;
  streaming?: boolean;
}

// [START] Multi-format reasoning parser.
// Normalizes several reasoning markup dialects into canonical <think>/</think>
// before segmentation: Harmony channels (analysis/thought/commentary/final),
// ChatML think turns, alt HTML-ish tags (<thinking>, <reasoning>, ...), bracket
// variants ([THOUGHT]..[/THOUGHT]). Then strips any loose harmony/ChatML meta
// tokens that leaked into plain text (the original bug: raw `<|channel|>`, etc.
// visible in the bubble for gpt-oss / harmony-formatted models).
type Segment =
  | { type: "text"; content: string }
  | { type: "think"; content: string; open: boolean }
  // [START] Phase 6.2c — tool-use segment types
  | { type: "tool_use"; name: string; argsJson: string }
  | { type: "tool_result"; content: string };
  // [END]

const OPEN_TAG = "<think>";
const CLOSE_TAG = "</think>";

function normalizeReasoning(input: string): string {
  let s = input;

  // Complete Harmony reasoning channels → <think>..</think>
  s = s.replace(
    /<\|channel\|>(?:analysis|thought|commentary)(?:<\|constrain\|>[^<]*)?<\|message\|>([\s\S]*?)(?:<\|end\|>|<\|return\|>)/g,
    (_m, body: string) => `${OPEN_TAG}${body}${CLOSE_TAG}`,
  );
  // Complete Harmony final/response channel → strip wrapper, keep body as text
  s = s.replace(
    /<\|channel\|>(?:final|response)(?:<\|constrain\|>[^<]*)?<\|message\|>([\s\S]*?)(?:<\|end\|>|<\|return\|>)/g,
    (_m, body: string) => body,
  );
  // Streaming Harmony reasoning open-only (no terminator yet)
  s = s.replace(
    /<\|channel\|>(?:analysis|thought|commentary)(?:<\|constrain\|>[^<]*)?<\|message\|>/g,
    OPEN_TAG,
  );
  // Streaming Harmony final open-only → drop wrapper
  s = s.replace(
    /<\|channel\|>(?:final|response)(?:<\|constrain\|>[^<]*)?<\|message\|>/g,
    "",
  );

  // ChatML think turn → <think>..</think>
  s = s.replace(
    /<\|im_start\|>(?:think|reasoning|analysis|assistant_thought)\s*\n?([\s\S]*?)<\|im_end\|>/g,
    (_m, body: string) => `${OPEN_TAG}${body}${CLOSE_TAG}`,
  );
  s = s.replace(
    /<\|im_start\|>(?:think|reasoning|analysis|assistant_thought)\s*\n?/g,
    OPEN_TAG,
  );

  // Alt HTML-ish tag pairs → <think>..</think>
  const altPairs: Array<[string, string]> = [
    ["thinking", "thinking"],
    ["reasoning", "reasoning"],
    ["reflection", "reflection"],
    ["scratchpad", "scratchpad"],
  ];
  for (const [open, close] of altPairs) {
    s = s.replace(
      new RegExp(`<${open}>([\\s\\S]*?)</${close}>`, "g"),
      (_m, body: string) => `${OPEN_TAG}${body}${CLOSE_TAG}`,
    );
    s = s.replace(new RegExp(`<${open}>`, "g"), OPEN_TAG);
  }

  // Bracket reasoning variants
  const brackets = ["THOUGHT", "THINK", "REASONING"];
  for (const name of brackets) {
    s = s.replace(
      new RegExp(`\\[${name}\\]([\\s\\S]*?)\\[/${name}\\]`, "g"),
      (_m, body: string) => `${OPEN_TAG}${body}${CLOSE_TAG}`,
    );
    s = s.replace(new RegExp(`\\[${name}\\]`, "g"), OPEN_TAG);
    s = s.replace(new RegExp(`\\[/${name}\\]`, "g"), CLOSE_TAG);
  }

  // Loose Harmony/ChatML meta tokens that slipped through — strip so they don't
  // render as plaintext garbage in the bubble.
  s = s.replace(
    /<\|(?:start|end|return|message|channel|constrain|\/constrain|im_start|im_end)\|>/g,
    "",
  );

  return s;
}

function skipLeadingWs(s: string, from: number): number {
  let j = from;
  while (j < s.length) {
    const c = s[j];
    if (c === " " || c === "\n" || c === "\r" || c === "\t") j++;
    else break;
  }
  return j;
}

// [START] Phase 6.2c — tool_result tag constants
const TOOL_USE_OPEN = "<tool_use>";
const TOOL_USE_CLOSE = "</tool_use>";
const TOOL_RESULT_OPEN = "<tool_result>";
const TOOL_RESULT_CLOSE = "</tool_result>";
// [END]

function parseSegments(raw: string): Segment[] {
  const content = normalizeReasoning(raw);
  const out: Segment[] = [];
  let i = 0;

  // Implicit-open: R1-style templates inject <think> on the server side, so the
  // stream can begin with reasoning content that terminates at </think>.
  const firstOpen = content.indexOf(OPEN_TAG);
  const firstClose = content.indexOf(CLOSE_TAG);
  if (firstClose !== -1 && (firstOpen === -1 || firstClose < firstOpen)) {
    const prefix = content.slice(0, firstClose).trim();
    out.push({ type: "think", content: prefix, open: false });
    i = skipLeadingWs(content, firstClose + CLOSE_TAG.length);
  }

  while (i < content.length) {
    // [START] Phase 6.2c — find the nearest special tag among think/tool_use/tool_result
    const nextThink = content.indexOf(OPEN_TAG, i);
    const nextToolUse = content.indexOf(TOOL_USE_OPEN, i);
    const nextToolResult = content.indexOf(TOOL_RESULT_OPEN, i);

    // Pick the earliest tag; -1 means absent (treat as Infinity for comparison)
    const candidates: Array<[number, string]> = [
      [nextThink === -1 ? Infinity : nextThink, "think"],
      [nextToolUse === -1 ? Infinity : nextToolUse, "tool_use"],
      [nextToolResult === -1 ? Infinity : nextToolResult, "tool_result"],
    ];
    candidates.sort((a, b) => a[0] - b[0]);
    const [nearestIdx, nearestKind] = candidates[0];

    if (nearestIdx === Infinity) {
      // No more special tags — rest is plain text
      out.push({ type: "text", content: content.slice(i) });
      break;
    }

    // Emit any plain text before the tag
    if (nearestIdx > i) {
      out.push({ type: "text", content: content.slice(i, nearestIdx) });
    }

    if (nearestKind === "think") {
      const afterOpen = nearestIdx + OPEN_TAG.length;
      const closeIdx = content.indexOf(CLOSE_TAG, afterOpen);
      if (closeIdx === -1) {
        out.push({ type: "think", content: content.slice(afterOpen), open: true });
        return out.filter((s) => !(s.type === "text" && s.content.length === 0));
      }
      out.push({ type: "think", content: content.slice(afterOpen, closeIdx), open: false });
      i = skipLeadingWs(content, closeIdx + CLOSE_TAG.length);
    } else if (nearestKind === "tool_use") {
      // [START] Phase 6.2c — parse tool_use segment
      const afterOpen = nearestIdx + TOOL_USE_OPEN.length;
      const closeIdx = content.indexOf(TOOL_USE_CLOSE, afterOpen);
      if (closeIdx === -1) {
        // Incomplete block during streaming — treat remainder as text
        out.push({ type: "text", content: content.slice(nearestIdx) });
        break;
      }
      const parsed = parseToolUseBlock(content.slice(nearestIdx));
      if (parsed !== null) {
        out.push({
          type: "tool_use",
          name: parsed.name,
          argsJson: JSON.stringify(parsed.arguments, null, 2),
        });
      } else {
        // Fallback: emit as text if JSON parsing failed
        out.push({ type: "text", content: content.slice(nearestIdx, closeIdx + TOOL_USE_CLOSE.length) });
      }
      i = skipLeadingWs(content, closeIdx + TOOL_USE_CLOSE.length);
      // [END]
    } else {
      // tool_result
      // [START] Phase 6.2c — parse tool_result segment
      const afterOpen = nearestIdx + TOOL_RESULT_OPEN.length;
      const closeIdx = content.indexOf(TOOL_RESULT_CLOSE, afterOpen);
      if (closeIdx === -1) {
        out.push({ type: "text", content: content.slice(nearestIdx) });
        break;
      }
      out.push({ type: "tool_result", content: content.slice(afterOpen, closeIdx).trim() });
      i = skipLeadingWs(content, closeIdx + TOOL_RESULT_CLOSE.length);
      // [END]
    }
    // [END] Phase 6.2c nearest-tag dispatch
  }
  return out.filter((s) => !(s.type === "text" && s.content.length === 0));
}
// [END]

// [START] Phase 6.2c — ToolUseBlock: collapsible card for assistant tool calls
function ToolUseBlock({ name, argsJson }: { name: string; argsJson: string }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mt-1 mb-3 rounded-lg border border-ovo-chip-border bg-ovo-chip px-3 py-2 text-xs">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-1 text-left text-ovo-muted hover:text-ovo-text transition-colors"
      >
        <ChevronDown
          className={`w-3 h-3 shrink-0 transition-transform ${expanded ? "" : "-rotate-90"}`}
          aria-hidden
        />
        <span className="font-medium">{t("chat.tool_use.call_label", { name })}</span>
      </button>
      {expanded && (
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-ovo-muted/90 leading-relaxed">
          {argsJson}
        </pre>
      )}
    </div>
  );
}
// [END]

// [START] Phase 6.2c — ToolResultBlock: collapsible card for tool results (user messages)
function ToolResultBlock({ content }: { content: string }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mt-1 mb-1 rounded-lg border border-ovo-chip-border bg-ovo-chip px-3 py-2 text-xs">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-1 text-left text-ovo-muted hover:text-ovo-text transition-colors"
      >
        <ChevronDown
          className={`w-3 h-3 shrink-0 transition-transform ${expanded ? "" : "-rotate-90"}`}
          aria-hidden
        />
        <span className="font-medium">{t("chat.tool_use.result_label")}</span>
      </button>
      {expanded && (
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-ovo-muted/90 leading-relaxed">
          {content}
        </pre>
      )}
    </div>
  );
}
// [END]

function ThinkBlock({ content, open }: { content: string; open: boolean }) {
  const { t } = useTranslation();
  // Expanded while still streaming; auto-collapse once </think> arrives.
  // User can still toggle manually after that.
  const [expanded, setExpanded] = useState(true);
  const [userToggled, setUserToggled] = useState(false);
  useEffect(() => {
    if (!open && !userToggled) setExpanded(false);
  }, [open, userToggled]);

  const toggle = () => {
    setUserToggled(true);
    setExpanded((v) => !v);
  };

  const label = open ? t("chat.thinking") : t("chat.thought");

  return (
    <div className="mt-1 mb-3 border-l-2 border-ovo-chip-border pl-2">
      <button
        type="button"
        onClick={toggle}
        className="flex items-center gap-1 text-[11px] text-ovo-muted hover:text-ovo-text transition-colors"
      >
        <ChevronDown
          className={`w-3 h-3 transition-transform ${expanded ? "" : "-rotate-90"}`}
          aria-hidden
        />
        <span>{label}</span>
        {open && (
          <span className="inline-flex gap-0.5 ml-1" aria-hidden>
            <span className="w-1 h-1 rounded-full bg-ovo-muted animate-bounce [animation-delay:-0.3s]" />
            <span className="w-1 h-1 rounded-full bg-ovo-muted animate-bounce [animation-delay:-0.15s]" />
            <span className="w-1 h-1 rounded-full bg-ovo-muted animate-bounce" />
          </span>
        )}
      </button>
      {expanded && content.length > 0 && (
        <div className="mt-1 text-xs text-ovo-muted/90 whitespace-pre-wrap leading-relaxed">
          {content}
        </div>
      )}
    </div>
  );
}

function ChatMessageBubbleImpl({ message, streaming }: Props) {
  const { t } = useTranslation();
  const isUser = message.role === "user";
  const isSummary = message.role === "summary";
  const isSystem = message.role === "system";

  // [START] Summary bubble — auto-compact insertion. Rendered as a muted,
  // centered card so the user recognizes it as synthesized context rather than
  // the model's own turn.
  if (isSummary) {
    return (
      <div className="flex justify-center">
        <div className="max-w-[88%] rounded-xl bg-ovo-chip border border-dashed border-ovo-chip-border text-ovo-text px-3.5 py-2 text-xs">
          <div className="text-[10px] uppercase tracking-wider text-ovo-muted mb-1">
            {t("chat.summary_badge")}
          </div>
          <div className="whitespace-pre-wrap">{message.content}</div>
        </div>
      </div>
    );
  }
  if (isSystem) {
    return null;
  }
  // [END]

  if (isUser) {
    const hasAttachments = (message.attachments?.length ?? 0) > 0;
    // [START] Phase 6.2c — detect pure tool_result user messages and render as card
    const userSegments = parseSegments(message.content);
    const isOnlyToolResult =
      userSegments.length === 1 && userSegments[0].type === "tool_result";
    if (isOnlyToolResult && userSegments[0].type === "tool_result") {
      return (
        <div className="flex justify-end">
          <div className="max-w-[78%]">
            <ToolResultBlock content={userSegments[0].content} />
          </div>
        </div>
      );
    }
    // [END]
    return (
      <div className="flex flex-col items-end gap-1">
        {hasAttachments && (
          <div className="flex flex-wrap gap-1.5 justify-end max-w-[78%]">
            {message.attachments!.map((a) => (
              <AttachmentChip key={a.id} attachment={a} />
            ))}
          </div>
        )}
        {message.content.length > 0 && (
          <div className="max-w-[78%] rounded-2xl rounded-br-sm bg-ovo-user text-ovo-user-ink px-3.5 py-2 text-sm whitespace-pre-wrap break-words">
            {message.content}
          </div>
        )}
      </div>
    );
  }

  const segments = parseSegments(message.content);
  const hasAnyContent = segments.some(
    (s) =>
      (s.type === "text" && s.content.length > 0) ||
      s.type === "think" ||
      s.type === "tool_use" ||
      s.type === "tool_result",
  );
  const showInitialDots = streaming && !hasAnyContent;
  const lastSegment = segments[segments.length - 1];
  const showCaret =
    streaming && hasAnyContent && lastSegment?.type === "text" && lastSegment.content.length > 0;

  return (
    <div className="flex justify-start">
      <div className="max-w-[82%] rounded-2xl rounded-bl-sm bg-ovo-assistant border border-ovo-border text-ovo-text px-3.5 py-2 text-sm whitespace-pre-wrap break-words">
        {showInitialDots ? (
          <span className="inline-flex gap-1 items-center text-ovo-muted">
            <span className="w-1.5 h-1.5 rounded-full bg-ovo-muted animate-bounce [animation-delay:-0.3s]" />
            <span className="w-1.5 h-1.5 rounded-full bg-ovo-muted animate-bounce [animation-delay:-0.15s]" />
            <span className="w-1.5 h-1.5 rounded-full bg-ovo-muted animate-bounce" />
          </span>
        ) : (
          // [START] Phase 6.2c — render tool_use and tool_result segments alongside think/text
          segments.map((seg, i) => {
            if (seg.type === "think") {
              return <ThinkBlock key={i} content={seg.content} open={seg.open} />;
            }
            if (seg.type === "tool_use") {
              return <ToolUseBlock key={i} name={seg.name} argsJson={seg.argsJson} />;
            }
            if (seg.type === "tool_result") {
              return <ToolResultBlock key={i} content={seg.content} />;
            }
            return <span key={i}>{seg.content}</span>;
          })
          // [END]
        )}
        {showCaret && (
          <span
            className="inline-block w-1.5 h-3.5 ml-0.5 align-[-2px] bg-ovo-muted animate-pulse"
            aria-hidden
          />
        )}
      </div>
    </div>
  );
}

export const ChatMessageBubble = memo(ChatMessageBubbleImpl);
