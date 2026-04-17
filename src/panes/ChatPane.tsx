import { useTranslation } from "react-i18next";

export function ChatPane() {
  const { t } = useTranslation();
  return (
    <div className="h-full flex flex-col items-center justify-center text-[#8B4432]">
      <p className="text-sm">{t("chat.empty")}</p>
    </div>
  );
}
