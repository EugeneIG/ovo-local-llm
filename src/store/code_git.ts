// [START] Phase 8.2 — Git state Zustand store
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

interface GitStatusFile {
  path: string;
  status: string;
  staged: boolean;
}

interface GitLogEntry {
  hash: string;
  short_hash: string;
  message: string;
  author: string;
  date: string;
}

interface GitBranch {
  name: string;
  is_current: boolean;
  is_remote: boolean;
}

interface CodeGitState {
  branch: string;
  ahead: number;
  behind: number;
  files: GitStatusFile[];
  log: GitLogEntry[];
  branches: GitBranch[];
  loading: boolean;
  error: string | null;

  refresh: (projectRoot: string) => Promise<void>;
  refreshLog: (projectRoot: string) => Promise<void>;
  refreshBranches: (projectRoot: string) => Promise<void>;
  stage: (projectRoot: string, path: string) => Promise<void>;
  unstage: (projectRoot: string, path: string) => Promise<void>;
  commit: (projectRoot: string, message: string) => Promise<string>;
  checkout: (projectRoot: string, branch: string) => Promise<void>;
  getDiff: (projectRoot: string, path?: string, staged?: boolean) => Promise<string>;
  reset: () => void;
}

export const useCodeGitStore = create<CodeGitState>((set, get) => ({
  branch: "",
  ahead: 0,
  behind: 0,
  files: [],
  log: [],
  branches: [],
  loading: false,
  error: null,

  refresh: async (projectRoot) => {
    set({ loading: true, error: null });
    try {
      const result = await invoke<{
        branch: string;
        ahead: number;
        behind: number;
        files: GitStatusFile[];
      }>("git_status", { projectRoot });
      set({
        branch: result.branch,
        ahead: result.ahead,
        behind: result.behind,
        files: result.files,
        loading: false,
      });
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  refreshLog: async (projectRoot) => {
    try {
      const log = await invoke<GitLogEntry[]>("git_log", {
        projectRoot,
        limit: 50,
      });
      set({ log });
    } catch {
      // ignore — might not be a git repo
    }
  },

  refreshBranches: async (projectRoot) => {
    try {
      const branches = await invoke<GitBranch[]>("git_branch_list", {
        projectRoot,
      });
      set({ branches });
    } catch {
      // ignore
    }
  },

  stage: async (projectRoot, path) => {
    await invoke("git_stage", { projectRoot, path });
    await get().refresh(projectRoot);
  },

  unstage: async (projectRoot, path) => {
    await invoke("git_unstage", { projectRoot, path });
    await get().refresh(projectRoot);
  },

  commit: async (projectRoot, message) => {
    const hash = await invoke<string>("git_commit", {
      projectRoot,
      message,
    });
    await get().refresh(projectRoot);
    await get().refreshLog(projectRoot);
    return hash;
  },

  checkout: async (projectRoot, branch) => {
    await invoke("git_checkout", { projectRoot, branch });
    await get().refresh(projectRoot);
    await get().refreshBranches(projectRoot);
  },

  getDiff: async (projectRoot, path, staged) => {
    return await invoke<string>("git_diff", {
      projectRoot,
      path: path ?? null,
      staged: staged ?? false,
    });
  },

  reset: () => {
    set({
      branch: "",
      ahead: 0,
      behind: 0,
      files: [],
      log: [],
      branches: [],
      loading: false,
      error: null,
    });
  },
}));
// [END] Phase 8.2
