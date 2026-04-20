import { create } from "zustand";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  getSidecarStatus,
  onSidecarBootstrapLog,
  onSidecarStatus,
  reinstallSidecarRuntime,
  restartSidecar,
} from "../lib/tauri";
import { DEFAULT_PORTS } from "../lib/api";
import type { SidecarStatus } from "../types/sidecar";

// Cap for the rolling bootstrap log buffer shown inside the install modal.
// Large enough to capture a full `uv sync` transcript, small enough to keep
// the DOM cheap when re-rendering on every stderr line.
const BOOTSTRAP_LOG_MAX_LINES = 400;

interface SidecarStoreState {
  status: SidecarStatus;
  subscribed: boolean;
  unlisten: UnlistenFn | null;
  unlistenBootstrap: UnlistenFn | null;
  lastUpdatedAt: number;
  bootstrapLog: string[];
  hydrate: () => Promise<void>;
  subscribe: () => Promise<void>;
  unsubscribe: () => void;
  restart: () => Promise<void>;
  reinstallRuntime: () => Promise<void>;
  setStatus: (status: SidecarStatus) => void;
  appendBootstrapLog: (line: string) => void;
  clearBootstrapLog: () => void;
}

const initialStatus: SidecarStatus = {
  health: "stopped",
  ports: DEFAULT_PORTS,
  pid: null,
  message: null,
  healthy_apis: [],
  bootstrap_progress: null,
};

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export const useSidecarStore = create<SidecarStoreState>((set, get) => ({
  status: initialStatus,
  subscribed: false,
  unlisten: null,
  unlistenBootstrap: null,
  lastUpdatedAt: 0,
  bootstrapLog: [],

  setStatus: (status) => {
    // Clear the log buffer whenever we leave the Bootstrapping health so the
    // next first-run (e.g. after reinstall) starts with a clean slate.
    const prev = get().status;
    const leavingBootstrap =
      prev.health === "bootstrapping" && status.health !== "bootstrapping";
    set({
      status,
      lastUpdatedAt: Date.now(),
      ...(leavingBootstrap ? { bootstrapLog: [] } : {}),
    });
  },

  appendBootstrapLog: (line) => {
    if (!line) return;
    const next = [...get().bootstrapLog, line];
    if (next.length > BOOTSTRAP_LOG_MAX_LINES) {
      next.splice(0, next.length - BOOTSTRAP_LOG_MAX_LINES);
    }
    set({ bootstrapLog: next });
  },

  clearBootstrapLog: () => set({ bootstrapLog: [] }),

  hydrate: async () => {
    if (!isTauri()) return;
    try {
      const status = await getSidecarStatus();
      get().setStatus(status);
    } catch (e) {
      console.warn("sidecar hydrate failed", e);
    }
  },

  subscribe: async () => {
    if (!isTauri() || get().subscribed) return;
    const unlisten = await onSidecarStatus((status) => get().setStatus(status));
    const unlistenBootstrap = await onSidecarBootstrapLog((line) =>
      get().appendBootstrapLog(line),
    );
    set({ unlisten, unlistenBootstrap, subscribed: true });
    await get().hydrate();
  },

  unsubscribe: () => {
    const { unlisten, unlistenBootstrap } = get();
    if (unlisten) unlisten();
    if (unlistenBootstrap) unlistenBootstrap();
    set({ unlisten: null, unlistenBootstrap: null, subscribed: false });
  },

  restart: async () => {
    if (!isTauri()) return;
    await restartSidecar();
  },

  reinstallRuntime: async () => {
    if (!isTauri()) return;
    get().clearBootstrapLog();
    await reinstallSidecarRuntime();
  },
}));
