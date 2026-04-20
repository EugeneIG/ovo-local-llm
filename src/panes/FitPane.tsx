// [START] Phase 8 — Dedicated Fit pane.
// The Fit pane is the hub for "what can my machine run?" — it hosts the
// full HW summary, every fit assessment for installed models, the curated
// catalog, and the HF live-search explorer. ModelsPane still owns the
// download-management flow; Fit points at it for action and stays focused
// on discovery / recommendation.

import { useTranslation } from "react-i18next";
import { Gauge } from "lucide-react";
import { FitOverview } from "../components/FitOverview";

export function FitPane() {
  const { t } = useTranslation();
  return (
    <div className="h-full overflow-y-auto p-6">
      <header className="flex items-baseline justify-between mb-3">
        <h2 className="text-lg font-semibold text-ovo-text flex items-center gap-2">
          <Gauge className="w-5 h-5 text-ovo-accent" />
          {t("fit.title")}
        </h2>
        <span className="text-xs text-ovo-muted">{t("fit.subtitle")}</span>
      </header>
      <FitOverview />
    </div>
  );
}
// [END]
