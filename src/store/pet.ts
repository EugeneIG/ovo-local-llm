import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

// [START] Phase 7 — pet store: persists pet_enabled to localStorage "ovo:pet_enabled".
// Invoking pet_show/pet_hide is side-effectful and done here so SettingsPane
// only needs to call setPetEnabled(bool) — no invoke calls in UI layer.

const LS_KEY = "ovo:pet_enabled";

interface PetState {
  pet_enabled: boolean;
  setPetEnabled: (enabled: boolean) => Promise<void>;
}

function readPetEnabled(): boolean {
  try {
    const v = localStorage.getItem(LS_KEY);
    if (v === null) return true;
    return v === "true";
  } catch {
    return true;
  }
}

function persistPetEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(LS_KEY, String(enabled));
  } catch {
    // storage unavailable — silent
  }
}

export const usePetStore = create<PetState>((set) => ({
  pet_enabled: readPetEnabled(),

  setPetEnabled: async (enabled: boolean) => {
    set({ pet_enabled: enabled });
    persistPetEnabled(enabled);
    try {
      await invoke(enabled ? "pet_show" : "pet_hide");
    } catch {
      // Tauri not available in browser preview — silent
    }
  },
}));
// [END]
