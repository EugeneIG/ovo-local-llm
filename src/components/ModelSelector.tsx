import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Check, Eye, Mic } from "lucide-react";
import type { ModelCapability, OvoModel } from "../types/ovo";

interface Props {
  models: OvoModel[];
  value: string | null;
  onChange: (repoId: string) => void;
  disabled?: boolean;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// [START] Capability badges — small pills for non-text modalities.
const CAPABILITY_META: Record<
  Exclude<ModelCapability, "text">,
  { icon: typeof Eye; i18nKey: string }
> = {
  vision: { icon: Eye, i18nKey: "models.capability.vision" },
  audio: { icon: Mic, i18nKey: "models.capability.audio" },
};

function CapabilityBadges({
  capabilities,
  compact = false,
}: {
  capabilities: ModelCapability[];
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const keys: Array<Exclude<ModelCapability, "text">> = [];
  if (capabilities.includes("vision")) keys.push("vision");
  if (capabilities.includes("audio")) keys.push("audio");
  if (keys.length === 0) return null;
  return (
    <span className="inline-flex gap-1 shrink-0">
      {keys.map((k) => {
        const { icon: Icon, i18nKey } = CAPABILITY_META[k];
        return (
          <span
            key={k}
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-[#F4D4B8]/70 text-[#5C3B2E] text-[10px] leading-none"
            title={t(i18nKey)}
          >
            <Icon className="w-2.5 h-2.5" aria-hidden />
            {!compact && <span>{t(i18nKey)}</span>}
          </span>
        );
      })}
    </span>
  );
}
// [END]

export function ModelSelector({ models, value, onChange, disabled }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const selected = models.find((m) => m.repo_id === value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-white/70 border border-[#E8CFBB] text-sm text-[#2C1810] hover:bg-white transition disabled:opacity-50 disabled:cursor-not-allowed max-w-[380px]"
      >
        <span className="truncate">
          {selected ? truncate(selected.repo_id, 48) : t("chat.pick_model")}
        </span>
        {selected && <CapabilityBadges capabilities={selected.capabilities} compact />}
        <ChevronDown className="w-4 h-4 shrink-0 opacity-70" aria-hidden />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-[440px] max-h-[360px] overflow-auto rounded-lg bg-white border border-[#E8CFBB] shadow-lg">
          {models.length === 0 ? (
            <div className="p-3 text-xs text-[#8B4432]">{t("models.empty")}</div>
          ) : (
            <ul className="py-1">
              {models.map((m) => {
                const isActive = m.repo_id === value;
                return (
                  <li key={`${m.source}:${m.repo_id}:${m.revision}`}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange(m.repo_id);
                        setOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 flex items-center gap-2 text-sm hover:bg-[#FAF3E7] ${
                        isActive ? "bg-[#F4D4B8]/60" : ""
                      }`}
                    >
                      <Check
                        className={`w-4 h-4 shrink-0 ${isActive ? "text-[#D97757]" : "text-transparent"}`}
                        aria-hidden
                      />
                      <div className="flex-1 min-w-0">
                        <div className="truncate text-[#2C1810]">{m.repo_id}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[11px] text-[#8B4432]">
                            {t(`models.source.${m.source}`)}
                          </span>
                          <CapabilityBadges capabilities={m.capabilities} />
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
