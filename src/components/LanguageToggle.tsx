import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "../i18n";

export function LanguageToggle() {
  const { i18n } = useTranslation();
  const current = (i18n.resolvedLanguage ?? "ko") as SupportedLanguage;

  return (
    <div className="flex rounded-md overflow-hidden border border-[#E8CFBB] text-xs">
      {SUPPORTED_LANGUAGES.map((lng) => (
        <button
          key={lng}
          onClick={() => void i18n.changeLanguage(lng)}
          className={`px-2.5 py-1 transition ${
            current === lng
              ? "bg-[#8B4432] text-white"
              : "bg-white text-[#8B4432] hover:bg-[#F4D4B8]"
          }`}
        >
          {lng.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
