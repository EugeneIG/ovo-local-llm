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
  // [START] Phase 6.4 — `@modelcontextprotocol/server-memory` 프리셋 제거.
  // OVO 내장 `memory_search` / `memory_add` / `memory_list` / `memory_delete`
  // 도구가 동일한 역할을 Wiki FTS5 백엔드로 제공한다. (BUILTIN_TOOLS 참고.)
  // 외부 프로세스 없이 영속 지식을 다루게 되어 서브프로세스 공급망 노출도 줄어든다.
  // [END]
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
  {
    id: "playwright",
    name: "🎭 Playwright",
    description: "실제 브라우저로 페이지 열기·클릭·폼 입력·스크린샷 (키 불필요, 웹 자동화/리서치 강력)",
    command: "npx",
    args_template: ["-y", "@playwright/mcp@latest"],
    env: {},
  },
  {
    id: "brave-search",
    name: "🔍 Brave 검색",
    description: "웹 검색 (Anthropic 공식, BRAVE_API_KEY 필요)",
    command: "npx",
    args_template: ["-y", "@modelcontextprotocol/server-brave-search"],
    env: { BRAVE_API_KEY: "" },
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
