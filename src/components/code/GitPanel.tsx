// [START] Phase 8.2 — Git source control panel
import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  GitBranch,
  GitCommit,
  Plus,
  Minus,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  FileText,
} from "lucide-react";
import { useCodeGitStore } from "../../store/code_git";
import { useToastsStore } from "../../store/toasts";

interface GitPanelProps {
  projectRoot: string;
}

export function GitPanel({ projectRoot }: GitPanelProps) {
  const { t } = useTranslation();
  const branch = useCodeGitStore((s) => s.branch);
  const ahead = useCodeGitStore((s) => s.ahead);
  const behind = useCodeGitStore((s) => s.behind);
  const files = useCodeGitStore((s) => s.files);
  const loading = useCodeGitStore((s) => s.loading);
  const error = useCodeGitStore((s) => s.error);
  const refresh = useCodeGitStore((s) => s.refresh);
  const stage = useCodeGitStore((s) => s.stage);
  const unstage = useCodeGitStore((s) => s.unstage);
  const commit = useCodeGitStore((s) => s.commit);

  const [commitMsg, setCommitMsg] = useState("");
  const [stagedOpen, setStagedOpen] = useState(true);
  const [unstagedOpen, setUnstagedOpen] = useState(true);

  const stagedFiles = files.filter((f) => f.staged);
  const unstagedFiles = files.filter((f) => !f.staged);

  useEffect(() => {
    void refresh(projectRoot);
  }, [projectRoot, refresh]);

  const handleCommit = useCallback(async () => {
    if (!commitMsg.trim()) return;
    try {
      await commit(projectRoot, commitMsg.trim());
      setCommitMsg("");
      useToastsStore.getState().push({
        kind: "success",
        message: t("code.git.commit_success"),
      });
    } catch (e) {
      useToastsStore.getState().push({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [commitMsg, projectRoot, commit, t]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-ovo-border shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-ovo-muted">
          {t("code.git.title")}
        </span>
        <button
          type="button"
          onClick={() => void refresh(projectRoot)}
          className="p-0.5 rounded hover:bg-ovo-surface-solid text-ovo-muted hover:text-ovo-text transition"
          title={t("code.git.refresh")}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Branch info */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-ovo-border text-xs">
        <GitBranch className="w-3.5 h-3.5 text-ovo-accent" />
        <span className="font-medium text-ovo-text">{branch || "—"}</span>
        {ahead > 0 && <span className="text-emerald-500">↑{ahead}</span>}
        {behind > 0 && <span className="text-amber-500">↓{behind}</span>}
      </div>

      {/* Error */}
      {error && (
        <div className="px-3 py-1.5 text-[11px] text-rose-400">{error}</div>
      )}

      {/* Commit input */}
      <div className="px-2 py-2 border-b border-ovo-border shrink-0">
        <textarea
          value={commitMsg}
          onChange={(e) => setCommitMsg(e.target.value)}
          placeholder={t("code.git.commit_placeholder")}
          rows={2}
          className="w-full text-xs px-2 py-1.5 rounded bg-ovo-bg border border-ovo-border text-ovo-text placeholder:text-ovo-muted focus:outline-none focus:ring-1 focus:ring-ovo-accent resize-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              void handleCommit();
            }
          }}
        />
        <button
          type="button"
          onClick={() => void handleCommit()}
          disabled={!commitMsg.trim() || stagedFiles.length === 0}
          className="w-full mt-1 flex items-center justify-center gap-1.5 px-2 py-1 text-xs rounded bg-ovo-accent text-ovo-accent-ink hover:bg-ovo-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          <GitCommit className="w-3 h-3" />
          {t("code.git.commit")}
        </button>
      </div>

      {/* File lists */}
      <div className="flex-1 overflow-y-auto">
        {/* Staged */}
        <div>
          <button
            type="button"
            onClick={() => setStagedOpen((v) => !v)}
            className="w-full flex items-center gap-1 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-ovo-muted hover:bg-ovo-surface-solid"
          >
            {stagedOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            {t("code.git.staged")} ({stagedFiles.length})
          </button>
          {stagedOpen && stagedFiles.map((f) => (
            <div key={`s-${f.path}`} className="flex items-center gap-1.5 px-4 py-0.5 text-xs hover:bg-ovo-surface-solid group">
              <StatusBadge status={f.status} />
              <FileText className="w-3 h-3 text-ovo-muted shrink-0" />
              <span className="truncate flex-1 text-ovo-text">{f.path}</span>
              <button
                type="button"
                onClick={() => void unstage(projectRoot, f.path)}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-ovo-border text-ovo-muted"
                title={t("code.git.unstage")}
              >
                <Minus className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>

        {/* Unstaged */}
        <div>
          <button
            type="button"
            onClick={() => setUnstagedOpen((v) => !v)}
            className="w-full flex items-center gap-1 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-ovo-muted hover:bg-ovo-surface-solid"
          >
            {unstagedOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            {t("code.git.unstaged")} ({unstagedFiles.length})
          </button>
          {unstagedOpen && unstagedFiles.map((f) => (
            <div key={`u-${f.path}`} className="flex items-center gap-1.5 px-4 py-0.5 text-xs hover:bg-ovo-surface-solid group">
              <StatusBadge status={f.status} />
              <FileText className="w-3 h-3 text-ovo-muted shrink-0" />
              <span className="truncate flex-1 text-ovo-text">{f.path}</span>
              <button
                type="button"
                onClick={() => void stage(projectRoot, f.path)}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-ovo-border text-ovo-muted"
                title={t("code.git.stage")}
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>

        {files.length === 0 && !loading && (
          <p className="text-xs text-ovo-muted text-center py-4">
            {t("code.git.no_changes")}
          </p>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    M: "text-amber-400",
    A: "text-emerald-400",
    D: "text-rose-400",
    "?": "text-sky-400",
    R: "text-violet-400",
  };
  return (
    <span className={`text-[10px] font-mono font-bold w-3 shrink-0 ${colorMap[status] ?? "text-ovo-muted"}`}>
      {status}
    </span>
  );
}
// [END] Phase 8.2
