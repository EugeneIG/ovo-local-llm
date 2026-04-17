export type ModelSource = "hf" | "lmstudio";

export interface OvoModel {
  repo_id: string;
  revision: string;
  snapshot_path: string;
  size_bytes: number;
  is_mlx: boolean;
  model_type?: string | null;
  architecture?: string | null;
  quantization?: string | null;
  hidden_size?: number | null;
  source: ModelSource;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
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
