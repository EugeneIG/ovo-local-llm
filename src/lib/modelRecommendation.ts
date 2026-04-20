import type { ChatAttachment, ModelCapability, OvoModel } from "../types/ovo";
import type { ModelPerfAgg } from "../store/model_perf";
import { classifyModelTier } from "./modelFit";

// [START] Phase 8 — Local model recommendation.
// Cheap heuristic: classify the user's draft prompt + attachments into a
// "task profile" (e.g. needs vision / has code / wants speed / long-context),
// then score every available chat-capable model against that profile blended
// with per-model perf stats. Picks the highest-score model that's strictly
// better than the currently-selected one — otherwise returns null so the UI
// stays quiet.
//
// Pure / sync; no sidecar round-trips. The prompt analyzer is intentionally
// rough — the goal is to nudge users toward an obviously-better fit, not to
// dispatch optimally.

export interface PromptProfile {
  needsVision: boolean;
  needsAudio: boolean;
  hasCode: boolean;
  charCount: number;
  /** Rough estimate: 1 token ≈ 3.5 chars (mixed Korean/English) */
  approxTokens: number;
  /** "speed" hint — short single-line prompts. */
  isShort: boolean;
  /** Translation-style request keywords detected. */
  isTranslate: boolean;
}

const TRANSLATE_KEYWORDS = [
  "번역",
  "translate",
  "translation",
  "번역해",
  "한글로",
  "영어로",
  "translate to",
  "translate into",
];

const CODE_KEYWORDS = [
  "function",
  "class",
  "const",
  "import",
  "export",
  "return",
  "async",
  "await",
  "TypeError",
  "Error:",
  "Traceback",
  "코드",
  "리팩토링",
  "리뷰",
  "버그",
  "디버그",
];

