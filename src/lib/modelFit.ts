// [START] Phase 8 — Model fit scoring.
// Estimates whether a model will run on the current host, using RAM as the
// dominant signal. Apple Silicon shares memory between CPU and GPU so the
// full machine RAM counts toward model weights; on discrete-GPU hosts we'd
// want VRAM instead — that path is stubbed as "unknown" until we probe
// nvidia-smi from the sidecar.
//
// Scoring is intentionally coarse — four buckets (perfect / good / tight /
// won't fit) — because we don't have ground-truth benchmarks for every
// model the user might install. Good enough to answer "can this run?" at
// a glance; not a substitute for actually launching the model.

import type { SystemInfo } from "./api";
import type { OvoModel } from "../types/ovo";
import {
  effectiveParamsB,
  estimateCuratedBytes,
  type CuratedModel,
} from "./modelCatalog";

export type FitTier = "perfect" | "good" | "tight" | "unfit" | "unknown";

export interface FitAssessment {
  tier: FitTier;
  /** Estimated model weights in bytes (pre-quantization when possible). */
  estimatedBytes: number | null;
  /** i18n key for the reason line (resolved by the renderer). */
  reasonKey: string;
  /** Parameters passed to t(reasonKey). */
  reasonParams: Record<string, number | string>;
  /** 0-100 score so the list can be sorted monotonically. */
  score: number;
}

// [START] estimateModelBytes — size hint from the OvoModel shape.
// sidecar's hf_scanner reports `size_bytes` for every local snapshot when
// available; if the model is incomplete or remote-only, we fall back to
// parsing the repo id (e.g. "Qwen3-32B-MLX" → 32B params) and applying a
// rough-per-parameter multiplier for the detected quantization.
export function estimateModelBytes(model: OvoModel): number | null {
  if (typeof model.size_bytes === "number" && model.size_bytes > 0) {
    return model.size_bytes;
  }
  const id = model.repo_id ?? "";
  // Parameter count — look for "Nb" or "NB" patterns ("7b", "32B", "405b").
  const paramMatch = id.match(/(\d+(?:\.\d+)?)\s*[bB](?![a-z])/);
  if (!paramMatch) return null;
  const paramsB = parseFloat(paramMatch[1]);
  if (!isFinite(paramsB) || paramsB <= 0) return null;

  // Bytes per parameter ~ quantization. Rough:
  //   fp16 / bf16           = 2.0
  //   8-bit (q8_0, int8)    = 1.0
  //   6-bit (q6_k)          = 0.75
  //   4-bit (q4, nvfp4…)    = 0.5
  //   3-bit (q3_k_*)        = 0.42
  //   2-bit (q2_k)          = 0.3
  //   Ternary (TQ, BitNet,  ~ 1.58 bits) = 0.2
  //   1-bit                 = 0.13
  // Checked in specificity order — narrowest patterns first — so a
  // "-bitnet-1b58" repo doesn't get caught by the generic "1bit" rule.
  const lower = id.toLowerCase();
  let bytesPerParam = 2.0;
  if (/(bitnet|tq[12]_?\d|1[._]58[-_]?bit|1p58|ternary|tern|ternar)/.test(lower)) {
    bytesPerParam = 0.2;
  } else if (/(^|[^a-z])1[-_]?bit\b/.test(lower)) {
    bytesPerParam = 0.13;
  } else if (/(^|[^a-z])q?2[-_]?bit|2bit\b|q2(_\w+)?/.test(lower)) {
    bytesPerParam = 0.3;
  } else if (/3[-_]?bit|q3(_\w+)?/.test(lower)) {
    bytesPerParam = 0.42;
  } else if (/(nvfp4|mxfp4|fp4|q?4[-_]?bit|4bit\b|q4(_\w+)?)/.test(lower)) {
    bytesPerParam = 0.5;
  } else if (/(q6(_\w+)?|6[-_]?bit)/.test(lower)) {
    bytesPerParam = 0.75;
  } else if (/(q?8[-_]?bit|8bit\b|q8(_\w+)?|int8)/.test(lower)) {
    bytesPerParam = 1.0;
  } else if (/(bf16|fp16)/.test(lower)) {
    bytesPerParam = 2.0;
  }

  return Math.round(paramsB * 1e9 * bytesPerParam);
}
// [END]

