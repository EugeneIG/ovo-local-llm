// [START] Phase 8.3 — Project-wide search panel
import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Search, FileText, CaseSensitive } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

interface SearchMatch {
  path: string;
  line_number: number;
  line_content: string;
}

interface SearchPanelProps {
  projectRoot: string;
  onOpenFile: (path: string) => void;
  // [START] Phase 5 — monotonically-bumped key that signals "focus me again".
  // CodePane increments this on Cmd+Shift+F so the input refocuses even if
  // the user already had the search panel open but clicked elsewhere.
  focusKey?: number;
  // [END]
}

export function SearchPanel({ projectRoot, onOpenFile, focusKey }: SearchPanelProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [results, setResults] = useState<SearchMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchDone, setSearchDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // [START] Phase 5 — focus input on mount and whenever focusKey bumps.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusKey]);
  // [END]

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    setSearching(true);
    setSearchDone(false);
    try {
      const matches = await invoke<SearchMatch[]>("code_fs_search", {
        projectRoot,
        pattern: query,
        caseSensitive,
      });
      setResults(matches);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
      setSearchDone(true);
    }
  }, [query, caseSensitive, projectRoot]);

  // Group results by file
  const grouped = results.reduce<Record<string, SearchMatch[]>>((acc, m) => {
    if (!acc[m.path]) acc[m.path] = [];
    acc[m.path].push(m);
    return acc;
  }, {});
  const fileCount = Object.keys(grouped).length;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-ovo-border shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-ovo-muted">
          {t("code.search.title")}
        </span>
      </div>

      {/* Search input */}
      <div className="px-2 py-2 border-b border-ovo-border shrink-0">
        <div className="flex items-center gap-1">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleSearch();
            }}
            placeholder={t("code.search.placeholder")}
            className="flex-1 text-xs px-2 py-1.5 rounded bg-ovo-bg border border-ovo-border text-ovo-text placeholder:text-ovo-muted focus:outline-none focus:ring-1 focus:ring-ovo-accent"
          />
          <button
            type="button"
            onClick={() => setCaseSensitive((v) => !v)}
            className={`p-1 rounded transition ${
              caseSensitive ? "bg-ovo-accent text-ovo-accent-ink" : "text-ovo-muted hover:text-ovo-text hover:bg-ovo-surface-solid"
            }`}
            title={t("code.search.match_case")}
          >
            <CaseSensitive className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => void handleSearch()}
            disabled={searching || !query.trim()}
            className="p-1 rounded text-ovo-muted hover:text-ovo-text hover:bg-ovo-surface-solid disabled:opacity-40 transition"
          >
            <Search className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Result count */}
        {searchDone && (
          <div className="text-[10px] text-ovo-muted mt-1 px-1">
            {results.length > 0
              ? t("code.search.results", { count: results.length, files: fileCount })
              : t("code.search.no_results")}
          </div>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {Object.entries(grouped).map(([filePath, matches]) => (
          <div key={filePath}>
            <button
              type="button"
              onClick={() => onOpenFile(filePath)}
              className="w-full flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-ovo-text hover:bg-ovo-surface-solid"
            >
              <FileText className="w-3 h-3 text-ovo-muted shrink-0" />
              <span className="truncate">{filePath}</span>
              <span className="text-[10px] text-ovo-muted ml-auto shrink-0">{matches.length}</span>
            </button>
            {matches.map((m, i) => (
              <button
                key={`${m.path}-${m.line_number}-${i}`}
                type="button"
                onClick={() => onOpenFile(m.path)}
                className="w-full text-left px-6 py-0.5 text-[11px] text-ovo-muted hover:bg-ovo-surface-solid truncate"
              >
                <span className="text-ovo-accent font-mono mr-1.5">{m.line_number}</span>
                <span>{m.line_content.trim()}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
// [END] Phase 8.3
