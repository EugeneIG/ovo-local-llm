import { create } from "zustand";

// [START] Phase 6.2c — tool-call approval mode.
// Controls how MCP tool calls from the model are handled before execution.
//   plan    — never execute; inject a "plan-only" tool_result so the model
//             continues as if the tool ran (useful for dry-runs)
//   ask     — surface a confirmation prompt and wait for user approval
//   bypass  — auto-execute (default, fastest, matches Claude's default)
export type ToolMode = "plan" | "ask" | "bypass";

const LS_KEY = "ovo:tool_mode";

interface ToolModeState {
  mode: ToolMode;
  setMode: (m: ToolMode) => void;
  load: () => void;
}

function isToolMode(v: unknown): v is ToolMode {
  return v === "plan" || v === "ask" || v === "bypass";
}

export const useToolModeStore = create<ToolModeState>((set) => ({
  mode: "bypass",

  setMode: (m) => {
    try {
      localStorage.setItem(LS_KEY, m);
    } catch {
      /* storage unavailable — silent */
    }
    set({ mode: m });
  },

  load: () => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (isToolMode(raw)) set({ mode: raw });
    } catch {
      /* ignore */
    }
  },
}));
// [END]