// [START] assessFit — compare weights to available memory.
// Prefers the sidecar's MLX `memory_limit` when present — that's the exact
// byte count MLX will allow before refusing new allocations, so it matches
// whether a model will actually load. Falls back to a `total RAM * 0.7`
// heuristic (matching macOS' own wired-memory ceiling) for legacy sidecars
// and non-MLX hosts. `SYSTEM_OVERHEAD_BYTES` only applies in the fallback
// path because `mlx_memory_limit_bytes` already has headroom baked in by
// the sidecar's configure_memory_limits().
const SYSTEM_OVERHEAD_BYTES = 4 * 1024 ** 3;

function usableBytes(sys: SystemInfo): number {
  const mlx = sys.gpu.mlx_memory_limit_bytes ?? 0;
  if (mlx > 0) return mlx;
  const totalRam = sys.memory.total_bytes;
  // Best-guess macOS wired cap (~70 %) minus our own process overhead.
  return Math.max(0, Math.round(totalRam * 0.7) - SYSTEM_OVERHEAD_BYTES);
}

export function assessFit(model: OvoModel, sys: SystemInfo | null): FitAssessment {
  const est = estimateModelBytes(model);
  if (!sys) {
    return {
      tier: "unknown",
      estimatedBytes: est,
      reasonKey: "models.fit.reason.no_system_info",
      reasonParams: {},
      score: 0,
    };
  }
  if (est === null) {
    return {
      tier: "unknown",
      estimatedBytes: null,
      reasonKey: "models.fit.reason.unknown_size",
      reasonParams: {},
      score: 0,
    };
  }

  const usableRam = usableBytes(sys);

  // Ratio: 0.3 = model fits in 30% of usable RAM → plenty of headroom.
  const ratio = est / usableRam;
  const pct = Math.round(ratio * 100);

  if (ratio <= 0.35) {
    return {
      tier: "perfect",
      estimatedBytes: est,
      reasonKey: "models.fit.reason.perfect",
      reasonParams: { pct },
      score: 100 - Math.round(ratio * 30),
    };
  }
  if (ratio <= 0.6) {
    return {
      tier: "good",
      estimatedBytes: est,
      reasonKey: "models.fit.reason.good",
      reasonParams: { pct },
      score: 80 - Math.round((ratio - 0.35) * 100),
    };
  }
  if (ratio <= 0.9) {
    return {
      tier: "tight",
      estimatedBytes: est,
      reasonKey: "models.fit.reason.tight",
      reasonParams: { pct },
      score: 50 - Math.round((ratio - 0.6) * 80),
    };
  }
  return {
    tier: "unfit",
    estimatedBytes: est,
    reasonKey: "models.fit.reason.unfit",
    reasonParams: { pct },
    score: Math.max(5, Math.round((1 - Math.min(1, ratio - 1)) * 20)),
  };
}
// [END]

// [START] Phase 8 — 4-axis scoring for curated catalog entries.
// The installed-model path uses a single "fit" tier; catalog entries get
// four independent 0-100 scores so the UI can show why a model tops the
// recommendation list and let the user weight axes differently later.
//
//   fitAxis     — how comfortably the weights + KV cache fit on this host
//   qualityAxis — catalog-assigned relative capability
//   speedAxis   — derived from effective params + MoE routing
//   contextAxis — window length, log-scaled against 256k reference
//
// `overall` is a weighted mean favouring fit (you can't use a model that
// won't load) and quality, with speed / context as tie-breakers.
export interface ScoreBreakdown {
  fit: number;
  quality: number;
  speed: number;
  context: number;
  overall: number;
  tier: FitTier;
  estimatedBytes: number;
  reasonKey: string;
  reasonParams: Record<string, number | string>;
}

