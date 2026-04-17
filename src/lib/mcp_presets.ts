// [START] Phase 6.2b — built-in MCP server presets.
// One-click "quick add" templates. Each preset is a minimal McpServerConfig
// skeleton; `args_template` can contain tokens that the UI fills in on add:
//   - {project_path} → current Project Context folder from useProjectContextStore
//   - {home} → user home dir (already known via default_project_path)

export interface McpPreset {
  id: string;          // stable identifier ("filesystem", "memory", …)
  name: string;        // user-visible default name
  description: string;
  command: string;
  args_template: string[];
  env: Record<string, string>;
  // Tokens in args_template that need user-side substitution.
  // If a preset uses {project_path} and the user has no project set,
  // the UI should prompt or disable the button.
  requires?: Array<"project_path">;
}

export const MCP_PRESETS: ReadonlyArray<McpPreset> = [
  {
    id: "filesystem",
    name: "📁 파일시스템",
    description: "프로젝트 폴더 읽기/쓰기 (Anthropic 공식)",
    command: "npx",
    args_template: [
      "-y",
      "@modelcontextprotocol/server-filesystem",
      "{project_path}",
    ],
    env: {},
    requires: ["project_path"],
  },
  {
    id: "memory",
    name: "🧠 메모리",
    description: "영속 key-value 메모리 (Wiki 연계 예정)",
    command: "npx",
    args_template: ["-y", "@modelcontextprotocol/server-memory"],
    env: {},
  },
  {
    id: "sequential-thinking",
    name: "🌀 Sequential Thinking",
    description: "복잡한 사고 단계 분해 도구",
    command: "npx",
    args_template: [
      "-y",
      "@modelcontextprotocol/server-sequential-thinking",
    ],
    env: {},
  },
  {
    id: "context7",
    name: "📚 Context7",
    description: "최신 라이브러리 문서 조회 (Upstash)",
    command: "npx",
    args_template: ["-y", "@upstash/context7-mcp@latest"],
    env: {},
  },
];

export function expandArgs(
  template: string[],
  substitutions: { project_path: string | null },
): string[] {
  return template.map((arg) =>
    arg
      .replace("{project_path}", substitutions.project_path ?? "")
      .replace("{home}", ""),
  );
}
// [END]
