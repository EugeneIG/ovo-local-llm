import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react";
import { CollapsibleSection } from "./CollapsibleSection";
import {
  BUILTIN_IDS,
  displayProfileName,
  useModelProfilesStore,
  type ModelProfile,
} from "../store/model_profiles";
import { useProjectContextStore } from "../store/project_context";
import { useToastsStore } from "../store/toasts";

// [START] Phase 8 — Persona section in Settings.
// Lists every persona md found under `<project_path>/.ovo/personas/` and lets
// the user edit name / emoji / honorific / sampling / persona text in place.
// Built-ins (BUILTIN_IDS) get a "Reset to default" action; custom personas
// can be deleted. New personas are created with a slugged id.

interface DraftSampling {
  temperature: number | null;
  top_p: number | null;
  repetition_penalty: number | null;
  max_tokens: number | null;
}

interface Draft {
  id: string;
  name: string;
  emoji: string;
  user_honorific: string;
  persona: string;
  system_prompt_extra: string;
  model_ref: string;
  sampling: DraftSampling;
}

function profileToDraft(p: ModelProfile): Draft {
  return {
    id: p.id,
    name: p.name,
    emoji: p.emoji ?? "",
    user_honorific: p.user_honorific ?? "",
    persona: p.persona ?? "",
    system_prompt_extra: p.system_prompt_extra ?? "",
    model_ref: p.model_ref ?? "",
    sampling: {
      temperature: p.sampling?.temperature ?? null,
      top_p: p.sampling?.top_p ?? null,
      repetition_penalty: p.sampling?.repetition_penalty ?? null,
      max_tokens: p.sampling?.max_tokens ?? null,
    },
  };
}

function draftToProfile(d: Draft, existingPath?: string): ModelProfile {
  const sampling = {
    temperature: d.sampling.temperature ?? undefined,
    top_p: d.sampling.top_p ?? undefined,
    repetition_penalty: d.sampling.repetition_penalty ?? undefined,
    max_tokens: d.sampling.max_tokens,
  };
  const compactSampling = Object.fromEntries(
    Object.entries(sampling).filter(([k, v]) => {
      if (k === "max_tokens") return v !== undefined;
      return v !== undefined;
    }),
  );
  return {
    id: d.id,
    name: d.name.trim() || d.id,
    emoji: d.emoji.trim() || undefined,
    user_honorific: d.user_honorific.trim() || undefined,
    persona: d.persona.trim() || undefined,
    system_prompt_extra: d.system_prompt_extra.trim() || undefined,
    model_ref: d.model_ref.trim() || null,
    sampling: Object.keys(compactSampling).length > 0 ? compactSampling : undefined,
    path: existingPath,
    builtin: BUILTIN_IDS.has(d.id),
  };
}

function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9가-힣\s_-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base.length > 0 ? base.slice(0, 48) : `persona-${Date.now()}`;
}

interface PersonaCardProps {
  profile: ModelProfile;
  expanded: boolean;
  onToggle: () => void;
}

