import { useTranslation } from "react-i18next";
import { CollapsibleSection } from "./CollapsibleSection";
import {
  FLAG_KEYS,
  useFeatureFlagsStore,
  type FeatureFlags,
} from "../store/feature_flags";

// [START] Phase 8 — Feature Flags section.
// Six on/off toggles for "smart" injections (skills, personas, wiki retrieval,
// memory tools, etc). Defaults are all-on; a user who wants a leaner system
// prompt or no automatic side-effects can disable any of them here.

const FLAG_META: Record<keyof FeatureFlags, { emoji: string }> = {
  enable_skills: { emoji: "✨" },
  enable_personas: { emoji: "🎭" },
  enable_skills_injection: { emoji: "📥" },
  enable_wiki_retrieval: { emoji: "🔍" },
  enable_memory_tools: { emoji: "🧠" },
  enable_wiki_auto_capture: { emoji: "📝" },
  enable_semantic_compact: { emoji: "🗜" },
  enable_model_recommendation: { emoji: "🎯" },
  enable_voice_input: { emoji: "🎙️" },
  enable_tts_response: { emoji: "🔊" },
};

export function FeatureFlagsSection() {
  const { t } = useTranslation();
  const flags = useFeatureFlagsStore();
  const setFlag = useFeatureFlagsStore((s) => s.set);
  const reset = useFeatureFlagsStore((s) => s.reset);

  return (
    <CollapsibleSection
      id="feature_flags"
      title={t("settings.feature_flags.section_title")}
      right={
        <button
          type="button"
          onClick={reset}
          className="text-[11px] px-2 py-1 rounded bg-ovo-surface-solid text-ovo-muted hover:text-ovo-text hover:bg-ovo-bg border border-ovo-border transition"
        >
          {t("settings.feature_flags.reset")}
        </button>
      }
    >
      <p className="text-xs text-ovo-muted mb-4">
        {t("settings.feature_flags.description")}
      </p>
      <div className="flex flex-col gap-3">
        {FLAG_KEYS.map((key) => {
          const value = flags[key];
          const meta = FLAG_META[key];
          return (
            <label
              key={key}
              className="flex items-start gap-3 p-3 rounded border border-ovo-border bg-ovo-chip cursor-pointer hover:bg-ovo-bg/40 transition"
            >
              <input
                type="checkbox"
                checked={value}
                onChange={(e) => setFlag(key, e.target.checked)}
                className="accent-ovo-accent mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 text-sm text-ovo-text font-medium">
                  <span aria-hidden>{meta.emoji}</span>
                  <span>{t(`settings.feature_flags.${key}_label`)}</span>
                  {!value && (
                    <span className="text-[9px] uppercase tracking-wider text-rose-500/80 ml-1">
                      {t("settings.feature_flags.off_badge")}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-ovo-muted mt-0.5">
                  {t(`settings.feature_flags.${key}_help`)}
                </p>
              </div>
            </label>
          );
        })}
      </div>
    </CollapsibleSection>
  );
}
// [END] Phase 8
