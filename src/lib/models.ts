import type { OvoModel } from "../types/ovo";

// [START] Non-chat model types — TTS / STT / embedding-only models that
// CANNOT generate conversational text. They still appear in the global
// /ovo/models list (so users can manage them), but the chat ModelSelector
// filters them out so users don't accidentally pick e.g. a TTS model
// for a conversation.
const NON_CHAT_MODEL_TYPES: ReadonlyArray<string> = [
  "qwen3_tts",
  "whisper",
  "distil-whisper",
  "parakeet",
  "asr",
  "embedding",
  "bert",
  "sentence-transformers",
  // [START] Phase 7 — diffusion pipelines are image-only
  "diffusion_pipeline",
  // [END]
];

const NON_CHAT_KEYWORDS: ReadonlyArray<string> = [
  "-tts",
  "_tts",
  "-stt",
  "_stt",
  "-asr",
  "whisper",
  "embedding",
  "embed-",
];

export function isChatCapableModel(m: OvoModel): boolean {
  const modelType = (m.model_type ?? "").toLowerCase();
  if (NON_CHAT_MODEL_TYPES.includes(modelType)) return false;
  // [START] Phase 7 — image_gen models are never chat-capable
  if (m.capabilities.includes("image_gen")) return false;
  // [END]
  const repo = m.repo_id.toLowerCase();
  return !NON_CHAT_KEYWORDS.some((kw) => repo.includes(kw));
}
// [END]

// [START] Phase 7 — image-gen model predicate. Surfaces a model in the Image
// tab's picker when the sidecar reports the `image_gen` capability OR the
// model_type is the diffusion synthetic marker we emit in hf_scanner.
export function isImageGenModel(m: OvoModel): boolean {
  if (m.capabilities.includes("image_gen")) return true;
  const modelType = (m.model_type ?? "").toLowerCase();
  return modelType === "diffusion_pipeline";
}
// [END]
