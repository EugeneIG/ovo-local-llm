import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { X, RefreshCw, FileWarning } from "lucide-react";
import { lintWiki, type LintCategory, type LintIssue } from "../db/wiki";

// [START] Phase 8 — Wiki Lint modal.
// Triggered from the WikiPane sidebar; surfaces hygiene issues across the
// catalog (orphan / stale / oversized / duplicate) so the user can curate.
// Click an issue row to jump to that page in the editor.

interface Props {
  open: boolean;
  onClose: () => void;
  onJump: (pageId: string) => void;
}

const CATEGORY_META: Record<LintCategory, { emoji: string; tone: string }> = {
  orphan: { emoji: "🪂", tone: "text-violet-500" },
  stale: { emoji: "🥀", tone: "text-amber-500" },
  oversized: { emoji: "🐘", tone: "text-rose-500" },
  duplicate: { emoji: "👯", tone: "text-sky-500" },
};

export function WikiLintModal({ open, onClose, onJump }: Props) {
  const { t } = useTranslation();
  const [issues, setIssues] = useState<LintIssue[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<LintCategory | "all">("all");

  async function runLint() {
    setLoading(true);
    setError(null);
    try {
      const result = await lintWiki();
      setIssues(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setIssues([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open && issues === null) void runLint();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => {
    const c: Record<LintCategory | "all", number> = {
      all: issues?.length ?? 0,
      orphan: 0,
      stale: 0,
      oversized: 0,
      duplicate: 0,
    };
    for (const i of issues ?? []) c[i.category]++;
    return c;
  }, [issues]);

  const visible = useMemo(() => {
    if (!issues) return [];
    if (activeFilter === "all") return issues;
    return issues.filter((i) => i.category === activeFilter);
  }, [issues, activeFilter]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-6"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="bg-ovo-surface-solid rounded-lg border border-ovo-border shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-2 px-4 py-3 border-b border-ovo-border">
          <FileWarning className="w-4 h-4 text-amber-500 shrink-0" aria-hidden />
          <h2 className="text-sm font-semibold text-ovo-text flex-1">
            {t("wiki.lint.title")}
          </h2>
          <button
            type="button"
            onClick={() => void runLint()}
            disabled={loading}
            title={t("wiki.lint.rerun")}
            className="p-1.5 rounded text-ovo-muted hover:text-ovo-text hover:bg-ovo-bg/40 transition disabled:opacity-40"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded text-ovo-muted hover:text-ovo-text hover:bg-ovo-bg/40 transition"
            aria-label={t("common.close")}
          >
            <X className="w-4 h-4" aria-hidden />
          </button>
        </header>

        {/* Filter pills */}
        <div className="px-4 py-2 border-b border-ovo-border flex items-center gap-1.5 flex-wrap">
          {(["all", "orphan", "stale", "oversized", "duplicate"] as const).map((cat) => {
            const isActive = activeFilter === cat;
            const c = counts[cat];
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveFilter(cat)}
                className={`text-[11px] px-2 py-0.5 rounded-full border transition ${
                  isActive
                    ? "bg-ovo-accent text-ovo-accent-ink border-ovo-accent"
                    : "bg-ovo-chip text-ovo-muted border-ovo-border hover:text-ovo-text"
                }`}
              >
                {cat === "all"
                  ? t("wiki.lint.filter_all")
                  : `${CATEGORY_META[cat].emoji} ${t(`wiki.lint.cat_${cat}`)}`}
                <span className="ml-1 font-mono tabular-nums">{c}</span>
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-2">
          {error && (
            <p className="px-3 py-2 text-xs text-rose-500">
              {t("wiki.lint.error", { error })}
            </p>
          )}
          {!error && loading && issues === null && (
            <p className="px-3 py-6 text-center text-xs text-ovo-muted">
              {t("common.loading")}
            </p>
          )}
          {!error && issues !== null && visible.length === 0 && (
            <p className="px-3 py-8 text-center text-xs text-ovo-muted/70 italic">
              {issues.length === 0
                ? t("wiki.lint.empty_clean")
                : t("wiki.lint.empty_filter")}
            </p>
          )}
          <ul className="flex flex-col">
            {visible.map((issue, i) => {
              const meta = CATEGORY_META[issue.category];
              return (
                <li key={`${issue.page_id}-${issue.category}-${i}`}>
                  <button
                    type="button"
                    onClick={() => {
                      onJump(issue.page_id);
                      onClose();
                    }}
                    className="w-full text-left px-3 py-2 rounded hover:bg-ovo-bg/50 transition flex items-start gap-2"
                  >
                    <span className={`text-base ${meta.tone} shrink-0`} aria-hidden>
                      {meta.emoji}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-ovo-text font-medium truncate">
                        {issue.page_title || issue.page_slug}
                      </div>
                      <div className="text-[11px] text-ovo-muted mt-0.5 truncate">
                        {t(`wiki.lint.cat_${issue.category}`)} · {issue.detail}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
// [END] Phase 8
