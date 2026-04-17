// [START] Phase 6.2a — MCP frontend client.
// Thin invoke() wrappers — all transport logic lives in Rust (src-tauri/src/mcp.rs).
// No Node.js child_process; Rust owns the subprocess pipes.

import { invoke } from "@tauri-apps/api/core";

// ── Shared types ──────────────────────────────────────────────────────────────

export interface McpServerConfig {
  server_id: string; // frontend-generated UUID (crypto.randomUUID())
  name: string; // user-visible label
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface McpTool {
  name: string;
  description?: string;
  input_schema: unknown; // JSON Schema — kept loose; narrow at call site
}

export interface McpServerStatus {
  server_id: string;
  command: string;
  running: boolean;
  tools: McpTool[];
  error?: string;
}

// ── Invoke wrappers ───────────────────────────────────────────────────────────

/**
 * Spawn an MCP server and run the initialize + tools/list handshake.
 * Returns the list of tools exposed by the server.
 */
export async function mcpStart(cfg: McpServerConfig): Promise<McpTool[]> {
  return invoke<McpTool[]>("mcp_start", {
    serverId: cfg.server_id,
    command: cfg.command,
    args: cfg.args,
    env: cfg.env,
  });
}

/**
 * Call a tool on a running MCP server.
 * Returns the `content` field of the JSON-RPC response.
 */
export async function mcpCall(
  server_id: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  return invoke<unknown>("mcp_call", {
    serverId: server_id,
    tool,
    arguments: args,
  });
}

/**
 * Kill a running MCP server and remove it from the pool.
 */
export async function mcpStop(server_id: string): Promise<void> {
  await invoke<void>("mcp_stop", { serverId: server_id });
}

/**
 * Return runtime status for all tracked MCP servers.
 */
export async function mcpList(): Promise<McpServerStatus[]> {
  return invoke<McpServerStatus[]>("mcp_list");
}
// [END] Phase 6.2a
