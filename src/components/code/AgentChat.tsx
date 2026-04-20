// [START] Phase 8.3 — Agent chat panel for code IDE
// Phase 8 (B1+C): renders the turn history through MessageRenderer so tool
// calls and reasoning collapse into a Claude-Code-style timeline, and the
// input bar grows a lightweight toolbar (attach / slash / queue indicator /
// tool-mode chip) so the user doesn't bounce out to Settings for common
// ops. Input stays enabled while streaming — typing queues the next turn.
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Send,
  Square,
  Trash2,
  Bot,
  Plus,
  ChevronDown,
  Slash,
  Shield,
  X,
  FileText,
  Upload,
  Globe,
  Paperclip,
  Mic,
  MicOff,
  Loader2,
  Sparkles,
} from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useCodeAgentStore } from "../../store/code_agent";
import { useCodeEditorStore } from "../../store/code_editor";
import { useSidecarStore } from "../../store/sidecar";
import { useToolModeStore, type ToolMode } from "../../store/tool_mode";
import { useFeatureFlagsStore } from "../../store/feature_flags";
import { useToastsStore } from "../../store/toasts";
import { listModels } from "../../lib/api";
import { isChatCapableModel } from "../../lib/models";
import {
  startRecording,
  stopRecordingAndTranscribe,
  cancelRecording,
} from "../../lib/voiceIO";
import {
  recommendModel,
  type RecommendationResult,
} from "../../lib/modelRecommendation";
import { useModelPerfStore } from "../../store/model_perf";
import { useWikiStore } from "../../store/wiki";
import { buildSnippetCommands } from "../../lib/wikiSnippets";
import { MessageRenderer } from "../MessageRenderer";
import { SlashPalette, type SlashAction } from "./SlashPalette";
import { useCodeThemeStore, CODE_THEME_PRESETS } from "../../store/code_theme";
import type { OvoModel } from "../../types/ovo";

interface AgentChatProps {
  sessionId: string;
  modelRef: string | null;
  onModelChange: (modelRef: string) => void;
}

