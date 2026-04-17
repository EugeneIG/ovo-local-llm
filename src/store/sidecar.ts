import { create } from "zustand";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getSidecarStatus, onSidecarStatus, restartSidecar } from "../lib/tauri";
import { DEFAULT_PORTS } from "../lib/api";
import type { SidecarStatus } from "../types/sidecar";

interface SidecarStoreState {
  status: SidecarStatus;
  subscribed: boolean;
  unlisten: UnlistenFn | null;
  lastUpdatedAt: number;
  hydrate: () => Promise<void>;
  subscribe: () => Promise<void>;
  unsubscribe: () => void;
  restart: () => Promise<void>;
  setStatus: (status: SidecarStatus) => void;
}

const initialStatus: SidecarStatus = {
  health: "stopped",
  ports: DEFAULT_PORTS,
  pid: null,
  message: null,
  healthy_apis: [],
};

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export const useSidecarStore = create<SidecarStoreState>((set, get) => ({
  status: initialStatus,
  subscribed: false,
  unlisten: null,
  lastUpdatedAt: 0,

  setStatus: (status) => set({ status, lastUpdatedAt: Date.now() }),

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
    set({ unlisten, subscribed: true });
    await get().hydrate();
  },

  unsubscribe: () => {
    const { unlisten } = get();
    if (unlisten) unlisten();
    set({ unlisten: null, subscribed: false });
  },

  restart: async () => {
    if (!isTauri()) return;
    await restartSidecar();
  },
}));
