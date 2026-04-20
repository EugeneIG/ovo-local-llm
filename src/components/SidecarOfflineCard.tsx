import { useTranslation } from "react-i18next";
import { HardDrive, Loader2, RefreshCw } from "lucide-react";
import type { SidecarHealth } from "../types/sidecar";

// [START] Phase 7 — Sidecar offline / transient-state central placeholder.
// Replaces the sticky top banner that shouted at the user constantly. Only
// appears inside empty chat / image panes when the sidecar isn't healthy,
// giving the user a clear single action: start / retry. Transient starting
// states are handled by the global <SidecarTransitionModal /> separately.
// "bootstrapping" is covered by the full-screen <SidecarBootstrapModal />,
// so this card never actually renders for that health — but the type has to
// accept it to satisfy the narrowing in ChatPane / ImagePane.

interface Props {
  health: SidecarHealth;
  onStart: () => void;
}

export function SidecarOfflineCard({ health, onStart }: Props) {
  const { t } = useTranslation();
  const isStarting = health === "starting" || health === "bootstrapping";
  const isFailed = health === "failed";

  return (
    <div className="max-w-md text-center flex flex-col items-center gap-3 p-5 rounded-xl border border-ovo-border bg-ovo-surface">
      <div className="relative">
        <HardDrive
          className={`w-8 h-8 ${
            isFailed ? "text-rose-500" : isStarting ? "text-amber-400" : "text-ovo-muted"
          }`}
          aria-hidden
        />
        {isStarting && (
          <Loader2
            className="absolute -right-1 -bottom-1 w-4 h-4 text-amber-400 animate-spin"
            aria-hidden
          />
        )}
      </div>
      <h3 className="text-sm font-semibold text-ovo-text">
        {t(`sidecar.offline.${health}_title`)}
      </h3>
      <p className="text-xs text-ovo-muted leading-relaxed">
        {t(`sidecar.offline.${health}_body`)}
      </p>
      {!isStarting && (
        <button
          type="button"
          onClick={onStart}
          className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-ovo-accent text-ovo-accent-ink text-xs font-medium hover:bg-ovo-accent-hover transition"
        >
          <RefreshCw className="w-3.5 h-3.5" aria-hidden />
          {t(`sidecar.offline.${isFailed ? "retry_btn" : "start_btn"}`)}
        </button>
      )}
    </div>
  );
}
// [END] Phase 7
