import { create } from "zustand";
import {
  streamImageGeneration,
  type GeneratedImage,
  type ImagesGenerateRequest,
  type LoraEntry,
} from "../lib/api";
import { useSidecarStore } from "./sidecar";
import { useToastsStore } from "./toasts";
import { applyStylePreset, getStylePreset } from "../lib/image_style_presets";

// [START] Phase 7 — Image generation store.
// Holds the full Draw-Things-parity control surface: prompt, negative prompt,
// model, sampler, seed, size, steps, CFG, shift, batch, LoRA list, and a
// placeholder for ControlNet hooks. Settings persist to localStorage so the
// Image tab remembers the last configuration across app launches; the
// generated gallery is session-local (gallery on disk is authoritative).

const LS_KEY = "ovo:image_gen";

export const SAMPLERS = [
  "euler",
  "euler_a",
  "heun",
  "dpm++_2m",
  "dpm++_2m_karras",
  "dpm++_sde",
  "dpm++_sde_karras",
  "dpm_single",
  "dpm_single_karras",
  "kdpm2",
  "kdpm2_a",
  "deis",
  "ddim",
  "unipc",
  "lms",
  "pndm",
] as const;
export type Sampler = (typeof SAMPLERS)[number];

// Common preset sizes — the UI still allows custom W×H via numeric inputs.
export const SIZE_PRESETS: ReadonlyArray<{ label: string; width: number; height: number }> = [
  { label: "512×512 (SD1.5 square)", width: 512, height: 512 },
  { label: "768×768 (SD1.5 hi-res)", width: 768, height: 768 },
  { label: "1024×1024 (SDXL/Flux square)", width: 1024, height: 1024 },
  { label: "1024×1536 (portrait)", width: 1024, height: 1536 },
  { label: "1536×1024 (landscape)", width: 1536, height: 1024 },
];

interface PersistedSettings {
  model: string | null;
  prompt: string;
  negative_prompt: string;
  width: number;
  height: number;
  steps: number;
  cfg_scale: number;
  sampler: Sampler;
  seed: number | null;
  batch: number;
  shift: number | null;
  loras: LoraEntry[];
  control_model: string | null;
  control_strength: number;
  /** SDXL-style preset id; "none" disables prompt wrapping. */
  style_preset_id: string;
}

function defaultSettings(): PersistedSettings {
  return {
    model: null,
    prompt: "",
    negative_prompt: "",
    width: 1024,
    height: 1024,
    steps: 28,
    cfg_scale: 7.0,
    sampler: "dpm++_2m_karras",
    seed: null,
    batch: 1,
    shift: null,
    loras: [],
    control_model: null,
    control_strength: 1.0,
    style_preset_id: "none",
  };
}

function readStorage(): Partial<PersistedSettings> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<PersistedSettings>;
  } catch {
    return {};
  }
}

function persist(state: PersistedSettings): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable */
  }
}

interface ImageGenState extends PersistedSettings {
  generating: boolean;
  progress: { step: number; total: number; elapsed_ms: number } | null;
  /** Non-null while the sidecar is loading model weights (first use / swap). */
  loading_model_ref: string | null;
  last_error: string | null;
  // Client-side control image (base64, no data-url prefix).
  control_image_b64: string | null;
  // Session gallery: images produced since app launch.
  session_gallery: GeneratedImage[];
  abort: AbortController | null;

  // Actions
  load: () => void;
  setModel: (model: string | null) => void;
  setPrompt: (prompt: string) => void;
  setNegativePrompt: (negative: string) => void;
  setSize: (width: number, height: number) => void;
  setSteps: (n: number) => void;
  setCfgScale: (v: number) => void;
  setSampler: (s: Sampler) => void;
  setSeed: (s: number | null) => void;
  setBatch: (n: number) => void;
  setShift: (v: number | null) => void;
  setControlModel: (m: string | null) => void;
  setControlStrength: (v: number) => void;
  setControlImageB64: (data: string | null) => void;
  setStylePreset: (id: string) => void;
  addLora: (entry: LoraEntry) => void;
  removeLora: (index: number) => void;
  updateLora: (index: number, patch: Partial<LoraEntry>) => void;

  generate: () => Promise<void>;
  stop: () => void;
  clearGallery: () => void;
}

function snapshotPersisted(s: ImageGenState): PersistedSettings {
  return {
    model: s.model,
    prompt: s.prompt,
    negative_prompt: s.negative_prompt,
    width: s.width,
    height: s.height,
    steps: s.steps,
    cfg_scale: s.cfg_scale,
    sampler: s.sampler,
    seed: s.seed,
    batch: s.batch,
    shift: s.shift,
    loras: s.loras,
    control_model: s.control_model,
    control_strength: s.control_strength,
    style_preset_id: s.style_preset_id,
  };
}

