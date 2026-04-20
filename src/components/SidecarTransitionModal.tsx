import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useSidecarStore } from "../store/sidecar";
import type { SidecarHealth } from "../types/sidecar";

// [START] Phase 7 — Sidecar transition toast modal.
// Replaces the always-visible top banner with a transient modal that only
// appears during state *transitions*:
//   stopped → starting : shows "사이드카 로드 중…" with spinner
//   starting → healthy : flashes "정상 로드 확인" for 1.5s then auto-dismisses
//   starting → failed  : stays visible until user clicks retry / dismiss
// Healthy-at-boot (no prior transition) is silent. User can also manually
// close via the X; it'll re-appear on the next transition. The
// "bootstrapping" health is owned by <SidecarBootstrapModal />, so this
// modal stays quiet during install.

type Health = SidecarHealth;

type ModalState =
  | { kind: "hidden" }
  | { kind: "loading" }
  | { kind: "success" }
  | { kind: "failed"; message: string | null };

export function SidecarTransitionModal() {
  const { t } = useTranslation();
  const health = useSidecarStore((s) => s.status.health);
  const message = useSidecarStore((s) => s.status.message);
  const prev = useRef<Health>(health);
  const [state, setState] = useState<ModalState>({ kind: "hidden" });
  const dismissRef = useRef<number | null>(null);

  useEffect(() => {
    const from = prev.current;
    prev.current = health;

    // Any transition out of idle → react.
    if (from === health) return;

    if (dismissRef.current !== null) {
      window.clearTimeout(dismissRef.current);
      dismissRef.current = null;
    }

    if (health === "starting") {
      setState({ kind: "loading" });
    } else if (health === "healthy") {
      // Only flash success if we were previously non-healthy.
      if (from !== "healthy") {
        setState({ kind: "success" });
        dismissRef.current = window.setTimeout(() => {
          setState({ kind: "hidden" });
          dismissRef.current = null;
        }, 1500);
      }
    } else if (health === "failed") {
      setState({ kind: "failed", message });
    }
  }, [health, message]);

  function handleClose() {
    if (dismissRef.current !== null) {
      window.clearTimeout(dismissRef.current);
      dismissRef.current = null;
    }
    setState({ kind: "hidden" });
  }

  if (state.kind === "hidden") return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 right-6 z-40 min-w-[260px] max-w-[360px] rounded-lg border border-ovo-border bg-ovo-surface-solid shadow-xl px-4 py-3 flex items-center gap-3"
    >
      {state.kind === "loading" && (
        <>
          <Loader2 className="w-4 h-4 text-amber-400 animate-spin shrink-0" aria-hidden />
          <span className="text-sm text-ovo-text">{t("sidecar.modal.loading")}</span>
        </>
      )}
      {state.kind === "success" && (
        <>
          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" aria-hidden />
          <span className="text-sm text-ovo-text">{t("sidecar.modal.success")}</span>
        </>
      )}
      {state.kind === "failed" && (
        <>
          <XCircle className="w-4 h-4 text-rose-500 shrink-0" aria-hidden />
          <div className="flex-1 min-w-0">
            <div className="text-sm text-ovo-text">{t("sidecar.modal.failed")}</div>
            {state.message && (
              <div className="text-[11px] text-ovo-muted mt-0.5 truncate">
                {state.message}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="text-[11px] text-ovo-muted hover:text-ovo-text transition shrink-0"
          >
            ✕
          </button>
        </>
      )}
    </div>
  );
}
// [END] Phase 7
