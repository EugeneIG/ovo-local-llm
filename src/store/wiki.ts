// [START] Phase 6.3 — Wiki store: thin Zustand wrapper over db/wiki.ts.
// The store holds the full page list for the library UI; retrieval for
// system-prompt injection uses searchWikiPages() directly (no need to cache
// per-query results in-memory).
//
// Phase 8: archive flag + project namespace exposed in the UI. New pages
// inherit the current project_path so they stay scoped; archived pages are
// hidden from the default list and from chat retrieval.

import { create } from "zustand";
import {
  archiveWikiPage,
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
// [START] Phase 6.4 — embedding persistence for semantic search
import { upsertWikiEmbedding } from "../db/embeddings";
import { embedTexts } from "../lib/embeddings";
// [END]
import { useProjectContextStore } from "./project_context";

// [START] Phase 6.4 — fire-and-forget re-embed. Silently skips when the sidecar
// is unavailable (501 / refused connection) so the wiki UI remains usable
// even without the optional dependency. Body longer than 2000 chars is
// truncated — keeps the vector representative of the skimmed content without
// blowing up the encoder on large pages.
function reembedPage(page: WikiPage): void {
  const text = `${page.title}\n\n${page.content.slice(0, 2000)}`.trim();
  if (!text) return;
  void (async () => {
    try {
      const result = await embedTexts([text]);
      if (!result || result.embeddings.length === 0) return;
      await upsertWikiEmbedding(page.id, result.embeddings[0], result.model);
    } catch {
      /* embedding is best-effort — swallow */
    }
  })();
}
// [END]

interface WikiStoreState {
  pages: WikiPage[];
  loaded: boolean;
  showArchived: boolean;
  load: () => Promise<void>;
  create: (input: CreateWikiPageInput) => Promise<WikiPage>;
  update: (id: string, patch: UpdateWikiPageInput) => Promise<void>;
  archive: (id: string, archived: boolean) => Promise<void>;
  remove: (id: string) => Promise<void>;
  reload: () => Promise<void>;
  search: (query: string, limit?: number) => Promise<WikiPage[]>;
  setShowArchived: (v: boolean) => Promise<void>;
}

function currentProjectPath(): string | null {
  return useProjectContextStore.getState().project_path;
}

export const useWikiStore = create<WikiStoreState>((set, get) => ({
  pages: [],
  loaded: false,
  showArchived: false,

  load: async () => {
    if (get().loaded) return;
    const pages = await listWikiPages({ includeArchived: get().showArchived });
    set({ pages, loaded: true });
  },

  reload: async () => {
    const pages = await listWikiPages({ includeArchived: get().showArchived });
    set({ pages, loaded: true });
  },

  create: async (input) => {
    const enriched: CreateWikiPageInput = {
      ...input,
      project_path: input.project_path ?? currentProjectPath(),
    };
    const page = await createWikiPage(enriched);
    const fresh = (await getWikiPage(page.id)) ?? page;
    set((s) => ({ pages: [fresh, ...s.pages] }));
    reembedPage(fresh);
    return fresh;
  },

  update: async (id, patch) => {
    await updateWikiPage(id, patch);
    const fresh = await getWikiPage(id);
    if (!fresh) return;
    set((s) => ({
      pages: s.pages.map((p) => (p.id === id ? fresh : p)),
    }));
    if (patch.title !== undefined || patch.content !== undefined) {
      reembedPage(fresh);
    }
  },

  archive: async (id, archived) => {
    await archiveWikiPage(id, archived);
    // Refresh list — archived pages may need to drop out of view depending
    // on the current showArchived toggle.
    await get().reload();
  },

  remove: async (id) => {
    await deleteWikiPage(id);
    set((s) => ({ pages: s.pages.filter((p) => p.id !== id) }));
  },

  search: (query, limit) =>
    searchWikiPages(query, { limit, includeArchived: get().showArchived }),

  setShowArchived: async (v) => {
    set({ showArchived: v });
    await get().reload();
  },
}));
// [END]
