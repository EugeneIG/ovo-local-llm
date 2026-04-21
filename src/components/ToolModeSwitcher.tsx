import { useTranslation } from "react-i18next";
import { Zap, MessageCircle, ClipboardList } from "lucide-react";
import { useToolModeStore, type ToolMode } from "../store/tool_mode";

const MODES: ReadonlyArray<{ key: ToolMode; icon: typeof Zap }> = [
  { key: "bypass", icon: Zap },
  { key: "ask", icon: MessageCircle },
  { key: "plan", icon: ClipboardList },
];

export function ToolModeSwitcher() {
  const { t } = useTranslation();
  const mode = useToolModeStore((s) => s.mode);
  const setMode = useToolModeStore((s) => s.setMode);

  const currentIdx = MODES.findIndex((m) => m.key === mode);
  const current = MODES[currentIdx >= 0 ? currentIdx : 0];
  const Icon = current.icon;

  const cycle = () => {
    const nextIdx = (currentIdx + 1) % MODES.length;
    setMode(MODES[nextIdx].key);
  };

  return (
    <button
      type="button"
      onClick={cycle}
      title={t(`chat.mode.${mode}_hint`)}
      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-ovo-border bg-ovo-surface-solid text-xs font-medium text-ovo-text hover:bg-ovo-bg transition"
    >
      <Icon className="w-3.5 h-3.5 text-ovo-accent" aria-hidden />
      <span>{t(`chat.mode.${mode}`)}</span>
    </button>
  );
}
