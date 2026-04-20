// [START] Phase 6.2b — built-in MCP server presets.
// One-click "quick add" templates. Each preset is a minimal McpServerConfig
// skeleton; `args_template` can contain tokens that the UI fills in on add:
//   - {project_path} → current Project Context folder from useProjectContextStore
//   - {home} → user home dir (already known via default_project_path)

import i18n from "../i18n";

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

export function getMcpPresets(): ReadonlyArray<McpPreset> {
  const t = i18n.t;
  return [
    {
      id: "filesystem",
      name: `📁 ${t("mcp_presets.filesystem_name", "Filesystem")}`,
      description: t("mcp_presets.filesystem_desc", "Project folder read/write (Anthropic official)"),
      command: "npx",
      args_template: [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "{project_path}",
      ],
      env: {},
      requires: ["project_path"],
    },
    // [START] Phase 6.4 — `@modelcontextprotocol/server-memory` preset removed.
    // OVO built-in `memory_search` / `memory_add` / `memory_list` / `memory_delete`
    // tools provide the same role via Wiki FTS5 backend. (See BUILTIN_TOOLS.)
    // [END]
    {
      id: "sequential-thinking",
      name: `🌀 Sequential Thinking`,
      description: t("mcp_presets.sequential_desc", "Complex reasoning step decomposition tool"),
      command: "npx",
      args_template: [
        "-y",
        "@modelcontextprotocol/server-sequential-thinking",
      ],
      env: {},
    },
    {
      id: "context7",
      name: `📚 Context7`,
      description: t("mcp_presets.context7_desc", "Latest library docs lookup (Upstash)"),
      command: "npx",
      args_template: ["-y", "@upstash/context7-mcp@latest"],
      env: {},
    },
    {
      id: "playwright",
      name: `🎭 Playwright`,
      description: t("mcp_presets.playwright_desc", "Open pages, click, fill forms, screenshots via real browser (no keys needed)"),
      command: "npx",
      args_template: ["-y", "@playwright/mcp@latest"],
      env: {},
    },
    {
      id: "brave-search",
      name: `🔍 ${t("mcp_presets.brave_name", "Brave Search")}`,
      description: t("mcp_presets.brave_desc", "Web search (Anthropic official, BRAVE_API_KEY required)"),
      command: "npx",
      args_template: ["-y", "@modelcontextprotocol/server-brave-search"],
      env: { BRAVE_API_KEY: "" },
    },
  ];
}

// [START] Keep backward compat for any code importing MCP_PRESETS directly
export const MCP_PRESETS: ReadonlyArray<McpPreset> = getMcpPresets();
// [END]

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