export const useImageGenStore = create<ImageGenState>((set, get) => ({
  ...defaultSettings(),
  generating: false,
  progress: null,
  loading_model_ref: null,
  last_error: null,
  control_image_b64: null,
  session_gallery: [],
  abort: null,

  load: () => {
    const stored = readStorage();
    set({ ...defaultSettings(), ...stored });
  },

  setModel: (model) => {
    const prev = get().model;
    set({ model });
    persist(snapshotPersisted(get()));
    // [START] Phase 8 — top-center swap toast for image-slot model changes
    if (prev !== model) {
      void import("./model_swap").then((mod) =>
        mod.useModelSwapStore.getState().notifySwap(prev, model, "image"),
      );
    }
    // [END]
  },
  setPrompt: (prompt) => {
    set({ prompt });
    persist(snapshotPersisted(get()));
  },
  setNegativePrompt: (negative_prompt) => {
    set({ negative_prompt });
    persist(snapshotPersisted(get()));
  },
  setSize: (width, height) => {
    const w = Math.max(64, Math.min(2048, Math.round(width)));
    const h = Math.max(64, Math.min(2048, Math.round(height)));
    set({ width: w, height: h });
    persist(snapshotPersisted(get()));
  },
  setSteps: (steps) => {
    set({ steps: Math.max(1, Math.min(200, Math.round(steps))) });
    persist(snapshotPersisted(get()));
  },
  setCfgScale: (cfg_scale) => {
    set({ cfg_scale: Math.max(0, Math.min(30, cfg_scale)) });
    persist(snapshotPersisted(get()));
  },
  setSampler: (sampler) => {
    set({ sampler });
    persist(snapshotPersisted(get()));
  },
  setSeed: (seed) => {
    set({ seed });
    persist(snapshotPersisted(get()));
  },
  setBatch: (batch) => {
    set({ batch: Math.max(1, Math.min(8, Math.round(batch))) });
    persist(snapshotPersisted(get()));
  },
  setShift: (shift) => {
    set({ shift });
    persist(snapshotPersisted(get()));
  },
  setControlModel: (control_model) => {
    set({ control_model });
    persist(snapshotPersisted(get()));
  },
  setControlStrength: (control_strength) => {
    set({ control_strength: Math.max(0, Math.min(2, control_strength)) });
    persist(snapshotPersisted(get()));
  },
  setControlImageB64: (control_image_b64) => set({ control_image_b64 }),
  setStylePreset: (style_preset_id) => {
    set({ style_preset_id });
    persist(snapshotPersisted(get()));
  },
  addLora: (entry) => {
    const next = [...get().loras, entry];
    set({ loras: next });
    persist(snapshotPersisted(get()));
  },
  removeLora: (index) => {
    const next = get().loras.filter((_, i) => i !== index);
    set({ loras: next });
    persist(snapshotPersisted(get()));
  },
  updateLora: (index, patch) => {
    const next = get().loras.map((l, i) => (i === index ? { ...l, ...patch } : l));
    set({ loras: next });
    persist(snapshotPersisted(get()));
  },

  generate: async () => {
    const s = get();
    if (s.generating) return;
    if (!s.model) {
      set({ last_error: "no_model" });
      return;
    }
    if (!s.prompt.trim()) {
      set({ last_error: "empty_prompt" });
      return;
    }

    // [START] Slot-isolated memory model (Phase 7 revision).
    // The diffusion runner lives in its own "image" slot and no longer evicts
    // the chat/code LLM slot, so the user can alternate between Chat and
    // Image tabs without paying a reload cost. Unified memory on the Mac is
    // large enough to host one image pipeline + one LLM simultaneously.
    // [END]

    const abort = new AbortController();
    set({
      generating: true,
      progress: { step: 0, total: s.steps, elapsed_ms: 0 },
      loading_model_ref: null,
      last_error: null,
      abort,
    });

    // [START] Phase 7 — wrap with style preset (if any) BEFORE sending.
    // The preset's template injects the user prompt and appends extra
    // negative terms. "none" is a passthrough so user input reaches the
    // model verbatim.
    const preset = getStylePreset(s.style_preset_id);
    const merged = applyStylePreset(preset, s.prompt, s.negative_prompt);
    // [END]

    const req: ImagesGenerateRequest = {
      prompt: merged.prompt,
      model: s.model,
      negative_prompt: merged.negative,
      width: s.width,
      height: s.height,
      steps: s.steps,
      cfg_scale: s.cfg_scale,
      sampler: s.sampler,
      seed: s.seed,
      batch: s.batch,
      shift: s.shift,
      loras: s.loras,
      control_image_b64: s.control_image_b64,
      control_model: s.control_model,
      control_strength: s.control_strength,
    };

    const ports = useSidecarStore.getState().status.ports;

    try {
      for await (const event of streamImageGeneration(req, abort.signal, ports)) {
        if (event.type === "loading") {
          set({ loading_model_ref: event.model });
        } else if (event.type === "progress") {
          set({
            loading_model_ref: null,
            progress: {
              step: event.step,
              total: event.total,
              elapsed_ms: event.elapsed_ms,
            },
          });
        } else if (event.type === "image") {
          set((prev) => ({
            session_gallery: [
              {
                index: event.index,
                path: event.path,
                base64_png: event.base64_png,
                seed: event.seed,
                width: event.width,
                height: event.height,
              },
              ...prev.session_gallery,
            ].slice(0, 200),
          }));
        } else if (event.type === "error") {
          set({ last_error: event.message });
          useToastsStore.getState().push({ kind: "error", message: event.message });
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!abort.signal.aborted) {
        set({ last_error: msg });
        useToastsStore.getState().push({ kind: "error", message: msg });
      }
    } finally {
      set({ generating: false, progress: null, loading_model_ref: null, abort: null });
    }
  },

  stop: () => {
    const ctl = get().abort;
    if (ctl) ctl.abort();
  },

  clearGallery: () => set({ session_gallery: [] }),
}));
// [END] Phase 7