function PersonaCard({ profile, expanded, onToggle }: PersonaCardProps) {
  const { t } = useTranslation();
  const upsert = useModelProfilesStore((s) => s.upsert);
  const remove = useModelProfilesStore((s) => s.remove);
  const resetToBuiltin = useModelProfilesStore((s) => s.resetToBuiltin);
  const pushToast = useToastsStore((s) => s.push);

  const [draft, setDraft] = useState<Draft>(() => profileToDraft(profile));
  const [saving, setSaving] = useState(false);

  // Reset draft when the underlying profile snapshot changes (post-save rescan)
  useEffect(() => {
    setDraft(profileToDraft(profile));
  }, [profile]);

  const isBuiltin = BUILTIN_IDS.has(profile.id);

  async function handleSave() {
    setSaving(true);
    try {
      await upsert(draftToProfile(draft, profile.path));
      pushToast({ kind: "success", message: t("settings.personas.saved", { name: draft.name }) });
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (!isBuiltin) return;
    if (!window.confirm(t("settings.personas.confirm_reset", { name: profile.name }))) return;
    await resetToBuiltin(profile.id);
    pushToast({ kind: "success", message: t("settings.personas.reset_done", { name: profile.name }) });
  }

  async function handleDelete() {
    if (isBuiltin) return;
    if (!window.confirm(t("settings.personas.confirm_delete", { name: profile.name }))) return;
    await remove(profile.id);
  }

  function handleCopyPath() {
    if (!profile.path) return;
    navigator.clipboard.writeText(profile.path).catch(() => undefined);
    pushToast({ kind: "success", message: t("settings.personas.path_copied") });
  }

  return (
    <li className="border border-ovo-border bg-ovo-chip rounded">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-ovo-bg/40 transition"
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-ovo-accent shrink-0" aria-hidden />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-ovo-muted shrink-0" aria-hidden />
        )}
        <span className="w-5 text-center text-base shrink-0" aria-hidden>
          {profile.emoji ?? "·"}
        </span>
        <span className="text-sm text-ovo-text font-medium truncate">{displayProfileName(profile, t)}</span>
        {isBuiltin && (
          <span className="text-[9px] uppercase tracking-wider text-ovo-muted/70 ml-auto shrink-0">
            {t("settings.personas.builtin_badge")}
          </span>
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-1 flex flex-col gap-3 border-t border-ovo-border/60">
          {/* Name + emoji row */}
          <div className="flex gap-2">
            <label className="flex flex-col gap-1 w-16">
              <span className="text-[11px] text-ovo-muted">
                {t("settings.personas.field_emoji")}
              </span>
              <input
                type="text"
                value={draft.emoji}
                onChange={(e) => setDraft((d) => ({ ...d, emoji: e.target.value }))}
                maxLength={4}
                className="text-center text-base border border-ovo-border rounded px-2 py-1 bg-ovo-surface-solid text-ovo-text"
              />
            </label>
            <label className="flex flex-col gap-1 flex-1">
              <span className="text-[11px] text-ovo-muted">
                {t("settings.personas.field_name")}
              </span>
              <input
                type="text"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                maxLength={48}
                className="text-sm border border-ovo-border rounded px-2 py-1 bg-ovo-surface-solid text-ovo-text"
              />
            </label>
            <label className="flex flex-col gap-1 w-32">
              <span className="text-[11px] text-ovo-muted">
                {t("settings.personas.field_honorific")}
              </span>
              <input
                type="text"
                value={draft.user_honorific}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, user_honorific: e.target.value }))
                }
                maxLength={32}
                placeholder={t("settings.personas.honorific_placeholder")}
                className="text-sm border border-ovo-border rounded px-2 py-1 bg-ovo-surface-solid text-ovo-text placeholder:text-ovo-muted/50"
              />
            </label>
          </div>

          {/* Persona body */}
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-ovo-muted">
              {t("settings.personas.field_persona")}
            </span>
            <textarea
              value={draft.persona}
              onChange={(e) => setDraft((d) => ({ ...d, persona: e.target.value }))}
              rows={5}
              className="text-sm border border-ovo-border rounded px-2 py-1.5 bg-ovo-surface-solid text-ovo-text font-mono leading-relaxed resize-y"
              placeholder={t("settings.personas.persona_placeholder")}
            />
          </label>

          {/* Sampling sliders (4) */}
          <details className="text-xs">
            <summary className="cursor-pointer text-ovo-muted hover:text-ovo-text select-none py-1">
              {t("settings.personas.sampling_title")}
            </summary>
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3 pl-2">
              <SamplingSlider
                label={t("settings.sampling.temperature")}
                min={0}
                max={2}
                step={0.05}
                value={draft.sampling.temperature}
                onChange={(v) =>
                  setDraft((d) => ({ ...d, sampling: { ...d.sampling, temperature: v } }))
                }
              />
              <SamplingSlider
                label={t("settings.sampling.top_p")}
                min={0}
                max={1}
                step={0.01}
                value={draft.sampling.top_p}
                onChange={(v) =>
                  setDraft((d) => ({ ...d, sampling: { ...d.sampling, top_p: v } }))
                }
              />
              <SamplingSlider
                label={t("settings.sampling.repetition_penalty")}
                min={1}
                max={1.5}
                step={0.01}
                value={draft.sampling.repetition_penalty}
                onChange={(v) =>
                  setDraft((d) => ({
                    ...d,
                    sampling: { ...d.sampling, repetition_penalty: v },
                  }))
                }
              />
              <MaxTokensField
                value={draft.sampling.max_tokens}
                onChange={(v) =>
                  setDraft((d) => ({ ...d, sampling: { ...d.sampling, max_tokens: v } }))
                }
              />
            </div>
          </details>

          {/* System prompt extra */}
          <details className="text-xs">
            <summary className="cursor-pointer text-ovo-muted hover:text-ovo-text select-none py-1">
              {t("settings.personas.extra_title")}
            </summary>
            <textarea
              value={draft.system_prompt_extra}
              onChange={(e) =>
                setDraft((d) => ({ ...d, system_prompt_extra: e.target.value }))
              }
              rows={2}
              placeholder={t("settings.personas.extra_placeholder")}
              className="mt-2 w-full text-sm border border-ovo-border rounded px-2 py-1.5 bg-ovo-surface-solid text-ovo-text resize-y"
            />
          </details>

          {/* Path + actions */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="text-xs px-3 py-1.5 rounded bg-ovo-accent text-ovo-accent-ink hover:bg-ovo-accent-hover transition disabled:opacity-40"
            >
              {saving ? t("common.loading") : t("settings.personas.save")}
            </button>
            {isBuiltin ? (
              <button
                type="button"
                onClick={() => void handleReset()}
                className="text-xs px-3 py-1.5 rounded bg-ovo-border text-ovo-text hover:bg-ovo-accent hover:text-white transition"
              >
                {t("settings.personas.reset")}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleDelete()}
                className="text-xs px-3 py-1.5 rounded bg-ovo-border text-ovo-text hover:bg-rose-100 hover:text-rose-700 transition"
              >
                {t("settings.personas.delete")}
              </button>
            )}
            {profile.path && (
              <button
                type="button"
                onClick={handleCopyPath}
                title={profile.path}
                className="text-[10px] px-2 py-1 rounded bg-ovo-surface-solid text-ovo-muted hover:text-ovo-text border border-ovo-border transition truncate max-w-xs"
              >
                {t("settings.personas.copy_path")}
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

interface SamplingSliderProps {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number | null;
  onChange: (v: number | null) => void;
}

function SamplingSlider({ label, min, max, step, value, onChange }: SamplingSliderProps) {
  const { t } = useTranslation();
  const enabled = value !== null;
  const display = value ?? (min + max) / 2;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-ovo-text">{label}</span>
        <label className="flex items-center gap-1 text-[10px] text-ovo-muted cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onChange(e.target.checked ? display : null)}
            className="accent-ovo-accent"
          />
          <span>{t("settings.personas.use_override")}</span>
          {enabled && (
            <span className="font-mono tabular-nums text-ovo-muted ml-1">
              {display.toFixed(2)}
            </span>
          )}
        </label>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={display}
        disabled={!enabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-ovo-accent disabled:opacity-30"
      />
    </div>
  );
}

interface MaxTokensFieldProps {
  value: number | null;
  onChange: (v: number | null) => void;
}

function MaxTokensField({ value, onChange }: MaxTokensFieldProps) {
  const { t } = useTranslation();
  // Tri-state: undefined-equivalent (don't override), unlimited (null in stored sense),
  // or a positive integer. We collapse the first two by using `null` for "no override"
  // and a number for "cap at N tokens". UI shows three radios.
  const [mode, setMode] = useState<"inherit" | "limit">(value === null ? "inherit" : "limit");
  const display = value ?? 2048;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-ovo-text">{t("settings.sampling.max_tokens")}</span>
      <div className="flex items-center gap-3 text-[10px] text-ovo-muted">
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="radio"
            checked={mode === "inherit"}
            onChange={() => {
              setMode("inherit");
              onChange(null);
            }}
            className="accent-ovo-accent"
          />
          <span>{t("settings.personas.max_tokens_inherit")}</span>
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="radio"
            checked={mode === "limit"}
            onChange={() => {
              setMode("limit");
              onChange(display);
            }}
            className="accent-ovo-accent"
          />
          <span>{t("settings.personas.max_tokens_limit")}</span>
        </label>
        {mode === "limit" && (
          <span className="font-mono tabular-nums text-ovo-muted ml-1">{display}</span>
        )}
      </div>
      <input
        type="range"
        min={128}
        max={16384}
        step={128}
        value={display}
        disabled={mode !== "limit"}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-ovo-accent disabled:opacity-30"
      />
    </div>
  );
}

export function PersonaSection() {
  const { t } = useTranslation();
  const profiles = useModelProfilesStore((s) => s.profiles);
  const loading = useModelProfilesStore((s) => s.loading);
  const lastFolder = useModelProfilesStore((s) => s.last_folder);
  const lastError = useModelProfilesStore((s) => s.last_error);
  const rescan = useModelProfilesStore((s) => s.rescan);
  const upsert = useModelProfilesStore((s) => s.upsert);
  const projectPath = useProjectContextStore((s) => s.project_path);

  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    void rescan();
  }, [rescan, projectPath]);

  const folder = useMemo(
    () => lastFolder ?? (projectPath ? `${projectPath}/.ovo/personas` : null),
    [lastFolder, projectPath],
  );

  async function handleCreate() {
    const name = window.prompt(t("settings.personas.create_prompt"));
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    let id = slugify(trimmed);
    let suffix = 1;
    while (profiles.some((p) => p.id === id)) {
      id = `${slugify(trimmed)}-${suffix++}`;
    }
    await upsert({
      id,
      name: trimmed,
      emoji: "✨",
    });
    setExpandedId(id);
  }

  return (
    <CollapsibleSection
      id="personas"
      title={t("settings.personas.section_title")}
      right={
        <button
          type="button"
          onClick={() => void handleCreate()}
          className="text-[11px] px-2 py-1 rounded bg-ovo-accent text-ovo-accent-ink hover:bg-ovo-accent-hover transition"
        >
          {t("settings.personas.create")}
        </button>
      }
    >
      <p className="text-xs text-ovo-muted mb-3">
        {t("settings.personas.description")}
      </p>

      <div className="flex items-center gap-2 flex-wrap text-xs mb-3">
        <div
          className="font-mono text-ovo-muted truncate max-w-xs"
          title={folder ?? undefined}
        >
          {folder ?? t("settings.personas.no_folder")}
        </div>
        <button
          type="button"
          onClick={() => void rescan()}
          disabled={loading}
          className="px-2 py-1 rounded bg-ovo-border text-ovo-text hover:bg-ovo-accent hover:text-white transition disabled:opacity-40"
        >
          {loading ? t("common.loading") : t("settings.personas.rescan")}
        </button>
      </div>

      {lastError && (
        <p className="text-xs text-rose-500 mb-3">
          {t("settings.personas.error", { error: lastError })}
        </p>
      )}

      {profiles.length === 0 ? (
        <p className="text-xs text-ovo-muted/70 italic">
          {t("settings.personas.empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {profiles.map((p) => (
            <PersonaCard
              key={p.id}
              profile={p}
              expanded={expandedId === p.id}
              onToggle={() => setExpandedId((cur) => (cur === p.id ? null : p.id))}
            />
          ))}
        </ul>
      )}
    </CollapsibleSection>
  );
}
// [END] Phase 8
