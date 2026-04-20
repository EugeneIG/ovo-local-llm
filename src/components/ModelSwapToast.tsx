import { useTranslation } from "react-i18next";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useModelSwapStore } from "../store/model_swap";

// [START] Phase 8 — Top-center model swap toast.
// Two-stage transient toast that fires whenever the active model in a slot
// changes. Stage 1 ("unmounting <prev>") is a spinner over the old model
// name; stage 2 ("mounted <next>") is a check over the new one. Auto-hides
// after the second stage; user can click anywhere to dismiss early.
//
// Position: pinned to the top center of the viewport so it sits above the
// chat / image content but below modal dialogs. Bottom-right is reserved for
// the SidecarTransitionModal (boot-time transitions) so the two never
// collide visually.

export function ModelSwapToast() {
  const { t } = useTranslation();
  const phase = useModelSwapStore((s) => s.phase);
  const dismiss = useModelSwapStore((s) => s.dismiss);

  if (phase.kind === "idle") return null;

  const isUnmounting = phase.kind === "unmounting";
  const text = isUnmounting
    ? t("models.swap.unmounting", { name: phase.from })
    : t("models.swap.mounted", { name: phase.to });

  return (
    <div
      role="status"
      aria-live="polite"
      onClick={dismiss}
      className="fixed top-4 left-1/2 -translate-x-1/2 z-50 cursor-pointer"
    >
      <div
        className={`flex items-center gap-2.5 rounded-full px-4 py-2 shadow-lg border text-sm font-medium transition-colors ${
          isUnmounting
            ? "bg-ovo-surface-solid border-ovo-border text-ovo-text"
            : "bg-emerald-500/95 border-emerald-400 text-white"
        }`}
      >
        {isUnmounting ? (
          <Loader2 className="w-4 h-4 animate-spin shrink-0 text-amber-500" aria-hidden />
        ) : (
          <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden />
        )}
        <span className="font-mono text-[13px] truncate max-w-md">{text}</span>
      </div>
    </div>
  );
}
// [END] Phase 8
