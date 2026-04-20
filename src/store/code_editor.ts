// [START] Phase 8 — Code editor Zustand store
// Central state for file tree, open tabs, and editor configuration.
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { FileTreeNode, OpenTab } from "../types/code";
import { detectLanguage } from "../types/code";
import { updateCodeSessionFiles } from "../db/code_sessions";
import { useCodeSessionsStore } from "./code_sessions";

// [START] Phase 8 — EditorSelection shape. Snapshot of whatever the user
// currently has highlighted in Monaco, surfaced so the Agent Chat can show
// a "3 lines selected" chip and (later) inject the snippet into the system
// prompt of the next turn. Null while nothing is selected.
export interface EditorSelection {
  path: string;
  startLine: number;
  endLine: number;
  text: string;
}
// [END]

interface CodeEditorState {
  projectPath: string | null;
  fileTree: FileTreeNode[];
  openTabs: OpenTab[];
  activeTabPath: string | null;
  expandedDirs: Set<string>;
  loading: boolean;
  editorSelection: EditorSelection | null;

  // Actions
  pickFolder: () => Promise<string | null>;
  setProjectPath: (path: string) => Promise<void>;
  refreshTree: () => Promise<void>;
  openFile: (relativePath: string) => Promise<void>;
  closeTab: (path: string) => void;
  closeAllTabs: () => void;
  setActiveTab: (path: string | null) => void;
  updateTabContent: (path: string, content: string) => void;
  saveFile: (path: string) => Promise<void>;
  saveAllFiles: () => Promise<void>;
  createFile: (relativePath: string) => Promise<void>;
  createFolder: (relativePath: string) => Promise<void>;
  renameItem: (from: string, to: string) => Promise<void>;
  deleteItem: (relativePath: string, force?: boolean) => Promise<void>;
  toggleDir: (path: string) => void;
  setEditorSelection: (sel: EditorSelection | null) => void;
  reset: () => void;
  _persistTabs: () => Promise<void>;
}

const MAX_TABS = 20;

