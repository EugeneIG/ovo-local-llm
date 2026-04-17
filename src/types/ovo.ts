export interface OvoModel {
  repo_id: string;
  revision: string;
  size_bytes: number;
  is_mlx: boolean;
  quantization?: string;
  context_length?: number;
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
