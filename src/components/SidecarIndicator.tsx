import { useTranslation } from "react-i18next";
import { useSidecarStore } from "../store/sidecar";
import type { SidecarHealth } from "../types/sidecar";

const DOT_COLORS: Record<SidecarHealth, string> = {
  stopped: "bg-neutral-400",
  starting: "bg-amber-400 animate-pulse",
  healthy: "bg-emerald-500",
  failed: "bg-rose-500",
};

export function SidecarIndicator() {
  const { t } = useTranslation();
  const status = useSidecarStore((s) => s.status);
  const restart = useSidecarStore((s) => s.restart);

  const apis = status.healthy_apis.length;
  const total = 3;

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/60 border border-[#E8CFBB]">
      <span className={`inline-block w-2.5 h-2.5 rounded-full ${DOT_COLORS[status.health]}`} />
      <div className="flex flex-col min-w-0">
        <span className="text-xs font-medium text-[#2C1810]">
          {t(`sidecar.status.${status.health}`)}
        </span>
        <span className="text-[10px] text-[#8B4432] tabular-nums">
          {apis}/{total} APIs · PID {status.pid ?? "—"}
        </span>
      </div>
      <button
        onClick={() => void restart()}
        className="ml-auto text-[11px] px-2 py-1 rounded bg-[#D97757] text-white hover:bg-[#B85D3F] transition disabled:opacity-50"
        disabled={status.health === "starting"}
      >
        {status.health === "starting" ? t("sidecar.restarting") : t("sidecar.restart")}
      </button>
    </div>
  );
}
