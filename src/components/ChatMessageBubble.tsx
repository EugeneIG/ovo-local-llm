import { memo, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, GitBranch } from "lucide-react";
import type { Message } from "../types/ovo";
import { AttachmentChip } from "./AttachmentChip";
// [START] Phase 8 — shared segment parser (lib/messageSegments).
// parseSegments auto-hides self-talk lines ("Wait, I should...", "The user...",
// "Turn N:"…) so every chat surface — main chat, code agent — inherits the
// same reasoning-noise filter instead of each renderer maintaining its own
// copy. Segment type is re-exported from the shared module.
import { parseSegments } from "../lib/messageSegments";
// [END]
// [START] Phase 8 — fork action
import { useSessionsStore } from "../store/sessions";
import { useToastsStore } from "../store/toasts";
// [END]
// [START] Phase 8 — TTS auto-play
import { useFeatureFlagsStore } from "../store/feature_flags";
import { speakText, cancelTts } from "../lib/voiceIO";
import { useSidecarStore } from "../store/sidecar";
// [END]

interface Props {
  message: Message;
  streaming?: boolean;
}

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

// [START] Phase 8 — Fork button: appears on hover on user/assistant bubbles.
// Forks the current session at this message id into a new branch session and
// switches focus to it. Tool-result and summary bubbles are not forkable.
function ForkButton({ messageId, side }: { messageId: string; side: "left" | "right" }) {
  const { t } = useTranslation();
  const fork = useSessionsStore((s) => s.forkFromMessage);
  const currentSessionId = useSessionsStore((s) => s.currentSessionId);
  const pushToast = useToastsStore((s) => s.push);

  async function handle() {
    if (!currentSessionId) return;
    try {
      const branch = await fork(currentSessionId, messageId);
      if (branch) {
        pushToast({ kind: "success", message: t("chat.fork.created", { title: branch.title }) });
      }
    } catch (e) {
      pushToast({
        kind: "error",
        message: t("chat.fork.failed", { error: e instanceof Error ? e.message : String(e) }),
      });
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handle()}
      title={t("chat.fork.button")}
      aria-label={t("chat.fork.button")}
      className={`opacity-0 group-hover:opacity-100 focus:opacity-100 transition p-1 rounded text-ovo-muted hover:text-ovo-accent hover:bg-ovo-bg/40 ${
        side === "right" ? "order-first" : ""
      }`}
    >
      <GitBranch className="w-3 h-3" aria-hidden />
    </button>
  );
}
// [END]

function ChatMessageBubbleImpl({ message, streaming }: Props) {
  const { t } = useTranslation();
  const isUser = message.role === "user";
  const isSummary = message.role === "summary";
  const isSystem = message.role === "system";

  // [START] Phase 8 — TTS auto-play: fire when streaming transitions true→false.
  // prevStreamingRef tracks the previous value so we only speak NEW completed turns,
  // not historical messages that mount with streaming=false.
  const enableTts = useFeatureFlagsStore((s) => s.enable_tts_response);
  const ports = useSidecarStore((s) => s.status.ports);
  const prevStreamingRef = useRef(streaming ?? false);
  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = streaming ?? false;
    if (wasStreaming && !streaming && message.role === "assistant" && enableTts) {
      // Reuse parseSegments so every reasoning dialect (Harmony, ChatML, alt
      // tags, brackets) is normalized + stripped, plus tool_use/tool_result
      // blocks. Only `text` segments survive into TTS.
      const plain = parseSegments(message.content)
        .filter((seg) => seg.type === "text")
        .map((seg) => (seg as { content: string }).content)
        .join(" ")
        .replace(/```[\s\S]*?```/g, "")
        .replace(/`[^`]+`/g, "")
        .replace(/[*_#>~]/g, "")
        .trim();
      if (plain) {
        speakText(plain, ports).catch((err) => console.error("[voiceIO] TTS:", err));
      }
    }
  }, [streaming, enableTts]);
  useEffect(() => () => { cancelTts(); }, []);
  // [END]

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
    // [START] Phase 6.2c / Phase 5 — tool_result user messages are the
    // downstream side of a tool call, not actual user input. Route them to
    // the LEFT (assistant side) so the timeline reads "tool_use → tool_result"
    // grouped under the agent turn that triggered them, instead of bouncing
    // the result chip to the user column.
    const userSegments = parseSegments(message.content);
    const isOnlyToolResult =
      userSegments.length === 1 && userSegments[0].type === "tool_result";
    if (isOnlyToolResult && userSegments[0].type === "tool_result") {
      return (
        <div className="flex justify-start">
          <div className="max-w-[78%]">
            <ToolResultBlock content={userSegments[0].content} />
          </div>
        </div>
      );
    }
    // [END]
    return (
      <div className="flex flex-col items-end gap-1 group">
        {hasAttachments && (
          <div className="flex flex-wrap gap-1.5 justify-end max-w-[78%]">
            {message.attachments!.map((a) => (
              <AttachmentChip key={a.id} attachment={a} />
            ))}
          </div>
        )}
        {message.content.length > 0 && (
          <div className="flex items-end gap-1.5 max-w-[78%]">
            <ForkButton messageId={message.id} side="right" />
            <div className="rounded-2xl rounded-br-sm bg-ovo-user text-ovo-user-ink px-3.5 py-2 text-sm whitespace-pre-wrap break-words">
              {message.content}
            </div>
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
    <div className="flex justify-start items-end gap-1.5 group">
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
            if (seg.type === "attached_files") {
              return (
                <div key={i} className="flex flex-wrap gap-1.5 my-1">
                  {seg.paths.map((p) => {
                    const name = p.split("/").pop() ?? p;
                    return (
                      <span
                        key={p}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-ovo-chip border border-ovo-chip-border text-[11px] text-ovo-text"
                        title={p}
                      >
                        <span>📎</span>
                        <span className="truncate max-w-[220px] font-mono">{name}</span>
                      </span>
                    );
                  })}
                </div>
              );
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
      {!streaming && hasAnyContent && <ForkButton messageId={message.id} side="left" />}
    </div>
  );
}

export const ChatMessageBubble = memo(ChatMessageBubbleImpl);
