import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Send, Square, Plus, Upload, Link as LinkIcon, Mic, MicOff, Loader2 } from "lucide-react";
import type { ChatAttachment, ModelCapability } from "../types/ovo";
import { AttachmentChip } from "./AttachmentChip";
// [START] Phase 6.4 — slash command popup
import {
  shouldShowSlashMenu,
  filterSlashCommands,
  type SlashCommand,
  type SlashCommandContext,
} from "../lib/slashCommands";
import { SlashCommandPopup } from "./SlashCommandPopup";
import { useSessionsStore } from "../store/sessions";
import { useModelProfilesStore } from "../store/model_profiles";
import { useToastsStore } from "../store/toasts";
import { runCompact } from "../lib/compact";
import { useWikiStore } from "../store/wiki";
import { buildSnippetCommands } from "../lib/wikiSnippets";
// [END]
// [START] Phase 8 — model recommendation chip
import { recommendModel, type RecommendationResult } from "../lib/modelRecommendation";
import { useFeatureFlagsStore } from "../store/feature_flags";
import { useModelPerfStore } from "../store/model_perf";
import { useSidecarStore } from "../store/sidecar";
import { listModels } from "../lib/api";
import type { OvoModel } from "../types/ovo";
import { Sparkles } from "lucide-react";
// [END]
// [START] Phase 8 — Voice I/O
import { startRecording, stopRecordingAndTranscribe, cancelRecording } from "../lib/voiceIO";
// [END]

interface Props {
  onSend: (text: string, attachments: ChatAttachment[]) => void;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
  // [START] streaming send mode props
  allowTypeDuringStreaming?: boolean;
  queueCount?: number;
  // [END]
  // [START] Phase B — model capabilities gate attach accept types
  modelCapabilities?: ModelCapability[];
  // [END]
  // [START] left slot — optional button rendered before the attach (+) button, inside the same card row
  leftSlot?: ReactNode;
  // [END]
}

// [START] imperative handle — lets parent (ChatPane) push files dropped onto the pane
export interface ChatInputHandle {
  addFiles: (files: File[]) => void;
}
// [END]

