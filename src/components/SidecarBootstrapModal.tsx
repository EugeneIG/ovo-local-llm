import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useSidecarStore } from "../store/sidecar";

// [START] Phase R — First-run runtime install overlay.
// Shown while the Rust side runs `uv sync` against the bundled sidecar source
// to materialise the Python venv inside the user's Application Support dir.
// The modal is mounted unconditionally by AppShell and self-hides unless the
// sidecar reports `bootstrapping` health. Also surfaces `failed` when the
// failure happened during install so the user sees the error + retry button
// without having to open the status popover.
export function SidecarBootstrapModal() {
  const { t } = useTranslation();
  const status = useSidecarStore((s) => s.status);
  const log = useSidecarStore((s) => s.bootstrapLog);
  const reinstall = useSidecarStore((s) => s.reinstallRuntime);
  const restart = useSidecarStore((s) => s.restart);
  const logRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the log tail so the latest line stays visible.
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [log.length, status.bootstrap_progress]);

  const isBootstrapping = status.health === "bootstrapping";
  // Surface install failures — the health becomes "failed" with a message
  // mentioning "runtime install failed" when uv sync exits non-zero.
  const installFailed =
    status.health === "failed" && /runtime install|bootstrap/i.test(status.message ?? "");

  if (!isBootstrapping && !installFailed) return null;

  const progress = status.bootstrap_progress ?? t("sidecar.bootstrap.preparing");

  return (
    <div className="fixed inset-0 z-[9000] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[520px] max-w-[92vw] rounded-2xl bg-ovo-surface border border-ovo-border shadow-2xl overflow-hidden">
        <div className="p-6 flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <span className="text-3xl leading-none">🦉</span>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-semibold text-ovo-text">
                {installFailed
                  ? t("sidecar.bootstrap.failed_title")
                  : t("sidecar.bootstrap.title")}
              </h2>
              <p className="text-xs text-ovo-muted mt-1">
                {installFailed
                  ? t("sidecar.bootstrap.failed_body")
                  : t("sidecar.bootstrap.body")}
              </p>
            </div>
          </div>

          {!installFailed && (
            <div className="space-y-2">
              <div className="h-1.5 w-full rounded-full bg-ovo-border/60 overflow-hidden">
                <div className="h-full w-1/3 bg-ovo-accent animate-[sidecar-bootstrap-sweep_1.8s_ease-in-out_infinite]" />
              </div>
              <div className="text-[11px] text-ovo-muted tabular-nums truncate">
                {progress}
              </div>
            </div>
          )}

          {installFailed && status.message && (
            <div className="rounded-md bg-rose-500/10 border border-rose-500/30 px-3 py-2 text-xs text-rose-300">
              {status.message}
            </div>
          )}

          {log.length > 0 && (
            <div
              ref={logRef}
              className="h-40 rounded-md bg-black/40 border border-ovo-border/60 p-2 overflow-auto font-mono text-[10.5px] leading-[1.4] text-ovo-muted/90 whitespace-pre-wrap"
            >
              {log.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          )}

          {installFailed && (
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => void restart()}
                className="text-xs px-3 py-1.5 rounded-md border border-ovo-border hover:bg-ovo-border/40 transition"
              >
                {t("sidecar.bootstrap.retry")}
              </button>
              <button
                onClick={() => void reinstall()}
                className="text-xs px-3 py-1.5 rounded-md bg-ovo-accent text-ovo-accent-ink hover:bg-ovo-accent-hover transition"
              >
                {t("sidecar.bootstrap.reinstall")}
              </button>
            </div>
          )}
        </div>
      </div>
      <style>{`
        @keyframes sidecar-bootstrap-sweep {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(150%); }
          100% { transform: translateX(-100%); }
        }
      `}</style>
    </div>
  );
}
// [END]
