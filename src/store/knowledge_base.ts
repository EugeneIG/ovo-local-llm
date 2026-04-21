// [START] Knowledge Base store — manages KB list, active KB, RAG toggle.
import { create } from "zustand";
import {
  listKBs,
  createKB,
  deleteKB,
  getKB,
  ingestFiles,
  getIngestProgress,
  getParseStatus,
  installKordoc,
  type KnowledgeBase,
  type KBDetail,
  type IngestProgress,
  type KordocStatus,
} from "../lib/parsing";
import type { SidecarPorts } from "../types/sidecar";
import { DEFAULT_PORTS } from "../lib/api";

interface KBStoreState {
  kbs: KnowledgeBase[];
  activeKBIds: string[];
  kordocStatus: KordocStatus | null;
  installing: boolean;
  loading: boolean;

  refresh: (ports?: SidecarPorts) => Promise<void>;
  checkKordoc: (ports?: SidecarPorts) => Promise<KordocStatus>;
  installRuntime: (ports?: SidecarPorts) => Promise<boolean>;

  create: (name: string, ports?: SidecarPorts) => Promise<string>;
  remove: (kbId: string, ports?: SidecarPorts) => Promise<void>;
  getDetail: (kbId: string, ports?: SidecarPorts) => Promise<KBDetail>;

  ingest: (kbId: string, paths: string[], ports?: SidecarPorts) => Promise<string>;
  pollIngest: (kbId: string, taskId: string, ports?: SidecarPorts) => Promise<IngestProgress>;

  toggleActive: (kbId: string) => void;
  setActiveKBIds: (ids: string[]) => void;

  load: () => void;
}

const LS_KEY = "ovo-active-kb-ids";

export const useKBStore = create<KBStoreState>((set, get) => ({
  kbs: [],
  activeKBIds: [],
  kordocStatus: null,
  installing: false,
  loading: false,

  load: () => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) set({ activeKBIds: JSON.parse(raw) });
    } catch { /* ignore */ }
  },

  refresh: async (ports = DEFAULT_PORTS) => {
    set({ loading: true });
    try {
      const kbs = await listKBs(ports);
      set({ kbs, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  checkKordoc: async (ports = DEFAULT_PORTS) => {
    const status = await getParseStatus(ports);
    set({ kordocStatus: status });
    return status;
  },

  installRuntime: async (ports = DEFAULT_PORTS) => {
    set({ installing: true });
    try {
      const result = await installKordoc(ports);
      const status = await getParseStatus(ports);
      set({ kordocStatus: status, installing: false });
      return result.ready;
    } catch {
      set({ installing: false });
      return false;
    }
  },

  create: async (name, ports = DEFAULT_PORTS) => {
    const result = await createKB(name, ports);
    await get().refresh(ports);
    return result.kb_id;
  },

  remove: async (kbId, ports = DEFAULT_PORTS) => {
    await deleteKB(kbId, ports);
    set((s) => ({
      activeKBIds: s.activeKBIds.filter((id) => id !== kbId),
    }));
    await get().refresh(ports);
  },

  getDetail: async (kbId, ports = DEFAULT_PORTS) => {
    return getKB(kbId, ports);
  },

  ingest: async (kbId, paths, ports = DEFAULT_PORTS) => {
    const result = await ingestFiles(kbId, paths, true, ports);
    return result.task_id;
  },

  pollIngest: async (kbId, taskId, ports = DEFAULT_PORTS) => {
    return getIngestProgress(kbId, taskId, ports);
  },

  toggleActive: (kbId) => {
    set((s) => {
      const next = s.activeKBIds.includes(kbId)
        ? s.activeKBIds.filter((id) => id !== kbId)
        : [...s.activeKBIds, kbId];
      localStorage.setItem(LS_KEY, JSON.stringify(next));
      return { activeKBIds: next };
    });
  },

  setActiveKBIds: (ids) => {
    localStorage.setItem(LS_KEY, JSON.stringify(ids));
    set({ activeKBIds: ids });
  },
}));
// [END]
