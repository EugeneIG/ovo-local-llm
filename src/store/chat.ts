import { create } from "zustand";
import { streamChat, type ChatContentPart, type ChatWireMessage } from "../lib/api";
import type { OwlState } from "../components/Owl";
import type { ChatAttachment, ChatMessage } from "../types/ovo";
import { useSidecarStore } from "./sidecar";

// [START] Attachment → OpenAI content-parts conversion.
// Files are base64'd via FileReader; previewDataUrl is reused when already computed
// for the image preview to avoid a redundant read. URL attachments pass through
// as image_url parts (server decides whether to fetch). Non-image files are
// skipped — VLMs only accept images today, and forwarding e.g. a PDF as an image
// URL would just trigger a PIL failure server-side.
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

async function toWireMessage(m: ChatMessage): Promise<ChatWireMessage> {
  const atts = m.attachments ?? [];
  if (atts.length === 0) return { role: m.role, content: m.content };
  const parts: ChatContentPart[] = [];
  if (m.content) parts.push({ type: "text", text: m.content });
  for (const a of atts) {
    if (a.kind === "url") {
      parts.push({ type: "image_url", image_url: { url: a.url } });
      continue;
    }
    if (!a.file.type.startsWith("image/")) continue;
    const url = a.previewDataUrl ?? (await fileToDataUrl(a.file));
    if (url) parts.push({ type: "image_url", image_url: { url } });
  }
  const hasImage = parts.some((p) => p.type === "image_url");
  return { role: m.role, content: hasImage ? parts : m.content };
}
// [END]

interface ChatStoreState {
  messages: ChatMessage[];
  currentModel: string | null;
  streaming: boolean;
  owlState: OwlState;
  error: string | null;
  abortController: AbortController | null;

  setCurrentModel: (model: string | null) => void;
  sendMessage: (content: string, attachments?: ChatAttachment[]) => Promise<void>;
  stopStreaming: () => void;
  clearConversation: () => void;
}

export const useChatStore = create<ChatStoreState>((set, get) => ({
  messages: [],
  currentModel: null,
  streaming: false,
  owlState: "idle",
  error: null,
  abortController: null,

  setCurrentModel: (currentModel) => set({ currentModel }),

  sendMessage: async (content, attachments) => {
    const trimmed = content.trim();
    const hasAttachments = (attachments?.length ?? 0) > 0;
    if (!trimmed && !hasAttachments) return;
    const { currentModel, messages, streaming } = get();
    if (streaming) return;
    if (!currentModel) {
      set({ error: "no_model", owlState: "error" });
      return;
    }

    const userMsg: ChatMessage = {
      role: "user",
      content: trimmed,
      ...(hasAttachments ? { attachments } : {}),
    };
    const assistantMsg: ChatMessage = { role: "assistant", content: "" };
    const nextMessages: ChatMessage[] = [...messages, userMsg, assistantMsg];
    const assistantIdx = nextMessages.length - 1;

    const abortController = new AbortController();
    set({
      messages: nextMessages,
      streaming: true,
      owlState: "thinking",
      error: null,
      abortController,
    });

    const ports = useSidecarStore.getState().status.ports;
    let receivedAny = false;

    // [START] rAF-batched delta flush — avoid per-token full-list re-render
    let pendingDelta = "";
    let flushScheduled = false;
    const flushNow = () => {
      const delta = pendingDelta;
      pendingDelta = "";
      flushScheduled = false;
      if (!delta) return;
      const current = get().messages;
      const updated = current.slice();
      const prev = updated[assistantIdx];
      if (prev && prev.role === "assistant") {
        updated[assistantIdx] = { ...prev, content: prev.content + delta };
        set({ messages: updated });
      }
    };
    const scheduleFlush = () => {
      if (flushScheduled) return;
      flushScheduled = true;
      requestAnimationFrame(flushNow);
    };
    // [END]

    try {
      const wireMessages = await Promise.all(
        [...messages, userMsg].map(toWireMessage),
      );
      for await (const delta of streamChat(
        { model: currentModel, messages: wireMessages },
        abortController.signal,
        ports,
      )) {
        if (!receivedAny) {
          receivedAny = true;
          set({ owlState: "typing" });
        }
        pendingDelta += delta;
        scheduleFlush();
      }
      flushNow();
      set({ streaming: false, owlState: "happy", abortController: null });
      setTimeout(() => {
        if (!get().streaming) set({ owlState: "idle" });
      }, 1800);
    } catch (e) {
      flushNow();
      const aborted = abortController.signal.aborted;
      set({
        streaming: false,
        abortController: null,
        owlState: aborted ? "idle" : "error",
        error: aborted ? null : e instanceof Error ? e.message : String(e),
      });
      if (!aborted) {
        setTimeout(() => {
          if (get().owlState === "error") set({ owlState: "idle" });
        }, 2400);
      }
    }
  },

  stopStreaming: () => {
    const { abortController } = get();
    if (abortController) abortController.abort();
  },

  clearConversation: () =>
    set({ messages: [], owlState: "idle", error: null }),
}));
