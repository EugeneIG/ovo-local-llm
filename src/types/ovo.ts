export type ModelSource = "hf" | "lmstudio";

/**
 * MLX quantization config as it appears in HuggingFace config.json.
 * The sidecar forwards it verbatim — may be a structured object OR a legacy
 * string ("q4", "q8_0"), so consumers must handle both shapes.
 */
export interface QuantizationConfig {
  group_size?: number;
  bits?: number;
  mode?: string;
}

// [START] Phase 7 — `image_gen` capability surfaces text-to-image diffusion
// pipelines. Detected server-side via model_index.json::_class_name; the UI
// filters these OUT of chat/code selectors and filters them IN in the Image
// tab's model picker.
export type ModelCapability = "text" | "vision" | "audio" | "image_gen";
// [END]

export interface OvoModel {
  repo_id: string;
  revision: string;
  snapshot_path: string;
  size_bytes: number;
  is_mlx: boolean;
  model_type?: string | null;
  architecture?: string | string[] | null;
  quantization?: QuantizationConfig | string | null;
  hidden_size?: number | null;
  source: ModelSource;
  capabilities: ModelCapability[];
  max_context?: number | null;
}

// [START] Phase A — StoredAttachmentMeta re-exported from attachmentStorage for DB layer use.
export type { StoredAttachmentMeta } from "../lib/attachmentStorage";
import type { StoredAttachmentMeta } from "../lib/attachmentStorage";

export type ChatAttachment =
  | { kind: "file"; id: string; file: File; previewDataUrl: string | null; saved?: StoredAttachmentMeta }
  | { kind: "url"; id: string; url: string }
  | { kind: "stored"; id: string; meta: StoredAttachmentMeta };
// [END]

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  attachments?: ChatAttachment[];
}

export interface OvoSettings {
  language: "ko" | "en";
  theme: "system" | "light" | "dark";
  default_model?: string;
  ollama_port: number;
  openai_port: number;
  expose_to_network: boolean;
  claude_integration_enabled: boolean;
  pet_enabled: boolean;
}

export interface OvoModelsResponse {
  models: OvoModel[];
  count: number;
  cache_dirs: { hf: string; lmstudio: string };
}

// [START] Phase R — session + message + per-model context override types.
// Mirror the SQLite schema (see src-tauri/migrations/001_init.sql). All
// timestamps are epoch milliseconds. Booleans are surfaced as 0/1 at the
// DB layer and translated to actual booleans in the TypeScript shape.

export type CompactStrategy = "auto" | "manual" | "warn_only";
export type MessageRole = "user" | "assistant" | "system" | "summary";

export interface Session {
  id: string;
  title: string;
  model_ref: string | null;
  system_prompt: string | null;
  compact_strategy: CompactStrategy;
  pinned: boolean;
  context_tokens: number;
  compacting: boolean;
  // [START] Phase 8 — fork lineage. NULL for root sessions; otherwise points
  // at the session/message we forked from (one-shot, no further mutation).
  parent_session_id: string | null;
  parent_message_id: string | null;
  // [END]
  created_at: number;
  updated_at: number;
}

export interface Message {
  id: string;
  session_id: string;
  role: MessageRole;
  content: string;
  attachments: ChatAttachment[] | null;
  prompt_tokens: number | null;
  generation_tokens: number | null;
  compacted: boolean;
  created_at: number;
}

export interface ModelContextOverride {
  repo_id: string;
  max_context: number;
  warn_threshold: number;
  updated_at: number;
}
// [END]
