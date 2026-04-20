import { useTranslation } from "react-i18next";
import { Download as DownloadIcon, Trash2, X } from "lucide-react";
import type { DownloadTask } from "../lib/api";

// [START] Phase 7 — Shared download-action cell.
// Used by the ImagePane catalog, the HF search panel, and the installed
// models list. Three states:
//   • already installed / task done   → ✓ 설치됨 + 🗑 삭제 버튼
//   • pending / downloading            → 퍼센트 바 + 취소 버튼
//   • idle                             → 다운로드 버튼

export function prettyBytes(n: number | null | undefined): string {
  if (!n || n <= 0) return "0B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)}${units[i]}`;
}

export interface DownloadCellProps {
  repoId: string;
  task: DownloadTask | undefined;
  already: boolean;
  onDownload: (repoId: string) => void | Promise<void>;
  onCancel: (task: DownloadTask) => void | Promise<void>;
  onDelete: (repoId: string) => void | Promise<void>;
  /** Layout variant — "wide" reserves 140px for progress, "compact" less. */
  variant?: "wide" | "compact";
}

export function DownloadCell({
  repoId,
  task,
  already,
  onDownload,
  onCancel,
  onDelete,
  variant = "wide",
}: DownloadCellProps) {
  const { t } = useTranslation();
  const status = task?.status;
  const isActive = status === "pending" || status === "downloading";
  const isDone = status === "done" || already;
  const cancelRequested = task?.cancel_requested === true;
  const activeWidth = variant === "wide" ? "w-[140px]" : "w-[120px]";

  if (isDone) {
    return (
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-[10px] text-ovo-accent whitespace-nowrap">
          ✓ {t("models.download.installed")}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void onDelete(repoId);
          }}
          className="p-1 rounded bg-ovo-border text-ovo-muted hover:bg-rose-500 hover:text-white transition"
          title={t("models.download.delete_btn")}
        >
          <Trash2 className="w-3 h-3" aria-hidden />
        </button>
      </div>
    );
  }

  if (isActive && task) {
    const total = task.total_bytes ?? 0;
    const done = task.downloaded_bytes ?? 0;
    const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
    const files =
      task.total_files && task.downloaded_files !== null
        ? `${task.downloaded_files ?? 0}/${task.total_files}`
        : null;
    return (
      <div className={`flex flex-col items-end gap-1 ${activeWidth} shrink-0`}>
        <div className="flex items-center gap-1 w-full">
          <div className="flex-1 h-1.5 rounded-full bg-ovo-border overflow-hidden">
            <div
              className="h-full bg-ovo-accent transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void onCancel(task);
            }}
            disabled={cancelRequested}
            className="p-1 rounded bg-ovo-border text-ovo-muted hover:bg-rose-500 hover:text-white transition disabled:opacity-40"
            title={t("models.download.cancel_btn")}
          >
            <X className="w-3 h-3" aria-hidden />
          </button>
        </div>
        <div className="text-[9px] font-mono text-ovo-muted tabular-nums flex gap-1">
          {cancelRequested && (
            <span className="text-rose-400">{t("models.download.cancelling")}</span>
          )}
          {!cancelRequested && (
            <>
              <span>{percent}%</span>
              {total > 0 && (
                <span>
                  · {prettyBytes(done)}/{prettyBytes(total)}
                </span>
              )}
              {files && <span>· {files}</span>}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void onDownload(repoId);
      }}
      className="px-2 py-1 text-[10px] rounded bg-ovo-accent text-white hover:bg-ovo-accent-hover transition inline-flex items-center gap-1 shrink-0"
    >
      <DownloadIcon className="w-3 h-3" aria-hidden />
      {t("models.download.download_btn")}
    </button>
  );
}
// [END] Phase 7
