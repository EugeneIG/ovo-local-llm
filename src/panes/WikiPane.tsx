import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, Plus, Trash2, Pin, Search, Archive, ArchiveRestore, FileWarning, Link2 } from "lucide-react";
import { useWikiStore } from "../store/wiki";
import type { BacklinkHit, WikiPage, WikiTier } from "../db/wiki";
import { WIKI_TIERS, getBacklinks } from "../db/wiki";
import { WikiLintModal } from "../components/WikiLintModal";

// [START] Phase 8 — TagChipRow: editable tag chips below the editor header.
// `#snippet` here makes the page surface as a slash-command template too.
interface TagChipRowProps {
  page: WikiPage;
  onChange: (tags: string[]) => void;
}

function TagChipRow({ page, onChange }: TagChipRowProps) {
  const { t } = useTranslation();
  const [input, setInput] = useState("");

  function commit(raw: string) {
    const clean = raw
      .split(/[,\s]+/)
      .map((s) => s.trim().replace(/^#+/, "").toLowerCase())
      .filter((s) => s.length > 0 && s.length <= 32);
    if (clean.length === 0) return;
    const merged = Array.from(new Set([...page.tags, ...clean]));
    if (merged.length === page.tags.length) return;
    onChange(merged);
    setInput("");
  }

  function remove(tag: string) {
    onChange(page.tags.filter((x) => x !== tag));
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-4 py-2 border-b border-ovo-border bg-ovo-surface">
      {page.tags.length === 0 && (
        <span className="text-[11px] text-ovo-muted/70 italic mr-1">
          {t("wiki.tags.empty_hint")}
        </span>
      )}
      {page.tags.map((tag) => {
        const isSnippet = tag.toLowerCase() === "snippet";
        return (
          <span
            key={tag}
            className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full border transition ${
              isSnippet
                ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-600 dark:text-emerald-300"
                : "bg-ovo-chip border-ovo-border text-ovo-text"
            }`}
            title={isSnippet ? t("wiki.tags.snippet_hint") : undefined}
          >
            {isSnippet && <span aria-hidden>📋</span>}
            <span>#{tag}</span>
            <button
              type="button"
              onClick={() => remove(tag)}
              className="text-ovo-muted hover:text-rose-500 transition"
              aria-label={t("wiki.tags.remove", { tag })}
            >
              ×
            </button>
          </span>
        );
      })}
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit(input);
          } else if (e.key === "Backspace" && input === "" && page.tags.length > 0) {
            e.preventDefault();
            remove(page.tags[page.tags.length - 1]);
          }
        }}
        onBlur={() => {
          if (input.trim()) commit(input);
        }}
        placeholder={t("wiki.tags.add_placeholder")}
        className="flex-1 min-w-[120px] bg-transparent border-0 text-[12px] text-ovo-text placeholder:text-ovo-muted/50 focus:outline-none"
        maxLength={48}
      />
    </div>
  );
}
// [END]

// [START] Phase 6.4 — Wiki tier metadata (emoji + visual colour tokens).
// Canonical reads as the most trusted, casebook as distilled patterns, note
// as raw jot.
const TIER_META: Record<WikiTier, { emoji: string; dot: string }> = {
  note: { emoji: "📝", dot: "bg-neutral-400" },
  casebook: { emoji: "📚", dot: "bg-amber-400" },
  canonical: { emoji: "🏛", dot: "bg-emerald-400" },
};
// [END]

// [START] Phase 6.3 — WikiPane
// MVP knowledge library. Two-pane layout: list on the left, editor on the
// right. Search uses FTS5 under the hood (searchWikiPages in db/wiki.ts);
// empty query shows the full catalog, pinned first.

export function WikiPane() {
  const { t } = useTranslation();
  const pages = useWikiStore((s) => s.pages);
  const load = useWikiStore((s) => s.load);
  const create = useWikiStore((s) => s.create);
  const update = useWikiStore((s) => s.update);
  const remove = useWikiStore((s) => s.remove);
  const archive = useWikiStore((s) => s.archive);
  const search = useWikiStore((s) => s.search);
  const showArchived = useWikiStore((s) => s.showArchived);
  const setShowArchived = useWikiStore((s) => s.setShowArchived);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WikiPage[] | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // [START] Phase 8 — lint modal + backlinks panel state
  const [lintOpen, setLintOpen] = useState(false);
  const [backlinks, setBacklinks] = useState<BacklinkHit[]>([]);
  // [END]

  // [START] initial load
  useEffect(() => {
    void load();
  }, [load]);
  // [END]

  // [START] debounced FTS search — empty query clears results
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults(null);
      return;
    }
    const h = setTimeout(() => {
      void search(trimmed, 30).then(setResults);
    }, 200);
    return () => clearTimeout(h);
  }, [query, search]);
  // [END]

  const visible = results ?? pages;
  const selected = useMemo(
    () => visible.find((p) => p.id === selectedId) ?? pages.find((p) => p.id === selectedId) ?? null,
    [visible, pages, selectedId],
  );

  // [START] sync draft when selected page changes
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (selected) {
      setDraftTitle(selected.title);
      setDraftContent(selected.content);
    } else {
      setDraftTitle("");
      setDraftContent("");
    }
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // [END]

  // [START] Phase 8 — refresh backlinks when the selected page changes
  useEffect(() => {
    if (!selected) {
      setBacklinks([]);
      return;
    }
    let cancelled = false;
    void getBacklinks(selected.slug).then((hits) => {
      if (cancelled) return;
      // Filter out self-references
      setBacklinks(hits.filter((h) => h.page.id !== selected.id));
    });
    return () => {
      cancelled = true;
    };
  }, [selected?.id, selected?.slug]); // eslint-disable-line react-hooks/exhaustive-deps
  // [END]

  // [START] debounced auto-save of title/content edits
  useEffect(() => {
    if (!selected) return;
    if (draftTitle === selected.title && draftContent === selected.content) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void update(selected.id, { title: draftTitle, content: draftContent });
    }, 600);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [draftTitle, draftContent, selected, update]);
  // [END]

  const titleInputRef = useRef<HTMLInputElement>(null);

  async function handleCreate() {
    // Create a blank page immediately and focus the title input — avoids
    // window.prompt() which is unreliable in the Tauri webview, and matches
    // the Notion / Obsidian / Figma new-item UX.
    const page = await create({ title: t("wiki.untitled") });
    setSelectedId(page.id);
    // Focus the title input on the next paint after state has propagated.
    setTimeout(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }, 50);
  }

  async function handleDelete() {
    if (!selected) return;
    const ok = window.confirm(t("wiki.delete_confirm", { title: selected.title }));
    if (!ok) return;
    await remove(selected.id);
    setSelectedId(null);
  }

  async function togglePin() {
    if (!selected) return;
    await update(selected.id, { pinned: !selected.pinned });
  }

  async function toggleArchive() {
    if (!selected) return;
    await archive(selected.id, !selected.archived);
    if (!showArchived && !selected.archived) {
      // Archived page just dropped out of the visible list — clear selection
      setSelectedId(null);
    }
  }

  return (
    <div className="h-full flex">
      {/* [START] left column — search + page list */}
      <aside className="w-72 shrink-0 border-r border-ovo-border flex flex-col bg-ovo-surface">
        <div className="p-3 border-b border-ovo-border flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-ovo-muted" aria-hidden />
            <h2 className="text-sm font-semibold text-ovo-text flex-1">{t("wiki.title")}</h2>
            <button
              type="button"
              onClick={() => setLintOpen(true)}
              title={t("wiki.lint.button")}
              aria-label={t("wiki.lint.button")}
              className="p-1 rounded hover:bg-ovo-surface-solid text-ovo-muted hover:text-ovo-text transition"
            >
              <FileWarning className="w-4 h-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => void handleCreate()}
              title={t("wiki.new")}
              aria-label={t("wiki.new")}
              className="p-1 rounded hover:bg-ovo-surface-solid text-ovo-muted hover:text-ovo-text transition"
            >
              <Plus className="w-4 h-4" aria-hidden />
            </button>
          </div>
          <label className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-ovo-bg border border-ovo-border">
            <Search className="w-3.5 h-3.5 text-ovo-muted" aria-hidden />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("wiki.search_placeholder")}
              className="flex-1 bg-transparent border-0 text-xs text-ovo-text placeholder:text-ovo-muted/60 focus:outline-none"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[10px] text-ovo-muted cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => void setShowArchived(e.target.checked)}
              className="accent-ovo-accent"
            />
            <span>{t("wiki.show_archived")}</span>
          </label>
        </div>
        <ul className="flex-1 overflow-y-auto">
          {visible.length === 0 ? (
            <li className="px-4 py-6 text-center text-xs text-ovo-muted/70">
              {results !== null ? t("wiki.no_results") : t("wiki.empty")}
            </li>
          ) : (
            visible.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={`w-full text-left px-3 py-2 text-xs border-l-2 transition ${
                    selectedId === p.id
                      ? "bg-ovo-nav-active border-ovo-accent text-ovo-text"
                      : "border-transparent text-ovo-muted hover:bg-ovo-nav-active-hover hover:text-ovo-text"
                  } ${p.archived ? "opacity-50" : ""}`}
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className="shrink-0 text-[11px] leading-none"
                      title={t(`wiki.tier.${p.tier}`)}
                      aria-label={t(`wiki.tier.${p.tier}`)}
                    >
                      {TIER_META[p.tier].emoji}
                    </span>
                    {p.pinned && <Pin className="w-3 h-3 text-ovo-accent shrink-0" aria-hidden />}
                    {p.archived && (
                      <Archive className="w-3 h-3 text-amber-500 shrink-0" aria-hidden />
                    )}
                    <span className="font-medium truncate">{p.title || t("wiki.untitled")}</span>
                  </div>
                  {p.tags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {p.tags.slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          className="px-1 py-0.5 text-[9px] rounded bg-ovo-surface-solid text-ovo-muted"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      </aside>
      {/* [END] */}

      {/* [START] right column — editor */}
      <main className="flex-1 min-w-0 flex flex-col">
        {selected ? (
          <>
            <header className="flex items-center gap-2 px-4 py-3 border-b border-ovo-border">
              <input
                ref={titleInputRef}
                type="text"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder={t("wiki.untitled")}
                className="flex-1 bg-transparent border-0 text-base font-semibold text-ovo-text placeholder:text-ovo-muted/60 focus:outline-none"
              />
              {/* [START] Phase 6.4 — tier selector pills (note / casebook / canonical) */}
              <div
                role="radiogroup"
                aria-label={t("wiki.tier.label")}
                className="inline-flex items-center gap-0.5 p-0.5 rounded-full bg-ovo-surface-solid border border-ovo-border"
              >
                {WIKI_TIERS.map((tier) => {
                  const active = selected.tier === tier;
                  const meta = TIER_META[tier];
                  return (
                    <button
                      key={tier}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => void update(selected.id, { tier })}
                      title={t(`wiki.tier.${tier}_hint`)}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] transition ${
                        active
                          ? "bg-ovo-accent text-ovo-accent-ink"
                          : "text-ovo-muted hover:text-ovo-text hover:bg-ovo-bg"
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} aria-hidden />
                      <span>{t(`wiki.tier.${tier}`)}</span>
                    </button>
                  );
                })}
              </div>
              {/* [END] */}
              <button
                type="button"
                onClick={() => void togglePin()}
                title={selected.pinned ? t("wiki.unpin") : t("wiki.pin")}
                aria-label={selected.pinned ? t("wiki.unpin") : t("wiki.pin")}
                className={`p-1.5 rounded transition ${
                  selected.pinned
                    ? "text-ovo-accent bg-ovo-nav-active"
                    : "text-ovo-muted hover:text-ovo-text hover:bg-ovo-surface-solid"
                }`}
              >
                <Pin className="w-4 h-4" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => void toggleArchive()}
                title={selected.archived ? t("wiki.unarchive") : t("wiki.archive")}
                aria-label={selected.archived ? t("wiki.unarchive") : t("wiki.archive")}
                className={`p-1.5 rounded transition ${
                  selected.archived
                    ? "text-amber-500 bg-amber-500/10"
                    : "text-ovo-muted hover:text-ovo-text hover:bg-ovo-surface-solid"
                }`}
              >
                {selected.archived ? (
                  <ArchiveRestore className="w-4 h-4" aria-hidden />
                ) : (
                  <Archive className="w-4 h-4" aria-hidden />
                )}
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                title={t("wiki.delete")}
                aria-label={t("wiki.delete")}
                className="p-1.5 rounded text-ovo-muted hover:text-rose-500 hover:bg-rose-500/10 transition"
              >
                <Trash2 className="w-4 h-4" aria-hidden />
              </button>
            </header>
            <TagChipRow
              page={selected}
              onChange={(tags) => void update(selected.id, { tags })}
            />
            <textarea
              value={draftContent}
              onChange={(e) => setDraftContent(e.target.value)}
              placeholder={t("wiki.content_placeholder")}
              spellCheck={false}
              className="flex-1 w-full resize-none px-4 py-4 text-sm font-mono bg-ovo-bg text-ovo-text placeholder:text-ovo-muted/60 focus:outline-none leading-relaxed"
            />
            {backlinks.length > 0 && (
              <div className="px-4 py-2 border-t border-ovo-border bg-ovo-surface">
                <div className="flex items-center gap-1.5 text-[11px] text-ovo-muted mb-1">
                  <Link2 className="w-3 h-3" aria-hidden />
                  <span>
                    {t("wiki.backlinks.heading", { count: backlinks.length })}
                  </span>
                </div>
                <ul className="flex flex-wrap gap-1.5">
                  {backlinks.map(({ page, count }) => (
                    <li key={page.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(page.id)}
                        title={page.title}
                        className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full bg-ovo-chip border border-ovo-border text-ovo-text hover:bg-ovo-bg/40 transition truncate max-w-xs"
                      >
                        <span className="truncate">{page.title || page.slug}</span>
                        {count > 1 && (
                          <span className="text-[10px] font-mono tabular-nums text-ovo-muted">
                            ×{count}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <footer className="px-4 py-2 border-t border-ovo-border text-[11px] text-ovo-muted">
              {t("wiki.auto_saved", { slug: selected.slug })}
            </footer>
          </>
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-ovo-muted">
            <BookOpen className="w-10 h-10" aria-hidden />
            <p className="text-sm">{t("wiki.pick_page")}</p>
          </div>
        )}
      </main>
      {/* [END] */}

      {/* [START] Phase 8 — Wiki lint modal */}
      <WikiLintModal
        open={lintOpen}
        onClose={() => setLintOpen(false)}
        onJump={(id) => setSelectedId(id)}
      />
      {/* [END] */}
    </div>
  );
}
// [END]