function speedScoreFromParams(paramsB: number): number {
  // Rough S-curve: 1B ≈ 100, 3B ≈ 92, 7B ≈ 82, 14B ≈ 70, 30B ≈ 55, 70B ≈ 38.
  // Capped so we don't hand back negative scores for absurd sizes.
  const s = 100 - 18 * Math.log2(Math.max(0.5, paramsB));
  return Math.max(10, Math.min(100, Math.round(s)));
}

function contextScore(ctxTokens: number): number {
  // 4k ≈ 30, 32k ≈ 60, 128k ≈ 85, 256k+ ≈ 100. Saturates above 256k.
  if (ctxTokens <= 0) return 0;
  const logScore = (Math.log2(ctxTokens / 1024) / Math.log2(256)) * 100;
  return Math.max(10, Math.min(100, Math.round(logScore)));
}

export function scoreCatalogFit(c: CuratedModel, sys: SystemInfo | null): ScoreBreakdown {
  const estimatedBytes = estimateCuratedBytes(c);
  const fakeModel: OvoModel = {
    repo_id: c.repo_id,
    size_bytes: estimatedBytes,
    // The rest of the OvoModel shape is irrelevant for fit assessment; we
    // only care about size_bytes. A partial cast is safer than a full mock
    // with dummy defaults, so we widen via `unknown` intentionally.
  } as unknown as OvoModel;
  const fit = assessFit(fakeModel, sys);

  const speed = speedScoreFromParams(effectiveParamsB(c));
  const context = contextScore(c.contextLength);
  const quality = Math.max(0, Math.min(100, c.qualityScore));

  // Overall — fit and quality dominate. A model that doesn't fit should
  // plummet in overall regardless of how fast or high-context it is, so
  // we treat `unfit` as a hard multiplier instead of a soft subtraction.
  const fitMultiplier =
    fit.tier === "unfit" ? 0.15 :
      fit.tier === "tight" ? 0.7 :
        fit.tier === "unknown" ? 0.5 :
          1.0;
  const weighted = (quality * 0.45 + speed * 0.25 + context * 0.15 + fit.score * 0.15);
  const overall = Math.round(Math.max(0, Math.min(100, weighted * fitMultiplier)));

  return {
    fit: fit.score,
    quality,
    speed,
    context,
    overall,
    tier: fit.tier,
    estimatedBytes,
    reasonKey: fit.reasonKey,
    reasonParams: fit.reasonParams,
  };
}
// [END]

// [START] Phase 5 — llmfit-style metadata helpers.
// The Fit pane exposes all the axes a power user would want to see before
// picking a model: estimated tok/s, quantization, execution mode (MoE /
// dense), memory usage %, context length, use-case tag, and a rough quality
// score. Everything here is a heuristic — we intentionally don't run
// benchmarks or load the model — but the numbers are calibrated against
// the llmfit TUI ranges so they're directionally correct for ranking.

export type ExecutionMode = "MoE" | "GPU" | "CPU+GPU";
export type UseCase = "Coding" | "Reasoning" | "Chat" | "VLM" | "General";

/** Infer tok/s* from params + MoE routing.
 * Hot path: dense 7B ≈ 40 tok/s on M-series 4-bit, 14B ≈ 22, 30B ≈ 11, 70B ≈ 4.
 * MoE with K active params takes K's speed, not total's. Rough — doesn't
 * account for quant; good enough for ranking. */
export function estimateTokensPerSec(paramsB: number, activeParamsB?: number | null): number {
  const effective = activeParamsB && activeParamsB > 0 ? activeParamsB : paramsB;
  if (effective <= 0) return 0;
  // Fit to M-series Apple Silicon 4-bit measurements.
  const tps = 260 / (effective + 0.5);
  return Math.max(0.5, Math.round(tps * 10) / 10);
}

/** Pull a compact quant label ("Q4_K_M", "Q8_0", "FP16"…) from the model. */
export function detectQuantLabel(model: OvoModel): string {
  const q = model.quantization;
  if (typeof q === "string" && q.length > 0) {
    return q.toUpperCase().replace(/^Q/, "Q").replace(/_/g, "_");
  }
  if (q && typeof q === "object") {
    const bits = q.bits;
    const mode = q.mode;
    if (typeof bits === "number" && bits > 0) {
      const modeSuffix = typeof mode === "string" && mode.length > 0 ? `_${mode.toUpperCase()}` : "";
      return `Q${bits}${modeSuffix}`;
    }
  }
  // Fall back to a scan of the repo id for GGUF-style tags.
  const id = (model.repo_id ?? "").toUpperCase();
  const m = id.match(/Q\d(?:_[A-Z0-9]+)*|FP16|BF16|INT8|NVFP4|MXFP4/);
  if (m) return m[0];
  return "—";
}

