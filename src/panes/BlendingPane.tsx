import { useTranslation } from "react-i18next";
import { Blend } from "lucide-react";

export function BlendingPane() {
  const { t } = useTranslation();
  return (
    <div className="h-full overflow-y-auto p-6">
      <header className="flex items-baseline justify-between mb-6">
        <h2 className="text-lg font-semibold text-ovo-text flex items-center gap-2">
          <Blend className="w-5 h-5 text-ovo-accent" />
          {t("blending.title")}
        </h2>
        <span className="text-xs text-ovo-muted">{t("blending.subtitle")}</span>
      </header>

      <div className="flex flex-col items-center justify-center text-center py-20 px-8 rounded-xl bg-ovo-surface border border-ovo-border">
        <Blend className="w-16 h-16 text-ovo-muted mb-4" aria-hidden />
        <h3 className="text-xl font-semibold text-ovo-text mb-2">
          {t("blending.coming_soon_title")}
        </h3>
        <p className="text-sm text-ovo-muted max-w-md leading-relaxed whitespace-pre-line">
          {t("blending.coming_soon_desc")}
        </p>

        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-3 w-full max-w-2xl">
          <div className="p-4 rounded-lg bg-ovo-bg border border-ovo-border text-left">
            <div className="text-xs uppercase tracking-wide text-ovo-accent mb-1">TIES</div>
            <div className="text-sm font-medium text-ovo-text mb-1">{t("blending.method_ties_title")}</div>
            <div className="text-xs text-ovo-muted">{t("blending.method_ties_desc")}</div>
          </div>
          <div className="p-4 rounded-lg bg-ovo-bg border border-ovo-border text-left">
            <div className="text-xs uppercase tracking-wide text-ovo-accent mb-1">DARE</div>
            <div className="text-sm font-medium text-ovo-text mb-1">{t("blending.method_dare_title")}</div>
            <div className="text-xs text-ovo-muted">{t("blending.method_dare_desc")}</div>
          </div>
          <div className="p-4 rounded-lg bg-ovo-bg border border-ovo-border text-left">
            <div className="text-xs uppercase tracking-wide text-ovo-accent mb-1">SLERP</div>
            <div className="text-sm font-medium text-ovo-text mb-1">{t("blending.method_slerp_title")}</div>
            <div className="text-xs text-ovo-muted">{t("blending.method_slerp_desc")}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
