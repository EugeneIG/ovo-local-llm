// [START] Phase 6.2a — MCP Zustand store.
// Persists server configs to localStorage under "ovo:mcp_servers".
// Runtime status (running/tools/error) is keyed by server_id and NOT persisted.

import { create } from "zustand";
import { mcpStart, mcpStop, mcpList } from "../lib/mcp";
import type { McpServerConfig, McpServerStatus, McpTool } from "../lib/mcp";

export type { McpServerConfig, McpTool, McpServerStatus };

const LS_KEY = "ovo:mcp_servers";

// ── Persistence helpers ───────────────────────────────────────────────────────

function readConfigs(): McpServerConfig[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as McpServerConfig[];
  } catch {
    return [];
  }
}

function writeConfigs(configs: McpServerConfig[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(configs));
  } catch {
    // storage unavailable — silent
  }
}

// ── Store interface ───────────────────────────────────────────────────────────

interface McpStoreState {
  servers: McpServerConfig[];
  status: Record<string, McpServerStatus>;

  /** Hydrate configs from localStorage, then start any servers that were previously running. */
  load(): void;
  /** Add a new server config and start it immediately. */
  addServer(cfg: Omit<McpServerConfig, "server_id">): Promise<void>;
  /** Stop (if running) and remove a server config. */
  removeServer(server_id: string): Promise<void>;
  /** Start a configured server (idempotent if already running). */
  startServer(server_id: string): Promise<void>;
  /** Stop a running server. */
  stopServer(server_id: string): Promise<void>;
  /** Refresh runtime status from Rust for all tracked servers. */
  refreshStatus(): Promise<void>;
  /** Flattened tool list across all currently running servers. */
  getAllTools(): McpTool[];
}

// ── Store implementation ──────────────────────────────────────────────────────

export const useMcpStore = create<McpStoreState>((set, get) => ({
  servers: [],
  status: {},

  // [START] load — hydrate from localStorage
  load() {
    const configs = readConfigs();
    set({ servers: configs });
    // Refresh runtime status from Rust (servers started in a previous session
    // are not auto-restarted — Rust state is ephemeral across app restarts).
    void get().refreshStatus();
  },
  // [END]

  // [START] addServer — assign UUID, persist, then start
  async addServer(cfg) {
    const server_id = crypto.randomUUID();
    const full: McpServerConfig = { ...cfg, server_id };
    const next = [...get().servers, full];
    set({ servers: next });
    writeConfigs(next);
    await get().startServer(server_id);
  },
  // [END]

  // [START] removeServer — stop if running, then remove from list
  async removeServer(server_id) {
    const { status } = get();
    if (status[server_id]?.running) {
      await get().stopServer(server_id);
    }
    const next = get().servers.filter((s) => s.server_id !== server_id);
    set((s) => {
      const nextStatus = { ...s.status };
      delete nextStatus[server_id];
      return { servers: next, status: nextStatus };
    });
    writeConfigs(next);
  },
  // [END]

  // [START] startServer — invoke mcp_start and store returned tools in status
  async startServer(server_id) {
    const cfg = get().servers.find((s) => s.server_id === server_id);
    if (!cfg) return;

    // Optimistically mark as starting (no error, no tools yet)
    set((s) => ({
      status: {
        ...s.status,
        [server_id]: {
          server_id,
          command: cfg.command,
          running: false,
          tools: [],
          error: undefined,
        },
      },
    }));

    try {
      const tools = await mcpStart(cfg);
      set((s) => ({
        status: {
          ...s.status,
          [server_id]: {
            server_id,
            command: cfg.command,
            running: true,
            tools,
            error: undefined,
          },
        },
      }));
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      set((s) => ({
        status: {
          ...s.status,
          [server_id]: {
            server_id,
            command: cfg.command,
            running: false,
            tools: [],
            error: errMsg,
          },
        },
      }));
    }
  },
  // [END]

  // [START] stopServer — invoke mcp_stop and update status
  async stopServer(server_id) {
    try {
      await mcpStop(server_id);
    } catch {
      // best-effort
    }
    set((s) => {
      const prev = s.status[server_id];
      if (!prev) return {};
      return {
        status: {
          ...s.status,
          [server_id]: { ...prev, running: false, tools: [] },
        },
      };
    });
  },
  // [END]

  // [START] refreshStatus — pull live status from Rust for all servers
  async refreshStatus() {
    try {
      const list = await mcpList();
      const next: Record<string, McpServerStatus> = {};
      for (const entry of list) {
        next[entry.server_id] = entry;
      }
      set({ status: next });
    } catch (e) {
      console.warn("mcp: refreshStatus failed", e);
    }
  },
  // [END]

  // [START] getAllTools — flat list of tools from all running servers
  getAllTools() {
    const { status } = get();
    return Object.values(status)
      .filter((s) => s.running)
      .flatMap((s) => s.tools);
  },
  // [END]
}));
// [END] Phase 6.2a
