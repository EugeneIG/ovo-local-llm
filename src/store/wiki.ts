// [START] Phase 6.3 — Wiki store: thin Zustand wrapper over db/wiki.ts.
// The store holds the full page list for the library UI; retrieval for
// system-prompt injection uses searchWikiPages() directly (no need to cache
// per-query results in-memory).

import { create } from "zustand";
import {
  createWikiPage,
  deleteWikiPage,
  getWikiPage,
  listWikiPages,
  searchWikiPages,
  updateWikiPage,
  type CreateWikiPageInput,
  type UpdateWikiPageInput,
  type WikiPage,
} from "../db/wiki";

interface WikiStoreState {
  pages: WikiPage[];
  loaded: boolean;
  load: () => Promise<void>;
  create: (input: CreateWikiPageInput) => Promise<WikiPage>;
  update: (id: string, patch: UpdateWikiPageInput) => Promise<void>;
  remove: (id: string) => Promise<void>;
  reload: () => Promise<void>;
  search: (query: string, limit?: number) => Promise<WikiPage[]>;
}

export const useWikiStore = create<WikiStoreState>((set, get) => ({
  pages: [],
  loaded: false,

  load: async () => {
    if (get().loaded) return;
    const pages = await listWikiPages();
    set({ pages, loaded: true });
  },

  reload: async () => {
    const pages = await listWikiPages();
    set({ pages, loaded: true });
  },

  create: async (input) => {
    const page = await createWikiPage(input);
    // Re-fetch via getWikiPage to avoid ordering drift with DB state.
    const fresh = (await getWikiPage(page.id)) ?? page;
    set((s) => ({ pages: [fresh, ...s.pages] }));
    return fresh;
  },

  update: async (id, patch) => {
    await updateWikiPage(id, patch);
    const fresh = await getWikiPage(id);
    if (!fresh) return;
    set((s) => ({
      pages: s.pages.map((p) => (p.id === id ? fresh : p)),
    }));
  },

  remove: async (id) => {
    await deleteWikiPage(id);
    set((s) => ({ pages: s.pages.filter((p) => p.id !== id) }));
  },

  search: (query, limit) => searchWikiPages(query, limit),
}));
// [END]
