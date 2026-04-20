// [START] Phase 5 — Inline Chat (Cmd+I).
// Floating prompt panel anchored to the top of the Monaco editor. The user
// highlights code (or just parks the cursor), presses Cmd+I, types an
// instruction, and the selected range gets rewritten with the model's
// response. We don't show a diff view in this MVP — Cmd+Z rolls the edit
// back if the result is off, and accept/reject can layer on top later.
//
// Kept as a self-contained component because it has no overlap with the
// AgentChat panel's conversation state: each Cmd+I is a one-shot request
// with no history, no tool use, no retry loop. Reuses `streamChat` from
// the OpenAI compat layer for token-level streaming.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles, X, Loader2, Send } from "lucide-react";
import { streamChat, type ChatWireMessage } from "../../lib/api";
import { useSidecarStore } from "../../store/sidecar";

interface InlineChatBoxProps {
  open: boolean;
  /** Monaco model ref for the file being edited. */
  modelRef: string | null;
  /** Path of the current file — purely for context in the system prompt. */
  path: string;
  /** Language hint (typescript, python, etc.) passed to the model. */
  language: string;
  /** Text currently selected in Monaco (empty string = no selection). */
  selection: string;
  /** Full file content so the model can reason about surrounding context. */
  fullText: string;
  /** Caller supplies `replaceSelection` so Monaco's edit API (undo-aware)
   *  handles the rewrite. Passing the new text through a callback keeps
   *  this component ignorant of Monaco internals. */
  onAccept: (newText: string) => void;
  onClose: () => void;
}

export function InlineChatBox({
  open,
  modelRef,
  path,
  language,
  selection,
  fullText,
  onAccept,
  onClose,
}: InlineChatBoxProps) {
  const { t } = useTranslation();
  const ports = useSidecarStore((s) => s.status.ports);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setPrompt("");
      setError(null);
      queueMicrotask(() => inputRef.current?.focus());
    } else {
      // Cancel any in-flight request when the box closes.
      abortRef.current?.abort();
      setBusy(false);
    }
  }, [open]);

  // Esc closes the box even if Monaco has focus.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  async function handleSubmit() {
    if (!prompt.trim() || !modelRef) return;
    setBusy(true);
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;

    // System prompt: ask for the rewritten snippet ONLY, no prose/markdown
    // fences. Models tend to wrap in ``` — we strip those post-hoc just in
    // case.
    const systemPrompt = [
      `You are an inline code-edit assistant inside a ${language} file at "${path}".`,
      "Respond with ONLY the rewritten snippet that should replace the user's selection.",
      "Do NOT include markdown code fences, commentary, or explanations.",
      "Preserve the surrounding indentation and style of the file.",
    ].join("\n");

    const contextSnippet =
      selection.length > 0
        ? `<selection>\n${selection}\n</selection>`
        : `<cursor_context>\n${fullText.slice(Math.max(0, fullText.length - 1500))}\n</cursor_context>`;

    const wire: ChatWireMessage[] = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `${contextSnippet}\n\nInstruction: ${prompt.trim()}`,
      },
    ];

    try {
      let buf = "";
      for await (const ev of streamChat(
        { model: modelRef, messages: wire, max_tokens: 1024, temperature: 0.1 },
        controller.signal,
        ports,
      )) {
        if (ev.delta) buf += ev.delta;
      }
      const cleaned = stripFences(buf).trimEnd();
      if (cleaned.length === 0) {
        setError(t("code.inline_chat.empty_response"));
      } else {
        onAccept(cleaned);
      }
    } catch (err) {
      if ((err as { name?: string } | null)?.name === "AbortError") return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  return (
    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-30 w-[520px] max-w-[90%] rounded-lg bg-ovo-surface-solid border border-ovo-accent/40 shadow-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-ovo-border bg-ovo-bg/50">
        <Sparkles className="w-3.5 h-3.5 text-ovo-accent" />
        <span className="text-xs font-semibold text-ovo-text flex-1">
          {t("code.inline_chat.title")}
          {selection.length > 0 && (
            <span className="ml-2 text-ovo-muted font-normal">
              {t("code.inline_chat.selection_chars", { n: selection.length })}
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("code.inline_chat.close")}
          className="p-0.5 rounded text-ovo-muted hover:text-ovo-text hover:bg-ovo-surface transition"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="p-2">
        <textarea
          ref={inputRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSubmit();
            }
          }}
          placeholder={
            modelRef
              ? t("code.inline_chat.placeholder")
              : t("code.inline_chat.no_model")
          }
          disabled={!modelRef || busy}
          rows={2}
          className="w-full resize-none bg-transparent text-[13px] leading-5 text-ovo-text placeholder:text-ovo-muted focus:outline-none"
        />
      </div>

      <div className="flex items-center justify-between px-2 py-1.5 border-t border-ovo-border/50 text-[10px] text-ovo-muted">
        <span>
          {busy
            ? t("code.inline_chat.generating")
            : error
              ? <span className="text-rose-400">{error}</span>
              : t("code.inline_chat.hint")}
        </span>
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!prompt.trim() || !modelRef || busy}
          className="flex items-center gap-1 px-2 py-0.5 rounded bg-ovo-accent/20 text-ovo-accent hover:bg-ovo-accent/30 disabled:opacity-40 disabled:cursor-not-allowed text-[10px] font-semibold transition"
        >
          {busy ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Send className="w-3 h-3" />
          )}
          {busy ? t("code.inline_chat.generating_btn") : t("code.inline_chat.submit")}
        </button>
      </div>
    </div>
  );
}

// Strip ``` fences the model might wrap output in even though we asked it
// not to. Handles both fenced (```lang\n...\n```) and un-fenced output.
function stripFences(raw: string): string {
  const m = raw.match(/```[a-zA-Z]*\n([\s\S]*?)\n```/);
  if (m) return m[1];
  return raw.trim();
}
// [END] Phase 5