/** Classify the active params vs. total to detect MoE routing. Dense models
 * return "GPU"; MoE return "MoE"; huge models that will spill to CPU return
 * "CPU+GPU". Consumed both by the installed-model table and the Fit TUI
 * snapshot. */
export function detectExecutionMode(
  model: OvoModel,
  sys: SystemInfo | null,
): ExecutionMode {
  const id = (model.repo_id ?? "").toLowerCase();
  const isMoE = /-a\d+b|[-_]moe|[-_]mixtral|[-_]nex\b|qwen3.*coder/.test(id);
  if (isMoE) return "MoE";
  const est = estimateModelBytes(model);
  if (sys && est !== null) {
    const usable = (sys.gpu.mlx_memory_limit_bytes && sys.gpu.mlx_memory_limit_bytes > 0)
      ? sys.gpu.mlx_memory_limit_bytes
      : Math.round(sys.memory.total_bytes * 0.7);
    if (est > usable * 0.85) return "CPU+GPU";
  }
  return "GPU";
}

/** Best-effort use-case classification from the repo id + capabilities. */
export function classifyUseCase(model: OvoModel): UseCase {
  const caps = model.capabilities ?? [];
  if (caps.includes("vision") || caps.includes("audio")) return "VLM";
  const id = (model.repo_id ?? "").toLowerCase();
  if (/coder|code-|-code|codegen|-codestral|starcoder/.test(id)) return "Coding";
  if (/r1[-_]|reason|thinker|thinking|distill|-o1-|deepseek-r\d/.test(id)) return "Reasoning";
  if (/instruct|chat|-it\b/.test(id)) return "Chat";
  return "General";
}

/** Heuristic 0-100 "quality" score for installed models without a curated
 * catalog entry. Higher params = higher ceiling, MoE active-params penalty,
 * coder/reasoning specialists get a small bump when matched to their task. */
export function heuristicQuality(paramsB: number, activeParamsB?: number | null): number {
  const effective = activeParamsB && activeParamsB > 0 ? activeParamsB : paramsB;
  if (effective <= 0) return 0;
  // Log curve against a 70B ceiling — matches the llmfit Score column rough
  // distribution where 4B≈60, 8B≈70, 14B≈78, 32B≈85, 70B≈92, 122B≈96.
  const raw = 40 + 18 * Math.log2(Math.max(0.5, effective));
  return Math.max(10, Math.min(100, Math.round(raw)));
}

/** Params (B) parsed out of the repo id; returns null when not detected. */
export function parseParamsB(repo_id: string): { totalB: number; activeB: number | null } | null {
  const id = repo_id.toLowerCase();
  // MoE form like "qwen3-coder-30b-a3b" — total/active.
  const moe = id.match(/(\d+(?:\.\d+)?)\s*b[-_]?a(\d+(?:\.\d+)?)b/);
  if (moe) {
    const total = parseFloat(moe[1]);
    const active = parseFloat(moe[2]);
    if (isFinite(total) && isFinite(active)) return { totalB: total, activeB: active };
  }
  const m = id.match(/(\d+(?:\.\d+)?)\s*b(?![a-z])/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!isFinite(n) || n <= 0) return null;
  return { totalB: n, activeB: null };
}

/** Estimated memory usage % against the host's usable budget. Capped at 999
 * so we can surface "won't fit" as a loud number without overflowing the UI. */
export function memoryUsagePct(model: OvoModel, sys: SystemInfo | null): number | null {
  const est = estimateModelBytes(model);
  if (est === null || !sys) return null;
  const usable = usableBytes(sys);
  if (usable <= 0) return null;
  return Math.min(999, Math.round((est / usable) * 100));
}
// [END]


