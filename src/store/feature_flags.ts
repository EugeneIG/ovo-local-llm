import { create } from "zustand";

// [START] Phase 8 — Feature flags. Six on/off toggles surfaced in Settings >
// 고급 so the user can disable any of OVO's "smart" injections at will.
// Defaults are all-on so out-of-the-box behavior matches prior releases;
// flipping a toggle off takes effect on the next chat send (no app reload).
//
// Stored in localStorage as `ovo:feature_flags` (single JSON blob).

const LS_KEY = "ovo:feature_flags";

export interface FeatureFlags {
  /** Auto-load .ovo/skills/*.md catalog into the system prompt */
  enable_skills: boolean;
  /** Apply active persona's prompt + sampling overrides to the chat send */
  enable_personas: boolean;
  /** Inject the skills catalog block (<ovo_skills>) into the system prompt */
  enable_skills_injection: boolean;
  /** Wiki hybrid search runs on every send and injects <project_wiki> */
  enable_wiki_retrieval: boolean;
  /** memory_* tools advertised to the model and executable */
  enable_memory_tools: boolean;
  /** Auto-capture meaningful findings to Wiki at session end (placeholder) */
  enable_wiki_auto_capture: boolean;
  /** Use embeddings to pick low-relevance / redundant messages for compaction
   *  instead of the simple oldest-50% slice. Sidecar must be up; falls back
   *  to time-based silently otherwise. */
  enable_semantic_compact: boolean;
  /** Show a "best fit" model suggestion under the chat input based on the
   *  current draft prompt + any attachments + per-model perf stats. One-tap
   *  to swap. Suggestion hides when nothing better than the current model. */
  enable_model_recommendation: boolean;
  // [START] Phase 8 — Voice I/O flags (both default OFF — require explicit opt-in)
  /** Mic button in the chat input. Holds mic → records → transcribes via
   *  mlx-whisper sidecar endpoint and inserts text. Requires sidecar up. */
  enable_voice_input: boolean;
  /** Auto-read assistant responses aloud via macOS `say` after streaming ends.
   *  Only fires for the completed turn, not historical messages on load. */
  enable_tts_response: boolean;
  // [END]
}

export const FLAG_KEYS: ReadonlyArray<keyof FeatureFlags> = [
  "enable_skills",
  "enable_personas",
  "enable_skills_injection",
  "enable_wiki_retrieval",
  "enable_memory_tools",
  "enable_wiki_auto_capture",
  "enable_semantic_compact",
  "enable_model_recommendation",
  "enable_voice_input",
  "enable_tts_response",
];

// [START] Defaults start lean — minimal system prompt for fast first response.
// Power users enable features as needed in Settings → Feature Flags.
const DEFAULTS: FeatureFlags = {
  enable_skills: false,
  enable_personas: false,
  enable_skills_injection: false,
  enable_wiki_retrieval: false,
  enable_memory_tools: false,
  enable_wiki_auto_capture: false,
  enable_semantic_compact: false,
  enable_model_recommendation: true, // local heuristic, no extra cost
  enable_voice_input: false,
  enable_tts_response: false,
};
// [END]

interface FeatureFlagsState extends FeatureFlags {
  load: () => void;
  set: <K extends keyof FeatureFlags>(key: K, value: FeatureFlags[K]) => void;
  reset: () => void;
  snapshot: () => FeatureFlags;
}

function readStorage(): Partial<FeatureFlags> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Partial<FeatureFlags> = {};
    for (const key of FLAG_KEYS) {
      const v = (parsed as Record<string, unknown>)[key];
      if (typeof v === "boolean") out[key] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeStorage(flags: FeatureFlags): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(flags));
  } catch {
    /* storage unavailable */
  }
}

export const useFeatureFlagsStore = create<FeatureFlagsState>((set, get) => ({
  ...DEFAULTS,

  load: () => {
    const stored = readStorage();
    set({ ...DEFAULTS, ...stored });
  },

  set: (key, value) => {
    set({ [key]: value } as Partial<FeatureFlags>);
    const snap = get().snapshot();
    writeStorage(snap);
  },

  reset: () => {
    set({ ...DEFAULTS });
    writeStorage(DEFAULTS);
  },

  snapshot: () => {
    const s = get();
    const out = {} as FeatureFlags;
    for (const key of FLAG_KEYS) out[key] = s[key];
    return out;
  },
}));
// [END]
