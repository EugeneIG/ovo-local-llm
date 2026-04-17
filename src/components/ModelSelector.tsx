import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Check, Eye, Mic } from "lucide-react";
import type { ModelCapability, OvoModel } from "../types/ovo";
// [START] model_perf — import store for perf badges
import { useModelPerfStore } from "../store/model_perf";
import type { ModelPerfAgg } from "../store/model_perf";
// [END]

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
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-ovo-nav-active text-ovo-text text-[10px] leading-none"
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

// [START] model_perf — PerfBadge renders t/s + tooltip for a single model row
function perfColor(tps: number): string {
  if (tps > 30) return "text-green-500";
  if (tps >= 15) return "text-amber-500";
  return "text-ovo-muted";
}

function relativeTime(epochMs: number): string {
  const diffSec = Math.floor((Date.now() - epochMs) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

function PerfBadge({ agg }: { agg: ModelPerfAgg }) {
  const { t } = useTranslation();
  const tps = agg.avg_tokens_per_sec;
  const tooltip = [
    t("models.perf.runs", { count: agg.runs }),
    t("models.perf.ttft", { ms: Math.round(agg.avg_ttft_ms) }),
    t("models.perf.last_used", { when: relativeTime(agg.last_used_at) }),
  ].join(" · ");

  return (
    <span
      className={`ml-auto shrink-0 text-[10px] leading-none font-mono ${perfColor(tps)}`}
      title={tooltip}
    >
      {tps.toFixed(1)} t/s
    </span>
  );
}
// [END]

// [START] model_perf — ModelRow renders a single clickable model entry
function ModelRow({
  m,
  isActive,
  agg,
  onSelect,
}: {
  m: OvoModel;
  isActive: boolean;
  agg: ModelPerfAgg | null;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left px-3 py-2 flex items-center gap-2 text-sm hover:bg-ovo-bg ${
        isActive ? "bg-ovo-nav-active" : ""
      }`}
    >
      <Check
        className={`w-4 h-4 shrink-0 ${isActive ? "text-ovo-accent" : "text-transparent"}`}
        aria-hidden
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-ovo-text">{m.repo_id}</span>
          {agg && <PerfBadge agg={agg} />}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[11px] text-ovo-muted">
            {t(`models.source.${m.source}`)}
          </span>
          <CapabilityBadges capabilities={m.capabilities} />
        </div>
      </div>
    </button>
  );
}
// [END]

export function ModelSelector({ models, value, onChange, disabled }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // [START] model_perf — read stats from store
  const stats = useModelPerfStore((s) => s.stats);
  // [END]

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const selected = models.find((m) => m.repo_id === value);

  // [START] model_perf — "Recently used" group: top 3 by last_used_at
  const recentlyUsed: OvoModel[] = [];
  const hasAnyStats = Object.keys(stats).length > 0;
  if (hasAnyStats) {
    const sorted = Object.entries(stats)
      .sort(([, a], [, b]) => b.last_used_at - a.last_used_at)
      .slice(0, 3)
      .map(([repoId]) => repoId);
    for (const repoId of sorted) {
      const model = models.find((m) => m.repo_id === repoId);
      if (model) recentlyUsed.push(model);
    }
  }
  // [END]

  function handleSelect(repoId: string): void {
    onChange(repoId);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-ovo-surface border border-ovo-border text-sm text-ovo-text hover:bg-ovo-surface-solid transition disabled:opacity-50 disabled:cursor-not-allowed max-w-[380px]"
      >
        <span className="truncate">
          {selected ? truncate(selected.repo_id, 48) : t("chat.pick_model")}
        </span>
        {selected && <CapabilityBadges capabilities={selected.capabilities} compact />}
        <ChevronDown className="w-4 h-4 shrink-0 opacity-70" aria-hidden />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-[440px] max-h-[360px] overflow-y-auto overscroll-contain rounded-lg bg-ovo-surface-solid border border-ovo-border shadow-lg">
          {models.length === 0 ? (
            <div className="p-3 text-xs text-ovo-muted">{t("models.empty")}</div>
          ) : (
            <ul className="py-1">
              {/* [START] model_perf — "Recently used" section at top */}
              {recentlyUsed.length > 0 && (
                <>
                  <li className="px-3 pt-1.5 pb-0.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-ovo-muted">
                      {t("models.perf.recently_used_group")}
                    </span>
                  </li>
                  {recentlyUsed.map((m) => (
                    <li key={`recent:${m.repo_id}`}>
                      <ModelRow
                        m={m}
                        isActive={m.repo_id === value}
                        agg={stats[m.repo_id] ?? null}
                        onSelect={() => handleSelect(m.repo_id)}
                      />
                    </li>
                  ))}
                  <li className="my-1 border-t border-ovo-border" aria-hidden />
                </>
              )}
              {/* [END] */}
              {models.map((m) => (
                <li key={`${m.source}:${m.repo_id}:${m.revision}`}>
                  <ModelRow
                    m={m}
                    isActive={m.repo_id === value}
                    agg={stats[m.repo_id] ?? null}
                    onSelect={() => handleSelect(m.repo_id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
