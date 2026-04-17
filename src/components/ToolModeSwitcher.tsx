import { useTranslation } from "react-i18next";
import { Zap, MessageCircle, ClipboardList } from "lucide-react";
import { useToolModeStore, type ToolMode } from "../store/tool_mode";

// [START] Phase 6.4 — inline tool-mode switcher for the ChatPane header.
// Mirrors SettingsPane's ToolModeSection but compact: three pills, icon +
// short label, persists via the same zustand store. Keeps Bypass / Ask /
// Plan one click away instead of buried in Settings.

interface ModeOption {
  key: ToolMode;
  icon: typeof Zap;
}

const MODES: ReadonlyArray<ModeOption> = [
  { key: "bypass", icon: Zap },
  { key: "ask", icon: MessageCircle },
  { key: "plan", icon: ClipboardList },
];

export function ToolModeSwitcher() {
  const { t } = useTranslation();
  const mode = useToolModeStore((s) => s.mode);
  const setMode = useToolModeStore((s) => s.setMode);

  return (
    <div
      role="radiogroup"
      aria-label={t("chat.mode.label")}
      className="inline-flex items-center gap-0.5 p-0.5 rounded-full bg-ovo-surface-solid border border-ovo-border"
    >
      {MODES.map(({ key, icon: Icon }) => {
        const active = mode === key;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setMode(key)}
            title={t(`chat.mode.${key}_hint`)}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium transition ${
              active
                ? "bg-ovo-accent text-ovo-accent-ink"
                : "text-ovo-muted hover:text-ovo-text hover:bg-ovo-bg"
            }`}
          >
            <Icon className="w-3 h-3" aria-hidden />
            <span>{t(`chat.mode.${key}`)}</span>
          </button>
        );
      })}
    </div>
  );
}
// [END]
