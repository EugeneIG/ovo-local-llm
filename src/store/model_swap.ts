import { create } from "zustand";

// [START] Phase 8 — Model swap toast state.
// Two-stage notification when a model is unloaded/loaded inside the same slot
// (chat LLM or image diffusion). Stage 1 shows "unmounting <prev>" for
// UNMOUNT_MS, then auto-flips to "mounted <next>" for MOUNT_MS, then hides.
//
// First-load case (prev === null) skips the unmount stage and goes straight
// to "mounted". Same-model self-swap (prev === next) is ignored.
//
// The store is intentionally global state instead of per-pane so a swap
// triggered from the Models pane (or via slash command) still surfaces in the
// header regardless of which view is active.

const UNMOUNT_MS = 1500;
const MOUNT_MS = 2000;

export type SwapSlot = "llm" | "image";

export type SwapPhase =
  | { kind: "idle" }
  | { kind: "unmounting"; from: string; slot: SwapSlot }
  | { kind: "mounted"; to: string; slot: SwapSlot };

interface ModelSwapState {
  phase: SwapPhase;
  notifySwap: (prev: string | null, next: string | null, slot: SwapSlot) => void;
  dismiss: () => void;
}

function shortName(model: string): string {
  if (!model) return "";
  const idx = Math.max(model.lastIndexOf("/"), model.lastIndexOf("\\"));
  return idx >= 0 ? model.slice(idx + 1) : model;
}

let timerId: number | null = null;
function clearTimer(): void {
  if (timerId !== null) {
    window.clearTimeout(timerId);
    timerId = null;
  }
}

export const useModelSwapStore = create<ModelSwapState>((set) => ({
  phase: { kind: "idle" },

  notifySwap: (prev, next, slot) => {
    if (prev === next) return;
    if (!prev && !next) return;

    clearTimer();

    if (prev && next) {
      // Standard swap: unmount → mount
      set({ phase: { kind: "unmounting", from: shortName(prev), slot } });
      timerId = window.setTimeout(() => {
        set({ phase: { kind: "mounted", to: shortName(next), slot } });
        timerId = window.setTimeout(() => {
          set({ phase: { kind: "idle" } });
          timerId = null;
        }, MOUNT_MS);
      }, UNMOUNT_MS);
    } else if (prev && !next) {
      // Cleared selection — show only the unmount step
      set({ phase: { kind: "unmounting", from: shortName(prev), slot } });
      timerId = window.setTimeout(() => {
        set({ phase: { kind: "idle" } });
        timerId = null;
      }, UNMOUNT_MS);
    } else if (!prev && next) {
      // First-time load — skip unmount, show only mounted
      set({ phase: { kind: "mounted", to: shortName(next), slot } });
      timerId = window.setTimeout(() => {
        set({ phase: { kind: "idle" } });
        timerId = null;
      }, MOUNT_MS);
    }
  },

  dismiss: () => {
    clearTimer();
    set({ phase: { kind: "idle" } });
  },
}));
// [END] Phase 8
