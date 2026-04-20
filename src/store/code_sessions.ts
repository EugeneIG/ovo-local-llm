// [START] Phase 8 — Code sessions Zustand store
import { create } from "zustand";
import type { CodeSession } from "../types/code";
import {
  listCodeSessions,
  createCodeSession,
  renameCodeSession,
  deleteCodeSession,
  toggleCodeSessionPinned,
} from "../db/code_sessions";

interface CodeSessionsState {
  sessions: CodeSession[];
  currentSessionId: string | null;
  loading: boolean;
  searchQuery: string;

  load: () => Promise<void>;
  selectSession: (id: string | null) => void;
  createSession: (projectPath: string, title?: string) => Promise<CodeSession>;
  renameSession: (id: string, title: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  togglePinned: (id: string) => Promise<void>;
  setSearchQuery: (q: string) => void;
  reload: () => Promise<void>;
}

export const useCodeSessionsStore = create<CodeSessionsState>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  loading: false,
  searchQuery: "",

  load: async () => {
    set({ loading: true });
    try {
      const sessions = await listCodeSessions();
      set({ sessions, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  reload: async () => {
    try {
      const sessions = await listCodeSessions();
      set({ sessions });
    } catch {
      // ignore
    }
  },

  selectSession: (id) => {
    set({ currentSessionId: id });
  },

  createSession: async (projectPath, title) => {
    const session = await createCodeSession({
      project_path: projectPath,
      title,
    });
    set((s) => ({
      sessions: [session, ...s.sessions],
      currentSessionId: session.id,
    }));
    return session;
  },

  renameSession: async (id, title) => {
    await renameCodeSession(id, title);
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === id ? { ...sess, title } : sess,
      ),
    }));
  },

  deleteSession: async (id) => {
    await deleteCodeSession(id);
    const { currentSessionId } = get();
    set((s) => ({
      sessions: s.sessions.filter((sess) => sess.id !== id),
      currentSessionId: currentSessionId === id ? null : currentSessionId,
    }));
  },

  togglePinned: async (id) => {
    const sess = get().sessions.find((s) => s.id === id);
    if (!sess) return;
    const newPinned = !sess.pinned;
    await toggleCodeSessionPinned(id, newPinned);
    set((s) => ({
      sessions: s.sessions.map((se) =>
        se.id === id ? { ...se, pinned: newPinned } : se,
      ),
    }));
  },

  setSearchQuery: (q) => set({ searchQuery: q }),
}));
// [END] Phase 8