export const useCodeEditorStore = create<CodeEditorState>((set, get) => ({
  projectPath: null,
  fileTree: [],
  openTabs: [],
  activeTabPath: null,
  expandedDirs: new Set<string>(),
  loading: false,
  editorSelection: null,

  pickFolder: async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      return selected;
    }
    return null;
  },

  setProjectPath: async (path) => {
    set({ projectPath: path, fileTree: [], openTabs: [], activeTabPath: null, expandedDirs: new Set() });
    await get().refreshTree();
  },

  refreshTree: async () => {
    const { projectPath } = get();
    if (!projectPath) return;
    set({ loading: true });
    try {
      const tree = await invoke<FileTreeNode[]>("code_fs_list_tree", {
        projectRoot: projectPath,
      });
      set({ fileTree: tree, loading: false });
    } catch (e) {
      console.error("code_fs_list_tree failed:", e);
      set({ loading: false });
    }
  },

  openFile: async (relativePath) => {
    const { projectPath, openTabs } = get();
    if (!projectPath) return;

    // Already open? Just activate.
    const existing = openTabs.find((t) => t.path === relativePath);
    if (existing) {
      set({ activeTabPath: relativePath });
      return;
    }

    // Read file content
    try {
      const result = await invoke<{ path: string; content: string; size_bytes: number; encoding: string }>(
        "code_fs_read_file",
        { projectRoot: projectPath, path: relativePath },
      );

      const name = relativePath.split("/").pop() ?? relativePath;
      const language = detectLanguage(name);

      const newTab: OpenTab = {
        path: relativePath,
        name,
        language,
        modified: false,
        content: result.content,
        savedContent: result.content,
      };

      // Enforce tab limit — close oldest non-dirty tab via LRU
      let tabs = [...openTabs, newTab];
      if (tabs.length > MAX_TABS) {
        const evictable = tabs.find((t) => !t.modified && t.path !== relativePath);
        if (evictable) {
          tabs = tabs.filter((t) => t.path !== evictable.path);
        }
      }

      set({ openTabs: tabs, activeTabPath: relativePath });
      void get()._persistTabs();
    } catch (e) {
      console.error("code_fs_read_file failed:", e);
    }
  },

  closeTab: (path) => {
    const { openTabs, activeTabPath } = get();
    const idx = openTabs.findIndex((t) => t.path === path);
    if (idx === -1) return;

    const newTabs = openTabs.filter((t) => t.path !== path);
    let newActive = activeTabPath;
    if (activeTabPath === path) {
      // Activate adjacent tab
      if (newTabs.length > 0) {
        newActive = newTabs[Math.min(idx, newTabs.length - 1)].path;
      } else {
        newActive = null;
      }
    }
    set({ openTabs: newTabs, activeTabPath: newActive });
    void get()._persistTabs();
  },

  closeAllTabs: () => {
    set({ openTabs: [], activeTabPath: null });
    void get()._persistTabs();
  },

  setActiveTab: (path) => {
    set({ activeTabPath: path });
  },

  updateTabContent: (path, content) => {
    set((s) => ({
      openTabs: s.openTabs.map((t) =>
        t.path === path
          ? { ...t, content, modified: content !== t.savedContent }
          : t,
      ),
    }));
  },

  saveFile: async (path) => {
    const { projectPath, openTabs } = get();
    if (!projectPath) return;
    const tab = openTabs.find((t) => t.path === path);
    if (!tab) return;

    try {
      await invoke("code_fs_write_file", {
        projectRoot: projectPath,
        path,
        content: tab.content,
      });
      set((s) => ({
        openTabs: s.openTabs.map((t) =>
          t.path === path
            ? { ...t, modified: false, savedContent: tab.content }
            : t,
        ),
      }));
    } catch (e) {
      console.error("code_fs_write_file failed:", e);
    }
  },

  saveAllFiles: async () => {
    const { openTabs } = get();
    const dirtyTabs = openTabs.filter((t) => t.modified);
    for (const tab of dirtyTabs) {
      await get().saveFile(tab.path);
    }
  },

  createFile: async (relativePath) => {
    const { projectPath } = get();
    if (!projectPath) return;
    try {
      await invoke("code_fs_create_file", {
        projectRoot: projectPath,
        path: relativePath,
      });
      await get().refreshTree();
      await get().openFile(relativePath);
    } catch (e) {
      console.error("code_fs_create_file failed:", e);
    }
  },

  createFolder: async (relativePath) => {
    const { projectPath } = get();
    if (!projectPath) return;
    try {
      await invoke("code_fs_mkdir", {
        projectRoot: projectPath,
        path: relativePath,
      });
      await get().refreshTree();
    } catch (e) {
      console.error("code_fs_mkdir failed:", e);
    }
  },

  renameItem: async (from, to) => {
    const { projectPath } = get();
    if (!projectPath) return;
    try {
      await invoke("code_fs_rename", {
        projectRoot: projectPath,
        from,
        to,
      });
      // Update tab paths if the renamed item was open
      set((s) => ({
        openTabs: s.openTabs.map((t) => {
          if (t.path === from || t.path.startsWith(from + "/")) {
            const newPath = to + t.path.slice(from.length);
            const newName = newPath.split("/").pop() ?? newPath;
            return { ...t, path: newPath, name: newName, language: detectLanguage(newName) };
          }
          return t;
        }),
        activeTabPath:
          s.activeTabPath === from ? to : s.activeTabPath,
      }));
      await get().refreshTree();
    } catch (e) {
      console.error("code_fs_rename failed:", e);
    }
  },

  deleteItem: async (relativePath, force) => {
    const { projectPath } = get();
    if (!projectPath) return;
    try {
      await invoke("code_fs_delete", {
        projectRoot: projectPath,
        path: relativePath,
        force: force ?? false,
      });
      // Close tab if open
      get().closeTab(relativePath);
      await get().refreshTree();
    } catch (e) {
      console.error("code_fs_delete failed:", e);
    }
  },

  toggleDir: (path) => {
    set((s) => {
      const next = new Set(s.expandedDirs);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return { expandedDirs: next };
    });
  },

  setEditorSelection: (sel) => {
    set({ editorSelection: sel });
  },

  reset: () => {
    set({
      editorSelection: null,
      projectPath: null,
      fileTree: [],
      openTabs: [],
      activeTabPath: null,
      expandedDirs: new Set(),
      loading: false,
    });
  },

  // Internal: persist open tabs to the current code session DB row
  _persistTabs: async () => {
    const { openTabs, activeTabPath } = get();
    const sessionId = useCodeSessionsStore.getState().currentSessionId;
    if (!sessionId) return;
    try {
      await updateCodeSessionFiles(
        sessionId,
        openTabs.map((t) => t.path),
        activeTabPath,
      );
    } catch {
      // best-effort
    }
  },
}));
// [END] Phase 8