// [START] Phase 5 — Model tier classification.
// OVO's local-MLX story lives or dies on tool-use reliability. Big Qwen3 /
// Llama-3.1+ class models nail <tool_use> formatting out of the box; small
// Gemma variants and 4B-class models routinely hallucinate the wrapper or
// drop the call entirely. Surfacing a tier badge in the Fit pane sets
// expectations upfront — users pick "Supported" when they want something
// that Just Works, or opt into "Experimental" knowing what they're signing
// up for.

export type ModelTier = "supported" | "experimental" | "unknown";

export interface TierInfo {
  tier: ModelTier;
  /** i18n key for the short badge label. */
  labelKey: string;
  /** i18n key for the hover tooltip explaining why. */
  reasonKey: string;
}

/** Classify a model by repo_id / params into an OVO-support tier.
 * Kept as a keyword heuristic (no curated allow-list) so new releases
 * flow through automatically as long as they share naming conventions
 * with the generation that earned their tier. */
export function classifyModelTier(model: OvoModel): TierInfo {
  const id = (model.repo_id ?? "").toLowerCase();

  // Parameter-count parse — mirrors parseParamsB so the two stay in sync.
  const params = parseParamsB(id);
  const effectiveB = params?.activeB ?? params?.totalB ?? 0;

  // Supported — big, tool-use-trained families with strong real-world
  // track record on OVO. Ordered narrowest → broadest so a 4B Qwen-Coder
  // (which IS supported) doesn't get misclassified by a generic size cut.
  if (/qwen3(?:\.\d)?|qwen2\.5-coder|qwen[-_]?3[-_]?coder/.test(id)) {
    return {
      tier: "supported",
      labelKey: "models.fit.tier_badge.supported",
      reasonKey: "models.fit.tier_badge.reason.supported_qwen",
    };
  }
  if (/(?:^|[-_/])llama[-_]?(?:3\.(?:1|2|3|4|5|6|7|8|9)|[4-9])/.test(id)) {
    return {
      tier: "supported",
      labelKey: "models.fit.tier_badge.supported",
      reasonKey: "models.fit.tier_badge.reason.supported_llama",
    };
  }
  if (/deepseek[-_]?(?:coder|r1|v\d)/.test(id)) {
    return {
      tier: "supported",
      labelKey: "models.fit.tier_badge.supported",
      reasonKey: "models.fit.tier_badge.reason.supported_deepseek",
    };
  }
  if (/minimax|mixtral|mistral[-_]?(?:large|medium|[7-9])/.test(id)) {
    return {
      tier: "supported",
      labelKey: "models.fit.tier_badge.supported",
      reasonKey: "models.fit.tier_badge.reason.supported_mistral",
    };
  }

  // Experimental — known to misbehave on tool use / self-talk discipline.
  if (/gemma|phi-?[1-3]|tinyllama|stablelm|gpt2/.test(id)) {
    return {
      tier: "experimental",
      labelKey: "models.fit.tier_badge.experimental",
      reasonKey: "models.fit.tier_badge.reason.experimental_small",
    };
  }

  // Size fallback — very small models (<4B effective) are too likely to
  // fumble structured output even if the family is otherwise supported.
  if (effectiveB > 0 && effectiveB < 4) {
    return {
      tier: "experimental",
      labelKey: "models.fit.tier_badge.experimental",
      reasonKey: "models.fit.tier_badge.reason.experimental_size",
    };
  }

  return {
    tier: "unknown",
    labelKey: "models.fit.tier_badge.unknown",
    reasonKey: "models.fit.tier_badge.reason.unknown",
  };
}
// [END]


// [START] formatBytes — GB / TB rounding for UI chrome.
export function formatBytes(bytes: number): string {
  if (!isFinite(bytes) || bytes <= 0) return "—";
  const gb = bytes / 1024 ** 3;
  if (gb < 1) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  if (gb < 100) return `${gb.toFixed(1)} GB`;
  if (gb >= 1024) return `${(gb / 1024).toFixed(2)} TB`;
  return `${gb.toFixed(0)} GB`;
}
// [END]
// [END] Phase 8
