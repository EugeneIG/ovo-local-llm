// [START] Phase 5 — Code IDE editor + AI completion settings.
// localStorage-persisted Zustand store. Consumed by MonacoEditor for the
// editor surface and by MonacoEditor's inline completion provider for the
// Phase 4 FIM ghost text toggles.
import { create } from "zustand";

export type WordWrap = "off" | "on";
export type AutoSaveMode = "off" | "afterDelay" | "onFocusChange";
export type BrowserPreference =
  | "default"
  | "safari"
  | "chrome"
  | "firefox"
  | "arc"
  | "edge"
  | "custom";

export interface CodeSettings {
  // Editor surface
  fontSize: number;
  tabSize: number;
  wordWrap: WordWrap;
  minimap: boolean;
  lineNumbers: boolean;
  autoSave: AutoSaveMode;
  autoSaveDelay: number; // ms, only used when autoSave === "afterDelay"

  // AI inline completion (Phase 4)
  completionEnabled: boolean;
  completionDelayMs: number;

  // [START] Phase 5 — browser opened when a run_command prints a localhost URL.
  browserPreference: BrowserPreference;
  /** macOS app name (e.g. "Vivaldi") — only used when browserPreference === "custom". */
  browserCustomApp: string;
  // [END]
}

const DEFAULT_SETTINGS: CodeSettings = {
  fontSize: 13,
  tabSize: 2,
  wordWrap: "off",
  minimap: true,
  lineNumbers: true,
  autoSave: "off",
  autoSaveDelay: 1000,
  completionEnabled: true,
  completionDelayMs: 300,
  browserPreference: "safari",
  browserCustomApp: "",
};

const LS_KEY = "ovo:code_settings";

function loadFromStorage(): CodeSettings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<CodeSettings>;
    // Merge + clamp so a corrupt / legacy key shape can't break the editor.
    return {
      fontSize: clampNum(parsed.fontSize, 10, 32, DEFAULT_SETTINGS.fontSize),
      tabSize: clampInt(parsed.tabSize, 1, 8, DEFAULT_SETTINGS.tabSize),
      wordWrap: parsed.wordWrap === "on" ? "on" : "off",
      minimap: typeof parsed.minimap === "boolean" ? parsed.minimap : DEFAULT_SETTINGS.minimap,
      lineNumbers:
        typeof parsed.lineNumbers === "boolean" ? parsed.lineNumbers : DEFAULT_SETTINGS.lineNumbers,
      autoSave: isAutoSaveMode(parsed.autoSave) ? parsed.autoSave : DEFAULT_SETTINGS.autoSave,
      autoSaveDelay: clampInt(parsed.autoSaveDelay, 200, 10_000, DEFAULT_SETTINGS.autoSaveDelay),
      completionEnabled:
        typeof parsed.completionEnabled === "boolean"
          ? parsed.completionEnabled
          : DEFAULT_SETTINGS.completionEnabled,
      completionDelayMs: clampInt(
        parsed.completionDelayMs,
        50,
        2000,
        DEFAULT_SETTINGS.completionDelayMs,
      ),
      browserPreference: isBrowserPref(parsed.browserPreference)
        ? parsed.browserPreference
        : DEFAULT_SETTINGS.browserPreference,
      browserCustomApp:
        typeof parsed.browserCustomApp === "string"
          ? parsed.browserCustomApp
          : DEFAULT_SETTINGS.browserCustomApp,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function persist(s: CodeSettings) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

function clampNum(v: unknown, lo: number, hi: number, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, v));
}
function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = clampNum(v, lo, hi, fallback);
  return Math.round(n);
}
function isAutoSaveMode(v: unknown): v is AutoSaveMode {
  return v === "off" || v === "afterDelay" || v === "onFocusChange";
}
function isBrowserPref(v: unknown): v is BrowserPreference {
  return (
    v === "default" ||
    v === "safari" ||
    v === "chrome" ||
    v === "firefox" ||
    v === "arc" ||
    v === "edge" ||
    v === "custom"
  );
}

interface CodeSettingsState extends CodeSettings {
  set: <K extends keyof CodeSettings>(key: K, value: CodeSettings[K]) => void;
  reset: () => void;
}

function extractSettings(s: CodeSettingsState): CodeSettings {
  return {
    fontSize: s.fontSize,
    tabSize: s.tabSize,
    wordWrap: s.wordWrap,
    minimap: s.minimap,
    lineNumbers: s.lineNumbers,
    autoSave: s.autoSave,
    autoSaveDelay: s.autoSaveDelay,
    completionEnabled: s.completionEnabled,
    completionDelayMs: s.completionDelayMs,
    browserPreference: s.browserPreference,
    browserCustomApp: s.browserCustomApp,
  };
}

export const useCodeSettingsStore = create<CodeSettingsState>((set) => ({
  ...loadFromStorage(),
  set: (key, value) => {
    set((prev) => {
      const next = { ...prev, [key]: value };
      persist(extractSettings(next));
      return next;
    });
  },
  reset: () => {
    set({ ...DEFAULT_SETTINGS });
    persist(DEFAULT_SETTINGS);
  },
}));
// [END] Phase 5
