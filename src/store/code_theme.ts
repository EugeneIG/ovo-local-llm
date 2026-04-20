// [START] Phase 8.4 — Editor + terminal color theme presets.
// Both Monaco and xterm expose their own theme APIs, so we keep one
// palette per preset and hand each surface the keys it needs. Monaco
// wants its editor.* color overrides; xterm wants ANSI + cursor/bg keys.
// Storing the chosen preset in localStorage so it survives app restart.
import { create } from "zustand";

export type CodeThemePresetId =
  | "ovo_default"
  | "dracula"
  | "tokyo_night"
  | "solarized_dark"
  | "github_light";

export interface CodeThemePreset {
  id: CodeThemePresetId;
  label: string;
  isDark: boolean;
  // Shared colors
  background: string;
  foreground: string;
  cursor: string;
  selectionBg: string;
  // Monaco extras
  lineHighlight: string;
  lineNumber: string;
  lineNumberActive: string;
  widgetBg: string;
  widgetBorder: string;
  // Minimal ANSI (xterm falls back to xterm defaults for unset keys)
  ansi?: Partial<{
    black: string;
    red: string;
    green: string;
    yellow: string;
    blue: string;
    magenta: string;
    cyan: string;
    white: string;
    brightBlack: string;
    brightRed: string;
    brightGreen: string;
    brightYellow: string;
    brightBlue: string;
    brightMagenta: string;
    brightCyan: string;
    brightWhite: string;
  }>;
}

export const CODE_THEME_PRESETS: Record<CodeThemePresetId, CodeThemePreset> = {
  ovo_default: {
    id: "ovo_default",
    label: "OVO Default (Dark)",
    isDark: true,
    background: "#1a1a2e",
    foreground: "#e0e0e0",
    cursor: "#7c5bf0",
    selectionBg: "#7c5bf044",
    lineHighlight: "#ffffff08",
    lineNumber: "#555555",
    lineNumberActive: "#999999",
    widgetBg: "#22223a",
    widgetBorder: "#333333",
  },
  dracula: {
    id: "dracula",
    label: "Dracula",
    isDark: true,
    background: "#282a36",
    foreground: "#f8f8f2",
    cursor: "#ff79c6",
    selectionBg: "#44475a",
    lineHighlight: "#44475a80",
    lineNumber: "#6272a4",
    lineNumberActive: "#f8f8f2",
    widgetBg: "#21222c",
    widgetBorder: "#44475a",
    ansi: {
      black: "#21222c",
      red: "#ff5555",
      green: "#50fa7b",
      yellow: "#f1fa8c",
      blue: "#bd93f9",
      magenta: "#ff79c6",
      cyan: "#8be9fd",
      white: "#f8f8f2",
      brightBlack: "#6272a4",
      brightRed: "#ff6e6e",
      brightGreen: "#69ff94",
      brightYellow: "#ffffa5",
      brightBlue: "#d6acff",
      brightMagenta: "#ff92df",
      brightCyan: "#a4ffff",
      brightWhite: "#ffffff",
    },
  },
  tokyo_night: {
    id: "tokyo_night",
    label: "Tokyo Night",
    isDark: true,
    background: "#1a1b26",
    foreground: "#c0caf5",
    cursor: "#c0caf5",
    selectionBg: "#33467c",
    lineHighlight: "#292e42",
    lineNumber: "#3b4261",
    lineNumberActive: "#737aa2",
    widgetBg: "#16161e",
    widgetBorder: "#292e42",
    ansi: {
      black: "#15161e",
      red: "#f7768e",
      green: "#9ece6a",
      yellow: "#e0af68",
      blue: "#7aa2f7",
      magenta: "#bb9af7",
      cyan: "#7dcfff",
      white: "#a9b1d6",
    },
  },
  solarized_dark: {
    id: "solarized_dark",
    label: "Solarized Dark",
    isDark: true,
    background: "#002b36",
    foreground: "#93a1a1",
    cursor: "#93a1a1",
    selectionBg: "#07364299",
    lineHighlight: "#073642",
    lineNumber: "#586e75",
    lineNumberActive: "#93a1a1",
    widgetBg: "#073642",
    widgetBorder: "#586e75",
    ansi: {
      black: "#073642",
      red: "#dc322f",
      green: "#859900",
      yellow: "#b58900",
      blue: "#268bd2",
      magenta: "#d33682",
      cyan: "#2aa198",
      white: "#eee8d5",
    },
  },
  github_light: {
    id: "github_light",
    label: "GitHub Light",
    isDark: false,
    background: "#ffffff",
    foreground: "#24292f",
    cursor: "#0969da",
    selectionBg: "#0969da22",
    lineHighlight: "#0969da0a",
    lineNumber: "#8c959f",
    lineNumberActive: "#24292f",
    widgetBg: "#f6f8fa",
    widgetBorder: "#d0d7de",
  },
};

interface CodeThemeState {
  presetId: CodeThemePresetId;
  setPreset: (id: CodeThemePresetId) => void;
  load: () => void;
}

const LS_KEY = "ovo:code_theme";

function isValidId(v: unknown): v is CodeThemePresetId {
  return typeof v === "string" && v in CODE_THEME_PRESETS;
}

function initialPreset(): CodeThemePresetId {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (isValidId(raw)) return raw;
  } catch {
    /* ignore */
  }
  return "ovo_default";
}

export const useCodeThemeStore = create<CodeThemeState>((set) => ({
  presetId: initialPreset(),
  setPreset: (id) => {
    try {
      localStorage.setItem(LS_KEY, id);
    } catch {
      /* ignore */
    }
    set({ presetId: id });
  },
  load: () => {
    set({ presetId: initialPreset() });
  },
}));

export function currentPreset(id: CodeThemePresetId): CodeThemePreset {
  return CODE_THEME_PRESETS[id] ?? CODE_THEME_PRESETS.ovo_default;
}
// [END]
