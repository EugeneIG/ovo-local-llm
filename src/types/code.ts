// [START] Phase 8 — Code IDE type definitions

export interface CodeSession {
  id: string;
  title: string;
  project_path: string;
  open_files: string[];
  active_file: string | null;
  model_ref: string | null;
  pinned: boolean;
  created_at: number;
  updated_at: number;
}

export interface FileTreeNode {
  path: string;
  name: string;
  is_dir: boolean;
  size_bytes: number;
  modified_at: number;
  children?: FileTreeNode[];
}

export interface OpenTab {
  path: string;
  name: string;
  language: string;
  modified: boolean;
  content: string;
  savedContent: string;
}

export interface CodeAgentMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "system" | "tool_result";
  content: string;
  attachments: CodeAttachment[] | null;
  created_at: number;
}

// [START] Phase 8 — Agent todo tracker.
// The agent calls `todo_write` with a fresh snapshot of its plan whenever
// it wants to show / update progress. In-memory only — todos belong to
// the active turn, not the session history.
export type AgentTodoStatus = "pending" | "in_progress" | "completed";

export interface AgentTodoItem {
  content: string;
  status: AgentTodoStatus;
}
// [END]

export type CodeAttachment =
  | { kind: "image"; id: string; dataUrl: string }
  | { kind: "file_ref"; id: string; path: string };

// File extension → Monaco language ID mapping
export const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  less: "less",
  md: "markdown",
  markdown: "markdown",
  py: "python",
  rs: "rust",
  toml: "toml",
  yaml: "yaml",
  yml: "yaml",
  xml: "xml",
  svg: "xml",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  sql: "sql",
  go: "go",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  cpp: "cpp",
  h: "c",
  hpp: "cpp",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  lua: "lua",
  r: "r",
  dart: "dart",
  dockerfile: "dockerfile",
  makefile: "makefile",
  graphql: "graphql",
  gql: "graphql",
  vue: "html",
  svelte: "html",
};

export function detectLanguage(filename: string): string {
  const lower = filename.toLowerCase();
  // Handle dotfiles with no extension
  if (lower === "dockerfile") return "dockerfile";
  if (lower === "makefile") return "makefile";
  if (lower === ".gitignore" || lower === ".env") return "plaintext";

  const ext = lower.split(".").pop() ?? "";
  return EXT_TO_LANGUAGE[ext] ?? "plaintext";
}
// [END] Phase 8
