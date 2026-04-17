import { useTranslation } from "react-i18next";
import { LanguageToggle } from "../components/LanguageToggle";
import { useSidecarStore } from "../store/sidecar";

export function SettingsPane() {
  const { t } = useTranslation();
  const ports = useSidecarStore((s) => s.status.ports);

  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-lg font-semibold text-[#2C1810] mb-6">{t("nav.settings")}</h2>

      <section className="flex items-center justify-between py-3 border-b border-[#E8CFBB]">
        <label className="text-sm text-[#2C1810]">{t("settings.language")}</label>
        <LanguageToggle />
      </section>

      <section className="py-3 border-b border-[#E8CFBB]">
        <div className="text-sm text-[#2C1810] mb-2">{t("settings.ports")}</div>
        <dl className="grid grid-cols-3 gap-2 text-xs">
          <div className="bg-white/60 rounded p-2 border border-[#E8CFBB]">
            <dt className="text-[#8B4432]">{t("sidecar.ports.ollama")}</dt>
            <dd className="font-mono text-[#2C1810]">{ports.ollama}</dd>
          </div>
          <div className="bg-white/60 rounded p-2 border border-[#E8CFBB]">
            <dt className="text-[#8B4432]">{t("sidecar.ports.openai")}</dt>
            <dd className="font-mono text-[#2C1810]">{ports.openai}</dd>
          </div>
          <div className="bg-white/60 rounded p-2 border border-[#E8CFBB]">
            <dt className="text-[#8B4432]">{t("sidecar.ports.native")}</dt>
            <dd className="font-mono text-[#2C1810]">{ports.native}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
