import { create } from "zustand";

// [START] model_perf — per-model performance tracking store.
// Persisted to localStorage under key "ovo:model_perf".
const LS_KEY = "ovo:model_perf";
const MAX_SAMPLES = 20;

export interface ModelPerfSample {
  ttft_ms: number;       // time-to-first-token (ms)
  gen_tokens: number;    // completion token count
  gen_ms: number;        // time from first token to done (ms)
  prompt_tokens: number;
  recorded_at: number;   // epoch ms
}

export interface ModelPerfAgg {
  last_used_at: number;
  runs: number;                    // total runs
  avg_tokens_per_sec: number;      // rolling across last ≤20 runs
  avg_ttft_ms: number;
  recent_samples: ModelPerfSample[]; // capped at 20, FIFO
}

interface ModelPerfState {
  stats: Record<string, ModelPerfAgg>; // repo_id → aggregate
  record: (repoId: string, sample: ModelPerfSample) => void;
  get: (repoId: string) => ModelPerfAgg | null;
  load: () => void;
  reset: (repoId?: string) => void;
}

// [START] Serialisation helpers
function persist(stats: Record<string, ModelPerfAgg>): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(stats));
  } catch {
    // storage unavailable — silent
  }
}

function readStorage(): Record<string, ModelPerfAgg> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, ModelPerfAgg>;
  } catch {
    return {};
  }
}
// [END]

// [START] Aggregate recompute — called after sample list changes.
// avg_tokens_per_sec = sum(gen_tokens) / sum(gen_ms / 1000)
// avg_ttft_ms = mean of ttft_ms across samples
function recompute(samples: ModelPerfSample[]): Pick<ModelPerfAgg, "avg_tokens_per_sec" | "avg_ttft_ms"> {
  if (samples.length === 0) return { avg_tokens_per_sec: 0, avg_ttft_ms: 0 };
  let totalTokens = 0;
  let totalGenSec = 0;
  let totalTtft = 0;
  for (const s of samples) {
    totalTokens += s.gen_tokens;
    totalGenSec += s.gen_ms / 1000;
    totalTtft += s.ttft_ms;
  }
  return {
    avg_tokens_per_sec: totalGenSec > 0 ? totalTokens / totalGenSec : 0,
    avg_ttft_ms: totalTtft / samples.length,
  };
}
// [END]

export const useModelPerfStore = create<ModelPerfState>((set, get) => ({
  stats: {},

  // [START] record — append sample, cap at MAX_SAMPLES, recompute aggregates
  record: (repoId, sample) => {
    const current = get().stats[repoId];
    const prevSamples = current?.recent_samples ?? [];
    const next = [...prevSamples, sample];
    if (next.length > MAX_SAMPLES) next.splice(0, next.length - MAX_SAMPLES);
    const { avg_tokens_per_sec, avg_ttft_ms } = recompute(next);
    const agg: ModelPerfAgg = {
      last_used_at: sample.recorded_at,
      runs: (current?.runs ?? 0) + 1,
      avg_tokens_per_sec,
      avg_ttft_ms,
      recent_samples: next,
    };
    const nextStats = { ...get().stats, [repoId]: agg };
    set({ stats: nextStats });
    persist(nextStats);
  },
  // [END]

  get: (repoId) => get().stats[repoId] ?? null,

  // [START] load — hydrate from localStorage on bootstrap
  load: () => {
    const stored = readStorage();
    set({ stats: stored });
  },
  // [END]

  // [START] reset — clear one or all entries
  reset: (repoId) => {
    if (repoId === undefined) {
      set({ stats: {} });
      persist({});
    } else {
      const next = { ...get().stats };
      delete next[repoId];
      set({ stats: next });
      persist(next);
    }
  },
  // [END]
}));
// [END]
