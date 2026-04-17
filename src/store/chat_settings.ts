import { create } from "zustand";
import type { CompactStrategy } from "../types/ovo";

// [START] ChatSettings — global compact strategy, warn threshold, and streaming send mode.
// Persisted to localStorage under key "ovo:chat_settings".
const LS_KEY = "ovo:chat_settings";

export type StreamingSendMode = "queue" | "interrupt" | "block";

export interface ChatSettings {
  default_strategy: CompactStrategy;
  global_warn_threshold: number; // 0–1, default 0.75
  streaming_send_mode: StreamingSendMode; // default "queue"
  sound_enabled: boolean; // play owl-hoot on reply complete, default true
}

interface ChatSettingsState extends ChatSettings {
  setDefaultStrategy: (strategy: CompactStrategy) => void;
  setGlobalWarnThreshold: (threshold: number) => void;
  setStreamingSendMode: (mode: StreamingSendMode) => void;
  setSoundEnabled: (enabled: boolean) => void;
  load: () => void;
}

const DEFAULTS: ChatSettings = {
  default_strategy: "auto",
  global_warn_threshold: 0.75,
  streaming_send_mode: "queue",
  sound_enabled: true,
};

function persist(state: ChatSettings): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {
    // storage unavailable — silent
  }
}

function readStorage(): Partial<ChatSettings> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<ChatSettings>;
  } catch {
    return {};
  }
}

export const useChatSettingsStore = create<ChatSettingsState>((set, get) => ({
  ...DEFAULTS,

  load: () => {
    const stored = readStorage();
    const next: ChatSettings = {
      default_strategy: stored.default_strategy ?? DEFAULTS.default_strategy,
      global_warn_threshold:
        typeof stored.global_warn_threshold === "number"
          ? stored.global_warn_threshold
          : DEFAULTS.global_warn_threshold,
      streaming_send_mode: stored.streaming_send_mode ?? DEFAULTS.streaming_send_mode,
      sound_enabled:
        typeof stored.sound_enabled === "boolean"
          ? stored.sound_enabled
          : DEFAULTS.sound_enabled,
    };
    set(next);
  },

  // [START] Snapshot + persist — all setters use get() after set() so the
  // persisted blob always contains every field regardless of which one changed.
  setDefaultStrategy: (strategy) => {
    set({ default_strategy: strategy });
    const s = get();
    persist({
      default_strategy: s.default_strategy,
      global_warn_threshold: s.global_warn_threshold,
      streaming_send_mode: s.streaming_send_mode,
      sound_enabled: s.sound_enabled,
    });
  },

  setGlobalWarnThreshold: (threshold) => {
    set({ global_warn_threshold: threshold });
    const s = get();
    persist({
      default_strategy: s.default_strategy,
      global_warn_threshold: s.global_warn_threshold,
      streaming_send_mode: s.streaming_send_mode,
      sound_enabled: s.sound_enabled,
    });
  },

  setStreamingSendMode: (mode) => {
    set({ streaming_send_mode: mode });
    const s = get();
    persist({
      default_strategy: s.default_strategy,
      global_warn_threshold: s.global_warn_threshold,
      streaming_send_mode: s.streaming_send_mode,
      sound_enabled: s.sound_enabled,
    });
  },

  setSoundEnabled: (enabled) => {
    set({ sound_enabled: enabled });
    const s = get();
    persist({
      default_strategy: s.default_strategy,
      global_warn_threshold: s.global_warn_threshold,
      streaming_send_mode: s.streaming_send_mode,
      sound_enabled: s.sound_enabled,
    });
  },
  // [END]
}));
// [END]
