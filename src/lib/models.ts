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
  const repo = m.repo_id.toLowerCase();
  return !NON_CHAT_KEYWORDS.some((kw) => repo.includes(kw));
}
// [END]