export function analyzePrompt(text: string, attachments: ChatAttachment[]): PromptProfile {
  const trimmed = text.trim();
  const charCount = trimmed.length;
  const lower = trimmed.toLowerCase();

  const hasImage = attachments.some((a) => {
    if (a.kind === "url") return /^data:image\//.test(a.url);
    if (a.kind === "stored") return a.meta.mime?.startsWith("image/") ?? false;
    if (a.kind === "file") return a.file?.type.startsWith("image/") ?? false;
    return false;
  });
  const hasAudio = attachments.some((a) => {
    if (a.kind === "stored") return a.meta.mime?.startsWith("audio/") ?? false;
    if (a.kind === "file") return a.file?.type.startsWith("audio/") ?? false;
    return false;
  });

  const hasCode =
    /```/.test(trimmed) ||
    CODE_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));

  const isTranslate = TRANSLATE_KEYWORDS.some((kw) => lower.includes(kw));

  return {
    needsVision: hasImage,
    needsAudio: hasAudio,
    hasCode,
    charCount,
    approxTokens: Math.ceil(charCount / 3.5),
    isShort: charCount > 0 && charCount < 60 && !trimmed.includes("\n"),
    isTranslate,
  };
}

interface CandidateScore {
  model: OvoModel;
  score: number;
  reasons: string[];
}

function caps(model: OvoModel): Set<ModelCapability> {
  return new Set(model.capabilities ?? []);
}

function isChatCapable(model: OvoModel): boolean {
  const c = caps(model);
  // Anything that's not pure image_gen counts as a chat target — text-only,
  // vision, or audio. Image-gen-only models live in their own slot.
  return c.has("text") || c.has("vision") || c.has("audio");
}

function isCode(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n.includes("code") ||
    n.includes("coder") ||
    n.includes("starcoder") ||
    n.includes("deepseek") ||
    n.includes("qwen") && n.includes("coder")
  );
}

function isFastTier(name: string): boolean {
  const n = name.toLowerCase();
  // 1B–4B class often = fast; conservative match
  return /(\b|-)(1\.?[0-9]?b|2\.?[0-9]?b|3\.?[0-9]?b|4\.?[0-9]?b|mini|small|tiny|haiku)(\b|-)/i.test(n);
}

function scoreModel(
  model: OvoModel,
  profile: PromptProfile,
  perf: ModelPerfAgg | null,
): CandidateScore {
  const reasons: string[] = [];
  let score = 0;
  const c = caps(model);
  const repo = model.repo_id;

  // Vision/audio gating — hard requirements
  if (profile.needsVision) {
    if (!c.has("vision")) return { model, score: -Infinity, reasons: ["no vision"] };
    score += 30;
    reasons.push("vision");
  }
  if (profile.needsAudio) {
    if (!c.has("audio")) return { model, score: -Infinity, reasons: ["no audio"] };
    score += 30;
    reasons.push("audio");
  }

  // Code affinity
  if (profile.hasCode && isCode(repo)) {
    score += 18;
    reasons.push("code");
  } else if (profile.hasCode) {
    // Penalize pure-vision/non-coder models slightly when prompt is code
    if (c.has("vision") && !c.has("text")) score -= 5;
  }

  // Speed bias for short / casual prompts
  if (profile.isShort && isFastTier(repo)) {
    score += 12;
    reasons.push("fast");
  }

  // Long-context bias when prompt is heavy
  if (profile.approxTokens > 4000) {
    const ctx = model.max_context ?? 0;
    if (ctx >= 32000) {
      score += 12;
      reasons.push("long-ctx");
    } else if (ctx > 0 && ctx < 8000) {
      score -= 8;
    }
  }

  // Translation prompts → favor models with broader multilingual hints
  if (profile.isTranslate) {
    if (/qwen|llama|mistral|gemma/i.test(repo)) {
      score += 6;
      reasons.push("multilingual");
    }
  }

  // Perf shaping: faster TPS bumps the score modestly (capped contribution)
  if (perf && perf.runs >= 2 && perf.avg_tokens_per_sec > 0) {
    const tpsBoost = Math.min(perf.avg_tokens_per_sec / 50, 1) * 6;
    score += tpsBoost;
    if (perf.avg_tokens_per_sec >= 30) reasons.push(`${perf.avg_tokens_per_sec.toFixed(0)} tps`);
  }

  // Recently-used models get a small stickiness bonus so the user isn't
  // bounced around on every keystroke
  if (perf?.last_used_at) {
    const ageDays = (Date.now() - perf.last_used_at) / (24 * 60 * 60 * 1000);
    if (ageDays < 1) score += 3;
  }

  // [START] Phase 5 — OVO tier weighting.
  // Supported models earn a meaningful lift so the recommender surfaces
  // them ahead of similarly-sized experimental alternatives. Experimental
  // tier gets a small drag to dampen false-positive recommendations when
  // a Gemma-variant happens to score well on raw params alone.
  const tier = classifyModelTier(model);
  if (tier.tier === "supported") {
    score += 12;
    reasons.push("supported");
  } else if (tier.tier === "experimental") {
    score -= 6;
  }
  // [END]

  return { model, score, reasons };
}

export interface RecommendationResult {
  model: OvoModel;
  score: number;
  reasons: string[];
  /** Score margin above the currently-selected model (positive only). */
  margin: number;
}

const MIN_MARGIN = 8; // suppress noisy switches

export function recommendModel(input: {
  prompt: string;
  attachments: ChatAttachment[];
  models: OvoModel[];
  currentModelRef: string | null;
  perfStats: Record<string, ModelPerfAgg>;
}): RecommendationResult | null {
  const profile = analyzePrompt(input.prompt, input.attachments);

  // Don't bother for trivial inputs
  if (profile.charCount < 4 && input.attachments.length === 0) return null;

  const candidates = input.models
    .filter(isChatCapable)
    .map((m) => scoreModel(m, profile, input.perfStats[m.repo_id] ?? null))
    .filter((c) => c.score !== -Infinity);

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);

  const best = candidates[0];
  const current = candidates.find((c) => c.model.repo_id === input.currentModelRef);
  const margin = current ? best.score - current.score : best.score;

  if (best.model.repo_id === input.currentModelRef) return null;
  if (margin < MIN_MARGIN) return null;

  return {
    model: best.model,
    score: best.score,
    reasons: best.reasons,
    margin,
  };
}
// [END]