function readImagePreview(file: File): Promise<string | null> {
  if (!file.type.startsWith("image/")) return Promise.resolve(null);
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

function genId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const ChatInput = forwardRef<ChatInputHandle, Props>(function ChatInput(
  { onSend, onStop, streaming, disabled, allowTypeDuringStreaming = false, queueCount = 0, modelCapabilities = [], leftSlot },
  ref,
) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [urlMode, setUrlMode] = useState(false);
  const [urlValue, setUrlValue] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setUrlMode(false);
        setUrlValue("");
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  useEffect(() => {
    if (urlMode) urlInputRef.current?.focus();
  }, [urlMode]);

  // [START] textarea disabled logic — allow typing during streaming for queue/interrupt modes
  const textareaDisabled = disabled || (streaming && !allowTypeDuringStreaming);
  const canSubmit = (value.trim().length > 0 || attachments.length > 0) && !disabled && (allowTypeDuringStreaming || !streaming);
  // [END]

  // [START] Phase B — dynamic file accept based on model capabilities
  const hasVision = modelCapabilities.includes("vision");
  const hasAudio = modelCapabilities.includes("audio");
  const fileAccept = hasVision && hasAudio
    ? "image/*,audio/*"
    : hasVision
      ? "image/*"
      : hasAudio
        ? "audio/*"
        : "*/*";
  // Attach button disabled when model is text-only (no vision, no audio)
  const attachSupported = hasVision || hasAudio;
  // [END]

  const submit = () => {
    if (!canSubmit) return;
    onSend(value.trim(), attachments);
    setValue("");
    setAttachments([]);
  };

  // [START] Phase 6.4 — slash-command menu state
  const [slashFiltered, setSlashFiltered] = useState<SlashCommand[]>([]);
  const [slashIndex, setSlashIndex] = useState(0);
  const slashOpen = slashFiltered.length > 0;
  // [START] Phase 8 — wiki #snippet pages join the slash catalog
  const wikiPages = useWikiStore((s) => s.pages);
  // [END]

  // [START] Phase 8 — model recommendation: debounced suggestion chip
  const enableRec = useFeatureFlagsStore((s) => s.enable_model_recommendation);
  const ports = useSidecarStore((s) => s.status.ports);
  const perfStats = useModelPerfStore((s) => s.stats);
  const [models, setModels] = useState<OvoModel[]>([]);
  const [recommendation, setRecommendation] = useState<RecommendationResult | null>(null);
  const modelsFetchedRef = useRef(false);

  // Lazy-load model catalog once per ChatInput mount; refresh when ports change.
  useEffect(() => {
    if (!enableRec) return;
    if (modelsFetchedRef.current) return;
    modelsFetchedRef.current = true;
    listModels(ports)
      .then((res) => setModels(res.models))
      .catch(() => {
        modelsFetchedRef.current = false;
      });
  }, [enableRec, ports]);

  // Recompute recommendation 350ms after the user stops typing
  useEffect(() => {
    if (!enableRec || models.length === 0) {
      setRecommendation(null);
      return;
    }
    const handle = setTimeout(() => {
      const currentRef =
        useSessionsStore.getState().sessions.find(
          (s) => s.id === useSessionsStore.getState().currentSessionId,
        )?.model_ref ?? null;
      const result = recommendModel({
        prompt: value,
        attachments,
        models,
        currentModelRef: currentRef,
        perfStats,
      });
      setRecommendation(result);
    }, 350);
    return () => clearTimeout(handle);
  }, [enableRec, value, attachments, models, perfStats]);

  function applyRecommendation() {
    if (!recommendation) return;
    const sid = useSessionsStore.getState().currentSessionId;
    if (!sid) return;
    void useSessionsStore.getState().setSessionModel(sid, recommendation.model.repo_id);
    setRecommendation(null);
  }

  function dismissRecommendation() {
    setRecommendation(null);
  }
  // [END]

  // [START] Phase 8 — Voice I/O state + handler
  const enableVoice = useFeatureFlagsStore((s) => s.enable_voice_input);
  const [voiceState, setVoiceState] = useState<"idle" | "recording" | "processing">("idle");

  async function handleMicClick() {
    if (voiceState === "recording") {
      setVoiceState("processing");
      try {
        const transcript = await stopRecordingAndTranscribe(ports);
        if (transcript) {
          setValue((prev) => (prev ? `${prev} ${transcript}` : transcript));
        }
      } catch (err) {
        useToastsStore.getState().push({
          kind: "error",
          message: t("chat.voice.error", { error: err instanceof Error ? err.message : String(err) }),
        });
      } finally {
        setVoiceState("idle");
      }
    } else if (voiceState === "idle") {
      try {
        await startRecording(ports);
        setVoiceState("recording");
      } catch (err) {
        useToastsStore.getState().push({
          kind: "error",
          message: t("chat.voice.error", { error: err instanceof Error ? err.message : String(err) }),
        });
      }
    }
  }

  // Cancel recording when component unmounts or streaming starts.
  useEffect(() => {
    if (streaming && voiceState !== "idle") {
      cancelRecording(ports);
      setVoiceState("idle");
    }
  }, [streaming]);
  // [END]

  useEffect(() => {
    const { show, token } = shouldShowSlashMenu(value);
    if (!show) {
      setSlashFiltered([]);
      return;
    }
    const builtin = filterSlashCommands(token);
    // [START] Phase 8 — append wiki snippets that prefix-match the token
    const needle = token.trim().toLowerCase();
    const snippets = buildSnippetCommands(wikiPages).filter((c) => {
      if (!needle) return true;
      if (c.id.toLowerCase().startsWith(needle)) return true;
      if (c.aliases?.some((a) => a.toLowerCase().startsWith(needle))) return true;
      return false;
    });
    const next = [...builtin, ...snippets];
    // [END]
    setSlashFiltered(next);
    setSlashIndex((prev) => Math.min(prev, Math.max(0, next.length - 1)));
  }, [value, wikiPages]);

  function buildSlashContext(): SlashCommandContext {
    return {
      clearChat: () => useSessionsStore.getState().clearCurrentMessages(),
      cycleProfile: () => {
        const store = useModelProfilesStore.getState();
        const idx = store.profiles.findIndex((p) => p.id === store.activeId);
        const nextProfile =
          store.profiles[(idx + 1) % store.profiles.length];
        if (nextProfile) {
          store.setActive(nextProfile.id);
          useToastsStore.getState().push({
            kind: "info",
            message: `${nextProfile.emoji ?? ""} ${nextProfile.name}`,
          });
        }
      },
      openPane: (pane) => {
        window.dispatchEvent(
          new CustomEvent("ovo:navigate", { detail: pane }),
        );
      },
      compact: async () => {
        const sessionId = useSessionsStore.getState().currentSessionId;
        if (!sessionId) {
          useToastsStore.getState().push({
            kind: "error",
            message: "활성 세션이 없어",
          });
          return;
        }
        const toasts = useToastsStore.getState();
        toasts.push({ kind: "info", message: "세션 축약 시작…" });
        const res = await runCompact(sessionId, { strategy: "manual" });
        if (res.ok) {
          toasts.push({
            kind: "success",
            message: `세션 축약 완료 · ${res.freed} 토큰 확보`,
          });
        } else {
          toasts.push({ kind: "error", message: `축약 실패: ${res.reason}` });
        }
      },
      addMemoryNote: async (text) => {
        const title =
          text.length > 40 ? `${text.slice(0, 40).trim()}…` : text.trim();
        const page = await useWikiStore
          .getState()
          .create({ title, content: text, tier: "note" });
        useToastsStore.getState().push({
          kind: "success",
          message: `📝 위키에 추가됨 — ${page.title}`,
        });
      },
    };
  }

  function executeSlash(cmd: SlashCommand) {
    const { args } = shouldShowSlashMenu(value);
    if (cmd.placeholder) {
      useToastsStore.getState().push({
        kind: "info",
        message: `${cmd.name} — ${cmd.description}`,
      });
      setValue("");
      return;
    }
    if (cmd.kind === "template" && cmd.template) {
      setValue(cmd.template(args));
      return;
    }
    if (cmd.kind === "action" && cmd.run) {
      cmd.run(buildSlashContext(), args);
      setValue("");
      return;
    }
    setValue("");
  }
  // [END]

  // [START] Phase 8 — ↑/↓ recall prior user turns in this session.
  // Only fires when the slash menu is closed and the caret is at an edge,
  // so regular multi-line navigation inside a composed message still
  // works. Cleared automatically when the user types something new.
  const chatMessages = useSessionsStore((s) => s.messages);
  const userHistory = useMemo(
    () =>
      chatMessages
        .filter((m) => m.role === "user")
        .map((m) => (typeof m.content === "string" ? m.content : ""))
        .filter((c) => c.length > 0),
    [chatMessages],
  );
  const [historyIdx, setHistoryIdx] = useState(-1);
  useEffect(() => {
    if (historyIdx !== -1 && value !== (userHistory[userHistory.length - 1 - historyIdx] ?? "")) {
      setHistoryIdx(-1);
    }
  }, [value, historyIdx, userHistory]);
  // [END]

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // [START] slash-menu keyboard nav takes priority over submit
    if (slashOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((i) => Math.min(i + 1, slashFiltered.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashFiltered([]);
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && !e.nativeEvent.isComposing) {
        const cmd = slashFiltered[slashIndex];
        if (cmd) {
          e.preventDefault();
          executeSlash(cmd);
          return;
        }
      }
    }
    // [END]

    // [START] Phase 8 — arrow-key history recall (slash menu takes priority above).
    if (userHistory.length > 0 && !slashOpen) {
      const el = e.currentTarget;
      const caretAtStart = el.selectionStart === 0 && el.selectionEnd === 0;
      const caretAtEnd =
        el.selectionStart === el.value.length && el.selectionEnd === el.value.length;

      if (e.key === "ArrowUp" && (value === "" || caretAtStart)) {
        const nextIdx = Math.min(historyIdx + 1, userHistory.length - 1);
        if (nextIdx !== historyIdx) {
          e.preventDefault();
          setHistoryIdx(nextIdx);
          setValue(userHistory[userHistory.length - 1 - nextIdx] ?? "");
          return;
        }
      }
      if (
        e.key === "ArrowDown" &&
        historyIdx >= 0 &&
        (value === "" || caretAtEnd || value === userHistory[userHistory.length - 1 - historyIdx])
      ) {
        if (historyIdx === 0) {
          e.preventDefault();
          setHistoryIdx(-1);
          setValue("");
          return;
        }
        const nextIdx = historyIdx - 1;
        e.preventDefault();
        setHistoryIdx(nextIdx);
        setValue(userHistory[userHistory.length - 1 - nextIdx] ?? "");
        return;
      }
    }
    // [END]

    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const onPickFiles = () => {
    setMenuOpen(false);
    fileInputRef.current?.click();
  };

  // [START] shared attach routine — used by both file picker and external (drag-drop) callers
  const appendFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const next: ChatAttachment[] = await Promise.all(
      files.map(async (file) => ({
        kind: "file" as const,
        id: genId(),
        file,
        previewDataUrl: await readImagePreview(file),
      })),
    );
    setAttachments((prev) => [...prev, ...next]);
  };
  // [END]

  const onFilesSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    await appendFiles(files);
  };

  // [START] expose addFiles to parent (ChatPane drop zone)
  useImperativeHandle(ref, () => ({ addFiles: (files) => void appendFiles(files) }), []);
  // [END]

  const onConfirmUrl = () => {
    const url = urlValue.trim();
    if (!url) return;
    setAttachments((prev) => [...prev, { kind: "url", id: genId(), url }]);
    setUrlValue("");
    setUrlMode(false);
    setMenuOpen(false);
  };

  const onUrlKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onConfirmUrl();
    } else if (e.key === "Escape") {
      setUrlMode(false);
      setUrlValue("");
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  return (
    <div className="relative p-3 bg-ovo-surface border-t border-ovo-border">
      {/* [START] Phase 6.4 — slash command popup (floats above the input) */}
      {slashOpen && (
        <SlashCommandPopup
          items={slashFiltered}
          index={slashIndex}
          onHover={(i) => setSlashIndex(i)}
          onSelect={(cmd) => executeSlash(cmd)}
        />
      )}
      {/* [END] */}
      {/* [START] queue badge — shown when messages are waiting */}
      {queueCount > 0 && (
        <div className="mb-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-ovo-bg border border-ovo-border text-xs text-ovo-muted">
          <span className="inline-flex gap-0.5" aria-hidden>
            <span className="w-1 h-1 rounded-full bg-ovo-accent animate-bounce [animation-delay:-0.3s]" />
            <span className="w-1 h-1 rounded-full bg-ovo-accent animate-bounce [animation-delay:-0.15s]" />
            <span className="w-1 h-1 rounded-full bg-ovo-accent animate-bounce" />
          </span>
          {t("chat.queue_badge", { count: queueCount })}
        </div>
      )}
      {/* [END] */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {attachments.map((a) => (
            <AttachmentChip key={a.id} attachment={a} onRemove={removeAttachment} />
          ))}
        </div>
      )}
      {/* [START] Phase 8 — model recommendation chip */}
      {recommendation && (
        <div className="mb-2 inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-violet-500/10 border border-violet-400/40 text-[11px] text-violet-700 dark:text-violet-200">
          <Sparkles className="w-3 h-3 shrink-0" aria-hidden />
          <span className="font-medium">
            {t("chat.recommend.label", {
              name: recommendation.model.repo_id.split("/").pop() ?? recommendation.model.repo_id,
            })}
          </span>
          {recommendation.reasons.length > 0 && (
            <span className="text-violet-500/80 truncate max-w-xs">
              · {recommendation.reasons.slice(0, 3).join(", ")}
            </span>
          )}
          <button
            type="button"
            onClick={applyRecommendation}
            className="ml-1 px-2 py-0.5 rounded-full bg-violet-500 text-white text-[10px] font-semibold hover:bg-violet-600 transition"
          >
            {t("chat.recommend.apply")}
          </button>
          <button
            type="button"
            onClick={dismissRecommendation}
            aria-label={t("chat.recommend.dismiss")}
            className="text-violet-500/70 hover:text-violet-700 dark:hover:text-violet-100 transition"
          >
            ×
          </button>
        </div>
      )}
      {/* [END] */}
      <div className="flex items-end gap-2">
        {leftSlot}
        <div ref={menuRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            disabled={disabled || !attachSupported}
            aria-label={attachSupported ? t("chat.attach") : t("chat.attach_unsupported")}
            title={attachSupported ? t("chat.attach") : t("chat.attach_unsupported")}
            className="h-[40px] w-[40px] rounded-lg bg-ovo-surface-solid border border-ovo-border text-ovo-muted hover:bg-ovo-bg hover:text-ovo-text disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition"
          >
            <Plus className="w-4 h-4" aria-hidden />
          </button>
          {menuOpen && (
            <div className="absolute z-20 bottom-full mb-1 left-0 min-w-[220px] rounded-lg bg-ovo-surface-solid border border-ovo-border shadow-lg py-1">
              <button
                type="button"
                onClick={onPickFiles}
                className="w-full text-left px-3 py-2 flex items-center gap-2 text-sm text-ovo-text hover:bg-ovo-bg transition"
              >
                <Upload className="w-4 h-4 text-ovo-muted" aria-hidden />
                {t("chat.attach_file")}
              </button>
              {urlMode ? (
                <div className="px-3 py-2 flex items-center gap-2">
                  <LinkIcon className="w-4 h-4 text-ovo-muted shrink-0" aria-hidden />
                  <input
                    ref={urlInputRef}
                    type="url"
                    value={urlValue}
                    onChange={(e) => setUrlValue(e.target.value)}
                    onKeyDown={onUrlKeyDown}
                    placeholder={t("chat.url_placeholder")}
                    className="flex-1 min-w-0 text-sm bg-transparent border-0 border-b border-ovo-border focus:border-ovo-accent focus:outline-none text-ovo-text placeholder:text-ovo-muted py-1"
                  />
                  <button
                    type="button"
                    onClick={onConfirmUrl}
                    className="text-xs text-ovo-accent hover:text-ovo-accent-hover"
                  >
                    OK
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setUrlMode(true)}
                  className="w-full text-left px-3 py-2 flex items-center gap-2 text-sm text-ovo-text hover:bg-ovo-bg transition"
                >
                  <LinkIcon className="w-4 h-4 text-ovo-muted" aria-hidden />
                  {t("chat.attach_url")}
                </button>
              )}
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={fileAccept}
            onChange={onFilesSelected}
            className="hidden"
          />
        </div>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("chat.placeholder")}
          rows={1}
          disabled={textareaDisabled}
          className="flex-1 resize-none max-h-40 min-h-[40px] px-3 py-2 rounded-lg bg-ovo-surface-solid border border-ovo-border text-sm text-ovo-text placeholder:text-ovo-muted focus:outline-none focus:border-ovo-accent focus:ring-1 focus:ring-ovo-accent disabled:opacity-50"
        />
        {streaming ? (
          <button
            type="button"
            onClick={onStop}
            aria-label={t("chat.stop")}
            className="h-[40px] px-3 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm flex items-center gap-1.5 transition"
          >
            <Square className="w-3.5 h-3.5 fill-current" aria-hidden />
            {t("chat.stop")}
          </button>
        ) : (
          <>
            {/* [START] Phase 8 — Mic button (voice input) */}
            {enableVoice && (
              <button
                type="button"
                onClick={() => void handleMicClick()}
                disabled={voiceState === "processing"}
                aria-label={
                  voiceState === "recording"
                    ? t("chat.voice.recording")
                    : t("chat.voice.start")
                }
                title={
                  voiceState === "processing"
                    ? t("chat.voice.processing")
                    : voiceState === "recording"
                      ? t("chat.voice.recording")
                      : t("chat.voice.start")
                }
                className={`h-[40px] px-2.5 rounded-lg text-sm flex items-center transition ${
                  voiceState === "recording"
                    ? "bg-rose-500 hover:bg-rose-600 text-white animate-pulse"
                    : voiceState === "processing"
                      ? "bg-ovo-surface-solid text-ovo-muted cursor-not-allowed opacity-60"
                      : "bg-ovo-surface-solid border border-ovo-border text-ovo-muted hover:text-ovo-text hover:border-ovo-accent"
                }`}
              >
                {voiceState === "processing" ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                ) : voiceState === "recording" ? (
                  <MicOff className="w-4 h-4" aria-hidden />
                ) : (
                  <Mic className="w-4 h-4" aria-hidden />
                )}
              </button>
            )}
            {/* [END] */}
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              aria-label={t("chat.send")}
              className="h-[40px] px-3 rounded-lg bg-ovo-accent hover:bg-ovo-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-ovo-accent-ink text-sm flex items-center gap-1.5 transition"
            >
              <Send className="w-3.5 h-3.5" aria-hidden />
              {t("chat.send")}
            </button>
          </>
        )}
      </div>
    </div>
  );
});