// [START] MenuItem — compact row used inside the "+" popover.
function MenuItem({
  icon,
  onClick,
  disabled = false,
  children,
}: {
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left transition ${
        disabled
          ? "text-ovo-muted/60 cursor-not-allowed"
          : "text-ovo-text hover:bg-ovo-bg"
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 truncate">{children}</span>
    </button>
  );
}
// [END]

const TOOL_MODE_LABEL_KEY: Record<ToolMode, string> = {
  bypass: "code.agent.mode.bypass",
  ask: "code.agent.mode.ask",
  plan: "code.agent.mode.plan",
};

export function AgentChat({ sessionId, modelRef, onModelChange }: AgentChatProps) {
  const { t } = useTranslation();
  const messages = useCodeAgentStore((s) => s.messages);
  const streaming = useCodeAgentStore((s) => s.streaming);
  const queue = useCodeAgentStore((s) => s.queue);
  const todos = useCodeAgentStore((s) => s.todos);
  const pendingApproval = useCodeAgentStore((s) => s.pendingApproval);
  const respondApproval = useCodeAgentStore((s) => s.respondApproval);
  const error = useCodeAgentStore((s) => s.error);
  const sendMessage = useCodeAgentStore((s) => s.sendMessage);
  const enqueueMessage = useCodeAgentStore((s) => s.enqueueMessage);
  const removeQueueItem = useCodeAgentStore((s) => s.removeQueueItem);
  const clearQueue = useCodeAgentStore((s) => s.clearQueue);
  const stopStreaming = useCodeAgentStore((s) => s.stopStreaming);
  const clearMessages = useCodeAgentStore((s) => s.clearMessages);
  const loadMessages = useCodeAgentStore((s) => s.loadMessages);
  const queueLen = queue.length;
  const sidecarHealth = useSidecarStore((s) => s.status.health);
  const ports = useSidecarStore((s) => s.status.ports);
  const toolMode = useToolModeStore((s) => s.mode);
  const cycleToolMode = useToolModeStore((s) => s.setMode);
  const editorSelection = useCodeEditorStore((s) => s.editorSelection);
  const openTabs = useCodeEditorStore((s) => s.openTabs);

  const [input, setInput] = useState("");
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [models, setModels] = useState<OvoModel[]>([]);
  // [START] Phase 8 — attachment menu + drag-over state.
  // `plusMenuOpen` drives the "+" action popover (Upload / Context / Web).
  // `dragOver` tints the composer while a file is being dragged into it so
  // the user knows the drop target is live. `attachments` holds the list
  // of file paths the user has queued; we inline their paths into the
  // outgoing message so the agent can resolve them via read_file.
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [webSearchDraft, setWebSearchDraft] = useState<string | null>(null);
  const [webSearchRunning, setWebSearchRunning] = useState(false);
  const [slashPaletteOpen, setSlashPaletteOpen] = useState(false);
  const codeThemeId = useCodeThemeStore((s) => s.presetId);
  const setCodeThemeId = useCodeThemeStore((s) => s.setPreset);
  // [START] Phase 5 — wiki pages for #snippet slash actions.
  const wikiPages = useWikiStore((s) => s.pages);
  // [END]

  // [START] Phase 5 — AgentChat voice input.
  // Mirrors ChatInput: start recording on tap, tap again to stop + transcribe,
  // auto-cancel if a stream starts mid-recording. Gated behind the same
  // enable_voice_input feature flag so users who dislike the mic button can
  // keep it hidden. Transcription appends (with a leading space) to the
  // existing draft instead of overwriting — matches general chat behaviour.
  const enableVoice = useFeatureFlagsStore((s) => s.enable_voice_input);
  const [voiceState, setVoiceState] = useState<"idle" | "recording" | "processing">("idle");
  const pushToast = useToastsStore((s) => s.push);

  async function handleMicClick() {
    if (voiceState === "recording") {
      setVoiceState("processing");
      try {
        const transcript = await stopRecordingAndTranscribe(ports);
        if (transcript) {
          setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
        }
      } catch (err) {
        pushToast({
          kind: "error",
          message: t("chat.voice.error", {
            error: err instanceof Error ? err.message : String(err),
          }),
        });
      } finally {
        setVoiceState("idle");
      }
    } else if (voiceState === "idle") {
      try {
        await startRecording(ports);
        setVoiceState("recording");
      } catch (err) {
        pushToast({
          kind: "error",
          message: t("chat.voice.error", {
            error: err instanceof Error ? err.message : String(err),
          }),
        });
      }
    }
  }

  // Cancel an in-flight recording if the agent starts streaming.
  useEffect(() => {
    if (streaming && voiceState !== "idle") {
      void cancelRecording(ports);
      setVoiceState("idle");
    }
  }, [streaming, voiceState, ports]);
  // [END]

  // [START] Phase 5 — Model recommendation chip.
  // Reuses the same recommendModel heuristic the main chat uses so the
  // AgentChat surfaces "hey, switch to Qwen-Coder-14B for this" when the
  // user types a code-heavy prompt. Attachments in AgentChat are just
  // file paths (not inline images/audio), so we pass an empty ChatAttachment
  // list — the prompt analyzer still catches "has code", "long context",
  // etc. from the text itself.
  const enableRec = useFeatureFlagsStore((s) => s.enable_model_recommendation);
  const perfStats = useModelPerfStore((s) => s.stats);
  const [recommendation, setRecommendation] = useState<RecommendationResult | null>(null);

  useEffect(() => {
    if (!enableRec || models.length === 0) {
      setRecommendation(null);
      return;
    }
    const handle = setTimeout(() => {
      const result = recommendModel({
        prompt: input,
        attachments: [],
        models,
        currentModelRef: modelRef,
        perfStats,
      });
      setRecommendation(result);
    }, 350);
    return () => clearTimeout(handle);
  }, [enableRec, input, models, modelRef, perfStats]);

  const applyRecommendation = useCallback(() => {
    if (!recommendation) return;
    onModelChange(recommendation.model.repo_id);
    setRecommendation(null);
  }, [recommendation, onModelChange]);

  const dismissRecommendation = useCallback(() => {
    setRecommendation(null);
  }, []);
  // [END]
  // [START] Phase 8.4 — attachments now live in the store so other surfaces
  // (file explorer right-click, editor selection menu) can push files into
  // the composer without AgentChat having to expose imperative refs.
  const attachments = useCodeAgentStore((s) => s.attachments);
  const addAttachment = useCodeAgentStore((s) => s.addAttachment);
  const removeAttachment = useCodeAgentStore((s) => s.removeAttachment);
  const clearAttachments = useCodeAgentStore((s) => s.clearAttachments);
  const pendingComposerText = useCodeAgentStore((s) => s.pendingComposerText);
  const consumeComposerText = useCodeAgentStore((s) => s.consumeComposerText);
  // [END]
  // [END]
  const bottomRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const plusMenuRef = useRef<HTMLDivElement>(null);

  // Load messages on session change
  useEffect(() => {
    if (sessionId) {
      void loadMessages(sessionId);
    }
  }, [sessionId, loadMessages]);

  // [START] Phase 8.4 — per-session composer reset.
  // attachments / input draft / history walker live in component-local
  // useState, so without an explicit reset they bleed across sessions when
  // the user switches in the session list. Tie them to sessionId so each
  // session opens with a clean composer.
  useEffect(() => {
    clearAttachments();
    setInput("");
    setHistoryIdx(-1);
    setPlusMenuOpen(false);
  }, [sessionId, clearAttachments]);
  // [END]

  // [START] Phase 8.4 — append external text into the composer.
  // Other surfaces (file explorer ctx menu, editor selection menu) publish
  // text via appendToComposer; we consume and splice it into the local
  // input, preserving whatever the user was already typing.
  useEffect(() => {
    if (!pendingComposerText) return;
    setInput((prev) => (prev.trim().length === 0 ? pendingComposerText.text : `${prev}\n${pendingComposerText.text}`));
    consumeComposerText();
  }, [pendingComposerText, consumeComposerText]);
  // [END]

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Load models when picker opens
  useEffect(() => {
    if (!modelPickerOpen || sidecarHealth !== "healthy") return;
    void listModels(ports)
      .then((resp) => setModels(resp.models.filter(isChatCapableModel)))
      .catch(() => {});
  }, [modelPickerOpen, sidecarHealth, ports]);

  // Close picker on outside click
  useEffect(() => {
    if (!modelPickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setModelPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [modelPickerOpen]);

  // [START] Auto-size textarea — caps at 6 lines so a long paste doesn't
  // eat the whole pane, then scrolls inside the textarea.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 6 * 20)}px`;
  }, [input]);
  // [END]

  // [START] Phase 8 — ArrowUp / ArrowDown recall prior user turns.
  // Standard terminal behaviour: ↑ from an empty (or cursor-at-top) input
  // walks back through the session's user messages, ↓ walks forward. We
  // only consume the key when the input is empty or the cursor is on the
  // first/last line, so normal multiline navigation keeps working.
  const userHistory = useMemo(
    () => messages.filter((m) => m.role === "user").map((m) => m.content),
    [messages],
  );
  const [historyIdx, setHistoryIdx] = useState(-1);
  // Reset the walker whenever the user types something new.
  useEffect(() => {
    if (historyIdx !== -1 && input !== (userHistory[userHistory.length - 1 - historyIdx] ?? "")) {
      setHistoryIdx(-1);
    }
  }, [input, historyIdx, userHistory]);
  const handleHistoryKey = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (userHistory.length === 0) return false;
      const el = e.currentTarget;
      const caretAtStart = el.selectionStart === 0 && el.selectionEnd === 0;
      const caretAtEnd =
        el.selectionStart === el.value.length && el.selectionEnd === el.value.length;

      if (e.key === "ArrowUp" && (input === "" || caretAtStart)) {
        const nextIdx = Math.min(historyIdx + 1, userHistory.length - 1);
        if (nextIdx !== historyIdx) {
          e.preventDefault();
          setHistoryIdx(nextIdx);
          setInput(userHistory[userHistory.length - 1 - nextIdx] ?? "");
          return true;
        }
      }
      if (e.key === "ArrowDown" && historyIdx >= 0 && (input === "" || caretAtEnd || input === userHistory[userHistory.length - 1 - historyIdx])) {
        if (historyIdx === 0) {
          e.preventDefault();
          setHistoryIdx(-1);
          setInput("");
          return true;
        }
        const nextIdx = historyIdx - 1;
        e.preventDefault();
        setHistoryIdx(nextIdx);
        setInput(userHistory[userHistory.length - 1 - nextIdx] ?? "");
        return true;
      }
      return false;
    },
    [historyIdx, input, userHistory],
  );
  // [END]

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed && attachments.length === 0) return;
    if (!modelRef) return;
    // [START] Compose final message with attachments.
    // Attached file paths get appended as an inline reference block the
    // agent can ingest with read_file. Keeping the list tiny (paths only,
    // not content) avoids blowing out context on large files — the agent
    // decides what to read and when.
    const attachBlock = attachments.length
      ? `\n\n<attached_files>\n${attachments.map((p) => `- ${p}`).join("\n")}\n</attached_files>`
      : "";
    const composed = `${trimmed}${attachBlock}`.trim();
    // [END]
    if (streaming) {
      enqueueMessage(composed);
    } else {
      void sendMessage(sessionId, composed, modelRef);
    }
    setInput("");
    clearAttachments();
  }, [input, modelRef, streaming, sessionId, sendMessage, enqueueMessage, attachments]);

  // Attachment helpers removed — now sourced from store above.

  const handleUpload = useCallback(async () => {
    setPlusMenuOpen(false);
    try {
      const selected = await openDialog({ multiple: true });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      for (const p of paths) addAttachment(p);
    } catch {
      /* user cancelled or plugin missing — silent */
    }
  }, [addAttachment]);

  // [START] Phase 8.4 — Add context: attach all currently-open editor tabs.
  // "Context" in this flow means "files I'm looking at" — so pulling every
  // open tab into the agent's attachment list is the most intuitive default.
  // The agent already reads attached files via read_file on the wire, so no
  // extra plumbing needed beyond pushing paths into the store.
  const handleAddContext = useCallback(() => {
    setPlusMenuOpen(false);
    for (const tab of openTabs) {
      addAttachment(tab.path);
    }
  }, [openTabs, addAttachment]);
  // [END]

  // [START] Phase 8.4 — Web search: prompt for query, hit /ovo/websearch,
  // drop a markdown block of the top results into the composer so the user
  // can edit / trim before sending. We don't auto-send — the search is a
  // context-gathering move, not a conversation turn on its own.
  const handleWebSearch = useCallback(() => {
    setPlusMenuOpen(false);
    setWebSearchDraft("");
  }, []);

  const runWebSearch = useCallback(async () => {
    const query = (webSearchDraft ?? "").trim();
    if (!query) {
      setWebSearchDraft(null);
      return;
    }
    setWebSearchRunning(true);
    try {
      const { webSearch } = await import("../../lib/api");
      const results = await webSearch(query, 5);
      const lines = [`### Web search: "${query}"`];
      const items = Array.isArray(results?.results) ? results.results : [];
      if (items.length === 0) {
        lines.push("_(no results)_");
      } else {
        for (const r of items) {
          const rec = r as unknown as Record<string, unknown>;
          const title = typeof rec.title === "string" ? rec.title : String(rec.title ?? "");
          const url = typeof rec.url === "string" ? rec.url : String(rec.url ?? "");
          const snippet =
            typeof rec.snippet === "string" ? rec.snippet : String(rec.snippet ?? "");
          lines.push(`- [${title}](${url})\n  ${snippet}`);
        }
      }
      useCodeAgentStore.getState().appendToComposer(lines.join("\n"));
    } catch (e) {
      console.warn("websearch failed", e);
      useCodeAgentStore
        .getState()
        .appendToComposer(
          `_(web search failed: ${e instanceof Error ? e.message : String(e)})_`,
        );
    } finally {
      setWebSearchRunning(false);
      setWebSearchDraft(null);
    }
  }, [webSearchDraft]);
  // [END]

  // [START] Phase 8.4 — /compact handler.
  // Calls the sidecar summarize endpoint, injects the summary into the
  // composer so the user can review and send as a fresh starting message
  // (non-destructive — keeps the full history intact for scroll-back).
  const handleCompact = useCallback(async () => {
    if (!modelRef) return;
    const msgs = useCodeAgentStore.getState().messages;
    if (msgs.length === 0) return;
    const forWire = msgs
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role === "tool_result" ? "user" : m.role, content: m.content }));
    try {
      const { summarize } = await import("../../lib/api");
      const res = await summarize(modelRef, forWire, { max_tokens: 1024 });
      const block =
        `---\n📋 Previous conversation summary:\n\n${res.summary}\n\n---\nContinue from here.`;
      useCodeAgentStore.getState().appendToComposer(block);
    } catch (e) {
      console.warn("[code_agent] /compact failed", e);
    }
  }, [modelRef]);
  // [END]

  // [START] Phase 8.4 — slash palette action catalog.
  // Flat list grouped by section — SlashPalette handles filter + keyboard
  // nav. Keep the action list close to what the user actually needs from
  // the composer: attach/clear/switch model/theme/mode. No hypothetical
  // actions that do nothing when selected.
  const slashActions = useMemo<SlashAction[]>(() => {
    const list: SlashAction[] = [];
    const SECTION = t("code.agent.slash_palette.section_commands");
    list.push({
      id: "clear",
      section: SECTION,
      label: "/clear",
      hint: t("code.agent.slash_palette.hint_clear"),
      destructive: true,
      keywords: ["clear", "reset", "new", "conversation"],
      onSelect: () => void clearMessages(sessionId),
    });
    list.push({
      id: "compact",
      section: SECTION,
      label: "/compact",
      hint: t("code.agent.slash_palette.hint_compact"),
      keywords: ["compact", "summarize", "shrink"],
      onSelect: () => void handleCompact(),
    });
    list.push({
      id: "model",
      section: SECTION,
      label: "/model",
      hint: modelRef ?? t("code.agent.slash_palette.none"),
      keywords: ["model", "switch"],
      onSelect: () => setModelPickerOpen(true),
    });
    const MODES: ToolMode[] = ["bypass", "ask", "plan"];
    for (const m of MODES) {
      list.push({
        id: `mode-${m}`,
        section: SECTION,
        label: `/${m}`,
        hint:
          toolMode === m
            ? t("code.agent.slash_palette.current")
            : t("code.agent.slash_palette.hint_mode", { mode: m }),
        keywords: ["mode", "tool", m],
        onSelect: () => cycleToolMode(m),
      });
    }
    for (const preset of Object.values(CODE_THEME_PRESETS)) {
      list.push({
        id: `theme-${preset.id}`,
        section: SECTION,
        label: `/theme-${preset.id.replace(/_/g, "-")}`,
        hint: codeThemeId === preset.id ? t("code.agent.slash_palette.current") : preset.label,
        keywords: ["theme", "color", preset.label.toLowerCase()],
        onSelect: () => setCodeThemeId(preset.id),
      });
    }
    // [START] Phase 5 — Wiki #snippet pages as template actions.
    // Any wiki page tagged `#snippet` surfaces here. Selecting one injects
    // the page body into the composer (append, not replace) so the user
    // keeps whatever they were typing.
    const SNIPPET_SECTION = t("code.agent.slash_palette.section_snippets");
    for (const sc of buildSnippetCommands(wikiPages)) {
      list.push({
        id: `snippet-${sc.id}`,
        section: SNIPPET_SECTION,
        label: sc.name,
        hint: sc.description,
        keywords: [sc.id, ...(sc.aliases ?? [])],
        onSelect: () => {
          const body =
            sc.kind === "template" && typeof sc.template === "function"
              ? sc.template("")
              : "";
          if (body) useCodeAgentStore.getState().appendToComposer(body);
        },
      });
    }
    // [END]
    return list;
  }, [
    t,
    openTabs,
    modelRef,
    toolMode,
    codeThemeId,
    handleUpload,
    handleAddContext,
    handleWebSearch,
    clearMessages,
    sessionId,
    cycleToolMode,
    setCodeThemeId,
    wikiPages,
    handleCompact,
  ]);
  // [END]

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      // Tauri drag-drop events expose file paths via the native bridge;
      // HTMLDragEvent.dataTransfer.files carries a File handle which in
      // Tauri has a `path` property surfaced on the drop.
      const files = Array.from(e.dataTransfer?.files ?? []);
      for (const f of files) {
        const withPath = f as File & { path?: string };
        if (withPath.path) addAttachment(withPath.path);
      }
    },
    [addAttachment],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length === 0) return;
      e.preventDefault();
      for (const f of files) {
        const withPath = f as File & { path?: string };
        if (withPath.path) addAttachment(withPath.path);
      }
    },
    [addAttachment],
  );
  // [END]

  // Close the "+" popover on outside click.
  useEffect(() => {
    if (!plusMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (plusMenuRef.current && !plusMenuRef.current.contains(e.target as Node)) {
        setPlusMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [plusMenuOpen]);

  const handleToolModeClick = useCallback(() => {
    const order: ToolMode[] = ["bypass", "ask", "plan"];
    const nextIdx = (order.indexOf(toolMode) + 1) % order.length;
    void cycleToolMode(order[nextIdx]);
  }, [toolMode, cycleToolMode]);

  const selectedModelName = modelRef?.split("/").pop() ?? null;
  // Assistant + user turns render through MessageRenderer. tool_result rows
  // still persist so the model sees them in the wire, but we don't need to
  // render them as standalone steps — MessageRenderer pairs them with the
  // preceding tool_use block inside the prior assistant turn. That said,
  // standalone tool_result rows (injected between turns) should still show
  // as collapsible steps so the user has visibility.
  const visibleMessages = messages.filter(
    (m) => m.role !== "system" && m.role !== "tool_result",
  );

  const placeholder = !modelRef
    ? t("code.agent.no_model")
    : streaming || queueLen > 0
      ? t("code.agent.placeholder_queue")
      : t("code.agent.placeholder");

  return (
    <div className="h-full flex flex-col bg-ovo-bg relative">
      {/* [START] Phase 8 C2 — Tool approval modal (ask mode).
          Renders as an overlay on the AgentChat. Resolved callback flips
          the store's pendingApproval back to null automatically. */}
      {pendingApproval && (
        <div className="absolute inset-0 z-40 bg-black/40 flex items-end justify-center p-4">
          <div className="w-full max-w-md rounded-xl bg-ovo-surface-solid border border-ovo-border shadow-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-ovo-border">
              <div className="text-sm font-semibold text-ovo-text">
                {t("code.agent.approval.title")}
              </div>
              <div className="text-xs text-ovo-muted mt-0.5">
                {t("code.agent.approval.subtitle", { tool: pendingApproval.toolName })}
              </div>
            </div>
            <div className="px-4 py-3 text-[11px] text-ovo-muted">
              <div className="uppercase tracking-wide text-[10px] mb-1 text-ovo-muted">
                {t("code.agent.approval.args")}
              </div>
              <pre className="bg-ovo-chip rounded p-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-ovo-text/90">
                {JSON.stringify(pendingApproval.args, null, 2)}
              </pre>
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-ovo-border bg-ovo-bg/40">
              <button
                type="button"
                onClick={() => respondApproval(false)}
                className="px-3 py-1.5 rounded text-xs bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition"
              >
                {t("code.agent.approval.reject")}
              </button>
              <button
                type="button"
                onClick={() => respondApproval(true)}
                className="px-3 py-1.5 rounded text-xs bg-ovo-accent text-ovo-accent-ink hover:bg-ovo-accent-hover transition"
              >
                {t("code.agent.approval.approve")}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* [END] */}

      {/* [START] Phase 8.4 — Web search prompt modal.
          window.prompt is blocked in Tauri webviews, so we drive a small
          inline dialog from local state. Enter submits, Esc cancels. */}
      {webSearchDraft !== null && (
        <div className="absolute inset-0 z-40 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl bg-ovo-surface-solid border border-ovo-border shadow-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-ovo-border">
              <div className="text-sm font-semibold text-ovo-text">
                {t("code.agent.browse_web")}
              </div>
              <div className="text-xs text-ovo-muted mt-0.5">
                {t("code.agent.web_search_prompt")}
              </div>
            </div>
            <div className="px-4 py-3">
              <input
                autoFocus
                type="text"
                value={webSearchDraft}
                onChange={(e) => setWebSearchDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !webSearchRunning) void runWebSearch();
                  if (e.key === "Escape") setWebSearchDraft(null);
                }}
                disabled={webSearchRunning}
                placeholder={t("code.agent.web_search_prompt")}
                className="w-full text-xs px-3 py-2 rounded bg-ovo-bg border border-ovo-border text-ovo-text placeholder:text-ovo-muted focus:outline-none focus:ring-1 focus:ring-ovo-accent"
              />
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-ovo-border bg-ovo-bg/40">
              <button
                type="button"
                onClick={() => setWebSearchDraft(null)}
                disabled={webSearchRunning}
                className="px-3 py-1.5 rounded text-xs bg-ovo-surface text-ovo-muted hover:bg-ovo-chip transition disabled:opacity-40"
              >
                {t("code.agent.approval.reject")}
              </button>
              <button
                type="button"
                onClick={() => void runWebSearch()}
                disabled={webSearchRunning || !webSearchDraft?.trim()}
                className="px-3 py-1.5 rounded text-xs bg-ovo-accent text-ovo-accent-ink hover:bg-ovo-accent-hover transition disabled:opacity-40"
              >
                {webSearchRunning ? "…" : t("code.agent.browse_web")}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* [END] */}

      {/* [START] Phase 8.4 — Slash-key action palette. */}
      <SlashPalette
        open={slashPaletteOpen}
        actions={slashActions}
        placeholder={t("code.agent.slash_palette.placeholder")}
        onClose={() => setSlashPaletteOpen(false)}
      />
      {/* [END] */}

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-ovo-border shrink-0">
        <div className="flex items-center gap-1.5">
          <Bot className="w-3.5 h-3.5 text-ovo-accent" />
          <span className="text-[10px] font-semibold uppercase tracking-wide text-ovo-muted">
            {t("code.agent.title")}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void clearMessages(sessionId)}
          className="p-0.5 rounded hover:bg-ovo-surface-solid text-ovo-muted hover:text-ovo-text transition"
          title={t("code.agent.clear")}
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {/* Model selector bar */}
      <div className="relative px-2 py-1.5 border-b border-ovo-border shrink-0" ref={pickerRef}>
        <button
          type="button"
          onClick={() => setModelPickerOpen((v) => !v)}
          className="w-full flex items-center gap-1.5 px-2 py-1 rounded bg-ovo-surface border border-ovo-border text-xs hover:bg-ovo-surface-solid transition"
        >
          <Plus className="w-3 h-3 text-ovo-accent shrink-0" />
          <span
            className={`truncate flex-1 text-left ${modelRef ? "text-ovo-text" : "text-ovo-muted"}`}
          >
            {selectedModelName ?? t("code.agent.select_model")}
          </span>
          <ChevronDown
            className={`w-3 h-3 text-ovo-muted transition ${modelPickerOpen ? "rotate-180" : ""}`}
          />
        </button>
        {modelPickerOpen && (
          <div className="absolute left-2 right-2 top-full mt-1 z-50 bg-ovo-surface border border-ovo-border rounded-lg shadow-lg max-h-60 overflow-y-auto">
            {models.length === 0 ? (
              <div className="px-3 py-2 text-xs text-ovo-muted">{t("common.loading")}</div>
            ) : (
              models.map((m) => (
                <button
                  key={m.repo_id}
                  type="button"
                  onClick={() => {
                    onModelChange(m.repo_id);
                    setModelPickerOpen(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-ovo-surface-solid transition truncate ${
                    m.repo_id === modelRef ? "text-ovo-accent font-medium" : "text-ovo-text"
                  }`}
                >
                  <div className="truncate font-medium">{m.repo_id.split("/").pop() ?? m.repo_id}</div>
                  <div className="text-[10px] text-ovo-muted truncate">{m.repo_id}</div>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* [START] Phase 8 C3 — Plan / Todo panel.
          Shown whenever the agent has written a todo_write; stays sticky
          at the top of the timeline so the user can skim progress while
          the message stream keeps scrolling. Each item is a checkbox row
          with a status tag. */}
      {todos.length > 0 && (
        <div className="px-3 py-2 border-b border-ovo-border bg-ovo-bg/30 shrink-0">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-ovo-muted mb-1">
            {t("code.agent.todos.title")}
          </div>
          <ul className="flex flex-col gap-0.5">
            {todos.map((todo, i) => {
              const iconCls =
                todo.status === "completed"
                  ? "bg-emerald-500 border-emerald-500"
                  : todo.status === "in_progress"
                    ? "bg-ovo-accent border-ovo-accent animate-pulse"
                    : "bg-transparent border-ovo-border";
              return (
                <li key={i} className="flex items-center gap-2 text-xs">
                  <span
                    className={`w-3 h-3 rounded-sm border-2 shrink-0 flex items-center justify-center ${iconCls}`}
                  >
                    {todo.status === "completed" && (
                      <svg viewBox="0 0 10 10" className="w-2 h-2 text-white">
                        <polyline
                          points="1.5,5 4,7.5 8.5,2.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        />
                      </svg>
                    )}
                  </span>
                  <span
                    className={`flex-1 truncate ${
                      todo.status === "completed"
                        ? "text-ovo-muted line-through"
                        : todo.status === "in_progress"
                          ? "text-ovo-text font-medium"
                          : "text-ovo-muted"
                    }`}
                  >
                    {todo.content}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {/* [END] */}

      {/* Timeline — `overflow-x-hidden` + `min-w-0` together make the panel
          clip instead of expanding when a child emits a non-wrapping string
          (ASCII box, long URL, giant identifier). The `<pre>` inside each
          message already has its own `overflow-x-auto`, so wide content
          scrolls horizontally inside the bubble instead of pushing the
          whole panel. Without these two classes flex grows past the gap
          resize handle and the chat column steals space from Monaco. */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-3 space-y-3 min-w-0">
        {visibleMessages.length === 0 && !streaming && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Bot className="w-8 h-8 text-ovo-muted mb-2" />
            <p className="text-xs text-ovo-muted max-w-[240px]">
              {modelRef ? t("code.agent.empty") : t("code.agent.no_model")}
            </p>
          </div>
        )}

        {visibleMessages.map((msg) => (
          <MessageRenderer
            key={msg.id}
            content={msg.content}
            streaming={streaming && msg.id === visibleMessages[visibleMessages.length - 1]?.id}
            messageKey={msg.id}
            role={msg.role}
          />
        ))}

        {error && (
          <div className="text-xs text-rose-400 px-2">{error}</div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* [START] Phase 8.4 — Input composer as a distinct "card".
          Earlier the composer only had a 1-px top border, so it blurred
          into the scrolling message list above it. Users reported it felt
          like a continuation of the chat rather than a separate input.
          Now we wrap it as a raised panel with its own background, a
          chunkier border ring + subtle shadow above, and horizontal
          margin so it visually detaches from the conversation. */}
      <div
        className={`shrink-0 mx-2 mb-2 mt-1 rounded-xl bg-ovo-surface-solid border border-ovo-chip-border shadow-[0_-4px_12px_-6px_rgba(0,0,0,0.35)] transition-colors ${
          dragOver ? "ring-2 ring-ovo-accent bg-ovo-accent/10" : ""
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
      {/* [END] */}
        {/* [START] Queue chips — each pending message gets its own row with
            an ✕ button so the user can drop individual items. A single
            "Clear all" action is included when two or more items are
            queued so bulk cancellation is one click. */}
        {queueLen > 0 && (
          <div className="px-3 pt-2 pb-1 flex flex-col gap-1 border-b border-ovo-border/50">
            <div className="flex items-center justify-between text-[10px] text-ovo-accent font-medium">
              <span>● {t("code.agent.queued", { count: queueLen })}</span>
              {queueLen >= 2 && (
                <button
                  type="button"
                  onClick={() => clearQueue()}
                  className="text-ovo-muted hover:text-rose-400 transition"
                >
                  Clear all
                </button>
              )}
            </div>
            {queue.map((q, i) => (
              <div
                key={i}
                className="flex items-center gap-1.5 text-[11px] text-ovo-muted bg-ovo-surface rounded px-2 py-1"
              >
                <span className="truncate flex-1">{q}</span>
                <button
                  type="button"
                  onClick={() => removeQueueItem(i)}
                  className="p-0.5 rounded hover:bg-ovo-surface-solid hover:text-rose-400 transition shrink-0"
                  title="Remove from queue"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        {/* [END] */}

        {/* [START] Phase 5 — Model recommendation chip.
            Appears just above the attachments row so the user sees the
            suggestion before typing more. Only shows when the recommender
            found a strictly-better candidate than the currently selected
            model (recommendModel returns null otherwise — no noise). */}
        {recommendation && (
          <div className="mx-2 mt-2 mb-1 flex items-center gap-2 rounded-md bg-violet-500/10 border border-violet-500/30 px-2 py-1 text-[11px] text-violet-600 dark:text-violet-300">
            <Sparkles className="w-3 h-3 shrink-0" aria-hidden />
            <span className="font-medium truncate">
              {t("chat.recommend.label", {
                name:
                  recommendation.model.repo_id.split("/").pop() ??
                  recommendation.model.repo_id,
              })}
            </span>
            {recommendation.reasons.length > 0 && (
              <span className="text-violet-500/80 truncate flex-1">
                · {recommendation.reasons.slice(0, 2).join(", ")}
              </span>
            )}
            <button
              type="button"
              onClick={applyRecommendation}
              className="ml-1 px-2 py-0.5 rounded-full bg-violet-500 text-white text-[10px] font-semibold hover:bg-violet-600 transition shrink-0"
            >
              {t("chat.recommend.apply")}
            </button>
            <button
              type="button"
              onClick={dismissRecommendation}
              aria-label={t("chat.recommend.dismiss")}
              className="text-violet-500/70 hover:text-violet-700 dark:hover:text-violet-100 transition shrink-0"
            >
              ×
            </button>
          </div>
        )}
        {/* [END] */}

        {/* [START] Attachment chips — visible whenever the user has queued
            a file via the + menu, drag-and-drop, or paste. Each chip is
            removable. File paths (not contents) ride with the outgoing
            message as an `<attached_files>` block; the agent resolves
            them with read_file when it actually needs them. */}
        {attachments.length > 0 && (
          <div className="px-3 pt-2 flex flex-wrap gap-1.5">
            {attachments.map((p) => {
              const name = p.split("/").pop() ?? p;
              return (
                <span
                  key={p}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-ovo-chip border border-ovo-chip-border text-[11px] text-ovo-text"
                  title={p}
                >
                  <Paperclip className="w-3 h-3 text-ovo-muted shrink-0" />
                  <span className="truncate max-w-[180px]">{name}</span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(p)}
                    className="p-0.5 rounded hover:bg-ovo-surface-solid hover:text-rose-400 transition shrink-0"
                    aria-label="Remove attachment"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              );
            })}
          </div>
        )}
        {/* [END] */}

        <div className="px-3 pt-2 pb-1">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (handleHistoryKey(e)) return;
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            onPaste={handlePaste}
            placeholder={placeholder}
            rows={1}
            className="w-full text-[13px] leading-5 bg-transparent text-ovo-text placeholder:text-ovo-muted focus:outline-none resize-none overflow-y-auto"
          />
        </div>

        {/* [START] Phase 8 — compact bottom toolbar.
            Previous layout used full text labels for every chip and the
            panel width would clip "Bypass permissions" / "1 line selected"
            with an ellipsis. We now lead with icons and shrink the label
            set: tool-mode is a short keyword (bypass/ask/plan), selection
            is just the line count, attachments stay icon-only. The input
            pane keeps its breathing room without introducing scroll. */}
        <div className="flex items-center gap-1 px-2 py-1.5 text-[11px] text-ovo-muted flex-wrap border-t border-white/[0.04]">
          {/* [START] + menu — Upload / Add context / Browse web.
              Upload is live (Tauri open dialog); the other two are wired
              as placeholders that toast 'coming soon' until they ship. */}
          <div className="relative shrink-0" ref={plusMenuRef}>
            <button
              type="button"
              onClick={() => setPlusMenuOpen((v) => !v)}
              title={t("code.agent.attach")}
              aria-label={t("code.agent.attach")}
              className={`p-1 rounded hover:bg-ovo-surface-solid transition ${
                plusMenuOpen ? "bg-ovo-surface-solid text-ovo-text" : ""
              }`}
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            {plusMenuOpen && (
              <div className="absolute bottom-full left-0 mb-1 z-30 w-56 rounded-lg bg-ovo-surface-solid border border-ovo-border shadow-lg py-1">
                <MenuItem
                  icon={<Upload className="w-4 h-4" />}
                  onClick={() => void handleUpload()}
                >
                  {t("code.agent.upload_from_computer")}
                </MenuItem>
                <MenuItem
                  icon={<FileText className="w-4 h-4" />}
                  onClick={handleAddContext}
                  disabled={openTabs.length === 0}
                >
                  {t("code.agent.add_context")}
                </MenuItem>
                <MenuItem
                  icon={<Globe className="w-4 h-4" />}
                  onClick={() => void handleWebSearch()}
                >
                  {t("code.agent.browse_web")}
                </MenuItem>
              </div>
            )}
          </div>
          {/* [END] */}
          <button
            type="button"
            onClick={() => setSlashPaletteOpen(true)}
            title={t("code.agent.slash")}
            aria-label={t("code.agent.slash")}
            className={`p-1 rounded hover:bg-ovo-surface-solid transition shrink-0 ${
              slashPaletteOpen ? "bg-ovo-surface-solid text-ovo-text" : ""
            }`}
          >
            <Slash className="w-3.5 h-3.5" />
          </button>
          {/* [START] Phase 5 — Mic button (voice input).
              Only rendered when the feature flag is on so users who've
              disabled voice never see the button. */}
          {enableVoice && (
            <button
              type="button"
              onClick={() => void handleMicClick()}
              disabled={voiceState === "processing" || streaming}
              title={
                voiceState === "recording"
                  ? t("chat.voice.recording")
                  : voiceState === "processing"
                    ? t("chat.voice.processing")
                    : t("chat.voice.start")
              }
              aria-label={
                voiceState === "recording"
                  ? t("chat.voice.recording")
                  : t("chat.voice.start")
              }
              aria-pressed={voiceState === "recording"}
              className={`p-1 rounded transition shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${
                voiceState === "recording"
                  ? "bg-rose-500/20 text-rose-400 hover:bg-rose-500/30"
                  : "hover:bg-ovo-surface-solid"
              }`}
            >
              {voiceState === "processing" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
              ) : voiceState === "recording" ? (
                <MicOff className="w-3.5 h-3.5" aria-hidden />
              ) : (
                <Mic className="w-3.5 h-3.5" aria-hidden />
              )}
            </button>
          )}
          {/* [END] */}
          {/* Subtle vertical divider after + / / mic */}
          <span
            aria-hidden
            className="h-4 w-px bg-white/[0.06] mx-1 shrink-0"
          />

          {editorSelection && (
            <span
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-ovo-accent bg-ovo-accent/10 shrink-0"
              title={`${editorSelection.path}:${editorSelection.startLine}-${editorSelection.endLine}`}
            >
              <FileText className="w-3 h-3" />
              <span className="tabular-nums">
                {editorSelection.endLine - editorSelection.startLine + 1}L
              </span>
            </span>
          )}

          <button
            type="button"
            onClick={handleToolModeClick}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-ovo-surface-solid shrink-0"
            title={t(TOOL_MODE_LABEL_KEY[toolMode])}
            aria-label={t(TOOL_MODE_LABEL_KEY[toolMode])}
          >
            <Shield className="w-3 h-3" />
            <span className="capitalize">{toolMode}</span>
          </button>

          <div className="flex-1 min-w-0" />

          {streaming ? (
            <button
              type="button"
              onClick={stopStreaming}
              className="p-1.5 rounded bg-rose-500/90 text-white hover:bg-rose-500 transition shrink-0"
              title={t("code.agent.stop")}
              aria-label={t("code.agent.stop")}
            >
              <Square className="w-3 h-3" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSend}
              disabled={!input.trim() || !modelRef}
              className="p-1.5 rounded bg-ovo-accent text-ovo-accent-ink hover:bg-ovo-accent-hover disabled:opacity-40 transition shrink-0"
              title={t("code.agent.send")}
              aria-label={t("code.agent.send")}
            >
              <Send className="w-3 h-3" />
            </button>
          )}
        </div>
        {/* [END] */}
      </div>
    </div>
  );
}
// [END] Phase 8.3
