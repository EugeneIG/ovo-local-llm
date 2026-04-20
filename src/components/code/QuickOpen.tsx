// [START] Phase 5 — Cmd+P Quick Open.
// Fuzzy file picker modal. Built on top of the already-loaded file tree
// (no extra Rust round-trip) so the list is always in sync with what's
// in the explorer. Case-insensitive subsequence fuzzy match — good
// enough for "userv" → "src/pages/UserView.tsx" style matching without
// pulling in a dependency.
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Search } from "lucide-react";
import type { FileTreeNode } from "../../types/code";

interface QuickOpenProps {
  tree: FileTreeNode[];
  onPick: (relativePath: string) => void;
  onClose: () => void;
}

interface ScoredItem {
  path: string;
  name: string;
  score: number;
  matchedIndices: number[];
}

// Flatten the tree into leaf file rows. Directories are skipped — Quick
// Open is for jumping to files.
function flattenFiles(tree: FileTreeNode[]): Array<{ path: string; name: string }> {
  const out: Array<{ path: string; name: string }> = [];
  const walk = (nodes: FileTreeNode[]) => {
    for (const n of nodes) {
      if (n.is_dir) {
        if (n.children && n.children.length > 0) walk(n.children);
      } else {
        out.push({ path: n.path, name: n.name });
      }
    }
  };
  walk(tree);
  return out;
}

// Subsequence fuzzy match. Returns score + matched indices inside `haystack`
// (path) for highlighting, or null when `needle` isn't a subsequence.
// Scoring rewards consecutive hits, prefix hits on path segments, and hits
// on the filename (last segment) so "main" > "main.ts" > "src/main/utils.ts".
function fuzzyScore(needle: string, path: string, name: string): {
  score: number;
  indices: number[];
} | null {
  if (needle.length === 0) {
    return { score: 1, indices: [] };
  }
  const hay = path.toLowerCase();
  const n = needle.toLowerCase();
  const indices: number[] = [];
  let score = 0;
  let lastHit = -2;
  let ni = 0;
  for (let i = 0; i < hay.length && ni < n.length; i++) {
    if (hay[i] === n[ni]) {
      indices.push(i);
      // Consecutive-character bonus.
      if (i === lastHit + 1) score += 15;
      else score += 1;
      // Segment-boundary bonus (after `/` or at index 0).
      if (i === 0 || hay[i - 1] === "/" || hay[i - 1] === ".") score += 8;
      lastHit = i;
      ni++;
    }
  }
  if (ni < n.length) return null;

  // Filename-match bonus — if the needle matches contiguously inside the
  // filename (not scattered across directories) we add a big lift.
  const lowerName = name.toLowerCase();
  const nameIdx = lowerName.indexOf(n);
  if (nameIdx !== -1) score += 40 + (nameIdx === 0 ? 20 : 0);

  // Shorter paths tiebreak higher.
  score -= Math.floor(path.length / 10);

  return { score, indices };
}

export function QuickOpen({ tree, onPick, onClose }: QuickOpenProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus the input immediately on mount.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const allFiles = useMemo(() => flattenFiles(tree), [tree]);

  const results = useMemo<ScoredItem[]>(() => {
    const q = query.trim();
    if (q.length === 0) {
      // Show first N files alphabetically so empty query isn't empty UI.
      return allFiles
        .slice()
        .sort((a, b) => a.path.localeCompare(b.path))
        .slice(0, 50)
        .map((f) => ({ path: f.path, name: f.name, score: 0, matchedIndices: [] }));
    }
    const scored: ScoredItem[] = [];
    for (const f of allFiles) {
      const r = fuzzyScore(q, f.path, f.name);
      if (r !== null) {
        scored.push({ path: f.path, name: f.name, score: r.score, matchedIndices: r.indices });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 50);
  }, [allFiles, query]);

  // Clamp selected index when the result list shrinks.
  useEffect(() => {
    if (selectedIdx >= results.length) setSelectedIdx(Math.max(0, results.length - 1));
  }, [results, selectedIdx]);

  // Keep the active row in view as the user navigates with arrows.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${selectedIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const picked = results[selectedIdx];
      if (picked) onPick(picked.path);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-[560px] max-w-[90vw] bg-ovo-surface border border-ovo-border rounded-lg shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-ovo-border">
          <Search className="w-4 h-4 text-ovo-muted shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIdx(0);
            }}
            onKeyDown={handleKey}
            placeholder={t("code.quick_open.placeholder")}
            className="flex-1 bg-transparent text-sm text-ovo-text placeholder:text-ovo-muted focus:outline-none"
          />
          <span className="text-[10px] text-ovo-muted shrink-0">
            {results.length > 0
              ? t("code.quick_open.count", { n: results.length })
              : t("code.quick_open.no_results")}
          </span>
        </div>

        <div ref={listRef} className="max-h-[50vh] overflow-y-auto">
          {results.length === 0 && (
            <div className="px-3 py-6 text-xs text-ovo-muted text-center">
              {query.trim().length === 0
                ? t("code.quick_open.empty_tree")
                : t("code.quick_open.no_results")}
            </div>
          )}
          {results.map((r, i) => (
            <button
              key={r.path}
              type="button"
              data-idx={i}
              onClick={() => onPick(r.path)}
              onMouseEnter={() => setSelectedIdx(i)}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition ${
                i === selectedIdx
                  ? "bg-ovo-accent/20 text-ovo-text"
                  : "text-ovo-muted hover:bg-ovo-surface-solid"
              }`}
            >
              <FileText className="w-3.5 h-3.5 shrink-0 text-ovo-muted" />
              <span className="truncate flex-1">
                <span className="text-ovo-text font-medium">{r.name}</span>
                {r.path !== r.name && (
                  <span className="ml-2 text-ovo-muted">{r.path}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
// [END] Phase 5
