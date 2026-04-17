// [START] theme store — persists mode to localStorage, applies html.dark / html.light class
import { create } from "zustand";

export type ThemeMode = "system" | "light" | "dark";

interface ThemeState {
  mode: ThemeMode;
  effective: "light" | "dark";
  setMode: (m: ThemeMode) => void;
  load: () => void;
}

const STORAGE_KEY = "ovo:theme";

function resolveEffective(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return mode;
}

function applyClass(effective: "light" | "dark"): void {
  const html = document.documentElement;
  html.classList.remove("light", "dark");
  html.classList.add(effective);
}

let mediaUnlisten: (() => void) | null = null;

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: "system",
  effective: "light",

  setMode: (m) => {
    // Persist
    try {
      localStorage.setItem(STORAGE_KEY, m);
    } catch { /* ignore */ }

    // Re-wire media listener only when switching to/from "system"
    if (mediaUnlisten) {
      mediaUnlisten();
      mediaUnlisten = null;
    }

    const effective = resolveEffective(m);
    applyClass(effective);
    set({ mode: m, effective });

    if (m === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => {
        const eff = resolveEffective("system");
        applyClass(eff);
        set({ effective: eff });
      };
      mq.addEventListener("change", handler);
      mediaUnlisten = () => mq.removeEventListener("change", handler);
    }
  },

  load: () => {
    let mode: ThemeMode = "system";
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === "light" || raw === "dark" || raw === "system") mode = raw;
    } catch { /* ignore */ }

    // Bootstrap media listener if starting in system mode
    if (mediaUnlisten) {
      mediaUnlisten();
      mediaUnlisten = null;
    }

    const effective = resolveEffective(mode);
    applyClass(effective);
    set({ mode, effective });

    if (mode === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => {
        // Only applies while still in "system" mode
        if (get().mode !== "system") return;
        const eff = resolveEffective("system");
        applyClass(eff);
        set({ effective: eff });
      };
      mq.addEventListener("change", handler);
      mediaUnlisten = () => mq.removeEventListener("change", handler);
    }
  },
}));
// [END] theme store
