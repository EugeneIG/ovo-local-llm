import { memo, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import type { ChatMessage } from "../types/ovo";
import { AttachmentChip } from "./AttachmentChip";

interface Props {
  message: ChatMessage;
  streaming?: boolean;
}

// [START] <think>...</think> parser — splits assistant content into text/think segments.
// An unterminated <think> (no </think> yet) is marked `open: true` so it can show a streaming state.
type Segment =
  | { type: "text"; content: string }
  | { type: "think"; content: string; open: boolean };

const OPEN_TAG = "<think>";
const CLOSE_TAG = "</think>";

function skipLeadingWs(s: string, from: number): number {
  let j = from;
  while (j < s.length) {
    const c = s[j];
    if (c === " " || c === "\n" || c === "\r" || c === "\t") j++;
    else break;
  }
  return j;
}

function parseSegments(content: string): Segment[] {
  const out: Segment[] = [];
  let i = 0;

  // Implicit-open: some reasoning models (R1-style) emit `</think>` without a
  // preceding `<think>` because the prompt template already injected the open tag.
  // Treat the prefix before the first unmatched `</think>` as a closed think block.
  const firstOpen = content.indexOf(OPEN_TAG);
  const firstClose = content.indexOf(CLOSE_TAG);
  if (firstClose !== -1 && (firstOpen === -1 || firstClose < firstOpen)) {
    const prefix = content.slice(0, firstClose).trim();
    out.push({ type: "think", content: prefix, open: false });
    i = skipLeadingWs(content, firstClose + CLOSE_TAG.length);
  }

  while (i < content.length) {
    const openIdx = content.indexOf(OPEN_TAG, i);
    if (openIdx === -1) {
      out.push({ type: "text", content: content.slice(i) });
      break;
    }
    if (openIdx > i) out.push({ type: "text", content: content.slice(i, openIdx) });
    const afterOpen = openIdx + OPEN_TAG.length;
    const closeIdx = content.indexOf(CLOSE_TAG, afterOpen);
    if (closeIdx === -1) {
      out.push({ type: "think", content: content.slice(afterOpen), open: true });
      return out.filter((s) => !(s.type === "text" && s.content.length === 0));
    }
    out.push({ type: "think", content: content.slice(afterOpen, closeIdx), open: false });
    i = skipLeadingWs(content, closeIdx + CLOSE_TAG.length);
  }
  return out.filter((s) => !(s.type === "text" && s.content.length === 0));
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
    <div className="my-1 border-l-2 border-[#E8CFBB] pl-2">
      <button
        type="button"
        onClick={toggle}
        className="flex items-center gap-1 text-[11px] text-[#8B4432] hover:text-[#2C1810] transition-colors"
      >
        <ChevronDown
          className={`w-3 h-3 transition-transform ${expanded ? "" : "-rotate-90"}`}
          aria-hidden
        />
        <span>{label}</span>
        {open && (
          <span className="inline-flex gap-0.5 ml-1" aria-hidden>
            <span className="w-1 h-1 rounded-full bg-[#8B4432] animate-bounce [animation-delay:-0.3s]" />
            <span className="w-1 h-1 rounded-full bg-[#8B4432] animate-bounce [animation-delay:-0.15s]" />
            <span className="w-1 h-1 rounded-full bg-[#8B4432] animate-bounce" />
          </span>
        )}
      </button>
      {expanded && content.length > 0 && (
        <div className="mt-1 text-xs text-[#8B4432]/90 whitespace-pre-wrap leading-relaxed">
          {content}
        </div>
      )}
    </div>
  );
}

function ChatMessageBubbleImpl({ message, streaming }: Props) {
  const isUser = message.role === "user";

  if (isUser) {
    const hasAttachments = (message.attachments?.length ?? 0) > 0;
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
          <div className="max-w-[78%] rounded-2xl rounded-br-sm bg-[#D97757] text-white px-3.5 py-2 text-sm whitespace-pre-wrap break-words">
            {message.content}
          </div>
        )}
      </div>
    );
  }

  const segments = parseSegments(message.content);
  const hasAnyContent = segments.some(
    (s) => (s.type === "text" && s.content.length > 0) || s.type === "think",
  );
  const showInitialDots = streaming && !hasAnyContent;
  const lastSegment = segments[segments.length - 1];
  const showCaret =
    streaming && hasAnyContent && lastSegment?.type === "text" && lastSegment.content.length > 0;

  return (
    <div className="flex justify-start">
      <div className="max-w-[82%] rounded-2xl rounded-bl-sm bg-white/80 border border-[#E8CFBB] text-[#2C1810] px-3.5 py-2 text-sm whitespace-pre-wrap break-words">
        {showInitialDots ? (
          <span className="inline-flex gap-1 items-center text-[#8B4432]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#8B4432] animate-bounce [animation-delay:-0.3s]" />
            <span className="w-1.5 h-1.5 rounded-full bg-[#8B4432] animate-bounce [animation-delay:-0.15s]" />
            <span className="w-1.5 h-1.5 rounded-full bg-[#8B4432] animate-bounce" />
          </span>
        ) : (
          segments.map((seg, i) =>
            seg.type === "think" ? (
              <ThinkBlock key={i} content={seg.content} open={seg.open} />
            ) : (
              <span key={i}>{seg.content}</span>
            ),
          )
        )}
        {showCaret && (
          <span
            className="inline-block w-1.5 h-3.5 ml-0.5 align-[-2px] bg-[#8B4432] animate-pulse"
            aria-hidden
          />
        )}
      </div>
    </div>
  );
}

export const ChatMessageBubble = memo(ChatMessageBubbleImpl);
