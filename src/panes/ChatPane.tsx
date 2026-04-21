import { useEffect, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import { useTranslation } from "react-i18next";
import { listModels } from "../lib/api";
import { isChatCapableModel } from "../lib/models";
import { useSidecarStore } from "../store/sidecar";
import { useChatStore } from "../store/chat";
import { useSessionsStore } from "../store/sessions";
import { useChatSettingsStore } from "../store/chat_settings";
import { ModelSelector } from "../components/ModelSelector";
import { ChatInput, type ChatInputHandle } from "../components/ChatInput";
import { ModelProfileSelector } from "../components/ModelProfileSelector";
import { SystemStatusPopover } from "../components/SystemStatusPopover";
import { SidecarOfflineCard } from "../components/SidecarOfflineCard";
import { KnowledgeBasePanel } from "../components/KnowledgeBasePanel";
import { Activity, BookOpen } from "lucide-react";
import { ChatMessageBubble } from "../components/ChatMessageBubble";
import { Owl } from "../components/Owl";
import type { OvoModel, Message } from "../types/ovo";

export function ChatPane() {
  const { t } = useTranslation();
  const status = useSidecarStore((s) => s.status);

  const streaming = useChatStore((s) => s.streaming);
  const error = useChatStore((s) => s.error);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const stopStreaming = useChatStore((s) => s.stopStreaming);
  // [START] HDD status popover toggle (left of ChatInput's + button)
  const [hddOpen, setHddOpen] = useState(false);
  // [END]
  // [START] KB panel popover toggle
  const [kbOpen, setKbOpen] = useState(false);
  // [END]

  // [START] queue count + streaming send mode for ChatInput
  const queueCount = useChatStore((s) => s.queue.length);
  const streamingSendMode = useChatSettingsStore((s) => s.streaming_send_mode);
  // [END]

  const sessions = useSessionsStore((s) => s.sessions);
  const currentSessionId = useSessionsStore((s) => s.currentSessionId);
  const messages = useSessionsStore((s) => s.messages);
  const loadSessions = useSessionsStore((s) => s.loadSessions);
  const selectSession = useSessionsStore((s) => s.selectSession);
  const setSessionModel = useSessionsStore((s) => s.setSessionModel);

  const currentSession = sessions.find((s) => s.id === currentSessionId) ?? null;
  const currentModel = currentSession?.model_ref ?? null;
  // [START] compacting flag — blocks ChatInput while auto-compact is running (R.5)
  const compacting = currentSession?.compacting ?? false;
  // [END]

  const [models, setModels] = useState<OvoModel[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // [START] Load sessions once at mount; side-effect-free if already loaded.
  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);
  // [END]

  useEffect(() => {
    if (status.health !== "healthy") return;
    let cancelled = false;
    listModels(status.ports)
      .then((resp) => {
        if (cancelled) return;
        // [START] Filter out TTS / STT / embedding models from chat picker —
        // still visible in Models tab, just not selectable for conversation.
        const chatModels = resp.models.filter(isChatCapableModel);
        setModels(chatModels);
        // [END]
        setModelsError(null);
        // [START] Lazy default model — if no current session yet, remember the
        // first model so the "lazy create session" path on first send picks it.
        if (!currentModel && chatModels.length > 0 && currentSessionId) {
          void setSessionModel(currentSessionId, chatModels[0].repo_id);
        }
        // [END]
      })
      .catch((e: unknown) => {
        if (!cancelled) setModelsError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [status.health, status.ports, currentModel, currentSessionId, setSessionModel]);

  // Stick to bottom only if user hasn't scrolled up; rAF-scheduled single write per frame.
  useEffect(() => {
    const el = listRef.current;
    if (!el || !stickToBottom.current) return;
    let raf = 0;
    raf = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(raf);
  }, [messages, streaming]);

  const onListScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottom.current = distanceFromBottom < 64;
  };

  // [START] Phantom selection fallback — when no session exists yet but user
  // is about to type, show the first available model so the lazy-create path
  // on first send has something to use.
  const phantomModel =
    !currentSessionId && models.length > 0 ? models[0].repo_id : null;
  const effectiveModel = currentModel ?? phantomModel;

  const handleModelChange = async (modelRef: string | null) => {
    if (!currentSessionId) {
      // no session yet — we can't persist; remember via phantom by creating
      // a session immediately (empty title) so selection sticks.
      if (!modelRef) return;
      const { createSession } = useSessionsStore.getState();
      await createSession({ model_ref: modelRef });
      return;
    }
    await setSessionModel(currentSessionId, modelRef);
  };
  // [END]

  const sidecarReady = status.health === "healthy";
  const hasMessages = messages.length > 0;
  // [START] inputDisabled — block mode also disables during streaming; queue/interrupt keep it open
  const inputDisabled = !sidecarReady || !effectiveModel || compacting || (streaming && streamingSendMode === "block");
  const allowTypeDuringStreaming = streamingSendMode !== "block";
  // [END]

  // [START] Phase B — resolve current model capabilities so ChatInput can gate file accept types
  const currentModelObj = effectiveModel ? models.find((m) => m.repo_id === effectiveModel) ?? null : null;
  const currentCapabilities = currentModelObj?.capabilities ?? [];
  // [END]

  // [START] drag-and-drop file attach — entire ChatPane is a drop zone.
  // Document files (PDF/HWP/DOCX/XLSX) are always accepted for text extraction;
  // image/audio files require matching model capabilities.
  const chatInputRef = useRef<ChatInputHandle>(null);
  const [dropState, setDropState] = useState<"idle" | "accept" | "reject">("idle");
  const dragDepthRef = useRef(0);
  const hasVision = currentCapabilities.includes("vision");
  const hasAudio = currentCapabilities.includes("audio");
  const attachSupported = !inputDisabled;

  const isFileDrag = (e: ReactDragEvent) => Array.from(e.dataTransfer.types).includes("Files");

  const onPaneDragEnter = (e: ReactDragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setDropState(attachSupported ? "accept" : "reject");
  };
  const onPaneDragOver = (e: ReactDragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = attachSupported ? "copy" : "none";
  };
  const onPaneDragLeave = (e: ReactDragEvent) => {
    if (!isFileDrag(e)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDropState("idle");
  };
  const onPaneDrop = (e: ReactDragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepthRef.current = 0;
    setDropState("idle");
    if (!attachSupported) return;
    const docExts = new Set(["pdf","hwp","hwpx","docx","xlsx","pptx","txt","md","csv","json"]);
    const files = Array.from(e.dataTransfer.files).filter((f) => {
      if (hasVision && f.type.startsWith("image/")) return true;
      if (hasAudio && f.type.startsWith("audio/")) return true;
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
      return docExts.has(ext);
    });
    if (files.length === 0) return;
    chatInputRef.current?.addFiles(files);
  };
  // [END]

  // Ignore selectSession passthrough until the Recents sidebar is added in R.3.
  void selectSession;

  return (
    <div
      className="h-full flex flex-col relative"
      onDragEnter={onPaneDragEnter}
      onDragOver={onPaneDragOver}
      onDragLeave={onPaneDragLeave}
      onDrop={onPaneDrop}
    >
      {/* [START] drag-and-drop overlay — appears above everything while a file drag hovers the pane */}
      {dropState !== "idle" && (
        <div
          className={`absolute inset-0 z-30 flex items-center justify-center pointer-events-none transition ${
            dropState === "accept"
              ? "bg-ovo-bg/75 backdrop-blur-[2px]"
              : "bg-rose-500/10 backdrop-blur-[2px]"
          }`}
        >
          <div
            className={`px-6 py-4 rounded-xl border-2 border-dashed text-center shadow-lg ${
              dropState === "accept"
                ? "border-ovo-accent bg-ovo-surface"
                : "border-rose-500/70 bg-ovo-surface"
            }`}
          >
            <div className="text-ovo-text text-sm font-medium">
              {dropState === "accept" ? t("chat.drop.accept") : t("chat.drop.reject")}
            </div>
            <div className="text-ovo-muted text-xs mt-1">
              {dropState === "accept" ? t("chat.drop.accept_hint") : t("chat.drop.reject_hint")}
            </div>
          </div>
        </div>
      )}
      {/* [END] */}
      {/* [START] Header — centered ModelSelector + right-side profile pill */}
      <header
        data-tauri-drag-region
        className="relative flex items-center justify-center gap-3 px-4 py-2 border-b border-ovo-border bg-ovo-surface"
      >
        <ModelSelector
          models={models}
          value={effectiveModel}
          onChange={(m) => void handleModelChange(m)}
          disabled={!sidecarReady}
        />
        <div className="absolute right-4 top-1/2 -translate-y-1/2">
          <ModelProfileSelector />
        </div>
      </header>
      {/* [END] */}

      <div
        ref={listRef}
        onScroll={onListScroll}
        className="flex-1 overflow-y-auto"
      >
        <div className="px-4 py-4 h-full">
          {modelsError ? (
            <div className="h-full flex items-center justify-center text-sm text-rose-600">
              {t("chat.error_prefix")}: {modelsError}
            </div>
          ) : !hasMessages ? (
            <div className="h-full flex flex-col items-center justify-center gap-4 text-ovo-muted">
              <Owl state="idle" size="lg" />
              {sidecarReady ? (
                <p className="text-sm">{t("chat.empty")}</p>
              ) : (
                <SidecarOfflineCard
                  health={status.health}
                  onStart={() => {
                    void useSidecarStore.getState().restart();
                  }}
                />
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3 max-w-3xl mx-auto w-full">
              {/* [START] Phase 5 — group assistant tool_use turns with their
                  tool_result follow-ups so the timeline reads as one unit
                  instead of four disconnected bubbles. A group starts with
                  any assistant message and absorbs every immediately-following
                  `tool_result` (user-role bubble whose content is a pure
                  <tool_result> block) until a non-tool_result message is
                  encountered. Inside a group we use tight `gap-1`; between
                  groups we use the usual `gap-3` via the outer container. */}
              {groupTurns(messages).map((group, gIdx) => {
                const lastMsgIdx = group[group.length - 1]
                  ? messages.indexOf(group[group.length - 1])
                  : -1;
                return (
                  <div
                    key={group[0]?.id ?? `g-${gIdx}`}
                    className="flex flex-col gap-1"
                  >
                    {group.map((m) => (
                      <ChatMessageBubble
                        key={m.id}
                        message={m}
                        streaming={streaming && messages.indexOf(m) === messages.length - 1 && lastMsgIdx === messages.length - 1}
                      />
                    ))}
                  </div>
                );
              })}
              {/* [END] */}
            </div>
          )}
        </div>
      </div>

      {error && error !== "no_model" && (
        <div className="px-4 py-2 text-xs text-rose-700 bg-rose-50 border-t border-rose-200">
          {t("chat.error_prefix")}: {error}
        </div>
      )}
      {error === "no_model" && (
        <div className="px-4 py-2 text-xs text-ovo-muted bg-ovo-bg border-t border-ovo-border">
          {t("chat.no_model")}
        </div>
      )}
      {compacting && (
        <div className="px-4 py-2 text-xs text-ovo-muted bg-ovo-bg border-t border-ovo-border flex items-center gap-2">
          <span className="inline-flex gap-0.5" aria-hidden>
            <span className="w-1 h-1 rounded-full bg-ovo-muted animate-bounce [animation-delay:-0.3s]" />
            <span className="w-1 h-1 rounded-full bg-ovo-muted animate-bounce [animation-delay:-0.15s]" />
            <span className="w-1 h-1 rounded-full bg-ovo-muted animate-bounce" />
          </span>
          {t("compact.in_progress")}
        </div>
      )}

      {/* [START] ChatInput with HDD popover button as leftSlot — same card, aligned bottom row */}
      <ChatInput
        ref={chatInputRef}
        onSend={(text, attachments) => void sendMessage(text, attachments)}
        onStop={stopStreaming}
        streaming={streaming}
        disabled={inputDisabled}
        allowTypeDuringStreaming={allowTypeDuringStreaming}
        queueCount={queueCount}
        modelCapabilities={currentCapabilities}
        leftSlot={
          <div className="flex gap-1.5 shrink-0">
            {/* HDD status */}
            <div className="relative">
              {hddOpen && (
                <div className="absolute bottom-full left-0 mb-2 w-[320px] z-20">
                  <SystemStatusPopover open active="chat" />
                </div>
              )}
              <button
                type="button"
                onClick={() => { setHddOpen((v) => !v); setKbOpen(false); }}
                title={t("chat.system_status")}
                aria-label={t("chat.system_status")}
                aria-pressed={hddOpen}
                className={`h-[40px] w-[40px] rounded-lg border border-ovo-border flex items-center justify-center transition ${
                  hddOpen
                    ? "bg-ovo-nav-active text-ovo-text"
                    : "bg-ovo-surface-solid text-ovo-muted hover:bg-ovo-bg hover:text-ovo-text"
                }`}
              >
                <Activity className="w-4 h-4" aria-hidden />
              </button>
            </div>
            {/* KB panel */}
            <div className="relative">
              {kbOpen && (
                <div className="absolute bottom-full left-0 mb-2 w-[340px] z-20 p-3 rounded-xl bg-ovo-bg border border-ovo-border shadow-lg max-h-[400px] overflow-y-auto">
                  <KnowledgeBasePanel />
                </div>
              )}
              <button
                type="button"
                onClick={() => { setKbOpen((v) => !v); setHddOpen(false); }}
                title={t("kb.title")}
                aria-label={t("kb.title")}
                aria-pressed={kbOpen}
                className={`h-[40px] w-[40px] rounded-lg border border-ovo-border flex items-center justify-center transition ${
                  kbOpen
                    ? "bg-ovo-nav-active text-ovo-text"
                    : "bg-ovo-surface-solid text-ovo-muted hover:bg-ovo-bg hover:text-ovo-text"
                }`}
              >
                <BookOpen className="w-4 h-4" aria-hidden />
              </button>
            </div>
          </div>
        }
      />
      {/* [END] */}
    </div>
  );
}

// [START] Phase 5 — turn grouping for pair rendering.
// A group = one non-tool-result message (usually assistant) + every
// immediately-following tool_result (user-role bubbles whose content begins
// with `<tool_result>`). Keeping the pair visually tight makes tool calls
// read as a single step instead of split bubbles.
function groupTurns(messages: Message[]): Message[][] {
  const groups: Message[][] = [];
  let current: Message[] = [];
  const isToolResult = (m: Message) =>
    m.role === "user" && m.content.trimStart().startsWith("<tool_result>");
  for (const m of messages) {
    if (isToolResult(m) && current.length > 0) {
      current.push(m);
      continue;
    }
    if (current.length > 0) groups.push(current);
    current = [m];
  }
  if (current.length > 0) groups.push(current);
  return groups;
}
// [END]
